const config = require('../config');

/**
 *
 * @param {import('../classes/RammerheadProxy')} proxyServer
 */
module.exports = function setupPipeline(proxyServer) {
    // remove headers defined in config.js
    proxyServer.addToOnRequestPipeline((req, _res, _serverInfo, isRoute) => {
        if (isRoute) return; // only strip those that are going to the proxy destination website
        for (const eachHeader of config.stripClientHeaders) {
            delete req.headers[eachHeader];
        }
    });
    Object.assign(proxyServer.rewriteServerHeaders, config.rewriteServerHeaders);
};
