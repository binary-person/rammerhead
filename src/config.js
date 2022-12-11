const path = require('path');
const fs = require('fs');
const os = require('os');
const RammerheadJSMemCache = require('./classes/RammerheadJSMemCache.js');
const RammerheadJSFileCache = require('./classes/RammerheadJSFileCache.js');

const enableWorkers = os.cpus().length !== 1;

module.exports = {
    //// HOSTING CONFIGURATION ////

    bindingAddress: '127.0.0.1',
    port: 8080,
    crossDomainPort: 8081,
    publicDir: path.join(__dirname, '../public'), // set to null to disable

    // enable or disable multithreading
    enableWorkers,
    workers: os.cpus().length,

    // ssl object is either null or { key: fs.readFileSync('path/to/key'), cert: fs.readFileSync('path/to/cert') }
    // for more info, see https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener
    ssl: null,

    // this function's return object will determine how the client url rewriting will work.
    // set them differently from bindingAddress and port if rammerhead is being served
    // from a reverse proxy.
    getServerInfo: () => ({ hostname: 'localhost', port: 8080, crossDomainPort: 8081, protocol: 'http:' }),
    // example of non-hard-coding the hostname header
    // getServerInfo: (req) => {
    //     return { hostname: new URL('http://' + req.headers.host).hostname, port: 443, crossDomainPort: 8443, protocol: 'https: };
    // },

    // enforce a password for creating new sessions. set to null to disable
    password: 'sharkie4life',

    // disable or enable localStorage sync (turn off if clients send over huge localStorage data, resulting in huge memory usages)
    disableLocalStorageSync: false,

    // restrict sessions to be only used per IP
    restrictSessionToIP: true,

    // caching options for js rewrites. (disk caching not recommended for slow HDD disks)
    // recommended: 50mb for memory, 5gb for disk
    // jsCache: new RammerheadJSMemCache(5 * 1024 * 1024),
    jsCache: new RammerheadJSFileCache(path.join(__dirname, '../cache-js'), 5 * 1024 * 1024 * 1024, 50000, enableWorkers),

    //// REWRITE HEADER CONFIGURATION ////

    // removes reverse proxy headers
    // cloudflare example:
    // stripClientHeaders: ['cf-ipcountry', 'cf-ray', 'x-forwarded-proto', 'cf-visitor', 'cf-connecting-ip', 'cdn-loop', 'x-forwarded-for'],
    stripClientHeaders: [],
    // if you want to modify response headers, like removing the x-frame-options header, do it like so:
    // rewriteServerHeaders: {
    //     // you can also specify a function to modify/add the header using the original value (undefined if adding the header)
    //     // 'x-frame-options': (originalHeaderValue) => '',
    //     'x-frame-options': null, // set to null to tell rammerhead that you want to delete it
    // },
    rewriteServerHeaders: {},

    //// SESSION STORE CONFIG ////

    // see src/classes/RammerheadSessionFileCache.js for more details and options
    fileCacheSessionConfig: {
        saveDirectory: path.join(__dirname, '../sessions'),
        cacheTimeout: 1000 * 60 * 20, // 20 minutes
        cacheCheckInterval: 1000 * 60 * 10, // 10 minutes
        deleteUnused: true,
        staleCleanupOptions: {
            staleTimeout: 1000 * 60 * 60 * 24 * 3, // 3 days
            maxToLive: null,
            staleCheckInterval: 1000 * 60 * 60 * 6 // 6 hours
        },
        // corrupted session files happens when nodejs exits abruptly while serializing the JSON sessions to disk
        deleteCorruptedSessions: true,
    },

    //// LOGGING CONFIGURATION ////

    // valid values: 'disabled', 'debug', 'traffic', 'info', 'warn', 'error'
    logLevel: process.env.DEVELOPMENT ? 'debug' : 'info',
    generatePrefix: (level) => `[${new Date().toISOString()}] [${level.toUpperCase()}] `,

    // logger depends on this value
    getIP: (req) => req.socket.remoteAddress
    // use the example below if rammerhead is sitting behind a reverse proxy like nginx
    // getIP: req => (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim()
};

if (fs.existsSync(path.join(__dirname, '../config.js'))) Object.assign(module.exports, require('../config'));
