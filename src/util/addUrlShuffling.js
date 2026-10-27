// note to self: the reason why we simply cannot hook into the
// parseProxyurl/getProxyUrl util functions is because
// we don't have direct access to the sessionStore class,
// which gives us the needed shuffling dictionary to unshuffle/shuffle.
// we don't want to make this dependent on a sessionStore class though, because
// that would cause too many dependency issues + this would not act like a
// nice independent "patch" anymore. Hence, the very roundabout way
// of doing patching.

const RequestPipelineContext = require('testcafe-hammerhead/lib/request-pipeline/context');
const StrShuffler = require('./StrShuffler');
const getSessionId = require('./getSessionId');
const cacheTag = require('./deployCacheTag');

const replaceUrl = (url, replacer) => {
    //        regex:              https://google.com/    sessionid/   url
    return (url || '').replace(/^((?:[a-z0-9]+:\/\/[^/]+)?(?:\/[^/]+\/))([^]+)/i, function (_, g1, g2) {
        return g1 + replacer(g2);
    });
};

// unshuffle incoming url //
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');
const _dispatch = RequestPipelineContext.prototype.dispatch;
RequestPipelineContext.prototype.dispatch = function (openSessions) {
    // strip the deployment cache tag before any parsing/unshuffling
    this.req.url = cacheTag.strip(this.req.url);
    let sessionId = getSessionId(this.req.url);
    let session = sessionId && openSessions.get(sessionId);
    if (!session) {
        sessionId = getSessionId(cacheTag.strip(this.req.headers[BUILTIN_HEADERS.referer]));
        session = sessionId && openSessions.get(sessionId);
    }
    if (session && session.shuffleDict) {
        const shuffler = new StrShuffler(session.shuffleDict);
        this.req.url = replaceUrl(this.req.url, (url) => shuffler.unshuffle(url));
        if (getSessionId(this.req.headers[BUILTIN_HEADERS.referer]) === sessionId) {
            this.req.headers[BUILTIN_HEADERS.referer] = replaceUrl(this.req.headers[BUILTIN_HEADERS.referer], (url) =>
                shuffler.unshuffle(url)
            );
        }
    }

    return _dispatch.call(this, openSessions);
};

// shuffle rewritten proxy urls //
let disableShuffling = false; // for later use
const _toProxyUrl = RequestPipelineContext.prototype.toProxyUrl;
RequestPipelineContext.prototype.toProxyUrl = function (...args) {
    const proxyUrl = _toProxyUrl.apply(this, args);
    if (!this.session.shuffleDict || disableShuffling) return cacheTag.append(proxyUrl); // tag regardless

    const shuffler = new StrShuffler(this.session.shuffleDict);
    return cacheTag.append(replaceUrl(proxyUrl, (url) => shuffler.shuffle(url)));
};

// unshuffle when script processor runs because of the following code
// in https://github.com/DevExpress/testcafe-hammerhead/blob/29a73b4551a92825b6049eb49796f701b14730d7/src/processing/script/transform.ts#L133
// https://github.com/DevExpress/testcafe-hammerhead/blob/29a73b4551a92825b6049eb49796f701b14730d7/src/utils/url.ts#L231
const scriptProcessor = require('testcafe-hammerhead/lib/processing/script/index.js');
const _processScript = scriptProcessor.processScript;
scriptProcessor.processScript = function(...args) {
    const previousVal = disableShuffling;
    try {

        disableShuffling = true;
        const returnVal = _processScript(...args);

        disableShuffling = previousVal;
        return returnVal;
    } catch (e) {
        disableShuffling = previousVal;
        throw e;
    }
};

// unshuffle task.js referer header
const Proxy = require('testcafe-hammerhead/lib/proxy/index');
const __onTaskScriptRequest = Proxy.prototype._onTaskScriptRequest;
Proxy.prototype._onTaskScriptRequest = async function _onTaskScriptRequest(req, ...args) {
    const referer = req.headers[BUILTIN_HEADERS.referer];

    const sessionId = getSessionId(referer);
    const session = sessionId && this.openSessions.get(sessionId);
    if (session && session.shuffleDict) {
        const shuffler = new StrShuffler(session.shuffleDict);
        req.headers[BUILTIN_HEADERS.referer] = replaceUrl(req.headers[BUILTIN_HEADERS.referer], (url) =>
            shuffler.unshuffle(url)
        );
    }
    return __onTaskScriptRequest.call(this, req, ...args);
};

// don't shuffle action urls (because we don't get to control the rewriting when the user submits the form)
const DomProcessor = require('testcafe-hammerhead/lib/processing/dom/index');
const __processUrlAttrs = DomProcessor.prototype._processUrlAttrs;
DomProcessor.prototype._processUrlAttrs = function _processUrlAttrs(el, urlReplacer, pattern) {
    try {
        disableShuffling = pattern.urlAttr?.toLowerCase() === 'action';
        __processUrlAttrs.call(this, el, urlReplacer, pattern);
        disableShuffling = false;
    } catch (e) {
        disableShuffling = false;
        throw e;
    }
};
