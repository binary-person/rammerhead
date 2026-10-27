const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startHarness } = require('./helpers');

let harness;
before(async () => (harness = await startHarness()));
after(() => harness.stop());

// these run framed: the proxied page sits in an iframe like it does in rammerhead-browser,
// yet should still see itself as the top window
const doneTwice = (logs) => logs.filter((l) => l === 'done').length >= 2;

test('top, parent, and frameElement are hidden from a framed page', async () => {
    const { failures, errors } = await harness.runPage('/frames/sandbox.html', { framed: true, until: doneTwice });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
});

test('nested frames reach the right top and parent', async () => {
    const { logs, failures, errors } = await harness.runPage('/frames/outer.html', {
        framed: true,
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
    assert.ok(logs.includes('done'), logs.join('\n'));
});

test('message ports can be handed to an iframe with either postMessage form', async () => {
    const { logs, errors } = await harness.runPage('/frames/message-port.html', {
        until: (logs) => logs.includes('positional form: ok') && logs.includes('options form: ok')
    });
    assert.deepStrictEqual(errors, []);
    assert.ok(logs.includes('positional form: ok'), logs.join('\n'));
    assert.ok(logs.includes('options form: ok'), logs.join('\n'));
});

test('a new iframe that ran code before hammerhead set it up still works', async () => {
    const { logs, errors, failures } = await harness.runPage('/frames/early-script.html', {
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
    assert.ok(logs.includes('result: 2,4'), logs.join('\n'));
});

test('scripts created via textContent, innerText, or text are rewritten', async () => {
    const { logs, errors } = await harness.runPage('/frames/script-text.html', {
        framed: true,
        until: (logs) => ['textContent', 'innerText', 'text'].every((p) => logs.some((l) => l.startsWith(p + ':')))
    });
    assert.deepStrictEqual(errors, []);
    for (const prop of ['textContent', 'innerText', 'text']) assert.ok(logs.includes(prop + ': ok'), logs.join('\n'));
});

test('messages sent with the native postMessage arrive with the right origin', async () => {
    const done = (logs) => ['descriptor', 'fresh iframe'].every((via) => logs.some((l) => l.startsWith(via + ':')));
    const { logs, errors } = await harness.runPage('/frames/native-postmessage.html', { until: done });
    assert.deepStrictEqual(errors, []);
    for (const via of ['descriptor', 'fresh iframe'])
        assert.ok(logs.includes(via + ': origin ok, source ok'), logs.join('\n'));
});

test("rewritten functions stringify to the site's original source", async () => {
    const done = (logs) => ['inline', 'getter', 'external'].every((n) => logs.some((l) => l.startsWith(n + ':')));
    const { logs, errors } = await harness.runPage('/frames/function-source.html', { until: done });
    assert.deepStrictEqual(errors, []);
    for (const n of ['inline', 'getter', 'external']) assert.ok(logs.includes(n + ': ok'), logs.join('\n'));
});

test("a sandboxed iframe without allow-scripts doesn't run scripts", async () => {
    const names = ['scripts blocked', 'parent reaches in', 'sandbox tokens'];
    const done = (logs) => names.every((n) => logs.some((l) => l.startsWith(n + ':')));
    const { logs } = await harness.runPage('/frames/sandbox-noscripts.html', { until: done });
    for (const n of names) assert.ok(logs.includes(n + ': ok'), logs.join('\n'));
});

test('a script-less frame the page uses from outside works like in the browser (youtube)', async () => {
    const { logs, errors } = await harness.runPage('/frames/sandbox-noscripts-callbacks.html', {
        until: (logs) => logs.some((l) => l.startsWith('html writes:'))
    });
    assert.deepStrictEqual(errors, []);
    assert.ok(logs.includes('callbacks: doc click,el click,focus,message "x",mutation,onclick'), logs.join('\n'));
    assert.ok(logs.includes('html writes: 12'), logs.join('\n'));
    // only the page's own timer, like in the browser (the proxy's timers and listeners in the frame were blocked and logged too)
    assert.strictEqual(logs.filter((l) => /Blocked script execution/.test(l)).length, 1, logs.join('\n'));
});

test('html written into a script-less frame', async () => {
    const { logs, errors } = await harness.runPage('/frames/sandbox-noscripts-writes.html', {
        until: (logs) => logs.some((l) => l.startsWith('writes done:'))
    });
    assert.deepStrictEqual(errors, []);
    assert.ok(logs.includes('writes done: ok'), logs.join('\n'));
    assert.deepStrictEqual(
        logs.filter((l) => /Blocked script execution/.test(l)),
        []
    );
});

test('the navigation api shows the site its own urls (instagram)', async () => {
    const { logs, failures, errors } = await harness.runPage('/frames/navigation-api.html', {
        framed: true,
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
    assert.deepStrictEqual(logs.filter((l) => / ok$/.test(l)).length, 4, logs.join('\n'));
});

test('a script added from an about:blank frame loads (cloudflare bot check)', async () => {
    const { logs, failures, errors } = await harness.runPage('/frames/blank-frame-script.html', {
        framed: true,
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
    assert.ok(logs.includes('blank frame script: ok'), logs.join('\n'));
});

test('links keep the site\'s url after rel/as change how they load (google preload links)', async () => {
    const { logs, failures, errors } = await harness.runPage('/frames/link-preload.html', {
        framed: true,
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, [], logs.join('\n'));
    assert.strictEqual(logs.filter((l) => /: ok$/.test(l)).length, 5, logs.join('\n'));
});

test('selectors on url attributes find elements by the site\'s urls (onetrust cookie banners)', async () => {
    const { logs, failures, errors } = await harness.runPage('/frames/url-selectors.html', {
        framed: true,
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, [], logs.join('\n'));
    assert.strictEqual(logs.filter((l) => /: ok$/.test(l)).length, 8, logs.join('\n'));
});
