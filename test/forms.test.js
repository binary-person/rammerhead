// a GET form through the proxy with a deployment secret (every proxied url ends in the cache tag): the browser puts
// the form's fields after the tagged action url, and the site still gets its page and its query
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { startProxy, startSite, newSession, PROXY, SITE } = require('./helpers');

let proxy;
let site;
let browser;
before(async () => {
    [site, proxy, browser] = await Promise.all([startSite(), startProxy({ DEPLOY_SECRET: 'forms-test' }), chromium.launch()]);
});
after(async () => {
    await browser.close();
    proxy.kill();
    site.close();
});

for (const shuffling of ['0', '1']) {
    test(`a GET form reaches its page with its fields (shuffling ${shuffling === '1' ? 'on' : 'off'})`, async () => {
        const context = await browser.newContext();
        try {
            const id = await newSession();
            await fetch(`${PROXY}/editsession?id=${id}&enableShuffling=${shuffling}`);
            const page = await context.newPage();
            const logs = [];
            page.on('console', (m) => logs.push(m.text()));
            await page.goto(`${PROXY}/${id}/${SITE}/forms/form.html`);
            const deadline = Date.now() + 15000;
            while (!logs.some((l) => l.startsWith('result: ')) && Date.now() < deadline) await page.waitForTimeout(100);
            assert.ok(logs.includes('result: /forms/result.html?q=a+b&hl=en'), logs.join('\n'));
        } finally {
            await context.close();
        }
    });
}

for (const shuffling of ['0', '1']) {
    test(`a page's own location has no cache tag: with a query, without, after a redirect (shuffling ${shuffling === '1' ? 'on' : 'off'})`, async () => {
        const context = await browser.newContext();
        try {
            const id = await newSession();
            await fetch(`${PROXY}/editsession?id=${id}&enableShuffling=${shuffling}`);
            for (const path of ['/forms/result.html', '/forms/result.html?gws_rd=ssl']) {
                const page = await context.newPage();
                const logs = [];
                page.on('console', (m) => logs.push(m.text()));
                await page.goto(`${PROXY}/${id}/${SITE}${path}`);
                const deadline = Date.now() + 15000;
                while (!logs.some((l) => l.startsWith('result: ')) && Date.now() < deadline) await page.waitForTimeout(100);
                assert.ok(logs.includes('result: ' + path), logs.join('\n'));
                await page.close();
            }
            // a redirect: the server builds the new url (shuffled, then tagged)
            const page = await context.newPage();
            const logs = [];
            page.on('console', (m) => logs.push(m.text()));
            await page.goto(`${PROXY}/${id}/${SITE}/forms/result.html?redirect=${encodeURIComponent('/forms/result.html?gws_rd=ssl')}`);
            const deadline = Date.now() + 15000;
            while (!logs.some((l) => l.startsWith('result: ')) && Date.now() < deadline) await page.waitForTimeout(100);
            assert.ok(logs.includes('result: /forms/result.html?gws_rd=ssl'), logs.join('\n'));
        } finally {
            await context.close();
        }
    });
}

test('the cache tag comes off before a query or fragment, and only there', () => {
    process.env.DEPLOY_SECRET = 'forms-test';
    delete require.cache[require.resolve('../src/util/deployCacheTag')];
    const { SUFFIX, strip } = require('../src/util/deployCacheTag');
    delete process.env.DEPLOY_SECRET;
    assert.strictEqual(strip('/id/https://a.com/search' + SUFFIX + '?q=a'), '/id/https://a.com/search?q=a');
    assert.strictEqual(strip('/id/https://a.com/x?q=1' + SUFFIX), '/id/https://a.com/x?q=1');
    assert.strictEqual(strip('/id/https://a.com/x' + SUFFIX + '#top'), '/id/https://a.com/x#top');
    assert.strictEqual(strip('/id/https://a.com/x?y=' + SUFFIX + 'z'), '/id/https://a.com/x?y=' + SUFFIX + 'z');
});
