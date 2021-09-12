const cluster = require('cluster');
const path = require('path');

module.exports = {
    // valid values: 'disabled', 'debug', 'traffic', 'info', 'warn', 'error'
    logLevel: 'traffic',
    generatePrefix: (level) => `[${new Date().toISOString()}] [${level.toUpperCase()}] `,

    // if rammerhead is sitting behind a reverse proxy like nginx, then the logger and
    // the rate limiter will see the IP as 127.0.0.1. This option is to solve that issue.
    // the following is for hosting this directly
    getIP: (req) => req.socket.remoteAddress,
    // the following is for hosting it behind nginx. make sure it controls the header
    // IPs to avoid spoofing (in this case, 'x-forwarded-for'). customize the function as needed
    // loggerGetIP: req => (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim(),

    bindingAddress: '127.0.0.1',
    port: 8080,
    crossDomainPort: 8081,
    publicDir: path.join(__dirname, '../public'), // set to null to disable

    // ssl object is either null or { key: fs.readFileSync('path/to/key'), cert: fs.readFileSync('path/to/cert') }
    // for more info, see https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener
    ssl: null,

    // optional: enforce a password for creating new sessions
    password: null,

    // when running this behind a reverse proxy like cloudflare or nginx, they add unnecessary headers
    // that get sent to the proxied target. this is to remove such headers.
    // cloudflare example:
    // stripClientHeaders: ['cf-ipcountry', 'cf-ray', 'x-forwarded-proto', 'cf-visitor', 'cf-connecting-ip', 'cdn-loop'],
    stripClientHeaders: [],
    // sometimes, you want to embed the proxy in an iframe, so you would want to remove the x-frame-options header like so
    // rewriteServerHeaders: {
    //     // you can also specify a function to modify/add the header using the original value (undefined if adding the header)
    //     // 'x-frame-options': (originalHeaderValue) => '',
    //     'x-frame-options': null, // set to null to tell rammerhead that you want to delete it
    // },
    rewriteServerHeaders: {},

    // set to null to disable
    rateLimitOptions: {
        requestsPerSecond: 80,
        burst: 600, // takes burst/requestPerSecond to fill the burst bucket. if this is depleted, we throw an error
        useClusterStore: cluster.isWorker // if false, this will disable rate limit clustering and use own process memory
    },

    // this function's return object will determine how the client url rewriting will work.
    // set them differently from bindingAddress and port if rammerhead is being served
    // from a reverse proxy.
    // the following example is if you disabled the crossDomainPort
    // getServerInfo: (req) => {
    //     const { hostname, port } = new URL('http://' + req.headers.host);
    //     return {
    //         hostname,
    //         port,
    //         protocol: req.socket.encrypted ? 'https:' : 'http:'
    //     };
    // }
    // another example is setting the serverInfo to a certain value. this is especially
    // useful if you are using crossDomainPort, because you cannot rely on the Host header's port
    // value to always be what you expect (meaning the port could be a normal port or a crossDomainPort)
    getServerInfo: () => ({ hostname: 'localhost', port: 8080, crossDomainPort: 8081, protocol: 'http:' })
};

Object.assign(module.exports, require('../config'));
