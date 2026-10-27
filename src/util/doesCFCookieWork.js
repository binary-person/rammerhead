const { default: fetch } = require("node-fetch");
const { HttpProxyAgent } = require('http-proxy-agent');

module.exports = async function doesCFCookieWork(url, cfClearanceCookie, userAgent, proxyUrl) {
  if (!url)
    throw new TypeError('must specify url');
  if (!cfClearanceCookie)
    throw new TypeError('must specify cfClearanceCookie');
  if (!userAgent)
    throw new TypeError('must specify userAgent');

  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': userAgent,
        'cookie': 'cf_clearance=' + cfClearanceCookie
      },
      agent: proxyUrl ? new HttpProxyAgent('http://' + proxyUrl) : undefined
    });
    if  (res.status === 403 && res.headers.get('cf-mitigated') === 'challenge') {
      // cookie no work
      return false;
    } else {
      // cookie yes work
      return true;
    }
  } catch (e) {
    if (e.code === 'HPE_HEADER_OVERFLOW') {
      // it's probably fine. just the site headers being funny.
      // example site: stake.com
      return true;
    }
    throw e;
  }
};
