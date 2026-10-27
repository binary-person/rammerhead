const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startHarness } = require('./helpers');

// what pages (and anti-bot scripts) can see of the proxy. single port like production
let harness;
before(async () => (harness = await startHarness({ RH_TEST_SINGLE_PORT: '1' })));
after(() => harness.stop());

test('natives and dom results look like the browser', async () => {
    const { logs } = await harness.runPage('/frames/fidelity.html', {
        until: (logs) =>
            logs.includes('frame done') &&
            logs.filter((l) => /cross-origin timing/.test(l)).length === 2 &&
            logs.some((l) => /camera permission/.test(l))
    });
    assert.ok(logs.includes('frame done'), logs.join('\n'));
    assert.deepStrictEqual(
        logs.filter((l) => /: fail/.test(l)),
        []
    );
    // inline scripts report the line in the site's own html
    const html = fs.readFileSync(path.join(__dirname, 'fixtures/site/frames/fidelity.html'), 'utf8');
    const line = html.split('\n').findIndex((l) => l.includes('STACK_LINE_MARKER')) + 1;
    assert.ok(logs.includes('inline script stack line ' + line), logs.filter((l) => /stack line/.test(l)).join('\n'));
    assert.ok(
        logs.includes('frame inline script stack line ' + line),
        logs.filter((l) => /stack line/.test(l)).join('\n')
    );
    // pages report their own size, not the rewritten one
    const size = fs.statSync(path.join(__dirname, 'fixtures/site/frames/fidelity.html')).size;
    const sizes = logs.filter((l) => /navigation size/.test(l));
    assert.deepStrictEqual(sizes.sort(), ['frame navigation size ' + size, 'navigation size ' + size]);
    // call positions match plain v8 on the same line
    const callLine = html.split('\n').find((l) => l.includes('CALL_COLUMNS_MARKER'));
    const expected = require('vm').runInNewContext(
        "var o = { m: function () { return new Error('x').stack.split('\\n')[2].match(/:(\\d+)\\)?$/)[1]; } }, k = 'm';\n" +
            callLine +
            '\ncols.join(",")'
    );
    assert.ok(
        logs.includes('call columns ' + expected),
        logs.filter((l) => /call columns/.test(l)).join('\n') + ' expected ' + expected
    );
});

test('blob urls with the site origin load everywhere a page uses them', async () => {
    const { logs } = await harness.runPage('/frames/blob-sinks.html', {
        until: (logs) => logs.filter((l) => /: (ok|fail)/.test(l)).length >= 28
    });
    const results = logs.filter((l) => /: (ok|fail)/.test(l));
    assert.strictEqual(results.length, 28, logs.join('\n'));
    assert.deepStrictEqual(
        results.filter((l) => /: fail/.test(l)),
        []
    );
    // css images report nothing to the page when they fail, only this
    assert.deepStrictEqual(
        logs.filter((l) => /Not allowed to load local resource/.test(l)),
        []
    );
});
