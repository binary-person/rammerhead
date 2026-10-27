// shows which call paths lead into functions matching a pattern, weighted by time.
// usage: node test/perf/callers.js <file.cpuprofile> <regex> [depth]
const fs = require('fs');
const [file, pattern, depthArg] = process.argv.slice(2);
const depth = Number(depthArg) || 4;
const re = new RegExp(pattern);
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parents = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parents.set(c, n.id);
const selfUs = new Map();
for (let i = 0; i < profile.samples.length; i++) selfUs.set(profile.samples[i], (selfUs.get(profile.samples[i]) || 0) + (profile.timeDeltas[i + 1] ?? 0));
const name = (n) => `${n.callFrame.functionName || '(anon)'} (${n.callFrame.url.replace(/^.*node_modules\//, '').replace(/^.*\/rammerhead\//, '')}:${n.callFrame.lineNumber + 1})`;
const paths = {};
let total = 0;
for (const [id, us] of selfUs) {
    // walk up to the outermost matching frame, then record the callers above it
    let cur = id;
    let match = null;
    while (cur !== undefined) {
        const n = byId.get(cur);
        if (re.test(`${n.callFrame.url} ${n.callFrame.functionName}`)) match = cur;
        cur = parents.get(cur);
    }
    if (match === null) continue;
    total += us;
    const chain = [];
    for (let c = parents.get(match); c !== undefined && chain.length < depth; c = parents.get(c)) chain.push(name(byId.get(c)));
    const key = chain.join('  <-  ');
    paths[key] = (paths[key] || 0) + us;
}
console.log(`${(total / 1e6).toFixed(1)}s total in /${pattern}/`);
for (const [k, v] of Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${((100 * v) / total).toFixed(0).padStart(3)}%  ${k}`);
