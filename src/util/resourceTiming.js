// resource timing as the site would show it. through the proxy everything is same-origin, so pages saw
// cross-origin sizes and timings browsers hide without timing-allow-origin, and rewritten resources' sizes.
// each response carries an "rh" server-timing entry with the site's timing-allow-origin and original sizes;
// rammerhead.js applies it and hides the entry (see hideProxyFromPerformance)

const transforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms.js');

/**
 * remember a rewritten resource's original sizes on the request context
 * @param {object} ctx
 * @param {string} original - decoded original text
 */
function rememberOriginalSizes(ctx, original) {
    if (!ctx || typeof original !== 'string') return;
    const decoded = Buffer.byteLength(original, 'utf8');
    ctx.rhOriginalSizes = [decoded, ctx.destResBody ? ctx.destResBody.length : decoded];
}

const forced = transforms.forcedResponseTransforms;
const previous = forced['server-timing'];
forced['server-timing'] = (src, ctx) => {
    const value = previous ? previous(src, ctx) : src;
    if (!ctx || !ctx.destRes || !ctx.dest) return value;
    const meta = { t: ctx.destRes.headers['timing-allow-origin'] || '' };
    if (ctx.rhOriginalSizes) meta.s = ctx.rhOriginalSizes;
    const entry = 'rh;desc="' + Buffer.from(JSON.stringify(meta)).toString('base64') + '"';
    return value ? value + ', ' + entry : entry;
};

// stylesheets are rewritten too (scripts and pages call rememberOriginalSizes from their own wrappers)
const stylesheetProcessor = require('testcafe-hammerhead/lib/processing/resources/stylesheet.js');
const processStylesheet = stylesheetProcessor.processResource;
stylesheetProcessor.processResource = function (stylesheet, ctx) {
    rememberOriginalSizes(ctx, stylesheet);
    return processStylesheet.apply(this, arguments);
};

module.exports = { rememberOriginalSizes };
