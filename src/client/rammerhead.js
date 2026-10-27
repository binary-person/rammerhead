(function () {
    var hammerhead = window['%hammerhead%'];
    if (!hammerhead) throw new Error('hammerhead not loaded yet');
    // the site's policies, next to what the browser got (see src/util/contentSecurityPolicy.js)
    try {
        var cspData = document.currentScript && document.currentScript.getAttribute('data-rh-csp');
        if (cspData && hammerhead.rhCspPolicies) {
            JSON.parse(atob(cspData)).forEach(function (pair) {
                hammerhead.rhCspPolicies.set(pair[0], pair[1]);
            });
        }
    } catch (e) {
        // no policies to map back
    }
    if (hammerhead.settings._settings.sessionId) {
        // task.js already loaded. this will likely never happen though since this file loads before task.js
        console.warn('unexpected task.js to load before rammerhead.js. url shuffling cannot be used');
        main();
    } else {
        // wait for task.js to load
        hookHammerheadStartOnce(main);
        // before task.js, we need to add url shuffling
        addUrlShuffling();
    }

    function main() {
        fixUrlRewrite();
        fixElementGetter();
        hideProxyFromPerformance();
        fixNavigationApi();
        fixUrlAttributeSelectors();
        fixLinkHrefRecalc();
        disableServiceWorkers();
        hideHammerheadKeys();
        hideHammerheadFromStacks();
        hideProxyFromBlobUrls();
        processStyleSheetText();
        proxyImageUrlProperties();
        applyPermissionsPolicy();
        hideProxyFromCspViolations();
        lowPowerWebGLInCrossOriginFrames();
        applyCookieSyncLetters();
        fixCrossWindowLocalStorage();
        addCloudflareChallengeSolver();
        rewriteTargetAttributeToSelf();
        dontShuffleWorkerUrls();

        delete window.overrideGetProxyUrl;
        delete window.overrideParseProxyUrl;
        delete window.overrideIsCrossDomainWindows;

        // other code if they want to also hook onto hammerhead start //
        if (window.rammerheadStartListeners) {
            for (const eachListener of window.rammerheadStartListeners) {
                try {
                    eachListener();
                } catch (e) {
                    console.error(e);
                }
            }
            delete window.rammerheadStartListeners;
        }

        // sync localStorage code //
        // disable if other code wants to implement their own localStorage site wrapper
        if (window.rammerheadDisableLocalStorageImplementation) {
            delete window.rammerheadDisableLocalStorageImplementation;
            // and in this page's about:blank frames (build.js passes it on when it starts them)
            hammerhead.rhLocalStorageOff = true;
            return;
        }
        // frames that can't run scripts can't run the sync's timer either (chrome logs each tick); the parent syncs the same origin
        if (hammerhead.rhScriptsBlocked && hammerhead.rhScriptsBlocked(window)) return;
        // consts
        var timestampKey = 'rammerhead_synctimestamp';
        var updateInterval = 5000;
        var isSyncing = false;

        var proxiedLocalStorage = localStorage;
        var realLocalStorage = proxiedLocalStorage.internal.nativeStorage;
        var sessionId = hammerhead.settings._settings.sessionId;
        var origin = window.__get$(window, 'location').origin;
        var keyChanges = [];

        try {
            syncLocalStorage();
        } catch (e) {
            if (e.message !== 'server wants to disable localStorage syncing') {
                throw e;
            }
            return;
        }
        proxiedLocalStorage.addChangeEventListener(function (event) {
            if (isSyncing) return;
            if (keyChanges.indexOf(event.key) === -1) keyChanges.push(event.key);
        });
        setInterval(function () {
            var update = compileUpdate();
            if (!update) return;
            localStorageRequest({ type: 'update', updateData: update }, function (data) {
                updateTimestamp(data.timestamp);
            });

            keyChanges = [];
        }, updateInterval);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                var update = compileUpdate();
                if (update) {
                    // even though we'll never get the timestamp, it's fine. this way,
                    // the data is safer
                    hammerhead.nativeMethods.sendBeacon.call(
                        window.navigator,
                        getSyncStorageEndpoint(),
                        JSON.stringify({
                            type: 'update',
                            updateData: update
                        })
                    );
                }
            }
        });

        function syncLocalStorage() {
            isSyncing = true;
            var timestamp = getTimestamp();
            var response;
            if (!timestamp) {
                // first time syncing
                response = localStorageRequest({ type: 'sync', fetch: true });
                if (response.timestamp) {
                    updateTimestamp(response.timestamp);
                    overwriteLocalStorage(response.data);
                }
            } else {
                // resync
                response = localStorageRequest({ type: 'sync', timestamp: timestamp, data: proxiedLocalStorage });
                if (response.timestamp) {
                    updateTimestamp(response.timestamp);
                    overwriteLocalStorage(response.data);
                }
            }
            isSyncing = false;

            function overwriteLocalStorage(data) {
                if (!data || typeof data !== 'object') throw new TypeError('data must be an object');
                proxiedLocalStorage.clear();
                for (var prop in data) {
                    proxiedLocalStorage[prop] = data[prop];
                }
            }
        }
        function updateTimestamp(timestamp) {
            if (!timestamp) throw new TypeError('timestamp must be defined');
            if (isNaN(parseInt(timestamp))) throw new TypeError('timestamp must be a number. received' + timestamp);
            realLocalStorage[timestampKey] = timestamp;
        }
        function getTimestamp() {
            var rawTimestamp = realLocalStorage[timestampKey];
            var timestamp = parseInt(rawTimestamp);
            if (isNaN(timestamp)) {
                if (rawTimestamp) {
                    console.warn('invalid timestamp retrieved from storage: ' + rawTimestamp);
                }
                return null;
            }
            return timestamp;
        }
        function getSyncStorageEndpoint() {
            return (
                '/syncLocalStorage?sessionId=' + encodeURIComponent(sessionId) + '&origin=' + encodeURIComponent(origin)
            );
        }
        function localStorageRequest(data, callback) {
            if (!data || typeof data !== 'object') throw new TypeError('data must be an object');

            var request = hammerhead.createNativeXHR();
            // make synchronous if there is no callback
            request.open('POST', getSyncStorageEndpoint(), !!callback);
            request.setRequestHeader('content-type', 'application/json');
            request.send(JSON.stringify(data));
            function check() {
                if (request.status === 404) {
                    throw new Error('server wants to disable localStorage syncing');
                }
                if (request.status !== 200)
                    throw new Error(
                        'server sent a non 200 code. got ' + request.status + '. Response: ' + request.responseText
                    );
            }
            if (!callback) {
                check();
                return JSON.parse(request.responseText);
            } else {
                request.onload = function () {
                    check();
                    callback(JSON.parse(request.responseText));
                };
            }
        }
        function compileUpdate() {
            if (!keyChanges.length) return null;

            var updates = {};
            for (var i = 0; i < keyChanges.length; i++) {
                updates[keyChanges[i]] = proxiedLocalStorage[keyChanges[i]];
            }

            keyChanges = [];
            return updates;
        }
    }

    var noShuffling = false;
    function addUrlShuffling() {
        // about:blank frames (hammerhead evaluates us into them) use their parent's dictionary
        let parentHammerhead = null;
        if (location.protocol === 'about:') {
            try {
                parentHammerhead = window.parent['%hammerhead%'];
            } catch (e) {
                // cross-origin parent
            }
        }
        let shuffleDict;
        let cacheTag;
        if (parentHammerhead && 'rhShuffleDict' in parentHammerhead) {
            shuffleDict = parentHammerhead.rhShuffleDict;
            cacheTag = parentHammerhead.rhCacheTag;
        } else {
            const request = new XMLHttpRequest();
            const sessionId = (location.pathname.slice(1).match(/^[a-z0-9]+/i) || [])[0];
            if (!sessionId) {
                console.warn('cannot get session id from url');
                return;
            }
            request.open('GET', '/api/dictionary?id=' + sessionId, false);
            request.send();
            if (request.status !== 200) {
                console.warn(
                    `received a non 200 status code while trying to fetch shuffleDict:\nstatus: ${request.status}\nresponse: ${request.responseText}`
                );
                return;
            }
            shuffleDict = JSON.parse(request.responseText);
            // deployment cache tag (header so old servers stay compatible)
            cacheTag = request.getResponseHeader('x-cache-tag');
        }
        hammerhead.rhShuffleDict = shuffleDict;
        hammerhead.rhCacheTag = cacheTag || null;
        // deployment cache tag: appended to rewritten resource urls so a
        // change in engine constants busts browser caches globally; stripped on
        // parse. never tag ws(s) urls (no server-side strip hook there)
        const tagSuffix = cacheTag ? '!v' + cacheTag : null;
        const appendCacheTag = function (url) {
            if (!tagSuffix || typeof url !== 'string' || url.endsWith(tagSuffix)) return url;
            if (/^wss?:/i.test(url)) return url;
            return url + tagSuffix;
        };
        // also before a query or fragment: a GET form puts its fields after its tagged action url
        const stripCacheTag = function (url) {
            if (!tagSuffix || typeof url !== 'string') return url;
            if (url.endsWith(tagSuffix)) return url.slice(0, -tagSuffix.length);
            const at = url.search(/[?#]/);
            if (at >= tagSuffix.length && url.slice(at - tagSuffix.length, at) === tagSuffix) return url.slice(0, at - tagSuffix.length) + url.slice(at);
            return url;
        };

        // no shuffling: the server still tags urls, so pages must still see them without the tag
        if (!shuffleDict) {
            if (!tagSuffix) return;
            const getProxyUrl = hammerhead.utils.url.getProxyUrl;
            const parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
            hammerhead.utils.url.overrideGetProxyUrl((url, opts) => appendCacheTag(getProxyUrl(url, opts)));
            hammerhead.utils.url.overrideParseProxyUrl((url) => parseProxyUrl(stripCacheTag(url)));
            window.overrideGetProxyUrl((getProxyUrl$1) => (url, opts) => appendCacheTag(getProxyUrl$1(url, opts)));
            window.overrideParseProxyUrl((parseProxyUrl$1) => (url) => parseProxyUrl$1(stripCacheTag(url)));
            return;
        }

        // pasting entire thing here "because lazy" - m28
        const mod = (n, m) => ((n % m) + m) % m;
        const baseDictionary = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~-';
        const shuffledIndicator = '_rhs';
        const generateDictionary = function () {
            let str = '';
            const split = baseDictionary.split('');
            while (split.length > 0) {
                str += split.splice(Math.floor(Math.random() * split.length), 1)[0];
            }
            return str;
        };
        class StrShuffler {
            constructor(dictionary = generateDictionary()) {
                this.dictionary = dictionary;
            }
            shuffle(str) {
                if (window.rhDisableShuffling) {
                    return str;
                }

                if (str.startsWith(shuffledIndicator)) {
                    return str;
                }
                let shuffledStr = '';
                for (let i = 0; i < str.length; i++) {
                    const char = str.charAt(i);
                    const idx = baseDictionary.indexOf(char);
                    if (char === '%' && str.length - i >= 3) {
                        shuffledStr += char;
                        shuffledStr += str.charAt(++i);
                        shuffledStr += str.charAt(++i);
                    } else if (idx === -1) {
                        shuffledStr += char;
                    } else {
                        shuffledStr += this.dictionary.charAt(mod(idx + i, baseDictionary.length));
                    }
                }
                return shuffledIndicator + shuffledStr;
            }
            unshuffle(str) {
                if (!str.startsWith(shuffledIndicator)) {
                    return str;
                }

                str = str.slice(shuffledIndicator.length);

                let unshuffledStr = '';
                for (let i = 0; i < str.length; i++) {
                    const char = str.charAt(i);
                    const idx = this.dictionary.indexOf(char);
                    if (char === '%' && str.length - i >= 3) {
                        unshuffledStr += char;
                        unshuffledStr += str.charAt(++i);
                        unshuffledStr += str.charAt(++i);
                    } else if (idx === -1) {
                        unshuffledStr += char;
                    } else {
                        unshuffledStr += baseDictionary.charAt(mod(idx - i, baseDictionary.length));
                    }
                }
                return unshuffledStr;
            }
        }

        const replaceUrl = (url, replacer) => {
            //        regex:              https://google.com/    sessionid/   url
            return (url || '').replace(/^((?:[a-z0-9]+:\/\/[^/]+)?(?:\/[^/]+\/))([^]+)/i, function (_, g1, g2) {
                return g1 + replacer(g2);
            });
        };
        const shuffler = new StrShuffler(shuffleDict);

        // shuffle current url if it isn't already shuffled (unshuffled urls likely come from user input)
        const oldUrl = location.href;
        const newUrl = replaceUrl(location.href, (url) => shuffler.shuffle(url));
        if (oldUrl !== newUrl) {
            history.replaceState(null, null, newUrl);
        }

        const getProxyUrl = hammerhead.utils.url.getProxyUrl;
        const parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
        hammerhead.utils.url.overrideGetProxyUrl(function (url, opts) {
            if (noShuffling || (opts && opts.rhNoShuffle)) {
                return appendCacheTag(getProxyUrl(url, opts));
            }
            return appendCacheTag(replaceUrl(getProxyUrl(url, opts), (u) => shuffler.shuffle(u), true));
        });
        // the tag can be on either side of the shuffle: added after it (server redirects) or shuffled with the url
        // (urls built from an already tagged one, like form actions), so it comes off before and after unshuffling
        hammerhead.utils.url.overrideParseProxyUrl(function (url) {
            return parseProxyUrl(stripCacheTag(replaceUrl(stripCacheTag(url), (u) => shuffler.unshuffle(u), false)));
        });
        // manual hooks //
        window.overrideGetProxyUrl(
            (getProxyUrl$1) =>
                function (url, opts) {
                    if (noShuffling || (opts && opts.rhNoShuffle)) {
                        return appendCacheTag(getProxyUrl$1(url, opts));
                    }
                    return appendCacheTag(replaceUrl(getProxyUrl$1(url, opts), (u) => shuffler.shuffle(u), true));
                }
        );
        window.overrideParseProxyUrl(
            (parseProxyUrl$1) =>
                function (url) {
                    return parseProxyUrl$1(stripCacheTag(replaceUrl(stripCacheTag(url), (u) => shuffler.unshuffle(u), false)));
                }
        );
    }
    function fixUrlRewrite() {
        // fix about:blank frames (cloudflare's bot check adds its script from one) building urls on port 80: their
        // location isn't the proxy's, so take the first proxied ancestor's
        let proxyLocation = location;
        try {
            for (let w = window; w.location.protocol === 'about:' && w.parent !== w; w = w.parent) proxyLocation = w.parent.location;
        } catch (e) {
            // cross-origin ancestor: keep the last one we could read
        }
        const port = proxyLocation.port || (proxyLocation.protocol === 'https:' ? '443' : '80');
        const getProxyUrl = hammerhead.utils.url.getProxyUrl;
        hammerhead.utils.url.overrideGetProxyUrl(function (url, opts = {}) {
            if (!opts.proxyPort) {
                opts.proxyPort = port;
            }
            return getProxyUrl(url, opts);
        });
        window.overrideParseProxyUrl(
            (parseProxyUrl$1) =>
                function (url) {
                    const parsed = parseProxyUrl$1(url);
                    if (!parsed || !parsed.proxy) return parsed;
                    if (!parsed.proxy.port) {
                        parsed.proxy.port = port;
                    }
                    return parsed;
                }
        );
    }
    function fixElementGetter() {
        const fixList = {
            HTMLAnchorElement: ['href'],
            HTMLAreaElement: ['href'],
            HTMLBaseElement: ['href'],
            HTMLEmbedElement: ['src'],
            HTMLFormElement: ['action'],
            HTMLFrameElement: ['src'],
            HTMLIFrameElement: ['src'],
            HTMLImageElement: ['src'],
            HTMLInputElement: ['src'],
            HTMLLinkElement: ['href'],
            HTMLMediaElement: ['src'],
            HTMLModElement: ['cite'],
            HTMLObjectElement: ['data'],
            HTMLQuoteElement: ['cite'],
            HTMLScriptElement: ['src'],
            HTMLSourceElement: ['src'],
            HTMLTrackElement: ['src']
        };
        const urlRewrite = (url) => {
            if (hammerhead.rhSiteBlobUrl) url = hammerhead.rhSiteBlobUrl(url);
            return (hammerhead.utils.url.parseProxyUrl(url) || {}).destUrl || url;
        };
        for (const ElementClass in fixList) {
            for (const attr of fixList[ElementClass]) {
                if (!window[ElementClass]) {
                    console.warn('unexpected unsupported element class ' + ElementClass);
                    continue;
                }
                const desc = Object.getOwnPropertyDescriptor(window[ElementClass].prototype, attr);
                const originalGet = desc.get;
                const originalSet = desc.set;
                // overrideDescriptor keeps the accessors looking native
                hammerhead.utils.overriding.overrideDescriptor(window[ElementClass].prototype, attr, {
                    getter: function () {
                        return urlRewrite(originalGet.call(this));
                    },
                    // don't shuffle form action urls
                    setter:
                        attr === 'action'
                            ? function (value) {
                                  noShuffling = true;
                                  try {
                                      var returnVal = originalSet.call(this, value);
                                  } catch (e) {
                                      noShuffling = false;
                                      throw e;
                                  }
                                  noShuffling = false;
                                  return returnVal;
                              }
                            : null
                });
            }
        }
    }
    // hide proxy urls and rammerhead's own requests from performance entries (anti-bot scripts read them)
    function hideProxyFromPerformance() {
        if (typeof PerformanceEntry === 'undefined') return;
        const { overrideFunction, overrideDescriptor } = hammerhead.utils.overriding;
        const parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
        const proxyOrigin = location.origin;
        const nameGetter = Object.getOwnPropertyDescriptor(PerformanceEntry.prototype, 'name').get;
        const entryTypeGetter = Object.getOwnPropertyDescriptor(PerformanceEntry.prototype, 'entryType').get;
        const isInternalUrl = (url) => typeof url === 'string' && url.startsWith(proxyOrigin + '/') && !parseProxyUrl(url);
        const toSiteUrl = (url) => {
            const parsed = typeof url === 'string' && url.startsWith(proxyOrigin + '/') && parseProxyUrl(url);
            return parsed ? parsed.destUrl : url;
        };
        const isInternal = (entry) => isInternalUrl(nameGetter.call(entry));
        for (const Owner of [window.Performance, window.PerformanceObserverEntryList]) {
            if (!Owner) continue;
            for (const method of ['getEntries', 'getEntriesByType', 'getEntriesByName']) {
                const nativeMethod = Owner.prototype[method];
                if (typeof nativeMethod !== 'function') continue;
                overrideFunction(Owner.prototype, method, function () {
                    return nativeMethod.apply(this, arguments).filter((entry) => !isInternal(entry));
                });
            }
        }
        // long animation frames list the scripts that ran: drop hammerhead's, show sites' urls
        if (window.PerformanceLongAnimationFrameTiming && window.PerformanceScriptTiming) {
            const scriptsGetter = Object.getOwnPropertyDescriptor(PerformanceLongAnimationFrameTiming.prototype, 'scripts');
            const sourceUrlGetter = Object.getOwnPropertyDescriptor(PerformanceScriptTiming.prototype, 'sourceURL');
            if (scriptsGetter && scriptsGetter.get && sourceUrlGetter && sourceUrlGetter.get) {
                overrideDescriptor(PerformanceLongAnimationFrameTiming.prototype, 'scripts', {
                    getter: function () {
                        return scriptsGetter.get.call(this).filter((script) => !isInternalUrl(sourceUrlGetter.get.call(script)));
                    },
                    setter: null
                });
                overrideDescriptor(PerformanceScriptTiming.prototype, 'sourceURL', {
                    getter: function () {
                        return toSiteUrl(sourceUrlGetter.get.call(this));
                    },
                    setter: null
                });
            }
        }
        if (!window.PerformanceResourceTiming) return;
        // the site's timing-allow-origin and original sizes, from the "rh" server-timing entry
        // (see src/util/resourceTiming.js), else from rewritten scripts' headers (scriptPositions.js)
        const proto = PerformanceResourceTiming.prototype;
        const serverTimingGetter = Object.getOwnPropertyDescriptor(proto, 'serverTiming');
        const serverNameGetter = window.PerformanceServerTiming && Object.getOwnPropertyDescriptor(PerformanceServerTiming.prototype, 'name').get;
        const serverDescriptionGetter = window.PerformanceServerTiming && Object.getOwnPropertyDescriptor(PerformanceServerTiming.prototype, 'description').get;
        const isMeta = (timing) => serverNameGetter && serverNameGetter.call(timing) === 'rh';
        const metaCache = new WeakMap();
        const metaFor = (entry) => {
            if (metaCache.has(entry)) return metaCache.get(entry);
            let meta = null;
            try {
                const list = serverTimingGetter && serverTimingGetter.get ? serverTimingGetter.get.call(entry) : [];
                for (const timing of list) if (isMeta(timing)) meta = JSON.parse(atob(serverDescriptionGetter.call(timing)));
            } catch (e) {
                meta = null;
            }
            metaCache.set(entry, meta);
            return meta;
        };
        const registrySizes = (entry) => {
            const name = nameGetter.call(entry);
            const sizes = hammerhead.rhResourceSizes;
            if (!sizes || typeof name !== 'string') return undefined;
            const parsed = sizes.has(name) ? null : parseProxyUrl(name);
            return sizes.get(name) || (parsed && sizes.get(parsed.destUrl.split('#')[0]));
        };
        const siteOrigin = () => window.__get$(window, 'location').origin;
        // cross-origin without timing-allow-origin: browsers zero these out
        const restricted = (entry) => {
            if (entryTypeGetter.call(entry) !== 'resource') return false;
            const meta = metaFor(entry);
            const parsed = parseProxyUrl(nameGetter.call(entry));
            if (!meta || !parsed) return false;
            let resourceOrigin;
            try {
                resourceOrigin = new URL(parsed.destUrl).origin;
            } catch (e) {
                return false;
            }
            const page = siteOrigin();
            if (resourceOrigin === page) return false;
            const allowed = String(meta.t)
                .split(',')
                .map((v) => v.trim());
            return !(allowed.includes('*') || allowed.includes(page));
        };
        const ZEROED = [
            'transferSize', 'encodedBodySize', 'decodedBodySize', 'redirectStart', 'redirectEnd', 'domainLookupStart',
            'domainLookupEnd', 'connectStart', 'connectEnd', 'secureConnectionStart', 'requestStart', 'responseStart',
            'firstInterimResponseStart', 'finalResponseHeadersStart', 'responseStatus'
        ];
        const EMPTIED = ['nextHopProtocol', 'contentType', 'contentEncoding', 'deliveryType'];
        const getters = {};
        for (const prop of ZEROED.concat(EMPTIED)) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
            if (descriptor && descriptor.get) getters[prop] = descriptor.get;
        }
        const adjust = (entry, prop, value) => {
            if (restricted(entry)) {
                if (ZEROED.includes(prop)) return 0;
                if (EMPTIED.includes(prop)) return '';
            }
            if (prop !== 'decodedBodySize' && prop !== 'encodedBodySize' && prop !== 'transferSize') return value;
            const meta = metaFor(entry);
            const sizes = (meta && meta.s) || registrySizes(entry);
            if (!sizes || !value) return value;
            if (prop === 'decodedBodySize') return sizes[0];
            if (prop === 'encodedBodySize') return sizes[1];
            // transferSize: headers plus body (0 when served from cache, handled by !value above)
            return Math.max(0, value - getters.encodedBodySize.call(entry)) + sizes[1];
        };
        for (const prop of Object.keys(getters)) {
            const nativeGetter = getters[prop];
            overrideDescriptor(proto, prop, {
                getter: function () {
                    return adjust(this, prop, nativeGetter.call(this));
                },
                setter: null
            });
        }
        if (serverTimingGetter && serverTimingGetter.get) {
            overrideDescriptor(proto, 'serverTiming', {
                getter: function () {
                    if (restricted(this)) return [];
                    return serverTimingGetter.get.call(this).filter((timing) => !isMeta(timing));
                },
                setter: null
            });
        }
        // toJSON() reads everything natively
        for (const Owner of [window.PerformanceEntry, window.PerformanceResourceTiming, window.PerformanceNavigationTiming]) {
            if (!Owner || !Object.prototype.hasOwnProperty.call(Owner.prototype, 'toJSON')) continue;
            const nativeToJSON = Owner.prototype.toJSON;
            overrideFunction(Owner.prototype, 'toJSON', function () {
                const json = nativeToJSON.apply(this, arguments);
                if (!json) return json;
                if (this instanceof PerformanceResourceTiming) {
                    for (const prop of Object.keys(getters)) if (prop in json) json[prop] = adjust(this, prop, json[prop]);
                    if (Array.isArray(json.serverTiming)) {
                        json.serverTiming = restricted(this) ? [] : json.serverTiming.filter((timing) => timing.name !== 'rh');
                    }
                }
                if (typeof json.name === 'string') json.name = toSiteUrl(json.name);
                return json;
            });
        }
        overrideDescriptor(PerformanceEntry.prototype, 'name', {
            getter: function () {
                const name = nameGetter.call(this);
                const parsed = typeof name === 'string' && name.startsWith(proxyOrigin + '/') && parseProxyUrl(name);
                return parsed ? parsed.destUrl : name;
            },
            setter: null
        });
    }
    // fix sites that route with the navigation api (instagram) seeing the proxy url and showing "page isn't available":
    // entries and navigate events report the site's urls, and navigation.navigate() goes through the proxy
    function fixNavigationApi() {
        if (typeof NavigationHistoryEntry === 'undefined' || typeof Navigation === 'undefined') return;
        const { overrideFunction, overrideDescriptor } = hammerhead.utils.overriding;
        const parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
        const proxyOrigin = location.origin;
        const toSiteUrl = (url) => {
            const parsed = typeof url === 'string' && url.startsWith(proxyOrigin + '/') && parseProxyUrl(url);
            return parsed ? parsed.destUrl : url;
        };
        for (const [Proto, prop] of [[window.NavigationHistoryEntry, 'url'], [window.NavigationDestination, 'url']]) {
            const descriptor = Proto && Object.getOwnPropertyDescriptor(Proto.prototype, prop);
            if (!descriptor || !descriptor.get) continue;
            overrideDescriptor(Proto.prototype, prop, {
                getter: function () {
                    return toSiteUrl(descriptor.get.call(this));
                },
                setter: null
            });
        }
        const nativeNavigate = Navigation.prototype.navigate;
        if (typeof nativeNavigate === 'function') {
            overrideFunction(Navigation.prototype, 'navigate', function (url) {
                const args = Array.prototype.slice.call(arguments);
                if (typeof url === 'string' || url instanceof URL) {
                    const current = parseProxyUrl(location.href);
                    const siteUrl = new URL(String(url), current ? current.destUrl : location.href).href;
                    args[0] = hammerhead.utils.url.getProxyUrl(siteUrl, { resourceType: current && current.resourceType });
                }
                return nativeNavigate.apply(this, args);
            });
        }
    }
    // fix selectors on url attributes missing their elements (onetrust's script[src*='otSDKStub'], so cookie banners
    // on many sites broke): the attribute holds the proxy url, so match the site's url hammerhead keeps next to it
    function fixUrlAttributeSelectors() {
        const { overrideFunction } = hammerhead.utils.overriding;
        const NodeSandbox = hammerhead.sandbox.node.constructor;
        if (typeof NodeSandbox.processSelector !== 'function') return;
        const postfix = '-hammerhead-stored-value';
        const urlAttr = /\[\s*(href|src|action|formaction|manifest|data)\s*([~|^$*]?=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\]\s]+)\s*([is])?\s*\]/gi;
        const cache = new Map();
        // hammerhead only mapped = and ^= to the stored attribute: every operator now, falling back to the attribute
        // itself on elements hammerhead didn't store a url for
        NodeSandbox._processAttributeSelector = function (selector) {
            if (typeof selector !== 'string' || selector.indexOf('[') === -1) return selector;
            let out = cache.get(selector);
            if (out === undefined) {
                out = selector.replace(urlAttr, (_, attr, op, value, flag) => {
                    const test = op + value + (flag ? ' ' + flag : '');
                    return ':is([' + attr + postfix + test + '],[' + attr + test + ']:not([' + attr + postfix + ']))';
                });
                if (cache.size > 500) cache.clear();
                cache.set(selector, out);
            }
            return out;
        };
        // these never went through hammerhead's selector processing
        if (window.Element) {
            for (const name of ['matches', 'closest', 'webkitMatchesSelector']) {
                const native = Element.prototype[name];
                if (typeof native !== 'function') continue;
                overrideFunction(Element.prototype, name, function (selector) {
                    const args = Array.prototype.slice.call(arguments);
                    args[0] = NodeSandbox.processSelector(selector);
                    return native.apply(this, args);
                });
            }
        }
    }
    // service workers are off: hammerhead registered every site's worker at the proxy's root (each replaced the
    // last and sat in front of every page on the proxy, the browser included), and workers can't read shuffled urls
    // to do their job. register() rejects like a browser without them (sites already handle that); existing ones go
    function disableServiceWorkers() {
        const Container = window.ServiceWorkerContainer;
        const nm = hammerhead.nativeMethods;
        if (!Container || !navigator.serviceWorker) return;
        const { overrideFunction } = hammerhead.utils.overriding;
        const nativeGetRegistrations = Container.prototype.getRegistrations;
        // hammerhead's own wrappers are in the way (overrideFunction only replaces natives): natives back first
        if (nm.registerServiceWorker) Container.prototype.register = nm.registerServiceWorker;
        if (nm.getRegistrationServiceWorker) Container.prototype.getRegistration = nm.getRegistrationServiceWorker;
        overrideFunction(Container.prototype, 'register', function () {
            return Promise.reject(new DOMException('Failed to register a ServiceWorker: The operation is insecure.', 'SecurityError'));
        });
        overrideFunction(Container.prototype, 'getRegistration', function () {
            return Promise.resolve(undefined);
        });
        overrideFunction(Container.prototype, 'getRegistrations', function () {
            return Promise.resolve([]);
        });
        nativeGetRegistrations
            .call(navigator.serviceWorker)
            .then((regs) => {
                for (const reg of regs) reg.unregister();
            })
            .catch(() => {});
    }
    // hammerhead re-proxies a link's href when rel/as change how it loads (preload as=script, modulepreload) by passing
    // the href attribute itself, already proxied, as the site's value: the stored original got overwritten with the
    // proxy url, so getAttribute('href') showed it. pass the original instead
    function fixLinkHrefRecalc() {
        const elementSandbox = hammerhead.sandbox.node.element;
        const nativeMethods = hammerhead.nativeMethods;
        const setAttributeCore = elementSandbox && elementSandbox.setAttributeCore;
        if (typeof setAttributeCore !== 'function') return;
        const storedHref = 'href-hammerhead-stored-value';
        elementSandbox.setAttributeCore = function (el, args, isNs) {
            if (!isNs && args.length > 1 && String(args[0]).toLowerCase() === 'href' &&
                el && nativeMethods.hasAttribute.call(el, storedHref) &&
                args[1] === nativeMethods.getAttribute.call(el, 'href')) {
                args = Array.prototype.slice.call(args);
                args[1] = nativeMethods.getAttribute.call(el, storedHref);
            }
            return setAttributeCore.call(this, el, args, isNs);
        };
    }
    // hide hammerhead's globals and element/function props from key listings (anti-bot scripts enumerate them)
    function hideHammerheadKeys() {
        const { overrideFunction } = hammerhead.utils.overriding;
        const hidden =
            /^(%(is-)?hammerhead%$|hammerhead\||__[a-zA-Z]+\$|rammerhead(Top|Parent|AncestorOrigins)$|distanceRammerheadTopToTop$|isWindowBeyondRammerhead$|override(Get|Parse)ProxyUrl$)/;
        // spelled out so deploy builds rename them too (a regex keeps matching the original names only)
        const engineNames = [
            '%hammerhead%', '__get$', '__set$', '__call$', '__get$Loc', '__set$Loc', '__get$Eval', '__get$PostMessage',
            '__get$ProxyUrl', '__proc$Script', '__proc$Html', '__getWorkerSettings$', '__rest$Object', '__rest$Array',
            '__arrayFrom$', '_hh$temp'
        ];
        const visible = (key) =>
            typeof key !== 'string' || !(hidden.test(key) || engineNames.some((name) => key.startsWith(name)));
        const onlyVisible = (keys) => {
            const result = [];
            for (let i = 0; i < keys.length; i++) if (visible(keys[i])) result.push(keys[i]);
            return result;
        };
        for (const [owner, name] of [
            [Object, 'keys'],
            [Object, 'getOwnPropertyNames'],
            [Reflect, 'ownKeys']
        ]) {
            const nativeFn = owner[name];
            overrideFunction(owner, name, function () {
                return onlyVisible(nativeFn.apply(this, arguments));
            });
        }
        const nativeEntries = Object.entries;
        const visibleEntries = (entries) => {
            const result = [];
            for (let i = 0; i < entries.length; i++) if (visible(entries[i][0])) result.push(entries[i]);
            return result;
        };
        overrideFunction(Object, 'entries', function () {
            return visibleEntries(nativeEntries.apply(this, arguments));
        });
        overrideFunction(Object, 'values', function () {
            const entries = visibleEntries(nativeEntries.apply(this, arguments));
            const result = [];
            for (let i = 0; i < entries.length; i++) result.push(entries[i][1]);
            return result;
        });
        const nativeDescriptors = Object.getOwnPropertyDescriptors;
        const nativeNames = Object.getOwnPropertyNames;
        overrideFunction(Object, 'getOwnPropertyDescriptors', function () {
            const descriptors = nativeDescriptors.apply(this, arguments);
            for (const key of nativeNames(descriptors)) if (!visible(key)) delete descriptors[key];
            return descriptors;
        });
    }
    // drop hammerhead's frames from stack traces and show sites' urls instead of proxy urls
    function hideHammerheadFromStacks() {
        if (typeof Error.captureStackTrace !== 'function') return;
        const parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
        const proxyOrigin = location.origin;
        const internal = new RegExp('^' + proxyOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^/]*\\.js(\\?|$)');
        const proxyUrls = new RegExp(proxyOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^\\s)]+', 'g');
        const toDest = (text) =>
            text.replace(proxyUrls, (url) => {
                const position = /(:\d+){1,2}$/.exec(url);
                const bare = position ? url.slice(0, position.index) : url;
                const parsed = parseProxyUrl(bare);
                return parsed ? parsed.destUrl + (position ? position[0] : '') : url;
            });
        // positions in rewritten scripts, mapped back to the site's (see src/util/scriptPositions.js, keep in sync)
        const decoded = new Map();
        const decode = (deltas) => {
            const flat = [];
            const prev = [0, 0, 0, 0, 0, 0];
            for (let k = 0; k < deltas.length; k += 6) {
                for (let n = 0; n < 6; n += 2) {
                    const line = prev[n] + deltas[k + n];
                    prev[n + 1] = line === prev[n] ? prev[n + 1] + deltas[k + n + 1] : deltas[k + n + 1];
                    prev[n] = line;
                }
                flat.push(...prev);
            }
            return flat;
        };
        const before = (al, ac, bl, bc) => al < bl || (al === bl && ac < bc);
        const mapPosition = (flat, line, column) => {
            const l = line - 1;
            const c = column - 1;
            let lo = 0;
            let hi = flat.length / 6 - 1;
            let hit = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (before(l, c, flat[mid * 6], flat[mid * 6 + 1])) hi = mid - 1;
                else (hit = mid), (lo = mid + 1);
            }
            if (hit === -1) return null;
            const [pl, pc, el, ec, ol, oc] = flat.slice(hit * 6, hit * 6 + 6);
            if (before(l, c, el, ec)) return l === pl ? [ol + 1, oc + (c - pc) + 1] : [ol + (l - pl) + 1, c + 1];
            const next = flat.slice((hit + 1) * 6, (hit + 1) * 6 + 6);
            if (!next.length) return null;
            const gapLine = ol + (el - pl);
            const gapCol = el === pl ? oc + (ec - pc) : ec;
            return before(next[4], next[5], gapLine, gapCol) ? [next[4] + 1, next[5] + 1] : [gapLine + 1, gapCol + 1];
        };
        const formatFrame = (frame) => {
            let text = String(frame);
            const file = frame.getFileName();
            const registry = hammerhead.rhPositions;
            let positions = registry && file && registry.get(file);
            if (registry && file && !positions) {
                const parsed = parseProxyUrl(file);
                positions = parsed && registry.get(parsed.destUrl.split('#')[0]);
            }
            if (positions) {
                if (!decoded.has(file)) decoded.set(file, decode(positions));
                const mapped = mapPosition(decoded.get(file), frame.getLineNumber(), frame.getColumnNumber());
                if (mapped) text = text.replace(/:\d+:\d+(\)?)$/, ':' + mapped[0] + ':' + mapped[1] + '$1');
            }
            return toDest(text);
        };
        // room for hammerhead's frames (dropped below); the site keeps seeing its own limit
        hammerhead.rhSiteStackTraceLimit = Error.stackTraceLimit;
        if (typeof Error.stackTraceLimit === 'number') Error.stackTraceLimit += 50;
        let sitePrepare;
        const prepare = function (error, frames) {
            // hammerhead's own frames, including wrappers it built with Function (eval frames)
            let kept = frames.filter(
                (frame) =>
                    !internal.test(frame.getFileName() || '') &&
                    !(frame.isEval() && /\/(hammerhead|rammerhead)\.js:/.test(frame.getEvalOrigin() || ''))
            );
            const siteLimit = hammerhead.rhSiteStackTraceLimit;
            if (typeof siteLimit === 'number' && siteLimit >= 0) kept = kept.slice(0, siteLimit);
            if (sitePrepare) return sitePrepare(error, kept);
            let header;
            try {
                header = String(error);
            } catch (e) {
                header = 'Error';
            }
            return header + kept.map((frame) => '\n    at ' + formatFrame(frame)).join('');
        };
        Object.defineProperty(Error, 'prepareStackTrace', {
            get: () => prepare,
            set: (value) => {
                sitePrepare = typeof value === 'function' ? value : undefined;
            },
            configurable: true,
            enumerable: false
        });
    }
    // blob urls carry the page's origin: hand out ones with the site's origin, and use the real ones underneath
    function hideProxyFromBlobUrls() {
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
        const { overrideFunction } = hammerhead.utils.overriding;
        const proxyPrefix = 'blob:' + location.origin + '/';
        const sitePrefix = () => 'blob:' + window.__get$(window, 'location').origin + '/';
        // shared by every frame, since a blob url made in one can be used in another
        let shared = hammerhead;
        try {
            shared = window.rammerheadTop['%hammerhead%'] || hammerhead;
        } catch (e) {
            // a cross-origin top keeps its own
        }
        const realOf = shared.rhBlobUrls || (shared.rhBlobUrls = new Map());
        const siteOf = shared.rhSiteBlobUrls || (shared.rhSiteBlobUrls = new Map());
        const toReal = (url) => (typeof url === 'string' && realOf.has(url) ? realOf.get(url) : url);
        // blob urls inside a value (srcset, css)
        const BLOB_URL = /blob:[^\s"'()<>,]+?\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const mapIn = (map) => (value) =>
            typeof value === 'string' && value.indexOf('blob:') !== -1
                ? value.replace(BLOB_URL, (url) => (map.has(url) ? map.get(url) : url))
                : value;
        // element attributes, srcset and css skip getProxyUrl for blob: urls
        hammerhead.rhRealBlobUrl = mapIn(realOf);
        hammerhead.rhSiteBlobUrl = mapIn(siteOf);
        const nativeCreate = URL.createObjectURL;
        const nativeRevoke = URL.revokeObjectURL;
        overrideFunction(URL, 'createObjectURL', function () {
            const real = nativeCreate.apply(this, arguments);
            if (typeof real !== 'string' || !real.startsWith(proxyPrefix)) return real;
            const site = sitePrefix() + real.slice(proxyPrefix.length);
            realOf.set(site, real);
            siteOf.set(real, site);
            return site;
        });
        overrideFunction(URL, 'revokeObjectURL', function (url) {
            const real = toReal(url);
            realOf.delete(url);
            siteOf.delete(real);
            return nativeRevoke.call(this, real);
        });
        const getProxyUrl = hammerhead.utils.url.getProxyUrl;
        hammerhead.utils.url.overrideGetProxyUrl(function (url, opts) {
            return getProxyUrl(hammerhead.rhRealBlobUrl(url), opts);
        });
    }
    // srcset set as a property loaded unproxied until the image was added to the page, and poster skipped the blob url mapping
    function proxyImageUrlProperties() {
        const { overrideDescriptor } = hammerhead.utils.overriding;
        const setAttribute = Element.prototype.setAttribute;
        const getAttribute = Element.prototype.getAttribute;
        const poster = window.HTMLVideoElement && Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'poster');
        if (poster && poster.get && poster.set) {
            overrideDescriptor(HTMLVideoElement.prototype, 'poster', {
                getter: function () {
                    const value = poster.get.call(this);
                    return hammerhead.rhSiteBlobUrl ? hammerhead.rhSiteBlobUrl(value) : value;
                },
                setter: function (value) {
                    setAttribute.call(this, 'poster', value);
                }
            });
        }
        for (const ElementClass of [window.HTMLImageElement, window.HTMLSourceElement]) {
            const desc = ElementClass && Object.getOwnPropertyDescriptor(ElementClass.prototype, 'srcset');
            if (!desc || !desc.get || !desc.set) continue;
            overrideDescriptor(ElementClass.prototype, 'srcset', {
                getter: function () {
                    const value = getAttribute.call(this, 'srcset');
                    return value === null ? '' : value;
                },
                setter: function (value) {
                    setAttribute.call(this, 'srcset', value);
                }
            });
        }
    }
    // constructed stylesheets weren't processed, and rules' cssText showed proxy urls
    function processStyleSheetText() {
        if (typeof CSSStyleSheet === 'undefined') return;
        const { overrideFunction, overrideDescriptor } = hammerhead.utils.overriding;
        const styleProcessor = hammerhead.processors.styleProcessor;
        const process = (css) => styleProcessor.process(css, hammerhead.utils.url.getProxyUrl);
        for (const name of ['replace', 'replaceSync']) {
            const native = CSSStyleSheet.prototype[name];
            if (typeof native !== 'function') continue;
            overrideFunction(CSSStyleSheet.prototype, name, function (text) {
                const args = Array.prototype.slice.call(arguments);
                if (typeof text === 'string') args[0] = process(text);
                return native.apply(this, args);
            });
        }
        const cssText = window.CSSRule && Object.getOwnPropertyDescriptor(CSSRule.prototype, 'cssText');
        if (cssText && cssText.get) {
            overrideDescriptor(CSSRule.prototype, 'cssText', {
                getter: function () {
                    return styleProcessor.cleanUp(cssText.get.call(this), hammerhead.utils.url.parseProxyUrl);
                },
                setter: null
            });
        }
    }
    // cross-origin iframes can't use these permissions unless the iframe's allow attribute delegates them.
    // through the proxy every frame is same-origin, so they answered "prompt" where browsers say "denied"
    function applyPermissionsPolicy() {
        // what chromium reports "denied" for in a cross-origin iframe without allow=
        const SELF_ONLY = [
            'geolocation', 'camera', 'microphone', 'midi', 'clipboard-read', 'clipboard-write', 'display-capture',
            'screen-wake-lock', 'local-fonts', 'window-management', 'idle-detection', 'captured-surface-control',
            'summarizer', 'translator', 'language-detector', 'language-model', 'writer', 'rewriter', 'proofreader'
        ];
        // built-in ai apis behind those features
        const AI_APIS = {
            Summarizer: 'summarizer',
            Translator: 'translator',
            LanguageDetector: 'language-detector',
            LanguageModel: 'language-model',
            Writer: 'writer',
            Rewriter: 'rewriter',
            Proofreader: 'proofreader'
        };
        const { overrideFunction, overrideDescriptor } = hammerhead.utils.overriding;
        const siteOrigin = (w) => {
            try {
                return w.__get$(w, 'location').origin;
            } catch (e) {
                return null;
            }
        };
        const denied = (name) => {
            if (!SELF_ONLY.includes(name)) return false;
            const top = window.rammerheadTop || window;
            if (top === window) return false;
            const mine = siteOrigin(window);
            if (!mine || mine === 'null' || mine === siteOrigin(top)) return false;
            let allow = '';
            try {
                const frame = Object.getOwnPropertyDescriptor(Window.prototype, 'frameElement')
                    ? Object.getOwnPropertyDescriptor(Window.prototype, 'frameElement').get.call(window)
                    : window.frameElement;
                allow = (frame && frame.getAttribute('allow')) || '';
            } catch (e) {
                // no frame element: treat as not delegated
            }
            return !allow.split(';').some((token) => token.trim().split(/\s+/)[0] === name);
        };
        const NativePromise = Promise;
        const NativeDOMException = DOMException;
        for (const name of Object.keys(AI_APIS)) {
            const Api = window[name];
            if (typeof Api !== 'function' || !denied(AI_APIS[name])) continue;
            if (typeof Api.availability === 'function') {
                overrideFunction(Api, 'availability', function () {
                    return NativePromise.resolve('unavailable');
                });
            }
            if (typeof Api.create === 'function') {
                overrideFunction(Api, 'create', function () {
                    return NativePromise.reject(
                        new NativeDOMException('Access denied because the Permission Policy is not enabled.', 'NotAllowedError')
                    );
                });
            }
        }
        const FeaturePolicy = window.FeaturePolicy;
        if (FeaturePolicy && FeaturePolicy.prototype) {
            const { allowsFeature, allowedFeatures } = FeaturePolicy.prototype;
            if (typeof allowsFeature === 'function') {
                overrideFunction(FeaturePolicy.prototype, 'allowsFeature', function (feature) {
                    const result = allowsFeature.apply(this, arguments);
                    // with an origin argument it's about another origin; leave those alone
                    return result && arguments.length < 2 && denied(String(feature)) ? false : result;
                });
            }
            if (typeof allowedFeatures === 'function') {
                overrideFunction(FeaturePolicy.prototype, 'allowedFeatures', function () {
                    return allowedFeatures.apply(this, arguments).filter((feature) => !denied(feature));
                });
            }
        }
        if (typeof Permissions === 'undefined' || typeof PermissionStatus === 'undefined') return;
        const deniedStatuses = new WeakSet();
        const nativeQuery = Permissions.prototype.query;
        overrideFunction(Permissions.prototype, 'query', function (descriptor) {
            const result = nativeQuery.apply(this, arguments);
            const name = descriptor && descriptor.name;
            if (!denied(name)) return result;
            return result.then((status) => {
                deniedStatuses.add(status);
                return status;
            });
        });
        const stateGetter = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state');
        if (stateGetter && stateGetter.get) {
            overrideDescriptor(PermissionStatus.prototype, 'state', {
                getter: function () {
                    return deniedStatuses.has(this) ? 'denied' : stateGetter.get.call(this);
                },
                setter: null
            });
        }
    }
    // csp violation events and reports carried the policy as rewritten for the proxy and proxy urls
    function hideProxyFromCspViolations() {
        const policies = hammerhead.rhCspPolicies;
        if (!policies) return;
        const { overrideDescriptor } = hammerhead.utils.overriding;
        const parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
        const proxyOrigin = location.origin;
        const pageUrl = () => {
            const parsed = parseProxyUrl(location.href);
            return parsed ? parsed.destUrl : location.href;
        };
        const toDest = (url) => {
            if (typeof url !== 'string' || !url.startsWith(proxyOrigin + '/')) return url;
            const parsed = parseProxyUrl(url);
            // hammerhead's own scripts: the browser blamed the frame it was in
            return parsed ? parsed.destUrl : pageUrl();
        };
        const mapGetters = (Proto, fields) => {
            if (!Proto || !Proto.prototype) return;
            for (const field of Object.keys(fields)) {
                const descriptor = Object.getOwnPropertyDescriptor(Proto.prototype, field);
                if (!descriptor || !descriptor.get) continue;
                const map = fields[field];
                overrideDescriptor(Proto.prototype, field, {
                    getter: function () {
                        return map(descriptor.get.call(this));
                    },
                    setter: null
                });
            }
        };
        const originalPolicy = (policy) => (policies.has(policy) ? policies.get(policy) : policy);
        // samples of rewritten scripts start with hammerhead's header: show the page's own first 40 characters
        const HEADER = '/*hammerhead|script|start*/';
        const sample = (value) => {
            if (typeof value !== 'string' || value.indexOf(HEADER) === -1) return value;
            const at = value.indexOf(HEADER);
            const sources = hammerhead.rhScriptSources || [];
            for (let i = sources.length - 1; i >= 0; i--) {
                if (sources[i][0].startsWith(value.slice(at))) return value.slice(0, at) + sources[i][1].slice(0, 40);
            }
            return value;
        };
        // scripts hammerhead nonced because the site allows them by hash don't show the nonce (see build.js)
        const nonced = hammerhead.rhNoncedScripts;
        const nonceDescriptor = window.HTMLElement && Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'nonce');
        if (nonced && nonceDescriptor && nonceDescriptor.get) {
            overrideDescriptor(HTMLElement.prototype, 'nonce', {
                getter: function () {
                    return nonced.has(this) ? '' : nonceDescriptor.get.call(this);
                },
                setter: function (value) {
                    nonced.delete(this);
                    nonceDescriptor.set.call(this, value);
                }
            });
        }
        mapGetters(window.SecurityPolicyViolationEvent, {
            originalPolicy,
            blockedURI: toDest,
            documentURI: toDest,
            sourceFile: toDest,
            referrer: toDest,
            sample
        });
        mapGetters(window.CSPViolationReportBody, {
            originalPolicy,
            blockedURL: toDest,
            documentURL: toDest,
            sourceFile: toDest,
            referrer: toDest,
            sample
        });
    }
    // chrome reports powerPreference "low-power" in cross-origin iframes when none was asked for. through the
    // proxy every frame is same-origin, so it said "default"
    function lowPowerWebGLInCrossOriginFrames() {
        const parent = window.rammerheadParent || window;
        if (parent === window) return;
        let mine, theirs;
        try {
            mine = window.__get$(window, 'location').origin;
            theirs = parent.__get$(parent, 'location').origin;
        } catch (e) {
            return;
        }
        if (!mine || mine === 'null' || mine === theirs) return;
        const { overrideFunction } = hammerhead.utils.overriding;
        const askedFor = new WeakSet();
        for (const Canvas of [window.HTMLCanvasElement, window.OffscreenCanvas]) {
            if (!Canvas || typeof Canvas.prototype.getContext !== 'function') continue;
            const nativeGetContext = Canvas.prototype.getContext;
            overrideFunction(Canvas.prototype, 'getContext', function (type, attributes) {
                const context = nativeGetContext.apply(this, arguments);
                if (context && attributes && typeof attributes === 'object' && attributes.powerPreference) askedFor.add(context);
                return context;
            });
        }
        for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
            if (!Context || typeof Context.prototype.getContextAttributes !== 'function') continue;
            const nativeGetAttributes = Context.prototype.getContextAttributes;
            overrideFunction(Context.prototype, 'getContextAttributes', function () {
                const attributes = nativeGetAttributes.apply(this, arguments);
                if (attributes && !askedFor.has(this) && attributes.powerPreference === 'default') {
                    attributes.powerPreference = 'low-power';
                }
                return attributes;
            });
        }
    }
    function dontShuffleWorkerUrls() {
        // fix workers crashing on shuffled urls (worker-hammerhead.js can't unshuffle, broke discord.com)
        if (window.Worker) {
            // a real constructor (not a Proxy), so Worker still looks native
            const inner = window.Worker;
            const Worker = function Worker() {
                noShuffling = true;
                try {
                    return new.target
                        ? Reflect.construct(inner, arguments, new.target === Worker ? inner : new.target)
                        : inner.apply(this, arguments);
                } finally {
                    noShuffling = false;
                }
            };
            Worker.prototype = inner.prototype;
            inner.prototype.constructor = Worker;
            hammerhead.utils.overriding.overrideStringRepresentation(Worker, inner);
            window.Worker = Worker;
        }
        // hammerhead doesn't wrap SharedWorker
        if (window.SharedWorker) {
            window.SharedWorker = new Proxy(window.SharedWorker, {
                construct(target, args, newTarget) {
                    noShuffling = true;
                    try {
                        return Reflect.construct(target, args, newTarget);
                    } finally {
                        noShuffling = false;
                    }
                }
            });
        }
    }
    // custom cookie sync-name letters. The letters are
    // read from the task settings (when the app sets them) and applied to the
    // cookie sandbox's sync-type map, which build.js exposes as
    // window.__rhCookieSyncType; the sync-type regex used by changeSyncType is
    // rebuilt to match. Without settings the canonical s/c/w letters stay.
    function applyCookieSyncLetters() {
        const letters = hammerhead.settings.get().rhCookieLetters;
        if (!letters || !window.__rhCookieSyncType) return;
        Object.assign(window.__rhCookieSyncType, letters);
        window.__rhCookieSyncTypeRE = new RegExp('^[' + letters.server + letters.client + letters.window + ']+');
    }
    function fixCrossWindowLocalStorage() {
        // completely replace hammerhead's implementation as restore() and save() on every
        // call is just not viable (mainly memory issues as the garbage collector is sometimes not fast enough)

        const currentHost = window.__get$(window, 'location').host;
        // the storage-wrapper prefix comes from the task settings when the app sets custom names; the default is the
        // fallback. single pipe-free token, so composite keys keep their pipe positions.
        const storageWrapperPrefix =
            (hammerhead.settings.get().rhStorageKeys || {}).coreStorageWrapper || 'rammerhead|storage-wrapper|';
        const generatePrefix = host => `${storageWrapperPrefix}${hammerhead.settings._settings.sessionId}|${host}|`;
        const toRealStorageKey = (key = '', host = currentHost) => generatePrefix(host) + key;
        const fromRealStorageKey = (key = '', host = currentHost) => {
            if (!key.startsWith(generatePrefix(host))) return null;
            return key.slice(generatePrefix(host).length);
        };

        const replaceStorageInstance = (storageProp, realStorage) => {
            const reservedProps = ['internal', 'clear', 'key', 'getItem', 'setItem', 'removeItem', 'length', 'addChangeEventListener', 'hasOwnProperty', 'propertyIsEnumerable', 'constructor', 'isPrototypeOf', 'toLocaleString', 'toString', 'valueOf'];

            const changeListeners = [];
            const addChangeEventListener = listener => changeListeners.push(listener);

            Object.defineProperty(window, storageProp, {
                // define a value-based instead of getter-based property, since with this localStorage implementation,
                // we don't need to rely on sharing a single memory-based storage across frames, unlike hammerhead
                configurable: true,
                writable: true,
                // still use window[storageProp] as basis to allow scripts to access localStorage.internal
                value: new Proxy(window[storageProp], {
                    get(target, prop, receiver) {
                        if (reservedProps.includes(prop) && prop !== 'length') {
                            return Reflect.get(target, prop, receiver);
                        } else if (prop === 'length') {
                            let len = 0;
                            for (const [key] of Object.entries(realStorage)) {
                                if (fromRealStorageKey(key)) len++;
                            }
                            return len;
                        } else if (prop === 'addChangeEventListener') {
                            return addChangeEventListener;
                        } else {
                            return realStorage[toRealStorageKey(prop)];
                        }
                    },
                    set(_, prop, value) {
                        if (!reservedProps.includes(prop)) {
                            for (const listener of changeListeners) {
                                try {
                                    const oldValue = realStorage[toRealStorageKey(prop)];
                                    if (value !== oldValue) {
                                        listener({ key: prop, value, oldValue });
                                    }
                                } catch (e) {
                                    console.error(e);
                                }
                            }
                            realStorage[toRealStorageKey(prop)] = value;
                        }
                        return true;
                    },
                    deleteProperty(_, prop) {
                        delete realStorage[toRealStorageKey(prop)];
                        return true;
                    },
                    has(target, prop) {
                        return toRealStorageKey(prop) in realStorage || prop in target;
                    },
                    ownKeys() {
                        const list = [];
                        for (const [key] of Object.entries(realStorage)) {
                            const proxyKey = fromRealStorageKey(key);
                            if (proxyKey && !reservedProps.includes(proxyKey)) list.push(proxyKey);
                        }
                        return list;
                    },
                    getOwnPropertyDescriptor(_, prop) {
                        return Object.getOwnPropertyDescriptor(realStorage, toRealStorageKey(prop));
                    },
                    defineProperty(_, prop, desc) {
                        if (!reservedProps.includes(prop)) {
                            Object.defineProperty(realStorage, toRealStorageKey(prop), desc);
                        }
                        return true;
                    }
                })
            });
        };
        const rewriteFunction = (prop, newFunc) => {
            Storage.prototype[prop] = new Proxy(Storage.prototype[prop], {
                apply(_, thisArg, args) {
                    return newFunc.apply(thisArg, args);
                }
            });
        };

        replaceStorageInstance('localStorage', hammerhead.storages.localStorageProxy.internal.nativeStorage);
        replaceStorageInstance('sessionStorage', hammerhead.storages.sessionStorageProxy.internal.nativeStorage);
        rewriteFunction('clear', function () {
            for (const [key] of Object.entries(this)) {
                delete this[key];
            }
        });
        rewriteFunction('key', function (keyNum) {
            return (Object.entries(this)[keyNum] || [])[0] || null;
        });
        rewriteFunction('getItem', function (key) {
            return this.internal.nativeStorage[toRealStorageKey(key, this.internal.nativeStorageKey.split('|')[3])] || null;
        });
        rewriteFunction('setItem', function (key, value) {
            if (key) {
                this.internal.nativeStorage[toRealStorageKey(key, this.internal.nativeStorageKey.split('|')[3])] = value;
            }
        });
        rewriteFunction('removeItem', function (key) {
            delete this.internal.nativeStorage[toRealStorageKey(key, this.internal.nativeStorageKey.split('|')[3])];
        });
    }

    function addCloudflareChallengeSolver() {
        const fetch = hammerhead.nativeMethods.fetch;
        const sessionId = hammerhead.settings._settings.sessionId;
        const loc = window.__get$(window, 'location');

        const sessionStorage = window.sessionStorage.internal.nativeStorage;
        const rootdomain = loc.hostname.match(/[a-z0-9-]+\.[a-z0-9-]+$/)?.[0];
        // key name from the task settings when the app sets custom names; the default otherwise
        const needResponseKey = `${(hammerhead.settings.get().rhStorageKeys || {}).cfResponse || 'rh_needs_our_response|'}${rootdomain}`;

        document.addEventListener('DOMContentLoaded', () => {
            // without a solver, hooking turnstile.render only breaks cloudflare's own challenge.
            // checked here because the task script sets it after hammerhead (and this) starts
            if (!hammerhead.settings.get().rhCloudflareSolver) return;
            for (const script of document.head.querySelectorAll('script')) {
                if (script.src.includes('/orchestrate/chl_page/v1')) {
                    // do the cloudflare
                    console.log('cloudflare detected');
                    if (window.rhHookCloudflareDetected) {
                        window.rhHookCloudflareDetected();
                        delete window.rhHookCloudflareDetected;
                    }

                    if (sessionStorage[needResponseKey]) {
                        // if this appears, that means the response we got from before failed
                        delete sessionStorage[needResponseKey];
                        fetch(`/api/cloudflare-bulldozer-response?sessionId=${sessionId}&url=${encodeURIComponent(loc.href)}&status=failed`);
                    }

                    // whether to let cloudflare's own widget try first (it usually passes without a checkbox).
                    // asked now so it's known by the time the widget renders
                    const freeMode = fetch(`/api/cloudflare-bulldozer-free?sessionId=${sessionId}&url=${encodeURIComponent(loc.href)}`).then(
                        (res) => (res.ok ? res.text() : 'try'),
                        () => 'try'
                    );
                    let freeModeNow = null;
                    freeMode.then((mode) => (freeModeNow = mode));

                    let i = setInterval(() => {
                        if (window.turnstile) {
                            clearInterval(i);
                            window.turnstile._rh_render = window.turnstile.render;

                            let didRenderRun = false;

                            // sometimes, cloudflare decides to not run the render function.
                            // only reload when a solver exists, otherwise it interrupts cloudflare's own challenge
                            fetch(`/api/cloudflare-bulldozer-status?sessionId=${sessionId}&url=${encodeURIComponent(loc.href)}`).then((res) => {
                                if (!res.ok) return;
                                setTimeout(() => {
                                    if (!didRenderRun) {
                                        window.location.reload();
                                    }
                                }, 6000);
                            });

                            // cloudflare's widget first; the solver when it fails, asks for a checkbox, or hangs,
                            // or right away when it already failed for this session (the server remembers)
                            window.turnstile.render = function (a, b) {
                                didRenderRun = true;
                                if (freeModeNow === 'skip') {
                                    solveWithSolver(a, b);
                                    return;
                                }
                                let solving = false;
                                let hung = null;
                                let widgetId;
                                const solve = () => {
                                    if (solving) return;
                                    solving = true;
                                    clearTimeout(hung);
                                    // cloudflare's own check failed (pages can tell users what to do next)
                                    if (window.rhHookCloudflareFreeFailed) {
                                        try {
                                            window.rhHookCloudflareFreeFailed();
                                        } catch (e) {
                                            console.error(e);
                                        }
                                    }
                                    try {
                                        if (widgetId !== undefined) window.turnstile.remove(widgetId);
                                    } catch (e) {
                                        // already gone
                                    }
                                    solveWithSolver(a, b);
                                };
                                const options = Object.assign({}, b, {
                                    callback: function () {
                                        clearTimeout(hung);
                                        if (!solving && b.callback) return b.callback.apply(this, arguments);
                                    },
                                    'error-callback': function () {
                                        solve();
                                        return true;
                                    },
                                    'unsupported-callback': solve,
                                    'before-interactive-callback': solve
                                });
                                hung = setTimeout(solve, 30000);
                                freeMode.then((mode) => mode === 'skip' && solve());
                                widgetId = window.turnstile._rh_render(a, options);
                                return widgetId;
                            };

                            const solveWithSolver = async (a, b) => {
                                let p = {
                                    sitekey: b.sitekey,
                                    pageurl: loc.href,
                                    data: b.cData,
                                    pagedata: b.chlPageData,
                                    action: b.action,
                                    userAgent: navigator.userAgent
                                }

                                const res = await fetch('/api/cloudflare-bulldozer?sessionId=' + sessionId, {
                                    method: 'POST',
                                    body: JSON.stringify(p)
                                });
                                if (res.status !== 200) {
                                    console.warn('cloudflare js challenge support not enabled');
                                    window.turnstile._rh_render(a, b);
                                    return;
                                }
                                let firstTimeWaiting = true;
                                const interval = setInterval(async () => {
                                    // status updates
                                    const text = await (await fetch(`/api/cloudflare-bulldozer-status?sessionId=${sessionId}&url=${encodeURIComponent(loc.href)}`)).text();
                                    if (text === 'reload') {
                                        // this means the server either injected our session with the
                                        // cf_clearance cookie, or the solving failed and it needs us to
                                        // generate and send the info again
                                        clearInterval(interval);
                                        window.location.reload();
                                    } else if (text.startsWith('token: ')) {
                                        // debugger;
                                        // lucky us, we got picked to be the guinea pig.
                                        // we need to respond in the next page load
                                        sessionStorage[needResponseKey] = true;
                                        b.callback(text.slice(7));
                                    } else if (text === 'wait') {
                                        // the solver is on it (only said while a solve is pending)
                                        if (firstTimeWaiting) {
                                            firstTimeWaiting = false;
                                            showCFSolverMessage();
                                        }
                                    } else {
                                        console.error('Unknown response from js challenge solver endpoint: ' + text);
                                        clearInterval(interval);
                                    }
                                }, 2000);
                            };
                        }
                    }, 1);
                    return;
                }
            }

            // if we reach here, that means cloudflare js challenge isn't detected on current page
            // and now we can tell the server the good news
            if (sessionStorage[needResponseKey]) {
                delete sessionStorage[needResponseKey];
                fetch(`/api/cloudflare-bulldozer-response?sessionId=${sessionId}&url=${encodeURIComponent(loc.href)}&status=success`);
            }

            delete window.rhHookCloudflareDetected;
        });
    }

    // shown while the solver works. in a closed shadow root on <html> so the challenge page's scripts don't see
    // it, and built with dom calls and cssom (strict csp and trusted types block innerHTML and <style>)
    function showCFSolverMessage() {
        if (showCFSolverMessage.shown) return;
        showCFSolverMessage.shown = true;
        const host = document.createElement('div');
        const root = host.attachShadow({ mode: 'closed' });
        const box = document.createElement('div');
        Object.assign(box.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '24px',
            background: '#111',
            color: '#eee',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center'
        });
        const title = document.createElement('div');
        title.textContent = 'Checking if the site connection is secure...';
        Object.assign(title.style, { fontSize: '22px', fontWeight: '600' });
        const text = document.createElement('div');
        text.textContent =
            "Cloudflare wants extra verification on this site, so we're solving it for you. " +
            'This usually takes 5 to 20 seconds, and the page may reload once.';
        Object.assign(text.style, { fontSize: '15px', maxWidth: '480px', lineHeight: '1.5', opacity: '0.85' });
        box.append(title, text);
        root.append(box);
        document.documentElement.append(host);
    }

    // mirrored from src/util/rewriteTargetAttributeToSelf.js
    function rewriteTargetAttributeToSelf() {
        var DomProcessor = hammerhead.processors.domProcessor.constructor;
        DomProcessor.prototype._processTargetBlank = function (el, _urlReplacer, pattern) {
            if (!pattern.targetAttr)
              return;
          
            const storedTargetAttr = DomProcessor.getStoredAttrName(pattern.targetAttr);
            const processed = this.adapter.hasAttr(el, storedTargetAttr);
          
            if (processed)
              return;
          
            let attrValue = this.adapter.getAttr(el, pattern.targetAttr);
          
            // NOTE: Value may have whitespace.
            attrValue = attrValue && attrValue.replace(/\s/g, '');

            if (!hammerhead.utils.dom.isElementInIframe(el)) {
              // if page isn't an iframe + wants a link to _top, then it wants to jump out
              // to the top frame instead of nicely modifying itself.
              if (attrValue === '_top') {
                this.adapter.setAttr(el, pattern.targetAttr, '_self');
                this.adapter.setAttr(el, storedTargetAttr, attrValue);
              }
            } else {
              // if page is in a frame and wants a link to top, it's usually to change its parent navigation parent.
              // there will be one case where this solution doesn't work, where the parent isn't actually the "top"
              if (attrValue === '_top') {
                this.adapter.setAttr(el, pattern.targetAttr, '_parent');
                this.adapter.setAttr(el, storedTargetAttr, attrValue);
              }
            }
          };
          var domProcessor = hammerhead.processors.domProcessor;
          domProcessor.elementProcessorPatterns = domProcessor._createProcessorPatterns(domProcessor.adapter);
    }

    function hookHammerheadStartOnce(callback) {
        var originalStart = hammerhead.__proto__.start;
        hammerhead.__proto__.start = function () {
            originalStart.apply(this, arguments);
            hammerhead.__proto__.start = originalStart;
            callback();
        };
    }
})();
