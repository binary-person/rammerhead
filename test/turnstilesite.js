// fake challenges.cloudflare.com for offline turnstile tests: cloudflare's real api.js (recorded, see
// research/cloudflare-challenge/recorded) and a fake widget that sends the messages the real widget sends
const fs = require('fs');
const path = require('path');
const https = require('https');
const { selfSignedCert } = require('./h2site');

const PORT = 18443;
const API_JS = path.join(__dirname, '../research/cloudflare-challenge/recorded/turnstile-api.js');
const WIDGET = path.join(__dirname, '../research/cloudflare-challenge/recorded/turnstile-widget.html');

const widgetPageTemplate = `<!DOCTYPE html>
<html><body><script>
// the widget id is in the path: /cdn-cgi/challenge-platform/h/g/turnstile/f/av0/rch/<id>/<sitekey>/...
var widgetId = location.pathname.split('/rch/')[1].split('/')[0];
var got = {};
window.addEventListener('message', function (e) {
    var d = e.data || {};
    var name = d.event || (d.action ? 'extraParams' : d.cs ? 'cs' : 'unknown');
    if (got[name]) return;
    got[name] = true;
    console.log('widget got ' + name + ' from ' + e.origin);
    if (name === 'extraParams' || name === 'cs') console.log('payload ' + name + ' ' + JSON.stringify(d));
    if (name === 'extraParams') console.log('done');
});
// the real widget runs in a vm, so try the ways it might call postMessage (see setPostStyle)
var style = '{{style}}';
function send(msg) {
    msg.source = 'cloudflare-challenge';
    msg.widgetId = widgetId;
    if (style === 'direct') parent.postMessage(msg, '*');
    if (style === 'window') window.parent.postMessage(msg, '*');
    if (style === 'computed') parent['post' + 'Message'](msg, '*');
    if (style === 'reflect') Reflect.apply(parent.postMessage, parent, [msg, '*']);
    if (style === 'stored') { var pm = parent.postMessage; pm.call(parent, msg, '*'); }
    if (style === 'top') top.postMessage(msg, '*');
    if (style === 'own') window.postMessage.call(parent, msg, '*');
    if (style === 'bind') parent.postMessage.bind(parent)(msg, '*');
    if (style === 'descriptor') Object.getOwnPropertyDescriptor(parent, 'postMessage').value.call(parent, msg, '*');
    if (style === 'fresh') {
        var f = document.createElement('iframe');
        document.body.appendChild(f);
        f.contentWindow.postMessage.call(parent, msg, '*');
    }
}
send({ event: 'init', mode: 'managed', nextRcV: 'x' });
send({ event: 'requestExtraParams' });
</script></body></html>`;

function startTurnstileSite() {
    let postStyle = 'direct';
    if (!fs.existsSync(API_JS))
        throw new Error('missing ' + API_JS + ' (recorded files live in the gitignored research/ folder)');
    const server = https.createServer(selfSignedCert(), (req, res) => {
        const url = new URL(req.url, 'https://x');
        if (url.pathname.startsWith('/turnstile/v0/')) {
            res.writeHead(200, {
                'content-type': 'application/javascript',
                'cross-origin-resource-policy': 'cross-origin'
            });
            return res.end(fs.readFileSync(API_JS));
        }
        if (url.pathname.includes('/turnstile/f/')) {
            // like the real widget, so it can load in a cross-origin isolated page
            res.writeHead(200, {
                'content-type': 'text/html',
                'cross-origin-embedder-policy': 'require-corp',
                'cross-origin-resource-policy': 'cross-origin'
            });
            if (postStyle === 'recorded') {
                // recorded with widget id 'abcde', and api.js ignores widgets it doesn't know
                const id = url.pathname.split('/rch/')[1].split('/')[0];
                return res.end(fs.readFileSync(WIDGET, 'utf8').replace(/(['"])abcde\1/g, `$1${id}$1`));
            }
            return res.end(widgetPageTemplate.replace('{{style}}', postStyle));
        }
        res.writeHead(404).end();
    });
    return new Promise((resolve) =>
        server.listen(PORT, '127.0.0.1', () =>
            resolve({
                close: () => server.close(),
                setPostStyle: (style) => (postStyle = style)
            })
        )
    );
}

module.exports = { startTurnstileSite, PORT };
