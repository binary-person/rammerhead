const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startProxy, newSession, PROXY } = require('./helpers');
const { startH2Site } = require('./h2site');

let proxy;
let site;
before(async () => {
    site = await startH2Site({ maxConcurrentStreams: 5 });
    // the test site's certificate is self-signed
    proxy = await startProxy({ NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_NO_WARNINGS: '1' });
});
after(() => {
    proxy.kill();
    site.close();
});

// fetch a destination path through the proxy as the given session
async function timed(sessionId, sitePath, timeout = 10000, { flags = '', accept = '*/*' } = {}) {
    const start = Date.now();
    try {
        const res = await fetch(`${PROXY}/${sessionId}${flags}/${site.origin}${sitePath}`, {
            signal: AbortSignal.timeout(timeout),
            headers: { accept }
        });
        return { status: res.status, body: await res.text(), ms: Date.now() - start };
    } catch (e) {
        return { status: e.name === 'TimeoutError' ? 'timeout' : e.message, ms: Date.now() - start };
    }
}

test("one user's slow requests don't block another user on the same site", async () => {
    const [userA, userB] = await Promise.all([newSession(), newSession()]);
    // like a busy tiktok tab: more long requests in flight than the site allows per connection
    const flood = Array.from({ length: 20 }, () => timed(userA, '/slow?ms=3000', 20000));
    await new Promise((r) => setTimeout(r, 300));

    const b = await timed(userB, '/fast');
    assert.strictEqual(b.status, 200);
    assert.ok(b.ms < 1000, `user B waited ${b.ms}ms behind user A's requests`);
    await Promise.all(flood);
});

test('requests keep working after the site gracefully closes the connection', async () => {
    const id = await newSession();
    assert.strictEqual((await timed(id, '/goaway')).status, 200);
    const next = await timed(id, '/fast', 5000);
    assert.strictEqual(next.status, 200, `got ${next.status} after ${next.ms}ms`);
});

test('a dropped connection fails the request quickly instead of hanging', async () => {
    const id = await newSession();
    const dropped = await timed(id, '/reset');
    assert.notStrictEqual(dropped.status, 'timeout', 'request hung until the client gave up');
    assert.ok(dropped.ms < 5000, `took ${dropped.ms}ms to fail`);

    const next = await timed(id, '/fast', 5000);
    assert.strictEqual(next.status, 200, `got ${next.status} after ${next.ms}ms`);
    assert.strictEqual(proxy.exitCode, null, 'proxy process died');
});

const midwayCases = [];
for (const sitePath of ['/abort-body', '/drop-body']) {
    midwayCases.push([sitePath, {}]);
    midwayCases.push([sitePath + '?type=js', { flags: '!s!utf-8' }]);
    midwayCases.push([sitePath + '?type=html', { accept: 'text/html' }]);
}
for (const [sitePath, request] of midwayCases) {
    test(`a response failing midway (${sitePath}) doesn't crash the proxy`, async () => {
        const id = await newSession();
        const failed = await timed(id, sitePath, 10000, request);
        assert.notStrictEqual(failed.status, 'timeout', 'request hung until the client gave up');
        // give an uncaught error a moment to kill the process
        await new Promise((r) => setTimeout(r, 300));
        assert.strictEqual(proxy.exitCode, null, 'proxy process died');
        assert.strictEqual((await timed(id, '/fast', 5000)).status, 200);
    });
}

// the browser gives up on a request (closed tab, navigation) while the site is still responding,
// and then the site fails the response too
for (const [sitePath, request] of midwayCases) {
    test(`client disconnecting before ${sitePath} fails doesn't crash the proxy`, async () => {
        const id = await newSession();
        const controller = new AbortController();
        const pending = fetch(`${PROXY}/${id}${request.flags || ''}/${site.origin}${sitePath}`, {
            signal: controller.signal,
            headers: { accept: request.accept || '*/*' }
        })
            .then((res) => res.text())
            .catch(() => {});
        setTimeout(() => controller.abort(), 20);
        await pending;
        await new Promise((r) => setTimeout(r, 300));
        assert.strictEqual(proxy.exitCode, null, 'proxy process died');
        assert.strictEqual((await timed(id, '/fast', 5000)).status, 200);
    });
}

test('a header with non-latin characters is passed on without crashing the proxy', async () => {
    const id = await newSession();
    const res = await fetch(`${PROXY}/${id}/${site.origin}/utf8-header`, { signal: AbortSignal.timeout(10000) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), 'file');
    // browsers read the raw header bytes as utf-8 here, so the filename should survive
    assert.strictEqual(
        Buffer.from(res.headers.get('content-disposition'), 'latin1').toString('utf8'),
        'attachment; filename="résumé ✓ 日本.pdf"'
    );
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(proxy.exitCode, null, 'proxy process died');
});
