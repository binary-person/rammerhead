// small pure functions, no proxy needed
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const sanitizeHeaderValues = require('../src/util/sanitizeHeaderValues');

test('sanitized header values are always accepted by node', () => {
    const headers = sanitizeHeaderValues({
        'content-disposition': 'attachment; filename="résumé ✓ 日本.pdf"',
        'x-control': 'a\x01b\x7fc\nd',
        'set-cookie': ['a=1', 'b=✓'],
        'x-plain': 'fine\tvalue',
        'content-length': 42
    });
    for (const [name, value] of Object.entries(headers)) {
        for (const v of [].concat(value)) assert.doesNotThrow(() => http.validateHeaderValue(name, String(v)), name);
    }
    assert.strictEqual(headers['x-plain'], 'fine\tvalue');
    assert.strictEqual(headers['x-control'], 'abcd');
    assert.strictEqual(headers['content-length'], 42);
    // browsers decode these bytes as utf-8
    assert.strictEqual(
        Buffer.from(headers['content-disposition'], 'latin1').toString('utf8'),
        'attachment; filename="résumé ✓ 日本.pdf"'
    );
});

test("hammerhead's connection reset guard keeps catching errors after an unexpected one", () => {
    const { spawnSync } = require('child_process');
    const child = spawnSync(process.execPath, [require('path').join(__dirname, 'fixtures/guard-child.js')], { encoding: 'utf8' });
    assert.strictEqual(child.status, 0, child.stderr.split('\n').slice(0, 3).join('\n'));
    assert.match(child.stdout, /survived/);
});

test('sec-fetch-site and referrers are worked out from the real urls', () => {
    const { fetchSite, effectiveReferrer } = require('../src/util/referrerPolicy');
    assert.strictEqual(fetchSite('https://www.example.com/a', 'https://www.example.com/b'), 'same-origin');
    assert.strictEqual(fetchSite('https://www.example.com/a', 'https://cdn.example.com/b'), 'same-site');
    assert.strictEqual(fetchSite('https://www.example.com/', 'https://challenges.cloudflare.com/x'), 'cross-site');
    assert.strictEqual(fetchSite('https://a.example.co.uk/', 'https://b.other.co.uk/'), 'cross-site');
    const page = 'https://www.example.com/page?q=1#h';
    assert.strictEqual(effectiveReferrer(page, 'https://other.com/', undefined), 'https://www.example.com/');
    assert.strictEqual(effectiveReferrer(page, 'https://www.example.com/x', undefined), 'https://www.example.com/page?q=1');
    assert.strictEqual(effectiveReferrer(page, 'https://other.com/', 'same-origin'), '');
    assert.strictEqual(effectiveReferrer(page, 'http://www.example.com/', 'strict-origin'), '');
});

test('a top-level page framed by an embedder is fetched like a top-level page (instagram)', () => {
    require('../src/util/referrerPolicy');
    const transforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms');
    const dest = transforms.requestTransforms['sec-fetch-dest'];
    // rammerhead browser's tab frame: no iframe flag in the proxy url
    assert.strictEqual(dest('iframe', { dest: { isIframe: false } }), 'document');
    // an iframe inside a proxied page stays one
    assert.strictEqual(dest('iframe', { dest: { isIframe: true } }), 'iframe');
    assert.strictEqual(dest('script', { dest: { isIframe: false } }), 'script');
});

test('content security policies are rewritten for the proxy', () => {
    const { rewritePolicy, rewriteHeader } = require('../src/util/cspRewrite');
    const options = { origins: ['http://proxy:8080'], nonce: 'N' };
    const own = ['/hammerhead.js', '/rammerhead.js', '/task.js', '/iframe-task.js', '/worker-hammerhead.js']
        .map((p) => 'http://proxy:8080' + p)
        .join(' ');
    // workers fall back to script-src
    const worker = ' http://proxy:8080/transport-worker.js';
    // hosts also allow the proxy, our nonce and scripts are allowed, reporting goes
    assert.strictEqual(
        rewritePolicy("script-src 'self' https://cdn.example; img-src data: https:; report-uri /r", options),
        "script-src 'self' http://proxy:8080 https://cdn.example 'nonce-N' " + own + worker + '; img-src data: https: http://proxy:8080'
    );
    // no nonce where it would turn 'unsafe-inline' off
    assert.strictEqual(
        rewritePolicy("script-src 'unsafe-inline'", options),
        "script-src 'unsafe-inline' " + own + worker
    );
    // but with strict-dynamic (host sources are ignored) it's the only way in
    assert.ok(rewritePolicy("script-src 'unsafe-inline' 'strict-dynamic'", options).includes("'nonce-N'"));
    // 'none' can't be combined with other sources
    assert.strictEqual(
        rewritePolicy("default-src 'none'", options),
        "default-src 'nonce-N' " +
            own +
            worker +
            ' http://proxy:8080/messaging http://proxy:8080/syncLocalStorage' +
            ' http://proxy:8080/api/ ws://proxy:8080/messaging'
    );
    // framing is the proxy's business (github's 'none' blocked it in rammerhead browser)
    assert.strictEqual(rewritePolicy("frame-ancestors 'none'; img-src 'self'", options), "img-src 'self' http://proxy:8080");
    // hammerhead's trusted types policy, same-origin sandbox, no upgrades over plain http
    assert.strictEqual(
        rewritePolicy("trusted-types 'none'; sandbox allow-scripts; upgrade-insecure-requests", options),
        'trusted-types hammerhead; sandbox allow-scripts allow-same-origin'
    );
    // rewritten inline scripts' hashes next to the site's
    assert.ok(
        rewritePolicy("script-src 'sha256-a'", { ...options, hashes: { "'sha256-a'": ["'sha256-b'"] } }).startsWith(
            "script-src 'sha256-a' 'sha256-b'"
        )
    );
    assert.strictEqual(rewriteHeader("img-src 'self', img-src https:", options).split(', ').length, 2);
});

