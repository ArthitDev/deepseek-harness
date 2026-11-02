var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import z from '@deepseek-ai/schemastery';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { entryListProblem } from "./definition.js";
import { auditRows, mountPreset, standingMountFor, serviceForAgent } from "./mount.js";
import { definitionComposition, mountedCompositionRows } from "./composition-inventory.js";
export { entryListProblem } from "./definition.js";
export { auditRows, livePresetMounts, leakedServices, serviceForAgent, standingMountFor } from "./mount.js";
/** Registry of YAML-declared presets and the revisions live Agents retain. */
let AgentPresetRegistry = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _remoteExportList_decorators;
    let _select_decorators;
    return class AgentPresetRegistry extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _remoteExportList_decorators = [Remote('list')];
            _select_decorators = [Remote('select')];
            __esDecorate(this, null, _remoteExportList_decorators, { kind: "method", name: "remoteExportList", static: false, private: false, access: { has: obj => "remoteExportList" in obj, get: obj => obj.remoteExportList }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _select_decorators, { kind: "method", name: "select", static: false, private: false, access: { has: obj => "select" in obj, get: obj => obj.select }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        config = __runInitializers(this, _instanceExtraInitializers);
        static inject = ['loader', 'sessionProjections'];
        static Config = z.object({
            default: z.string().required(),
            selectedDefault: z.string().volatile(),
            modeSelectionEnabled: z.boolean().default(true).volatile(),
            models: z.dict(z.dict(z.string())).volatile(),
        });
        owner;
        definitions = new Map();
        generations = new Map();
        bindings = new WeakMap();
        switches = new Map();
        constructor(ctx, config) {
            super(ctx, 'agentPresetRegistry', { namespace: 'agentPresetRegistry' });
            this.config = config;
            this.owner = ctx;
            ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)); });
        }
        /** Default preset for a subsequently created session. */
        get defaultId() { return this.policy().defaultId; }
        policy() {
            const enabled = this.config.modeSelectionEnabled.get();
            return { enabled, defaultId: enabled ? this.config.selectedDefault.get() ?? this.config.default : this.config.default };
        }
        /**
         * Resolve the preset configured for one model route.
         * @param provider - model provider route.
         * @param model - model identifier within the provider.
         * @returns the route override, or the current default preset when unbound.
         */
        presetIdForModel(provider, model) {
            const policy = this.policy();
            if (!policy.enabled)
                return policy.defaultId;
            return this.config.models?.get()?.[provider]?.[model] ?? policy.defaultId;
        }
        /** Register and eagerly load a definition; activation failure remains visible in the roster.
         * @param definition Parsed configuration supplied by the declaring plugin.
         * @returns Definition disposer after activation or its diagnostic settles; the declaring plugin owns it.
         */
        async register(definition) {
            const context = this.ctx;
            if (!definition.id.trim())
                throw new Error('Preset id must not be empty');
            if (this.definitions.has(definition.id))
                throw new Error(`Duplicate agent preset: ${definition.id}`);
            const record = { config: definition, context, ready: Promise.resolve() };
            this.definitions.set(definition.id, record);
            let disposed = false;
            const unregister = async () => {
                if (disposed)
                    return;
                disposed = true;
                this.definitions.delete(definition.id);
                await record.ready;
                if (record.generation !== undefined) {
                    record.generation.retired = true;
                    await this.collect(record.generation);
                }
            };
            record.ready = this.activate(record);
            await record.ready;
            return unregister;
        }
        async activate(record) {
            const key = {};
            const scope = createScope(this.owner, key);
            try {
                const problem = entryListProblem(record.config.plugins);
                if (problem !== undefined)
                    throw new Error(problem);
                const context = scope.ctx.extend({ baseUrl: record.context.baseUrl });
                const mount = await mountPreset(context, record.config.id, record.config.plugins);
                const generation = { scope, key, mount, users: 0, retired: false };
                this.generations.set(key, generation);
                record.generation = generation;
            }
            catch (error) {
                record.broken = error.message;
                this.owner.logger.warn(`agent preset ${record.config.id}: ${record.broken}`);
                await scope.dispose();
            }
        }
        /**
         * Current activation diagnostic of a definition.
         *
         * A mount failure is final. A mounted tree is re-audited on every read: a
         * row waiting for a Host service activates by itself once that provider
         * finishes, so the audit waits for the Host Loader tree to settle before
         * reporting the row as unusable. Callers therefore must not run inside a
         * Host row's own activation, which the settlement would wait on.
         * @param record - the definition to audit.
         * @returns one line per unusable row, or undefined when the definition is usable.
         */
        async diagnostic(record) {
            await record.ready;
            if (record.generation === undefined)
                return record.broken;
            const tree = record.generation.mount.tree;
            let audit = await auditRows(tree);
            if (audit.pending.length > 0) {
                await this.owner.loader.await();
                audit = await auditRows(tree);
            }
            const lines = [...audit.failed, ...audit.pending];
            return lines.length === 0 ? undefined : lines.join('\n');
        }
        async collect(generation) {
            if (!generation.retired || generation.users !== 0)
                return;
            this.generations.delete(generation.key);
            await generation.scope.dispose();
        }
        /** Read every declared preset, including activation failures.
         * @returns Display metadata and loading diagnostics.
         */
        async list() {
            const rows = await Promise.all([...this.definitions.values()].map(async (record) => {
                const broken = await this.diagnostic(record);
                return {
                    id: record.config.id,
                    ...(record.config.name === undefined ? {} : { name: record.config.name }),
                    ...(record.config.description === undefined ? {} : { description: record.config.description }),
                    ...(record.config.order === undefined ? {} : { order: record.config.order }),
                    ...(broken === undefined ? {} : { broken }),
                };
            }));
            return rows.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id));
        }
        /** Read the selection roster and chooser policy.
         * @returns Current presets, default and chooser policy.
         */
        async remoteExportList() {
            const policy = this.policy();
            return {
                presets: (await this.list()).map(row => ({ ...row, isDefault: row.id === policy.defaultId })),
                authorable: false,
                modeSelectionEnabled: policy.enabled,
                models: [],
                modelPresets: {},
            };
        }
        /** Resolve an identity without starting an Agent.
         * @param id Explicit preset or the current default.
         * @returns Current metadata, including failure when activation failed.
         */
        async resolve(id) {
            const wanted = id ?? this.defaultId;
            const record = this.definitions.get(wanted);
            if (record === undefined)
                throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`, { agentPreset: wanted, available: [...this.definitions.keys()] });
            const broken = await this.diagnostic(record);
            return { id: wanted, ...(broken === undefined ? {} : { broken }) };
        }
        async retain(id) {
            const wanted = id ?? this.defaultId;
            while (true) {
                const record = this.definitions.get(wanted);
                if (record === undefined)
                    throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`, { agentPreset: wanted, available: [...this.definitions.keys()] });
                const broken = await this.diagnostic(record);
                if (this.definitions.get(wanted) !== record)
                    continue;
                const generation = record.generation;
                if (broken !== undefined || generation === undefined) {
                    const reason = broken;
                    throw new RemoteError('agent-preset/invalid', reason, { agentPreset: wanted, reason });
                }
                generation.users++;
                return generation;
            }
        }
        async bind(ctx, generation) {
            const key = scopeOf(ctx);
            if (key === undefined)
                throw new Error('Agent preset binding requires a scoped context');
            const binding = this.bindings.get(key);
            if (binding?.generation === generation)
                return;
            if (binding !== undefined) {
                binding.parent.rebind(generation.key);
                const old = binding.generation;
                generation.users++;
                binding.generation = generation;
                old.users--;
                await this.collect(old);
            }
            else
                this.join(ctx, key, generation);
        }
        join(ctx, key, generation) {
            const binding = { parent: bindScopeParent(key, generation.key), generation };
            generation.users++;
            this.bindings.set(key, binding);
            ctx.effect(() => async () => {
                this.bindings.delete(key);
                binding.generation.users--;
                await this.collect(binding.generation);
            }, 'agent-preset.binding');
        }
        /** Bind an unpublished Agent to the current preset revision.
         * @param ctx Agent context from its setup callback.
         * @param id Requested preset, or the default.
         * @returns Bound preset identity.
         */
        async mount(ctx, id) {
            const generation = await this.retain(id);
            try {
                await this.bind(ctx, generation);
                return { id: generation.mount.presetId };
            }
            finally {
                generation.users--;
                await this.collect(generation);
            }
        }
        /** Join a child to the exact revision retained by its parent.
         * @param ctx Child Agent context.
         * @param parent Parent Agent context.
         * @returns Inherited preset id, or undefined in a preset-free composition.
         */
        composeFrom(ctx, parent) {
            const mounted = standingMountFor(parent);
            if (mounted === undefined)
                return undefined;
            const generation = this.generations.get(mounted.key);
            if (generation === undefined)
                throw new Error('Parent preset revision is unavailable');
            // A child has no existing binding, so this path has no asynchronous cleanup.
            const key = scopeOf(ctx);
            if (key === undefined)
                throw new Error('Child preset binding requires a scope');
            if (this.bindings.has(key))
                throw new Error('Child already joined a preset');
            this.join(ctx, key, generation);
            return mounted.presetId;
        }
        /** Read the preset a live Agent uses.
         * @param ctx Agent context.
         * @returns Its preset id, if bound.
         */
        composedPreset(ctx) { return standingMountFor(ctx)?.presetId; }
        /** Read a service supplied inside an Agent's isolated preset group.
         * @param agent Agent whose composition is queried.
         * @param name Cordis service name.
         * @returns The service, or undefined.
         */
        serviceFor(agent, name) {
            return serviceForAgent(this.owner, agent, name);
        }
        /** Rebind a blank Agent; the caller owns the blank-session check.
         * @param ctx Agent context.
         * @param id Requested preset.
         * @returns The bound identity.
         */
        async recompose(ctx, id) {
            const preset = await this.mount(ctx, id);
            try {
                this.owner.emit('tools/change');
            }
            catch (error) {
                this.owner.logger.warn(`Preset tools observer: ${String(error)}`);
            }
            return preset;
        }
        /** Select a preset before a session starts its first turn.
         * @param agent Target Agent.
         * @param agentPreset Requested identity.
         * @returns Committed preset identity.
         */
        async select(agent, agentPreset) {
            const turn = (this.switches.get(agent.id) ?? Promise.resolve()).then(async () => {
                const boundary = this.owner.sessionProjections.stateOf(agent.session, 'turnBoundary');
                if (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) {
                    throw new RemoteError('agent-preset/locked', 'This session has already started', { sessionId: agent.id, agentPreset });
                }
                const preset = await this.recompose(agent.ctx, agentPreset);
                agent.session.append('agent-preset/selected', { agentPreset: preset.id });
                return preset.id;
            });
            const guard = turn.catch(() => undefined);
            this.switches.set(agent.id, guard);
            try {
                return await turn;
            }
            finally {
                if (this.switches.get(agent.id) === guard)
                    this.switches.delete(agent.id);
            }
        }
        /** Read current registrations for cold transcript presentation.
         * @param id Preset identity or the default.
         * @returns A revision lease; dispose it after the scoped read completes.
         */
        async acquireScope(id) {
            const generation = await this.retain(id);
            let disposed = false;
            return { key: generation.key, [Symbol.asyncDispose]: async () => {
                    if (disposed)
                        return;
                    disposed = true;
                    generation.users--;
                    await this.collect(generation);
                } };
        }
        /** Read plugin rows without creating an Agent.
         * @returns Current declaration metadata and activation states.
         */
        compositionInventory() {
            return Promise.all([...this.definitions.values()].map(async (record) => {
                const { id, name, description } = record.config;
                const broken = await this.diagnostic(record);
                const read = definitionComposition(record.config.plugins, () => { throw new Error('Inactive definition'); });
                return { id, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
                    isDefault: id === this.defaultId,
                    ...(broken === undefined ? {} : { broken }),
                    rows: record.generation === undefined ? ('rows' in read ? read.rows : []) : mountedCompositionRows(record.generation.mount.tree) };
            }));
        }
    };
})();
export { AgentPresetRegistry };
export default AgentPresetRegistry;
//# sourceMappingURL=index.js.map