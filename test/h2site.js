// an HTTPS + HTTP/2 destination site with a configurable stream limit, for testing how the proxy
// shares upstream HTTP/2 connections. real sites like tiktok.com allow 100 concurrent streams
const fs = require('fs');
const os = require('os');
const path = require('path');
const http2 = require('http2');
const { execFileSync } = require('child_process');

function selfSignedCert() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rammerhead-test-cert-'));
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-subj',
            '/CN=127.0.0.1',
            '-addext',
            'subjectAltName=IP:127.0.0.1',
            '-keyout',
            path.join(dir, 'key.pem'),
            '-out',
            path.join(dir, 'cert.pem')
        ],
        { stdio: 'ignore' }
    );
    return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
}

/**
 * routes:
 *   /slow?ms=N  responds after N ms
 *   /fast       responds immediately
 *   /goaway     responds, then gracefully closes the connection (like a server restart or deploy)
 *   /reset      destroys the connection without responding
 *   /utf8-header responds with a content-disposition header containing non-latin characters
 *   /abort-body sends part of the body, then resets the stream with INTERNAL_ERROR
 *   /drop-body  sends part of the body, then destroys the connection
 */
function startH2Site({ port = 18443, maxConcurrentStreams = 5 } = {}) {
    const stats = { sessions: 0 };
    const server = http2.createSecureServer({ ...selfSignedCert(), settings: { maxConcurrentStreams } });
    server.on('session', () => stats.sessions++);
    server.on('stream', (stream, headers) => {
        const url = new URL(headers[':path'], 'https://x');
        const respond = (body) => {
            if (stream.destroyed) return;
            stream.respond({ ':status': 200, 'content-type': 'text/plain' });
            stream.end(body);
        };
        stream.on('error', () => {});
        if (url.pathname === '/slow') setTimeout(() => respond('slow'), Number(url.searchParams.get('ms')) || 1000);
        else if (url.pathname === '/fast') respond('fast');
        else if (url.pathname === '/goaway') {
            respond('goaway');
            stream.session.close();
        } else if (url.pathname === '/reset') stream.session.destroy();
        else if (url.pathname === '/utf8-header') {
            // like a download with a non-latin filename. http2 header values are utf-8
            stream.respond({
                ':status': 200,
                'content-type': 'application/octet-stream',
                // raw utf-8 bytes, like real servers send (node only accepts header strings up to \xff)
                'content-disposition': Buffer.from('attachment; filename="résumé ✓ 日本.pdf"').toString('latin1')
            });
            stream.end('file');
        } else if (url.pathname === '/abort-body' || url.pathname === '/drop-body') {
            // send headers and part of the body, then fail mid-response
            // ?type=js|html makes the proxy buffer the body to rewrite it, instead of streaming it through
            const type =
                { js: 'application/javascript', html: 'text/html' }[url.searchParams.get('type')] || 'text/plain';
            stream.respond({ ':status': 200, 'content-type': type });
            stream.write(type === 'text/html' ? '<html><body>' + 'x'.repeat(1000) : '// ' + 'x'.repeat(1000));
            setTimeout(() => {
                // the proxy may have already given up on this stream
                if (stream.destroyed || !stream.session) return;
                if (url.pathname === '/abort-body') stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
                else stream.session.destroy();
            }, 50);
        } else {
            stream.respond({ ':status': 404 });
            stream.end();
        }
    });
    return new Promise((resolve) =>
        server.listen(port, '127.0.0.1', () =>
            resolve({ origin: `https://127.0.0.1:${port}`, stats, close: () => server.close() })
        )
    );
}

module.exports = { startH2Site, selfSignedCert };
