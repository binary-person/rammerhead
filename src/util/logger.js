const RammerheadLogging = require('../classes/RammerheadLogging');
const config = require('../config');

module.exports = new RammerheadLogging({
    logLevel: config.logLevel,
    generatePrefix: config.generatePrefix
});
