const { Session } = require('testcafe-hammerhead');
const UploadStorage = require('testcafe-hammerhead/lib/upload/storage');
const generateId = require('../util/generateId');
const StrShuffler = require('../util/StrShuffler');
const { documentReferrerFor } = require('../util/referrerPolicy');
const { pageExtrasFor } = require('../util/scriptPositions');

// disable UploadStorage, a testcafe testing feature we do not need
const emptyFunc = () => {};
UploadStorage.prototype.copy = emptyFunc;
UploadStorage.prototype.get = emptyFunc;
UploadStorage.prototype.store = emptyFunc;

/**
 * wrapper for initializing Session with saving capabilities
 */
// the settings have to be in place when hammerhead starts: start() runs the storage wrappers and rammerhead.js
// (and its start listeners) right away, and merged after the task script's start() call they read the defaults.
// a one-time start() on the hammerhead object (rammerhead.js hooks the prototype's) adds them to start's settings,
// then runs afterStart. one %hammerhead% literal, for the deploy rename's counts
function rhBeforeStart(settings, afterStart) {
    return (
        ';(function () { var h = window["%hammerhead%"]; if (!h) return;' +
        ' h.start = function (initSettings) { delete h.start; Object.assign(initSettings, ' +
        JSON.stringify(settings) +
        '); var result = h.start.apply(this, arguments);' +
        afterStart +
        ' return result; }; })();\n'
    );
}

class RammerheadSession extends Session {
    static cloudflareSolverAttached = false;
    /**
     * optional, set by the app for custom storage key names: (host, sessionId) -> settings object with
     * rhStorageKeys / rhTransportQueueKey / rhCookieLetters. Null = the default names everywhere (the engine
     * clients' fallback literals).
     */
    static storageKeyDeriver = null;
    data = {};
    createdAt = Date.now();
    lastUsed = Date.now();

    /**
     * @param {object} options
     * @param {string} options.id
     * @param {boolean} options.dontConnectToData - used when we want to connect to data later (or simply don't want to)
     * @param {boolean} options.disableShuffling
     * @param {string[]} options.prependScripts
     */
    constructor({ id = generateId(), dontConnectToData = false, disableShuffling = false, prependScripts = [] } = {}) {
        super(['blah/blah'], {
            allowMultipleWindows: true,
            disablePageCaching: false
        });

        // necessary abstract methods for Session
        this.getIframePayloadScript = async () => '';
        this.getPayloadScript = async () => '';
        this.getAuthCredentials = () => ({});
        this.handleFileDownload = () => void 0;
        this.handlePageError = () => void 0;
        this.handleAttachment = () => void 0;
        // this.handlePageError = (ctx, err) => {
        //     console.error(ctx.req.url);
        //     console.error(err);
        // };

        // intellisense //
        /**
         * @type {{ host: string, hostname: string, bypassRules?: string[]; port?: string; proxyAuth?: string, authHeader?: string } | null}
         */
        this.externalProxySettings = null;
        /**
         * @type {{ host: string, hostname: string, bypassRules?: string[]; port?: string; proxyAuth?: string, authHeader?: string } | null}
         */
        this.overrideExternalProxySettings = null;

        // disable http2. error handling from http2 proxy client to non-http2 user is too complicated to handle
        // (status code 0, for example, will crash rammerhead)
        // UPDATE: so apparently, some websites *really* want you to make an http2 connection to them before you connect
        // to their websocket endpoint.
        // for example, web.whatsapp.com websockets throws a 400 error even though the request is identical, with/without http2.
        // so now, we undo the change we made that initially was to avoid the whole error mess and a potential source of memory leak.
        // (also we got the "last resort" error handling in addMoreErrorGuards.js so everything is fine)
        // this.isHttp2Disabled = () => true;
        if (global.rhDisableHttp2) { // globally set from RammerheadProxy.js
            this.disableHttp2();
        }

        this.injectable.scripts.push(...prependScripts);
        this.injectable.scripts.push('/rammerhead.js');

        this.id = id;
        this.shuffleDict = disableShuffling ? null : StrShuffler.generateDictionary();
        if (!dontConnectToData) {
            this.connectHammerheadToData();
        }

        // force forceProxySrcForImage to be true
        // see https://github.com/DevExpress/testcafe-hammerhead/blob/47f8b6e370c37f2112fd7f56a3d493fbfcd7ec99/src/session/index.ts#L166
        this.requestHookEventProvider.hasRequestEventListeners = () => true;

        this.onDeleteListeners = [];
    }

    /**
     * @param {boolean} dontCookie - set this to true if the store is using a more reliable approach to
     * saving the cookies (like in serializeSession)
     */
    connectHammerheadToData(dontCookie = false) {
        this._connectObjectToHook(this, 'createdAt');
        this._connectObjectToHook(this, 'lastUsed');
        this._connectObjectToHook(this, 'injectable');
        this._connectObjectToHook(this, 'externalProxySettings', 'externalProxySettings', () => {
            return this.overrideExternalProxySettings;
        });
        this._connectObjectToHook(this, 'shuffleDict');
        if (!dontCookie) this._connectObjectToHook(this.cookies._cookieJar.store, 'idx', 'cookies');
    }

