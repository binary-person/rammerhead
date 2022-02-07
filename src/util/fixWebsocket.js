// fixes unpipe error and crashes resulting from http requests to websocket proxy endpoint

const stages = require('testcafe-hammerhead/lib/request-pipeline/stages');
const { Duplex } = require('stream');

stages.unshift(function fixWebsocket(ctx) {
    ctx.isWebSocket = ctx.res instanceof Duplex;
});
