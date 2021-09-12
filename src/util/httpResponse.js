const logger = require('./logger');

/**
 * @typedef {'badRequest'|'accessForbidden'} httpResponseTypes
 */

/**
 * @type {{[key in httpResponseTypes]: (req: import('http').IncomingMessage, res: import('http').ServerResponse, ip: string, msg: string) => void}}
 */
module.exports = {
    badRequest: (req, res, ip, msg) => {
        logger.error(`(httpResponse.badRequest) ${ip} ${req.url} ${msg}`);
        res.writeHead(400);
        res.end(msg);
    },
    accessForbidden: (req, res, ip, msg) => {
        logger.error(`(httpResponse.badRequest) ${ip} ${req.url} ${msg}`);
        res.writeHead(403);
        res.end(msg);
    }
};
