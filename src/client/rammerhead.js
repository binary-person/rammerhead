(function () {
    var hammerhead = window['%hammerhead%'];
    if (!hammerhead) throw new Error('hammerhead not loaded yet');
    if (hammerhead.settings._settings.sessionId) {
        // task.js already loaded. this will likely never happen though since this file loads before task.js
        console.warn('unexpected task.js to load before rammerhead.js. url shuffling cannot be used');
        main();
    } else {
        // wait for task.js to load
        hookHammerheadStartOnce(main);
        // before task.js, we need to add url shuffling
        addUrlShuffling();
        // and fix iframed proxies
        fixProxyEmbed();
    }

    function main() {
        fixUrlRewrite();
        fixElementGetter();
        fixCrossWindowLocalStorage();

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
            return;
        }
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
        const request = new XMLHttpRequest();
        const sessionId = (location.pathname.slice(1).match(/^[a-z0-9]+/i) || [])[0];
        if (!sessionId) {
            console.warn('cannot get session id from url');
            return;
        }
        request.open('GET', '/api/shuffleDict?id=' + sessionId, false);
        request.send();
        if (request.status !== 200) {
            console.warn(
                `received a non 200 status code while trying to fetch shuffleDict:\nstatus: ${request.status}\nresponse: ${request.responseText}`
            );
            return;
        }
        const shuffleDict = JSON.parse(request.responseText);
        if (!shuffleDict) return;

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

        const getProxyUrl = window['%hammerhead%'].utils.url.getProxyUrl;
        const parseProxyUrl = window['%hammerhead%'].utils.url.parseProxyUrl;
        window['%hammerhead%'].utils.url.overrideGetProxyUrl(function (url, opts) {
            if (noShuffling) {
                return getProxyUrl(url, opts);
            }
            return replaceUrl(getProxyUrl(url, opts), (u) => shuffler.shuffle(u), true);
        });
        window['%hammerhead%'].utils.url.overrideParseProxyUrl(function (url) {
            return parseProxyUrl(replaceUrl(url, (u) => shuffler.unshuffle(u), false));
        });
        // manual hooks //
        window.overrideGetProxyUrl(
            (getProxyUrl$1) =>
                function (url, opts) {
                    if (noShuffling) {
                        return getProxyUrl$1(url, opts);
                    }
                    return replaceUrl(getProxyUrl$1(url, opts), (u) => shuffler.shuffle(u), true);
                }
        );
        window.overrideParseProxyUrl(
            (parseProxyUrl$1) =>
                function (url) {
                    return parseProxyUrl$1(replaceUrl(url, (u) => shuffler.unshuffle(u), false));
                }
        );
    }
    function fixUrlRewrite() {
        const port = location.port || (location.protocol === 'https:' ? '443' : '80');
        const getProxyUrl = window['%hammerhead%'].utils.url.getProxyUrl;
        window['%hammerhead%'].utils.url.overrideGetProxyUrl(function (url, opts = {}) {
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
        const urlRewrite = (url) => (window['%hammerhead%'].utils.url.parseProxyUrl(url) || {}).destUrl || url;
        for (const ElementClass in fixList) {
            for (const attr of fixList[ElementClass]) {
                if (!window[ElementClass]) {
                    console.warn('unexpected unsupported element class ' + ElementClass);
                    continue;
                }
                const desc = Object.getOwnPropertyDescriptor(window[ElementClass].prototype, attr);
                const originalGet = desc.get;
                desc.get = function () {
                    return urlRewrite(originalGet.call(this));
                };
                if (attr === 'action') {
                    const originalSet = desc.set;
                    // don't shuffle form action urls
                    desc.set = function (value) {
                        noShuffling = true;
                        try {
                            var returnVal = originalSet.call(this, value);
                        } catch (e) {
                            noShuffling = false;
                            throw e;
                        }
                        noShuffling = false;
                        return returnVal;
                    };
                }
                Object.defineProperty(window[ElementClass].prototype, attr, desc);
            }
        }
    }
    function fixProxyEmbed() {
        window.overrideIsCrossDomainWindows(
            (isCrossDomainWindows) =>
                function (win1, win2) {
                    let isCrossDomain = isCrossDomainWindows(win1, win2);
                    if (!isCrossDomain && (win1 && !!win1['%hammerhead%']) === (win2 && !!win2['%hammerhead%'])) {
                        return false;
                    }
                    return true;
                }
        );
    }
    function fixCrossWindowLocalStorage() {
        const hookFunction = (obj, prop, beforeCall, afterCall) => {
            obj[prop] = new window['%hammerhead%'].nativeMethods.Proxy(obj[prop], {
                apply(target, thisArg, args) {
                    if (beforeCall) beforeCall();
                    const returnVal = Reflect.apply(target, thisArg, args);
                    if (afterCall) afterCall();
                    return returnVal;
                }
            });
        };
        const hookRestore = (storageProp) => {
            const desc = Object.getOwnPropertyDescriptor(window, storageProp);
            const storageProxy = desc.get();
            const rewrittenProxy = new window['%hammerhead%'].nativeMethods.Proxy(storageProxy, {
                get(target, prop, receiver) {
                    target.restore();
                    return Reflect.get(target, prop, receiver);
                }
            });
            desc.get = () => rewrittenProxy;
            Object.defineProperty(window, storageProp, desc);
        };
        hookFunction(Storage.prototype, 'getItem', () => {
            window['%hammerhead%'].storages.localStorageProxy.restore();
            window['%hammerhead%'].storages.sessionStorageProxy.restore();
        });
        hookFunction(Storage.prototype, 'setItem', undefined, () => {
            window['%hammerhead%'].storages.localStorageProxy.saveToNativeStorage(true);
            window['%hammerhead%'].storages.sessionStorageProxy.saveToNativeStorage(true);
        });
        hookRestore('localStorage');
        hookRestore('sessionStorage');
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
