const RammerheadLogging = require("./RammerheadLogging.js");
const generateId = require("../util/generateId.js");
const streamToString = require('../util/streamToString.js');
const socks = require('socksv5');
const path = require('path');
const fs = require('fs');
const doesCFCookieWork = require("../util/doesCFCookieWork.js");
const URLPath = require("../util/URLPath.js");
const parseRootDomain = require("../util/parseRootDomain.js");
const getSessionId = require("../util/getSessionId.js");
const StrShuffler = require("../util/StrShuffler.js");
const md5 = require('crypto-md5');

/**
  * @typedef {Object} RammerheadCloudflareGenericSolverArguments
  * @property {boolean=} disableProxy - disable proxy for those that don't need it. custom class will throw an
  * error if it needs it
  * @property {string=} proxyBindAddress - interface/ip to bind to. for the cloudflare solver
  * to work, the solved challenge's ip must be the same as the server ip.
  * @property {string=} proxyPort
  * @property {string=} publicProxyAddress - if your network system has a more complicated routing
  * configuration, you can specify where the proxy address lives publicly. Otherwise, by default, we assume it's
  * the proxyBindAddress. Nevertheless, the curled ip address must match the curled ip address through the proxy.
  * You can also use this to specify a custom http proxy if you want to use a custom http proxy in the smae server
  * @property {string=} publicProxyPort
  * @property {string=} proxyUsername - randomly generated, but you should specify if you are referencing
  * another proxy in the system
  * @property {string=} proxyPassword
  * @property {number=} recheckTimeout - require a certain amount of ms before rechecking if cf cookie is still valid.
  * @property {number=} freeRetryAfter - ms before a session whose own (free) pass of a site's challenge failed tries
  * it again instead of going straight to the solver. default 30 minutes
  * @property {number=} maxFailedSolves - paid solves for a site that may fail within failedSolveWindow before the
  * solver stops paying for it (pages get cloudflare's own widget back). default 3
  * @property {number=} failedSolveWindow - ms, default 30 minutes
  * @property {string=} databaseFolder - folder of mini database of saved cookies so we don't have to
  * re-pay/re-solve each time we visit a site after the server restarts
  * @property {RammerheadLogging=} logger
*/
class RammerheadCloudflareGenericSolver {
  /**
   * 
   * @param {RammerheadCloudflareGenericSolverArguments} options
   */
  constructor({
    disableProxy,
    proxyBindAddress,
    proxyPort,
    publicProxyAddress,
    publicProxyPort,
    proxyUsername,
    proxyPassword,
    recheckTimeout = 60000,
    freeRetryAfter = 30 * 60 * 1000,
    maxFailedSolves = 3,
    failedSolveWindow = 30 * 60 * 1000,
    databaseFolder = path.join(__dirname, '../../cf-clearances'),
    logger = new RammerheadLogging({ logLevel: 'info' })
  }) {
    this.recheckTimeout = recheckTimeout;
    this.freeRetryAfter = freeRetryAfter;
    this.maxFailedSolves = maxFailedSolves;
    this.failedSolveWindow = failedSolveWindow;
    // domain -> times its paid solves failed
    this.failedSolves = new Map();
    // counters since the last takeStats(), for whoever runs the proxy to graph
    this.stats = this.emptyStats();
    this.logger = logger;
    this.disableProxy = disableProxy;

    if (!disableProxy) {
      if (!proxyBindAddress && !publicProxyAddress) {
        throw new TypeError('either proxyBindAddress or publicProxyAddress must be specified');
      }
      if (!proxyPort && !publicProxyPort) {
        throw new TypeError('either proxyPort or publicProxyPort must be specified');
      }

      if (proxyBindAddress) {
        this.proxyUsername = typeof proxyUsername === 'string' ? proxyUsername : 'rh';
        this.proxyPassword = typeof proxyPassword === 'string' ? proxyPassword : generateId();
      }
      this.proxyBindAddress = proxyBindAddress;
      this.proxyPort = proxyPort;
      this.publicProxyAddress = publicProxyAddress || proxyBindAddress || '';
      this.publicProxyPort = publicProxyPort || proxyPort || '';
      this.socksServer = socks.createServer(function (_info, accept, _deny) {
        accept();
      });

      // check if user accidentally put a private ip
      if (['127.0.0.1', '0.0.0.0'].includes(this.publicProxyAddress)) {
        throw new TypeError('publicProxyAddress (or proxyBindAddress) cannot be 127.0.0.1 or 0.0.0.0. it must be an ip that is reachable from the internet.');
      }

      if (this.proxyBindAddress) {
        this.socksServer.listen(this.proxyPort, this.proxyBindAddress, () => {
          this.logger.info(`(CFSolver) SOCKS server listening on ${this.proxyBindAddress}:${this.proxyPort}`);
        });
        this.socksServer.useAuth(socks.auth.UserPassword((user, password, cb) => {
          cb((!this.proxyUsername || this.proxyUsername === user) && (!this.proxyPassword || this.proxyPassword === password));
        }));
      } else {
        this.logger.info('(CFSolver) assuming specified public proxy address works, skipping socks5 proxy server creation');
      }
    }

    // { site.com: { waitingCallbacks: [promise1, promise2]} }
    // resolves all pending promises when challenge is completed.
    // afterwards, saves to disk for persistance because we wouldn't want to
    // pay for the same site every time we visit it.
    // this also part of a token to cf_clearance cookie pipeline in case
    // the solver service only returns a token and not a cookie
    /**
     * @type {Map<string, { waitingCalbacks: (() => {})[], waitingForCookie?: { sessionId: string | null, token: string, userAgent: string, callback: (cookie: string | null) => {} } }>}
     */
    this.pendingDomains = new Map();

    /**
     * site.com: { intervalId: setInterval(() => deletesItself, checkResult: true/false/null, waitingCallbacks: [promise1, promise2] ) }.
     * checkResult: true means site is working. false means challenge required. null means currently waiting for result
     * @type {Map<string, { intervalId: number, checkResult: boolean | null, waitingCallbacks: [promise1, promise2] }>}
     */
    this.recheckTimeoutDomains = new Map();

    this.databaseFolder = databaseFolder;
    this.checkDatabaseIntegrity();
  }