    updateLastUsed() {
        this.lastUsed = Date.now();
    }
    /**
     * the storage key names merge snippet, shared
     * by the page task script and the iframe task template. about:blank frames
     * bootstrap from the TEMPLATE (IframeSandbox evals it with live cookie/
     * referer fills), not from the page's task script — without this, blank
     * frames would fall back to the historical storage constants while the
     * parent uses derived ones, splitting the site's storage in two.
     */
    _rhStorageSettings(serverInfo) {
        if (!RammerheadSession.storageKeyDeriver) return null;
        const host = String((serverInfo && serverInfo.hostname) || '').split(':')[0].toLowerCase();
        return host ? RammerheadSession.storageKeyDeriver(host, this.id) : null;
    }
    async getIframeTaskScriptTemplate(serverInfo) {
        const template = await super.getIframeTaskScriptTemplate(serverInfo);
        const derived = this._rhStorageSettings(serverInfo);
        if (!derived) return template;
        // hammerhead returns the template as a json string literal (it's pasted into the task script as one)
        return JSON.stringify(rhBeforeStart(derived, '') + JSON.parse(template));
    }
    // pass rammerhead settings to the page: its referrer under the site's referrer policy
    // (read by hammerhead's document.referrer), and whether a cloudflare solver exists
    async getTaskScript(opts) {
        const script = await super.getTaskScript(opts);
        const settings = { rhCloudflareSolver: RammerheadSession.cloudflareSolverAttached };
        const referrer = documentReferrerFor(this, opts.cookieUrl);
        if (referrer !== undefined) settings.rhReferrer = referrer;
        // storage key names from the app's deriver (storageKeyDeriver). The
        // storage wrappers initialize at page boot before any fetch can
        // complete, so this must ride the task script, not an api call.
        if (RammerheadSession.storageKeyDeriver) {
            const host = String((opts && opts.serverInfo && opts.serverInfo.hostname) || '').split(':')[0].toLowerCase();
            const derived = host ? RammerheadSession.storageKeyDeriver(host, this.id) : null;
            if (derived) Object.assign(settings, derived);
        }
        // inline script positions and the page's own sizes, keyed by the url stack traces and timing use
        const extras = pageExtrasFor(this, opts.cookieUrl);
        let registry = '';
        if (extras) {
            // keyed by the site's url: the page's proxy url gets shuffled after load, so entries and frames
            // may carry either form (lookups parse them, see rammerhead.js)
            const url = 'h.utils.url.parseProxyUrl(location.href).destUrl.split("#")[0]';
            if (extras.positions) registry += ' (h.rhPositions || (h.rhPositions = new Map())).set(' + url + ', ' + JSON.stringify(extras.positions) + ');';
            registry += ' (h.rhResourceSizes || (h.rhResourceSizes = new Map())).set(' + url + ', ' + JSON.stringify(extras.sizes) + ');';
        }
        // drop hammerhead's injected elements once they've run (anti-bot scripts walk the dom)
        const afterStart =
            registry +
            ' var nm = h.nativeMethods, els = nm.querySelectorAll.call(document, ".script-hammerhead-shadow-ui, .charset-hammerhead-shadow-ui");' +
            ' for (var i = 0; i < els.length; i++) if (els[i].parentNode) nm.removeChild.call(els[i].parentNode, els[i]);';
        return rhBeforeStart(settings, afterStart) + script;
    }
    serializeSession() {
        return JSON.stringify({
            data: this.data,
            serializedCookieJar: this.cookies.serializeJar()
        });
    }
    // hook system and serializing are for two different store systems
    static DeserializeSession(id, serializedSession) {
        const parsed = JSON.parse(serializedSession);
        if (!parsed.data) throw new Error('expected serializedSession to contain data object');
        if (!parsed.serializedCookieJar)
            throw new Error('expected serializedSession to contain serializedCookieJar object');

        const session = new RammerheadSession({ id, dontConnectToData: true });
        session.data = parsed.data;
        session.connectHammerheadToData(true);
        session.cookies.setJar(parsed.serializedCookieJar);
        return session;
    }

    /**
     * 
     * @param {() => void} callback 
     */
    onDelete(callback) {
        this.onDeleteListeners.push(callback);
    }

    /**
     * 
     * @param {() => void} callback 
     */
    removeOnDelete(callback) {
        const idx = this.onDeleteListeners.indexOf(callback);
        if (idx !== -1) this.onDeleteListeners.splice(idx, 1);
    }

    runOnDeleteCallbacks() {
        for (const cb of this.onDeleteListeners) {
            try {
                cb();
            } catch (e) {
                console.error(e);
            }
        }
    }

    /**
     * @private
     */
    _connectObjectToHook(obj, prop, dataProp = prop, getOverride = (_data) => {}) {
        const originalValue = obj[prop];
        Object.defineProperty(obj, prop, {
            get: () => getOverride(this.data[dataProp]) || this.data[dataProp],
            set: (value) => {
                this.data[dataProp] = value;
            }
        });
        if (!(dataProp in this.data)) {
            this.data[dataProp] = originalValue;
        }
    }
}

module.exports = RammerheadSession;
