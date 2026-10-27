// test config with the 2captcha solver pointed at the fake 2captcha in cfsite.js. single port like production
const base = require('./config.js');
const RammerheadCloudflare2Captcha = require('../src/classes/RammerheadCloudflare2Captcha.js');
const RammerheadLogging = require('../src/classes/RammerheadLogging.js');
const { CAPTCHA_PORT } = require('./cfsite.js');

module.exports = {
    ...base,
    crossDomainPort: null,
    getServerInfo: () => ({ hostname: 'localhost', port: base.port, protocol: 'http:' }),
    // kept across proxy restarts by the test, like a worker restarting
    fileCacheSessionConfig: { ...base.fileCacheSessionConfig, saveDirectory: process.env.RH_TEST_SESSIONS_DIR },
    cloudflareSolver: new RammerheadCloudflare2Captcha({
        apiKey: 'test',
        apiUrl: `http://127.0.0.1:${CAPTCHA_PORT}`,
        databaseFolder: process.env.RH_TEST_CF_DIR,
        logger: new RammerheadLogging({ logLevel: process.env.RH_TEST_CF_LOG || 'error' })
    })
};
