require('dotenv-flow').config();

const path = require('path');
const fs = require('fs');
const UglifyJS = require('uglify-js');
const rhLazyOptionalChainKey = require('./util/lazyOptionalChainKey');
const rhWindowLiteral = require('./util/rewriteWindowLiteral');
// the worker header's importScripts() call, as it appears in the client hammerhead.js source
const WORKER_IMPORT_URL = String.raw`(location.origin || (location.protocol + \"//\" + location.host)) + \"").concat(SERVICE_ROUTES.workerHammerhead, "\"`;
const WORKER_IMPORT_LINE = 'importScripts(' + WORKER_IMPORT_URL + ');';
const WORKER_POLICY = '\\"hammerhead|trusted-policy\\"';
const WORKER_IMPORT_TRUSTED =
    'var rhUrl = ' + WORKER_IMPORT_URL + ';' +
    ' if (self.trustedTypes && self.trustedTypes.createPolicy && !self[' + WORKER_POLICY + ']) try {' +
    ' Object.defineProperty(self, ' + WORKER_POLICY + ', { value: self.trustedTypes.createPolicy(\\"hammerhead\\", { createScriptURL: function (s) { return s; }, createScript: function (s) { return s; } }) });' +
    ' } catch (e) {}' +
    ' importScripts(self[' + WORKER_POLICY + '] ? self[' + WORKER_POLICY + '].createScriptURL(rhUrl) : rhUrl);';

// this is for future-proofing updates if hammerhead.js code changes
/**
 *
 * @param {string} str
 */
const throwOnUnmodifiedReplacers = function (str) {
    const obj = {
        replace(...args) {
            const before = str;
            str = str.replace(...args);
            if (str === before) {
                console.error(args);
                throw new Error('replacer did not do anything. see above for replacer arguments');
            }
            return obj;
        },
        toString() {
            return str;
        }
    };
    return obj;
};

