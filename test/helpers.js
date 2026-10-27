const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const mime = require('mime');
const { chromium } = require('playwright');
const config = require('./config');

const PROXY = `http://localhost:${config.port}`;
const SITE_PORT = 18090;
// a different host than the proxy, so the "destination site" is cross-origin like a real one
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const SITE_DIR = path.join(__dirname, 'fixtures/site');

const RECORDED_DIR = path.join(__dirname, '../research/cloudflare-challenge/recorded');

function startSite() {
    const server = http.createServer((req, res) => {
        // a recorded cloudflare challenge page and its script (see turnstile.test.js)
        const pathname = new URL(req.url, SITE).pathname;
        if (
            pathname === '/recorded/challenge.html' ||
            pathname === '/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1'
        ) {
            const isPage = pathname.endsWith('.html');
            const file = path.join(RECORDED_DIR, isPage ? 'challenge.html' : 'orchestrate.js');
            if (!fs.existsSync(file)) return res.writeHead(404).end();
            res.writeHead(isPage ? 403 : 200, {
                'content-type': isPage ? 'text/html' : 'application/javascript',
                ...(isPage ? { 'cf-mitigated': 'challenge' } : {})
            });
            return res.end(fs.readFileSync(file));
        }
        // a module too big for a position map (like discord's 12mb bundle), with imports
        if (pathname === '/cache/big-module.js') {
            const filler = 'var rhFiller = [' + '"0123456789abcdef",'.repeat(130000) + '];\n';
            res.writeHead(200, { 'content-type': 'application/javascript' });
            return res.end('import { dep } from "./dep.js";\n' + filler + 'export const loaded = import("./plain.js").then(() => dep);\n');
        }
        let file = path.join(SITE_DIR, decodeURIComponent(new URL(req.url, SITE).pathname));
        if (file.endsWith('/')) file += 'index.html';
        if (!file.startsWith(SITE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404).end();
            return;
        }
        // ?redirect=<path> answers 302 there, like google's ?gws_rd=ssl hop
        const redirect = new URL(req.url, SITE).searchParams.get('redirect');
        if (redirect) return res.writeHead(302, { location: redirect }).end();
        // ?encoding=gzip|br serves the file compressed, like most real sites do
        let encoding = new URL(req.url, SITE).searchParams.get('encoding');
        // ?encoding=negotiate picks zstd when the client offers it, like cloudflare does
        if (encoding === 'negotiate') encoding = /zstd/.test(req.headers['accept-encoding'] || '') ? 'zstd' : 'br';
        let body = fs.readFileSync(file);
        if (encoding === 'gzip') body = zlib.gzipSync(body);
        if (encoding === 'br') body = zlib.brotliCompressSync(body);
        if (encoding === 'zstd') body = zlib.zstdCompressSync(body);
        // ?isolated serves the page cross-origin isolated, like cloudflare's challenge pages
        const isolated = new URL(req.url, SITE).searchParams.has('isolated');
        // file.headers.json adds response headers (content-security-policy, ...)
        const extra = fs.existsSync(file + '.headers.json') ? JSON.parse(fs.readFileSync(file + '.headers.json')) : {};
        res.writeHead(200, {
            'content-type': mime.getType(file),
            ...extra,
            ...(isolated
                ? { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }
                : {}),
            ...(encoding ? { 'content-encoding': encoding } : {})
        }).end(body);
    });
    return new Promise((resolve) => server.listen(SITE_PORT, '127.0.0.1', () => resolve(server)));
}

async function startProxy(env = {}) {
    // otherwise the readiness check below would happily test a leftover server running old code
    const alreadyRunning = await fetch(PROXY + '/mainport').then(
        () => true,
        () => false
    );
    if (alreadyRunning) throw new Error(`something is already listening on ${PROXY}, stop it first`);

    // RH_TEST_NODE=/path/to/node runs the proxy on another node version (the tests themselves need node 20+)
    const child = spawn(process.env.RH_TEST_NODE || process.execPath, [path.join(__dirname, '../src/server.js')], {
        env: { ...process.env, RH_CONFIG: path.join(__dirname, 'config.js'), DEVELOPMENT: '', ...env },
        stdio: ['ignore', 'inherit', 'inherit']
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('proxy exited with code ' + child.exitCode);
        try {
            if ((await fetch(PROXY + '/mainport')).ok) return child;
        } catch (e) {
            // not listening yet
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    child.kill();
    throw new Error('proxy did not start within 15s');
}

/**
 * starts the fixture site, the proxy, and a headless browser.
 * runPage(sitePath, options) loads a fixture page through the proxy and collects
 * console output and uncaught errors from every frame
 */
async function startHarness(env) {
    const [site, proxy, browser] = await Promise.all([startSite(), startProxy(env), chromium.launch()]);

    // direct: load the site without the proxy, to compare against
    async function runPage(sitePath, { framed = false, direct = false, until = () => false, timeout = 8000 } = {}) {
        const sessionId = (await (await fetch(PROXY + '/newsession')).text()).trim();
        const proxied = direct ? SITE + sitePath : `${PROXY}/${sessionId}/${SITE}${sitePath}`;
        const page = await browser.newPage();
        const logs = [];
        const errors = [];
        page.on('console', (msg) => logs.push(msg.text()));
        page.on('pageerror', (err) => errors.push(process.env.RH_TEST_STACKS ? err.stack : err.message));
        try {
            await page.goto(framed ? `${PROXY}/frame.html#${encodeURIComponent(proxied)}` : proxied);
            const deadline = Date.now() + timeout;
            while (!until(logs) && Date.now() < deadline) await page.waitForTimeout(100);
        } finally {
            await page.close();
        }
        return { logs, errors, failures: logs.filter((l) => /fail/i.test(l)) };
    }

    async function stop() {
        await browser.close();
        proxy.kill();
        site.close();
    }

    return { runPage, stop };
}

async function newSession() {
    return (await (await fetch(PROXY + '/newsession')).text()).trim();
}

module.exports = { startHarness, startProxy, startSite, newSession, PROXY, SITE };
