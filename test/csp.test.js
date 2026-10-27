const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startHarness } = require('./helpers');

// content security policies and trusted types are enforced like they are without the proxy
let harness;
before(async () => (harness = await startHarness({ RH_TEST_SINGLE_PORT: '1' })));
after(() => harness.stop());

async function compare(path, prefix, ignore = () => false, normalize = (l) => l) {
    const done = prefix + ' done';
    const results = {};
    for (const direct of [true, false]) {
        const { logs, errors } = await harness.runPage(path, { direct, until: (l) => l.includes(done), timeout: 15000 });
        assert.ok(logs.includes(done), logs.join('\n'));
        assert.deepStrictEqual(errors, [], (direct ? 'direct: ' : 'proxied: ') + errors.join('\n'));
        results[direct ? 'direct' : 'proxied'] = logs
            .filter((l) => l.startsWith(prefix + ' ') && !ignore(l))
            .map(normalize)
            .sort();
    }
    assert.deepStrictEqual(results.proxied, results.direct);
}

test('csp is enforced like without the proxy', () =>
    // every proxied url is on the proxy's origin, so host sources can't tell sites apart (cross-origin loads pass)
    compare('/csp/strict.html', 'csp', (l) => /cross-origin/.test(l) || /^csp violations:/.test(l)));

test('csp violations', async () => {
    const { logs } = await harness.runPage('/csp/strict.html', { until: (l) => l.includes('csp done'), timeout: 15000 });
    const line = logs.find((l) => l.startsWith('csp violations: '));
    const violations = line.slice('csp violations: '.length).split(' | ');
    assert.deepStrictEqual(violations, [
        'script-src-attr,script-src-attr,inline,enforce',
        'script-src-elem,script-src-elem,data,enforce',
        'script-src-elem,script-src-elem,inline,enforce'
    ]);
});

// a blocked script's violation sample is its first 40 characters, which for rewritten scripts is hammerhead's header;
// rammerhead.js maps it back to the most recently rewritten script, which can be the wrong one when several are close
const scriptSample = (l) => l.replace(/(HTMLScriptElement text\|)[^|]*/g, '$1<sample>');
test('trusted types are enforced like without the proxy', () =>
    compare('/csp/trusted-types.html', 'tt', () => false, scriptSample));

test('inline scripts allowed by hash still run', () => compare('/csp/hashes.html', 'hash'));

test("a page's default trusted types policy only sees the page's values", () =>
    compare('/csp/default-policy.html', 'default'));

test('scripts a page adds that its policy allows by hash still run', () => compare('/csp/dynamic-hash.html', 'dyn'));
