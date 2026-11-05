import { Service } from '@deepseek-ai/cordis';
import { Entry } from "./entry.js";
/** Runtime owner for a list of child loader entries. */
export class EntryGroup {
    ctx;
    tree;
    static key = Symbol.for('cordis.group');
    data = [];
    constructor(ctx, tree) {
        this.ctx = ctx;
        this.tree = tree;
        const entry = ctx.fiber.entry;
        if (entry)
            entry.subgroup = this;
    }
    get context() {
        return this.ctx;
    }
    async create(options) {
        const id = this.tree.ensureId(options);
        const entry = this.tree.store[id] ??= new Entry(this.ctx.loader);
        // Entry may be moved from another group,
        // so we need to update the parent reference.
        entry.parent = this;
        // Use `create: true` to replace existing entry.options.
        await entry.update(options, true, true);
        return entry.id;
    }
    unlink(options) {
        const config = this.data;
        const index = config.indexOf(options);
        if (index >= 0)
            config.splice(index, 1);
    }
    remove(id, isDispose = false) {
        const entry = this.tree.store[id];
        if (!entry || entry.parent !== this)
            return;
        // Unregister before disposal so Loader can distinguish removal from self-disposal.
        delete this.tree.store[id];
        entry.fiber?.dispose();
        if (!isDispose) {
            this.unlink(entry.options);
        }
        this.context.emit('loader/partial-dispose', entry, entry.options, false);
    }
    async update(config) {
        const oldConfig = this.data;
        this.data = config;
        const oldMap = Object.fromEntries(oldConfig.map(options => [options.id, options]));
        const newMap = Object.fromEntries(config.map(options => [options.id ?? Symbol('anonymous'), options]));
        // update inner plugins
        const ids = Reflect.ownKeys({ ...oldMap, ...newMap });
        await Promise.all(ids.map(async (id) => {
            if (newMap[id]) {
                await this.create(newMap[id]).catch((error) => {
                    this.ctx.logger.error(error);
                });
            }
            else {
                this.remove(id);
            }
        }));
    }
    stop() {
        for (const options of this.data) {
            this.remove(options.id, true);
        }
    }
}
/** Plugin that mounts a nested loader entry group. */
export class Group extends EntryGroup {
    ctx;
    config;
    static initial = [];
    static [EntryGroup.key] = true;
    constructor(ctx, config) {
        super(ctx, ctx.fiber.entry.parent.tree);
        this.ctx = ctx;
        this.config = config;
        ctx.on('internal/update', config => this.update(config));
    }
    async *[Service.init]() {
        yield () => this.stop();
        await this.update(this.config);
    }
}
//# sourceMappingURL=group.js.map