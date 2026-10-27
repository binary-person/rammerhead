// fix random failures (a 502 in front of the proxy) when a site closes an idle keep-alive connection just as it gets
// reused (google, youtube): send a GET/HEAD/OPTIONS once more on a new connection, as node's docs advise. other
// methods aren't resent: the site may have acted on them
const DestinationRequest = require('testcafe-hammerhead/lib/request-pipeline/destination-request');

const RESENDABLE = new Set(['GET', 'HEAD', 'OPTIONS']);
const _onError = DestinationRequest.prototype._onError;

DestinationRequest.prototype._onError = function (err) {
    const req = this.req;
    if (
        !this.rhResent &&
        req &&
        req.reusedSocket &&
        !this.hasResponse &&
        (err.code === 'ECONNRESET' || err.code === 'EPIPE') &&
        RESENDABLE.has(String(this.opts.method).toUpperCase())
    ) {
        this.rhResent = true;
        this._sendReal();
        return;
    }
    return _onError.call(this, err);
};
