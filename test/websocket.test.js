const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const https = require('https');
const { selfSignedCert } = require('./h2site');
const net = require('net');
const { WebSocketServer } = require('ws');
const { startProxy, newSession, PROXY } = require('./helpers');

const WS_PORT = 18092;
let proxy;
let server;
let wss;
before(async () => {
    // RH_TEST_WS_TLS=0 tests a plain ws:// destination instead. real sites (tiktok, spotify, twitch) are wss://
    server = process.env.RH_TEST_WS_TLS === '0' ? http.createServer() : https.createServer(selfSignedCert());
    wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => {
        socket.on('message', (data) => {
            if (String(data) === 'close please') socket.close();
            else socket.send(String(data));
        });
    });
    await new Promise((r) => server.listen(WS_PORT, '127.0.0.1', r));
    // the test site's certificate is self-signed
    proxy = await startProxy({ NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_NO_WARNINGS: '1' });
});
after(() => {
    proxy.kill();
    wss.close();
    server.close();
});

// hammerhead's websocket urls: /<session>!w!<page origin>/<destination as http://>
const wsScheme = process.env.RH_TEST_WS_TLS === '0' ? 'http' : 'https';
const wsPath = (id) => `/${id}!w!127.0.0.1%3A18090/${wsScheme}://127.0.0.1:${WS_PORT}/`;

// opens a websocket to the echo server through the proxy, resolves once it echoes
async function connect() {
    const id = await newSession();
    const ws = new WebSocket(`${PROXY.replace('http', 'ws')}${wsPath(id)}`);
    await new Promise((resolve, reject) => {
        ws.onopen = () => ws.send('ping');
        ws.onmessage = (e) => (String(e.data) === 'ping' ? resolve() : reject(new Error('bad echo ' + e.data)));
        ws.onerror = () => reject(new Error('websocket failed'));
    });
    return ws;
}

const waitFor = async (check, ms) => {
    const deadline = Date.now() + ms;
    while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    return check();
};

test("when the user's websocket goes away, the proxy closes its connection to the site", async () => {
    const before = wss.clients.size;
    const ws = await connect();
    assert.strictEqual(wss.clients.size, before + 1);
    ws.close();
    assert.ok(await waitFor(() => wss.clients.size === before, 2000), 'connection to the site was left open');
});

test('when the user disappears without a close handshake, the connection to the site is closed too', async () => {
    // like a killed tab or dropped network: upgrade, then drop the tcp connection with no close frame
    const id = await newSession();
    const before = wss.clients.size;
    const socket = net.connect(new URL(PROXY).port, 'localhost');
    socket.write(
        `GET ${wsPath(id)} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
            'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
    );
    await new Promise((r) => socket.once('data', r));
    assert.ok(await waitFor(() => wss.clients.size === before + 1, 2000), 'websocket never reached the site');
    socket.destroy();
    assert.ok(await waitFor(() => wss.clients.size === before, 2000), 'connection to the site was left open');
});

test('when the site closes the websocket, the user is told', async () => {
    const ws = await connect();
    const closed = new Promise((r) => (ws.onclose = r));
    ws.send('close please');
    const result = await Promise.race([
        closed.then(() => 'closed'),
        new Promise((r) => setTimeout(() => r('still open'), 2000))
    ]);
    assert.strictEqual(result, 'closed');
});

// what production showed: the proxy process kept a socket per finished websocket, forever
const fs = require('fs');
const proxySockets = () =>
    fs.readdirSync(`/proc/${proxy.pid}/fd`).filter((fd) => {
        try {
            return fs.readlinkSync(`/proc/${proxy.pid}/fd/${fd}`).startsWith('socket:');
        } catch (e) {
            return false;
        }
    }).length;

for (const [name, finish] of [
    ['user closes', (ws) => ws.close()],
    ['site closes', (ws) => ws.send('close please')]
]) {
    test(`finished websockets don't leave sockets open in the proxy (${name})`, async () => {
        await new Promise((r) => setTimeout(r, 500));
        const before = proxySockets();
        for (let i = 0; i < 30; i++) finish(await connect());
        const settled = await waitFor(() => proxySockets() - before <= 5, 3000);
        assert.ok(settled, `proxy still holds ${proxySockets() - before} extra sockets after 30 finished websockets`);
    });
}

// many real websocket servers (behind big gateways like tiktok's) don't close when the other side
// half-closes; they keep the connection until their own idle timeout. model that with a raw tls
// server that completes the upgrade and then never closes on its own
const tls = require('tls');
const crypto = require('crypto');
const STUBBORN_PORT = 18093;
const stubborn = { open: new Set() };
before(async () => {
    stubborn.server = tls.createServer({ ...selfSignedCert(), allowHalfOpen: true }, (socket) => {
        stubborn.open.add(socket);
        socket.on('close', () => stubborn.open.delete(socket));
        socket.on('error', () => {});
        socket.once('data', (head) => {
            const key = /sec-websocket-key: (.+)\r\n/i.exec(String(head))[1].trim();
            const accept = crypto
                .createHash('sha1')
                .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                .digest('base64');
            socket.write(
                `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
            );
        });
    });
    await new Promise((r) => stubborn.server.listen(STUBBORN_PORT, '127.0.0.1', r));
});
after(() => {
    for (const s of stubborn.open) s.destroy();
    stubborn.server.close();
});

// a session without leaving a keep-alive connection behind, which would throw off socket counts
const newSessionClosed = () =>
    new Promise((resolve, reject) =>
        http
            .get(`${PROXY}/newsession`, { agent: false, headers: { connection: 'close' } }, (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => resolve(body.trim()));
            })
            .on('error', reject)
    );

// sockets the proxy process still holds that are connected to a given remote port
function proxySocketsTo(port) {
    const inodes = new Set();
    for (const fd of fs.readdirSync(`/proc/${proxy.pid}/fd`)) {
        try {
            const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${proxy.pid}/fd/${fd}`));
            if (m) inodes.add(m[1]);
        } catch (e) {
            // fd closed while listing
        }
    }
    const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
    let count = 0;
    for (const table of ['tcp', 'tcp6']) {
        for (const line of fs.readFileSync(`/proc/${proxy.pid}/net/${table}`, 'utf8').split('\n').slice(1)) {
            const cols = line.trim().split(/\s+/);
            if (cols.length > 9 && cols[2].endsWith(':' + hexPort) && inodes.has(cols[9])) count++;
        }
    }
    return count;
}

test('when the user drops the connection, the proxy lets go of a site that ignores half-closes', async () => {
    const id = await newSessionClosed();
    const openBefore = stubborn.open.size;
    const path = `/${id}!w!127.0.0.1%3A18090/https://127.0.0.1:${STUBBORN_PORT}/`;
    // like a killed tab: upgrade, then drop the tcp connection with no close frame
    const socket = net.connect(new URL(PROXY).port, 'localhost');
    socket.write(
        `GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
            'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
    );
    await new Promise((r) => socket.once('data', r));
    assert.ok(await waitFor(() => stubborn.open.size === openBefore + 1, 2000), 'websocket never reached the site');
    socket.destroy();
    // the site may keep its own end open as long as it likes; what matters is that the proxy lets go
    assert.ok(
        await waitFor(() => proxySocketsTo(STUBBORN_PORT) === 0, 8000),
        `proxy still holds ${proxySocketsTo(STUBBORN_PORT)} sockets to the site`
    );
    assert.strictEqual(proxy.exitCode, null, 'proxy process died');
});
