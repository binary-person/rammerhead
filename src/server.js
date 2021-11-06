const exitHook = require('async-exit-hook');
const RammerheadProxy = require('./classes/RammerheadProxy');
const addStaticDirToProxy = require('./util/addStaticDirToProxy');
const logger = require('./util/logger');
const RammerheadRateLimiter = require('./classes/RammerheadRateLimiter');
const generateId = require('./util/generateId');
const URLPath = require('./util/URLPath');
const httpResponse = require('./util/httpResponse');
const config = require('./config');
const config2 = require('./config2');

/**
 * @param {typeof config} config
 * @param {typeof config2} config2
 */
function startServer(config, config2) {
    const proxyServer = new RammerheadProxy({
        logger,
        loggerGetIP: config.getIP,
        bindingAddress: config.bindingAddress,
        port: config.port,
        crossDomainPort: config.crossDomainPort,
        ssl: config.ssl,
        getServerInfo: config.getServerInfo
    });

    // public static directory
    if (config.publicDir) {
        addStaticDirToProxy(proxyServer, config.publicDir);
    }

    // session store
    const sessionStore = config2.sessionStore;
    sessionStore.attachToProxy(proxyServer);

    // rate limiter
    if (config.rateLimitOptions) {
        const ratelimiter = new RammerheadRateLimiter(Object.assign({ getIP: config.getIP }, config.rateLimitOptions));
        ratelimiter.attachToProxy(proxyServer);
    }

    // remove headers defined in config.js
    proxyServer.addToOnRequestPipeline((req, _res, _serverInfo, isRoute) => {
        if (isRoute) return; // only strip those that are going to the proxy destination website
        for (const eachHeader of config.stripClientHeaders) {
            delete req.headers[eachHeader];
        }
    });
    Object.assign(proxyServer.rewriteServerHeaders, config.rewriteServerHeaders);

    // setup routes //
    const isNotAuthorized = (req, res) => {
        if (!config.password) return;
        const { pwd } = new URLPath(req.url).getParams();
        if (config.password !== pwd) {
            httpResponse.accessForbidden(req, res, config.getIP(req), 'bad password');
            return true;
        }
        return false;
    };
    proxyServer.GET('/newsession', (req, res) => {
        if (isNotAuthorized(req, res)) return;

        const id = generateId();
        sessionStore.add(id);
        res.end(id);
    });
    proxyServer.GET('/editsession', (req, res) => {
        if (isNotAuthorized(req, res)) return;

        let { id, httpProxy } = new URLPath(req.url).getParams();

        if (!id || !sessionStore.has(id)) {
            return httpResponse.badRequest(req, res, config.getIP(req), 'not found');
        }

        const session = sessionStore.get(id);

        if (httpProxy) {
            if (httpProxy.startsWith('http://')) {
                httpProxy = httpProxy.slice(7);
            }
            session.setExternalProxySettings(httpProxy);
        }

        res.end('Success');
    });
    proxyServer.GET('/deletesession', (req, res) => {
        if (isNotAuthorized(req, res)) return;

        const { id } = new URLPath(req.url).getParams();

        if (!id || !sessionStore.has(id)) {
            res.end('not found');
        }

        sessionStore.delete(id);
        res.end('Success');
    });
    proxyServer.GET('/sessionexists', (req, res) => {
        const id = new URLPath(req.url).get('id');
        if (!id) {
            httpResponse.badRequest(req, res, config.getIP(req), 'Must specify id parameter');
        } else {
            res.end(sessionStore.has(id) ? 'exists' : 'not found');
        }
    });
    proxyServer.GET('/mainport', (req, res) => {
        const serverInfo = config.getServerInfo(req);
        res.end(((serverInfo.port || '').toString()));
    });

    // cleanup unused session ids
    if (config2.unusedTimeout && config2.unusedInterval) {
        setInterval(() => {
            const list = sessionStore.keys();
            let deleteCount = 0;
            logger.debug(`(server) Going through ${list.length} sessions, cleaning all unused ones`);

            const now = Date.now();
            for (const sessionId of list) {
                const session = sessionStore.get(sessionId, false, false);
                if (session.lastUsed === session.createdAt && now - session.lastUsed > config2.unusedTimeout) {
                    sessionStore.delete(sessionId);
                    deleteCount++;
                    logger.debug(`(server) Deleted unused session ${sessionId}`);
                }
            }

            logger.debug(`(server) cleaned ${deleteCount} unused sessions`);
        }, config2.unusedInterval).unref();
    }

    // nicely close proxy server and save sessions to store before we exit
    exitHook(() => {
        logger.info(`(server) Received exit signal, closing proxy server`);
        proxyServer.close();
        logger.info('(server) Closed proxy server');
    });

    const formatUrl = (secure, hostname, port) => `${secure ? 'https' : 'http'}://${hostname}:${port}`;
    logger.info(
        `(server) Rammerhead proxy is listening on ${formatUrl(config.ssl, config.bindingAddress, config.port)}`
    );

    return proxyServer;
}

module.exports = startServer;

if (require.main === module) {
    startServer(config, config2);
}
