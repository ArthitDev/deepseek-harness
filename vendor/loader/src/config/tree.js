var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { composeError } from '@deepseek-ai/cordis';
import { isNonNullable } from '@deepseek-ai/cosmokit';
import { EntryGroup } from "./group.js";
import { createResolve } from "../resolve.js";
/** The entry and the same-tree members of its group, recursively. */
function members(entry) {
    const { tree } = entry.parent;
    const result = [entry];
    const group = entry.subgroup;
    if (group?.tree !== tree)
        return result;
    for (const options of group.data) {
        const member = tree.store[options.id];
        if (member?.parent === group)
            result.push(...members(member));
    }
    return result;
}
/** Mutable tree of loader entries. Persistence is supplied by subclasses. */
export class EntryTree {
    static sep = ':';
    ctx;
    enableLogs;
    root;
    store = Object.create(null);
    constructor(ctx) {
        this.ctx = ctx.extend({ baseUrl: ctx.baseUrl });
        this.root = new EntryGroup(this.ctx, this);
        const entry = this.ctx.fiber.entry;
        if (entry)
            entry.subtree = this;
    }
    get context() {
        return this.ctx;
    }
    /** Iterate entries in this tree and any nested subtrees. */
    *entries() {
        for (const entry of Object.values(this.store)) {
            yield entry;
            if (!entry.subtree)
                continue;
            yield* entry.subtree.entries();
        }
    }
    /** Return pending import and lifecycle tasks owned by this tree. */
    getTasks() {
        return [...this.entries()]
            .map(entry => entry._initTask || entry.fiber?.inertia)
            .filter(isNonNullable);
    }
    /** Wait until this tree has no pending import or lifecycle tasks. */
    async await() {
        while (true) {
            const tasks = this.getTasks();
            if (!tasks.length)
                return;
            await Promise.allSettled(tasks);
        }
    }
    /**
     * Assign a random tree-local id when `options.id` is absent. Explicit ids
     * may contain `EntryTree.sep`; `resolve()` and `resolveGroup()` cannot
     * address such entries by nested path.
     * @param options - Entry options; a generated id is written to `options.id`.
     * @returns The existing or generated id.
     */
    ensureId(options) {
        if (!options.id) {
            do {
                options.id = Math.random().toString(16).slice(2, 10);
            } while (this.store[options.id]);
        }
        return options.id;
    }
    /** Resolve an entry by id, including nested ids separated by `EntryTree.sep`. */
    resolve(id) {
        const parts = id.split(EntryTree.sep);
        let tree = this;
        const final = parts.pop();
        for (const part of parts) {
            tree = tree.store[part]?.subtree;
            if (!tree)
                throw new Error(`cannot resolve entry ${id}`);
        }
        const entry = tree.store[final];
        if (!entry)
            throw new Error(`cannot resolve entry ${id}`);
        return entry;
    }
    resolveGroup(id) {
        if (!id)
            return this.root;
        const entry = this.resolve(id);
        if (!entry.subgroup)
            throw new Error(`entry ${id} is not a group`);
        return entry.subgroup;
    }
    /** Create an entry in the root group or a nested group. */
    async create(options, parent = null, position = Infinity) {
        const group = this.resolveGroup(parent);
        const id = group.tree.ensureId(options);
        group.data.splice(position, 0, options);
        group.tree.commit({ id, group, options: options });
        return group.create(options);
    }
    /** Stop and remove an entry from its parent group. */
    remove(id) {
        const entry = this.resolve(id);
        const group = entry.parent;
        const legacy = entry.options;
        group.remove(legacy.id);
        group.tree.commit({ id: legacy.id, group, legacy });
    }
    /** Update an entry and optionally move it to another group. */
    async update(id, options, parent, position) {
        const entry = this.resolve(id);
        const source = entry.parent;
        const legacy = { ...entry.options };
        if (parent !== undefined) {
            const target = this.resolveGroup(parent);
            const moved = target.tree === source.tree ? [] : members(entry);
            for (const member of moved) {
                const { id } = member.options;
                if (target.tree.store[id])
                    throw new Error(`entry ${id} already exists in the target tree`);
            }
            source.unlink(entry.options);
            target.data.splice(position ?? Infinity, 0, entry.options);
            entry.parent = target;
            // The target tree owns the moved entries from now on, so that it adopts
            // them instead of creating new ones when it reconciles its source.
            for (const member of moved) {
                delete source.tree.store[member.options.id];
                target.tree.store[member.options.id] = member;
                if (member.subgroup?.tree === source.tree)
                    member.subgroup.tree = target.tree;
            }
        }
        // `Entry.update` assigns the new options before its first `await`, so the
        // change is fully visible to `commit()` once the call returns.
        const task = entry.update(options, false, true);
        if (entry.parent.tree !== source.tree) {
            // a move across trees removes the entry from the source tree and
            // creates it in the target tree
            source.tree.commit({ id: legacy.id, group: source, legacy });
            entry.parent.tree.commit({ id: legacy.id, group: entry.parent, options: entry.options });
        }
        else {
            const from = entry.parent === source ? undefined : source;
            entry.parent.tree.commit({ id: legacy.id, group: entry.parent, from, options: entry.options, legacy });
        }
        return task;
    }
    /** Import a plugin module from a specifier or `cordis:` builtin. */
    import(name, getOuterStack) {
        if (name.startsWith('cordis:')) {
            return this.ctx.loader.builtins[name.slice(7)];
        }
        return composeError(async (info) => {
            // ModuleJob.run
            // onImport.tracePromise.__proto__
            // internal.import
            info.offset += 3;
            if (this.ctx.loader.internal) {
                return await this.ctx.loader.internal.import(name, this.ctx.baseUrl, {});
            }
            else if (name.startsWith('.')) {
                return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ new URL(name, this.ctx.baseUrl).href));
            }
            else {
                const resolve = await createResolve(this.ctx.baseUrl);
                const url = resolve ? resolve(name) : name;
                return await import(__rewriteRelativeImportExtension(/* @vite-ignore */ url));
            }
        }, getOuterStack);
    }
}
//# sourceMappingURL=tree.js.map