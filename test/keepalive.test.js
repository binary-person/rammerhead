// a site closing an idle keep-alive connection just as the proxy reuses it (google does): the request must
// still get its response, sent again on a new connection when that's safe (GET/HEAD/OPTIONS)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { startProxy, newSession, PROXY } = require('./helpers');

const PORT = 18095;
let proxy;
let site;
let postsAnswered = 0;
before(async () => {
    // answers the first request on each connection, then drops the connection on the next one
    site = http.createServer((req, res) => {
        const socket = req.socket;
        socket.rhRequests = (socket.rhRequests || 0) + 1;
        if (socket.rhRequests > 1) return socket.destroy();
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
            res.writeHead(200, { 'content-type': 'text/plain', connection: 'keep-alive' });
            if (req.method === 'POST') postsAnswered++;
            res.end(req.method + ' ok ' + body);
        });
    });
    site.keepAliveTimeout = 60000;
    await new Promise((r) => site.listen(PORT, '127.0.0.1', r));
    proxy = await startProxy();
});
after(() => {
    proxy.kill();
    site.close();
});

test('a GET on a connection the site already dropped is sent again and answered', async () => {
    const id = await newSession();
    for (let i = 0; i < 3; i++) {
        const res = await fetch(`${PROXY}/${id}/http://127.0.0.1:${PORT}/get-${i}`).catch((e) => e);
        assert.ok(!(res instanceof Error), `request ${i} failed: ${res && res.message}`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(await res.text(), 'GET ok ');
    }
});

test('a POST on a dropped connection is not sent again (the site may have acted on it)', async () => {
    const id = await newSession();
    await fetch(`${PROXY}/${id}/http://127.0.0.1:${PORT}/warm`);
    postsAnswered = 0;
    await fetch(`${PROXY}/${id}/http://127.0.0.1:${PORT}/post`, { method: 'POST', body: 'x' }).catch(() => null);
    assert.strictEqual(postsAnswered, 0);
});
