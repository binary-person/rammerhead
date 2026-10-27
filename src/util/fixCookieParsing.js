const cookieUtils = require('testcafe-hammerhead/lib/utils/cookie.js');

const parseClientSyncCookieStr = cookieUtils.parseClientSyncCookieStr;

// fix crash on cookie segments without a key= (trailing semicolon from youtube.com, "a=1; flag", ...)
cookieUtils.parseClientSyncCookieStr = function (cookieStr) {
    const parsable = (cookieStr || '')
        .split(';')
        .filter((segment) => /^[^=]+=/.test(segment.trim()))
        .join(';');
    return parseClientSyncCookieStr(parsable);
};
