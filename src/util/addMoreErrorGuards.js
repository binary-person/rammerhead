// handle the additional errors: ERR_INVALID_PROTOCOL and ETIMEDOUT
// hammerhead handled errors: ECONNRESET, EPIPE (or ECONNABORTED for windows)

const hGuard = require('testcafe-hammerhead/lib/request-pipeline/connection-reset-guard');
const isConnectionResetError = hGuard.isConnectionResetError;
hGuard.isConnectionResetError = function (err) {
    // for some reason, ECONNRESET isn't handled correctly
    if (
        isConnectionResetError(err) ||
        err.code === 'ERR_INVALID_PROTOCOL' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.code === 'ERR_HTTP2_SESSION_ERROR'
    ) {
        return true;
    }
    console.error('Unknown crash-inducing error:', err);
    // never return false as to avoid crashing the server
    return true;
};

// fix hammerhead's guard ignoring the check above and disarming itself after its first unexpected error
const guardDomain = require('domain').create();
guardDomain.on('error', (err) => hGuard.isConnectionResetError(err));
hGuard.connectionResetGuard = (fn) => guardDomain.run(fn);

// log origin and emitter too, async stacks only show node internals
function describeError(err, origin) {
    const lines = [(err.stack || '').split('\n').slice(1, 7).join('\n')];
    const context = { origin };
    if (err.domainThrown !== undefined) context.domainThrown = err.domainThrown;
    const emitter = err.domainEmitter;
    if (emitter) {
        context.emitter = emitter.constructor && emitter.constructor.name;
        const sent = emitter.sentHeaders;
        if (sent)
            context.request = `${sent[':method']} https://${sent[':authority']}${(sent[':path'] || '').split('?')[0]}`;
    }
    lines.push('    context: ' + JSON.stringify(context));
    return lines.join('\n');
}

process.on('uncaughtException', (err, origin) => {
    // for some reason, the above never catches all of the errors. this is a last resort failsafe
    if (
        err.message.includes('ECONN') ||
        err.message.includes('EPIPE') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ERR_INVALID_') ||
        err.message.includes('Session closed with error code') ||
        err.message.includes('aborted') ||
        err.message.includes('The session has been destroyed') ||
        err.message.includes('NGHTTP2_PROTOCOL_ERROR') ||
        err.message.includes('Protocol "about:" not supported. Expected')
    ) {
        // crash avoided!
        console.error('Avoided crash: ' + err.message + '\n' + describeError(err, origin));
    } else {
        // probably a TypeError or something important
        console.error('About to throw: ' + err.message + '\n' + describeError(err, origin));
        throw err;
    }
});
