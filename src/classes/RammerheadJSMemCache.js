const LRUCache = require('lru-cache');

class RammerheadJSMemCache {
  constructor(jsCacheSize) {
    this.lru = new LRUCache({
      maxSize: jsCacheSize,
      sizeCalculation: n => n.length || 1
    });
  }
  get(key) {
    this.lru.get(key);
  }
  set(key, value) {
    this.lru.set(key, value);
  }
}

module.exports = RammerheadJSMemCache;
