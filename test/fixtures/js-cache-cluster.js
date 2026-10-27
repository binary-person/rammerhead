// a cluster sharing a RammerheadJSFileCache, like rammerhead-browser runs it. exits 0 if the worker could
// write an empty value without taking down the master, then write and read back a real one
const cluster = require('cluster');
const RammerheadJSFileCache = require('../../src/classes/RammerheadJSFileCache.js');
const cache = new RammerheadJSFileCache(process.argv[2], 1024 * 1024, 100, true);
if (cluster.isMaster) {
    const worker = cluster.fork();
    worker.on('exit', (code) => process.exit(code));
    setTimeout(() => process.exit(2), 10000);
} else {
    (async () => {
        cache.set('empty', '');
        cache.set('script', 'var a = 1;');
        let value;
        for (let i = 0; i < 50 && value === undefined; i++) {
            await new Promise((r) => setTimeout(r, 20));
            value = await cache.get('script');
        }
        process.exit(value === 'var a = 1;' && (await cache.get('empty')) === undefined ? 0 : 1);
    })();
}
