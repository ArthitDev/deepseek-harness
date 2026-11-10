/** Declarative Agent capability sets, activation and session binding. */
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { bindScopeParent, createScope, scopeOf, scopeParentOf, type Scope, type ScopeKey, type ScopeParentBinding } from '@deepseek-ai/dsh-scope'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { dump } from 'js-yaml'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-app-boot'
// Type-only: the optional `settings` service this registry keeps off the generated pages.
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: the optional `llm` and `agentDefaultModel` services the roster reads model routes from.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-tools'
import type { AgentPresetDocument, AgentPresetRoster } from './types.ts'
import { entryListProblem, type PresetDefinition } from './definition.ts'
import type { AgentPreset, Config } from './preset.ts'
import { agentPresetProjectionDefinition } from './session.ts'
import { auditRows, leakedServices, mountPreset, serviceForMount, type PresetMount } from './mount.ts'
import { PresetAuthoring, notWritable, parseComposition } from './authoring.ts'
import { activeCompositionModules, definitionComposition, mountedCompositionRows, type AgentPresetComposition, type AgentPresetInspection } from './composition-inventory.ts'
import type SettingsService from '@deepseek-ai/dsh-settings'

export { agentPresetProjectionDefinition } from './session.ts'
export { entryListProblem, type PresetDefinition } from './definition.ts'
export { auditRows, leakedServices, type PresetMount, type RowAudit } from './mount.ts'
export {
  PresetAuthoring, PRESET_ENTRY_PREFIX, PRESET_ID, PRESET_ROW_NAME, notWritable, parseComposition, presetExists,
} from './authoring.ts'
export type { AgentPresetInspection } from './composition-inventory.ts'
export type { AgentPreset, Config } from './preset.ts'

/** Settings namespace carrying the user's default, mode-selection switch, and per-model presets. */
export const SETTINGS_NAMESPACE = 'agent-preset-registry'

/** Refuse an empty preset id before invoking a domain operation. */
function validatePresetId(value: string, field: 'agentPreset' | 'from'): void {
  if (value.length === 0) {
    throw new RemoteError('gateway/bad-request', `${field} must be a non-empty string`, {})
  }
}

/** Refuse an authoring request aimed at a preset the deployment ships. */
function notWritableSystem(presetId: string): RemoteError<'agent-preset/read-only'> {
  return notWritable(presetId, 'it ships with the deployment; copy it into the profile to change it')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentPresets: AgentPresetRegistry
  }
}

interface Generation {
  scope: Scope
  key: ScopeKey
  mount: PresetMount
  users: number
  retired: boolean
}
interface Definition {
  config: PresetDefinition
  context: Context
  ready: Promise<void>
  generation?: Generation
  /** Mount failure; unset while a tree is mounted, whose rows {@link AgentPresetRegistry.diagnostic} re-audits on read. */
  broken?: string
}
interface Binding {
  parent: ScopeParentBinding
  generation: Generation
}

