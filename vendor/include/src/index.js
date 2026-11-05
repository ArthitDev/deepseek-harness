import { EntryTree, EntryGroup, isJsExpr } from '@deepseek-ai/cordis-plugin-loader';
import { Service } from '@deepseek-ai/cordis';
import { deepEqual } from '@deepseek-ai/cosmokit';
import { basename, dirname, extname, join } from 'node:path';
import { access, constants, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import { applyJournal, flatten, merge, reconcile, record } from "./journal.js";
import { applyPatches, ensureIds, ensureInsertIds, PatchIndex, routeJournal } from "./patch.js";
/** Shared patch semantics used by config dumps and mounting. */
export { applyPatches as applyEntryPatches } from "./patch.js";
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    resolve: (data) => typeof data === 'string',
    construct: (data) => ({ __jsExpr: data }),
    predicate: isJsExpr,
    represent: (data) => data['__jsExpr'],
});
/** YAML dialect preserving child-owned JavaScript expression nodes. */
export const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr);
const schema = entryListSchema;
const types = {
    '.json': 'application/json',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
};
export class ConfigFileError extends Error {
    stage;
    name = 'ConfigFileError';
    constructor(stage, path, cause) {
        super(`failed to ${stage} config file ${path}`, { cause });
        this.stage = stage;
    }
}
/** The file changed under us between the pre-check and the rename. */
class StaleWriteError extends Error {
    name = 'StaleWriteError';
}
function isENOENT(error) {
    return error?.code === 'ENOENT';
}
const RENAME_RETRIES = 10;
const RENAME_BACKOFF = 20;
/**
 * On Windows a rename over a file that another process holds open (typically
 * an antivirus scanning what we just wrote) fails with one of these; the lock
 * is normally gone within milliseconds. A bounded retry is cheap enough to
 * apply on every platform.
 */
