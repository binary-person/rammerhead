// fix a?.b[key] evaluating key after short-circuiting (broke discord.com/login)
//
// Transform:
// a?.b[key] -->
// (_rh$chainObj => _rh$chainObj == null ? void 0 : __get$(_rh$chainObj, key, true))(a?.b)
//
// also injected into client hammerhead.js by build.js, so keep it self-contained

const transformersMap = require('testcafe-hammerhead/lib/processing/script/transformers/index.js');
const { createComputedPropertyGetWrapper } = require('testcafe-hammerhead/lib/processing/script/node-builder');

function rhLazyOptionalChainKey(node, createGetWrapper) {
    let link = node;
    let canShortCircuit = false;
    while (link && (link.type === 'MemberExpression' || link.type === 'CallExpression')) {
        if (link.optional) {
            canShortCircuit = true;
            break;
        }
        link = link.type === 'MemberExpression' ? link.object : link.callee;
    }
    if (!canShortCircuit) return null;
    // literals and identifiers can't throw
    if (node.property.type === 'Literal' || node.property.type === 'Identifier') return null;

    // await/yield can't move into the arrow function
    const hasAwaitOrYield = (n) => {
        if (!n || typeof n !== 'object') return false;
        if (n.type === 'AwaitExpression' || n.type === 'YieldExpression') return true;
        for (const key in n) {
            if (key !== 'type' && hasAwaitOrYield(n[key])) return true;
        }
        return false;
    };
    if (hasAwaitOrYield(node.property)) return null;

    const obj = { type: 'Identifier', name: '_rh$chainObj' };
    return {
        type: 'CallExpression',
        optional: false,
        callee: {
            type: 'ArrowFunctionExpression',
            id: null,
            params: [obj],
            expression: true,
            async: false,
            generator: false,
            body: {
                type: 'ConditionalExpression',
                test: {
                    type: 'BinaryExpression',
                    operator: '==',
                    left: obj,
                    right: { type: 'Literal', value: null, raw: 'null' }
                },
                consequent: {
                    type: 'UnaryExpression',
                    operator: 'void',
                    prefix: true,
                    argument: { type: 'Literal', value: 0, raw: '0' }
                },
                alternate: createGetWrapper(node.property, obj, true)
            }
        },
        arguments: [node.object]
    };
}

// fix t?.a[k].b throwing after short-circuiting: links after a rewritten key keep the source's plain
// ".b", so regenerate them as "?.b". also injected into client hammerhead.js by build.js
function rhChainContinueTransformers() {
    const hasRewrittenKeyBelow = (node) => {
        let link = node.type === 'MemberExpression' ? node.object : node.callee;
        while (link && (link.type === 'MemberExpression' || link.type === 'CallExpression') && link.optional) {
            if (link.type === 'MemberExpression' && link.computed && link.property.type !== 'Literal') return true;
            link = link.type === 'MemberExpression' ? link.object : link.callee;
        }
        return false;
    };
    return ['MemberExpression', 'CallExpression'].map((nodeTypes) => ({
        name: 'rh-chain-continue',
        nodeReplacementRequireTransform: false,
        nodeTypes,
        condition: (node, parent) => !!parent && node.optional && hasRewrittenKeyBelow(node),
        // same node, so hammerhead's rewrites of its children end up in the output
        run: (node) => {
            node.optional = true;
            return node;
        }
    }));
}
for (const t of rhChainContinueTransformers()) {
    if (!transformersMap.has(t.nodeTypes)) transformersMap.set(t.nodeTypes, []);
    transformersMap.get(t.nodeTypes).push(t);
}

const transformer = (transformersMap.get('MemberExpression') || []).find((t) => t.name === 'computed-property-get');
if (!transformer) {
    throw new Error('new update from hammerhead, must review');
}
const run = transformer.run;
transformer.run = (node) => rhLazyOptionalChainKey(node, createComputedPropertyGetWrapper) || run(node);

module.exports = rhLazyOptionalChainKey;
module.exports.rhChainContinueTransformers = rhChainContinueTransformers;