/** Registry of YAML-declared presets and the revisions live Agents retain. */
export class AgentPresetRegistry extends TypertRemoteService {
  static inject = ['loader', 'sessionProjections', 'agents']
  static Config = z.object({
    default: z.string().required(),
    selectedDefault: z.string().volatile(),
    modeSelectionEnabled: z.boolean().default(true).volatile(),
    showBuiltInPresets: z.boolean().default(true).volatile(),
    models: z.dict(z.dict(z.string())).volatile(),
  })
  private agentPresetProjectionHandle!: ProjectionHandle<string | null>
  private readonly owner: Context
  private readonly definitions = new Map<string, Definition>()
  private readonly generations = new Map<ScopeKey, Generation>()
  private readonly bindings = new WeakMap<ScopeKey, Binding>()
  private readonly switches = new Map<string, Promise<unknown>>()
  private settingsService: SettingsService | undefined

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'agentPresets')
    this.owner = ctx
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.owner
    this.agentPresetProjectionHandle = await ctx.sessionProjections.register(agentPresetProjectionDefinition)
    // The builtin authored preset declarations name: registering it here keeps
    // `cordis:preset` resolvable in exactly the compositions that can author,
    // without depending on the profile's package installation state.
    ctx.effect(() => {
      // The declarative `cordis:preset` row lives in a package the registry
      // must not project-reference (its own row injects agentPresets, closing
      // the reference cycle). Mirror its plugin structurally: the loader only
      // needs the apply/inject/config faces the row already declared.
      const declarationPlugin = PresetAuthoring.declarationPlugin()
      ctx.loader.builtins.preset = declarationPlugin
      return () => {
        if (ctx.loader.builtins.preset === declarationPlugin) delete ctx.loader.builtins.preset
      }
    }, 'agent-preset-registry: cordis:preset builtin')
    ctx.inject(['settings'], (child) => {
      this.settingsService = child.settings
      child.effect(() => {
        const dispose = child.settings.configure({ auto: false }, ctx.fiber)
        return () => {
          dispose()
          this.settingsService = undefined
        }
      })
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'agent-preset/selected') ctx.emit('agent-preset/selected', session.id, event.data.agentPreset)
    })
  }

  /** One internally consistent snapshot of the selection policy. */
  private selectionPolicy(): { enabled: boolean; defaultId: string } {
    const enabled = this.config.modeSelectionEnabled.get() ?? true
    return {
      enabled,
      defaultId: enabled ? this.config.selectedDefault.get() ?? this.config.default : this.config.default,
    }
  }

  /** Default preset for a subsequently created session. */
  get defaultId(): string { return this.selectionPolicy().defaultId }

  /**
   * Resolve the preset configured for one model route.
   * @param provider - model provider route.
   * @param model - provider-owned model id.
   * @returns the route override, or the current default preset when unbound or selection is hidden.
   */
  presetIdForModel(provider: string, model: string): string {
    const policy = this.selectionPolicy()
    if (!policy.enabled) return policy.defaultId
    return this.config.models.get()?.[provider]?.[model] ?? policy.defaultId
  }

  /**
   * Authoring against the active profile's patch, or undefined in a
   * composition no profile launched (nothing is authorable there).
   */
  private get authoring(): PresetAuthoring | undefined {
    const profile = this.owner.get('profileContext')
    return profile === undefined ? undefined : new PresetAuthoring(this.owner, profile)
  }

  /** Whether the active profile accepts authored preset declarations. */
  get authorable(): boolean {
    return this.owner.get('profileContext') !== undefined
  }

  /**
   * Read the preset recorded for a Session, including selections no longer in the roster.
   * @param session - Session whose committed preset selection is read.
   * @returns the recorded preset, or null when none was selected.
   */
  presetForSession(session: Session): string | null {
    return this.agentPresetProjectionHandle.stateOf(session)
  }

  /** Register and eagerly load a definition; activation failure remains visible in the roster.
   * @param definition Parsed configuration supplied by the declaring plugin.
   * @returns Definition disposer after activation or its diagnostic settles; the declaring plugin owns it.
   */
  async register(definition: PresetDefinition): Promise<() => Promise<void>> {
    const context = this.ctx
    if (!definition.id.trim()) throw new Error('Preset id must not be empty')
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
    const record: Definition = { config: definition, context, ready: Promise.resolve() }
    this.definitions.set(definition.id, record)
    let disposed = false
    const unregister = async (): Promise<void> => {
      if (disposed) return
      disposed = true
      this.definitions.delete(definition.id)
      await record.ready
      if (record.generation !== undefined) {
        record.generation.retired = true
        await this.collect(record.generation)
      }
    }
    record.ready = this.activate(record)
    await record.ready
    return unregister
  }

  private async activate(record: Definition): Promise<void> {
    const key = {}
    const scope = createScope(this.owner, key)
    try {
      const problem = entryListProblem(record.config.plugins)
      if (problem !== undefined) throw new Error(problem)
      const context = scope.ctx.extend({ baseUrl: record.context.baseUrl })
      const mount = await mountPreset(context, record.config.id, record.config.plugins)
      const generation: Generation = { scope, key, mount, users: 0, retired: false }
      context.effect(() => {
        this.generations.set(key, generation)
        return () => { this.generations.delete(key) }
      }, 'agent-preset.mount')
      record.generation = generation
    } catch (error) {
      record.broken = (error as Error).message
      this.owner.logger.warn(`agent preset ${record.config.id}: ${record.broken}`)
      await scope.dispose()
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
  private async diagnostic(record: Definition): Promise<string | undefined> {
    await record.ready
    if (record.generation === undefined) return record.broken
    const tree = record.generation.mount.tree
    let audit = await auditRows(tree)
    if (audit.pending.length > 0) {
      await this.owner.loader.await()
      audit = await auditRows(tree)
    }
    const lines = [...audit.failed, ...audit.pending]
    return lines.length === 0 ? undefined : lines.join('\n')
  }

  private async collect(generation: Generation): Promise<void> {
    if (!generation.retired || generation.users !== 0) return
    this.generations.delete(generation.key)
    await generation.scope.dispose()
  }

  private generationFor(ctx: Context): Generation | undefined {
    const key = scopeOf(ctx)
    const parent = key === undefined ? undefined : scopeParentOf(key)
    return parent === undefined ? undefined : this.generations.get(parent)
  }

  /** Inspect retained revisions, or the exact revision an Agent joined.
   * @param ctx - optional Agent context; omission includes all retained revisions.
   * @returns detached module references and isolation diagnostics; no match returns an empty list.
   */
  inspectCompositions(ctx?: Context): AgentPresetInspection[] {
    const joined = ctx === undefined ? undefined : this.generationFor(ctx)
    const generations = ctx === undefined ? [...this.generations.values()] : joined === undefined ? [] : [joined]
    return generations.map(({ mount }) => ({
      id: mount.presetId,
      modules: activeCompositionModules(mount.tree),
      leakedServices: leakedServices(this.owner, mount.fiber),
    }))
  }

  /** Read every declared preset, including activation failures.
   * @returns Display metadata and loading diagnostics.
   */
  async list(): Promise<AgentPreset[]> {
    const rows = await Promise.all([...this.definitions.values()].map(async (record) => {
      const broken = await this.diagnostic(record)
      return {
        id: record.config.id,
        ...(record.config.name === undefined ? {} : { name: record.config.name }),
        ...(record.config.description === undefined ? {} : { description: record.config.description }),
        ...(record.config.order === undefined ? {} : { order: record.config.order }),
        ...(broken === undefined ? {} : { broken }),
      }
    }))
    return rows.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id))
  }

  /** Read the selection roster.
   * @returns Current presets with trust and authoring facts, each marked when it is the default.
   */
  @Remote('list')
  async remoteExportList(): Promise<AgentPresetRoster> {
    const policy = this.selectionPolicy()
    const authoring = this.authoring
    const userPresetIds = authoring === undefined ? new Set<string>() : await authoring.userPresetIds()
    const defaultModel = this.owner.get('agentDefaultModel')?.currentSelection()
    const llm = this.owner.get('llm')
    const models = llm === undefined
      ? []
      : (await Promise.all(llm.listProviders().map(async (provider) => {
        try {
          return (await llm.listModels(provider.id)).map(model => ({
            provider: provider.id,
            providerName: provider.name,
            id: model.id,
            name: model.name,
          }))
        } catch {
          return []
        }
      }))).flat()
    if (defaultModel !== undefined && !models.some(
      model => model.provider === defaultModel.provider && model.id === defaultModel.model,
    )) {
      models.unshift({
        provider: defaultModel.provider,
        providerName: defaultModel.provider,
        id: defaultModel.model,
        name: defaultModel.model,
      })
    }
    return {
      presets: (await this.list()).map(row => ({
        ...row,
        trust: userPresetIds.has(row.id) ? 'user' as const : 'system' as const,
        isDefault: row.id === policy.defaultId,
      })),
      authorable: this.authorable,
      modeSelectionEnabled: policy.enabled,
      models,
      modelPresets: this.config.models.get() ?? {},
      ...defaultModel === undefined
        ? {}
        : { defaultModel: { provider: defaultModel.provider, model: defaultModel.model } },
    }
  }

  /** Resolve an identity without starting an Agent.
   * @param id Explicit preset or the current default.
   * @returns Current metadata, including failure when activation failed.
   */
  async resolve(id?: string): Promise<AgentPreset> {
    const wanted = id ?? this.defaultId
    const record = this.definitions.get(wanted)
    if (record === undefined) throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`,
      { agentPreset: wanted, available: [...this.definitions.keys()] })
    const broken = await this.diagnostic(record)
    return { id: wanted, ...(broken === undefined ? {} : { broken }) }
  }

  /** Read one declaration's child plugin list as YAML, for viewing only.
   * @param agentPreset Preset identity.
   * @returns The declared composition beside its trust and published metadata.
   */
  @Remote('read')
  async readDocument(agentPreset: string): Promise<AgentPresetDocument> {
    const record = this.definitions.get(agentPreset)
    if (record === undefined) {
      throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${agentPreset}`,
        { agentPreset, available: [...this.definitions.keys()] })
    }
    const { id, name, description, plugins } = record.config
    // The Loader's own dialect, so `!!js` conditions read as declared rather than as expression objects.
    const content = dump(plugins, { schema: entryListSchema, noRefs: true, lineWidth: -1 })
    return {
      agentPreset: id,
      trust: (await this.authoring?.trustOf(id)) === 'user' ? 'user' as const : 'system' as const,
      content,
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
    }
  }

  /**
   * Replace one profile-declared preset's composition.
   * @param id - preset id whose declaring row the active profile patch holds.
   * @param content - complete entry-list YAML to store.
   * @returns once the row is rewritten and the Loader settled on it.
   * @throws when the preset is unknown, ships with the deployment, or the
   * composition is refused.
   */
  async write(id: string, content: string): Promise<void> {
    const authoring = this.requireAuthoring(id)
    if (!this.definitions.has(id)) {
      throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${id}`,
        { agentPreset: id, available: [...this.definitions.keys()] })
    }
    if ((await authoring.trustOf(id)) !== 'user') {
      throw notWritableSystem(id)
    }
    await authoring.write(id, parseComposition(content).plugins)
  }

  /**
   * Replace one profile-declared preset's composition through the Remote API.
   * @param agentPreset - preset id resolved by the Host.
   * @param content - complete entry-list YAML to store.
   * @returns once the row is rewritten.
   */
  @Remote('write')
  async remoteExportWrite(agentPreset: string, content: string): Promise<void> {
    validatePresetId(agentPreset, 'agentPreset')
    await this.write(agentPreset, content)
  }

  /**
   * Create a profile-declared preset by copying an existing one's whole
   * plugin list.
   * @param from - the preset the copy starts from; any trust is accepted.
   * @param id - the new preset's id.
   * @param name - display name for the copy; omitted publishes none.
   * @throws when the source is unknown, the id is unusable or taken, or the
   * deployment configures no profile.
   */
  async copy(from: string, id: string, name?: string): Promise<void> {
    await this.copyIntoProfile(from, id, name, undefined)
  }

  /**
   * Create a profile-declared preset with a complete composition.
   * @param from - source preset whose plugin list the copy starts from.
   * @param id - new preset id.
   * @param name - display name; undefined publishes none.
   * @param content - complete entry-list YAML stored in the new preset.
   * @returns once the declaring row is written and activated.
   * @throws when the source is unknown, the id is unusable or taken, or the
   * composition is refused.
   */
  async create(from: string, id: string, name: string | undefined, content: string): Promise<void> {
    await this.copyIntoProfile(from, id, name, content)
  }

  /** Create or copy one preset into the active profile's patch. */
  private async copyIntoProfile(from: string, id: string, name: string | undefined, content: string | undefined): Promise<void> {
    const authoring = this.requireAuthoring(id)
    const source = this.definitions.get(from)
    if (source === undefined) {
      throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${from}`,
        { agentPreset: from, available: [...this.definitions.keys()] })
    }
    const plugins = content === undefined
      ? structuredClone(source.config.plugins)
      : parseComposition(content).plugins
    await authoring.create(id, name, plugins, [...this.definitions.keys()])
  }

  /**
   * Copy one preset through the Remote API.
   * @param from - the source preset id.
   * @param id - the new preset id.
   * @param name - the copy's optional display name.
   * @returns once the copy is stored.
   */
  @Remote('copy')
  async remoteExportCopy(from: string, id: string, name?: string): Promise<void> {
    validatePresetId(from, 'from')
    validatePresetId(id, 'agentPreset')
    await this.copy(from, id, name)
  }

  /**
   * Create one preset with caller-supplied composition through the Remote API.
   * @param from - source preset whose plugin list the copy starts from.
   * @param id - new preset id.
   * @param name - display name, or undefined to publish none.
   * @param content - complete composition for the new preset.
   * @returns once the complete preset is stored.
   */
  @Remote('create')
  async remoteExportCreate(from: string, id: string, name: string | undefined, content: string): Promise<void> {
    validatePresetId(from, 'from')
    validatePresetId(id, 'agentPreset')
    await this.create(from, id, name, content)
  }

  /** The authoring handle, or the refusal a profile-less deployment answers. */
  private requireAuthoring(presetId: string): PresetAuthoring {
    const authoring = this.authoring
    if (authoring === undefined) {
      throw notWritableSystem(presetId)
    }
    return authoring
  }

  /**
   * Delete a profile-declared preset.
   *
   * Sessions already composed from it keep their retained revision; only new
   * sessions see the roster without it. Bindings that named it — the selected
   * default and per-model overrides — are cleared so nothing resolves a
   * preset nothing will ever supply again.
   * @param id - the preset id.
   * @throws when the preset is unknown or ships with the deployment.
   */
  async remove(id: string): Promise<void> {
    const authoring = this.requireAuthoring(id)
    if (!this.definitions.has(id)) {
      throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${id}`,
        { agentPreset: id, available: [...this.definitions.keys()] })
    }
    if ((await authoring.trustOf(id)) !== 'user') {
      throw notWritableSystem(id)
    }
    await authoring.remove(id)
    const selectedDefault = this.config.selectedDefault.get()
    const models = this.config.models.get()
    const ops = [
      ...selectedDefault === id ? [{ op: 'unset' as const, path: ['selectedDefault'] }] : [],
      ...Object.entries(models ?? {}).flatMap(([provider, providerModels]) =>
        Object.entries(providerModels).flatMap(([model, preset]) =>
          preset === id ? [{ op: 'unset' as const, path: ['models', provider, model] }] : [])),
    ]
    if (ops.length > 0) await this.settingsService?.mutate(SETTINGS_NAMESPACE, ops)
  }

  /**
   * Delete one preset through the Remote API.
   * @param id - the preset id.
   * @returns once the preset is deleted.
   */
  @Remote('deletePreset')
  async remoteExportDelete(id: string): Promise<void> {
    validatePresetId(id, 'agentPreset')
    await this.remove(id)
  }

  private async retain(id?: string): Promise<Generation> {
    const wanted = id ?? this.defaultId
    while (true) {
      const record = this.definitions.get(wanted)
      if (record === undefined) throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`,
        { agentPreset: wanted, available: [...this.definitions.keys()] })
      const broken = await this.diagnostic(record)
      if (this.definitions.get(wanted) !== record) continue
      const generation = record.generation
      if (broken !== undefined || generation === undefined) {
        const reason = broken as string
        throw new RemoteError('agent-preset/invalid', reason, { agentPreset: wanted, reason })
      }
      generation.users++
      return generation
    }
  }

  private async bind(ctx: Context, generation: Generation): Promise<void> {
    const key = scopeOf(ctx)
    if (key === undefined) throw new Error('Agent preset binding requires a scoped context')
    const binding = this.bindings.get(key)
    if (binding?.generation === generation) return
    if (binding !== undefined) {
      binding.parent.rebind(generation.key)
      const old = binding.generation
      generation.users++
      binding.generation = generation
      old.users--
      await this.collect(old)
    } else this.join(ctx, key, generation)
  }

  private join(ctx: Context, key: ScopeKey, generation: Generation): void {
    const binding = { parent: bindScopeParent(key, generation.key), generation }
    generation.users++
    this.bindings.set(key, binding)
    ctx.effect(() => async () => {
      this.bindings.delete(key)
      binding.generation.users--
      await this.collect(binding.generation)
    }, 'agent-preset.binding')
  }

  /** Bind an unpublished Agent to the current preset revision.
   * @param ctx Agent context from its setup callback.
   * @param id Requested preset, or the default.
   * @returns Bound preset identity.
   */
  async mount(ctx: Context, id?: string): Promise<AgentPreset> {
    const generation = await this.retain(id)
    try {
      await this.bind(ctx, generation)
      return { id: generation.mount.presetId }
    } finally {
      generation.users--
      await this.collect(generation)
    }
  }

  /** Join a child to the exact revision retained by its parent.
   * @param ctx Child Agent context.
   * @param parent Parent Agent context.
   * @returns Inherited preset id, or undefined in a preset-free composition.
   */
  composeFrom(ctx: Context, parent: Context): string | undefined {
    const generation = this.generationFor(parent)
    if (generation === undefined) {
      if (parent.get('agentPresets')?.composedPreset(parent) !== undefined) {
        throw new Error('Parent preset revision is unavailable')
      }
      return undefined
    }
    // A child has no existing binding, so this path has no asynchronous cleanup.
    const key = scopeOf(ctx)
    if (key === undefined) throw new Error('Child preset binding requires a scope')
    if (this.bindings.has(key)) throw new Error('Child already joined a preset')
    this.join(ctx, key, generation)
    return generation.mount.presetId
  }

  /** Read the preset a live Agent uses.
   * @param ctx Agent context.
   * @returns Its preset id, if bound.
   */
  composedPreset(ctx: Context): string | undefined { return this.generationFor(ctx)?.mount.presetId }

  /** Read a service supplied inside an Agent's isolated preset group.
   * @param agent Agent whose composition is queried.
   * @param name Cordis service name.
   * @returns The service, or undefined.
   */
  serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined {
    const mount = this.generationFor(agent.ctx)?.mount
    return mount === undefined ? undefined : serviceForMount(this.owner, mount, name)
  }

  /** Rebind an Agent; the caller owns exclusion of turn-driving work.
   * @param ctx Agent context.
   * @param id Requested preset.
   * @returns The bound identity.
   */
  async recompose(ctx: Context, id: string): Promise<AgentPreset> {
    const preset = await this.mount(ctx, id)
    try { this.owner.emit('tools/change') }
    catch (error) { this.owner.logger.warn(`Preset tools observer: ${String(error)}`) }
    return preset
  }

  /** Select a preset while the Agent is idle, retaining its Session history. A Session whose
   * log records the preset and whose Agent runs its current revision keeps its
   * composition; nothing is logged or announced.
   * @param agent Target Agent.
   * @param agentPreset Requested identity.
   * @returns Committed preset identity.
   */
  @Remote('select')
  async select(agent: Agent, agentPreset: string): Promise<string> {
    const turn = (this.switches.get(agent.id) ?? Promise.resolve()).then(async () => {
      const boundary = this.owner.agents.turnBoundaryOf(agent.session)
      if (agent.status !== 'idle' || boundary.openTurnStartSeq !== null) {
        throw new RemoteError('agent-preset/locked', 'Wait for the current work to finish before switching presets', { sessionId: agent.id, agentPreset })
      }
      return agent.runMaintenance(async (signal) => {
        const current = this.definitions.get(agentPreset)?.generation
        if (current !== undefined && this.generationFor(agent.ctx) === current
          && this.agentPresetProjectionHandle.stateOf(agent.session) === agentPreset) return agentPreset
        const generation = await this.retain(agentPreset)
        try {
          signal.throwIfAborted()
          await this.bind(agent.ctx, generation)
          agent.session.append('agent-preset/selected', { agentPreset })
          try { this.owner.emit('tools/change') }
          catch (error) { this.owner.logger.warn(`Preset tools observer: ${String(error)}`) }
          return agentPreset
        } finally {
          generation.users--
          await this.collect(generation)
        }
      })
    })
    const guard = turn.catch(() => undefined)
    this.switches.set(agent.id, guard)
    try { return await turn } finally {
      if (this.switches.get(agent.id) === guard) this.switches.delete(agent.id)
    }
  }

  /** Read current registrations for cold transcript presentation.
   * @param id Preset identity or the default.
   * @returns A revision lease; dispose it after the scoped read completes.
   */
  async acquireScope(id?: string): Promise<{ key: ScopeKey } & AsyncDisposable> {
    const generation = await this.retain(id)
    let disposed = false
    return { key: generation.key, [Symbol.asyncDispose]: async () => {
      if (disposed) return
      disposed = true
      generation.users--
      await this.collect(generation)
    } }
  }

  /** Read plugin rows without creating an Agent.
   * @returns Current declaration metadata and activation states.
   */
  compositionInventory(): Promise<AgentPresetComposition[]> {
    return Promise.all([...this.definitions.values()].map(async (record) => {
      const { id, name, description } = record.config
      const broken = await this.diagnostic(record)
      const read = definitionComposition(record.config.plugins, () => { throw new Error('Inactive definition') })
      return { id, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
        isDefault: id === this.defaultId,
        ...(broken === undefined ? {} : { broken }),
        rows: record.generation === undefined ? ('rows' in read ? read.rows : []) : mountedCompositionRows(record.generation.mount.tree) }
    }))
  }
}
export default AgentPresetRegistry
