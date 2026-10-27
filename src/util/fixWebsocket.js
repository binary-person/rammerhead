// fixes unpipe error and crashes resulting from http requests to websocket proxy endpoint

const stages = require('testcafe-hammerhead/lib/request-pipeline/stages');
const { Duplex } = require('stream');

stages.unshift(function fixWebsocket(ctx) {
    ctx.isWebSocket = ctx.res instanceof Duplex;
});

// fixes EPIPE error when trying to write head to a closed socket
const hammerheadWS = require('testcafe-hammerhead/lib/request-pipeline/websocket');
const respondOnWebSocket = hammerheadWS.respondOnWebSocket;
hammerheadWS.respondOnWebSocket = function (ctx) {
    ctx.res.on('error', (err) => {
        if (err.code !== 'EPIPE') {
            // console.error('Unknown crash-inducing error:', err);
        }
        // cleanup end will automatically be handled by the 'end' listener
    });

    // crashes happen when client wants websocket but destination server says no.
    // reproduced by setting disableHttp2 to true and going to web.whatsapp.com
    if (!ctx.destRes.upgrade) {
        ctx.res.end(`HTTP/${ctx.destRes.httpVersion} ${ctx.destRes.statusCode} ${ctx.destRes.statusMessage}\r\r\n`);
        ctx.destRes.destroy();
        return;
    }

    respondOnWebSocket(ctx);
    tieWebSocketLifetimes(ctx.res, ctx.destRes.socket);
};

// fix memory leak: close both sides of a websocket when either ends (hammerhead only unpipes)
const WEBSOCKET_CLOSE_GRACE = 5000;
function tieWebSocketLifetimes(client, site) {
    let graceTimer = null;
    const destroyBoth = () => {
        clearTimeout(graceTimer);
        // not resetAndDestroy, it throws on tls sockets
        client.destroy();
        site.destroy();
    };
    const endOther = (other) => () => {
        // give the close frame time to go through
        if (!other.destroyed) other.end();
        if (!graceTimer) graceTimer = setTimeout(destroyBoth, WEBSOCKET_CLOSE_GRACE).unref();
    };
    client.once('end', endOther(site));
    site.once('end', endOther(client));
    client.once('close', destroyBoth);
    site.once('close', destroyBoth);
    client.on('error', destroyBoth);
    site.on('error', destroyBoth);
}
