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
};
