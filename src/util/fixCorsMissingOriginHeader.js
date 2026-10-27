const transforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms');
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');

/**
 * if we create this server with port === crossDomainPort, origin header doesn't get properly sent
 * since the (actual) fetch doesn't add the origin.
 * so we manually add it where the browser would have: cross-origin cors requests, websockets, and anything
 * that isn't GET/HEAD. not on navigations or plain script/image loads (sites can tell)
 */

transforms.forcedRequestTransforms[BUILTIN_HEADERS.origin] = (src, ctx) => {
  if (ctx.serverInfo.port != ctx.serverInfo.crossDomainPort) return src;

  // https://stackoverflow.com/questions/42239643/when-do-browsers-send-the-origin-header-when-do-browsers-set-the-origin-to-null
  const crossOrigin = ctx.dest.reqOrigin !== ctx.dest.domain;
  const method = (ctx.req.method || 'GET').toUpperCase();
  const mode = ctx.req.headers['sec-fetch-mode'];
  if (ctx.isWebSocket) return crossOrigin ? ctx.dest.reqOrigin : src;
  if (method !== 'GET' && method !== 'HEAD') return src || ctx.dest.reqOrigin;
  if (crossOrigin && mode === 'cors') return ctx.dest.reqOrigin;
  return src;
};
