// content security policies rewritten for the proxy instead of dropped, so the browser still enforces them
// (pages and anti-bot scripts test that eval, inline scripts, trusted types and so on are really blocked).
// plain es5 without requires: build.js inlines this into the client for <meta> policies it processes

/* eslint-disable no-var */
var rhCspRewrite = (function () {
    // hammerhead's own scripts and endpoints, allowed by exact path so the site's policy doesn't widen
    var SCRIPTS = ['/hammerhead.js', '/rammerhead.js', '/task.js', '/iframe-task.js', '/worker-hammerhead.js'];
    var WORKERS = ['/transport-worker.js'];
    var CONNECT = ['/messaging', '/syncLocalStorage', '/api/'];
    var POLICY_NAME = 'hammerhead';
    var KEYWORD = /^'[^']*'$/;
    var KEEP_SCHEMES = /^(data|blob|filesystem|mediastream):$/i;
    var WEB_SCHEMES = /^(https?|wss?):$/i;
    // source lists whose hosts are rewritten. everything else (sandbox, trusted-types, ...) is handled below
    var SOURCE_LIST = /(-src(-elem|-attr)?|^form-action|^base-uri|^navigate-to)$/;
    // fix sites with frame-ancestors 'none' (github) not loading in pages that frame the proxy, like rammerhead browser:
    // every proxied page shares the proxy's origin, so the framer can't be told apart anyway
    var DROP = { 'report-uri': 1, 'report-to': 1, 'frame-ancestors': 1 };

    function hasInline(sources) {
        var inline = false;
        for (var i = 0; i < sources.length; i++) {
            var s = sources[i].toLowerCase();
            // a nonce or hash (or strict-dynamic) turns 'unsafe-inline' off
            if (/^'(nonce-|sha(256|384|512)-|strict-dynamic')/.test(s)) return false;
            if (s === "'unsafe-inline'") inline = true;
        }
        return inline;
    }

    function addUnique(list, values) {
        for (var i = 0; i < values.length; i++) if (list.indexOf(values[i]) === -1) list.push(values[i]);
    }

    function paths(origins, list) {
        var out = [];
        for (var i = 0; i < origins.length; i++) for (var j = 0; j < list.length; j++) out.push(origins[i] + list[j]);
        return out;
    }

    function socketOrigins(origins) {
        var out = [];
        for (var i = 0; i < origins.length; i++) out.push(origins[i].replace(/^http/, 'ws'));
        return out;
    }

    /**
     * @param {string} policy - one serialized policy (no commas)
     * @param {{origins: string[], nonce?: string, https?: boolean, hashes?: object}} options - proxy origins, our
     *   nonce, and hash sources of rewritten inline scripts keyed by the site's hash source
     * @returns {string}
     */
    function rewritePolicy(policy, options) {
        var origins = options.origins;
        var directives = [];
        var byName = {};
        var parts = String(policy).split(';');
        for (var i = 0; i < parts.length; i++) {
            var tokens = parts[i].trim().split(/[\t\n\f\r ]+/);
            var name = (tokens.shift() || '').toLowerCase();
            // first occurrence wins, like browsers
            if (!name || byName[name] || DROP[name] !== undefined) continue;
            if (!options.https && (name === 'upgrade-insecure-requests' || name === 'block-all-mixed-content')) continue;
            var directive = { name: name, sources: tokens.filter(Boolean) };
            byName[name] = directive;
            directives.push(directive);
        }
        for (var d = 0; d < directives.length; d++) {
            var dir = directives[d];
            if (dir.name === 'sandbox') {
                // hammerhead reaches into the document, so it has to stay same-origin (like sandboxed iframes)
                addUnique(dir.sources, ['allow-same-origin']);
                continue;
            }
            if (dir.name === 'trusted-types') {
                dir.sources = dir.sources.filter(function (s) {
                    return s.toLowerCase() !== "'none'";
                });
                addUnique(dir.sources, [POLICY_NAME]);
                continue;
            }
            if (!SOURCE_LIST.test(dir.name)) continue;
            var mapped = [];
            for (var k = 0; k < dir.sources.length; k++) {
                var source = dir.sources[k];
                if (KEYWORD.test(source) || source === '*' || KEEP_SCHEMES.test(source)) {
                    addUnique(mapped, [source]);
                    // inline scripts are rewritten: their new hashes go next to the site's
                    var hashed = options.hashes && options.hashes[source];
                    if (hashed) addUnique(mapped, hashed);
                    if (source.toLowerCase() === "'self'") addUnique(mapped, origins);
                } else if (WEB_SCHEMES.test(source)) {
                    addUnique(mapped, [source]);
                    addUnique(mapped, origins);
                } else {
                    // a site host: everything proxied comes from the proxy's origins. the host stays too, for what the
                    // browser fetches itself without the proxy (fedcm, ...), which the site allowed anyway
                    addUnique(mapped, origins);
                    addUnique(mapped, [source]);
                }
            }
            dir.sources = mapped;
        }
        function effective(names) {
            for (var i = 0; i < names.length; i++) if (byName[names[i]]) return byName[names[i]];
            return null;
        }
        function allow(directive, values) {
            if (!directive) return;
            directive.sources = directive.sources.filter(function (s) {
                return s.toLowerCase() !== "'none'";
            });
            addUnique(directive.sources, values);
        }
        var scripts = effective(['script-src-elem', 'script-src', 'default-src']);
        if (scripts) {
            var nonce = options.nonce && !hasInline(scripts.sources) ? ["'nonce-" + options.nonce + "'"] : [];
            // options.paths: per-request service urls when the app serves them under other paths;
            // without it the static originals are whitelisted
            allow(scripts, nonce.concat(paths(origins, (options.paths && options.paths.scripts) || SCRIPTS)));
            // inline handlers aren't hammerhead's; only make sure scripts fall back the same way they did
        }
        allow(effective(['worker-src', 'child-src', 'script-src', 'default-src']), paths(origins, (options.paths && options.paths.workers) || WORKERS));
        allow(
            effective(['connect-src', 'default-src']),
            paths(origins, (options.paths && options.paths.connect) || CONNECT).concat(paths(socketOrigins(origins), [(options.paths && options.paths.messaging) || '/messaging']))
        );
        var out = [];
        for (var o = 0; o < directives.length; o++) {
            out.push(directives[o].sources.length ? directives[o].name + ' ' + directives[o].sources.join(' ') : directives[o].name);
        }
        return out.join('; ');
    }

    /**
     * a header value can hold several policies separated by commas
     * @param {string} header
     * @param {{origins: string[], nonce?: string, https?: boolean, hashes?: object}} options
     * @returns {string}
     */
    function rewriteHeader(header, options) {
        return String(header)
            .split(',')
            .map(function (policy) {
                return rewritePolicy(policy, options);
            })
            .filter(Boolean)
            .join(', ');
    }

    return { rewritePolicy: rewritePolicy, rewriteHeader: rewriteHeader, POLICY_NAME: POLICY_NAME, SCRIPTS: SCRIPTS, WORKERS: WORKERS, CONNECT: CONNECT };
})();

if (typeof module !== 'undefined') module.exports = rhCspRewrite;
