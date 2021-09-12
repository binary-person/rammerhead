const os = require('os');

module.exports = {
    // rest of the config should be configured in config.js and config2.js
    workers: os.cpus().length
};
