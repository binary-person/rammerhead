## v1.3.1

### cloudflare

- fix GET forms (google search and other search boxes) with a deployment secret: the cache tag ended up in the middle of the url
- fix the cache tag showing in a page's own address after a redirect (google.com → /?gws_rd=ssl!v…), which sites then got back
- free users pass cloudflare challenges without the "verify you are human" checkbox (with the anti-bot fixes below)
- with a solver, let cloudflare's own widget try first and only pay when it fails, asks for the checkbox, or hangs
- remember a failed free try per session and site for `freeRetryAfter` (default 30 minutes) and go straight to the solver
- show a message while the solver works, and add `rhHookCloudflareFreeFailed` for pages to react to a failed free try
- fix zstd responses skipping rewriting (chrome offers zstd, cloudflare uses it)
- fix cloudflare turnstile: `postMessage(msg, { transfer })` dropping ports, "Cannot redefine property: __call$", and the challenge page reloading itself every 6 seconds without a solver
- move the 2captcha cloudflare solver to 2captcha's json api (solves in ~5s instead of ~13s)
- fix solved cloudflare cookies never being cached (every visit paid for a new solve)
- fix other users hanging on a cloudflare page for up to a minute after it was solved or checked
- fix the first 2captcha token always being rejected (switch to the solver's user-agent before solving, one paid solve instead of two)
- fix workers not using a cloudflare clearance solved by another worker or before a restart
- switch to the solver's user-agent per session and site, not for everyone on that site (others' free tries kept failing)
- fix paying for cloudflare solves forever when a site keeps rejecting tokens: after `maxFailedSolves` (3) failed solves in `failedSolveWindow` (30 minutes), pages get cloudflare's own widget back
- add `takeStats()` to cloudflare solvers: free tries, free fails, cache hits, paid solves and failed solves
- fix cloudflare solver api calls (with the session id) being forwarded to sites when no solver is attached
- add `apiUrl` to `RammerheadCloudflare2Captcha`, and cloudflare solver tests against a fake cloudflare and 2captcha
- fix cloudflare challenges without a solver: `turnstile.render` was replaced and returned a promise

### anti-bot (what cloudflare's checks caught, applies to every site)

