// fix ERR_INVALID_CHAR crash from header values with control or non-latin chars (seen with content-disposition)
// eslint-disable-next-line no-control-regex
const INVALID = /[^\t\x20-\x7e\x80-\xff]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/g;

function sanitizeValue(value) {
    if (typeof value !== 'string' || !INVALID.test(value)) return value;
    return Buffer.from(value.replace(CONTROL, ''), 'utf8').toString('latin1');
}

module.exports = function sanitizeHeaderValues(headers) {
    if (!headers || typeof headers !== 'object') return headers;
    for (const name of Object.keys(headers)) {
        const value = headers[name];
        headers[name] = Array.isArray(value) ? value.map(sanitizeValue) : sanitizeValue(value);
    }
    return headers;
};
