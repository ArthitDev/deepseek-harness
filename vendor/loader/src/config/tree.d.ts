import { Context } from '@deepseek-ai/cordis';
import { type Dict } from '@deepseek-ai/cosmokit';
import { Entry, type EntryOptions } from './entry.ts';
import { EntryGroup } from './group.ts';
/**
 * One tree-side mutation, reported to `EntryTree.commit()` synchronously after
 * it has been applied to `entry.options` / `group.data`.
 *
 * - `options` absent: the entry was removed from `group`.
 * - `legacy` absent: the entry was created in `group`.
 * - both present: the entry was updated and now lives in `group`; `from` is
 *   the group it left if the update moved it within the same tree. A move to
 *   another tree reports a removal to the source tree and a creation to the
 *   destination tree.
 *
 * `id` is local to the receiving tree; `Entry.id` prefixes it with the parent
 * tree's path. Only `EntryTree` mutation methods and explicit Fiber saves
 * report changes; file-driven `EntryGroup` reconciliation does not.
 */
export interface EntryChange {
    id: string;
    group: EntryGroup;
    from?: EntryGroup;
    options?: EntryOptions;
    legacy?: EntryOptions;
}
/** Mutable tree of loader entries. Persistence is supplied by subclasses. */
export declare abstract class EntryTree {
    static readonly sep = ":";
    ctx: Context;
    enableLogs?: boolean;
    root: EntryGroup;
    store: Dict<Entry>;
    constructor(ctx: Context);
    get context(): Context;
    /** Iterate entries in this tree and any nested subtrees. */
    entries(): Generator<Entry, void, void>;
    /** Return pending import and lifecycle tasks owned by this tree. */
    getTasks(): Promise<void>[];
    /** Wait until this tree has no pending import or lifecycle tasks. */
    await(): Promise<void>;
    /**
     * Assign a random tree-local id when `options.id` is absent. Explicit ids
     * may contain `EntryTree.sep`; `resolve()` and `resolveGroup()` cannot
     * address such entries by nested path.
     * @param options - Entry options; a generated id is written to `options.id`.
     * @returns The existing or generated id.
     */
    ensureId(options: Partial<EntryOptions>): string;
    /** Resolve an entry by id, including nested ids separated by `EntryTree.sep`. */
    resolve(id: string): Entry;
    resolveGroup(id: string | null): EntryGroup;
    /** Create an entry in the root group or a nested group. */
    create(options: Omit<EntryOptions, 'id'>, parent?: string | null, position?: number): Promise<string>;
    /** Stop and remove an entry from its parent group. */
    remove(id: string): void;
    /** Update an entry and optionally move it to another group. */
    update(id: string, options: Omit<EntryOptions, 'id' | 'name'>, parent?: string | null, position?: number): Promise<void>;
    /** Import a plugin module from a specifier or `cordis:` builtin. */
    import(name: string, getOuterStack?: () => string[]): any;
    /** Report an applied mutation synchronously. In-memory trees may use a no-op. */
    abstract commit(change: EntryChange): void;
}
//# sourceMappingURL=tree.d.ts.map