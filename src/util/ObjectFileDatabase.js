const fs = require('fs');
const path = require('path');
const DeepProxy = require('proxy-deep');
const jsonDateParser = require('json-date-parser');
const rimraf = require('rimraf');
const logger = require('./logger');

/**
 * In noSQL terms, a "file" is a docment and a "folder" is a collection.
 * @typedef {'read'|'write'|'delete'|'has'|'list'|'createFolder'|'isFolder'} DataOperations
 */

/**
 * Any simple objects will be saved to a folder/file style database. If data.prop = {}, it will create a
 * new folder called "prop." If data.prop = [] or data.folder.file = 'data', then it will create a new file named
 * 'file' in the folder 'folder'
 *
 * Note: Yes, a filesystem is a database. We're just using it because there's no other viable
 * synchronous database options
 */
class ObjectFileStore {
    // these are used as object references (`===` comparisons)

    /**
     * @param {string} filePath
     * @param {(path: string) => string} friendlyPath
     */
    static DefaultHandler(filePath, friendlyPath) {
        /**
         * @private
         * @param {DataOperations} operation
         * @param {string[]} pathArr
         * @param {any} value
         * @returns {string|boolean|undefined}
         */
        function handler(operation, pathArr, value) {
            pathArr = pathArr.map((e) => friendlyPath(e)); // take care of slashes in the path
            const fullPath = path.join(filePath, ...pathArr);
            logger.debug(`(ObjectFileDatabase.DefaultHandler) ${operation} on ${fullPath}`);

            switch (operation) {
                case 'read':
                    return JSON.parse(fs.readFileSync(fullPath, 'utf8'), jsonDateParser).data;
                case 'write':
                    return fs.writeFileSync(fullPath, JSON.stringify({ data: value }), 'utf8');
                case 'delete':
                    return rimraf.sync(fullPath);
                case 'has':
                    return fs.existsSync(fullPath);
                case 'list':
                    return fs.readdirSync(fullPath);
                case 'createFolder':
                    return fs.mkdirSync(fullPath, { recursive: true });
                case 'isFolder':
                    return fs.lstatSync(fullPath).isDirectory();
                default:
                    throw new TypeError('unknown operation: ' + operation);
            }
        }
        return handler;
    }

    /**
     * @param {object} options
     * @param {string|(operation: DataOperations, path: string[], value: any) => any} options.handler - when
     * data is read/write, it calls this function. if it is a write operation, value will not be undefined. If this is a string,
     * then it will treat the string as a file path and use the default handler
     * @param {(path: string) => string} options.handlerFriendlyPath - convert illegal filenames like '/' to something else. only used
     * if options.handler is a string. by default, this uses encodeURIComponent
     * @param {number} options.maxFolderDepth - stop recursion errors early when implementing the handler. set to -1 to disable
     * @param {(path: string[], value) => boolean} options.shouldRecursive - for determining whether to traverse further or not
     * @param {(obj) => any} options.convertObjectToFile - all objects passed to the handler will go through this first
     * @param {(file) => any} options.convertFileToObject - all objects received from the handler will go through this first
     */
    constructor({
        handler = ObjectFileStore.DefaultHandler,
        handlerFriendlyPath = encodeURIComponent,
        maxFolderDepth = 20,
        shouldRecursive = () => true,
        convertObjectToFile = (obj) => obj,
        convertFileToObject = (file) => file
    }) {
        this.maxFolderDepth = maxFolderDepth;
        this.shouldRecursive = shouldRecursive;
        this.convertObjectToFile = convertObjectToFile;
        this.convertFileToObject = convertFileToObject;
        if (typeof handler === 'string') {
            this.handler = ObjectFileStore.DefaultHandler(handler, handlerFriendlyPath);
        } else if (typeof handler === 'function') {
            this.handler = handler;
        } else {
            throw new TypeError(
                `handler must be either a string (filepath) or a function handler. received type ${typeof handler}`
            );
        }

        const getProxiedObj = (path) => {
            let obj = this.fileObject;
            for (const eachProp of path) obj = obj[eachProp];
            return obj;
        };
        const self = this;
        this.fileObject = DeepProxy(
            {},
            {
                has(_target, prop) {
                    return self.handler('has', this.path.concat([prop]));
                },
                get(target, prop) {
                    const fullPath = this.path.concat([prop]);

                    if (self.handler('has', fullPath)) {
                        target[prop] = {};
                        if (self.handler('isFolder', fullPath)) {
                            return this.nest(target[prop]);
                        } else {
                            return self.convertFileToObject(self.handler('read', fullPath));
                        }
                    }

                    delete target[prop];
                    return undefined;
                },
                set(target, prop, value) {
                    value = self.convertObjectToFile(value);
                    target[prop] = {};
                    const fullPath = this.path.concat([prop]);
                    if (self.maxFolderDepth !== -1 && fullPath.length > self.maxFolderDepth) {
                        throw new TypeError('max folder depth exceeded');
                    }
                    if (
                        typeof value === 'object' &&
                        value !== null &&
                        !Array.isArray(value) &&
                        !(value instanceof Date) &&
                        self.shouldRecursive(fullPath, value)
                    ) {
                        self.handler('delete', fullPath);
                        self.handler('createFolder', fullPath);
                        const proxiedObj = getProxiedObj(fullPath);
                        for (const eachProp in value) {
                            if (
                                typeof value[eachProp] !== 'function' &&
                                self.shouldRecursive(fullPath, value[eachProp])
                            ) {
                                proxiedObj[eachProp] = value[eachProp];
                            }
                        }
                    } else {
                        if (self.handler('has', fullPath)) {
                            self.handler('delete', fullPath);
                        }
                        self.handler('write', fullPath, value);
                    }
                    return true;
                },
                deleteProperty(target, prop) {
                    const fullPath = this.path.concat([prop]);
                    if (self.handler('has', fullPath)) {
                        self.handler('delete', fullPath);
                        delete target[prop];
                        return true;
                    }
                    return false;
                },
                ownKeys(_target) {
                    return self.handler('list', this.path);
                }
            }
        );
    }
}

module.exports = ObjectFileStore;
