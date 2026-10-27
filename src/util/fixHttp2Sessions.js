// fix one user's requests blocking everyone's on the same site (one http2 connection per site per worker)
// fix requests hanging forever when a site drops the http2 connection

const http2 = require('http2');
const LRUCache = require('lru-cache');
const RequestOptions = require('testcafe-hammerhead/lib/request-pipeline/request-options');
const DestinationRequest = require('testcafe-hammerhead/lib/request-pipeline/destination-request');
const requestCache = require('testcafe-hammerhead/lib/request-pipeline/cache');
const hammerheadHttp2 = require('testcafe-hammerhead/lib/request-pipeline/destination-request/http2');
const { isConnectionResetError } = require('testcafe-hammerhead/lib/request-pipeline/connection-reset-guard');

const CONNECT_TIMEOUT = 5000;
const LOCAL_SETTINGS_TIMEOUT = 3000;
const IDLE_TIMEOUT = 60000;
// chrome's flow control windows (node's 64KB default is slow)
const STREAM_WINDOW_SIZE = 6 * 1024 * 1024;
const CONNECTION_WINDOW_SIZE = 15 * 1024 * 1024;

const unsupportedOrigins = new Set();
const pendingSessions = new Map();
const sessions = new LRUCache({
    max: 2000,
    dispose: (session) => {
        if (!session.destroyed) session.close();
    }
});

const isUsable = (session) => session && !session.closed && !session.destroyed && !session.rhGoaway;

function getSession(key, origin) {
    const cached = sessions.get(key);
    if (isUsable(cached)) return cached;
    if (cached) sessions.delete(key);
    if (pendingSessions.has(key)) return pendingSessions.get(key);
    if (unsupportedOrigins.has(origin)) return null;

    const pending = new Promise((resolve) => {
        let session;
        try {
            session = http2.connect(origin, {
                settings: { enablePush: false, initialWindowSize: STREAM_WINDOW_SIZE }
            });
        } catch (e) {
            // fix crash on hosts http2.connect rejects (e.g. a|b.com)
            pendingSessions.delete(key);
            resolve(null);
            return;
        }
        const fail = (err) => {
            pendingSessions.delete(key);
            if (err.code === 'ERR_HTTP2_ERROR' || err.code === 'ERR_HTTP2_PING_CANCEL') unsupportedOrigins.add(origin);
            session.destroy();
            resolve(null);
        };
        const connectTimeout = setTimeout(() => fail({ code: 'ERR_HTTP2_ERROR' }), CONNECT_TIMEOUT);
        session.once('error', fail);
        session.once('connect', () => {
            clearTimeout(connectTimeout);
            const settingsTimeout = setTimeout(() => fail({ code: 'ERR_HTTP2_ERROR' }), LOCAL_SETTINGS_TIMEOUT);
            // fix "The session has been destroyed" crash (connect timeout can destroy it first under load)
            if (session.destroyed) return;
            session.ping(() => {});
            session.once('localSettings', () => {
                clearTimeout(settingsTimeout);
                pendingSessions.delete(key);
                session.setLocalWindowSize(CONNECTION_WINDOW_SIZE);
                sessions.set(key, session);

                const forget = () => {
                    if (sessions.peek(key) === session) sessions.delete(key);
                };
                session.once('goaway', () => {
                    session.rhGoaway = true;
                    forget();
                });
                session.once('close', forget);
                session.off('error', fail);
                session.on('error', (err) => {
                    forget();
                    if (!isConnectionResetError(err))
                        console.error('http2 session error for ' + origin + ': ' + err.message);
                });
                session.setTimeout(IDLE_TIMEOUT, () => {
                    forget();
                    session.close();
                });
                resolve(session);
            });
        });
    });
    pendingSessions.set(key, pending);
    return pending;
}

const _createFrom = RequestOptions.createFrom;
RequestOptions.createFrom = function (ctx) {
    const opts = _createFrom.apply(this, arguments);
    opts.rhSessionId = ctx.session && ctx.session.id;
    return opts;
};

DestinationRequest.prototype._send = async function (waitForData) {
    if (this.cache) {
        const cachedResponse = requestCache.getResponse(this.opts);
        if (cachedResponse) {
            setImmediate(() => this._emitOnResponse(cachedResponse.res));
            return;
        }
    }
    const origin = this.opts.protocol + '//' + this.opts.host;
    const session =
        !this.opts.disableHttp2 &&
        this.opts.isHttps &&
        !this.opts.isWebSocket &&
        !this.opts.proxy &&
        (await getSession((this.opts.rhSessionId || '') + ' ' + origin, origin));
    if (isUsable(session)) this._sendRealThroughHttp2(session);
    else this._sendReal(waitForData);
};

DestinationRequest.prototype._sendRealThroughHttp2 = function (session) {
    const reqHeaders = hammerheadHttp2.formatRequestHttp2Headers(this.opts);
    const endStream = !this.opts.body.length;
    let stream;
    try {
        stream = session.request(reqHeaders, { endStream });
    } catch (e) {
        // site started closing the connection
        session.rhGoaway = true;
        this._sendReal();
        return;
    }

    let settled = false;
    stream.setTimeout(this.timeout, () => {
        settled = true;
        this._onTimeout();
    });
    stream.on('error', (err) => {
        if (settled) return;
        settled = true;
        if (DestinationRequest._isHttp2ProtocolError(err)) {
            session.destroy();
            this._sendReal();
        } else this._onError(err);
    });
    stream.on('response', (headers) => {
        settled = true;
        this._onResponse(hammerheadHttp2.createResponseLike(stream, headers));
    });
    stream.on('close', () => {
        if (settled) return;
        settled = true;
        // refused before processing, safe to resend
        if (stream.rstCode === http2.constants.NGHTTP2_REFUSED_STREAM) this._sendReal();
        else this._onError(Object.assign(new Error('http2 stream closed before a response'), { code: 'ECONNRESET' }));
    });
    if (!endStream) {
        stream.write(this.opts.body);
        stream.end();
    }
    this.req = stream;
};
