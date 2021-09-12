const RammerheadSession = require('./RammerheadSession');
const RammerheadSessionAbstractStore = require('./RammerheadSessionAbstractStore');
const logger = require('../util/logger');

/**
 * perfect for slow disk servers but high amounts of ram.
 * not good for load balancing.
 */
class RammerheadSessionMemoryStore extends RammerheadSessionAbstractStore {
    /**
     * @param {object} options
     * @param {number|null} options.staleTimeout - if inactivity goes beyond this, then the session is deleted. null to disable
     * @param {number|null} options.maxToLive - if now - createdAt surpasses maxToLive, then the session is deleted. null to disable
     * @param {number} options.cleanupInterval - every cleanupInterval ms will run a cleanup check
     */
    constructor({
        staleTimeout = 1000 * 60 * 30, // 30 minutes
        maxToLive = 1000 * 60 * 60 * 4, // 4 hours
        cleanupInterval = 1000 * 60 * 1 // 1 minute
    } = {}) {
        super();
        this.mapStore = new Map();
        setInterval(() => this._cleanupRun(staleTimeout, maxToLive), cleanupInterval).unref();
    }

    keys() {
        return Array.from(this.mapStore.keys());
    }
    has(id) {
        const exists = this.mapStore.has(id);
        logger.debug(`(MemoryStore.has) ${id} ${exists}`);
        return exists;
    }
    get(id, updateActiveTimestamp = true) {
        if (!this.has(id)) return;
        logger.debug(`(MemoryStore.get) ${id} ${updateActiveTimestamp}`);

        const session = this.mapStore.get(id);
        if (updateActiveTimestamp) session.updateLastUsed();

        return session;
    }
    add(id) {
        if (this.has(id)) throw new Error('the following session already exists: ' + id);
        logger.debug(`(MemoryStore.add) ${id}`);
        const session = new RammerheadSession({ id });
        this.mapStore.set(id, session);
        return session;
    }
    delete(id) {
        return this.mapStore.delete(id);
    }

    /**
     * @private
     * @param {number|null} staleTimeout
     * @param {number|null} maxToLive
     */
    _cleanupRun(staleTimeout, maxToLive) {
        logger.debug(`(MemoryStore._cleanupRun) cleanup run. Need to go through ${this.mapStore.size} sessions`);

        const now = Date.now();
        for (const [sessionId, session] of this.mapStore) {
            if (
                (staleTimeout && now - session.lastUsed > staleTimeout) ||
                (maxToLive && now - session.createdAt > maxToLive)
            ) {
                this.mapStore.delete(sessionId);
                logger.debug(`(MemoryStore._cleanupRun) delete ${sessionId}`);
            }
        }

        logger.debug('(MemoryStore._cleanupRun) finished cleanup run');
    }
}

module.exports = RammerheadSessionMemoryStore;
