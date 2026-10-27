// emits errors nobody listens for inside hammerhead's connection reset guard, then reports whether the process survived
require('../../src/util/addMoreErrorGuards');
const { EventEmitter } = require('events');
const { connectionResetGuard } = require('testcafe-hammerhead/lib/request-pipeline/connection-reset-guard');
const fire = (message) =>
    connectionResetGuard(() => {
        const emitter = new EventEmitter();
        setImmediate(() => emitter.emit('error', Object.assign(new Error(message), { code: 'ESOMETHINGELSE' })));
    });
fire('first unexpected error');
setTimeout(() => fire('second unexpected error'), 50);
setTimeout(() => {
    console.log('survived');
    process.exit(0);
}, 300);
