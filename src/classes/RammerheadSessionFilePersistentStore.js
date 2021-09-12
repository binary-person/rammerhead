const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');
const RammerheadSessionAbstractStore = require('./RammerheadSessionAbstractStore');
const RammerheadSession = require('./RammerheadSession');
const ObjectFileStore = require('../util/ObjectFileDatabase');
const logger = require('../util/logger');

const sessionFolderExtension = '.rhsession';

/**
 * perfect for load balancing because they share the same session data.
 * not good for servers that have slow disk iops speeds. A downside to this is
 * there will be race conditions that will happen when the workers access the data. So
 * occasionally, there will inevitably be thrown errors here and there.
 * Also, while testing, "expiryTime is not a function" has been encountered. Although this is still speculation and
 * further investigation is required, this is subject to the limitations of ObjectFileStore, which don't instantiate
 * an object class correctly. Though this is likely not the case since the memstore of tough-cookie uses it like a regular object,
 * (see https://github.com/salesforce/tough-cookie/blob/1b25269dbb0478232f910c26386b3cac4ec9d857/lib/memstore.js#L42)
 * further work needs to be put in. tl;dr: this sessionstore class is unreliable and can break randomly.
 */
class RammerheadSessionFilePersistentStore extends RammerheadSessionAbstractStore {
    /**
     *
     * @param {object} options
     * @param {string} options.saveDirectory - all sessions will be saved in this folder
     * to avoid storing all the sessions in the memory.
     * @param {number} options.unloadMemoryTimeout - timeout before unloading cached session (cached meaning cached folder structure)
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
        unloadMemoryInterval = 1000 * 60 * 5, // 5 minutes
        cleanupOptions = {
            staleTimeout: 1000 * 60 * 60 * 24 * 1, // 1 day
            maxToLive: 1000 * 60 * 60 * 24 * 4, // four days
            cleanupInterval: 1000 * 60 * 60 * 1 // 1 hour
        }
    } = {}) {
        super();
        this.saveDirectory = saveDirectory;
        this.cachedSessions = new Map();
        setInterval(() => this._unloadMemoryRun(unloadMemoryTimeout), unloadMemoryInterval).unref();
        if (cleanupOptions) {
            setInterval(
                () => this._cleanupRun(cleanupOptions.staleTimeout, cleanupOptions.maxToLive),
                cleanupOptions.cleanupInterval
            ).unref();
        }
    }

    keys() {
        return fs
            .readdirSync(this.saveDirectory)
            .filter((folder) => folder.endsWith(sessionFolderExtension))
            .map((folder) => folder.slice(0, -sessionFolderExtension.length));
    }
    has(id) {
        return fs.existsSync(this._getSessionFolderPath(id));
    }
    get(id, updateActiveTimestamp = true) {
        if (!this.has(id)) {
            logger.debug(`(FilePersistentStore.get) ${id} does not exist`);
            return;
        }

        logger.debug(`(FilePersistentStore.get) ${id}`);
        if (this.cachedSessions.has(id)) {
            logger.debug(`(FilePersistentStore.get) returning memory cached session ${id}`);
            return this.cachedSessions.get(id);
        }

        const fileDatabase = new ObjectFileStore({
            handler: this._getSessionFolderPath(id)
        });
        const session = new RammerheadSession({ id, dontConnectToData: true });
        session.data = fileDatabase.fileObject;
        session.connectHammerheadToData();

        if (updateActiveTimestamp) {
            logger.debug(`(FilePersistentStore.get) ${id} update active timestamp`);
            session.updateLastUsed();
        }

        this.cachedSessions.set(id, session);
        logger.debug(`(FilePersistentStore.get) saved ${id} into cache memory`);

        return session;
    }
    add(id) {
        if (this.has(id)) throw new Error(`session ${id} already exists`);

        fs.mkdirSync(this._getSessionFolderPath(id));

        logger.debug(`FilePersistentStore.add ${id}`);

        return this.get(id);
    }
    delete(id) {
        logger.debug(`(FilePersistentStore.delete) deleting ${id}`);
        if (this.has(id)) {
            rimraf.sync(this._getSessionFolderPath(id));
            this.cachedSessions.delete(id);
            logger.debug(`(FilePersistentStore.delete) deleted ${id}`);
            return true;
        }
        if (this.cachedSessions.has(id)) {
            this.cachedSessions.delete(id);
            logger.debug(`(FilePersistentStore.delete) removed ${id} from cache memory`);
        }
        logger.debug(`(FilePersistentStore.delete) ${id} does not exist`);
        return false;
    }

    /**
     * @private
     * @param {string} id
     * @returns {string} - generated folder path to session
     */
    _getSessionFolderPath(id) {
        return path.join(this.saveDirectory, id.replace(/\/|\\/g, '') + sessionFolderExtension);
    }
    /**
     * @private
     * @param {number|null} staleTimeout
     * @param {number|null} maxToLive
     */
    _cleanupRun(staleTimeout, maxToLive) {
        const sessionIds = this.keys();
        let deleteCount = 0;
        logger.debug(`(FilePersistentStore._cleanupRun) Need to go through ${sessionIds.length} sessions`);

        const now = Date.now();
        for (const id of sessionIds) {
            const session = this.get(id, false);
            if (
                (staleTimeout && now - session.lastUsed > staleTimeout) ||
                (maxToLive && now - session.createdAt > maxToLive)
            ) {
                this.delete(id);
                deleteCount++;
            }
        }

        logger.debug(`(FilePersistentStore._cleanupRun) Deleted ${deleteCount} sessions from store`);
    }
    /**
     * @private
     * @param {number} unloadMemoryTimeout
     */
    _unloadMemoryRun(unloadMemoryTimeout) {
        logger.debug(`(FilePersistentStore._unloadMemoryRun) need to go through ${this.cachedSessions.size} sessions`);

        const now = Date.now();
        for (const [sessionId, session] of this.cachedSessions) {
            // sometimes the session data is already gone, so check for that first
            if (!this.has(sessionId) || now - session.lastUsed > unloadMemoryTimeout) {
                this.cachedSessions.delete(sessionId);
                logger.debug(`(FilePersistentStore._unloadMemoryRun) removed ${sessionId} from memory`);
            }
        }

        logger.debug(`(FilePersistentStore._unloadMemoryRun) finished run`);
    }
}

module.exports = RammerheadSessionFilePersistentStore;
