// stands in for cloudflare's challenge page script (rammerhead detects challenge pages by this path)
window.onChallengeTurnstile = function () {
    var id = turnstile.render('#widget', { sitekey: '0x4AAAAAAADnPIDROrmt1Wwj', cData: 'x', chlPageData: 'y', action: 'managed' });
    console.log('render returned: ' + (typeof id === 'string' ? 'ok' : 'fail, ' + Object.prototype.toString.call(id)));
};
