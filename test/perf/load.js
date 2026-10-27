// simulates many users browsing heavy sites through a proxy started with the V8 profiler, then
// reports where its CPU went. usage:
//   node test/perf/load.js [--clients 8] [--seconds 120] [--sites tiktok,youtube,...]
// RH_TEST_NODE=/path/to/node profiles the proxy on another node version
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { PROXY } = require('../helpers');

const SITES = {
    tiktok: 'https://www.tiktok.com/explore',
    youtube: 'https://www.youtube.com/',
    discord: 'https://discord.com/login',
    spotify: 'https://open.spotify.com/',
    twitch: 'https://www.twitch.tv/'
};

const arg = (name, fallback) => {
    const i = process.argv.indexOf('--' + name);
    return i === -1 ? fallback : process.argv[i + 1];
};
const clients = Number(arg('clients', 8));
const seconds = Number(arg('seconds', 120));
const sites = arg('sites', Object.keys(SITES).join(',')).split(',');

async function main() {
    const profDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rammerhead-cpuprof-'));
    const node = process.env.RH_TEST_NODE || process.execPath;
    if (await fetch(PROXY + '/mainport').then(() => true, () => false)) {
        throw new Error(`something is already listening on ${PROXY}, stop it first`);
    }
    const proxy = spawn(node, ['--cpu-prof', '--cpu-prof-dir', profDir, path.join(__dirname, '../../src/server.js')], {
        env: { ...process.env, RH_CONFIG: path.join(__dirname, 'config.js'), DEVELOPMENT: '' },
        stdio: ['ignore', 'inherit', 'inherit']
    });
    // don't leave the proxy running if this script is killed or crashes
    const killProxy = () => proxy.exitCode === null && proxy.kill('SIGKILL');
    process.on('exit', killProxy);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
    for (let i = 0; i < 100; i++) {
        if (await fetch(PROXY + '/mainport').then(() => true, () => false)) break;
        await new Promise((r) => setTimeout(r, 100));
    }

    const ticks = Number(require('child_process').execSync('getconf CLK_TCK'));
    const cpu = () => {
        const f = fs.readFileSync(`/proc/${proxy.pid}/stat`, 'utf8').split(') ')[1].split(' ');
        return ((Number(f[11]) + Number(f[12])) * 1000) / ticks;
    };

    // cpu per thread name (main js thread is "node"; libuv workers run zlib/fs/dns; V8 workers run gc/compilation)
    const threadCpu = () => {
        const out = {};
        for (const tid of fs.readdirSync(`/proc/${proxy.pid}/task`)) {
            try {
                const raw = fs.readFileSync(`/proc/${proxy.pid}/task/${tid}/stat`, 'utf8');
                const name = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')')).replace(/[0-9]+$/, '');
                const f = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
                out[name] = (out[name] || 0) + ((Number(f[11]) + Number(f[12])) * 1000) / ticks;
            } catch (e) {
                // thread exited
            }
        }
        return out;
    };

    const browser = await chromium.launch();
    const stats = { pageLoads: 0, requests: 0, failedRequests: 0, bytes: 0, perSite: {} };
    const deadline = Date.now() + seconds * 1000;
    const cpuStart = cpu();
    const threadStart = threadCpu();
    const wallStart = Date.now();

    async function client(n) {
        let i = n;
        while (Date.now() < deadline) {
            const site = sites[i++ % sites.length];
            const sessionId = (await (await fetch(PROXY + '/newsession')).text()).trim();
            const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
            const page = await context.newPage();
            page.on('requestfinished', () => stats.requests++);
            page.on('requestfailed', () => stats.failedRequests++);
            const s = (stats.perSite[site] ??= { loads: 0, errors: 0 });
            try {
                await page.goto(`${PROXY}/${sessionId}/${SITES[site]}`, { waitUntil: 'load', timeout: 45000 });
                // scroll so feeds keep loading more content, like a real user
                for (let k = 0; k < 8 && Date.now() < deadline; k++) {
                    await page.mouse.wheel(0, 2000);
                    await page.waitForTimeout(1500);
                }
                s.loads++;
                stats.pageLoads++;
            } catch (e) {
                s.errors++;
            } finally {
                await context.close();
            }
        }
    }
    await Promise.all(Array.from({ length: clients }, (_, n) => client(n)));
    const cpuUsed = cpu() - cpuStart;
    const threadEnd = threadCpu();
    const cpuByThread = {};
    for (const k in threadEnd) cpuByThread[k] = Math.round(threadEnd[k] - (threadStart[k] || 0));
    const wall = Date.now() - wallStart;
    await browser.close();

    // SIGINT lets the proxy exit normally so V8 writes the profile
    proxy.kill('SIGINT');
    await new Promise((r) => proxy.once('exit', r));
    const profile = path.join(profDir, fs.readdirSync(profDir).find((f) => f.endsWith('.cpuprofile')));

    console.log(JSON.stringify({ node: require('child_process').execFileSync(node, ['-v']).toString().trim(), clients, seconds, wallMs: wall, proxyCpuMs: Math.round(cpuUsed), cpuCores: +(cpuUsed / wall).toFixed(2), cpuMsPerRequest: +(cpuUsed / stats.requests).toFixed(2), cpuByThread, ...stats, profile }, null, 1));
}

main();