function isTransientRenameError(error) {
    const code = error?.code;
    return code === 'EACCES' || code === 'EPERM' || code === 'EBUSY';
}
export class Include extends EntryTree {
    config;
    static inject = ['loader'];
    // Child entries evaluate their expressions against their own injections.
    static [EntryGroup.key] = true;
    filename;
    type;
    /** The last file state we read or wrote. */
    cache;
    /** Tree-side changes that have not reached the file yet. */
    journal = new Map();
    /** Ids we assigned to entries the file leaves anonymous. */
    anonymous = new Map();
    dirtyRead = false;
    dirtyWrite = false;
    _draining;
    /** Only the latest intended tree is ever applied; older ones are skipped. */
    _pendingTree;
    _applyTask;
    _disposed = false;
    _seq = 0;
    persistenceError;
    constructor(ctx, config) {
        super(ctx);
        this.config = config;
        this.enableLogs = config.enableLogs ?? ctx.fiber.entry?.parent.tree.enableLogs ?? false;
        this.filename = fileURLToPath(new URL(this.config.path, this.ctx.baseUrl));
        const ext = extname(this.filename);
        if (!types[ext]) {
            throw new Error(`extension "${ext}" not supported`);
        }
        this.type = types[ext];
        this.ctx.baseUrl = new URL('.', pathToFileURL(this.filename)).href;
        ensureInsertIds(config.patches, id => !!this.store[id]);
        ctx.on('internal/update', (config, next) => {
            if (config.path !== this.config.path)
                return next();
            this.config = config;
            ensureInsertIds(config.patches, id => !!this.store[id]);
            this._scheduleApply();
            return this._applyTask;
        });
    }
    warn = (format, ...args) => {
        this.ctx.root.logger?.('loader').warn(format, ...args);
    };
    async *[Service.init]() {
        try {
            await this._read();
        }
        catch (error) {
            // only a missing file falls back to `initial`
            const cause = error instanceof ConfigFileError && error.stage === 'read' ? error.cause : undefined;
            if (!isENOENT(cause))
                throw error;
            if (!this.config.initial) {
                throw new Error(`config file not found: ${this.filename}`);
            }
            const initial = structuredClone(this.config.initial);
            ensureIds(initial, id => !!this.store[id]);
            await this._writeText(this.dump(initial));
            await this._read();
        }
        yield () => this.stop();
        await this._applyTask;
    }
    async stop() {
        this._disposed = true;
        this._pendingTree = undefined;
        // Flush what the user last did before the tree goes away; this is also the
        // last attempt for changes a failed write left in the journal.
        if (this.journal.size) {
            this.dirtyWrite = true;
            this._drain();
        }
        try {
            await this.flush();
        }
        finally {
            this.root.stop();
        }
    }
    /**
     * Resolves once every pending read and write has been processed and the
     * tree reflects the outcome. Retries pending writes and rejects while changes remain unsaved.
     */
    async flush() {
        if (this.journal.size && !this._draining) {
            this.dirtyWrite = true;
            this._drain();
        }
        while (this._draining || this._applyTask) {
            await this._draining;
            await this._applyTask;
        }
        if (this.journal.size) {
            throw this.persistenceError ?? new Error(`config file ${this.filename} has ${this.journal.size} unsaved change(s)`);
        }
        this.persistenceError = undefined;
    }
    /** Re-read the file and reconcile the tree with it. */
    refresh() {
        this.dirtyRead = true;
        this._drain();
        return this.flush();
    }
    /** Called synchronously by the loader once a tree-side change is in place. */
    commit(change) {
        this.context.emit('loader/config-update');
        const parent = change.group === this.root ? null : change.group.ctx.fiber.entry.options.id;
        record(this.journal, change, parent);
        this.dirtyWrite = true;
        this._drain();
    }
    _drain() {
        if (this._draining)
            return;
        this._draining = this._loop().finally(() => {
            this._draining = undefined;
        });
    }
    async _loop() {
        while (this.dirtyRead || this.dirtyWrite) {
            if (this.dirtyRead) {
                this.dirtyRead = false;
                try {
                    await this._read();
                }
                catch (error) {
                    // Half-written files are routine while the user is editing, hence
                    // only a warning. With the file in an unknown state there is nothing
                    // safe to write: unless another read is due, stop here and leave
                    // `dirtyWrite` set for the next trigger.
                    this.persistenceError = error;
                    this.ctx.logger.warn(error);
                    if (this.dirtyRead)
                        continue;
                    return;
                }
            }
            if (this.dirtyWrite) {
                this.dirtyWrite = false;
                try {
                    await this._write();
                }
                catch (error) {
                    this.persistenceError = error;
                    this.ctx.logger.error(error);
                }
            }
        }
    }
    async _read() {
        let content;
        try {
            content = await readFile(this.filename, 'utf8');
        }
        catch (error) {
            throw new ConfigFileError('read', this.filename, error);
        }
        if (content === this.cache?.content)
            return;
        let data;
        try {
            data = this.type === 'application/yaml'
                ? yaml.load(content, { schema })
                : JSON.parse(content);
        }
        catch (error) {
            throw new ConfigFileError('parse', this.filename, error);
        }
        // An empty or truncated file (routine mid-edit) parses to `undefined`, so
        // every non-array shape is rejected here as one "invalid file" signal.
        if (!Array.isArray(data)) {
            throw new ConfigFileError('validate', this.filename, new TypeError('config file must be a top-level array'));
        }
        this._assignIds(data);
        if (this.cache) {
            const index = new PatchIndex(this.config.patches ?? []);
            const conflicts = reconcile(this.journal, flatten(this.cache.data), flatten(data), (id, key) => index.fileOwned(id, key));
            for (const { id, reason } of conflicts) {
                this.ctx.logger.error('config conflict in %C: entry %C %s; file wins', this.filename, id, reason);
            }
        }
        this.cache = { content, data };
        this._scheduleApply();
        // the file changed while tree-side changes were pending: write the merge
        if (this.journal.size)
            this.dirtyWrite = true;
    }
    async _write() {
        if (!this.cache || !this.journal.size)
            return;
        const current = await readFile(this.filename, 'utf8').catch((error) => {
            if (isENOENT(error))
                return undefined;
            throw error;
        });
        if (current === undefined) {
            this.ctx.logger.warn('config file %C is missing, %d pending change(s) kept in memory', this.filename, this.journal.size);
            return;
        }
        if (current !== this.cache.content) {
            // someone else wrote the file: merge first, then come back
            this.dirtyRead = true;
            this.dirtyWrite = true;
            return;
        }
        // Snapshot and swap: changes reported while we are writing belong to the
        // next round.
        const batch = this.journal;
        this.journal = new Map();
        const restore = () => {
            for (const [id, record] of this.journal)
                merge(batch, id, record);
            this.journal = batch;
        };
        const data = structuredClone(this.cache.data);
        const patches = structuredClone(this.config.patches ?? []);
        if (routeJournal(batch, data, patches, this.warn)) {
            // Take the new patches now so that the tree scheduled below already
            // reflects them; the round trip through the parent only persists them.
            this.config = { ...this.config, patches };
            if (this.ctx.fiber.entry) {
                // Not awaited: the returned promise is the tree reconciliation, and
                // the drain loop must not block on fibers.
                try {
                    Promise.resolve(this.ctx.fiber.update(this.config)).catch((error) => {
                        this.ctx.logger.error(error);
                    });
                }
                catch (error) {
                    this.ctx.logger.error(error);
                }
            }
            else {
                this.ctx.logger.warn('patches of %C changed at runtime but cannot be persisted', this.filename);
            }
        }
        // nothing for the file itself (patch-only changes, or ids we assigned to
        // anonymous entries that are already part of the cache)
        if (deepEqual(data, this.cache.data)) {
            this._scheduleApply();
            return;
        }
        const text = this.dump(data);
        try {
            await access(this.filename, constants.W_OK);
        }
        catch {
            restore();
            this.ctx.logger.warn('config file %C is read-only, %d pending change(s) kept in memory', this.filename, this.journal.size);
            return;
        }
        try {
            await this._writeText(text, this.cache.content);
        }
        catch (error) {
            restore();
            if (error instanceof StaleWriteError) {
                this.dirtyRead = true;
                this.dirtyWrite = true;
                return;
            }
            this.ctx.logger.warn('failed to write config file %C, %d pending change(s) kept in memory', this.filename, this.journal.size);
            throw error;
        }
        this.cache = { content: text, data };
        this._scheduleApply();
    }
    /**
     * Write through a temp file and a rename, so that no reader ever sees a
     * truncated file. When `expected` is given, the rename (and every retry of
     * it) only goes ahead while the file still holds that content.
     */
    async _writeText(text, expected) {
        const tmp = join(dirname(this.filename), `.${basename(this.filename)}.${process.pid}.${this._seq++}.tmp`);
        try {
            await writeFile(tmp, text);
            for (let attempt = 0;; attempt++) {
                if (expected !== undefined) {
                    const current = await readFile(this.filename, 'utf8').catch((error) => {
                        if (isENOENT(error))
                            return undefined;
                        throw error;
                    });
                    if (current !== expected)
                        throw new StaleWriteError();
                }
                try {
                    await rename(tmp, this.filename);
                    return;
                }
                catch (error) {
                    if (attempt >= RENAME_RETRIES || !isTransientRenameError(error))
                        throw error;
                }
                await sleep(RENAME_BACKOFF * (attempt + 1));
            }
        }
        catch (error) {
            await rm(tmp, { force: true }).catch(() => { });
            throw error;
        }
    }
    dump(data) {
        return this.type === 'application/yaml'
            ? yaml.dump(data, { schema })
            : JSON.stringify(data, null, 2);
    }
    /**
     * Entries the file leaves anonymous get an id here, before the loader sees
     * them. One that looks exactly like an entry we named on the previous read
     * keeps that id, so editing a neighbor does not restart it; anything else
     * gets a fresh id. Assigned ids stay in memory until the next write.
     */
    _assignIds(data) {
        const used = new Set();
        const pending = [];
        const walk = (entries, parent) => {
            for (const options of entries) {
                if (options.id) {
                    used.add(options.id);
                }
                else {
                    pending.push({ options, parent });
                }
                if (options.group && Array.isArray(options.config)) {
                    walk(options.config, options.id ?? null);
                }
            }
        };
        walk(data, null);
        const previous = this.anonymous;
        this.anonymous = new Map();
        for (const { options, parent } of pending) {
            let id;
            for (const [candidate, info] of previous) {
                if (info.parent !== parent || !deepEqual(info.options, options))
                    continue;
                id = candidate;
                previous.delete(candidate);
                break;
            }
            if (!id) {
                do {
                    id = Math.random().toString(16).slice(2, 10);
                } while (used.has(id) || this.store[id]);
            }
            used.add(id);
            this.anonymous.set(id, { parent, options: structuredClone(options) });
            const rest = { ...options };
            for (const key of Object.keys(options))
                delete options[key];
            Object.assign(options, { id }, rest);
        }
    }
    _scheduleApply() {
        if (this._disposed || !this.cache)
            return;
        const tree = applyPatches(this.cache.data, this.config.patches, this.warn);
        this._pendingTree = applyJournal(tree, this.journal, undefined, this.warn);
        this._applyTask ??= (async () => {
            try {
                while (this._pendingTree) {
                    const tree = this._pendingTree;
                    this._pendingTree = undefined;
                    await this.root.update(tree);
                }
            }
            finally {
                this._applyTask = undefined;
            }
        })();
    }
}
export default Include;
//# sourceMappingURL=index.js.map