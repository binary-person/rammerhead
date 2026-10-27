// the service worker tests again with a deployment secret: every proxied url then ends in the cache tag
process.env.RH_SW_TAGGED = '1';
require('./serviceworkers.test.js');
