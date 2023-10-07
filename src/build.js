require('dotenv-flow').config();

const path = require('path');
const fs = require('fs');
const UglifyJS = require('uglify-js');

// modify unmodifable items that cannot be hooked in rammerhead.js
fs.writeFileSync(
    path.join(__dirname, './client/hammerhead.js'),
    fs
        .readFileSync(path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/hammerhead.js'), 'utf8')
        // part of fix for iframing issue
        .replace('(function initHammerheadClient () {', '(function initHammerheadClient () {' +
            'if (window["%is-hammerhead%"]) throw new TypeError("already ran"); window["%is-hammerhead%"] = true;' +
            'window.rammerheadTop = (function() {var w = window; while (w !== w.top && w.parent["%hammerhead"]) w = w.parent; return w;})();' +
            'window.rammerheadParent = window.rammerheadTop === window ? window : window.parent;' +
            'window.distanceRammerheadTopToTop = (function() { var i=0,w=window; while (w !== window.top) {i++;w=w.parent} return i; })();' +
            'window.rammerheadAncestorOrigins = Array.from(location.ancestorOrigins).slice(0, -window.distanceRammerheadTopToTop);\n')
        // fix iframing proxy issue.
        // we replace window.top comparisons with the most upper window that's still a proxied page
        .replace(
            /(window|win|wnd|instance|opener|activeWindow)\.top/g,
            '$1.rammerheadTop'
        )
        .replace(
            /window\.parent/g,
            'window.rammerheadParent'
        )
        .replace(
            /window\.location\.ancestorOrigins/g,
            'window.rammerheadAncestorOrigins'
        )
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
        .replace('return window.location.search;', 'return (new URL(get$$2())).search;')
        .replace('return window.location.hash;', 'return (new URL(get$$2())).hash;')
        .replace(
            'setter: function (search) {',
            '$& var url = new URL(get$$2()); url.search = search; window.location = convertToProxyUrl(url.href); return search;'
        )
        .replace(
            'setter: function (hash) {',
            '$& var url = new URL(get$$2()); url.hash = hash; window.location.hash = (new URL(convertToProxyUrl(url.href))).hash; return hash;'
        )
        // sometimes, postMessage doesn't work as expected when
        // postMessage gets run/received in same window without hammerhead wrappings.
        // this is to double check hammerhead wrapped it
        // (cloudflare's turnsile threw this error after it tried to postMessage a fail code)
        .replace(
            'data.type !== MessageType.Service && isWindow(target)',
            '$& && data.type?.startsWith("hammerhead|")'
        )
);

// fix the
// worker-hammerhead.js:2434 Uncaught TypeError: Cannot read properties of undefined (reading 'toString')
//     at worker-hammerhead.js:2434:35
fs.writeFileSync(
    path.join(__dirname, './client/worker-hammerhead.js'),
    fs
        .readFileSync(path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/worker-hammerhead.js'), 'utf8')
        .replace('proxyLocation.port.toString()', 'proxyLocation.port?.toString() || (proxyLocation.protocol === "https:" ? 443 : 80)')
);

// fix the
// transport-worker.js:1022 Uncaught TypeError: Cannot read properties of undefined (reading 'toString')
//     at transport-worker.js:1022:38
fs.writeFileSync(
    path.join(__dirname, './client/transport-worker.js'),
    fs
    .readFileSync(path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/transport-worker.js'), 'utf8')
    .replace('proxyLocation.port.toString()', 'proxyLocation.port?.toString() || (proxyLocation.protocol === "https:" ? 443 : 80)')
);

const minify = (fileName, newFileName) => {
    const minified = UglifyJS.minify(fs.readFileSync(path.join(__dirname, './client', fileName), 'utf8'));
    if (minified.error) {
        throw minified.error;
    }
    fs.writeFileSync(path.join(__dirname, './client', newFileName), minified.code, 'utf8');
};

minify('rammerhead.js', 'rammerhead.min.js');
minify('hammerhead.js', 'hammerhead.min.js');
minify('worker-hammerhead.js', 'worker-hammerhead.min.js');
minify('transport-worker.js', 'transport-worker.min.js');
