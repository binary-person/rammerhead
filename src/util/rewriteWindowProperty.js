// referenced from https://github.com/DevExpress/testcafe-hammerhead/blob/7f4279821c8754323fdc7fd6659ebeea45d15131/src/processing/script/instrumented.ts

const instrumented = require('testcafe-hammerhead/lib/processing/script/instrumented.js');

const PROPERTIES = [
  'top',
  'parent',
  'frameElement',
  'stackTraceLimit',
  'href',
  'location',
];

const INSTRUMENTED_PROPERTY_RE = new RegExp(`^(${PROPERTIES.join('|')})$`);
const reTest = RegExp.prototype.test;
const test = (regexp, str) => regexp.test ? regexp.test(str) : reTest.call(regexp, str);

instrumented.shouldInstrumentProperty = function (name) {
  return test(INSTRUMENTED_PROPERTY_RE, String(name));
}
