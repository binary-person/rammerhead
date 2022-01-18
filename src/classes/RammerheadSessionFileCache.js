const fs = require('fs');
const path = require('path');
const RammerheadSessionAbstractStore = require('./RammerheadSessionAbstractStore');
const RammerheadSession = require('./RammerheadSession');
const logger = require('../util/logger');

// rh = rammerhead. extra f to distinguish between rhsession (folder) and rhfsession (file)
const sessionFileExtension = '.rhfsession';

class RammerheadSessionFileCache extends RammerheadSessionAbstractStore {
    /**
     *
     * @param {object} options
     * @param {string} options.saveDirectory - all cacheTimeouted sessions will be saved in this folder
     * to avoid storing all the sessions in the memory.
     * @param {number} options.cacheTimeout - timeout before saving cache to disk and deleting it from the cache
     * @param {number} options.cacheCheckInterval
     * @param {object|null} options.staleCleanupOptions - set to null to disable cleaning up stale sessions
     * @param {number|null} options.staleCleanupOptions.staleTimeout - stale sessions that are inside saveDirectory that go over
     * this timeout will be deleted. Set to null to disable.
     * @param {number|null} options.staleCleanupOptions.maxToLive - any created sessions that are older than this will be deleted no matter the usage.
     * Set to null to disable.
     * @param {number} options.staleCleanupOptions.staleCheckInterval
     */
    constructor({
        saveDirectory = path.join(__dirname, '../../sessions'),
        cacheTimeout = 1000 * 60 * 20, // 20 minutes
        cacheCheckInterval = 1000 * 60 * 10, // 10 minutes
        staleCleanupOptions = {
            staleTimeout: 1000 * 60 * 60 * 24 * 1, // 1 day
            maxToLive: 1000 * 60 * 60 * 24 * 4, // four days
            staleCheckInterval: 1000 * 60 * 60 * 1 // 1 hour
        }
    } = {}) {
        super();
        this.saveDirectory = saveDirectory;
        /**
         * @type {Map.<string, RammerheadSession>}
         */
        this.cachedSessions = new Map();
        setInterval(() => this._saveCacheToDisk(cacheTimeout), cacheCheckInterval).unref();
        if (staleCleanupOptions) {
            setInterval(
                () => this._removeStaleSessions(staleCleanupOptions.staleTimeout, staleCleanupOptions.maxToLive),
                staleCleanupOptions.staleCheckInterval
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
            logger.debug(`(FileCache.get) ${id} does not exist`);
            return;
        }

        logger.debug(`(FileCache.get) ${id}`);
        if (this.cachedSessions.has(id)) {
            logger.debug(`(FileCache.get) returning memory cached session ${id}`);
            return this.cachedSessions.get(id);
        }

        const session = RammerheadSession.DeserializeSession(id, fs.readFileSync(this._getSessionFilePath(id)));

        if (updateActiveTimestamp) {
            logger.debug(`(FileCache.get) ${id} update active timestamp`);
            session.updateLastUsed();
        }

        if (cacheToMemory) {
            this.cachedSessions.set(id, session);
            logger.debug(`(FileCache.get) saved ${id} into cache memory`);
        }

        return session;
    }
    add(id) {
        if (this.has(id)) throw new Error(`session ${id} already exists`);

        fs.writeFileSync(this._getSessionFilePath(id), new RammerheadSession().serializeSession());

        logger.debug(`FileCache.add ${id}`);

        return this.get(id);
    }
    delete(id) {
        logger.debug(`(FileCache.delete) deleting ${id}`);
        if (this.has(id)) {
            fs.unlinkSync(this._getSessionFilePath(id));
            this.cachedSessions.delete(id);
            logger.debug(`(FileCache.delete) deleted ${id}`);
            return true;
        }
        logger.debug(`(FileCache.delete) ${id} does not exist`);
        return false;
    }
    close() {
        logger.debug(`(FileCache.close) calling _saveCacheToDisk`);
        this._saveCacheToDisk(-1);
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
    _removeStaleSessions(staleTimeout, maxToLive) {
        const sessionIds = this.keysStore();
        let deleteCount = 0;
        logger.debug(`(FileCache._removeStaleSessions) Need to go through ${sessionIds.length} sessions in store`);

        const now = Date.now();
        for (const id of sessionIds) {
            const session = this.get(id, false);
            if (
                (staleTimeout && now - session.lastUsed > staleTimeout) ||
                (maxToLive && now - session.createdAt > maxToLive)
            ) {
                this.delete(id);
                deleteCount++;
                logger.debug(`(FileCache._removeStaleSessions) deleted ${id}`);
            }
        }

        logger.debug(`(FileCache._removeStaleSessions) Deleted ${deleteCount} sessions from store`);
    }
    /**
     * @private
     * @param {number} cacheTimeout
     */
    _saveCacheToDisk(cacheTimeout) {
        let deleteCount = 0;
        logger.debug(`(FileCache._saveCacheToDisk) need to go through ${this.cachedSessions.size} sessions`);

        const now = Date.now();
        for (const [sessionId, session] of this.cachedSessions) {
            if (now - session.lastUsed > cacheTimeout) {
                fs.writeFileSync(this._getSessionFilePath(sessionId), session.serializeSession());
                this.cachedSessions.delete(sessionId);
                deleteCount++;
                logger.debug(`(FileCache._saveCacheToDisk) removed ${sessionId} from memory and saved to store`);
            }
        }

        logger.debug(`(FileCache._saveCacheToDisk) Removed ${deleteCount} sessions from memory`);
    }
}

module.exports = RammerheadSessionFileCache;
