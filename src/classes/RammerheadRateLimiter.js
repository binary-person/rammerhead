const { RateLimiterMemory, BurstyRateLimiter, RateLimiterCluster } = require('rate-limiter-flexible');
const logger = require('../util/logger');

class RammerheadRateLimiter {
    /**
     * @param {object} options
     * @param {number} options.requestsPerSecond
     * @param {number} options.burst - this setting is an nginx style rate limiting. How this setting works is this
     * that if the user goes over the requestsPerSecond, it uses up the burst. if the "bucket" is depleted,
     * then the user is blocked. the bucket charges at a rate of requestsPerSecond
     * @param {string|null|undefined} options.useClusterStore - if true, it will use RateLimiterCluster for storing data
     * @param {(req: IncomingMessage) => string} options.getIP - the rate limiter depends on this to distinguish between users
     */
    constructor({
        requestsPerSecond = 100,
        burst = 500,
        useClusterStore = false,
        getIP = (req) => req.socket.remoteAddress
    }) {
        const MemoryOrClusterStorage = useClusterStore ? RateLimiterCluster : RateLimiterMemory;

        this.getIP = getIP;
        this.limiter = new BurstyRateLimiter(
            new MemoryOrClusterStorage({
                keyPrefix: 'cluster',
                points: requestsPerSecond,
                duration: 1
            }),
            new MemoryOrClusterStorage({
                keyPrefix: 'clusterburst',
                points: burst,
                duration: burst / requestsPerSecond
            })
        );
    }
    /**
     * @param {import('./RammerheadProxy')} proxy
     */
    attachToProxy(proxy) {
        if (proxy.rateLimiterActive) throw new TypeError('already added rate limiter');
        proxy.rateLimiterActive = true;

        proxy.addToOnUpgradePipeline(async (req, socket) => {
            if (await this._handler(req)) {
                socket.end('HTTP/1.1 429 Too Many Requests\n\n');
                return true;
            }
        });
        proxy.addToOnRequestPipeline(async (req, res, _serverInfo, _isRoute, isWebsocket) => {
            if (!isWebsocket && (await this._handler(req))) {
                // already handled by the above
                res.writeHead(429);
                res.end('429 Too many requests');
                return true;
            }
        });
    }
    /**
     * @private
     * @param {import('http').IncomingMessage} req
     * @returns {Promise<boolean>} - true for throttling
     */
    async _handler(req) {
        const ip = this.getIP(req);
        try {
            await this.limiter.consume(this.getIP(req));
            return false;
        } catch (e) {
            if (!('msBeforeNext' in e)) {
                throw e;
            }
            logger.warn(`(RateLimiter) throttling ${ip}`);
            return true;
        }
    }
}

module.exports = RammerheadRateLimiter;
