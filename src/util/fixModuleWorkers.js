const header = require('testcafe-hammerhead/lib/processing/script/header');

// fix module workers crashing on importScripts() (not allowed in modules). fall back to import() like the client header does
const IMPORT =
    /importScripts\(\(location\.origin \|\| \(location\.protocol \+ "\/\/" \+ location\.host\)\) \+ "([^"]+)"\);/;
// workers under a trusted types csp (youtube's service worker) refuse importScripts(string): the engine never
// loaded and the site's requests went out unproxied. the url through hammerhead's policy (the csp rewrite allows
// its name), kept for worker-hammerhead.js's own importScripts
const trustedImport = (route) =>
    `var rhUrl = (location.origin || (location.protocol + "//" + location.host)) + "${route}";` +
    ` if (self.trustedTypes && self.trustedTypes.createPolicy && !self["hammerhead|trusted-policy"]) try {` +
    ` Object.defineProperty(self, "hammerhead|trusted-policy", { value: self.trustedTypes.createPolicy("hammerhead", { createScriptURL: function (s) { return s; }, createScript: function (s) { return s; } }) });` +
    ` } catch (e) {}` +
    ` importScripts(self["hammerhead|trusted-policy"] ? self["hammerhead|trusted-policy"].createScriptURL(rhUrl) : rhUrl);`;
module.exports.trustedImport = trustedImport;
const add = header.add;
header.add = function () {
    return (
        add
            .apply(this, arguments)
            // a module's var isn't global, so worker-hammerhead.js can't find it
            .replace('var __getWorkerSettings$ = function', 'self.__getWorkerSettings$ = function')
            .replace(
                IMPORT,
                (match, route) =>
                    `try { ${trustedImport(route)} } catch (e) { (async function () { await import((location.origin || (location.protocol + "//" + location.host)) + "${route}"); })(); }`
            )
    );
};
