/**
 * Custom cookie sync-name letters, server side.
 *
 * Hammerhead's cookie sync names are `<s|c|w>|<sid>|<key>|...` with the
 * sync-type letters hardcoded in lib/utils/cookie.js (read at call time via
 * the module's exported object in every parser/formatter — a mutation here
 * is enough; SYNCHRONIZATION_TYPE_RE is module-load-bound but only used by
 * changeSyncType, which runs client-side only).
 *
 * An app that wants other letters calls this once at boot; the client
 * bundle receives the same letters through the task settings, so
 * the two sides agree by construction. Never call this after requests are
 * served — the letters are a per-process contract with the client bundle.
 *
 * @param {{server: string, client: string, window: string}} letters
 */
const cookieUtil = require('testcafe-hammerhead/lib/utils/cookie');

module.exports = function applyCookieSyncLetters(letters) {
    if (!letters) return;
    for (const type of ['server', 'client', 'window']) {
        if (typeof letters[type] === 'string' && /^[a-z]$/.test(letters[type])) {
            cookieUtil.SYNCHRONIZATION_TYPE[type] = letters[type];
        }
    }
};
