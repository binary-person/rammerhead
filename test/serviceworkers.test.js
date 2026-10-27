// service workers are off through the proxy: register() rejects like a browser without them, and the ones older
// versions left (at the proxy's root, one site's worker in front of every page) are removed
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startProxy, startSite, newSession, PROXY, SITE } = require('./helpers');

// with a deployment secret every proxied url ends in the cache tag (serviceworkers-tagged.test.js)
const TAGGED = process.env.RH_SW_TAGGED === '1';
let proxy;
let site;
let browser;
before(async () => {
    [site, proxy, browser] = await Promise.all([startSite(), startProxy(TAGGED ? { DEPLOY_SECRET: 'sw-test' } : undefined), chromium.launch()]);
});
after(async () => {
    await browser.close();
    proxy.kill();
    site.close();
});

// the proxy origin's real registrations, read natively (from a page the proxy doesn't rewrite)
async function nativeScopes(context) {
    const page = await context.newPage();
    await page.goto(PROXY + '/hammerhead.js');
    const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope).sort());
    await page.close();
    return scopes;
}

async function run(context, url) {
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.goto(url);
    const deadline = Date.now() + 15000;
    while (!logs.includes('done') && Date.now() < deadline) await page.waitForTimeout(100);
    await page.close();
    return logs;
}

for (const shuffling of ['0', '1']) {
    for (const mode of ['string', 'trusted', 'url']) {
        test(`registering with a ${mode} script url rejects and registers nothing (shuffling ${shuffling === '1' ? 'on' : 'off'})`, async () => {
            const context = await browser.newContext();
            try {
                const id = await newSession();
                await fetch(`${PROXY}/editsession?id=${id}&enableShuffling=${shuffling}`);
                const logs = await run(context, `${PROXY}/${id}/${SITE}/sw/app/page.html?mode=${mode}`);
                assert.ok(logs.includes('register: rejected SecurityError'), logs.join('\n'));
                assert.ok(logs.includes('registrations: 0'), logs.join('\n'));
                assert.ok(logs.includes('registration: undefined'), logs.join('\n'));
                assert.deepStrictEqual(await nativeScopes(context), []);
            } finally {
                await context.close();
            }
        });
    }
}

test('service workers older versions registered (at the root, or a site scope) are removed on the next page load', async () => {
    const context = await browser.newContext();
    try {
        const id = await newSession();
        const page = await context.newPage();
        await page.goto(`${PROXY}/${id}/${SITE}/sw/app/page.html?mode=none`);
        await page.waitForTimeout(1000);
        await page.evaluate(async () => {
            const hh = window['%hammerhead%'];
            const script = hh.utils.url.getProxyUrl(location.origin + '/sw/app/sw.js', { resourceType: 'c' }).replace(/^https?:\/\/[^/]+/, '');
            const register = (scope) => hh.nativeMethods.registerServiceWorker.call(navigator.serviceWorker, script, { scope }).catch(() => {});
            await register('/');
            await register(script.replace(/sw\.js.*$/, ''));
        });
        await page.close();
        assert.ok((await nativeScopes(context)).length >= 1, 'the old registrations exist');
        await run(context, `${PROXY}/${id}/${SITE}/sw/app/page.html?mode=none`);
        await new Promise((r) => setTimeout(r, 500));
        assert.deepStrictEqual(await nativeScopes(context), []);
    } finally {
        await context.close();
    }
});

test('a worker under a trusted types csp gets the engine: its own relative requests reach the site', async () => {
    const context = await browser.newContext();
    try {
        const id = await newSession();
        const logs = await run(context, `${PROXY}/${id}/${SITE}/sw/tt/page.html`);
        assert.ok(logs.includes('worker: from-worker site-data'), logs.join('\n'));
    } finally {
        await context.close();
    }
});
