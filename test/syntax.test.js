const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startHarness } = require('./helpers');

let harness;
before(async () => (harness = await startHarness()));
after(() => harness.stop());

test('import.meta in inline, generated, and imported modules', async () => {
    const { logs, failures, errors } = await harness.runPage('/syntax/importmeta.html', {
        until: (logs) => logs.includes('done') && logs.includes('script content done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
    assert.ok(logs.includes('done'), logs.join('\n'));
});

test('private class fields', async () => {
    const { logs, failures, errors } = await harness.runPage('/syntax/privateprop.html', {
        until: (logs) => logs.includes('Done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
    assert.ok(logs.includes('Done'), logs.join('\n'));
});

test('hammerhead does not call DOM methods the page overrode', async () => {
    const { logs, errors } = await harness.runPage('/syntax/page-overrides-dom.html', { timeout: 1500 });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(
        logs.filter((l) => l.startsWith('whoops')),
        []
    );
});

test('optional chains do not evaluate computed keys after short-circuiting', async () => {
    const { logs, failures, errors } = await harness.runPage('/syntax/optional-chain.html', {
        until: (logs) => logs.includes('done')
    });
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(failures, []);
    assert.ok(logs.includes('done'), logs.join('\n'));
});
