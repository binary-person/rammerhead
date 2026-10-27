const crypto = require('crypto');

let cacheGet = async (_key) => {
    throw new TypeError('cannot cache get: must initialize cache settings first');
};
let cacheSet = async (_key, _value) => {
    throw new TypeError('cannot cache set: must initialize cache settings first');
};

// version cache keys so old rewrites don't survive updates — including the
// per-deployment settings (DEPLOY_SECRET), which change the rewrite bytes
const CACHE_VERSION = crypto
    .createHash('md5')
    .update(require('../../package.json').version + require('testcafe-hammerhead/package.json').version + (process.env.DEPLOY_SECRET || ''))
    .digest('hex')
    .slice(0, 8);

// js cache stats. RH_PERF_STATS=1 prints them on exit
const stats = {
    hits: 0,
    hitBytes: 0,
    // rewritten and cached
    misses: 0,
    missBytes: 0,
    missMs: 0,
    // rewritten, not cacheable (had session-specific urls)
    uncacheable: 0,
    uncacheableBytes: 0,
    uncacheableMs: 0,
    // served from the compressed cache
    encodedHits: 0,
    encodedHitBytes: 0
};
if (process.env.RH_PERF_STATS) process.on('exit', () => console.error('jsCacheStats ' + JSON.stringify(stats)));

/**
 * @param {import('../classes/RammerheadJSAbstractCache.js')} jsCache
 */
module.exports = async function (jsCache) {
    const md5 = (data) => crypto.createHash('md5').update(data).digest('hex');

    cacheGet = async (key) => await jsCache.get(CACHE_VERSION + md5(key));
    cacheSet = async (key, value) => {
        if (!value) return;
        await jsCache.set(CACHE_VERSION + md5(key), value);
    };
    // compressed output, base64 since the caches store strings
    const encodedGet = async (key) => {
        const value = await jsCache.get(CACHE_VERSION + 'e' + md5(key));
        return value === undefined ? undefined : Buffer.from(value, 'base64');
    };
    const encodedSet = async (key, buffer) => {
        if (!buffer || !buffer.length) return;
        await jsCache.set(CACHE_VERSION + 'e' + md5(key), buffer.toString('base64'));
    };
    require('./patchAsyncResourceProcessor').encodedScriptCache = {
        get: encodedGet,
        set: encodedSet,
        onHit: (bytes) => {
            stats.encodedHits++;
            stats.encodedHitBytes += bytes;
        }
    };
};

// patch ScriptResourceProcessor
// https://github.com/DevExpress/testcafe-hammerhead/blob/47f8b6e370c37f2112fd7f56a3d493fbfcd7ec99/src/processing/resources/script.ts#L21

const scriptProcessor = require('testcafe-hammerhead/lib/processing/resources/script');
// looked up at call time, so wrappers installed later (url shuffling, function sources) apply
const scriptModule = require('testcafe-hammerhead/lib/processing/script');
const { addPositionMap, addResourceSizes, MAX_SCRIPT } = require('./scriptPositions');
const { rememberOriginalSizes } = require('./resourceTiming');
const { updateScriptImportUrls } = require('testcafe-hammerhead/lib/utils/url');
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');

// fix big bundles with imports (discord's 12mb web.js) being rewritten on every visit: their urls are per session (and
// per shuffle dictionary), so they were never cached. scripts too big for a position map are cached with placeholders
// where the urls go, recorded with the replacer's arguments, and filled in for each session
const TEMPLATE = '\u0001rh-url-template\n';
const placeholder = (i) => 'rh-url-placeholder-' + i + '-c3f1';
const PLACEHOLDER_RE = /rh-url-placeholder-(\d+)-c3f1/g;

function recordingReplacer(urlReplacer, calls) {
    return function replace(...args) {
        urlReplacer.resetTrigger();
        const replaced = urlReplacer(...args);
        // hammerhead parses resolver('./') for the dynamic import base url (the site's url, not session-specific)
        if (!urlReplacer.didTrigger() || (args.length === 1 && args[0] === './')) return replaced;
        calls.push(args);
        return placeholder(calls.length - 1);
    };
}

function fillTemplate(template, calls, urlReplacer) {
    return template.replace(PLACEHOLDER_RE, (_, i) => urlReplacer(...calls[i]));
}

scriptProcessor.__proto__.processResource = async function processResource(script, ctx, _charset, urlReplacer) {
    if (!script) return script;
    rememberOriginalSizes(ctx, script);

    let processedScript = await cacheGet(script);

    if (processedScript && processedScript.startsWith(TEMPLATE)) {
        const newline = processedScript.indexOf('\n', TEMPLATE.length);
        const calls = JSON.parse(processedScript.slice(TEMPLATE.length, newline));
        stats.hits++;
        stats.hitBytes += script.length;
        const filled = fillTemplate(processedScript.slice(newline + 1), calls, urlReplacer);
        return addResourceSizes(script, filled, ctx.destResBody && ctx.destResBody.length);
    }

    if (!processedScript && script.length > MAX_SCRIPT) {
        const calls = [];
        const start = performance.now();
        const template = scriptModule.processScript(
            script,
            true,
            false,
            recordingReplacer(urlReplacer, calls),
            ctx.destRes.headers[BUILTIN_HEADERS.serviceWorkerAllowed],
            ctx.nativeAutomation
        );
        stats.misses++;
        stats.missBytes += script.length;
        stats.missMs += performance.now() - start;
        await cacheSet(script, TEMPLATE + JSON.stringify(calls) + '\n' + template);
        urlReplacer.resetTrigger();
        const filled = fillTemplate(template, calls, urlReplacer);
        return addResourceSizes(script, filled, ctx.destResBody && ctx.destResBody.length);
    }

    if (!processedScript) {
        urlReplacer.resetTrigger();
        const start = performance.now();
        processedScript = scriptModule.processScript(
            script,
            true,
            false,
            urlReplacer,
            ctx.destRes.headers[BUILTIN_HEADERS.serviceWorkerAllowed],
            ctx.nativeAutomation
        );
        processedScript = addPositionMap(script, processedScript);
        processedScript = addResourceSizes(script, processedScript, ctx.destResBody && ctx.destResBody.length);
        const ms = performance.now() - start;
        if (!urlReplacer.didTrigger()) {
            stats.misses++;
            stats.missBytes += script.length;
            stats.missMs += ms;
            await cacheSet(script, processedScript);
        } else {
            stats.uncacheable++;
            stats.uncacheableBytes += script.length;
            stats.uncacheableMs += ms;
        }
    } else {
        stats.hits++;
        stats.hitBytes += script.length;
        processedScript = updateScriptImportUrls(processedScript, ctx.serverInfo, ctx.session.id, ctx.windowId);
    }

    return processedScript;
};

module.exports.stats = stats;
