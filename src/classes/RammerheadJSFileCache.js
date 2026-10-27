const fs = require('fs');
const path = require('path');
const cluster = require('cluster');
const LRUCache = require('lru-cache');

class RammerheadJSFileCache {
  constructor(diskJsCachePath, jsCacheSize, maxItems, enableWorkerMode) {
    /**
     * this lru cache will be treated as such: key => jsFileSize
     * when cache item gets evicted, then it will call dispose(), which will
     * delete the actual file.
     * 
     * 
     * enableWorkerMode === true will create a system where
     * master will handle deleting, and writing to cache.
     * it will also tell workers what is and isn't cached.
     * 
     * worker will ask master if file is cached, and retrieve it if it exists.
     * 
     * ids are to keep track which read requests go to whose and resolve the corresponding
     * promises
     */

    this.askPromises = {};
    this.askPromiseId = 0;

    if (!fs.existsSync(diskJsCachePath)) {
      throw new TypeError('disk cache folder does not exist: ' + diskJsCachePath);
    }
    if (!fs.lstatSync(diskJsCachePath).isDirectory()) {
      throw new TypeError('disk cache folder must be a directory: ' + diskJsCachePath);
    }

    this.diskJsCachePath = diskJsCachePath;
    this.enableWorkerMode = enableWorkerMode;
    this.lruMarker = new LRUCache({
      max: maxItems,
      maxSize: jsCacheSize,
      sizeCalculation: n => n || 1,
      dispose(_, key) {
        fs.unlinkSync(path.join(diskJsCachePath, key));
      }
    });

    // multiple workers doing this will cause chaos
    if (!enableWorkerMode || cluster.isMaster) {
      // reinsert already existing cache items, in size order, keeping biggest first (because more size = more compute required)
      // also, atime seems to not work reliably. see https://superuser.com/a/464737
      const initFileList = [];
      for (const file of fs.readdirSync(diskJsCachePath)) {
        if (file === '.gitkeep') continue;
        const stat = fs.statSync(path.join(diskJsCachePath, file));
        initFileList.push({ key: file, size: stat.size });
      }
      initFileList.sort((a, b) => a.size - b.size);

      for (const file of initFileList) {
        if (!file.size) {
          // writing probably got interrupted. so we delete the corrupted file
          fs.unlinkSync(path.join(diskJsCachePath, file.key));
          continue;
        }
        this.lruMarker.set(file.key, file.size, {
          noDisposeOnSet: true
        });
      }
    }

    // handle communication between worker and master.
    if (enableWorkerMode) {
      // rjc = rh-js-cache
      if (cluster.isMaster) {
        cluster.on('fork', worker => {
          worker.on('message', msg => {
            if (!msg || msg.type !== 'rjc') return;
            // fix whole-server crashes: an empty value was taken for a read without an id, and throwing here
            // took down the master. ops are explicit now, and a bad message is dropped
            try {
              if (typeof msg.key !== 'string' || !msg.key) return;
              if (msg.op === 'get') {
                if (typeof msg.id !== 'number' || isNaN(msg.id)) return;
                worker.send({ type: 'rjc', key: msg.key, id: msg.id, exists: !!this.lruMarker.get(msg.key) });
              } else if (msg.op === 'set' && typeof msg.value === 'string' && msg.value) {
                this.set(msg.key, msg.value);
              }
            } catch (e) {
              console.error('(RammerheadJSFileCache) failed handling a worker message', e);
            }
          });
        });
      } else {
        this.lruMarker = null; // make sure we never use this
        process.on('message', msg => {
          if (!msg || msg.type !== 'rjc') return;
          // read-request response
          const resolve = this.askPromises[msg.id];
          if (resolve) resolve(msg.exists === true);
        });
      }
    }
  }
  isWorker() {
    return this.enableWorkerMode && cluster.isWorker;
  }
  async askMasterGet(key) {
    if (!this.isWorker()) {
      throw new TypeError('worker use only');
    }
    const id = this.askPromiseId++;

    process.send({ type: 'rjc', op: 'get', id, key });

    return await new Promise(resolve => {
      this.askPromises[id] = exists => {
        delete this.askPromises[id];
        resolve(exists);
      };
    });
  }
  askMasterSet(key, value) {
    if (!this.isWorker()) {
      throw new TypeError('worker use only');
    }

    process.send({ type: 'rjc', op: 'set', key, value });
  }
  async get(key) {
    if (this.isWorker() ? await this.askMasterGet(key) : this.lruMarker?.get(key)) {
      return fs.readFileSync(path.join(this.diskJsCachePath, key), 'utf-8');
    }
    return undefined;
  }
  set(key, value) {
    if (typeof value !== 'string' || !value) return;
    if (this.isWorker()) {
      this.askMasterSet(key, value);
    } else {
      this.lruMarker.set(key, value.length);
      fs.writeFileSync(path.join(this.diskJsCachePath, key), value, 'utf-8');
    }
  }
}

module.exports = RammerheadJSFileCache;
