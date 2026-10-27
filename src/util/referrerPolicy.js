// request headers as the browser would send them to the site: referrer policies (hammerhead replaces them
// with unsafe-url, so sites saw the full referring url everywhere, even cross-site) and sec-fetch-site

const transforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms.js');

const MAX_PAGES = 1000;
const POLICIES = new Set([
    'no-referrer',
    'no-referrer-when-downgrade',
    'same-origin',
    'origin',
    'strict-origin',
    'origin-when-cross-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url'
]);
const pagePolicies = new WeakMap(); // session -> Map(page url -> referrer policy)
const documentReferrers = new WeakMap(); // session -> Map(page url -> its document.referrer)

const stripHash = (url) => url.split('#')[0];
function remember(weak, session, key, value) {
    let map = weak.get(session);
    if (!map) weak.set(session, (map = new Map()));
    map.delete(key);
    map.set(key, value);
    if (map.size > MAX_PAGES) map.delete(map.keys().next().value);
}

// last recognized token wins, like browsers
function parsePolicy(header) {
    let policy;
    for (const token of String(header).split(',')) {
        const value = token.trim().toLowerCase();
        if (POLICIES.has(value)) policy = value;
    }
    return policy;
}

function effectiveReferrer(referrer, target, policy) {
    let from, to;
    try {
        from = new URL(referrer);
        to = new URL(target);
    } catch (e) {
        return referrer;
    }
    from.hash = '';
    from.username = '';
    from.password = '';
    const full = from.href;
    const origin = from.origin + '/';
    const sameOrigin = from.origin === to.origin;
    const downgrade = from.protocol === 'https:' && to.protocol !== 'https:';
    switch (policy) {
        case 'no-referrer':
            return '';
        case 'unsafe-url':
            return full;
        case 'origin':
            return origin;
        case 'same-origin':
            return sameOrigin ? full : '';
        case 'strict-origin':
            return downgrade ? '' : origin;
        case 'origin-when-cross-origin':
            return sameOrigin ? full : origin;
        case 'no-referrer-when-downgrade':
            return downgrade ? '' : full;
        default:
            // strict-origin-when-cross-origin, the browser default
            return sameOrigin ? full : downgrade ? '' : origin;
    }
}

const forwardReferer = transforms.requestTransforms.referer;
transforms.requestTransforms.referer = (src, ctx) => {
    const referer = forwardReferer(src, ctx);
    if (!referer) return referer;
    const policies = pagePolicies.get(ctx.session);
    const value = effectiveReferrer(referer, ctx.dest.url, policies && policies.get(stripHash(referer)));
    if (ctx.isPage) remember(documentReferrers, ctx.session, stripHash(ctx.dest.url), value);
    return value || undefined;
};

const replacePolicy = transforms.responseTransforms['referrer-policy'];
transforms.responseTransforms['referrer-policy'] = (src, ctx) => {
    const policy = parsePolicy(src);
    if (policy && ctx.isPage) remember(pagePolicies, ctx.session, stripHash(ctx.dest.url), policy);
    return replacePolicy(src, ctx);
};

// sec-fetch-site: to the browser every proxied request is same-origin, so sites saw "same-origin" even for
// a cross-site iframe or script. work it out from the requesting page's url instead
let registrableDomain;
try {
    const psl = require('psl');
    registrableDomain = (host) => psl.get(host) || host;
} catch (e) {
    registrableDomain = (host) => host.split('.').slice(-2).join('.');
}
function fetchSite(from, to) {
    let a, b;
    try {
        a = new URL(from);
        b = new URL(to);
    } catch (e) {
        return undefined;
    }
    if (a.origin === b.origin) return 'same-origin';
    return a.protocol === b.protocol && registrableDomain(a.hostname) === registrableDomain(b.hostname)
        ? 'same-site'
        : 'cross-site';
}
transforms.requestTransforms['sec-fetch-site'] = (src, ctx) => {
    // "none" (typed or bookmarked) stays; so does anything we can't place
    if (src === 'none' || !ctx.dest || !ctx.dest.referer) return src;
    return fetchSite(ctx.dest.referer, ctx.dest.url) || src;
};

// sec-fetch-dest: fix sites refusing framed visits (instagram serves its error page for "iframe"). a page loaded
// without hammerhead's iframe flag is top-level to the proxy, even when an embedder (rammerhead browser) frames it
transforms.requestTransforms['sec-fetch-dest'] = (src, ctx) => {
    if ((src === 'iframe' || src === 'frame') && ctx.dest && !ctx.dest.isIframe) return 'document';
    return src;
};

/**
 * @param {object} session
 * @param {string} pageUrl
 * @returns {string|undefined} what the page's document.referrer should be, if known
 */
function documentReferrerFor(session, pageUrl) {
    const map = documentReferrers.get(session);
    return map && pageUrl ? map.get(stripHash(pageUrl)) : undefined;
}

module.exports = { documentReferrerFor, effectiveReferrer, fetchSite };
