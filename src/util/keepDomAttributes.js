// keep attributes hammerhead would change in ways pages and anti-bot scripts can notice

const DomProcessor = require('testcafe-hammerhead/lib/processing/dom/index.js');

// hammerhead strips http-equiv and content from csp <meta> tags, leaving a bare <meta>. pages get them
// rewritten (see contentSecurityPolicy.js); anything processed outside a page keeps both with an empty policy
const processMetaElement = DomProcessor.prototype._processMetaElement;
DomProcessor.prototype._processMetaElement = function (el, urlReplacer, pattern) {
    const httpEquiv = (this.adapter.getAttr(el, 'http-equiv') || '').toLowerCase();
    if (httpEquiv === 'content-security-policy') {
        this.adapter.setAttr(el, 'content', '');
        return;
    }
    return processMetaElement.call(this, el, urlReplacer, pattern);
};

// hammerhead adds allow-same-origin and allow-scripts to sandboxed iframes. it needs the first to reach
// into the frame, but not the second: the parent can still run code in a frame without allow-scripts
DomProcessor.prototype._processSandboxedIframe = function (el) {
    const attrValue = this.adapter.getAttr(el, 'sandbox') || '';
    this.adapter.setAttr(el, DomProcessor.getStoredAttrName('sandbox'), attrValue);
    const allowSameOrigin = attrValue.indexOf('allow-same-origin') !== -1;
    this.adapter.setAttr(el, 'sandbox', allowSameOrigin ? attrValue : attrValue + ' allow-same-origin');
};

// hammerhead swaps :hover for an attribute so testcafe can emulate hovering. real users hover, and the
// swapped selector shows up in cssText. also drop the newlines around its markers (see below)
const styleProcessor = require('testcafe-hammerhead/lib/processing/style.js');
const hoverAttr = /\[data-hammerhead-hovered\](\W)/gi;
const processStyle = styleProcessor.process;
styleProcessor.process = function () {
    const css = processStyle.apply(this, arguments);
    if (typeof css !== 'string') return css;
    // and no newlines around hammerhead's markers: a <style>'s innerText turns them into <br>s
    return css
        .replace(hoverAttr, ':hover$1')
        .replace('/*hammerhead|stylesheet|start*/\n', '/*hammerhead|stylesheet|start*/')
        .replace('\n/*hammerhead|stylesheet|end*/', '/*hammerhead|stylesheet|end*/');
};
