// maps positions in rewritten scripts back to the site's original positions, so stack traces show the
// original line:column (anti-bot scripts check where their own functions are). the map is found by aligning
// the original and rewritten text: hammerhead only prepends a header and replaces expressions

const { SCRIPT_PROCESSING_END_HEADER_COMMENT } = require('testcafe-hammerhead/lib/processing/script/header');

const ANCHOR = 32; // chars that must match to resync after a rewritten expression
const INNER_ANCHOR = 6; // inside a rewritten expression, which mostly regenerates the original code
const MAX_GAP = 20000; // how far ahead a resync may be
const MAX_GROWTH = 6; // rewritten code is at most this many times longer than the original it replaced...
const GROWTH_SLACK = 120; // ...plus this (a short `a.b` becomes ` __get$(a,"b") `)
const MAX_SCRIPT = 2 * 1024 * 1024; // bigger scripts skip the map (it costs cpu on every first load)

/**
 * @returns {number[][]} runs of verbatim text: [originalStart, processedStart, length]
 */
function alignRuns(original, processed, from = [0, 0], to = [original.length, processed.length], anchorSize = ANCHOR) {
    const runs = [];
    let [i, j] = from;
    const [iEnd, jEnd] = to;
    while (i < iEnd && j < jEnd) {
        if (original[i] === processed[j]) {
            const start = [i, j];
            while (i < iEnd && j < jEnd && original[i] === processed[j]) i++, j++;
            runs.push([start[0], start[1], i - start[0]]);
            continue;
        }
        // resync: the next original chunk that shows up shortly after j in the processed text
        let found = false;
        // only search a bounded window, or every miss scans the rest of the script
        const window = processed.substring(j, Math.min(jEnd, j + MAX_GAP));
        for (let di = 0; di < MAX_GAP && i + di < iEnd; di++) {
            const anchor = original.substring(i + di, Math.min(iEnd, i + di + anchorSize));
            // near the end there's less left to match: shorter anchors will do
            if (anchor.length < Math.min(anchorSize, INNER_ANCHOR) || i + di + anchor.length > iEnd) break;
            // a rewrite only grows code so much, so a match much further away is the same text repeated later
            const found_at = window.indexOf(anchor);
            const at = found_at === -1 || found_at > MAX_GROWTH * di + GROWTH_SLACK ? -1 : j + found_at;
            if (at !== -1) {
                // align inside the rewritten expression too
                if (anchorSize > INNER_ANCHOR && di > 0 && at > j) {
                    runs.push(...alignRuns(original, processed, [i, j], [i + di, at], INNER_ANCHOR));
                }
                i += di;
                j = at;
                found = true;
                break;
            }
        }
        if (!found) break;
    }
    return runs;
}

// a rewritten computed call (`o[k](x)` became `__call$(o, k, [x])`) is reported at the start of `__call$`,
// but v8 reports the original at its "(". add one-char runs pointing there
function callRuns(original, processed, runs) {
    const extra = [];
    let acorn;
    try {
        acorn = require('acorn-hammerhead');
    } catch (e) {
        return extra;
    }
    const CALL = '__call$(';
    let r = 0;
    for (let q = processed.indexOf(CALL); q !== -1; q = processed.indexOf(CALL, q + 1)) {
        while (r < runs.length && runs[r][1] <= q) r++;
        // the gap q is in: between runs[r - 1] and runs[r]
        const next = runs[r];
        if (!next) break;
        const prevEnd = r > 0 ? runs[r - 1][0] + runs[r - 1][2] : 0;
        const start = next[0] > prevEnd && /^\s*$/.test(original.slice(prevEnd, next[0])) ? next[0] : prevEnd;
        // which call: count earlier __call$( in the same gap (outermost first)
        let depth = 0;
        for (
            let k = processed.lastIndexOf(CALL, q - 1);
            k !== -1 && (r === 0 || k >= runs[r - 1][1] + runs[r - 1][2]);
            k = processed.lastIndexOf(CALL, k - 1)
        )
            depth++;
        let node;
        try {
            node = acorn.parseExpressionAt(original, original.slice(start).search(/\S/) + start, { ecmaVersion: 13 });
        } catch (e) {
            continue;
        }
        const calls = [];
        for (let n = node; n; ) {
            if (n.type === 'CallExpression') {
                if (n.callee.type === 'MemberExpression' && n.callee.computed) calls.push(n);
                n = n.callee.type === 'MemberExpression' ? n.callee.object : n.callee;
            } else if (n.type === 'MemberExpression') n = n.object;
            else if (
                n.type === 'BinaryExpression' ||
                n.type === 'LogicalExpression' ||
                n.type === 'AssignmentExpression'
            )
                n = n.left;
            else if (n.type === 'SequenceExpression') n = n.expressions[0];
            else if (n.type === 'ConditionalExpression') n = n.test;
            else break;
        }
        const call = calls[depth];
        if (!call) continue;
        const paren = original.indexOf('(', call.callee.end);
        if (paren !== -1) extra.push([paren, q, 1]);
    }
    return extra;
}

