// transformer template referenced from
// https://github.com/DevExpress/testcafe-hammerhead/blob/7f4279821c8754323fdc7fd6659ebeea45d15131/src/processing/script/transformers/location-get.ts

const { createIdentifier, createSimpleCallExpression } = require('testcafe-hammerhead/lib/processing/script/node-builder');
const transformersMap = require('testcafe-hammerhead/lib/processing/script/transformers/index.js');

// Transform:
// import.meta.url -->
// __rhget$IM(import.meta).url

const transformer = {
    name: 'rh-im',

    nodeReplacementRequireTransform: false,

    nodeTypes: 'MetaProperty',

    condition: (node, _parent) => {
        if (node.meta.name === 'import' && node.property.name === 'meta') {
            return true;
        }
        return false;
    },

    run: function createRHGetWrapper(metaProperty) {
        const getRHIdentifier = createIdentifier('__rhget$IM');

        return createSimpleCallExpression(getRHIdentifier, [metaProperty]);
    },
};

if (transformersMap.has(transformer.nodeTypes)) {
    throw new Error('new update from hammerhead, must review');
}
transformersMap.set(transformer.nodeTypes, [transformer]);
