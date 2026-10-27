// rewritten by the proxy (location), yet should stringify to this source
function externalFn(o) { return location.href + o.location; }
console.log('external: ' + (externalFn.toString() === 'function externalFn(o) { return location.href + o.location; }' ? 'ok' : 'fail, ' + externalFn.toString()));