test('top, parent and frameElement used as names stay names after processing (brave search class fields)', () => {
    const rhWindowLiteral = require('../src/util/rewriteWindowLiteral');
    const { processScript } = require('testcafe-hammerhead/lib/processing/script');
    // hammerhead's own parser: what it can parse, it processes
    const acorn = require(require.resolve('acorn-hammerhead', { paths: [require.resolve('testcafe-hammerhead')] }));
    const names = [
        'var a = class { parent; top = 1; static frameElement; parent() {} };',
        'class B { top; }',
        'var c = class parent {};',
        'top: for (;;) { break top; }',
        'parent: while (1) { continue parent; }',
        'try {} catch (frameElement) {}',
        'var [parent] = [1]; [top] = [2];',
        'for (parent of []) {} for (top in {}) {}'
    ];
    for (const code of names) {
        const out = processScript(code, false);
        assert.doesNotThrow(() => acorn.parse(out, { ecmaVersion: 2022, sourceType: 'script' }), code + '\n→ ' + out);
        assert.ok(!/__rhget\$/.test(out), 'nothing to wrap in: ' + code + '\n→ ' + out);
    }
    const imports = processScript('import parent from "a"; import * as top from "b"; export { parent };', false);
    assert.doesNotThrow(() => acorn.parse(imports, { ecmaVersion: 2022, sourceType: 'module' }), imports);
    // reading them still goes through rammerhead
    const reads = processScript('var x = parent, y = top.location, z = { a: frameElement }; class D { f = parent; [top] = 1; }', false);
    assert.strictEqual(reads.match(/__rhget\$(Parent|Top|FrameElement)\(/g).length, 5, reads);
    // the client gets the same transformer
    const client = require('fs').readFileSync(require('path').join(__dirname, '../src/client/hammerhead.js'), 'utf8');
    assert.ok(client.includes(rhWindowLiteral.condition.toString()), 'client hammerhead.js has a different rh-get condition: run node src/build.js');
});

test('the task script and its iframe template stay valid javascript with custom storage key names', async () => {
    const vm = require('vm');
    const RammerheadSession = require('../src/classes/RammerheadSession');
    const before = RammerheadSession.storageKeyDeriver;
    RammerheadSession.storageKeyDeriver = (host, id) => ({ rhStorageKeys: { browserLocalStorage: 'x1|', note: 'quote " and \\ ' + host + id } });
    try {
        const session = new RammerheadSession();
        const serverInfo = { hostname: 'example.test', port: 443, protocol: 'https:', crossDomainPort: 443 };
        const script = await session.getTaskScript({ referer: 'https://example.com/', cookieUrl: 'https://example.com/', serverInfo, isIframe: false, withPayload: true });
        assert.doesNotThrow(() => new vm.Script(script), 'task script');
        const template = JSON.parse(await session.getIframeTaskScriptTemplate(serverInfo));
        assert.match(template, /x1\|/);
        assert.doesNotThrow(() => new vm.Script(template.replace(/\{\{\{\w+\}\}\}/g, 'null')), 'iframe template');
        // run both against a fake hammerhead: start() and what it runs (rammerhead.js hooks the prototype's start,
        // its listeners read the keys right away) must already see the derived settings
        for (const code of [script, template.replace(/\{\{\{\w+\}\}\}/g, 'null')]) {
            const seen = [];
            const proto = { start(initSettings) { this.settings._settings = initSettings; seen.push(initSettings.rhStorageKeys && initSettings.rhStorageKeys.browserLocalStorage); } };
            const hammerhead = Object.assign(Object.create(proto), {
                settings: { _settings: {}, get() { return this._settings; } },
                utils: { removeInjectedScript() {}, url: { parseProxyUrl: () => ({ destUrl: 'https://example.com/' }) } },
                nativeMethods: { querySelectorAll: () => [] }
            });
            const window = { '%hammerhead%': hammerhead };
            window.window = window;
            vm.runInNewContext(code, { window, document: {}, location: { href: 'https://example.test/x' } });
            assert.deepStrictEqual(seen, ['x1|']);
            assert.ok(!Object.prototype.hasOwnProperty.call(hammerhead, 'start'), 'the one-time start is gone');
        }
    } finally {
        RammerheadSession.storageKeyDeriver = before;
    }
});