function withCallRuns(original, processed, runs) {
    const extra = callRuns(original, processed, runs);
    return extra.length ? runs.concat(extra).sort((a, b) => a[1] - b[1]) : runs;
}

function lineStarts(text) {
    const starts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    return starts;
}

function toLineCol(starts, offset) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return [lo, offset - starts[lo]];
}

/**
 * @returns {number[]} flat segments, 6 numbers each (0-based): processed start line/col, processed end line/col,
 * original start line/col. a position inside a segment maps exactly, a position between segments maps to
 * the original position where the next segment's gap began
 */
// the script starts after hammerhead's header (which may embed original source, see addFunctionSources)
function bodyStart(processed) {
    const headerEnd = processed.indexOf(SCRIPT_PROCESSING_END_HEADER_COMMENT);
    return headerEnd === -1 ? 0 : headerEnd + SCRIPT_PROCESSING_END_HEADER_COMMENT.length;
}

function positionMap(original, processed) {
    const runs = withCallRuns(original, processed, alignRuns(original, processed, [0, bodyStart(processed)]));
    const originalLines = lineStarts(original);
    const processedLines = lineStarts(processed);
    const flat = [];
    for (const [o, p, length] of runs) {
        flat.push(
            ...toLineCol(processedLines, p),
            ...toLineCol(processedLines, p + length),
            ...toLineCol(originalLines, o)
        );
    }
    return flat;
}

// segments are stored as deltas from the previous one (columns too, while on the same line), which keeps
// the embedded map small
function encode(flat) {
    const out = [];
    let prev = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < flat.length; k += 6) {
        const seg = flat.slice(k, k + 6);
        for (let n = 0; n < 6; n += 2) {
            const sameLine = seg[n] === prev[n];
            out.push(seg[n] - prev[n], sameLine ? seg[n + 1] - prev[n + 1] : seg[n + 1]);
        }
        prev = seg;
    }
    return out;
}

// client-side, shared with rammerhead.js (keep in sync)
function decode(deltas) {
    const flat = [];
    const prev = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < deltas.length; k += 6) {
        for (let n = 0; n < 6; n += 2) {
            const line = prev[n] + deltas[k + n];
            prev[n + 1] = line === prev[n] ? prev[n + 1] + deltas[k + n + 1] : deltas[k + n + 1];
            prev[n] = line;
        }
        flat.push(...prev);
    }
    return flat;
}

/**
 * client-side lookup, shared with rammerhead.js (keep in sync). line and column are 1-based like v8's
 */
function mapPosition(flat, line, column) {
    const l = line - 1;
    const c = column - 1;
    const before = (al, ac, bl, bc) => al < bl || (al === bl && ac < bc);
    let lo = 0;
    let hi = flat.length / 6 - 1;
    let hit = -1;
    // last segment starting at or before the position
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (before(l, c, flat[mid * 6], flat[mid * 6 + 1])) hi = mid - 1;
        else (hit = mid), (lo = mid + 1);
    }
    if (hit === -1) return null;
    const [pl, pc, el, ec, ol, oc] = flat.slice(hit * 6, hit * 6 + 6);
    if (before(l, c, el, ec)) {
        // inside verbatim text
        return l === pl ? [ol + 1, oc + (c - pc) + 1] : [ol + (l - pl) + 1, c + 1];
    }
    // inside a rewritten expression: point at where it started in the original
    const next = flat.slice((hit + 1) * 6, (hit + 1) * 6 + 6);
    if (next.length) {
        const [, , , , nol, noc] = next;
        // the original gap starts right after this segment's verbatim text
        const gapLine = ol + (el - pl);
        const gapCol = el === pl ? oc + (ec - pc) : ec;
        return before(nol, noc, gapLine, gapCol) ? [nol + 1, noc + 1] : [gapLine + 1, gapCol + 1];
    }
    return null;
}

