// fake cloudflare-protected site and fake 2captcha, for testing the cloudflare solver without paying.
//
// modeled on what real cloudflare did through the proxy: a challenge is tied to the user-agent the
// challenge page was loaded with, and 2captcha solves with its own user-agent, so its token only
// passes a challenge page that was loaded with 2captcha's user-agent. cf_clearance is tied to it too
const https = require('https');
const http = require('http');
const { selfSignedCert } = require('./h2site');

const SITE_PORT = 18095;
const CAPTCHA_PORT = 18096;
const SOLVER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FakeSolver/1.0 Chrome/150.0.0.0 Safari/537.36';
// the solver keys clearances by root domain, so each test uses its own
const site = (domain) => `https://www.${domain}:${SITE_PORT}`;

function startCFSite() {
    const stats = { challenges: 0, passes: 0, tasks: 0, nativeRenders: 0, solverUaRequests: 0, submits: { ok: 0, rejected: 0 } };
    const challenges = new Map(); // challenge id -> user-agent the challenge page was loaded with
    const tokens = new Map(); // token -> { cData, ua }
    const clearances = new Map(); // cf_clearance value -> user-agent it was issued for
    let n = 0;

    const challengePage = (id) => `<!DOCTYPE html>
<html><head><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=${id}"></script></head>
<body><h1>Performing security verification</h1><div id="widget"></div></body></html>`;

    // cloudflare's own widget: on rhcf-free* domains it passes by itself (the user's own browser got through),
    // everywhere else it wants the "verify you are human" checkbox
    const orchestrate = (id, passes) => `
var removed = {};
window.turnstile = {
    render: function (el, opts) {
        var widgetId = 'w-${id}';
        fetch('/cdn-cgi/native-render', { method: 'POST' });
        setTimeout(function () {
            if (removed[widgetId]) return;
            if (${passes}) opts.callback('native-${id}');
            else if (opts['before-interactive-callback']) opts['before-interactive-callback']();
        }, 100);
        return widgetId;
    },
    remove: function (widgetId) {
        removed[widgetId] = true;
    }
};
document.addEventListener('DOMContentLoaded', function () {
    // give rammerhead.js a moment to hook render, like the real widget's async load
    setTimeout(function () {
        window.turnstile.render('#widget', {
            sitekey: '0xFAKE', cData: '${id}', chlPageData: 'page-${id}', action: 'managed',
            callback: function (token) {
                fetch('/cdn-cgi/submit', { method: 'POST', body: JSON.stringify({ id: '${id}', token: token }) })
                    .then(function () { location.reload(); });
            }
        });
    }, 50);
});`;

    const siteServer = https.createServer(selfSignedCert(), async (req, res) => {
        const url = new URL(req.url, 'https://x');
        const ua = req.headers['user-agent'] || '';
        if (ua === SOLVER_UA) stats.solverUaRequests++;
        if (url.pathname.startsWith('/cdn-cgi/challenge-platform/')) {
            const id = url.searchParams.get('ray');
            const passes = /^(www\.)?rhcf-free/.test(req.headers.host || '');
            // the widget's own token is good for the browser that loaded the challenge
            if (passes) tokens.set('native-' + id, { cData: id, ua: challenges.get(id) });
            res.writeHead(200, { 'content-type': 'application/javascript' });
            res.end(orchestrate(id, passes));
            return;
        }
        if (url.pathname === '/cdn-cgi/native-render') {
            stats.nativeRenders++;
            res.writeHead(200);
            res.end();
            return;
        }
        if (url.pathname === '/cdn-cgi/submit') {
            let body = '';
            for await (const chunk of req) body += chunk;
            const { id, token } = JSON.parse(body);
            const solved = tokens.get(token);
            // rhcf-reject*: cloudflare turns down every token (what a site with stricter settings looks like)
            const rejectAll = /^(www\.)?rhcf-reject/.test(req.headers.host || '');
            if (!rejectAll && solved && solved.cData === id && challenges.get(id) === solved.ua) {
                stats.submits.ok++;
                const value = 'clearance-' + ++n;
                clearances.set(value, solved.ua);
                const domain = (req.headers.host || '').replace(/^www\./, '').replace(/:\d+$/, '');
                res.writeHead(200, {
                    'set-cookie': `cf_clearance=${value}; Domain=${domain}; Path=/; Secure; HttpOnly; SameSite=None`
                });
            } else {
                stats.submits.rejected++;
                res.writeHead(403);
            }
            res.end();
            return;
        }
        const clearance = (/(?:^|; )cf_clearance=([^;]+)/.exec(req.headers.cookie || '') || [])[1];
        if (clearance && clearances.get(clearance) === ua) {
            stats.passes++;
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<!DOCTYPE html><html><body><h1>passed</h1></body></html>');
            return;
        }
        stats.challenges++;
        const id = 'chl' + ++n;
        challenges.set(id, ua);
        res.writeHead(403, { 'content-type': 'text/html', 'cf-mitigated': 'challenge' });
        res.end(challengePage(id));
    });

    const captchaServer = http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const json = body ? JSON.parse(body) : {};
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/getBalance') return res.end(JSON.stringify({ errorId: 0, balance: 1 }));
        if (req.url === '/createTask') {
            stats.tasks++;
            const taskId = ++n;
            tokens.set('token-' + taskId, { cData: json.task.data, ua: SOLVER_UA });
            return res.end(JSON.stringify({ errorId: 0, taskId }));
        }
        if (req.url === '/getTaskResult') {
            return res.end(
                JSON.stringify({
                    errorId: 0,
                    status: 'ready',
                    solution: { token: 'token-' + json.taskId, userAgent: SOLVER_UA }
                })
            );
        }
        res.end(JSON.stringify({ errorId: 1, errorCode: 'ERROR_UNKNOWN' }));
    });

    return Promise.all([
        new Promise((r) => siteServer.listen(SITE_PORT, '127.0.0.1', r)),
        new Promise((r) => captchaServer.listen(CAPTCHA_PORT, '127.0.0.1', r))
    ]).then(() => ({
        stats,
        close() {
            siteServer.close();
            captchaServer.close();
        }
    }));
}

module.exports = { startCFSite, site, SOLVER_UA, CAPTCHA_PORT };
