const { test, before, after } = require('node:test');
const assert = require('node:assert');
const RammerheadProxy = require('../src/classes/RammerheadProxy');
const RammerheadLogging = require('../src/classes/RammerheadLogging');

const PORT = 18190;
const logs = [];
let proxy;
before(() => {
    proxy = new RammerheadProxy({
        logger: new RammerheadLogging({ logLevel: 'warn', logger: (line) => logs.push(line) }),
        bindingAddress: '127.0.0.1',
        port: PORT,
        crossDomainPort: null,
        getServerInfo: () => ({ hostname: 'localhost', port: PORT, protocol: 'http:' }),
        stuckRequestTimeout: 500
    });
    // like the old dns2 lookup: a pre-request step whose promise never settles
    proxy.addToOnRequestPipeline(() => new Promise(() => {}));
});
after(() => proxy.close());

for (const method of ['GET', 'POST']) {
    test(`a ${method} stuck in the pipeline gets a 504 instead of hanging forever`, async () => {
        const start = Date.now();
        const res = await fetch(`http://127.0.0.1:${PORT}/abcdef/https://example.com/x`, {
            method,
            body: method === 'POST' ? 'x'.repeat(100000) : undefined,
            signal: AbortSignal.timeout(5000)
        });
        assert.strictEqual(res.status, 504);
        assert.ok(Date.now() - start < 2000, `took ${Date.now() - start}ms`);
        assert.ok(
            logs.some(
                (l) =>
                    l.includes(`stuck request`) &&
                    l.includes('onRequestPipeline[0]') &&
                    l.includes(`${method} https://example.com/x`)
            ),
            logs.join('\n')
        );
        assert.ok(!logs.some((l) => l.includes('abcdef')), 'session id leaked into the log');
    });
}
