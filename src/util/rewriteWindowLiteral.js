// transformer template referenced from
// https://github.com/DevExpress/testcafe-hammerhead/blob/7f4279821c8754323fdc7fd6659ebeea45d15131/src/processing/script/transformers/location-get.ts

const { createIdentifier, createSimpleCallExpression } = require('testcafe-hammerhead/lib/processing/script/node-builder');
const transformersMap = require('testcafe-hammerhead/lib/processing/script/transformers/index.js');

// Transform:
// top, parent, frameElement -->
// __rhget$Top(top), __rhget$Parent(parent), __rhget$FrameElement(frameElement)

const transformer = {
    name: 'rh-get',

    nodeReplacementRequireTransform: false,

    nodeTypes: 'Identifier',

    condition: (node, parent) => {
        if (!parent || (node.name !== 'top' && node.name !== 'parent' && node.name !== 'frameElement'))
            return false;

        // Skip: const top = value;
        if (parent.type === 'VariableDeclarator' && parent.id === node)
            return false;

        // Skip: top = value || function x (top = value) { ... }
        if ((parent.type === 'AssignmentExpression' || parent.type === 'AssignmentPattern') &&
            parent.left === node)
            return false;

        // Skip: function top() {}
        if ((parent.type === 'FunctionExpression' || parent.type === 'FunctionDeclaration') &&
            parent.id === node)
            return false;

        // Skip: object.top || top.field
        if (parent.type === 'MemberExpression' && parent.property === node)
            return false;

        // Skip: { top: value }
        if (parent.type === 'Property' && parent.key === node)
            return false;

        // Skip: { top }
        if (parent.type === 'Property' && parent.value === node && parent.shorthand)
            return false;

        // Skip: top++ || top-- || ++top || --top
        if (parent.type === 'UpdateExpression' && (parent.operator === '++' || parent.operator === '--'))
            return false;

        // Skip: function (top) { ... } || function func(top) { ... } || top => { ... }
        if ((parent.type === 'FunctionExpression' || parent.type === 'FunctionDeclaration' ||
            parent.type === 'ArrowFunctionExpression') && parent.params.indexOf(node) !== -1)
            return false;

        // Skip already transformed: __rhget$Top(top)
        if (parent.type === 'CallExpression' && parent.callee.type === 'Identifier' &&
            parent.callee.name === '__rhget$Top')
            return false;

        // Skip: class X { top () {} }
        if (parent.type === 'MethodDefinition')
            return false;

        // Skip: class top { x () {} }
        if (parent.type === 'ClassDeclaration')
            return false;

        // Skip: function x (...top) {}
        if (parent.type === 'RestElement')
            return false;

        // Skip: export { top } from "module";
        if (parent.type === 'ExportSpecifier')
            return false;

        // Skip: import { top } from "module";
        if (parent.type === 'ImportSpecifier')
            return false;

        // fix class fields named like these breaking the page's script (brave search): class X { parent; top = 1 }
        if ((parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') && parent.key === node && !parent.computed)
            return false;

        // Skip: var x = class top {}
        if (parent.type === 'ClassExpression' && parent.id === node)
            return false;

        // Skip: top: for (...) { break top; continue top; }
        if ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && parent.label === node)
            return false;

        // Skip: catch (top) {}
        if (parent.type === 'CatchClause' && parent.param === node)
            return false;

        // Skip: import top from "module"; import * as top from "module";
        if (parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier')
            return false;

        // Skip: [top] = value || const [top] = value
        if (parent.type === 'ArrayPattern')
            return false;

        // Skip: for (top of list) || for (top in object)
        if ((parent.type === 'ForOfStatement' || parent.type === 'ForInStatement') && parent.left === node)
            return false;

        return true;
    },

    run: function createRHGetWrapper(literal) {
        let rewriteLiteral = '';
        switch (literal.name) {
            case 'top':
                rewriteLiteral = 'Top';
                break;
            case 'parent':
                rewriteLiteral = 'Parent';
                break;
            case 'frameElement':
                rewriteLiteral = 'FrameElement';
                break;
            default:
                console.error('unknown literal: ', literal);
        }
        const getRHIdentifier = createIdentifier('__rhget$' + rewriteLiteral);

        return createSimpleCallExpression(getRHIdentifier, [literal]);
    },
};

transformersMap.get(transformer.nodeTypes).push(transformer);

// build.js puts the same transformer in the client
module.exports = transformer;
