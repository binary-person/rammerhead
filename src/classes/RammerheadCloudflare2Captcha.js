const http = require('http');
const https = require('https');
const streamToString = require("../util/streamToString.js");
const RammerheadCloudflareGenericSolver = require("./RammerheadCloudflareGenericSolver.js");
const parseRootDomain = require("../util/parseRootDomain.js");
const parseUrl = require('url').parse;

class RammerheadCloudflare2Captcha extends RammerheadCloudflareGenericSolver {
  /**
   * 
   * @param {{apiKey: string} & import("./RammerheadCloudflareGenericSolver.js").RammerheadCloudflareGenericSolverArguments} options
   */
  constructor({
    apiKey,
    // tests point this at a fake 2captcha
    apiUrl = 'https://api.2captcha.com',
    disableProxy = true,
    ...options
  }) {
    options.disableProxy = disableProxy;
    super(options);

    if (!apiKey) {
      throw new TypeError('apiKey must be specified');
    }
    // if (options.disableProxy) {
    //   throw new TypeError('must enable proxy');
    // }

    this.apiKey = apiKey;
    this.apiUrl = apiUrl;

    this.initialRun();
  }

  async initialRun() {
    // check balance and log it
    try {
      this.logger.info(`(2Captcha.initialRun) Current balance: $${(await this.getBalance()).balance}`);
    } catch (e) {
      this.logger.warn(`(2Captcha.initialRun) Could not get balance: ` + e);
    }
  }

  async cfSolver({ url, siteurl = null, sitekey, data, pagedata, action, userAgent }) {
    url = url || siteurl;
    if (!url) {
      throw new TypeError('url must be specified');
    }
    if (!sitekey) {
      throw new TypeError('sitekey must be specified');
    }
    if (!data) {
      throw new TypeError('data must be specified');
    }
    if (!pagedata) {
      throw new TypeError('pagedata must be specified');
    }
    if (!action) {
      throw new TypeError('action must be specified');
    }
    if (!userAgent) {
      throw new TypeError('userAgent must be specified');
    }

    const domain = parseRootDomain(url);

    this.logger.debug('(2Captcha.cfSolver) initiate solving for ' + url);

    const task = await this.createCFChallengeTask(sitekey, data, pagedata, url, action, userAgent);
    if (task.errorId) {
      this.logger.warn(`(2Captcha.cfSolver) 2captcha refused the task: ${task.errorCode} ${task.errorDescription || ''}`);
      return null;
    }
    const taskId = task.taskId;
    this.logger.debug(`(2Captcha.cfSolver) got taskId ${taskId} for url ${url}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = await this.getTaskResult(taskId);
      this.logger.debug(`(2Captcha.cfSolver) status for taskId ${taskId}: ${result.status}`);
      if (result.status !== 'processing') {
        if (result.status !== 'ready') {
          this.logger.warn(`(2Captcha.cfSolver) 2captcha returned an error: ${JSON.stringify(result)}`);
          return null;
        }
        this.logger.debug('(2Captcha.cfSolver) got solution for ' + url);
        this.logger.debug(`(2Captcha.cfSolver) waiting for client cookie`);
        const cookie = await new Promise(resolve => {
          this.pendingDomains.get(domain).waitingForCookie = {
            callback: resolve,
            sessionId: null,
            token: result.solution.token,
            userAgent: result.solution.userAgent
          };
          setTimeout(() => resolve('timed out'), 30000);
        });
        if (cookie === 'timed out') {
          this.logger.debug(`(2Captcha.cfSolver) client was too slow for ${url}`);
          return null;
        } else if (cookie) {
          this.logger.debug(`(2Captcha.cfSolver) got cf_clearance cookie from client for ${url}`);
          return { cookie, userAgent: result.solution.userAgent };
        } else {
          this.logger.warn(`(2Captcha.cfSolver) client says challenge failed for given token. url: ${url}`);
          // this is where we would report to 2Captcha, indicating that challenge failed
          // but it's okay. we're being nice today
          // (needs thorough testing before implementing or else I would get somebody/me banned on 2Captcha)
          return null;
        }
      }
    }
  }

  ///// 2captcha apis /////

  /**
   * 
   * @returns {Promise<{ balance: number, errorId: 0 }>}
   */
  async getBalance() {
    return await request(this.apiUrl + '/getBalance', 'POST', {
      "clientKey": this.apiKey
    });
  }

  /**
   * 
   * @param {string} site 
   * @returns {Promise<{ errorId: number, taskId?: number, errorCode?: string, errorDescription?: string }>}
   */
  async createCFChallengeTask(sitekey, data, pagedata, pageurl, action, userAgent) {
    if (!sitekey) {
      throw new TypeError('sitekey must be specified');
    }
    if (!data) {
      throw new TypeError('data must be specified');
    }
    if (!pagedata) {
      throw new TypeError('pagedata must be specified');
    }
    if (!pageurl) {
      throw new TypeError('pageurl must be specified');
    }
    if (!action) {
      throw new TypeError('action must be specified');
    }
    if (!userAgent) {
      throw new TypeError('userAgent must be specified');
    }
    return await request(this.apiUrl + '/createTask', 'POST', {
      "clientKey": this.apiKey,
      "task": {
        "type": this.disableProxy ? "TurnstileTaskProxyless" : "TurnstileTask",
        "websiteURL": pageurl,
        "websiteKey": sitekey,
        "action": action,
        "data": data,
        "pagedata": pagedata,
        // not a task parameter. challenge pages use the userAgent 2captcha returns instead
        ...(this.disableProxy ? {} : {
          "proxyType": "SOCKS5",
          "proxyAddress": this.publicProxyAddress,
          "proxyPort": this.publicProxyPort,
          "proxyLogin": this.proxyUsername,
          "proxyPassword": this.proxyPassword
        })
      }
    });
  }

  /**
   * 
   * @param {string} taskId 
   * @returns { Promise<{ errorId: number, status?: 'processing' | 'ready', solution?: { token: string, userAgent: string } }> }
   */
  async getTaskResult(taskId) {
    if (!taskId) {
      throw new TypeError('taskId must be specified');
    }
    return await request(this.apiUrl + '/getTaskResult', 'POST', {
      "clientKey": this.apiKey,
      "taskId": taskId
    });
  }
}

function request(url, method, body) {
  return new Promise((resolve, reject) => {
    (url.startsWith('http:') ? http : https).request({
      ...parseUrl(url),
      method
    }, async res => {
      const rawResponse = await streamToString(res)
      let json;
      try {
        json = JSON.parse(rawResponse);
      } catch (e) {
        reject(`unexpected non-json response from 2captcha. status code: ${res.statusCode}. response: ${rawResponse}`);
        return;
      }
      if (json.error_text) {
        reject(`unexpected error response from 2captcha. ${json.error_text}, ${json.request}`);
      }
      resolve(json);
    }).end(typeof body === 'object' && body !== null ? JSON.stringify(body) : body);
  });
}

module.exports = RammerheadCloudflare2Captcha;
