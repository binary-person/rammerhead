const cluster = require('cluster');
const exitHook = require('async-exit-hook');
const { RateLimiterClusterMaster } = require('rate-limiter-flexible');
const logger = require('./util/logger');
const startServer = require('./server');
const config = require('./config');
const config2 = require('./config2');
const multiConfig = require('./multi-config');

const generateGeneratePrefix = (prefix) => (level) =>
    `[${new Date().toISOString()}] (${prefix}) [${level.toUpperCase()}] `;

if (cluster.isMaster) {
    logger.generatePrefix = generateGeneratePrefix('master');

    if (config.rateLimitOptions) {
        new RateLimiterClusterMaster();
    }

    logger.info(`spawning ${multiConfig.workers} workers`);
    for (let i = 0; i < multiConfig.workers; i++) {
        cluster.fork();
    }

    exitHook((callback) => {
        logger.info('Shutting down workers');
        cluster.disconnect(() => {
            logger.info('Done');
            callback();
        });
    });
} else {
    logger.generatePrefix = generateGeneratePrefix(`worker ${cluster.worker.id}`);
    startServer(config, config2);
}
