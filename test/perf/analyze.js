// summarizes a .cpuprofile from load.js by what the proxy was doing.
// usage: node test/perf/analyze.js <file.cpuprofile> [--top 30]
const fs = require('fs');

const file = process.argv[2];
const topN = Number(process.argv[process.argv.indexOf('--top') + 1]) || 30;
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));

// first matching rule wins; matched against "url functionName"
const CATEGORIES = [
    ['idle', /^ \(idle\)$/],
    ['garbage collection', /\(garbage collector\)/],
    ['js rewrite: parse (acorn)', /acorn-hammerhead/],
    ['js rewrite: codegen (esotope)', /esotope-hammerhead/],
    ['js rewrite: transform (hammerhead)', /processing\/script\//],
    ['html rewrite (parse5 + dom processing)', /parse5|processing\/dom|processing\/resources\/page/],
    ['css rewrite', /processing\/style|processing\/resources\/stylesheet/],
    ['url rewriting (hammerhead utils/url)', /utils\/url\.js/],
    ['url shuffling (rammerhead)', /StrShuffler|addUrlShuffling/],
    ['js cache (md5 + disk)', /addJSDiskCache|RammerheadJSFileCache|RammerheadJSAbstractCache|node:internal\/crypto\/hash/],
    ['cookies (tough-cookie + hammerhead)', /tough-cookie|cookie/i],
    ['headers + request pipeline (hammerhead)', /request-pipeline/],
    ['compression (main thread part)', /node:zlib|zlib/],
    ['tls', /node:_tls|node:tls|internal\/tls/],
    ['http/1 parsing + sockets', /node:_http|node:http|node:net|internal\/http|node:internal\/stream_base|HTTPParser/],
    ['http2', /node:internal\/http2|node:http2/],
    ['streams + buffers', /node:internal\/streams|node:buffer|node:internal\/buffer|node:string_decoder/],
    ['text encoding (iconv)', /iconv/],
    ['rammerhead (other)', /rammerhead\/src\//],
    ['hammerhead (other)', /testcafe-hammerhead/],
    ['other node_modules', /node_modules/],
    ['node internals (other)', /node:/],
    ['native / program', /\((program|root)\)|^ \S/]
];

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const selfUs = new Map();
for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i + 1] ?? 0;
    selfUs.set(profile.samples[i], (selfUs.get(profile.samples[i]) || 0) + dt);
}

const label = (n) => `${n.callFrame.url.replace(/^.*node_modules\//, '').replace(/^file:\/\/.*\/rammerhead\//, 'rammerhead/')} ${n.callFrame.functionName || '(anonymous)'}`;
const categorize = (n) => {
    const key = `${n.callFrame.url} ${n.callFrame.functionName}`;
    return (CATEGORIES.find(([, re]) => re.test(key)) || ['uncategorized'])[0];
};

const cats = {};
const funcs = {};
let total = 0;
let idle = 0;
for (const [id, us] of selfUs) {
    const n = byId.get(id);
    const cat = categorize(n);
    if (cat === 'idle') {
        idle += us;
        continue;
    }
    total += us;
    cats[cat] = (cats[cat] || 0) + us;
    const l = `${label(n)}:${n.callFrame.lineNumber + 1}`;
    funcs[l] = (funcs[l] || 0) + us;
}

// inclusive time of a few entry points, so "how much does a whole js rewrite cost" is visible
const parents = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parents.set(c, n.id);
const inclusive = {};
const ENTRY = {
    'processScript (whole js rewrite)': /processing\/script\/index\.js processScript$/,
    'page processor (whole html rewrite)': /resources\/page\.js processResource$/,
    'stylesheet processor': /resources\/stylesheet\.js processResource$/
};
for (const [id, us] of selfUs) {
    let cur = id;
    const seen = new Set();
    while (cur !== undefined) {
        const n = byId.get(cur);
        for (const [name, re] of Object.entries(ENTRY)) {
            if (!seen.has(name) && re.test(`${n.callFrame.url} ${n.callFrame.functionName}`)) {
                inclusive[name] = (inclusive[name] || 0) + us;
                seen.add(name);
            }
        }
        cur = parents.get(cur);
    }
}

const pct = (us) => ((100 * us) / total).toFixed(1).padStart(5) + '%';
const sec = (us) => (us / 1e6).toFixed(1).padStart(7) + 's';
console.log(`main thread busy ${sec(total)}, idle ${sec(idle)} (${((100 * total) / (total + idle)).toFixed(0)}% busy)\n`);
console.log('by category (self time):');
for (const [k, v] of Object.entries(cats).sort((a, b) => b[1] - a[1])) console.log(`  ${pct(v)} ${sec(v)}  ${k}`);
console.log('\nentry points (inclusive):');
for (const [k, v] of Object.entries(inclusive)) console.log(`  ${pct(v)} ${sec(v)}  ${k}`);
console.log(`\ntop ${topN} functions (self time):`);
for (const [k, v] of Object.entries(funcs).sort((a, b) => b[1] - a[1]).slice(0, topN)) console.log(`  ${pct(v)} ${sec(v)}  ${k}`);
