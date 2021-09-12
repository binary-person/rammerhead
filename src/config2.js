const cluster = require('cluster');
const path = require('path');
const RammerheadSessionFilePersistentStore = require('./classes/RammerheadSessionFilePersistentStore');
const RammerheadSessionMemoryCacheFileStore = require('./classes/RammerheadSessionMemoryCacheFileStore');

// reason for the existence of another config file is to avoid
// the circular dependency problem. if this were to be put in config.js, then the following
// will happen (format: moduleA requires moduleB = moduleA -> moduleB):
// server -> config.js -> MemoryStore -> logger -> config.js -> MemoryStore -> logger,...
// if we were to separate the require portion away from config.js, all is fine
// server -> config.js and server -> config-store.js -> MemoryStore -> logger -> config.js

const saveDirectory = path.join(__dirname, '../sessions');
module.exports = {
    // by default, use file storage if running using multi-server.js to share the session and limiter states
    // across workers. see jsdoc for each storage class for more info on the options
    sessionStore: cluster.isWorker
        ? new RammerheadSessionFilePersistentStore({
              saveDirectory: saveDirectory
              // set cleanupOptions object to null if you don't want to clean up
              // cleanupOptions: null
          })
        : new RammerheadSessionMemoryCacheFileStore({
              saveDirectory: saveDirectory
          }),

    // when user generates an ID and never uses it, we want to clean that up (this is implemented directly in server.js)
    // set either to null to disable
    unusedTimeout: 1000 * 60 * 20, // 20 minutes
    unusedInterval: 1000 * 60 * 10 // 10 minutes
};