// runs `h.<registry>.set(<script url>, value)` from the processed script's header. the header is a single
// line, so inserting into it doesn't move anything in the script
function registerInHeader(processed, registry, value) {
    const headerEnd = processed.indexOf(SCRIPT_PROCESSING_END_HEADER_COMMENT);
    if (headerEnd === -1 || processed.lastIndexOf('\n', headerEnd) !== -1) return processed;
    const register =
        '(function(h,s){try{if(h&&s){var m=h.' +
        registry +
        '||(h.' +
        registry +
        '=new Map());' +
        'm.set(h.nativeMethods.scriptSrcGetter.call(s),' +
        JSON.stringify(value) +
        ')}}catch(e){}})(typeof window!=="undefined"&&window["%hammerhead%"],typeof document!=="undefined"&&document.currentScript);';
    return processed.slice(0, headerEnd) + register + processed.slice(headerEnd);
}

/**
 * embeds the position map in the processed script's header, keyed by the script's url at runtime
 */
function addPositionMap(original, processed) {
    if (original.length > MAX_SCRIPT) return processed;
    if (processed.indexOf(SCRIPT_PROCESSING_END_HEADER_COMMENT) === -1) return processed;
    const flat = positionMap(original, processed);
    if (!flat.length) return processed;
    return registerInHeader(processed, 'rhPositions', encode(flat));
}

/**
 * embeds the site's own response sizes, so resource timing reports them instead of the rewritten script's
 */
function addResourceSizes(original, processed, encodedBodySize) {
    const decodedBodySize = Buffer.byteLength(original, 'utf8');
    return registerInHeader(processed, 'rhResourceSizes', [decodedBodySize, encodedBodySize || decodedBodySize]);
}

const MAX_FUNCTION_SOURCE = 20000; // per function: anti-bot vms stringify their own handlers (a few kb)
const MAX_SOURCES_RATIO = 2; // in total, at most this many times the script (nested functions repeat text)

// fnv-1a over utf-16 code units. client-side copy in build.js (keep in sync)
function sourceKey(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return text.length + ':' + hash.toString(36);
}

// where V8's Function.prototype.toString starts and ends for each function in the source
function functionRanges(source) {
    let ast;
    try {
        ast = require('acorn-hammerhead').parse(source, {
            allowReturnOutsideFunction: true,
            allowImportExportEverywhere: true,
            ecmaVersion: 13
        });
    } catch (e) {
        return [];
    }
    const ranges = [];
    const visit = (node, parent) => {
        if (!node || typeof node.type !== 'string') return;
        if (
            /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassDeclaration|ClassExpression)$/.test(
                node.type
            )
        ) {
            let start = node.start;
            // methods: from the key, including get/set/async/*, but not static
            if (
                parent &&
                ((parent.type === 'Property' && (parent.method || parent.kind !== 'init')) ||
                    parent.type === 'MethodDefinition') &&
                parent.value === node
            ) {
                start = parent.start;
                if (parent.static) start = source.indexOf('static', start) + 6;
                while (/\s/.test(source[start])) start++;
            }
            ranges.push([start, node.end]);
        }
        for (const key of Object.keys(node)) {
            if (key === 'start' || key === 'end') continue;
            const child = node[key];
            if (Array.isArray(child)) for (const c of child) visit(c, node);
            else if (child && typeof child.type === 'string') visit(child, node);
        }
    };
    visit(ast, null);
    return ranges;
}

/**
 * embeds the original source of small functions the rewriting changed, so toString() can return it
 */
function addFunctionSources(original, processed) {
    if (original.length > MAX_SCRIPT || processed.indexOf('h.rhSources') !== -1) return processed;
    if (processed.indexOf(SCRIPT_PROCESSING_END_HEADER_COMMENT) === -1) return processed;
    const sources = [];
    let total = 0;
    const add = (text, rewritten) => {
        if (text.length > MAX_FUNCTION_SOURCE || rewritten === text) return;
        if ((total += text.length) > original.length * MAX_SOURCES_RATIO) return;
        sources.push([sourceKey(rewritten), text]);
    };
    // rewriting doesn't add or remove functions, so the nth function in each matches up, even inside
    // expressions hammerhead regenerated as a whole
    const body = bodyStart(processed);
    const originalRanges = functionRanges(original);
    const processedRanges = functionRanges(processed.slice(body));
    if (originalRanges.length && originalRanges.length === processedRanges.length) {
        originalRanges.forEach(([start, end], n) => {
            const [p0, p1] = processedRanges[n];
            add(original.slice(start, end), processed.slice(body + p0, body + p1));
        });
    } else {
        // fall back to aligning the text, which only finds functions that start and end in verbatim code
        const runs = alignRuns(original, processed, [0, body]);
        const toProcessed = (offset, isEnd) => {
            let lo = 0;
            let hi = runs.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const [o, p, length] = runs[mid];
                if (offset < o + (isEnd ? 1 : 0)) hi = mid - 1;
                else if (offset > o + length - (isEnd ? 0 : 1)) lo = mid + 1;
                else return p + (offset - o);
            }
            return -1;
        };
        for (const [start, end] of originalRanges) {
            const p0 = toProcessed(start, false);
            const p1 = toProcessed(end, true);
            if (p0 !== -1 && p1 > p0) add(original.slice(start, end), processed.slice(p0, p1));
        }
    }
    if (!sources.length) return processed;
    const headerEnd = processed.indexOf(SCRIPT_PROCESSING_END_HEADER_COMMENT);
    if (processed.lastIndexOf('\n', headerEnd) !== -1) return processed;
    // inline scripts sit in html, so keep "</script>" out of the literal
    const literal = JSON.stringify(sources).replace(/</g, '\\u003c');
    const register =
        '(function(h){try{if(h){var m=h.rhSources||(h.rhSources=new Map()),a=' +
        literal +
        ';for(var i=0;i<a.length;i++)m.set(a[i][0],a[i][1])}}catch(e){}})(typeof window!=="undefined"&&window["%hammerhead%"]);';
    return processed.slice(0, headerEnd) + register + processed.slice(headerEnd);
}