- fix google recaptcha (sites' captchas through the proxy pass again)
- fix preload links showing the proxy url to the page: `getAttribute('href')` after `rel`/`as` changes (google search)
- fix about:blank frames syncing localStorage through the proxy when the page handles it itself (`rammerheadDisableLocalStorageImplementation`)
- fix random failed requests (502 in front of the proxy) when a site closes an idle keep-alive connection as it's reused: GET/HEAD/OPTIONS are sent again (youtube)
- service workers are off: `register()` rejects like a browser without them, and existing ones are removed (they sat at the proxy's root, one site's worker in front of every page; youtube's loaded from the root and sent requests there)
- fix workers under a trusted types csp running without the engine (their requests went out unproxied)
- hide hammerhead's overridden functions and getters from anti-bot checks (`length`, `prototype`, source code)
- hide proxy urls and rammerhead's own requests from `performance.getEntries()`
- hide hammerhead's globals and element properties from `Object.keys`/`getOwnPropertyNames`
- hide hammerhead's frames from stack traces, and show sites' own urls and line:column
- report sites' own script sizes in resource timing
- remove hammerhead's injected `<script>`/`<meta>` tags once they've run
- pass content security policies through, rewritten for the proxy (eval, inline scripts, `data:` scripts and trusted types were all allowed)
- report sites' own policies and urls in csp violation events
- keep running scripts a page adds that its policy allows by hash (spotify), and trusted script text set through `textContent`/`innerText` (youtube)
- apply sites' referrer policies (the full url leaked cross-site)
- pass `cross-origin-embedder-policy` through (pages can be cross-origin isolated)
- fix messages sent with the native `postMessage` being dropped or getting origin `undefined`
- fix `frameElement` being visible to cross-site iframes (it's `null` in browsers), and hammerhead tripping getters pages put on it
- show sites' original source from `toString()` of functions the rewriting changed
- stop adding `allow-scripts` to sandboxed iframes (sites' script-less frames ran scripts)
- fix script-less sandboxed iframes (youtube): html written into them threw, listeners the page added there never fired, and chrome logged "Blocked script execution" up to 100 times a second
- keep `:hover` in stylesheets (hammerhead swapped it for an attribute)
- give `blob:` urls the site's origin
- proxy `srcset` set as a property, constructed stylesheets (`replace`/`replaceSync`) and css in `blob:`s
- show sites' own urls in css rules' `cssText`
- hide hammerhead's keys from `Object.keys` and similar when its names are renamed at build time
- keep hammerhead's ui root out of the dom (pages saw an extra `<div>`, and query results became arrays)
- stop overriding query methods on `<body>`/`<head>` (they bypassed page hooks on `Element.prototype`)
- keep full stack depth under `Error.stackTraceLimit`, and map inline scripts' line:column
- report pages' own sizes in navigation timing
- make hammerhead's wrappers real functions instead of Proxies (prototype cycles and stack frames gave them away)
- fix `pushState`/`replaceState` accepting cross-origin urls, and move them to `History.prototype`
- fix stack positions of rewritten `obj[key](...)` calls
- run pages' own `frameElement` getters
- share hammerhead's native-function registry across frames (a frame's `toString` showed another frame's wrappers)
- fix `<style>` `innerText` adding `<br>`s, and `getElementsByTagName` returning a wrapper object
- send sites the right `sec-fetch-site` (it was always `same-origin`)
- stop adding an `origin` header to navigations and plain script/image loads
- run rammerhead.js in `about:blank` iframes too (its fixes were missing there, and anti-bot scripts take natives from them)
- hide cross-origin resource sizes and timings without `timing-allow-origin`, and report rewritten resources' own sizes
- keep long animation frame entries (hide hammerhead's scripts in them instead)
- fix `document.domain` for other frames' documents and `about:blank`
- deny the permissions browsers deny to cross-origin iframes (camera, geolocation, built-in ai, ...) unless delegated with `allow`, also in `document.featurePolicy`
- report webgl `powerPreference` as `low-power` in cross-origin iframes, like chrome
- move `registerProtocolHandler` and service worker overrides to their prototypes

### other

- fix sites that refuse framed visits (instagram, facebook) showing an error page when an embedder frames the proxy: top-level pages are fetched with `sec-fetch-dest: document`
- fix sites routing with the navigation api (instagram) seeing the proxy's url
- fix selectors on url attributes (`*=`, `$=`, `~=`, `|=`, and `matches`/`closest`) missing elements, which broke onetrust cookie banners on many sites
- fix scripts added from about:blank frames (cloudflare's bot check) being requested on port 80
- cache big bundles with imports once, filling in each session's urls, instead of rewriting them on every visit
- fix scripts that name a class field, label, catch parameter or destructured variable `parent`, `top` or `frameElement` failing to parse (brave search)
- expose `rhTrusted` on the hammerhead object, for embedders adding their own scripts under sites' trusted types policies
- renumber from v1.2.70 (was mislabeled v1.2.7, which sorts below v1.2.64)
- fix discord.com (workers crashing on shuffled urls)
- fix discord.com/login (`a?.b[key]` evaluating key after short-circuiting)
- fix memory leak: websocket connections to sites never closing (tiktok, spotify, twitch)
- fix memory leak: requests on dropped http2 connections never finishing
- fix requests hanging under load (one http2 connection per site shared by every user, mostly tiktok)
- fix scripts set via `script.textContent`/`innerText` not being rewritten (newer chrome shadows hammerhead's override)
- fix module workers (`importScripts` isn't allowed in modules)
- fix `ssl` option never listening on a port
- fix `t?.a[k].b` throwing after short-circuiting
- fix iframes inside a framed page seeing `frameElement` as null
- fix hammerhead's connection reset guard crashing on its first unexpected error
- fix crash on cookie segments without `key=` (e.g. `a=1; flag`)
- fix crash on hosts http2 can't parse (e.g. `a|b.example.com`)
- fix crash on header values with control or non-latin characters
- fix crash on huge response bodies from hammerhead's debug logger
- fix the js cache taking down every worker when a worker cached an empty script
- fix "The session has been destroyed" errors under load
- fix `RammerheadJSMemCache` never returning cached scripts
- fix old cached rewrites surviving updates
- fix `RammerheadProxy.close()` throwing without a session store
- cache rewritten and recompressed scripts
- cache public suffix lookups for cookies (~14% cpu)
- skip debug logging every response body (~5% cpu)
- answer 504 and log requests stuck longer than `stuckRequestTimeout` (default 3 minutes)
- log stack, origin, and request for crashes
- add `npm test` (fixture pages through the proxy in headless chromium)
- add `test/perf` load profiling and `RH_PERF_STATS=1` cache stats
- add `RH_CONFIG` to load a different config override file
- tested on node 18 to 26

## v1.2.70

- fix html not being processed correctly from shuffling
- added cloudflare js challenge integration with 2Captcha (and CapSolver but that doesn't work)
- more fixes for new version of `hammerhead.js`
- fix previously unproxied images
- catch all http2 errors
- added options to set timeouts for page loads and xhr loads
- rewrite `_top` target attributes to `_self` to prevent pages like google's signin button to jump out of the iframe
- fix jscache potential worker bugs with more than 2 workers
- fix localStorage bug (appears in www.google.com in the form of entering causing new-line instead of searching)
- rewrite import.meta for modern sites
- avoid writing the base url directly (as the js cache will make it fail given multiple domains)
- add the actual described logic in fixCorsMissingOriginHeader
- fix testcafe-hammerhead bug of unhandled cookieStr ending in a semicolon for "parseClientSyncCookieStr"
- fix issue of localStorage/sessionStorage misidentifying the host

## v1.2.64

- catch websocket errors
- re-enabled http2 by default. see `config.js` for details.

## v1.2.63

- add ability to override proxy settings on server-level basis
- update `testcafe-hammerhead` from `24.5.18` to `31.6.2`

## v1.2.62

- fix throw error on empty files

## v1.2.61

- fix missing cors origin header when port and crossDomainPort are the same

## v1.2.6

- properly fixed window.top issues when window.top isn't hammerhead
- replace unreliable `win.__get$(win, 'location')` with just rewriting the url directly 
- fix worker-hammerhead.js proxy url rewriting port undefined when 443 or 80

## v1.2.51

- add newly added classes to exports in src/index.js

## v1.2.5

- replace broken `keyv-lru-files` with own implementation of JS caching

## v1.2.42

- fix localStorage's getItem referencing parent in iframes

## v1.2.41

- handle removeStaleSessions of .get() returning undefined from corrupted session files

## v1.2.4

- fix crashes from corrupted sessions

## v1.2.3

- fix memory usage issues when downloading huge files
- fix iframing cross-origin proxy

## v1.2.2

- add disk cache option for processed JS files. fixes huge server memory usage and enables workers to share the same cache
- update `testcafe-hammerhead` to `v24.5.18`. fixes huge server slowdowns as brotli compression level is now adjusted to a much more reasonable value

## v1.2.11

- fix huge spikes of memory usage by replacing localStorage system with a custom one
- more fixes for iframing

## v1.2.01

- avoid using unstable API `fs.cpSync` in build.js

## v1.2.0

- added multithreading support

## v1.1.34

- convert hooks to stackable rewrite system

## v1.1.33

- delete hooks only after all fix function calls

## v1.1.32

- fix localStorage communication between windows by forcing them to read/write from realLocalStorage on every (get/set)Item call 

## v1.1.31

- add argument for ignoring files in `addStaticFilesToProxy`
- fix parseProxyUrl().proxy.port for 443 and 80 urls

## v1.1.3

- add option to restrict IP to session

## v1.1.21

- fix rewriting only non-websocket server headers
- fix errors when calling focus()/click()... to a closed iframe
- don't strip headers (hook onto res.writeHead) if connection is a websocket

## v1.1.2

- build to rammerhead.js and rammerhead.min.js
- fix same-domain iframes
- add jsdoc definitions for rammerhead store classes
- fix http proxy setting not deleting correctly

## v1.1.1

- fix uncatchable connection crash errors
- avoid shuffling percent encodings
- prevent forwarding localStorage endpoint to site by referrer
- fix (un)shuffle for location.hash and location.search

## v1.1.0

- add url encoding
- handle ECONNRESET manually
- bring back MemoryStore class for module exports
- add server option to disable localStorage syncing
- fix `RammerheadSessionFileCache` not saving cache to disk correctly

## v1.0.8

- handle websocket EPIPE error
- replace hammerhead's connection reset guard with a non-crashing rammerhead's reset guard
- add missing element attr getter unrewrite
- fix url rewriting for ports 80 and 443

## v1.0.7

- disable http2 support (for proxy to destination sites) because error handling is too complicated to handle
- removed server headers `report-to` (to avoid proxy url leak) and `cross-origin-embedder-policy` (which fixes reCAPTCHA v3)

## v1.0.61

- fix logger.error undefined (caused by not fully updating arguments for httpResponse.badRequest)

## v1.0.6

- expose more utils for npm package
- show password box if needed for html demo

## v1.0.5

- expose more modules for npm package
- add support for .env files
- add `deleteUnused` config option
- fix default 3 day session delete

## v1.0.43

- revert "revert fix for fix npm package"

## v1.0.42

- add entrypoint index.js for rammerhead package
- add package-lock.json to source control

## v1.0.41

- update demo link
- fix npm package

## v1.0.4

- add support for environment variable `DEVELOPMENT`
- fix crash when fetching /deletesession with a non-existent session id

## v1.0.3

- fix stability issues with websocket

## v1.0.2

- update `testcafe-hammerhead` to `v24.5.13`

## v1.0.1

- removed multi worker and rate limiting support to defer the complexity to other more suitable platforms like Docker. See [this commit](https://github.com/binary-person/rammerhead/tree/31ac3d23f30487f0dcd14323dc029f4ceb3b235a) if you wish to see the original attempt at this.
- removed unused session cleanup (as traversing the session list forces the cache into memory)
- lots of cleanup

## v1.0.0

- Initial commit
