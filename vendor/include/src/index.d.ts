import { type EntryChange, EntryTree, EntryGroup } from '@deepseek-ai/cordis-plugin-loader';
import { Context, Service } from '@deepseek-ai/cordis';
import * as yaml from 'js-yaml';
import { type PatchOptions } from './patch.ts';
/** Shared patch semantics used by config dumps and mounting. */
export { applyPatches as applyEntryPatches } from './patch.ts';
/** Serialized entry patch options. */
export type { PatchOptions } from './patch.ts';
/** YAML dialect preserving child-owned JavaScript expression nodes. */
export declare const entryListSchema: yaml.Schema;
type ConfigStage = 'read' | 'parse' | 'validate';
export declare class ConfigFileError extends Error {
    stage: ConfigStage;
    name: string;
    constructor(stage: ConfigStage, path: string, cause: unknown);
}
export declare namespace Include {
    interface Config {
        path: string;
        initial?: any[];
        patches?: PatchOptions[];
        enableLogs?: boolean;
    }
}
export declare class Include extends EntryTree {
    config: Include.Config;
    static inject: string[];
    static readonly [EntryGroup.key] = true;
    filename: string;
    private type;
    /** The last file state we read or wrote. */
    private cache?;
    /** Tree-side changes that have not reached the file yet. */
    private journal;
    /** Ids we assigned to entries the file leaves anonymous. */
    private anonymous;
    private dirtyRead;
    private dirtyWrite;
    private _draining?;
    /** Only the latest intended tree is ever applied; older ones are skipped. */
    private _pendingTree?;
    private _applyTask?;
    private _disposed;
    private _seq;
    private persistenceError;
    constructor(ctx: Context, config: Include.Config);
    private warn;
    [Service.init](): AsyncGenerator<() => Promise<void>, void, unknown>;
    stop(): Promise<void>;
    /**
     * Resolves once every pending read and write has been processed and the
     * tree reflects the outcome. Retries pending writes and rejects while changes remain unsaved.
     */
    flush(): Promise<void>;
    /** Re-read the file and reconcile the tree with it. */
    refresh(): Promise<void>;
    /** Called synchronously by the loader once a tree-side change is in place. */
    commit(change: EntryChange): void;
    private _drain;
    private _loop;
    private _read;
    private _write;
    /**
     * Write through a temp file and a rename, so that no reader ever sees a
     * truncated file. When `expected` is given, the rename (and every retry of
     * it) only goes ahead while the file still holds that content.
     */
    private _writeText;
    private dump;
    /**
     * Entries the file leaves anonymous get an id here, before the loader sees
     * them. One that looks exactly like an entry we named on the previous read
     * keeps that id, so editing a neighbor does not restart it; anything else
     * gets a fresh id. Assigned ids stay in memory until the next write.
     */
    private _assignIds;
    private _scheduleApply;
}
export default Include;
//# sourceMappingURL=index.d.ts.map