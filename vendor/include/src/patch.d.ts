import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader';
import { type Journal } from './journal.ts';
export interface PatchOptions {
    id?: string;
    insert?: EntryOptions[];
    name?: string;
    config?: any;
    group?: boolean | null;
    disabled?: boolean | null;
    inject?: any;
    intercept?: any;
    isolate?: any;
    [key: string]: any;
}
export type Warn = (format: string, ...args: any[]) => void;
/** Give every entry (nested groups included) an id, in place. */
export declare function ensureIds(entries: EntryOptions[], used: (id: string) => boolean): void;
/** Runtime changes are routed back to an inserted entry by its id, so every insert needs one. */
export declare function ensureInsertIds(patches: PatchOptions[] | undefined, used: (id: string) => boolean): void;
/**
 * Overlay `patches` onto a fresh clone of `data`. Inserted entries are cloned
 * too, so the tree owns every object it mounts.
 */
export declare function applyPatches(data: EntryOptions[], patches: PatchOptions[] | undefined, warn: Warn): EntryOptions[];
/**
 * Who owns an entry, or one key of it, in the patched tree: the file, a patch
 * that overrides that key (the last one wins), or the patch that inserted the
 * whole entry.
 */
export type EntryOwner = EntryOwner.File | EntryOwner.Patch | EntryOwner.Insert;
export declare namespace EntryOwner {
    interface File {
        type: 'file';
    }
    interface Patch {
        type: 'patch';
        /** Index into the patch list. */
        index: number;
    }
    interface Insert {
        type: 'insert';
        /** Index into the patch list. */
        index: number;
        /** The insert list (or nested group config) holding the entry. */
        list: EntryOptions[];
        options: EntryOptions;
        /** The group the entry is inserted into (`null` for the root). */
        parent: string | null;
    }
}
export declare class PatchIndex {
    patches: PatchOptions[];
    private keys;
    private inserts;
    constructor(patches: PatchOptions[]);
    /** Owner of the entry as a whole. */
    entry(id: string | null): EntryOwner;
    /** Owner of one key of an entry. */
    key(id: string, key: string): EntryOwner;
    fileOwned(id: string, key: string | null): boolean;
}
/**
 * Route a journal to its owners: file-owned changes are applied to `data`,
 * patch-owned ones to `patches`. Both are mutated in place, so pass clones.
 * Returns whether any patch changed.
 */
export declare function routeJournal(journal: Journal, data: EntryOptions[], patches: PatchOptions[], warn: Warn): boolean;
//# sourceMappingURL=patch.d.ts.map