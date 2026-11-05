import { deepEqual, omit } from '@deepseek-ai/cosmokit';
export function diffOptions(legacy, options) {
    const changes = {};
    for (const key of new Set([...Object.keys(legacy), ...Object.keys(options)])) {
        if (key === 'id')
            continue;
        if (deepEqual(legacy[key], options[key]))
            continue;
        changes[key] = options[key];
    }
    return changes;
}
/** Fold a later record into an earlier one for the same entry. */
export function mergeRecords(older, newer) {
    if (!older)
        return newer;
    if (newer.kind === 'remove') {
        // an entry created and removed before ever being written leaves no trace
        return older.kind === 'upsert' && older.created ? undefined : newer;
    }
    if (older.kind === 'remove') {
        return { ...newer, created: false };
    }
    const relocated = newer.parent !== undefined;
    return {
        kind: 'upsert',
        created: older.created,
        parent: relocated ? newer.parent : older.parent,
        position: relocated ? newer.position : older.position,
        changes: { ...older.changes, ...newer.changes },
    };
}
export function merge(journal, id, record) {
    const merged = mergeRecords(journal.get(id), record);
    if (merged) {
        journal.set(id, merged);
    }
    else {
        journal.delete(id);
    }
}
export function record(journal, change, parent) {
    const { id, options, legacy } = change;
    if (!options) {
        return merge(journal, id, { kind: 'remove' });
    }
    const position = change.group.data.indexOf(options);
    if (!legacy) {
        return merge(journal, id, { kind: 'upsert', created: true, parent, position, changes: omit(options, ['id']) });
    }
    merge(journal, id, {
        kind: 'upsert',
        created: false,
        parent: change.from ? parent : undefined,
        position,
        changes: diffOptions(legacy, options),
    });
}
/** Index every entry (including nested group members) by id. */
export function flatten(data, parent = null, result = new Map()) {
    data.forEach((options, position) => {
        if (options.id)
            result.set(options.id, { parent, position, options, list: data });
        if (options.group && Array.isArray(options.config)) {
            flatten(options.config, options.id ?? null, result);
        }
    });
    return result;
}
export function applyChanges(options, changes, filter) {
    for (const [key, value] of Object.entries(changes)) {
        if (filter && !filter(key))
            continue;
        if (value === undefined) {
            delete options[key];
        }
        else {
            options[key] = value;
        }
    }
}
export function detach(data, id) {
    const flat = flatten(data).get(id);
    if (!flat)
        return;
    flat.list.splice(flat.list.indexOf(flat.options), 1);
    return flat.options;
}
/**
 * Insert `options` under `parent` (a group id, or `null` for the root) at
 * `position`, clamped to the group's length. Returns false when the parent
 * group does not exist.
 */
export function place(data, options, parent, position) {
    let list = data;
    if (parent !== null) {
        const group = flatten(data).get(parent);
        if (!group?.options.group)
            return false;
        list = group.options.config ??= [];
    }
    list.splice(Math.min(position, list.length), 0, options);
    return true;
}
/**
 * Overlay a journal onto `data` in place. `filter(id, key)` restricts which
 * changes apply; `key` is `null` when asking about the entry as a whole
 * (creation, removal, relocation).
 */
export function applyJournal(data, journal, filter = () => true, warn = () => { }) {
    for (const [id, record] of journal) {
        if (!filter(id, null))
            continue;
        if (record.kind === 'remove') {
            detach(data, id);
            continue;
        }
        const flat = flatten(data).get(id);
        if (!flat) {
            const options = { id };
            applyChanges(options, record.changes, key => filter(id, key));
            const parent = record.parent ?? null;
            if (!place(data, options, parent, record.position)) {
                warn('cannot place entry %C: group %C not found', id, parent);
            }
            continue;
        }
        applyChanges(flat.options, record.changes, key => filter(id, key));
        if (record.parent !== undefined && flat.parent !== record.parent) {
            detach(data, id);
            if (!place(data, flat.options, record.parent, record.position)) {
                warn('cannot move entry %C: group %C not found', id, record.parent);
                place(data, flat.options, flat.parent, flat.position);
            }
        }
    }
    return data;
}
/**
 * Three-way reconciliation of a journal against a new file state. The file
 * wins every conflict: conflicting keys are dropped from the journal so that
 * the tree follows the file, and each drop is reported.
 *
 * `fileOwned(id, key)` scopes the check to what the file can actually express
 * (patch-owned keys and patch-inserted entries live elsewhere).
 */
export function reconcile(journal, base, theirs, fileOwned) {
    const conflicts = [];
    for (const [id, record] of journal) {
        if (!fileOwned(id, null))
            continue;
        const b = base.get(id);
        const t = theirs.get(id);
        if (record.kind === 'remove') {
            if (!t) {
                journal.delete(id);
            }
            else if (!b || !deepEqual(t.options, b.options)) {
                conflicts.push({ id, reason: b ? 'modified in file, removed at runtime' : 'added in file, removed at runtime' });
                journal.delete(id);
            }
            continue;
        }
        if (!t) {
            if (b) {
                conflicts.push({ id, reason: 'removed in file, modified at runtime' });
                journal.delete(id);
            }
            // else: created at runtime, nothing in the file to conflict with
            continue;
        }
        if (record.created)
            record.created = false;
        for (const key of Object.keys(record.changes)) {
            if (!fileOwned(id, key))
                continue;
            const bv = b?.options[key];
            const tv = t.options[key];
            if (deepEqual(bv, tv) || deepEqual(tv, record.changes[key]))
                continue;
            conflicts.push({ id, reason: `key "${key}" modified both in file and at runtime` });
            delete record.changes[key];
        }
        if (record.parent !== undefined && b && t.parent !== b.parent && t.parent !== record.parent) {
            conflicts.push({ id, reason: 'moved both in file and at runtime' });
            record.parent = undefined;
        }
        const moved = record.parent !== undefined && record.parent !== t.parent;
        if (!Object.keys(record.changes).length && !moved) {
            journal.delete(id);
        }
    }
    return conflicts;
}
//# sourceMappingURL=journal.js.map