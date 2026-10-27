/**
 * Deployment cache tag.
 *
 * Rewritten resources (JS/CSS) are served under URLs that are stable per
 * (session, origin URL) and pass through origin cache headers — origins
 * happily send max-age=31536000. But the rewrite bytes depend on deployment
 * settings, so a change leaves browsers holding poisoned
 * rewrites under unchanged URLs for a year, with no revalidation.
 *
 * The tag is appended to every rewritten resource URL (see addUrlShuffling.js
 * server-side and src/client/rammerhead.js client-side) and stripped inbound
 * before any URL parsing, so a constant change = new URLs = global cache bust
 * with no user action. Derived from DEPLOY_SECRET, the per-deployment setting
 * that changes the rewrite bytes. null when unset (no tagging).
 */
const crypto = require('crypto');

const tag = process.env.DEPLOY_SECRET
    ? crypto.createHash('sha256').update('cache-tag|' + process.env.DEPLOY_SECRET).digest('hex').slice(0, 6)
    : null;

/** URL suffix marker. '!' is outside the shuffle alphabet and suffix-exact. */
const SUFFIX = tag ? '!v' + tag : null;

// at the end, or before a query or fragment: a GET form submits to its tagged action url with the browser putting
// the form's fields after it (".../search!v<tag>?q=a")
const strip = (url) => {
    if (!SUFFIX || typeof url !== 'string') return url;
    if (url.endsWith(SUFFIX)) return url.slice(0, -SUFFIX.length);
    const at = url.search(/[?#]/);
    if (at >= SUFFIX.length && url.slice(at - SUFFIX.length, at) === SUFFIX) return url.slice(0, at - SUFFIX.length) + url.slice(at);
    return url;
};

/** only http(s) resource urls get tagged; ws(s) parsing has no strip hook */
const append = (url) => {
    if (!SUFFIX || typeof url !== 'string' || url.endsWith(SUFFIX)) return url;
    if (/^wss?:/i.test(url)) return url;
    return url + SUFFIX;
};

module.exports = { tag, SUFFIX, strip, append };
