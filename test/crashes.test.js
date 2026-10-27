// requests that crashed production workers (from their logs). each one must get a response and
// leave the proxy running
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startProxy, startSite, newSession, PROXY, SITE } = require('./helpers');

let proxy;
let site;
before(async () => {
    [site, proxy] = await Promise.all([startSite(), startProxy()]);
});
after(() => {
    proxy.kill();
    site.close();
});

async function proxyStillWorks(sessionId) {
    // give an uncaught error a moment to kill the process
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(proxy.exitCode, null, 'proxy process died');
    const res = await fetch(`${PROXY}/${sessionId}/${SITE}/workers/pong.js`);
    assert.strictEqual(res.status, 200);
}

for (const cookie of ['flag', 'a=1; flag', 'a=1;; b=2', ';', 'a=1; ; b=2', '=']) {
    test(`cookie header ${JSON.stringify(cookie)}`, async () => {
        const id = await newSession();
        const res = await fetch(`${PROXY}/${id}/${SITE}/workers/pong.js`, { headers: { cookie } }).catch((e) => e);
        assert.ok(!(res instanceof Error), 'request failed: ' + (res && res.message));
        await proxyStillWorks(id);
    });
}

// hammerhead's lenient url parsing accepts hosts that http2.connect() rejects synchronously
for (const host of ['example.com%20', 'exa%20mple.invalid', 'a|b.example.com', 'a^b.example.com']) {
    test(`https destination with host ${host}`, async () => {
        const id = await newSession();
        const res = await fetch(`${PROXY}/${id}/https://${host}/`, { signal: AbortSignal.timeout(10000) }).catch(
            (e) => e
        );
        assert.ok(!(res instanceof Error), 'request failed: ' + (res && res.message));
        await proxyStillWorks(id);
    });
}

test('without a cloudflare solver, solver api calls are not forwarded to the site (with the session id)', async () => {
    const http = require('http');
    const hits = [];
    const site = http.createServer((req, res) => {
        hits.push(req.url);
        res.end('site');
    });
    await new Promise((r) => site.listen(18097, '127.0.0.1', r));
    try {
        const id = await newSession();
        const referer = `${PROXY}/${id}/http://127.0.0.1:18097/page`;
        for (const [method, path] of [
            ['POST', '/api/cloudflare-bulldozer'],
            ['GET', '/api/cloudflare-bulldozer-status'],
            ['GET', '/api/cloudflare-bulldozer-response']
        ]) {
            const res = await fetch(`${PROXY}${path}?sessionId=${id}&url=http%3A%2F%2F127.0.0.1%3A18097%2F`, {
                method,
                headers: { referer },
                body: method === 'POST' ? '{}' : undefined
            });
            assert.strictEqual(res.status, 404, path);
        }
        assert.deepStrictEqual(hits, []);
    } finally {
        site.close();
    }
});