  /**
   * @param {import('../classes/RammerheadProxy.js')} proxy 
   * @param {import('../classes/RammerheadSessionAbstractStore.js')} sessionStore 
   */
  attachToProxy(proxy, sessionStore) {
    if (this.alreadyAttachedToProxy)
      throw new TypeError('already attached to a proxy');
    if (!proxy)
      throw new TypeError('must specify proxy');
    if (!sessionStore)
      throw new TypeError('must specify sessionStore');
    // pages only hook turnstile when a solver exists (see RammerheadSession.getTaskScript)
    require('./RammerheadSession').cloudflareSolverAttached = true;

    this.alreadyAttachedToProxy = true;

    // userAgent replacer for urls
    proxy.addToOnRequestPipeline((req, _res, _serverInfo, isRoute, _isWebsocket) => {
      if (isRoute) return;

      const reqUrl = getSessionId(req.url) ? req.url : req.headers.referer;

      if (!reqUrl) return;

      const sessionId = getSessionId(reqUrl);
      const session = sessionId && sessionStore.get(sessionId || '');

      // direct copy from addUrlShuffling.js.
      // we're only using it to get the destination url
      const replaceUrl = (url, replacer) => {
        return (url || '').replace(/^((?:[a-z0-9]+:\/\/[^/]+)?(?:\/[^/]+\/))([^]+)/i, function (_, g1, g2) {
          return g1 + replacer(g2);
        });
      };

      let destUrl = '';

      if (session && session.shuffleDict) {
        const shuffler = new StrShuffler(session.shuffleDict);
        replaceUrl(reqUrl, (url) => destUrl = shuffler.unshuffle(url));
      } else {
        replaceUrl(reqUrl, (url) => destUrl = url);
      }

      if (destUrl && session) {
        const rootDomain = parseRootDomain(destUrl);
        const userAgent = rootDomain && this.userAgentFor(session, rootDomain);
        if (userAgent) {
          // replace user-agent headers
          req.headers["user-agent"] = userAgent;
        }
      }
    });

    proxy.POST('/api/cloudflare-bulldozer', async (req, res) => {
      const { sessionId } = new URLPath(req.url).getParams();
      const { sitekey, pageurl, data, pagedata, action, userAgent } = JSON.parse(await streamToString(req));
      const domain = parseRootDomain(pageurl);
      if (!sessionId || !sitekey || !pageurl || !domain || !data || !pagedata || !action || !userAgent || !sessionStore.has(sessionId)) {
        res.writeHead(400);
        res.end('bad request');
        return;
      }

      const justnowSession = sessionStore.get(sessionId);
      // pages only ask us once cloudflare's own widget failed: skip it for this site for a while
      if (!this.freeFailedFor(justnowSession, domain)) {
        this.stats.freeFailed++;
        this.logger.debug(`(CFSolver./cloudflare-bulldozer) free pass failed for ${sessionId} on ${domain}`);
        const failed = {};
        for (const [key, until] of Object.entries(justnowSession.data.cfFreeFailed || {})) {
          if (until > Date.now()) failed[key] = until;
        }
        failed[domain] = Date.now() + this.freeRetryAfter;
        justnowSession.data.cfFreeFailed = failed;
      }
      const eps = justnowSession.externalProxySettings;
      const proxyUrl = eps ? `${eps.proxyAuth ? eps.proxyAuth + '@' : ''}${eps.host}` : null;

      // fix paying for solves forever on a site whose tokens keep getting rejected: give the page cloudflare's own
      // widget back for a while (a cached clearance still gets used)
      if (this.solverGaveUpOn(domain) && !this.getClearanceFor(domain, proxyUrl)) {
        this.logger.warn(`(CFSolver./cloudflare-bulldozer) not paying for ${domain}: ${this.maxFailedSolves} failed solves recently`);
        this.stats.gaveUp++;
        res.writeHead(429);
        res.end('the solver keeps failing on this site, try again later');
        return;
      }

      // don't leave them hanging when finding the solution
      res.end('ok');

      // note: it is fine for the client to request this endpoint multiple times,
      // because it won't matter if there are "multiple" instances for the same session
      // because when all of them resolve, they'll just set the same cookie

      this.logger.debug(`(CFSolver./cloudflare-bulldozer) received request from ${sessionId} to solve ${pageurl}`);

      const cached = await this.solveCached(pageurl, proxyUrl);
      // fix the first token getting rejected: the challenge must be loaded with the solver's user-agent. switch to
      // the last one it used and let the client reload (nothing pending tells it to) instead of paying for a mismatch
      const solverUserAgent = this.getSolverUserAgent();
      if (!cached && solverUserAgent && this.userAgentFor(justnowSession, domain) !== solverUserAgent) {
        this.logger.debug(`(CFSolver./cloudflare-bulldozer) switching ${sessionId} on ${domain} to the solver's user-agent before solving`);
        this.setUserAgentFor(justnowSession, domain, solverUserAgent);
        this.stats.userAgentSwitches++;
        return;
      }
      if (cached) this.stats.cacheHits++;
      const solution = cached || await this.solve({
        sitekey, url: pageurl, data, pagedata, action, userAgent
      }, proxyUrl);
      if (solution) {
        this.logger.debug(`(CFSolver./cloudflare-bulldozer) found solution for ${sessionId}. url: ${pageurl}`);
        // give client the cookie, if session still exists by then
        if (sessionStore.has(sessionId)) {
          sessionStore.get(sessionId).cookies.setCookies([{
            domain,
            httpOnly: true,
            secure: true,
            expires: new Date(Date.now() + 31556926000), // 1 year from now, matching the cf_clearance cookie
            path: '/',
            sameSite: 'none',
            name: 'cf_clearance',
            value: solution.cookie
          }]);
          this.setUserAgentFor(sessionStore.get(sessionId), domain, solution.userAgent);
        } else {
          this.logger.debug(`(CFSolver./cloudflare-bulldozer) session gone before we could set the cookie. sessionId: ${sessionId}`);
        }
      } else {
        // errored out, failed, or is not a cloudflare page. just tell them to
        // reload in the next request
        this.logger.debug(`(CFSolver./cloudflare-bulldozer) failed to find solution for ${sessionId}. url: ${pageurl}`);
      }
    });
    // whether a page should let cloudflare's own widget try first ("try") or go straight to the solver ("skip")
    proxy.GET('/api/cloudflare-bulldozer-free', (req, res) => {
      const { sessionId, url } = new URLPath(req.url).getParams();
      const domain = parseRootDomain(url);
      if (!sessionId || !domain || !sessionStore.has(sessionId)) {
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      const skip = this.freeFailedFor(sessionStore.get(sessionId), domain);
      if (!skip) this.stats.freeTries++;
      res.end(skip ? 'skip' : 'try');
    });
    proxy.GET('/api/cloudflare-bulldozer-status', async (req, res) => {
      const { sessionId, url } = new URLPath(req.url).getParams();
      const domain = parseRootDomain(url);
      if (!sessionId || !domain || !sessionStore.has(sessionId)) {
        res.writeHead(400);
        res.end('bad request');
        return;
      }

      // possible things we tell the client: wait, reload, or "token: abcdefg..."

      const pending = this.pendingDomains.get(domain);
      if (pending) {

        // maybe? note: make sure it is the same user-agent/client, otherwise, we have just wasted our token
        // if (pending.waitingForCookie && !pending.waitingForCookie.sessionId && (req._rh_originalUA || req.headers["user-agent"]) === pending.waitingForCookie.userAgent) {
        
        if (pending.waitingForCookie && !pending.waitingForCookie.sessionId) {
          this.logger.debug(`(CFSolver./cloudflare-bulldozer-status) gave ${sessionId} the lucky token`);
          // lucky day for this client!
          this.setUserAgentFor(sessionStore.get(sessionId), domain, pending.waitingForCookie.userAgent);
          this.setSolverUserAgent(pending.waitingForCookie.userAgent);
          res.end('token: ' + pending.waitingForCookie.token);
          pending.waitingForCookie.sessionId = sessionId;
          return;
        } else {
          // just tell them to wait, solver is still on it
          res.end('wait');
          return;
        }
      } else {
        // stale request/set cookie in last request. just tell them to reload so we can restart the solving process again
        res.end('reload');
        return;
      }
    });
    proxy.GET('/api/cloudflare-bulldozer-response', async (req, res) => {
      const { sessionId, url, status } = new URLPath(req.url).getParams();
      const domain = parseRootDomain(url);
      if (!sessionId || !domain || !this.pendingDomains.get(domain)?.waitingForCookie || this.pendingDomains.get(domain).waitingForCookie.sessionId !== sessionId || !(status === 'success' || status === 'failed') || !sessionStore.has(sessionId)) {
        res.writeHead(400);
        res.end('bad request');
        return;
      }

      res.end('ok');

      const pendingDomains = this.pendingDomains.get(domain);
      if (status === 'success') {
        // at this point, we should be able to get the cf_clearance cookie from
        // the sessionId
        this.logger.debug(`(CFSolver./cloudflare-bulldozer-response) got success from client. url: ${url}`);
        const cookie = sessionStore.get(sessionId).cookies.getCookies([{ domain, name: 'cf_clearance' }]).filter(c => !!c.value)[0]?.value;

        if (cookie) {
          this.logger.debug(`(CFSolver./cloudflare-bulldozer-response) found golden cookie from session! sending it back to solver`);
          pendingDomains.waitingForCookie.callback(cookie);
        } else {
          this.logger.warn(`(CFSolver./cloudflare-bulldozer-response) didn't find cookie even though client said success. *potentially a bug*. sessionId: ${sessionId} url: ${url}`);
          pendingDomains.waitingForCookie.callback(null);
        }
      } else {
        this.logger.warn(`(CFSolver./cloudflare-bulldozer-response) client said token didn't work. url: ${url}`);
        pendingDomains.waitingForCookie.callback(null);
      }
    });
  }

  emptyStats() {
    // freeTries: challenges cloudflare's own widget got to try. freeFailed: of those, how many fell back to the solver.
    // solves: paid solver tasks. solveFailures: paid tasks that didn't produce a working cookie
    // gaveUp: solver requests turned away after too many failed solves on that site
    return { freeTries: 0, freeFailed: 0, cacheHits: 0, userAgentSwitches: 0, solves: 0, solveFailures: 0, gaveUp: 0 };
  }

  recentFailedSolves(domain) {
    return (this.failedSolves.get(domain) || []).filter(at => Date.now() - at < this.failedSolveWindow);
  }

  solverGaveUpOn(domain) {
    if (this.failedSolves.size > 10000) this.failedSolves.clear();
    return this.recentFailedSolves(domain).length >= this.maxFailedSolves;
  }

  takeStats() {
    const stats = this.stats;
    this.stats = this.emptyStats();
    return stats;
  }

  freeFailedFor(session, domain) {
    const until = session.data.cfFreeFailed && session.data.cfFreeFailed[domain];
    return !!until && until > Date.now();
  }

  // the solver's user-agent only for sessions that got (or are about to get) its cookie on this site. everyone else
  // keeps their own, so their free pass of the challenge isn't sent with a user-agent that doesn't match their browser
  userAgentFor(session, domain) {
    return (session.data.cfSolverUserAgents && session.data.cfSolverUserAgents[domain]) || null;
  }

  setUserAgentFor(session, domain, userAgent) {
    const userAgents = session.data.cfSolverUserAgents || {};
    // a session only visits so many cloudflare sites; keep the newest
    const domains = Object.keys(userAgents).filter(d => d !== domain);
    if (domains.length >= 50) delete userAgents[domains[0]];
    delete userAgents[domain];
    userAgents[domain] = userAgent;
    session.data.cfSolverUserAgents = userAgents;
  }

  /**
   * 
   * @param {string} url 
   * @param {string?} proxyUrl 
   * @returns {Promise<{ cookie: string, userAgent: string } | null>}
   */
  async solveCached(url, proxyUrl) {
    this.logger.debug('(CFSolver.solveCached) trying to get cached solution for ' + url + ' with proxyUrl ' + proxyUrl);
    const domain = parseRootDomain(url);
    if (this.getClearanceFor(domain, proxyUrl)) {
      if (await this.isCookieStillValidFor(url, proxyUrl)) {
        this.logger.debug('(CFSolver.solveCached) returning cached response for ' + url);
        return this.getClearanceFor(domain, proxyUrl);
      } else {
        this.logger.debug('(CFSolver.solveCached) solution expired for ' + domain);
        this.deleteClearanceFor(domain, proxyUrl);
        return null;
      }
    }
    this.logger.debug(`(CFSolver.solveCached) not found in cache`);
    return null;
  }

  /**
   * 
   * @param {{ url: string } & object} options 
   * @param {string?} proxyUrl 
   * @returns {Promise<{ cookie: string, userAgent: string } | null>}
   */
  async solve(options, proxyUrl) {
    const { url } = options;
    if (!url) {
      throw new TypeError('url must be specified');
    }

    const domain = parseRootDomain(url);

    this.logger.debug('(CFSolver.solve) received request to solve for ' + url);

    if (this.pendingDomains.has(domain)) {
      this.logger.debug('(CFSolver.solve) another thread is already solving it. waiting for solution. url: ' + url);
      await new Promise(resolve => {
        this.pendingDomains.get(domain).waitingCalbacks.push(resolve);
      });
      this.logger.debug('(CFSolver.solve) other thread resolved our promise. moving on!');

      return this.getClearanceFor(domain, proxyUrl);
    } else {
      this.pendingDomains.set(domain, {
        waitingCalbacks: []
      });

      const resolveCallbacks = () => {
        const pendingDomains = this.pendingDomains.get(domain);
        this.logger.debug(`(CFSolver.solve) resolving ${pendingDomains.waitingCalbacks.length} pending promises`);
        for (const cb of pendingDomains.waitingCalbacks) {
          cb();
        }
        this.pendingDomains.delete(domain);
        this.logger.debug(`(CFSolver.solve) done resolving promises`);
      };

      let returnVal = null;
      try {
        this.logger.debug('(CFSolver.solve) starting solving process. url: ' + url);
        this.stats.solves++;
        const result = await this.cfSolver(options);
        if (result) {
          this.logger.debug(`(CFSolver.solve) got solution ${JSON.stringify(result)} url: ${url}`);
          if (await this.isCookieStillValidFor(url, proxyUrl, result)) {
            this.logger.debug(`(CFSolver.solve) cookie is verified to work!`);
            this.setClearanceFor(domain, result.cookie, result.userAgent, proxyUrl);
            returnVal = this.getClearanceFor(domain, proxyUrl);
          } else {
            this.logger.warn(`(CFSolver.solve) cookie didn't work for url: ${url}`);
          }
        } else {
          this.logger.warn('(CFSolver.solve) solver returned null for ' + url);
          this.deleteClearanceFor(domain, proxyUrl);
        }
      } catch (e) {
        this.logger.error('(CFSolver.solve) solver threw an error for ' + url);
        this.logger.error('(CFSolver.solve) the following is the error message: ');
        this.logger.error(e);
      }

      if (!returnVal) {
        this.stats.solveFailures++;
        this.failedSolves.set(domain, [...this.recentFailedSolves(domain), Date.now()]);
      } else {
        this.failedSolves.delete(domain);
      }
      resolveCallbacks();
      return returnVal;
    }
  }

  async isCookieStillValidFor(url, proxyUrl, forceSpecificClearance = null) {
    const domain = parseRootDomain(url);

    const cfClearance = forceSpecificClearance || this.getClearanceFor(domain, proxyUrl);
    const timeoutDomains = this.recheckTimeoutDomains.get(domain);

    this.logger.debug(`(CFSolver.isCookieStillValidFor) forceCheck: ${!!forceSpecificClearance} url: ${url} proxyUrl: ${proxyUrl}`);

    if (!cfClearance) {
      // haven't gotten cookie yet
      this.logger.debug(`(CFSolver.isCookieStillValidFor) haven't gotten cookie yet for ${url}`);
      return false;
    }
    // fix other users hanging forever on a domain checked in the last recheckTimeout: reuse a finished check,
    // wait for one in progress. a forced check is for a new cookie, so it never reuses the old cookie's result
    if (timeoutDomains && !forceSpecificClearance) {
      if (timeoutDomains.checkResult === null) {
        this.logger.debug(`(CFSolver.isCookieStillValidFor) another thread already checking, waiting for completion. url: ${url}`);
        await new Promise(resolve => {
          timeoutDomains.waitingCallbacks.push(resolve);
        });
      }
      this.logger.debug(`(CFSolver.isCookieStillValidFor) returning cached response ${timeoutDomains.checkResult} for ${url}`);
      return timeoutDomains.checkResult;
    }
    if (timeoutDomains) clearTimeout(timeoutDomains.intervalId);

    const newTimeoutDomainsObj = {
      intervalId: -1, // we only set timeout after completion
      checkResult: null,
      waitingCallbacks: []
    };

    // lock check process from other threads
    this.recheckTimeoutDomains.set(domain, newTimeoutDomainsObj);
    const expireAfter = (ms) => {
      newTimeoutDomainsObj.intervalId = setTimeout(() => {
        if (this.recheckTimeoutDomains.get(domain) === newTimeoutDomainsObj) this.recheckTimeoutDomains.delete(domain);
      }, ms);
    };

    try {
      this.logger.debug('(CFSolver.isCookieStillValidFor) checking cf status for url ' + url + ' proxyUrl ' + proxyUrl);
      newTimeoutDomainsObj.checkResult = await doesCFCookieWork(url, cfClearance.cookie, cfClearance.userAgent, proxyUrl);
      expireAfter(this.recheckTimeout);
      this.logger.debug(`(CFSolver.isCookieStillValidFor) got ${newTimeoutDomainsObj.checkResult} for url ${url}`);
    } catch (e) {
      this.logger.error(`(CFSolver.isCookieStillValidFor) got an error while checking for url ${url}`);
      this.logger.error(`(CFSolver.isCookieStillValidFor) the following is the error`);
      this.logger.error(e);

      // fake that the cookie "works" for 5 seconds before checking again
      this.logger.debug(`(CFSolver.isCookieStillValidFor) faking true for 5 seconds before allowing retry again`);
      newTimeoutDomainsObj.checkResult = true;
      expireAfter(5000);
    }

    this.logger.debug(`(CFSolver.isCookieStillValidFor) resolving ${newTimeoutDomainsObj.waitingCallbacks.length} callbacks`);
    for (const cb of newTimeoutDomainsObj.waitingCallbacks) {
      cb();
    }

    this.logger.debug('(CFSolver.isCookieStillValidFor) returning ' + newTimeoutDomainsObj.checkResult);
    return newTimeoutDomainsObj.checkResult;
  }

  /**
   * 
   * @param {{ url: string, forceRefresh: boolean } & object} options 
   * @returns {Promise<{ cookie: string, userAgent: string }>}
   */
  async cfSolver(options) {
    throw new Error('need to implement');
  }

  ///// database functions /////

  // the user-agent the solver last solved with, kept on disk for other workers and restarts
  getSolverUserAgent() {
    const filePath = path.join(this.databaseFolder, 'solver.ua');
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() || null : null;
  }

  setSolverUserAgent(userAgent) {
    if (userAgent && userAgent !== this.getSolverUserAgent()) {
      fs.writeFileSync(path.join(this.databaseFolder, 'solver.ua'), userAgent, 'utf8');
    }
  }

  parseFile(domain, proxyUrl) {
    const filePath = this._getFilePath(domain, proxyUrl);
    if (!fs.existsSync(filePath)) return null;
    const rawFileContents = fs.readFileSync(filePath).toString('utf8');
    const fileContents = rawFileContents.split('\n');
    if (fileContents.length !== 2) {
      this.logger.warn('CFSolver parseFile(): corrupted file: ' + filePath + '. contents: ' + rawFileContents);
      return null;
    }
    return  { cookie: fileContents[0], userAgent: fileContents[1] };
  }

  checkDatabaseIntegrity() {
    // first line of file will be the cookie
    // second line of file will be the user agent
    // anything else and we got a corrupted file
    for (const file of fs.readdirSync(this.databaseFolder)) {
      if (!file.endsWith('.cfcc')) continue;
      const domain = file.slice(0, -5);
      this.parseFile(domain); // warnings should pop up if files are corrupted
    }
  }

  getClearanceFor(domain, proxyUrl) {
    return this.parseFile(domain, proxyUrl) || null;
  }

  setClearanceFor(domain, cfClearanceCookie, userAgent, proxyUrl) {
    fs.writeFileSync(this._getFilePath(domain, proxyUrl), `${cfClearanceCookie}\n${userAgent}`, 'utf8');
  }

  deleteClearanceFor(domain, proxyUrl) {
    if (fs.existsSync(this._getFilePath(domain, proxyUrl))) {
      fs.rmSync(this._getFilePath(domain, proxyUrl));
    }
  }

  _getFilePath(domain, proxyUrl) {
    // .cfcc for CloudFlare Clearance Cookie
    return path.join(this.databaseFolder, `${domain}${proxyUrl ? '-' + md5(proxyUrl).slice(8) : ''}.cfcc`);
  }
}

module.exports = RammerheadCloudflareGenericSolver;