// inline scripts: v8 reports positions in the html document, so map them per script and translate
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
function inlineScripts(html, skipInjected) {
    const scripts = [];
    SCRIPT_RE.lastIndex = 0;
    let m;
    while ((m = SCRIPT_RE.exec(html))) {
        if (skipInjected && /hammerhead-shadow-ui/.test(m[1])) continue;
        scripts.push({ start: m.index + m[0].indexOf('>') + 1, text: m[2] });
    }
    return scripts;
}

function documentPositionMap(originalHtml, processedHtml) {
    if (originalHtml.length > MAX_SCRIPT) return null;
    const originals = inlineScripts(originalHtml, false);
    const processed = inlineScripts(processedHtml, true);
    if (!originals.length || originals.length !== processed.length) return null;
    const runs = [];
    originals.forEach((o, n) => {
        const p = processed[n];
        if (o.text === p.text) return runs.push([o.start, p.start, o.text.length]);
        for (const [ro, rp, length] of withCallRuns(
            o.text,
            p.text,
            alignRuns(o.text, p.text, [0, bodyStart(p.text)])
        )) {
            runs.push([o.start + ro, p.start + rp, length]);
        }
    });
    const originalLines = lineStarts(originalHtml);
    const processedLines = lineStarts(processedHtml);
    const flat = [];
    for (const [o, p, length] of runs) {
        flat.push(
            ...toLineCol(processedLines, p),
            ...toLineCol(processedLines, p + length),
            ...toLineCol(originalLines, o)
        );
    }
    return flat.length ? encode(flat) : null;
}

// per session: page url -> what its task script hands the page (see RammerheadSession.getTaskScript)
const MAX_PAGES = 200;
const pageExtras = new WeakMap();
const pageProcessor = require('testcafe-hammerhead/lib/processing/resources/page.js');
const processPage = pageProcessor.processResource;
pageProcessor.processResource = function (html, ctx) {
    require('./resourceTiming').rememberOriginalSizes(ctx, html);
    const processed = processPage.apply(this, arguments);
    try {
        if (typeof processed === 'string' && typeof html === 'string' && ctx && ctx.session && ctx.dest) {
            let pages = pageExtras.get(ctx.session);
            if (!pages) pageExtras.set(ctx.session, (pages = new Map()));
            const decoded = Buffer.byteLength(html, 'utf8');
            pages.set(ctx.dest.url.split('#')[0], {
                positions: documentPositionMap(html, processed),
                sizes: [decoded, ctx.destResBody ? ctx.destResBody.length : decoded]
            });
            if (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value);
        }
    } catch (e) {
        // the page itself is fine without these
    }
    return processed;
};

function pageExtrasFor(session, pageUrl) {
    const pages = pageExtras.get(session);
    return pages && pageUrl ? pages.get(pageUrl.split('#')[0]) : undefined;
}

// inline and external scripts both go through this export (see processing/dom and resources/script)
const scriptModule = require('testcafe-hammerhead/lib/processing/script');
const processScript = scriptModule.processScript;
scriptModule.processScript = function (src, withHeader) {
    const processed = processScript.apply(this, arguments);
    return withHeader && typeof processed === 'string' && processed !== src
        ? addFunctionSources(src, processed)
        : processed;
};

module.exports = {
    MAX_SCRIPT,
    pageExtrasFor,
    documentPositionMap,
    sourceKey,
    functionRanges,
    addFunctionSources,
    alignRuns,
    positionMap,
    encode,
    decode,
    mapPosition,
    addPositionMap,
    addResourceSizes
};
