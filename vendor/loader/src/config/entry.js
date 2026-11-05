import { Context } from '@deepseek-ai/cordis';
import { deepEqual, isNullable, updateVolatile, volatileEntries } from '@deepseek-ai/cosmokit';
import { EntryTree } from "./tree.js";
import { evaluate, isJsExpr } from "./utils.js";
import { equalExceptVolatile } from "./diff.js";
function takeEntries(object, keys) {
    const result = [];
    for (const key of keys) {
        if (!(key in object))
            continue;
        result.push([key, object[key]]);
        delete object[key];
    }
    return result;
}
function sortKeys(object, prepend = ['id', 'name'], append = ['config']) {
    const part1 = takeEntries(object, prepend);
    const part2 = takeEntries(object, append);
    const rest = takeEntries(object, Object.keys(object)).sort(([a], [b]) => a.localeCompare(b));
    return Object.assign(object, Object.fromEntries([...part1, ...rest, ...part2]));
}
/** One configured plugin node inside an `EntryTree`. */
export class Entry {
    loader;
    static key = Symbol.for('cordis.entry');
    ctx;
    fiber;
    /** Raw import result before export normalization; HMR updates it after a successful reload. */
    moduleNamespace;
    parent;
    // safety: call `entry.update()` immediately after creating an entry
    options = {};
    subgroup;
    subtree;
    _initTask;
    constructor(loader) {
        this.loader = loader;
        this.ctx = loader.ctx.extend({ [Entry.key]: this });
        this.context.emit('loader/entry-init', this);
    }
    get context() {
        return this.ctx;
    }
    get id() {
        let id = this.options.id;
        if (this.parent.tree.ctx.fiber.entry) {
            id = this.parent.tree.ctx.fiber.entry.id + EntryTree.sep + id;
        }
        return id;
    }
    /** True when this entry or any owning parent entry is disabled. */
    get disabled() {
        // group is always enabled
        if (this.options.group)
            return false;
        let entry = this;
        do {
            if (this._resolveDisabled(entry.options))
                return true;
            entry = entry.parent.ctx.fiber.entry;
        } while (entry);
        return false;
    }
    /**
     * Effective disabled state: a `!!js` expression evaluates against the loader
     * context. The raw node stays in the options, so write-back keeps the form.
     */
    _resolveDisabled(options) {
        return isJsExpr(options.disabled)
            ? Boolean(this.evaluate(options.disabled.__jsExpr))
            : Boolean(options.disabled);
    }
    evaluate(expr) {
        return evaluate(this.ctx, expr);
    }
    async _patchContext(diff) {
        await this.context.waterfall('loader/patch-context', this, async () => {
            Object.setPrototypeOf(this.ctx, this.parent.ctx);
            if (this.fiber?.uid && (diff.includes('config') || this.options.group)) {
                // A simultaneous context/config edit must restart against the new dependencies.
                const fiber = this.fiber.ctx.fiber;
                for (const name of Object.keys(fiber.inject))
                    fiber._checkImpl(name);
                await fiber.update(this.options.config, true);
            }
        });
    }
    async refresh() {
        if (this.fiber)
            return;
        if (this.disabled)
            return;
        await this.init();
    }
    /** Merge new options, restart as needed, and persist through the parent tree. */
    async update(options, create = false, force = false) {
        const legacy = { ...this.options };
        // step 1: update options
        if (create) {
            this.options = options;
        }
        else {
            for (const [key, value] of Object.entries(options)) {
                if (isNullable(value)) {
                    delete this.options[key];
                }
                else {
                    this.options[key] = value;
                }
            }
        }
        sortKeys(this.options);
        // step 2: execute
        if (this.disabled) {
            await this.fiber?.dispose();
            return;
        }
        // step 3: check if options are changed
        if (this.fiber?.uid) {
            const changes = Object.keys({ ...this.options, ...legacy })
                .filter(key => !deepEqual(this.options[key], legacy[key], key === 'config'));
            // Only an active fiber in an unchanged context takes volatile-only config changes without a remount.
            const volatileOnly = changes.length === 1 && changes[0] === 'config'
                && this.fiber.state === 2 /* FiberState.ACTIVE */ && Object.getPrototypeOf(this.ctx) === this.parent.ctx
                && equalExceptVolatile(legacy.config, this.options.config, this.fiber.runtime?.Config);
            if (volatileOnly)
                this.fiber.rawConfig = this.options.config;
            const pending = volatileOnly && this._commitVolatile() ? [] : changes;
            if (!pending.length && !force)
                return;
            this.context.emit('loader/partial-dispose', this, legacy, true);
            await this._patchContext(pending);
        }
        else {
            await this.init();
        }
    }
    /**
     * Parse a volatile-only raw config change and commit its values into the running fiber's references.
     * An invalid candidate is logged and leaves the running references unchanged; the raw config stays retained for the next activation.
     * @returns `false` when an ordinary effective value changed, so the caller applies the ordinary update lifecycle.
     */
    _commitVolatile() {
        const fiber = this.fiber.ctx.fiber;
        const refs = volatileEntries(fiber.effectiveConfig);
        if (!refs.length)
            return true;
        const raw = this.options.config;
        let candidate;
        try {
            candidate = fiber.resolveConfig(raw);
        }
        catch (error) {
            this.ctx.logger.warn('volatile config update failed for %C', this.options.id);
            this.ctx.logger.warn(error);
            return true;
        }
        if (!deepEqual(fiber.effectiveConfig, candidate, true)) {
            this.ctx.logger.debug('ordinary config values of %C changed with its volatile values; applying the ordinary update', this.options.id);
            return false;
        }
        const paths = refs.flatMap(({ path, ref }) => {
            const source = path.reduce((value, key) => Reflect.get(value, key), candidate);
            if (deepEqual(ref.get(), source.get(), true))
                return [];
            updateVolatile(ref, source);
            return [path];
        });
        if (!paths.length)
            return true;
        const self = Object.create(fiber.ctx);
        self[Context.filter] = (owner) => owner.fiber === fiber;
        try {
            fiber.ctx.emit(self, 'loader/volatile-update', paths);
        }
        catch (error) {
            // A listener failure must not fail the entry update; every value is already committed.
            this.ctx.logger.warn(error);
        }
        return true;
    }
    getOuterStack = () => {
        let entry = this;
        const result = [];
        do {
            result.push(`    at ${entry.parent.tree.ctx.baseUrl}#${entry.options.id}`);
            entry = entry.parent.ctx.fiber.entry;
        } while (entry);
        return result;
    };
    /** Import and start the configured plugin if it is not already running. */
    async init() {
        try {
            await (this._initTask ??= this._init());
        }
        finally {
            this._initTask = undefined;
        }
        this.fiber?.await().catch(() => { }).finally(() => {
            if (this.loader.getTasks().length)
                return;
            this.ctx.reflect.notify(['loader']);
        });
    }
    async _init() {
        let moduleNamespace;
        try {
            moduleNamespace = await this.parent.tree.import(this.options.name, this.getOuterStack);
        }
        catch (error) {
            this.ctx.logger.error(error);
            return;
        }
        const plugin = this.loader.unwrapExports(moduleNamespace);
        await this._patchContext([]);
        this.loader.showLog(this, 'apply');
        this.fiber = this.ctx.registry.plugin(plugin, this.options.config, this.getOuterStack);
        this.moduleNamespace = moduleNamespace;
    }
}
//# sourceMappingURL=entry.js.map