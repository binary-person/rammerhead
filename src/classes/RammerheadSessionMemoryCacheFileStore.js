const fs = require('fs');
const path = require('path');
const RammerheadSessionAbstractStore = require('./RammerheadSessionAbstractStore');
const RammerheadSession = require('./RammerheadSession');
const logger = require('../util/logger');

// rh = rammerhead. extra f to distinguish between rhsession (folder) and rhfsession (file)
const sessionFileExtension = '.rhfsession';

/**
 * This is a compromise between not using that much memory and not needing a high
 * disk IOPs. Essentially gaining the benefit of memory read speeds and while decreasing
 * the usage of memory (basically a cache).
 */
class RammerheadSessionMemoryCacheFileStore extends RammerheadSessionAbstractStore {
    /**
     *
     * @param {object} options
     * @param {string} options.saveDirectory - all unloadMemoryTimeouted sessions will be saved in this folder
     * to avoid storing all the sessions in the memory.
     * @param {number} options.unloadMemoryTimeout - timeout before unloading cached session
     * @param {number} options.unloadMemoryInterval - timeout between unloadMemory runs
     * @param {object|null} options.cleanupOptions - set to null to disable cleaning up stale sessions
     * @param {number|null} options.cleanupOptions.staleTimeout - stale sessions that are inside saveDirectory that go over
     * this timeout will be deleted. Set to null to disable.
     * @param {number|null} options.cleanupOptions.maxToLive - any created sessions that maxToLive < (now - createdAt) will be deleted.
     * Set to null to disable.
     * @param {number} options.cleanupOptions.cleanupInterval - timeout between staleTimeout cleanup runs.
     */
    constructor({
        saveDirectory = path.join(__dirname, '../sessions'),
        unloadMemoryTimeout = 1000 * 60 * 20, // 20 minutes
        unloadMemoryInterval = 1000 * 60 * 10, // 10 minutes
        cleanupOptions = {
            staleTimeout: 1000 * 60 * 60 * 24 * 1, // 1 day
            maxToLive: 1000 * 60 * 60 * 24 * 4, // four days
            cleanupInterval: 1000 * 60 * 60 * 1 // 1 hour
        }
    } = {}) {
        super();
        this.saveDirectory = saveDirectory;
        /**
         * @type {Map.<string, RammerheadSession>}
         */
        this.cachedSessions = new Map();
        setInterval(() => this._unloadMemoryRun(unloadMemoryTimeout), unloadMemoryInterval).unref();
        if (cleanupOptions) {
            setInterval(
                () => this._cleanupRun(cleanupOptions.staleTimeout, cleanupOptions.maxToLive),
                cleanupOptions.cleanupInterval
            ).unref();
        }
    }

    keysStore() {
        return fs
            .readdirSync(this.saveDirectory)
            .filter((file) => file.endsWith(sessionFileExtension))
            .map((file) => file.slice(0, -sessionFileExtension.length));
    }
    keys() {
        let arr = this.keysStore();
        for (const id of this.cachedSessions.keys()) {
            if (!arr.includes(id)) arr.push(id);
        }
        return arr;
    }
    has(id) {
        return this.cachedSessions.has(id) || fs.existsSync(this._getSessionFilePath(id));
    }
    get(id, updateActiveTimestamp = true, cacheToMemory = true) {
        if (!this.has(id)) {
            logger.debug(`(MemoryCacheFileStore.get) ${id} does not exist`);
            return;
        }

        logger.debug(`(MemoryCacheFileStore.get) ${id}`);
        if (this.cachedSessions.has(id)) {
            logger.debug(`(MemoryCacheFileStore.get) returning memory cached session ${id}`);
            return this.cachedSessions.get(id);
        }

        const session = RammerheadSession.DeserializeSession(id, fs.readFileSync(this._getSessionFilePath(id)));

        if (updateActiveTimestamp) {
            logger.debug(`(MemoryCacheFileStore.get) ${id} update active timestamp`);
            session.updateLastUsed();
        }

        if (cacheToMemory) {
            this.cachedSessions.set(id, session);
            logger.debug(`(MemoryCacheFileStore.get) saved ${id} into cache memory`);
        }

        return session;
    }
    add(id) {
        if (this.has(id)) throw new Error(`session ${id} already exists`);

        fs.writeFileSync(this._getSessionFilePath(id), new RammerheadSession().serializeSession());

        logger.debug(`MemoryCacheFileStore.add ${id}`);

        return this.get(id);
    }
    delete(id) {
        logger.debug(`(MemoryCacheFileStore.delete) deleting ${id}`);
        if (this.has(id)) {
            fs.unlinkSync(this._getSessionFilePath(id));
            this.cachedSessions.delete(id);
            logger.debug(`(MemoryCacheFileStore.delete) deleted ${id}`);
            return true;
        }
        logger.debug(`(MemoryCacheFileStore.delete) ${id} does not exist`);
        return false;
    }
    close() {
        logger.debug(`(MemoryCacheFileStore.close) calling _unloadMemoryRun`);
        this._unloadMemoryRun(-1);
    }

    /**
     * @private
     * @param {string} id
     * @returns {string} - generated file path to session
     */
    _getSessionFilePath(id) {
        return path.join(this.saveDirectory, id.replace(/\/|\\/g, '') + sessionFileExtension);
    }
    /**
     * @private
     * @param {number|null} staleTimeout
     * @param {number|null} maxToLive
     */
    _cleanupRun(staleTimeout, maxToLive) {
        const sessionIds = this.keysStore();
        let deleteCount = 0;
        logger.debug(`(MemoryCacheFileStore._cleanupRun) Need to go through ${sessionIds.length} sessions in store`);

        const now = Date.now();
        for (const id of sessionIds) {
            const session = this.get(id, false);
            if (
                (staleTimeout && now - session.lastUsed > staleTimeout) ||
                (maxToLive && now - session.createdAt > maxToLive)
            ) {
                this.delete(id);
                deleteCount++;
                logger.debug(`(MemoryCacheFileStore._cleanupRun) deleted ${id}`);
            }
        }

        logger.debug(`(MemoryCacheFileStore._cleanupRun) Deleted ${deleteCount} sessions from store`);
    }
    /**
     * @private
     * @param {number} unloadMemoryTimeout
     */
    _unloadMemoryRun(unloadMemoryTimeout) {
        let deleteCount = 0;
        logger.debug(`(MemoryCacheFileStore._unloadMemoryRun) need to go through ${this.cachedSessions.size} sessions`);

        const now = Date.now();
        for (const [sessionId, session] of this.cachedSessions) {
            if (now - session.lastUsed > unloadMemoryTimeout) {
                fs.writeFileSync(this._getSessionFilePath(sessionId), session.serializeSession());
                this.cachedSessions.delete(sessionId);
                deleteCount++;
                logger.debug(
                    `(MemoryCacheFileStore._unloadMemoryRun) removed ${sessionId} from memory and saved to store`
                );
            }
        }

        logger.debug(`(MemoryCacheFileStore._unloadMemoryRun) Removed ${deleteCount} sessions from memory`);
    }
}

module.exports = RammerheadSessionMemoryCacheFileStore;
