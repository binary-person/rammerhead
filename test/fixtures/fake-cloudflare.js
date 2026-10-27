// preloaded into the proxy by turnstile.test.js: challenges.cloudflare.com (or the hosts in
// RH_FAKE_HOSTS, comma separated) go to the local fake on 18443
const net = require('net');
const HOSTS = new Set((process.env.RH_FAKE_HOSTS || 'challenges.cloudflare.com').split(','));
const PORT = 18443;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const options = args[0];
    if (
        options &&
        typeof options === 'object' &&
        !Array.isArray(options) &&
        HOSTS.has(options.host) &&
        Number(options.port) === 443
    ) {
        args[0] = { ...options, host: '127.0.0.1', port: PORT };
    }
    return connect.apply(this, args);
};
