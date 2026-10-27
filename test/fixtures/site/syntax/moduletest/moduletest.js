if (import.meta.url !== location.href.replace('/importmeta.html', '/moduletest/moduletest.js')) {
  console.log('moduletest: failed import.meta.url test');
}