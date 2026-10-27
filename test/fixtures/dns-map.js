// preloaded into the proxy by cloudflare.test.js: the fake cloudflare domains resolve to the local fake site
const dns = require('dns');
const lookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
    if (/(^|\.)rhcf-[a-z]+\.com$/.test(hostname)) {
        if (typeof options === 'function') [callback, options] = [options, {}];
        if (options && options.all) return process.nextTick(callback, null, [{ address: '127.0.0.1', family: 4 }]);
        return process.nextTick(callback, null, '127.0.0.1', 4);
    }
    return lookup.apply(this, arguments);
};