// modify unmodifable items that cannot be hooked in rammerhead.js
fs.writeFileSync(
    path.join(__dirname, './client/hammerhead.js'),
    throwOnUnmodifiedReplacers(
        fs.readFileSync(path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/hammerhead.js'), 'utf8')
    )
        // fix iframing proxy issue.
        // we replace window.top comparisons with the most upper window that's still a proxied page
        .replace(/(window|win|wnd|instance|opener|activeWindow)\.top/g, '$1.rammerheadTop')
        .replace(/window\.parent/g, 'window.rammerheadParent')
        .replace(/window\.location\.ancestorOrigins/g, 'window.rammerheadAncestorOrigins')
        // part of fix for iframing issue (we replace it here so our own variables like window.top don't get replaced)
        .replace(
            '(function initHammerheadClient () {',
            '(function initHammerheadClient () {' +
                'if (window["%is-hammerhead%"]) throw new TypeError("already ran"); window["%is-hammerhead%"] = true;' +
                'window.rammerheadTop = (function() {var w = window; while (w !== w.top && (function() { try { return w.parent["%hammerhead%"] } catch(e) { return undefined } })()) w = w.parent; return w;})();' +
                'window.rammerheadParent = window.rammerheadTop === window ? window : window.parent;' +
                'window.distanceRammerheadTopToTop = (function() { var i=0,w=window; while (w !== window.top) {i++;w=w.parent} return i; })();' +
                'window.rammerheadAncestorOrigins = Array.from(location.ancestorOrigins).slice(0, -window.distanceRammerheadTopToTop);' +
                'window.isWindowBeyondRammerhead = function(win) { return win === window.top || win === window.parent };' +
                'window.__rhget$Top = function(top) { return window.top === top ? window.rammerheadTop : top; };' +
                'window.__rhget$Parent = function(parent) { return window.parent === parent ? window.rammerheadParent : parent; };' +
                // internal frameElement reads use the native getter, so a page's own getter (a tripwire) isn't triggered
                'var rhNativeFrameElementGetter = (function() { for (var o = window; o; o = Object.getPrototypeOf(o)) { var d = Object.getOwnPropertyDescriptor(o, "frameElement"); if (d) return d.get; } })();' +
                'var rhFrameElementOf = function(w) { try { return rhNativeFrameElementGetter ? rhNativeFrameElementGetter.call(w) : w.frameElement; } catch (e) { try { return w.frameElement; } catch (e2) { return null; } } };' +
                'var rhDestOrigin = function(w) { try { var p = window["%hammerhead%"].utils.url.parseProxyUrl(w.location.href); return p ? new URL(p.destUrl).origin : null; } catch (e) { return null; } };' +
                // like the real web: null in rammerhead's top, and when the parent is on another site
                'var rhVisibleFrameElement = function(w) { var el = rhFrameElementOf(w); if (!el || w === w.rammerheadTop) return null; var mine = rhDestOrigin(w), theirs = rhDestOrigin(w.parent); return mine && theirs && mine !== theirs ? null : el; };' +
                'window.__rhget$FrameElement = function(frameElement) { return rhFrameElementOf(window) === frameElement ? rhVisibleFrameElement(window) : frameElement; };' +
                'window.__rhget$IM = function(meta) {var destUrl = window["%hammerhead%"].utils.url.parseProxyUrl(meta.url).destUrl; return { ...meta, url: destUrl, resolve: new Proxy(meta.resolve, { apply(t, tArg, args) { return (new URL(args[0], destUrl)).href } }) }};\n'
        )
        // now we replace the __get$ where the destination window tries to get the top window
        // this case handles a direct attempt to go to window using window.top, rewriting window.top to window.window.
        // .replace(
        //     '_propertyGetter = function (owner, propName, optional) {',
        //     '$& if (propName === "top" && window === owner) propName = "window";'
        // )
        // this case handles any attempts that leak through the initial check. this is cached because it hinders performance greatly
        // .replace(
        //     'return owner[propName];',
        //     'var val = owner[propName]; return (function(){return (window.rhCacheDoIframeFix = typeof window.rhCacheDoIframeFix==="boolean"?window.rhCacheDoIframeFix:[].includes((new URL(get$$2())).hostname))})() && window.isWindowBeyondRammerhead(val) ? window.rammerheadTop : val;'
        // )
        // .replace(
        //     '_propertySetter = function (owner, propName, value) {',
        //     '$& if ((function(){return (window.rhCacheDoIframeFix = typeof window.rhCacheDoIframeFix==="boolean"?window.rhCacheDoIframeFix:["www.youtube.com", "m.youtube.com"].includes((new URL(get$$2())).hostname))})() && window.isWindowBeyondRammerhead(owner)) owner = window.rammerheadTop;'
        // )
        .replace(
            'isCrossDomainParent = parentLocationWrapper === parentWindow.location',
            'isCrossDomainParent = parentLocationWrapper === parentWindow.location || !parentWindow["%hammerhead%"]'
        )
        .replace(
            '!sameOriginCheck(window1Location, window2Location)',
            '!(sameOriginCheck(window1Location, window2Location) && (!!window1["%is-hammerhead%"] === !!window2["%is-hammerhead%"]))'
        )
        // return false when unable to convert properties on other windows to booleans (!)
        .replace(
            /!(parent|parentWindow|window1|window2|window\.top)\[("%(?:is-)?hammerhead%")]/g,
            '!(() => { try{ return $1[$2]; }catch(error){ return true } })()'
        )

        // disable saving to localStorage as we are using a completely different implementation
        .replace('saveToNativeStorage = function () {', 'saveToNativeStorage = function () {return;')

        // expose the cookie sync-type map so the task
        // settings can rename the s/c/w sync letters at runtime (applyCookieSyncLetters
        // in rammerhead.js); the static regex stays the fallback for the canonical letters
        .replace(
            'var SYNCHRONIZATION_TYPE_RE = new RegExp("^[".concat(SYNCHRONIZATION_TYPE.server).concat(SYNCHRONIZATION_TYPE.client).concat(SYNCHRONIZATION_TYPE.window, "]+"));',
            'window.__rhCookieSyncType = SYNCHRONIZATION_TYPE; $&'
        )
        .replace(/\.replace\(SYNCHRONIZATION_TYPE_RE, newSyncTypeStr\)/g, '.replace(window.__rhCookieSyncTypeRE || SYNCHRONIZATION_TYPE_RE, newSyncTypeStr)')

        // the transport queue key can come from the task settings instead of being the bare session id (fallback:
        // the session id, as before)
        .replace(/nativeMethods\.(storageGetItem|storageSetItem)\.call\(nativeLocalStorage, settings\$1\.get\(\)\.sessionId/g, (match, method) =>
            `nativeMethods.${method}.call(nativeLocalStorage, settings$1.get().rhTransportQueueKey || settings$1.get().sessionId`
        )

        // prevent calls to elements on a closed iframe
        .replace('dispatchEvent: function () {', '$& if (!window) return null;')
        .replace('click: function () {', '$& if (!window) return null;')
        .replace('setSelectionRange: function () {', '$& if (!window) return null;')
        .replace('select: function () {', '$& if (!window) return null;')
        .replace('focus: function () {', '$& if (!window) return null;')
        .replace('blur: function () {', '$& if (!window) return null;')
        .replace('preventDefault: function () {', '$& if (!window) return null;')

        // expose hooks for rammerhead.js
        .replace(
            'function parseProxyUrl$1',
            'window.overrideParseProxyUrl = function(rewrite) {parseProxyUrl$$1 = rewrite(parseProxyUrl$$1)}; $&'
        )
        .replace(
            'function getProxyUrl$1',
            'window.overrideGetProxyUrl = function(rewrite) {getProxyUrl$$1 = rewrite(getProxyUrl$$1)}; $&'
        )
        .replace('return context.window.location.search;', 'return (new URL(get$$2())).search;')
        .replace('return context.window.location.hash;', 'return (new URL(get$$2())).hash;')
        .replace(
            'setter: function (search) {',
            '$& var url = new URL(get$$2()); url.search = search; window.location = convertToProxyUrl(url.href); return search;'
        )
        .replace(
            'setter: function (hash) {',
            '$& var url = new URL(get$$2()); url.hash = hash; window.location.hash = (new URL(convertToProxyUrl(url.href))).hash; return hash;'
        )

        // part of the fix for rewriteTargetAttributeToSelf.js
        .replace(
            'var newTarget = getCorrectedTargetForSinglePageMode(value);',
            'var newTarget = currentTarget === "_top" ? (isElementInIframe(el) ? "_parent" : "_self") : value;'
        )

        // fix "Cannot redefine property: __call$" (breaks cloudflare turnstile). a script's var got there first
        .replace(
            'var nativeMethods = new NativeMethods();',
            '$&\n\tfunction defineInstruction(win, name, desc) { try { nativeMethods.objectDefineProperty(win, name, desc); } catch (e) { if (!("value" in desc)) throw e; win[name] = desc.value; } }' +
                '\n\tfunction defineInstructions(win, descs) { for (var name in descs) defineInstruction(win, name, descs[name]); }'
        )
        .replace('nativeMethods.objectDefineProperties(window, (_a = {},', 'defineInstructions(window, (_a = {},')
        .replace(/nativeMethods\.objectDefineProperty\(window, SCRIPT_PROCESSING_INSTRUCTIONS\./g, 'defineInstruction(window, SCRIPT_PROCESSING_INSTRUCTIONS.')

        // only unwrap messages hammerhead wrapped (cloudflare's turnstile broke posting a fail code)
        .replace('data.type !== MessageType.Service && isWindow(target)', '$& && data.type?.startsWith("hammerhead|")')

        // fix postMessage(msg, { targetOrigin, transfer }) dropping the transfer list (breaks cloudflare challenges)
        .replace(
            'var targetUrl = args[1] || getOriginHeader();',
            "if (args[1] && typeof args[1] === 'object') args = [args[0], args[1].targetOrigin, args[1].transfer || []]; $&"
        )
        // script-less frames can't unwrap hammerhead's messages: post the page's own message, with the browser's origin check
        .replace(
            /args\[1\] = '\*';\s+args\[0\] = MessageSandbox\._wrapMessage\(MessageType\.User, args\[0\], targetUrl\);/,
            "if (rhScriptsBlockedFor(contentWindow)) {\n            var rhSite = null;\n            try { rhSite = contentWindow.__get$(contentWindow, 'location').origin; } catch (e) {}\n            var rhTarget = args[1] || '/';\n            if (rhTarget !== '*' && rhSite !== (rhTarget === '/' ? getOriginHeader() : (function () { try { return new nativeMethods.URL(rhTarget).origin; } catch (e) { return null; } })()))\n                return;\n            args[1] = '*';\n            return fastApply(contentWindow, 'postMessage', args);\n        }\n        $&"
        )

        // part of fix for lazyOptionalChainKey.js
        .replace(
            'run: function (node) { return createComputedPropertyGetWrapper(node.property, node.object, node.optional); },',
            () =>
                'run: function (node) { return (' +
                rhLazyOptionalChainKey.toString() +
                ')(node, createComputedPropertyGetWrapper) || createComputedPropertyGetWrapper(node.property, node.object, node.optional); },'
        )

        // fix scripts set via script.textContent/innerText skipping rewriting. newer chrome defines both on
        // HTMLScriptElement.prototype, shadowing hammerhead's overrides on Node/HTMLElement
        .replace('this.overrideTextContentInNode();', '$& this.rhOverrideScriptTextProps();')
        .replace(
            '    WindowSandbox.removeProcessingInstructions = function (text) {',
            "    WindowSandbox.prototype.rhOverrideScriptTextProps = function () {\n" +
                "        var win = this.window;\n" +
                // innerText would turn the rewritten script's newlines into <br>s; its text goes in as textContent
                "        var textDesc = nativeMethods.objectGetOwnPropertyDescriptor(win.HTMLScriptElement.prototype, 'textContent');\n" +
                "        ['textContent', 'innerText'].forEach(function (prop) {\n" +
                "            var desc = nativeMethods.objectGetOwnPropertyDescriptor(win.HTMLScriptElement.prototype, prop);\n" +
                "            if (!desc || !desc.set) return;\n" +
                "            overrideDescriptor(win.HTMLScriptElement.prototype, prop, {\n" +
                "                getter: function () { return WindowSandbox.removeProcessingInstructions(desc.get.call(this)); },\n" +
                "                setter: function (value) { var processed = WindowSandbox.processTextPropValue(this, value); domMutationTracker.onChildrenChanged(this); (prop === 'innerText' && textDesc ? textDesc : desc).set.call(this, rhSinkValue(processed, value)); },\n" +
                "            });\n" +
                "        });\n" +
                "    };\n$&"
        )

        // fix module workers crashing on importScripts() (not allowed in modules). fall back to import(),
        // and put the worker settings on self since a module's var isn't global
        .replace('var ".concat(SCRIPT_PROCESSING_INSTRUCTIONS.getWorkerSettings', 'self.".concat(SCRIPT_PROCESSING_INSTRUCTIONS.getWorkerSettings')
        // and under a trusted types csp, through hammerhead's policy (see util/fixModuleWorkers.js), inside this string
        .replace(WORKER_IMPORT_LINE, () => 'try { ' + WORKER_IMPORT_TRUSTED + ' } catch (e) { (async function () { await import(' + WORKER_IMPORT_URL + '); })(); }')

        // part of fix for lazyOptionalChainKey.js (chain continuations)
        .replace(
            'var TRANSFORMERS = [',
            (match) => match + ' ...(' + rhLazyOptionalChainKey.rhChainContinueTransformers.toString() + ')(),'
        )

        // part of fix for rewriteWindowLiteral.js (the same transformer, so the client and server can't drift apart) and
        // rewriteImportMeta.js (manually minified by minify-js.com)
        .replace(
            'var TRANSFORMERS = [',
            () => 'var TRANSFORMERS = [ {name:"rh-get",nodeReplacementRequireTransform:!1,nodeTypes:"Identifier",condition:' +
                rhWindowLiteral.condition.toString() + ',run:' + rhWindowLiteral.run.toString() + '},' +
                '{name:"rh-im",nodeReplacementRequireTransform:!1,nodeTypes:"MetaProperty",condition:(e,r)=>"import"===e.meta.name&&"meta"===e.property.name,run:function(e){const r=createIdentifier("__rhget$IM");return createSimpleCallExpression(r,[e])}},'
        )

        // part of fix for rewriteTopWindowProperty.js
        .replace('	var PROPERTIES = [', '$& "top", "parent", "frameElement", "stackTraceLimit",')
        .replace(
            '_ACCESSORS = {',
            '$& top: { condition: (owner) => isWindow(owner), get: (owner) => owner.rammerheadTop, set: (owner, value) => value },' +
                'parent: { condition: (owner) => isWindow(owner), get: (owner) => owner.rammerheadParent, set: (owner, value) => value },' +
                // the real limit has room for hammerhead's frames, which stack traces drop (see rammerhead.js)
                'stackTraceLimit: { condition: (owner) => typeof owner === "function" && owner.name === "Error" && typeof owner.captureStackTrace === "function", ' +
                'get: (owner) => { var h = window["%hammerhead%"]; return h && "rhSiteStackTraceLimit" in h ? h.rhSiteStackTraceLimit : owner.stackTraceLimit; }, ' +
                'set: (owner, value) => { var h = window["%hammerhead%"]; if (h) h.rhSiteStackTraceLimit = value; owner.stackTraceLimit = typeof value === "number" ? value + 50 : value; return value; } },' +
                // a getter the page installed itself still runs, like it would directly
                'frameElement: { condition: (owner) => isWindow(owner), get: (owner) => { var d = nativeMethods.objectGetOwnPropertyDescriptor(owner, "frameElement"); return d && d.get && nativeMethods.functionToString.call(d.get) !== "function get frameElement() { [native code] }" ? owner.frameElement : rhVisibleFrameElement(owner); }, set: (owner, value) => value },'
        )

        // force proxy image src always on client. issue occurs when img is given through html but
        // is later then changed by client through img.src. issue doesn't occur if element is
        // created through document.createElement since the proper internal flags are set
        // (fixes google login captcha)
        .replace(/el\[INTERNAL_PROPS.forceProxySrcForImage\]/g, 'true')
        // deliver messages sent with the native postMessage (Window.prototype.postMessage.call(...)),
        // which skip hammerhead's wrapping and were dropped
        .replace(
            /(MessageSandbox\.prototype\._onWindowMessage = function \(e, originListener\) \{\s*var data = MessageSandbox\._getMessageData\(e\);)/,
            '$1 if (!data || typeof data.type !== "string" || !data.type.startsWith("hammerhead|")) return callEventListener(this.window, originListener, e);'
        )
        // and give them the sender's site origin instead of undefined
        .replace(
            /var data = nativeMethods\.messageEventDataGetter\.call\(this\);\s*if \(data\)\s*return data\.originUrl;/,
            'var data = nativeMethods.messageEventDataGetter.call(this);' +
                'if (data && typeof data.type === "string" && data.type.startsWith("hammerhead|")) return data.originUrl;' +
                'try { var rhSource = this.source; var rhDest = rhSource && getDestinationUrl(rhSource.location.href);' +
                ' var rhParsed = rhDest && parseUrl(rhDest); if (rhParsed && rhParsed.protocol) return getDomain(rhParsed); } catch (rhError) {}'
        )
        // read frameElement natively inside hammerhead (see rhFrameElementOf above)
        .replace(/function getFrameElement\(win\) \{\s*try \{\s*return win\.frameElement;/, 'function getFrameElement(win) { try { return rhFrameElementOf(win);')
        .replace(/parentFrameElement = parent\.frameElement;/, 'parentFrameElement = rhFrameElementOf(parent);')
        // keep :hover (hammerhead emulates hover for testcafe; real users hover) (see util/keepDomAttributes.js)
        .replace("css = css.replace(HOVER_PSEUDO_CLASS_RE, '[' + INTERNAL_ATTRIBUTES.hoverPseudoClass + ']$1');", '')
        // constructors whose prototype points back at the wrapper need the native's declared name:
        // v8 names stack frames after it ("at Function.toString", not "at Object.toString")
        .replace(
            "if (overrideProtoConstructor === void 0) { overrideProtoConstructor = false; }",
            '$& var rhWrapped = null; if (overrideProtoConstructor && rhNamedConstructors[fnName]) { rhWrapped = wrapper; wrapper = rhNamedConstructors[fnName](rhWrapped); }'
        )
        // wrappers check `this instanceof <themselves>`, so the inner one shares the native prototype too
        .replace('wrapper.prototype = nativePrototype;', '$& if (rhWrapped) rhWrapped.prototype = nativePrototype;')
        // keep hammerhead's ui root (testcafe's ui) out of the dom: pages saw an extra <div> at the end of
        // <body>, and query results became arrays while it was there
        .replace(/(this\.)?nativeMethods\.appendChild\.call\(this\.document\.body, this\.root\);/g, ';')
        .replace('if (!this.root || /* NOTE: T225944 */ !this.document.body.contains(this.root)) {', 'if (!this.root) {')
        .replace('if (checkBody && isBodyElementWithChildren(parent) && isElementInDocument(parent)) {', 'if (false) {')
        // body/head query methods live on Element.prototype in browsers; hammerhead's copies on
        // HTMLBodyElement/HTMLHeadElement.prototype bypassed page hooks there. with the ui root out of the dom
        // there's nothing left for them to filter
        .replace(/overrideFunction\((bodyProto|headProto), '(getElementsByClassName|querySelector|querySelectorAll)', [^;]*\);/g, '')
        // worker urls stay unshuffled (worker-hammerhead.js can't unshuffle), see dontShuffleWorkerUrls
        .replace(
            'scriptURL = getProxyUrl(scriptURL, { resourceType: stringifyResourceType({ isScript: true }) });',
            'scriptURL = getProxyUrl(scriptURL, { resourceType: stringifyResourceType({ isScript: true }), rhNoShuffle: true });'
        )
        // pushState/replaceState: live on History.prototype like the natives, and enforce the site's
        // same-origin rule (they accepted any url)
        .replace(
            'overrideFunction(this.window.history, name, function () {',
            'overrideFunction(this.window.History.prototype, name, function () {'
        )
        .replace(
            /(var url = args\[2\];\s*if \(args\.length > 2 && \(url !== null && url !== void 0\)\))/,
            'if (args.length > 2 && args[2] !== null && args[2] !== void 0) { var rhDoc = get$2(), rhTarget; try { rhTarget = new nativeMethods.URL(String(args[2]), rhDoc); } catch (e) { rhTarget = null; }' +
                ' if (rhTarget && rhTarget.origin !== new nativeMethods.URL(rhDoc).origin) throw new DOMException("Failed to execute \'" + name + "\' on \'History\': A history state object with URL \'" + rhTarget.href + "\' cannot be created in a document with origin \'" + new nativeMethods.URL(rhDoc).origin + "\' and URL \'" + rhDoc + "\'.", "SecurityError"); }' +
                '$1'
        )
        // stylesheet markers without newlines: setting a <style>'s innerText turns them into <br>s
        .replace(
            'css = "".concat(STYLESHEET_PROCESSING_START_COMMENT, "\\n").concat(css, "\\n").concat(STYLESHEET_PROCESSING_END_COMMENT);',
            'css = "".concat(STYLESHEET_PROCESSING_START_COMMENT).concat(css).concat(STYLESHEET_PROCESSING_END_COMMENT);'
        )
        // getElementsByTagName returns the native collection (with the ui root out of the dom there's nothing to
        // filter, and the wrapper object showed through)
        .replace(
            'var nativeCollection = nativeMethods[nativeGetElementsByTagNameFnName].apply(this, args);',
            '$& return nativeCollection;'
        )
        // about:blank iframes get rammerhead.js too, right after hammerhead (its unshuffling and hiding are
        // per frame, and anti-bot scripts take natives from fresh iframes). absolute sourceURLs so stack
        // traces can drop both
        .replace(
            'nativeMethods.contentWindowGetter.call(e.iframe).eval("(".concat(initHammerheadClient.toString(), ")();//# sourceURL=hammerhead.js"));',
            () =>
                'var rhFrameWindow = nativeMethods.contentWindowGetter.call(e.iframe);' +
                ' rhRunInWindow(rhFrameWindow, "(".concat(initHammerheadClient.toString(), ")();//# sourceURL=").concat(location.origin, "/hammerhead.js"));' +
                // the page's own localStorage handling (rammerhead browser) covers its about:blank frames too
                ' if (hammerhead.rhLocalStorageOff) rhRunInWindow(rhFrameWindow, "window.rammerheadDisableLocalStorageImplementation = true;");' +
                ' rhRunInWindow(rhFrameWindow, ' +
                JSON.stringify(UglifyJS.minify(fs.readFileSync(path.join(__dirname, './client/rammerhead.js'), 'utf8'), { keep_fnames: true }).code) +
                ' + "\\n//# sourceURL=" + location.origin + "/rammerhead.js");'
        )
        // like the natives, these live on prototypes, not on the navigator/serviceWorker objects
        .replace("overrideFunction(this.window.navigator, 'registerProtocolHandler',", "overrideFunction(this.window.Navigator.prototype, 'registerProtocolHandler',")
        .replace("overrideFunction(this.window.navigator.serviceWorker, 'register',", "overrideFunction(this.window.ServiceWorkerContainer.prototype, 'register',")
        .replace("overrideFunction(this.window.navigator.serviceWorker, 'getRegistration',", "overrideFunction(this.window.ServiceWorkerContainer.prototype, 'getRegistration',")
        // document.domain of the document it's called on (scripts call one frame's getter on another's document),
        // and about:blank documents inherit their parent's
        .replace(
            'return storedDomain || LocationAccessorsInstrumentation.getLocationWrapper(window).hostname;',
            'if (storedDomain) return storedDomain;' +
                ' var rhWin = (this && this.defaultView) || window;' +
                ' for (var rhI = 0; rhWin && rhI < 20; rhI++) { try { var rhHost = LocationAccessorsInstrumentation.getLocationWrapper(rhWin).hostname; if (rhHost) return rhHost; } catch (e) {} if (rhWin === rhWin.parent) break; rhWin = rhWin.parent; }' +
                " return '';"
        )
        // don't let sandboxed iframes run scripts the site disabled (see util/keepDomAttributes.js)
        .replace("attrValue += !allowScripts ? ' allow-scripts' : '';", '')
        .replace("args[valueIndex] += !allowScripts ? ' allow-scripts' : '';", '')
        // csp <meta> policies rewritten for the proxy, original kept for reads (see util/contentSecurityPolicy.js)
        .replace(
            /this\.adapter\.removeAttr\(el, 'http-equiv'\);\s*this\.adapter\.removeAttr\(el, 'content'\);/,
            "var rhPolicy = this.adapter.getAttr(el, 'content') || '';" +
                "if (!this.adapter.hasAttr(el, DomProcessor.getStoredAttrName('content'))) {" +
                "    this.adapter.setAttr(el, DomProcessor.getStoredAttrName('content'), rhPolicy);" +
                "    var rhRewritten = rhCspRewrite.rewritePolicy(rhPolicy, rhCspOptions());" +
                "    rhCspPolicies.set(rhRewritten, rhPolicy.trim());" +
                "    this.adapter.setAttr(el, 'content', rhRewritten);" +
                '}'
        )
        .replace(
            "var ATTRS_WITH_SPECIAL_PROXYING_LOGIC = ['sandbox', 'autocomplete', 'target', 'formtarget', 'style'];",
            "var ATTRS_WITH_SPECIAL_PROXYING_LOGIC = ['sandbox', 'autocomplete', 'target', 'formtarget', 'style', 'content'];"
        )
        .replace(
            /(function cleanUpSandboxAttr\(el\) \{)/,
            '$1' +
                'var rhStoredContent = DomProcessor.getStoredAttrName("content");' +
                'if (nativeMethods.hasAttribute.call(el, rhStoredContent)) {' +
                '    nativeMethods.setAttribute.call(el, "content", nativeMethods.getAttribute.call(el, rhStoredContent));' +
                '    nativeMethods.removeAttribute.call(el, rhStoredContent);' +
                '}'
        )
        // document.referrer under the site's referrer policy (see util/referrerPolicy.js)
        .replace(
            'var referrer = getDestinationUrl(nativeMethods.documentReferrerGetter.call(this));',
            'var rhReferrer = settings$1.get().rhReferrer;' +
                'if (typeof rhReferrer === "string" && this === document) return rhReferrer;' +
                '$&'
        )
        // override cloneNode where the native lives (an own Element.prototype.cloneNode is a tell)
        .replace("overrideFunction(window.Element.prototype, 'cloneNode', ", "overrideFunction(window.Node.prototype, 'cloneNode', ")
        // wrappers that can't be cloaked (constructors) keep the native length
        .replace(
            'overrideFunctionName(nativeFnWrapper, nativeFn.name);',
            '$& nativeMethods.objectDefineProperty(nativeFnWrapper, "length", { value: nativeFn.length, configurable: true });'
        )
        // hide overridden natives from anti-bot checks (length, prototype, own props, getter source)
        .replace(
            'function replaceNativeAccessor(descriptor, accessorName, newAccessor) {',
            // shared by every frame of the tab: pages call one frame's toString on another frame's functions
            'var rhNativeStrings = (function () { var t = window; try { t = window.rammerheadTop || window; if (t["hammerhead|native-strings"]) return t["hammerhead|native-strings"]; } catch (e) { t = window; }' +
                ' var m = new WeakMap(); try { Object.defineProperty(t, "hammerhead|native-strings", { value: m }); } catch (e) {} return m; })();' +
                'var rhOriginalSources = new WeakMap();' +
                'var rhApply = Reflect.apply;' +
                // wrappers are real strict functions without a prototype, like natives (a Proxy showed through:
                // setPrototypeOf cycles weren't caught, and stack frames named the receiver "Object")
                // declared names (v8 names stack frames after them); the only constructors wrapped this way
                'var rhNamedConstructors = {' +
                '    Function: function (w) { return function Function() { return new.target ? Reflect.construct(w, arguments, new.target) : w.apply(this, arguments); }; },' +
                '    Worker: function (w) { return function Worker() { return new.target ? Reflect.construct(w, arguments, new.target) : w.apply(this, arguments); }; }' +
                '};' +
                // closures, not Function(): sites with a strict csp (no unsafe-eval) would block that
                'var rhMakers = {' +
                '    fn: function (w, n, a) { return ({ [n]() { "use strict"; return a(w, this, arguments); } })[n]; },' +
                '    get: function (w, n, a) { return Object.getOwnPropertyDescriptor({ get [n]() { "use strict"; return a(w, this, arguments); } }, n).get; },' +
                '    set: function (w, n, a) { return Object.getOwnPropertyDescriptor({ set [n](v) { "use strict"; return a(w, this, arguments); } }, n).set; }' +
                '};' +
                'function rhCloak(wrapper, nativeFn) {' +
                '    if (typeof nativeFn !== "function" || typeof wrapper !== "function") return wrapper;' +
                // constructible natives without a prototype (Proxy) keep a Proxy wrapper that can be constructed
                '    var isConstructor = true; try { Reflect.construct(String, [], nativeFn); } catch (e) { isConstructor = false; }' +
                '    if (isConstructor) {' +
                '        var constructible = new Proxy(nativeFn, { apply: function (t, self, args) { return rhApply(wrapper, self, args); }, construct: function (t, args, newTarget) { return Reflect.construct(wrapper, args, newTarget === constructible ? wrapper : newTarget); } });' +
                '        rhNativeStrings.set(constructible, Function.prototype.toString.call(nativeFn));' +
                '        return constructible;' +
                '    }' +
                '    var name = nativeFn.name, kind = /^(get|set) /.exec(name);' +
                '    var cloaked = rhMakers[kind ? kind[1] : "fn"](wrapper, kind ? name.slice(4) : name, rhApply);' +
                '    nativeMethods.objectDefineProperty(cloaked, "length", { value: nativeFn.length, configurable: true });' +
                '    rhNativeStrings.set(cloaked, Function.prototype.toString.call(nativeFn));' +
                '    return cloaked;' +
                '}' +
                '$&'
        )
        .replace(
            'newAccessor.toString = function () { return stringifiedNativeAccessor_1; };',
            'newAccessor = rhCloak(newAccessor, descriptor[accessorName]);'
        )
        .replace(
            /nativeMethods\.objectDefineProperty\(nativeFnWrapper, INTERNAL_PROPS\.nativeStrRepresentation, \{\s*value: (nativeMethods\.Function\.prototype\.toString\.call\(nativeFn\)),\s*configurable: true,\s*\}\);/,
            'rhNativeStrings.set(nativeFnWrapper, $1);'
        )
        .replace(
            'return !nativeMethods.objectHasOwnProperty.call(fn, INTERNAL_PROPS.nativeStrRepresentation);',
            'return !rhNativeStrings.has(fn);'
        )
        .replace(
            /if \(nativeMethods\.objectHasOwnProperty\.call\(this, INTERNAL_PROPS\.nativeStrRepresentation\)\)\s*return this\[INTERNAL_PROPS\.nativeStrRepresentation\];\s*return nativeMethods\.functionToString\.call\(this\);/,
            'if (rhNativeStrings.has(this)) return rhNativeStrings.get(this);' +
                // rewritten functions show their original source (see src/util/scriptPositions.js addFunctionSources)
                'var rhSource = nativeMethods.functionToString.call(this);' +
                'var rhSources = window["%hammerhead%"] && window["%hammerhead%"].rhSources;' +
                'if (!rhSources || !rhSources.size) return rhSource;' +
                'if (rhOriginalSources.has(this)) return rhOriginalSources.get(this);' +
                'var rhHash = 0x811c9dc5; for (var rhI = 0; rhI < rhSource.length; rhI++) { rhHash ^= rhSource.charCodeAt(rhI); rhHash = Math.imul(rhHash, 0x01000193) >>> 0; }' +
                'var rhOriginal = rhSources.get(rhSource.length + ":" + rhHash.toString(36));' +
                'var rhResult = typeof rhOriginal === "string" ? rhOriginal : rhSource;' +
                'rhOriginalSources.set(this, rhResult);' +
                'return rhResult;'
        )
        .replace(
            /(function overrideFunction\(obj, fnName, wrapper\) \{\s*var fn = obj\[fnName\];\s*if \(isNativeFunction\(fn\)\) \{\s*overrideStringRepresentation\(wrapper, fn\);\s*obj\[fnName\] = )wrapper;/,
            '$1nativeMethods.objectHasOwnProperty.call(fn, "prototype") ? wrapper : rhCloak(wrapper, fn);'
        )
        // the url resolver kept the base url in a <base> of a document that inherits the page's csp, so base-uri
        // reported violations for it. keep it as a property and resolve with URL instead
        .replace('var hammerhead = new Hammerhead();', '$& hammerhead.rhCspNonce = rhCspNonce; hammerhead.rhCspPolicies = rhCspPolicies; hammerhead.rhScriptSources = rhScriptSources; hammerhead.rhNoncedScripts = rhNoncedScripts; hammerhead.rhTrusted = rhTrusted; hammerhead.rhScriptsBlocked = rhScriptsBlocked;')
        .replace('contentWindow.eval.call(contentWindow, taskScript);', 'rhRunInWindow(contentWindow, taskScript);')
        .replace(
            "this._transportWorker = new nativeMethods.Worker(settings$1.get().transportWorkerUrl, { name: 'Transport' });",
            "this._transportWorker = new nativeMethods.Worker(rhTrusted('ScriptURL', settings$1.get().transportWorkerUrl), { name: 'Transport' });"
        )
        .replace(
            /var innerHtml = nativeMethods\.elementInnerHTMLGetter\.call\(el\);\s*if \(innerHtml\.indexOf\(sharedSelfRemovingScripts\.iframeInit\) !== -1\) \{\s*nativeMethods\.elementInnerHTMLSetter\.call\(el, innerHtml\.replace\(sharedSelfRemovingScripts\.iframeInit, ''\)\);/,
            'var innerHtml = nativeMethods.elementInnerHTMLGetter.call(el);' +
                'var rhStripped = rhStripScript(innerHtml, sharedSelfRemovingScripts.iframeInit);' +
                'if (rhStripped !== null) {' +
                '    nativeMethods.elementInnerHTMLSetter.call(el, rhStripped);'
        )
        .replace(
            /(nativeMethods\.insertAdjacentHTML\.call\((?:firstScriptOrStyle|htmlElement|container), InsertPosition\$1\.(?:beforeBegin|beforeEnd|afterBegin), )sharedSelfRemovingScripts\.iframeInit\)/g,
            '$1rhNonced(sharedSelfRemovingScripts.iframeInit))'
        )
        .replace(
            'nativeMethods.elementOuterHTMLSetter.call(span, sharedSelfRemovingScripts.onWindowRecreation);',
            'nativeMethods.elementOuterHTMLSetter.call(span, rhNonced(sharedSelfRemovingScripts.onWindowRecreation));'
        )
        .replace(
            'htmlChunk = sharedSelfRemovingScripts.iframeInit + htmlChunk;',
            'htmlChunk = rhNonced(sharedSelfRemovingScripts.iframeInit) + htmlChunk;'
        )
        .replace(
            "nativeMethods.appendChild.call(htmlDocument.head, base);",
            ";"
        )
        .replace(
            /nativeMethods\.anchorHrefSetter\.call\(resolver, url\);\s*href = nativeMethods\.anchorHrefGetter\.call\(resolver\);/,
            'href = rhResolveUrl(url, this._getResolver(doc), resolver);'
        )
        .replace(
            "nativeMethods.setAttribute.call(baseElement, 'href', url);",
            'this._getResolver(doc).rhBaseUrl = url;'
        )
        .replace(
            /var baseElement = nativeMethods\.elementGetElementsByTagName\.call\(this\._getResolver\(doc\)\.head, 'base'\)\[0\];\s*return nativeMethods\.getAttribute\.call\(baseElement, 'href'\);/,
            'var rhBase = this._getResolver(doc).rhBaseUrl; return rhBase === undefined ? null : rhBase;'
        )
        .replace(
            "var DOCUMENT_URL_RESOLVER = 'hammerhead|document-url-resolver';",
            '$&' +
                fs
                    .readFileSync(path.join(__dirname, './util/cspRewrite.js'), 'utf8')
                    .replace("if (typeof module !== 'undefined') module.exports = rhCspRewrite;", '') +
                // the nonce our policies allow: on the script tag that loaded us, or the parent's for frames it set up
                'var rhCspNonce = (function () {' +
                '    try { var s = document.currentScript; if (s && s.nonce) return s.nonce; } catch (e) {}' +
                '    try { var p = window.rammerheadParent; if (p !== window && p["%hammerhead%"]) return p["%hammerhead%"].rhCspNonce || ""; } catch (e) {}' +
                '    return "";' +
                '})();' +
                // rewritten policy -> the site's, for violation reports (see rammerhead.js hideProxyFromCspViolations)
                'var rhCspPolicies = (function () {' +
                '    try { var p = window.rammerheadParent; if (p !== window && p["%hammerhead%"] && p["%hammerhead%"].rhCspPolicies) return p["%hammerhead%"].rhCspPolicies; } catch (e) {}' +
                '    return new Map();' +
                '})();' +
                'function rhCspOptions() {' +
                '    var origins = [location.origin];' +
                '    var port = settings$1.get().crossDomainProxyPort;' +
                '    if (port) { var cross = location.protocol + "//" + location.hostname + ":" + port; if (cross !== location.origin && origins.indexOf(cross) === -1) origins.push(cross); }' +
                '    return { origins: origins, nonce: rhCspNonce, https: location.protocol === "https:" };' +
                '}' +
                // hammerhead's own trusted types policy (cspRewrite.js allows its name), for what it hands to sinks itself
                'var rhTrustedPolicy;' +
                'function rhTrusted(kind, value) {' +
                '    if (rhTrustedPolicy === void 0) {' +
                '        rhTrustedPolicy = null;' +
                // a frame that can't run scripts can't run its own policy's callbacks either: use the parent's
                '        if (rhScriptsBlocked(window)) {' +
                '            try { var p = window.rammerheadParent, ph = p !== window && p["%hammerhead%"]; if (ph && ph.rhTrusted) rhTrustedPolicy = { createHTML: function (s) { return ph.rhTrusted("HTML", s); }, createScript: function (s) { return ph.rhTrusted("Script", s); }, createScriptURL: function (s) { return ph.rhTrusted("ScriptURL", s); } }; } catch (e) {}' +
                '        } else' +
                '        try { if (window.trustedTypes && window.trustedTypes.createPolicy) rhTrustedPolicy = window.trustedTypes.createPolicy(rhCspRewrite.POLICY_NAME, { createHTML: function (s) { return s; }, createScript: function (s) { return s; }, createScriptURL: function (s) { return s; } }); } catch (e) {}' +
                '    }' +
                '    return rhTrustedPolicy ? rhTrustedPolicy["create" + kind](value) : value;' +
                '}' +
                'function rhTrustedKind(v) {' +
                '    if (!v || typeof v !== "object") return null;' +
                '    try { var tt = window.trustedTypes; return !tt ? null : tt.isHTML(v) ? "HTML" : tt.isScript(v) ? "Script" : tt.isScriptURL(v) ? "ScriptURL" : null; } catch (e) { return null; }' +
                '}' +
                // the page's trusted value, processed: trusted again. strings stay strings, so the browser enforces them
                'function rhSinkValue(processed, original) {' +
                '    var kind = rhTrustedKind(original);' +
                '    return kind && typeof processed === "string" ? rhTrusted(kind, processed) : processed;' +
                '}' +
                // attributes that are trusted types sinks, for hammerhead re-setting attributes of elements already in place
                'function rhAttrValue(el, attr, value) {' +
                '    if (typeof value !== "string" || !window.trustedTypes) return value;' +
                '    var name = String(attr).toLowerCase(), tag = el && el.tagName ? String(el.tagName).toLowerCase() : "";' +
                '    if (name.slice(0, 2) === "on") return rhTrusted("Script", value);' +
                '    if (tag === "iframe" && name === "srcdoc") return rhTrusted("HTML", value);' +
                '    if (tag === "script" && (name === "src" || name === "href" || name === "xlink:href")) return rhTrusted("ScriptURL", value);' +
                '    return value;' +
                '}' +
                'var rhWriteTrusted = false;' +
                // scripts a page adds that its policy allows by hash (the original text's) get our nonce: rewriting
                // changes the text, so the hash no longer matches. sha256 only, sync since scripts run on insertion
                'function rhSha256Base64(text) {' +
                '    var bytes = new TextEncoder().encode(text), k = rhSha256Base64.k;' +
                '    if (!k) { k = rhSha256Base64.k = []; var n = 2, found = 0; while (found < 64) { var prime = true; for (var d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; } if (prime) { k.push((Math.pow(n, 1 / 3) % 1) * 4294967296 | 0); found++; } n++; } }' +
                '    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];' +
                '    var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(total);' +
                '    m.set(bytes); m[len] = 0x80; var bits = len * 8;' +
                '    for (var i = 0; i < 8; i++) m[total - 1 - i] = i < 4 ? (bits >>> (8 * i)) & 255 : Math.floor(bits / 4294967296 / Math.pow(256, i - 4)) & 255;' +
                '    var w = new Int32Array(64);' +
                '    for (var off = 0; off < total; off += 64) {' +
                '        for (var t = 0; t < 16; t++) w[t] = (m[off + t * 4] << 24) | (m[off + t * 4 + 1] << 16) | (m[off + t * 4 + 2] << 8) | m[off + t * 4 + 3];' +
                '        for (t = 16; t < 64; t++) { var x = w[t - 15], y = w[t - 2];' +
                '            w[t] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[t - 16] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + w[t - 7] | 0; }' +
                '        var a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];' +
                '        for (t = 0; t < 64; t++) {' +
                '            var t1 = hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + k[t] + w[t] | 0;' +
                '            var t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c)) | 0;' +
                '            hh = g; g = f; f = e; e = dd + t1 | 0; dd = c; c = b; b = a; a = t1 + t2 | 0; }' +
                '        h[0] = h[0] + a | 0; h[1] = h[1] + b | 0; h[2] = h[2] + c | 0; h[3] = h[3] + dd | 0; h[4] = h[4] + e | 0; h[5] = h[5] + f | 0; h[6] = h[6] + g | 0; h[7] = h[7] + hh | 0;' +
                '    }' +
                '    var out = ""; for (i = 0; i < 8; i++) for (var j = 3; j >= 0; j--) out += String.fromCharCode((h[i] >>> (j * 8)) & 255);' +
                '    return btoa(out);' +
                '}' +
                'var rhNonceSetter = (function () { try { var d = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "nonce"); return d && d.set; } catch (e) {} })();' +
                'var rhNoncedScripts = new WeakSet();' +
                'function rhNonceIfHashAllowed(script, original) {' +
                '    if (!rhCspNonce || !rhNonceSetter || typeof original !== "string" || !original) return;' +
                '    var allowed = {}, any = false;' +
                '    rhCspPolicies.forEach(function (policy) { var re = /\'sha256-([A-Za-z0-9+\/_-]+=*)\'/g, m; while ((m = re.exec(policy))) { allowed[m[1].replace(/-/g, "+").replace(/_/g, "/")] = any = true; } });' +
                '    if (!any || !allowed[rhSha256Base64(original)]) return;' +
                '    rhNonceSetter.call(script, rhCspNonce);' +
                '    rhNoncedScripts.add(script);' +
                '}' +
                // recent script text rewrites, so csp violation samples show the page's code (see rammerhead.js)
                'var rhScriptSources = [];' +
                'function rhRememberScriptSource(processed, original) {' +
                '    if (typeof processed !== "string" || processed === original) return processed;' +
                '    rhScriptSources.push([processed.slice(0, 2000), String(original).slice(0, 200)]);' +
                '    if (rhScriptSources.length > 20) rhScriptSources.shift();' +
                '    return processed;' +
                '}' +
                // script.src and iframe.srcdoc are setAttribute underneath. run the page's value through the real
                // property on a detached element first: the browser's own error, violation and default policy call
                'function rhPropertySink(el, prop, value) {' +
                '    if (!window.trustedTypes || rhTrustedKind(value)) return value;' +
                '    var tag = el && el.tagName ? String(el.tagName).toLowerCase() : "";' +
                '    var setter = tag === "script" && prop === "src" ? nativeMethods.scriptSrcSetter : tag === "iframe" && prop === "srcdoc" ? nativeMethods.iframeSrcdocSetter : null;' +
                '    if (!setter) return value;' +
                '    var probe = nativeMethods.createElement.call(el.ownerDocument || document, tag);' +
                '    setter.call(probe, value);' +
                '    return rhTrusted(prop === "src" ? "ScriptURL" : "HTML", nativeMethods.getAttribute.call(probe, prop));' +
                '}' +
                // script text through the script's own textContent: node's setter counts as an untrusted change under
                // trusted types and the script won't run
                'var rhScriptTextSetter = (function () { try { var d = Object.getOwnPropertyDescriptor(window.HTMLScriptElement.prototype, "textContent"); return d && d.set; } catch (e) {} })();' +
                'function rhSetText(el, value) {' +
                '    var isScript = el && el.tagName && String(el.tagName).toLowerCase() === "script";' +
                '    return (isScript && rhScriptTextSetter ? rhScriptTextSetter : nativeMethods.nodeTextContentSetter).call(el, value);' +
                '}' +
                // code run in a frame hammerhead sets up. a nonced script when the page has a policy (it may not allow
                // eval), except in sandboxed frames without allow-scripts, where only eval from the parent runs
                'function rhScriptsBlocked(win) {' +
                '    var frame = rhFrameElementOf(win), sandbox = frame && nativeMethods.getAttribute.call(frame, "sandbox");' +
                '    return typeof sandbox === "string" && !/(^|\\s)allow-scripts(\\s|$)/i.test(sandbox);' +
                '}' +
                // the window an event target belongs to can't run scripts. once per window: sandbox flags are fixed when the frame navigates
                'var rhBlockedWindows = new WeakMap();' +
                'function rhScriptsBlockedFor(target) {' +
                '    var win = null;' +
                '    try { win = target && (target.window === target ? target : target.defaultView || (target.ownerDocument && target.ownerDocument.defaultView)); } catch (e) {}' +
                '    if (!win) return false;' +
                '    if (!rhBlockedWindows.has(win)) rhBlockedWindows.set(win, rhScriptsBlocked(win));' +
                '    return rhBlockedWindows.get(win);' +
                '}' +
                'function rhRunInWindow(win, code) {' +
                '    if (!rhCspNonce || rhScriptsBlocked(win)) return win.eval(rhTrusted("Script", code));' +
                '    var doc = win.document, script = nativeMethods.createElement.call(doc, "script");' +
                '    nativeMethods.setAttribute.call(script, "nonce", rhCspNonce);' +
                '    rhSetText(script, rhTrusted("Script", code));' +
                '    var parent = doc.head || doc.documentElement || doc;' +
                '    nativeMethods.appendChild.call(parent, script);' +
                '    nativeMethods.removeChild.call(parent, script);' +
                '}' +
                // hammerhead's self-removing scripts carry the nonce, so pages whose policy blocks inline scripts still run them
                'function rhNonced(html) { return rhCspNonce ? html.replace("<script class=", "<script nonce=\\"" + rhCspNonce + "\\" class=") : html; }' +
                // and are found again with or without it (browsers blank the attribute once inserted)
                'function rhStripScript(html, script) {' +
                '    var tail = script.slice("<script ".length), at = html.indexOf(tail);' +
                '    if (at === -1) return null;' +
                '    var start = html.lastIndexOf("<script", at);' +
                '    return html.slice(0, start) + html.slice(at + tail.length);' +
                '}' +
                'function rhResolveUrl(url, resolverDocument, anchor) {' +
                '    try { return new nativeMethods.URL(url, resolverDocument.rhBaseUrl || void 0).href; } catch (e) {}' +
                '    nativeMethods.anchorHrefSetter.call(anchor, url);' +
                '    return nativeMethods.anchorHrefGetter.call(anchor);' +
                '}'
        )

        // trusted types: hammerhead's own writes go through its policy; the page's trusted values stay trusted
        .replace(/nativeMethods\.elementInnerHTMLSetter\.call\(container, html\);/, "nativeMethods.elementInnerHTMLSetter.call(container, rhTrusted('HTML', html));")
        .replace('nativeMethods.elementInnerHTMLSetter.call(el, rhStripped);', "nativeMethods.elementInnerHTMLSetter.call(el, rhTrusted('HTML', rhStripped));")
        .replace(/rhNonced\(sharedSelfRemovingScripts\.(iframeInit|onWindowRecreation)\)\)/g, "rhTrusted('HTML', rhNonced(sharedSelfRemovingScripts.$1)))")
        .replace('nativeMethods.elementInnerHTMLSetter.call(parser, uiStyleSheetsHtml);', "nativeMethods.elementInnerHTMLSetter.call(parser, rhTrusted('HTML', uiStyleSheetsHtml));")
        .replace(
            /ClientDomAdapter\.prototype\.setAttr = function \(el, attr, value\) \{\s+return nativeMethods\.setAttribute\.call\(el, attr, value\);/,
            'ClientDomAdapter.prototype.setAttr = function (el, attr, value) {\n        return nativeMethods.setAttribute.call(el, attr, rhAttrValue(el, attr, value));'
        )
        .replace(
            'nativeMethods.setAttribute.call(el, urlAttr, nativeMethods.getAttribute.call(el, storedAttr));',
            'nativeMethods.setAttribute.call(el, urlAttr, rhAttrValue(el, urlAttr, nativeMethods.getAttribute.call(el, storedAttr)));'
        )
        .replace(
            /(ClientDomAdapter\.prototype\.setStyleContent = function \(style, content\) \{\s*)nativeMethods\.elementInnerHTMLSetter\.call\(style, content\);/,
            "$1nativeMethods.elementInnerHTMLSetter.call(style, rhTrusted('HTML', content));"
        )
        .replace(
            /ClientDomAdapter\.prototype\.setScriptContent = function \(script, content\) \{\s+nativeMethods\.nodeTextContentSetter\.call\(script, content\);/,
            "ClientDomAdapter.prototype.setScriptContent = function (script, content) {\n        rhSetText(script, rhTrusted('Script', content));"
        )
        .replace(
            /(domMutationTracker\.onChildrenChanged\(el\);\s*)nativeMethods\.elementInnerHTMLSetter\.call\(el, processedValue\);/,
            '$1nativeMethods.elementInnerHTMLSetter.call(el, rhSinkValue(processedValue, value));'
        )
        .replace(
            /nativeMethods\.elementOuterHTMLSetter\.call\(el, processHtml\(String\(value\), \{\s*parentTag: parentEl && parentEl\['tagName'\],\s*processedContext: el\[INTERNAL_PROPS\.processedContext\],\s*\}\)\);/,
            "nativeMethods.elementOuterHTMLSetter.call(el, rhSinkValue(processHtml(String(value), { parentTag: parentEl && parentEl['tagName'], processedContext: el[INTERNAL_PROPS.processedContext] }), value));"
        )
        .replace(
            /(var html = args\[1\];[\s\S]{0,1200}?)nativeMethods\.insertAdjacentHTML\.apply\(this, args\);/,
            '$1if (args.length > 1) args[1] = rhSinkValue(args[1], html); nativeMethods.insertAdjacentHTML.apply(this, args);'
        )
        .replace('nativeMethods.htmlElementInnerTextSetter.call(this, processedValue);', 'nativeMethods.htmlElementInnerTextSetter.call(this, rhSinkValue(processedValue, value));')
        .replace('nativeMethods.scriptTextSetter.call(this, processedValue);', 'nativeMethods.scriptTextSetter.call(this, rhSinkValue(processedValue, value));')
        .replace(
            /(var processedValue = WindowSandbox\.processTextPropValue\(this, value\);\s*domMutationTracker\.onChildrenChanged\(this\);\s*)nativeMethods\.nodeTextContentSetter\.call\(this, processedValue\);/,
            '$1nativeMethods.nodeTextContentSetter.call(this, rhSinkValue(processedValue, value));'
        )
        .replace(
            /var valueIndex = isNs \? 2 : 1;\s+var value = String\(args\[valueIndex\]\);/,
            'var valueIndex = isNs ? 2 : 1;\n        var rhOriginalValue = args[valueIndex];\n        var value = String(args[valueIndex]);'
        )
        .replace(
            /(args\[valueIndex\] = domProcessor\.adapter\.processSrcdocAttr\(value\);\s*\}\s*)var result = setAttrMeth\.apply\(el, args\);/,
            '$1var rhBlob = window[\'%hammerhead%\'] && window[\'%hammerhead%\'].rhRealBlobUrl;\n        if (rhBlob && (isUrlAttr || isUrlsSet || loweredAttr === \'poster\')) args[valueIndex] = rhBlob(args[valueIndex]);\n        args[valueIndex] = rhSinkValue(args[valueIndex], rhOriginalValue);\n        var result = setAttrMeth.apply(el, args);'
        )
        // script-less sandboxed frames: the storage poll's callback can't run there, and chrome logs every 10ms tick
        .replace(
            /(this\.intervalId = nativeMethods\.setInterval\.call\(this\.window, function \(\) \{\s+localStorageWrapper\.checkStorageChanged\(\);)/,
            'if (!rhScriptsBlocked(this.window)) $1'
        )
        // and the shadow ui's deferred checks after body changes
        .replace(
            /(nativeMethods\.setTimeout\.call\(windowSandbox\.window, function \(\) \{ return windowSandbox\.(nodeMutation\.onBodyContentChanged\(el\)|shadowUI\.onBodyElementMutation\(\)); \}, 0\);)/g,
            '{ if (!rhScriptsBlocked(windowSandbox.window)) $1 }'
        )
        // script-less frames can't run hammerhead's internal listeners (chrome logs every blocked event)
        .replace(
            /(if \(events === void 0\) \{ events = LISTENED_EVENTS; \})/,
            '$1\n        if (rhScriptsBlockedFor(el))\n            return;'
        )
        .replace(
            /(function (addInternalAfterHandler|addFirstInternalBeforeHandler|addInternalBeforeHandler|removeInternalBeforeHandler)\(el, events, handler\) \{\s+var elementCtx = getElementCtx\(el\);)/g,
            '$1\n    if (!elementCtx)\n        return;'
        )
        // and callbacks the parent registers through a wrapper of the frame's belong to the frame, so chrome never runs them:
        // keep the apis that take callbacks native there
        .replace(/if \(window\.EventTarget\)(\s+this\.overrideListenerMethodsInEventTarget\(\);)/, 'if (window.EventTarget && !rhScriptsBlockedFor(window))$1')
        .replace(/if \(window\.MutationObserver\)(\s+this\.overrideMutationObserverInWindow\(\);)/, 'if (window.MutationObserver && !rhScriptsBlockedFor(window))$1')
        .replace(
            /(TimersSandbox\.prototype\.attach = function \(window\) \{\s+_super\.prototype\.attach\.call\(this, window\);)/,
            '$1\n        if (rhScriptsBlockedFor(window)) {\n            this.setTimeout = window.setTimeout;\n            return;\n        }'
        )
        // and hammerhead's own messages and handlers there: nothing in the frame can receive them
        .replace(
            "return MessageSandbox._isWindowAvailable(targetWindow) && targetWindow.postMessage(message, '*', ports);",
            "return !rhScriptsBlockedFor(targetWindow) && MessageSandbox._isWindowAvailable(targetWindow) && targetWindow.postMessage(message, '*', ports);"
        )
        .replace(
            /(\s)(messageSandbox\.sendServiceMsg\(\{ cmd: GET_MESSAGE_PORT \}, window\.(top|rammerheadTop)\);)/,
            '$1if (!rhScriptsBlockedFor(window)) $2'
        )
        .replace(
            /(var eventCtx = this\.listeningCtx\.getEventCtx\(el, event_2\);)(\s+)(eventCtx\.outerHandlersWrapper = wrapper;)/,
            '$1$2if (eventCtx)$2    $3'
        )
        // poster isn't a url attribute, so it has no stored original to read back
        .replace(
            /(ATTRS_WITH_SPECIAL_PROXYING_LOGIC\.indexOf\(loweredAttr\) !== -1\) \{[\s\S]{0,1600}?)return getAttrMeth\.apply\(el, args\);/,
            "$1var rhResult = getAttrMeth.apply(el, args);\n        var rhSite = window['%hammerhead%'] && window['%hammerhead%'].rhSiteBlobUrl;\n        return rhSite && loweredAttr === 'poster' ? rhSite(rhResult) : rhResult;"
        )
        // blob urls handed out with the site's origin (hideProxyFromBlobUrls) read back that way from css
        .replace(
            'return parsedProxyUrl ? parsedProxyUrl.destUrl : url;',
            "return parsedProxyUrl ? parsedProxyUrl.destUrl : (window['%hammerhead%'] && window['%hammerhead%'].rhSiteBlobUrl ? window['%hammerhead%'].rhSiteBlobUrl(url) : url);"
        )
        // css in blobs (blob: stylesheets) gets processed like other css
        .replace(
            /(if \(WindowSandbox\.isProcessableBlob\(array, opts\)\)\s+array = \[processScript\([^\n]+\];)/g,
            "$1\n            else if (/^text\\/css\\s*(;|$)/i.test(String(opts && opts.type || '')) && WindowSandbox.isProcessableBlobParts(array))\n                array = [styleProcessor.process(array.join(''), getProxyUrl)];"
        )
        .replace(
            /var scriptURL = args\[0\];\s+if \(typeof scriptURL !== 'string'\)/,
            "var scriptURL = args[0], rhOriginalUrl = args[0];\n            if (typeof scriptURL !== 'string')"
        )
        .replace(
            /\? new nativeMethods\.Worker\(scriptURL\)\s*: new nativeMethods\.Worker\(scriptURL, args\[1\]\);/,
            '? new nativeMethods.Worker(rhSinkValue(scriptURL, rhOriginalUrl))\n                : new nativeMethods.Worker(rhSinkValue(scriptURL, rhOriginalUrl), args[1]);'
        )
        .replace(
            /if \(typeof tagString === 'string'\) \{\s+args\[0\] = processHtml\(tagString, \{/,
            "if (typeof tagString === 'string' || rhTrustedKind(tagString) === 'HTML') {\n                args[0] = processHtml(String(tagString), {"
        )
        .replace(
            /(processedContext: this\.startContainer && this\.startContainer\[INTERNAL_PROPS\.processedContext\],\s*\}\);)/,
            '$1 args[0] = rhSinkValue(args[0], tagString);'
        )
        .replace(
            /if \(args\.length > 1 && typeof str === 'string' && type === 'text\/html'\) \{\s+processedHtml = processHtml\(str\);\s+args\[0\] = processedHtml;/,
            "if (args.length > 1 && (typeof str === 'string' || rhTrustedKind(str) === 'HTML') && type === 'text/html') {\n                processedHtml = processHtml(String(str));\n                args[0] = rhSinkValue(processedHtml, str);"
        )
        // eval of a trusted script: processed (hammerhead let it run unprocessed), and trusted again
        .replace(
            /else if \(typeof script === 'string'\)\s+return processScript\(script, false\);\s+return script;/,
            "else if (typeof script === 'string')\n                    return processScript(script, false);\n                else if (rhTrustedKind(script) === 'Script')\n                    return rhTrusted('Script', processScript(String(script), false));\n                return script;"
        )
        .replace(
            /if \(typeof script === 'string'\)\s+script = processScript\(script\);\s+return evalFn\(script\);/,
            "if (typeof script === 'string')\n                        script = processScript(script);\n                    else if (rhTrustedKind(script) === 'Script')\n                        script = rhTrusted('Script', processScript(String(script)));\n                    return evalFn(script);"
        )
        .replace(
            /(overrideDescriptor\(constructor\.prototype, attr, \{\s*getter: function \(\) \{\s*return WindowSandbox\.getUrlAttr\(this, attr\);\s*\},\s*setter: function \(value\) \{\s*windowSandbox\.nodeSandbox\.element\.setAttributeCore\(this, \[attr, )value\]\);/,
            '$1rhPropertySink(this, attr, value)]);'
        )
        .replace(
            "windowSandbox.nodeSandbox.element.setAttributeCore(this, ['srcdoc', value]);",
            "windowSandbox.nodeSandbox.element.setAttributeCore(this, ['srcdoc', rhPropertySink(this, 'srcdoc', value)]);"
        )
        .replace(
            /(if \(isScriptElement\(el\)\)\s*return )(processScript\(processedText, true, false, convertToProxyUrl, void 0, settings\$1\.nativeAutomation\));/,
            '$1(rhNonceIfHashAllowed(el, processedText), rhRememberScriptSource($2, processedText));'
        )
        .replace(
            "var processedValue = value ? processScript(String(value), true, false, convertToProxyUrl, void 0, settings$1.nativeAutomation) : value;",
            "if (value) rhNonceIfHashAllowed(this, String(value)); var processedValue = value ? rhRememberScriptSource(processScript(String(value), true, false, convertToProxyUrl, void 0, settings$1.nativeAutomation), String(value)) : value;"
        )
        .replace(
            /(var isExecutableScript = !scriptType \|\| EXECUTABLE_SCRIPT_TYPES_REG_EX\.test\(scriptType\);\s*if \(isExecutableScript\) \{)/,
            '$1 rhNonceIfHashAllowed(script, scriptContent);'
        )
        .replace(
            /(if \(isScriptElement\(parentNode\)\)\s*return )(processScript\(str, true, false, convertToProxyUrl, void 0, settings\$1\.nativeAutomation\));/,
            '$1(rhNonceIfHashAllowed(parentNode, str), rhRememberScriptSource($2, str));'
        )
        .replace(
            /(else if \(isScriptEl\)\s*processedValue = )(processScript\(processedValue, true, false, convertToProxyUrl, void 0, settings\$1\.nativeAutomation\));/,
            '$1(rhNonceIfHashAllowed(el, processedValue), rhRememberScriptSource($2, processedValue));'
        )
        // document.write: trusted when everything the page wrote was
        .replace(
            'var result = this.writers.get(doc).write(args, ln, shouldEmitEvents);',
            'var rhPrevWrite = rhWriteTrusted; rhWriteTrusted = args.length > 0 && Array.prototype.every.call(args, function (a) { return rhTrustedKind(a) === "HTML"; });' +
                ' try { var result = this.writers.get(doc).write(args, ln, shouldEmitEvents); } finally { rhWriteTrusted = rhPrevWrite; }'
        )
        .replace(
            'var result = nativeWriteMethod.call(this.document, htmlChunk);',
            "var result = nativeWriteMethod.call(this.document, rhWriteTrusted ? rhTrusted('HTML', htmlChunk) : htmlChunk);"
        )
        .replace(
            'nativeMethods.nodeTextContentSetter.call(this.nonClosedEl, processedContent);',
            "rhSetText(this.nonClosedEl, rhWriteTrusted ? rhTrusted('Script', processedContent) : processedContent);"
        )
        .toString()
);

// fix the
// worker-hammerhead.js:2434 Uncaught TypeError: Cannot read properties of undefined (reading 'toString')
//     at worker-hammerhead.js:2434:35
fs.writeFileSync(
    path.join(__dirname, './client/worker-hammerhead.js'),
    throwOnUnmodifiedReplacers(
        fs.readFileSync(
            path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/worker-hammerhead.js'),
            'utf8'
        )
    )
        .replace(
            'proxyLocation.port.toString()',
            'proxyLocation.port?.toString() || (proxyLocation.protocol === "https:" ? 443 : 80)'
        )
        // pages hand out blob urls with the site's origin (hideProxyFromBlobUrls); the uuid is the real one's
        .replace(
            /(var getProxyUrl = function \(url, opts, nativeAutomation\) \{[\s\S]{0,400}?url = getURLString\(url\);)/,
            "$1\n      var rhBlob = /^blob:([^/]+\\/\\/[^/]+)\\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(url);\n      if (rhBlob && rhBlob[1] !== self.location.origin)\n          url = 'blob:' + self.location.origin + '/' + rhBlob[2];"
        )
        // the site's own importScripts calls through hammerhead's trusted types policy (made by the script header)
        .replace(
            'return nativeMethods.importScripts.apply(self, urls);',
            () =>
                'var rhPolicy = self["hammerhead|trusted-policy"]; if (rhPolicy) for (var rhI = 0; rhI < urls.length; rhI++) urls[rhI] = rhPolicy.createScriptURL(urls[rhI]);' +
                ' return nativeMethods.importScripts.apply(self, urls);'
        )
        .toString()
);

// fix the
// transport-worker.js:1022 Uncaught TypeError: Cannot read properties of undefined (reading 'toString')
//     at transport-worker.js:1022:38
fs.writeFileSync(
    path.join(__dirname, './client/transport-worker.js'),
    throwOnUnmodifiedReplacers(
        fs.readFileSync(
            path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/transport-worker.js'),
            'utf8'
        )
    )
        .replace(
            'proxyLocation.port.toString()',
            'proxyLocation.port?.toString() || (proxyLocation.protocol === "https:" ? 443 : 80)'
        )
        .toString()
);

const minify = (fileName, newFileName) => {
    // keep_fnames: wrappers named after natives (function Function, function Worker) show up in stack frames
    const minified = UglifyJS.minify(fs.readFileSync(path.join(__dirname, './client', fileName), 'utf8'), { keep_fnames: true });
    if (minified.error) {
        throw minified.error;
    }
    fs.writeFileSync(path.join(__dirname, './client', newFileName), minified.code, 'utf8');
};

minify('rammerhead.js', 'rammerhead.min.js');
minify('hammerhead.js', 'hammerhead.min.js');
minify('worker-hammerhead.js', 'worker-hammerhead.min.js');
minify('transport-worker.js', 'transport-worker.min.js');
