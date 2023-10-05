const crypto = require('crypto');

let cacheGet = async (_key) => {
    throw new TypeError('cannot cache get: must initialize cache settings first');
};
let cacheSet = async (_key, _value) => {
    throw new TypeError('cannot cache set: must initialize cache settings first');
};

/**
 * 
 * @param {import('../classes/RammerheadJSAbstractCache.js')} jsCache 
 */
module.exports = async function (jsCache) {
    const md5 = (data) => crypto.createHash('md5').update(data).digest('hex');

    cacheGet = async (key) => await jsCache.get(md5(key));
    cacheSet = async (key, value) => {
        if (!value) return;
        await jsCache.set(md5(key), value);
    }
};

// patch ScriptResourceProcessor
// https://github.com/DevExpress/testcafe-hammerhead/blob/47f8b6e370c37f2112fd7f56a3d493fbfcd7ec99/src/processing/resources/script.ts#L21

const scriptProcessor = require('testcafe-hammerhead/lib/processing/resources/script');
const { processScript } = require('testcafe-hammerhead/lib/processing/script');
const { updateScriptImportUrls } = require('testcafe-hammerhead/lib/utils/url');
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');

scriptProcessor.__proto__.processResource = async function processResource(script, ctx, _charset, urlReplacer) {
    if (!script) return script;

    let processedScript = await cacheGet(script);

    if (!processedScript) {
        processedScript = processScript(
            script,
            true,
            false,
            urlReplacer,
            ctx.destRes.headers[BUILTIN_HEADERS.serviceWorkerAllowed],
            ctx.nativeAutomation
        );
        await cacheSet(script, processedScript);
    } else processedScript = updateScriptImportUrls(processedScript, ctx.serverInfo, ctx.session.id, ctx.windowId);

    return processedScript;
};
