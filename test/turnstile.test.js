const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { startHarness } = require('./helpers');
const fs = require('fs');
const { startTurnstileSite } = require('./turnstilesite');

// needs cloudflare's scripts, recorded into the gitignored research/ folder
const RECORDED = path.join(__dirname, '../research/cloudflare-challenge/recorded');
if (
    !['turnstile-api.js', 'turnstile-widget.html', 'challenge.html', 'orchestrate.js'].every((f) =>
        fs.existsSync(path.join(RECORDED, f))
    )
) {
    test('turnstile (recorded cloudflare files not present)', { skip: true }, () => {});
    return;
}

// cloudflare turnstile's widget plumbing, offline. single port like production
let harness, turnstileSite;
before(async () => {
    turnstileSite = await startTurnstileSite();
    harness = await startHarness({
        RH_TEST_SINGLE_PORT: '1',
        NODE_OPTIONS: '--require ' + path.join(__dirname, 'fixtures/fake-cloudflare.js')
    });
});
after(() => {
    harness.stop();
    turnstileSite.close();
});

test('a widget iframe in a closed shadow root can be found and answered', async () => {
    const { logs, errors, failures } = await harness.runPage('/frames/shadow-widget.html', {
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
    assert.ok(logs.includes('done'), logs.join('\n'));
});

test("turnstile's api.js answers the widget's init and sends it the extra params", async () => {
    const { logs } = await harness.runPage('/frames/turnstile.html', { until: (logs) => logs.includes('done') });
    assert.ok(logs.includes('widget got init from http://127.0.0.1:18090'), logs.join('\n'));
    assert.ok(logs.includes('widget got extraParams from http://127.0.0.1:18090'), logs.join('\n'));
});

test('without a solver, challenge pages get the real turnstile.render', async () => {
    const { logs, failures } = await harness.runPage('/frames/challenge-page.html', {
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(failures, []);
    assert.ok(logs.includes('render returned: ok'), logs.join('\n'));
    assert.ok(logs.includes('widget got extraParams from http://127.0.0.1:18090'), logs.join('\n'));
});

for (const style of [
    'direct',
    'window',
    'computed',
    'reflect',
    'stored',
    'top',
    'own',
    'bind',
    'descriptor',
    'fresh'
]) {
    test(`turnstile accepts widget messages sent with postMessage style: ${style}`, async () => {
        turnstileSite.setPostStyle(style);
        const { logs } = await harness.runPage('/frames/turnstile.html', { until: (logs) => logs.includes('done') });
        turnstileSite.setPostStyle('direct');
        assert.ok(logs.includes('widget got init from http://127.0.0.1:18090'), logs.join('\n'));
    });
}

test("turnstile accepts the real widget's messages", async () => {
    turnstileSite.setPostStyle('recorded');
    const { logs } = await harness.runPage('/frames/turnstile.html', {
        until: (logs) => logs.some((l) => l.startsWith('parent saw init source')),
        timeout: 10000
    });
    turnstileSite.setPostStyle('direct');
    assert.ok(logs.includes('parent saw init source: child'), logs.join('\n'));
    assert.ok(!logs.some((l) => /Ignored message/.test(l)), logs.join('\n'));
});

test('turnstile works on a cross-origin isolated page (cloudflare challenge pages are)', async () => {
    turnstileSite.setPostStyle('recorded');
    const { logs } = await harness.runPage('/frames/turnstile.html?isolated', {
        until: (logs) => logs.some((l) => l.startsWith('parent saw init source')),
        timeout: 10000
    });
    turnstileSite.setPostStyle('direct');
    assert.ok(logs.includes('crossOriginIsolated: true'), logs.join('\n'));
    assert.ok(logs.includes('parent saw init source: child'), logs.join('\n'));
    assert.ok(!logs.some((l) => /Ignored message/.test(l)), logs.join('\n'));
});
