const urlUtils = require('testcafe-hammerhead/lib/utils/url');
const RequestPipelineContext = require('testcafe-hammerhead/lib/request-pipeline/context');

/**
 * if a non-crossdomain origin makes a request to a crossdomain port, the ports are flipped. this is to fix that issue.
 * original: https://github.com/DevExpress/testcafe-hammerhead/blob/f5b0508d10614bf39a75c772dc6bd01c24f29417/src/request-pipeline/context.ts#L436
 */
RequestPipelineContext.prototype.getProxyOrigin = function getProxyOrigin(isCrossDomain = false) {
    return urlUtils.getDomain({
        protocol: this.serverInfo.protocol,
        hostname: this.serverInfo.hostname,
        // if we receive a request that has a proxy origin header, (ctx.getProxyOrigin(!!ctx.dest.reqOrigin),
        // https://github.com/DevExpress/testcafe-hammerhead/blob/f5b0508d10614bf39a75c772dc6bd01c24f29417/src/request-pipeline/header-transforms/transforms.ts#L128),
        // then we must return the other port over. however, the issue with this is we don't know if the incoming request is actually a
        // crossdomain port (a simple check for reqOrigin cannot suffice, as a request from a non-crossdomain origin to a crossdomain port and
        // vice versa can happen),
        // so this will fix the issue from non-crossdomain port to crossdomain-port but will NOT fix crosdomain-port to non-crossdomain port.
        // However, the latter case will never happen because hammerhead made all client rewriting cross-domain requests to always use the
        // cross-domain ports, even if the origin is from a cross-domain port
        port:     isCrossDomain ? this.serverInfo.port : this.serverInfo.crossDomainPort // <-- changed
    });
};
