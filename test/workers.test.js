const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startHarness } = require('./helpers');

let harness;
before(async () => (harness = await startHarness()));
after(() => harness.stop());

// see fixtures/site/workers/index.html for how each probe creates its worker
const probes = {
    'blob-untyped': {},
    'blob-js': {},
    'blob-module': {},
    'url-string': {},
    'url-object': {},
    'url-module': {}
};

for (const [name, options] of Object.entries(probes)) {
    test(`worker: ${name}`, options, async () => {
        const { logs, errors } = await harness.runPage(`/workers/?only=${name}`, {
            until: (logs) => logs.some((l) => l.startsWith(name + ':'))
        });
        assert.deepStrictEqual(errors, []);
        assert.ok(logs.includes(`${name}: ok`), logs.join('\n'));
    });
}
