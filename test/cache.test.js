const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startProxy, startSite, newSession, PROXY, SITE } = require('./helpers');

// hammerhead's instrumentation, also as deploy builds rename it (_$<12 hex>)
const REWRITTEN = /__get\$|__set\$|_\$[0-9a-f]{12}/;

let proxy;
let site;
before(async () => {
    [site, proxy] = await Promise.all([startSite(), startProxy()]);
});
after(() => {
    proxy.kill();
    site.close();
});

// requests a destination script through the proxy as the given session
async function getScript(sessionId, sitePath) {
    const res = await fetch(`${PROXY}/${sessionId}!s!utf-8/${SITE}${sitePath}`);
    return { status: res.status, encoding: res.headers.get('content-encoding'), body: await res.text() };
}

for (const encoding of ['gzip', 'br']) {
    test(`a ${encoding} script is rewritten the same for every user`, async () => {
        const [a, b] = await Promise.all([newSession(), newSession()]);
        const first = await getScript(a, `/cache/plain.js?encoding=${encoding}`);
        // second user is served from the compressed cache
        const second = await getScript(b, `/cache/plain.js?encoding=${encoding}`);
        assert.strictEqual(first.status, 200);
        assert.strictEqual(second.encoding, encoding);
        assert.match(first.body, REWRITTEN, 'script was not rewritten');
        assert.strictEqual(second.body, first.body);
    });
}

test("a script with session-specific urls never leaks one user's session to another", async () => {
    const [a, b] = await Promise.all([newSession(), newSession()]);
    const first = await getScript(a, '/cache/module.js?encoding=gzip');
    const second = await getScript(b, '/cache/module.js?encoding=gzip');
    assert.ok(first.body.includes(a), 'expected the import url to be rewritten for user A');
    assert.ok(second.body.includes(b), "user B didn't get their own import url");
    assert.ok(!second.body.includes(a), "user B got user A's session id");
});

test("a big bundle with imports is rewritten once and still gets each user's own urls", async () => {
    const [a, b] = await Promise.all([newSession(), newSession()]);
    const t0 = Date.now();
    const first = await getScript(a, '/cache/big-module.js');
    const coldMs = Date.now() - t0;
    const t1 = Date.now();
    const second = await getScript(b, '/cache/big-module.js');
    const warmMs = Date.now() - t1;
    assert.ok(first.body.length > 2 * 1024 * 1024 && REWRITTEN.test(first.body), `not rewritten (${first.status}, ${first.body.length} bytes: ${first.body.slice(0, 120)})`);
    for (const [body, own, other] of [[first.body, a, b], [second.body, b, a]]) {
        assert.match(body, new RegExp('import \\{ dep \\} from\\s+"[^"]*/' + own + '!s!utf-8/'), 'static import not rewritten for its user');
        assert.ok(body.includes(own) && !body.includes(other), "a user got someone else's session");
        assert.ok(!/rh-url-placeholder-/.test(body), 'placeholder left in');
    }
    assert.ok(warmMs < coldMs / 2, `second user waited ${warmMs}ms (first ${coldMs}ms): not served from the cache`);
});

test('a site that prefers zstd still gets its scripts rewritten', async () => {
    const id = await newSession();
    // what chrome sends
    const res = await fetch(`${PROXY}/${id}!s!utf-8/${SITE}/cache/plain.js?encoding=negotiate`, {
        headers: { 'accept-encoding': 'gzip, deflate, br, zstd' }
    });
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), REWRITTEN, 'script was not rewritten');
});

test('a worker writing an empty script to the shared js cache does not crash the master', () => {
    const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'rh-jscache-'));
    const result = require('child_process').spawnSync(
        process.execPath,
        [require('path').join(__dirname, 'fixtures/js-cache-cluster.js'), dir],
        { encoding: 'utf8', timeout: 20000 }
    );
    require('assert').strictEqual(result.status, 0, result.stderr);
});
