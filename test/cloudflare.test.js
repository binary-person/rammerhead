const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startProxy, newSession, PROXY } = require('./helpers');
const { startCFSite, site } = require('./cfsite');

const dirs = {
    RH_TEST_CF_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rammerhead-test-cf-')),
    RH_TEST_SESSIONS_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rammerhead-test-sessions-'))
};
const proxyEnv = {
    ...dirs,
    RH_CONFIG: path.join(__dirname, 'cf-config.js'),
    NODE_OPTIONS: '--require ' + path.join(__dirname, 'fixtures/dns-map.js'),
    // the fake site's certificate is self-signed
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    NODE_NO_WARNINGS: '1'
};

let cf;
let proxy;
let browser;
before(async () => {
    [cf, proxy, browser] = await Promise.all([startCFSite(), startProxy(proxyEnv), chromium.launch()]);
});
after(async () => {
    proxy.kill();
    cf.close();
    await browser.close();
});

// what the fake site counted during fn()
async function counting(fn) {
    const before = JSON.parse(JSON.stringify(cf.stats));
    const result = await fn();
    const after = cf.stats;
    return {
        result,
        tasks: after.tasks - before.tasks,
        challenges: after.challenges - before.challenges,
        rejected: after.submits.rejected - before.submits.rejected,
        solverUaRequests: after.solverUaRequests - before.solverUaRequests,
        nativeRenders: after.nativeRenders - before.nativeRenders
    };
}

// loads the site in a session and waits for it to get past the challenge. hookCalls counts
// rhHookCloudflareFreeFailed (cloudflare's own check failed)
let hookCalls = 0;
async function visit(sessionId, domain, timeout = 30000) {
    const page = await browser.newPage();
    await page.exposeFunction('rhTestFreeFailed', () => hookCalls++);
    await page.addInitScript(() => {
        window.rhHookCloudflareFreeFailed = () => window.rhTestFreeFailed();
    });
    try {
        await page.goto(`${PROXY}/${sessionId}/${site(domain)}/`).catch(() => {});
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const text = await page.evaluate(() => document.body && document.body.innerText).catch(() => '');
            if (text && text.includes('passed')) return true;
            await new Promise((r) => setTimeout(r, 200));
        }
        return false;
    } finally {
        await page.close();
    }
}

async function freeMode(sessionId, domain) {
    const url = encodeURIComponent(site(domain) + '/');
    return (await fetch(`${PROXY}/api/cloudflare-bulldozer-free?sessionId=${sessionId}&url=${url}`)).text();
}

let firstSession;
test('a challenged site gets solved and loads', async () => {
    firstSession = await newSession();
    const { result } = await counting(() => visit(firstSession, 'rhcf-a.com'));
    assert.ok(result, 'never got past the challenge');
});

test("once 2captcha's user-agent is known, a new site takes a single solve", async () => {
    const { result, tasks, rejected } = await counting(async () => visit(await newSession(), 'rhcf-b.com'));
    assert.ok(result, 'never got past the challenge');
    assert.deepStrictEqual({ tasks, rejected }, { tasks: 1, rejected: 0 });
});

test('a solved site is reused by other sessions without solving again', async () => {
    const { result, tasks } = await counting(async () => visit(await newSession(), 'rhcf-a.com'));
    assert.ok(result, 'never got past the challenge');
    assert.strictEqual(tasks, 0);
});

test('after a worker restart, a solved session loads the site without a challenge', async () => {
    proxy.kill();
    await new Promise((r) => proxy.once('exit', r));
    proxy = await startProxy(proxyEnv);
    const { result, tasks, challenges } = await counting(() => visit(firstSession, 'rhcf-a.com'));
    assert.ok(result, 'never got past the challenge');
    assert.deepStrictEqual({ tasks, challenges }, { tasks: 0, challenges: 0 });
});

test("cloudflare's own widget gets the first try, and a pass costs nothing", async () => {
    const session = await newSession();
    const calls = hookCalls;
    const { result, tasks, nativeRenders } = await counting(() => visit(session, 'rhcf-free.com'));
    assert.ok(result, 'never got past the challenge');
    assert.deepStrictEqual({ tasks, nativeRenders, hookCalls: hookCalls - calls }, { tasks: 0, nativeRenders: 1, hookCalls: 0 });
    assert.strictEqual(await freeMode(session, 'rhcf-free.com'), 'try');
});

test('when the widget wants a checkbox, the solver takes over, and the session skips the widget there next time', async () => {
    const session = await newSession();
    assert.strictEqual(await freeMode(session, 'rhcf-checkbox.com'), 'try');
    const calls = hookCalls;
    const { result, tasks, rejected, nativeRenders } = await counting(() => visit(session, 'rhcf-checkbox.com'));
    assert.ok(result, 'never got past the challenge');
    // the widget once; after the reload to 2captcha's user-agent, straight to the solver
    assert.deepStrictEqual({ tasks, rejected, nativeRenders }, { tasks: 1, rejected: 0, nativeRenders: 1 });
    // pages hear that cloudflare's own check failed (rammerhead-browser tells users without a ticket)
    assert.ok(hookCalls - calls >= 1, 'rhHookCloudflareFreeFailed never ran');
    assert.strictEqual(await freeMode(session, 'rhcf-checkbox.com'), 'skip');
    // only for that session and site
    assert.strictEqual(await freeMode(session, 'rhcf-free.com'), 'try');
    assert.strictEqual(await freeMode(await newSession(), 'rhcf-checkbox.com'), 'try');
});

test("a session falling back to the solver doesn't change other sessions' user-agent on that site", async () => {
    const domain = 'rhcf-freeshared.com';
    const fallenBack = await newSession();
    // what a page sends once cloudflare's own widget failed
    const res = await fetch(`${PROXY}/api/cloudflare-bulldozer?sessionId=${fallenBack}`, {
        method: 'POST',
        body: JSON.stringify({ sitekey: '0xFAKE', pageurl: site(domain) + '/', data: 'x', pagedata: 'x', action: 'managed', userAgent: 'x' })
    });
    assert.strictEqual(await res.text(), 'ok');
    const other = await counting(async () => visit(await newSession(), domain));
    assert.ok(other.result, 'never got past the challenge');
    assert.deepStrictEqual({ tasks: other.tasks, solverUaRequests: other.solverUaRequests }, { tasks: 0, solverUaRequests: 0 });
    const own = await counting(() => visit(fallenBack, domain));
    assert.ok(own.result, 'never got past the challenge');
    assert.ok(own.solverUaRequests > 0, "the session that fell back didn't switch to the solver's user-agent");
});

test('a site that rejects every token costs at most 3 paid solves, then gets cloudflare\'s own widget back', async () => {
    const { result, tasks, nativeRenders } = await counting(async () => visit(await newSession(), 'rhcf-rejectall.com', 60000));
    assert.strictEqual(result, false);
    assert.strictEqual(tasks, 3);
    assert.ok(nativeRenders >= 2, 'widget shown again after giving up');
    // other sites still get solved
    const other = await counting(async () => visit(await newSession(), 'rhcf-afterreject.com'));
    assert.ok(other.result, 'never got past the challenge');
});
