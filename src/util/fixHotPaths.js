// cpu hotspots found with test/perf

// cache public suffix lookups (tough-cookie walks the whole list per request, ~14% cpu)
const pubsuffix = require('tough-cookie/lib/pubsuffix-psl');
const getPublicSuffix = pubsuffix.getPublicSuffix;
const suffixCache = new Map();
const SUFFIX_CACHE_MAX = 50000;
pubsuffix.getPublicSuffix = function (domain, options = {}) {
    const key = (options.allowSpecialUseDomain ? '1' : '0') + domain;
    let suffix = suffixCache.get(key);
    if (suffix === undefined) {
        suffix = getPublicSuffix(domain, options);
        if (suffixCache.size >= SUFFIX_CACHE_MAX) suffixCache.clear();
        suffixCache.set(key, suffix);
    }
    return suffix;
};

// skip debug logging every response body when debug is off (~5% cpu)
const logger = require('testcafe-hammerhead/lib/utils/logger');
const onSendResponseBody = logger.proxy.onSendResponseBody;
const debug = require(require.resolve('debug', { paths: [require.resolve('testcafe-hammerhead')] }));
logger.proxy.onSendResponseBody = function () {
    if (debug.enabled('hammerhead:proxy')) return onSendResponseBody.apply(this, arguments);
};
