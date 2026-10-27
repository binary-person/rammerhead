const psl = require('psl');

module.exports = function parseRootDomain(url) {
  if (typeof url !== 'string') return null;

  const domain = (url.match(/^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/?\n]+)/) || [])[1];

  if (!domain) return null;

  const parsed = psl.parse(domain);
  if (parsed.error) return null;
  return parsed.domain;
};
