// pass content security policies through, rewritten for the proxy (see cspRewrite.js). hammerhead drops them,
// and pages can tell: eval, inline handlers, data: scripts and trusted types sinks all start working

const crypto = require('crypto');
const transforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms.js');
const pageProcessor = require('testcafe-hammerhead/lib/processing/resources/page.js');
const DomProcessor = require('testcafe-hammerhead/lib/processing/dom/index.js');
const { rewriteHeader, rewritePolicy, SCRIPTS, WORKERS, CONNECT } = require('./cspRewrite.js');

// an app can serve the engine's service urls under other paths; the CSP whitelist must name those or the browser
// blocks them (worker-src violation on /transport-worker.js). the app registers the mapper at boot; without one the
// originals are whitelisted
let mapServicePath = null;
const setServicePathMapper = (fn) => {
    mapServicePath = fn;
};

function cspOptions(ctx) {
    if (!ctx.rhCspNonce) ctx.rhCspNonce = crypto.randomBytes(16).toString('base64');
    const origins = [ctx.getProxyOrigin(false), ctx.getProxyOrigin(true)].filter((o, i, all) => all.indexOf(o) === i);
    let paths = null;
    const host = (ctx.req && ctx.req.headers.host || '').split(':')[0].toLowerCase();
    if (mapServicePath && host) {
        const map = (p) => mapServicePath(host, p) || p;
        paths = { scripts: SCRIPTS.map(map), workers: WORKERS.map(map), connect: CONNECT.map(map) };
    }
    return { origins, nonce: ctx.rhCspNonce, https: ctx.serverInfo.protocol === 'https:', hashes: ctx.rhCspHashes, paths };
}

// inline scripts allowed by hash: hammerhead rewrites them, so the rewritten text's hash is allowed too
const HASH_SOURCE = /'(sha256|sha384|sha512)-([A-Za-z0-9+/_-]+={0,2})'/gi;
const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const CSP_META = /<meta\b[^>]*>/gi;
function inlineScripts(html) {
    const scripts = [];
    for (const match of html.matchAll(INLINE_SCRIPT)) {
        if (/\bsrc\s*=/i.test(match[1]) || /hammerhead-shadow-ui/.test(match[1])) continue;
        // browsers hash the parsed text, newlines normalized
        scripts.push(match[2].replace(/\r\n?/g, '\n'));
    }
    return scripts;
}
function decodeAttr(value) {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
function digest(algorithm, text) {
    return crypto.createHash(algorithm).update(text, 'utf8').digest('base64');
}
function rewrittenHashes(original, processed, policies) {
    const sources = new Map();
    for (const policy of policies) {
        for (const match of String(policy).matchAll(HASH_SOURCE)) {
            const value = match[2].replace(/-/g, '+').replace(/_/g, '/');
            sources.set(match[1].toLowerCase() + '-' + value, match[0]);
        }
    }
    if (!sources.size) return null;
    const before = inlineScripts(original);
    const after = inlineScripts(processed);
    // can't pair them up (scripts in comments, odd markup): leave the policy as is
    if (before.length !== after.length) return null;
    const hashes = {};
    for (let i = 0; i < before.length; i++) {
        for (const algorithm of ['sha256', 'sha384', 'sha512']) {
            const source = sources.get(algorithm + '-' + digest(algorithm, before[i]));
            if (!source) continue;
            (hashes[source] = hashes[source] || []).push("'" + algorithm + '-' + digest(algorithm, after[i]) + "'");
        }
    }
    return Object.keys(hashes).length ? hashes : null;
}
function addHashesToMetas(html, hashes) {
    return html.replace(CSP_META, (tag) => {
        if (!/http-equiv\s*=\s*"?content-security-policy/i.test(tag)) return tag;
        return tag.replace(/(\scontent=")([^"]*)"/i, (all, start, policy) => {
            for (const source of Object.keys(hashes)) policy = policy.split(source).join(source + ' ' + hashes[source].join(' '));
            return start + policy + '"';
        });
    });
}

for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
    transforms.responseTransforms[name] = (src, ctx) => (src ? rewriteHeader(src, cspOptions(ctx)) : src);
}

// <meta> policies in pages. the dom processor has no request context, so it's set around page processing
let current = null;
const processMetaElement = DomProcessor.prototype._processMetaElement;
DomProcessor.prototype._processMetaElement = function (el, urlReplacer, pattern) {
    const httpEquiv = (this.adapter.getAttr(el, 'http-equiv') || '').toLowerCase();
    if (httpEquiv === 'content-security-policy' && current) {
        // the original stays readable to the page, like the client side does (see build.js)
        const policy = this.adapter.getAttr(el, 'content') || '';
        this.adapter.setAttr(el, DomProcessor.getStoredAttrName('content'), policy);
        this.adapter.setAttr(el, 'content', rewritePolicy(policy, current));
        return;
    }
    return processMetaElement.call(this, el, urlReplacer, pattern);
};

// hammerhead's own scripts carry the nonce we add to policies that need one
const OWN_SCRIPT = /<script(?=[^>]*\bclass="(?:self-removing-)?script-hammerhead-shadow-ui")/g;
const processPage = pageProcessor.processResource;
pageProcessor.processResource = function (html, ctx) {
    const previous = current;
    current = ctx && ctx.serverInfo ? cspOptions(ctx) : null;
    try {
        let result = processPage.apply(this, arguments);
        if (!current || typeof result !== 'string') return result;
        result = result.replace(OWN_SCRIPT, '<script nonce="' + current.nonce + '"');
        const policies = [];
        const headers = ctx.destRes && ctx.destRes.headers;
        if (headers) policies.push(headers['content-security-policy'], headers['content-security-policy-report-only']);
        for (const tag of String(html).match(CSP_META) || []) policies.push(tag);
        const hashes = typeof html === 'string' ? rewrittenHashes(html, result, policies.filter(Boolean)) : null;
        if (hashes) {
            ctx.rhCspHashes = hashes;
            result = addHashesToMetas(result, hashes);
        }
        // violation events report the policy the browser enforced; rammerhead.js maps it back to the site's
        const options = cspOptions(ctx);
        const pairs = [];
        for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
            for (const policy of headers && headers[name] ? String(headers[name]).split(',') : []) {
                pairs.push([rewritePolicy(policy, options), policy.trim()]);
            }
        }
        for (const tag of String(html).match(CSP_META) || []) {
            const content = /http-equiv\s*=\s*"?content-security-policy/i.test(tag) && /\scontent\s*=\s*"([^"]*)"/i.exec(tag);
            if (content) pairs.push([rewritePolicy(decodeAttr(content[1]), options), decodeAttr(content[1]).trim()]);
        }
        if (pairs.length) {
            const data = Buffer.from(JSON.stringify(pairs)).toString('base64');
            result = result.replace(/(<script nonce="[^"]*")(?=[^>]*\bsrc="[^"]*\/rammerhead\.js")/, '$1 data-rh-csp="' + data + '"');
        }
        return result;
    } finally {
        current = previous;
    }
};

module.exports = { cspOptions, setServicePathMapper };
