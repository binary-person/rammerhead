// fixes <a target="_top" /> from replacing the top level iframe if it's being used like that

const DomProcessor = require('testcafe-hammerhead/lib/processing/dom/index.js');

// https://github.com/DevExpress/testcafe-hammerhead/blob/29a73b4551a92825b6049eb49796f701b14730d7/src/processing/dom/index.ts#L584
// we're rewriting the entire thing to fit our use case because we aren't going to use this pattern
// anyway, since we're always going to enable allowMultipleWindows
DomProcessor.prototype._processTargetBlank = function (el, _urlReplacer, pattern) {
  if (!pattern.targetAttr)
    return;

  const storedTargetAttr = DomProcessor.getStoredAttrName(pattern.targetAttr);
  const processed = this.adapter.hasAttr(el, storedTargetAttr);

  if (processed)
    return;

  let attrValue = this.adapter.getAttr(el, pattern.targetAttr);

  // NOTE: Value may have whitespace.
  attrValue = attrValue && attrValue.replace(/\s/g, '');

  if (!this.adapter.isIframe) {
    // if page isn't an iframe + wants a link to _top, then it wants to jump out
    // to the top frame instead of nicely modifying itself.
    if (attrValue === '_top') {
      this.adapter.setAttr(el, pattern.targetAttr, '_self');
      this.adapter.setAttr(el, storedTargetAttr, attrValue);
    }
  } else {
    // if page is in a frame and wants a link to top, it's usually to change its parent navigation parent.
    // there will be one case where this solution doesn't work, where the parent isn't actually the "top"
    if (attrValue === '_top') {
      this.adapter.setAttr(el, pattern.targetAttr, '_parent');
      this.adapter.setAttr(el, storedTargetAttr, attrValue);
    }
  }
};