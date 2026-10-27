// https://github.com/DevExpress/testcafe-hammerhead/blob/47f8b6e370c37f2112fd7f56a3d493fbfcd7ec99/src/processing/resources/index.ts

const url = require('url');
const crypto = require('crypto');
const pageProcessor = require('testcafe-hammerhead/lib/processing/resources/page');
const manifestProcessor = require('testcafe-hammerhead/lib/processing/resources/manifest');
const scriptProcessor = require('testcafe-hammerhead/lib/processing/resources/script');
const stylesheetProcessor = require('testcafe-hammerhead/lib/processing/resources/stylesheet');
const urlUtil = require('testcafe-hammerhead/lib/utils/url');
const { encodeContent, decodeContent } = require('testcafe-hammerhead/lib/processing/encoding');
const { platform } = require('os');

const IS_WIN = platform() === 'win32';
const DISK_RE = /^[A-Za-z]:/;
const RESOURCE_PROCESSORS = [pageProcessor, manifestProcessor, scriptProcessor, stylesheetProcessor];

module.exports.RESOURCE_PROCESSORS = RESOURCE_PROCESSORS;
// set by addJSDiskCache.js when a js cache is configured
module.exports.encodedScriptCache = null;
// optional (ctx) => string: responses that differ by it (an app rewriting per host) get their own cached copy
module.exports.encodedCacheVariant = null;
module.exports.hookRequestPipelineContext = require('testcafe-hammerhead/lib/request-pipeline/context/index');

function getResourceUrlReplacer(ctx) {
    // add flag for when toProxyUrl gets used, so we don't pollute the cache with hostname specific stuff
    let toProxyUrlTriggered = false;
    const urlReplacer = function urlReplacer(
        resourceUrl,
        resourceType,
        charsetAttrValue,
        baseUrl,
        isCrossDomain = false,
        isUrlsSet = false
    ) {
        if (isUrlsSet)
            return urlUtil.handleUrlsSet(
                urlReplacer,
                resourceUrl,
                resourceType,
                charsetAttrValue,
                baseUrl,
                isCrossDomain
            );

        if (!urlUtil.isSupportedProtocol(resourceUrl) && !urlUtil.isSpecialPage(resourceUrl)) return resourceUrl;

        if (IS_WIN && ctx.dest.protocol === 'file:' && DISK_RE.test(resourceUrl)) resourceUrl = '/' + resourceUrl;

        // NOTE: Resolves base URLs without a protocol ('//google.com/path' for example).
        baseUrl = baseUrl ? url.resolve(ctx.dest.url, baseUrl) : '';
        resourceUrl = urlUtil.processSpecialChars(resourceUrl);

        let resolvedUrl = url.resolve(baseUrl || ctx.dest.url, resourceUrl);

        if (!urlUtil.isValidUrl(resolvedUrl)) return resourceUrl;

        // NOTE: Script or <link rel='preload' as='script'>
        const isScriptLike = urlUtil.parseResourceType(resourceType).isScript;
        const charsetStr = charsetAttrValue || (isScriptLike && ctx.contentInfo.charset.get());

        resolvedUrl = urlUtil.ensureTrailingSlash(resourceUrl, resolvedUrl);

        if (!urlUtil.isValidUrl(resolvedUrl)) return resolvedUrl;

        toProxyUrlTriggered = true;
        return ctx.toProxyUrl(resolvedUrl, isCrossDomain, resourceType, charsetStr);
    };
    urlReplacer.resetTrigger = () => (toProxyUrlTriggered = false);
    urlReplacer.didTrigger = () => toProxyUrlTriggered;
    return urlReplacer;
}

require('testcafe-hammerhead/lib/processing/resources/index').process = async function process(ctx) {
    let { destResBody, contentInfo } = ctx;
    const { encoding, charset } = contentInfo;

    for (const processor of RESOURCE_PROCESSORS) {
        if (!processor.shouldProcessResource(ctx)) continue;

        // serve cached rewritten + compressed scripts (skips decompress, rewrite, recompress)
        const encodedCache = processor === scriptProcessor && !ctx.rhForward && module.exports.encodedScriptCache;
        const encodedKey =
            encodedCache &&
            [
                encoding,
                charset.get(),
                ctx.destRes.headers['service-worker-allowed'] || '',
                module.exports.encodedCacheVariant ? module.exports.encodedCacheVariant(ctx) : '',
                crypto.createHash('md5').update(destResBody).digest('hex')
            ].join('|');
        if (encodedCache) {
            const cached = await encodedCache.get(encodedKey);
            if (cached) {
                encodedCache.onHit(cached.length);
                return cached;
            }
        }

        const urlReplacer = getResourceUrlReplacer(ctx);

        if (pageProcessor === processor)
            await ctx.prepareInjectableUserScripts(ctx.eventFactory, ctx.session.injectable.userScripts);

        const decoded = await decodeContent(destResBody, encoding, charset);

        // @ts-ignore: Cannot invoke an expression whose type lacks a call signature
        const processed = await processor.processResource(decoded, ctx, charset, urlReplacer); // <-- add async support

        if (processed === pageProcessor.RESTART_PROCESSING) return await process(ctx);

        if (ctx.rhForward) {
            destResBody = await encodeContent(processed, encoding, charset);
        } else {
            const encoded = await encodeContent(processed, encoding, charset);
            // only when nothing session-specific is in it
            if (encodedCache && !urlReplacer.didTrigger() && !processed.includes(ctx.session.id)) {
                await encodedCache.set(encodedKey, encoded);
            }
            return encoded;
        }
    }

    return destResBody;
};
