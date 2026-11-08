/** Loader inventory projection plus revision-checked plugin enablement editing. */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the optional agent-preset roster resolved through `ctx.get`.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-app-boot'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  AgentPresetPluginGroup,
  PluginEnablementDocument,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/**
 * Brand an existing Loader-tree entry id at the owning boundary.
 * @param value - the entry id as the Loader tree spells it.
 * @returns the same id as the inventory's branded entry id.
 */
export function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Why an agent-preset composition row cannot be toggled from the inventory in this build. */
const PRESET_READONLY_REASON = 'Agent preset compositions are read-only here; the preset surface owns that edit'

/** Host diagnostics for the manager's two addressability refusals. */
function readOnlyMessage(reason: 'management-required' | 'unaddressable'): string {
  return reason === 'management-required'
    ? 'This plugin carries plugin management and must be managed in the profile configuration'
    : 'This plugin is controlled by its composition; edit it in the profile configuration'
}

/**
 * Hash the exact profile patch text so stale browser edits cannot overwrite newer writes.
 * @param content - exact document text the hash covers.
 * @returns the SHA-256 hex digest of the content.
 */
function revision(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * The manager rows the editing face reads: a structural subset of the plugin
 * manager's `PluginInfo`, named here because the manager package depends on
 * this one and cannot be imported back.
 */
interface EditablePluginRow {
  readonly entryId: PluginEntryId
  readonly moduleName: string
  readonly enabled: boolean
  readonly readOnlyReason?: 'management-required' | 'unaddressable'
}

/** Locate one manager row by its inventory identity. */
function findEditableRow(
  rows: readonly EditablePluginRow[], entryId: string, moduleName: string,
): EditablePluginRow | undefined {
  return rows.find(item => item.entryId === entryId && item.moduleName === moduleName)
}

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /** The exact profile patch text behind every enablement revision, with the writer's own absent-file default. */
  private async patchText(): Promise<string | undefined> {
    const profile = this.ctx.get('profileContext')
    if (profile === undefined) return undefined
    try {
      return await readFile(profile.patchPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[]\n'
      throw error
    }
  }

  /**
   * Read one switch's stored state and revision without exposing config contents.
   * @param entryId - entry id as the Loader tree spells it.
   * @param moduleName - plugin module name the entry runs.
   * @param preset - agent preset owning the composition; omitted targets the global profile.
   * @returns the stored enablement and revision, or the failure reason.
   */
  @Remote('edit')
  async edit(entryId: string, moduleName: string, preset?: string): Promise<PluginEnablementDocument> {
    if (preset !== undefined) {
      return { revision: '', enabled: false, reason: PRESET_READONLY_REASON }
    }
    const manager = this.ctx.get('pluginManager')
    const text = await this.patchText()
    if (manager === undefined || text === undefined) {
      return { revision: '', enabled: false, reason: 'Plugin management is unavailable in this host' }
    }
    const row = findEditableRow(await manager.listPlugins(), entryId, moduleName)
    if (row === undefined) {
      return { revision: '', enabled: false, reason: 'Plugin entry is missing; refresh the list' }
    }
    if (row.readOnlyReason !== undefined) {
      return { revision: '', enabled: false, reason: readOnlyMessage(row.readOnlyReason) }
    }
    return { revision: revision(text), enabled: row.enabled }
  }

  /**
   * Persist a confirmed enablement change through the plugin manager against the
   * exact profile-patch revision the browser read.
   * @param entryId - entry id as the Loader tree spells it.
   * @param moduleName - plugin module name the entry runs.
   * @param enabled - enablement state to store.
   * @param expectedRevision - revision previously read by `edit`; a mismatch rejects the write.
   * @param preset - agent preset owning the composition; omitted targets the global profile.
   * @returns the new revision and applied enablement.
   */
  @Remote('setEnabled')
  async setEnabled(
    entryId: string, moduleName: string, enabled: boolean, expectedRevision: string, preset?: string,
  ): Promise<PluginEnablementDocument> {
    if (preset !== undefined) {
      throw new Error(PRESET_READONLY_REASON)
    }
    const manager = this.ctx.get('pluginManager')
    const text = await this.patchText()
    if (manager === undefined || text === undefined) {
      throw new Error('Plugin management is unavailable in this host')
    }
    const row = findEditableRow(await manager.listPlugins(), entryId, moduleName)
    if (row === undefined) throw new Error('Plugin entry is missing; refresh the list')
    if (row.readOnlyReason !== undefined) throw new Error(readOnlyMessage(row.readOnlyReason))
    if (revision(text) !== expectedRevision) {
      throw new Error('Configuration changed; refresh and try again')
    }
    await manager.setPluginEnabled(row.entryId, enabled)
    return { revision: revision((await this.patchText()) ?? text), enabled }
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   *
   * When an agent-preset roster is composed, the snapshot also carries each
   * preset's composition rows, because those rows — not the Loader's own
   * entries — are where a deployment that mounts the roster runs its
   * model-facing plugins.
   * @returns Current non-group Loader entries in Loader order, with optional display metadata
   * and per-preset compositions when a roster is composed.
   */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    return readPluginInventory(this.ctx)
  }
}

export default PluginInventoryGateway

/** Read current Loader entries and optional preset compositions.
 * @param ctx Context with the Loader service.
 * @returns Current inventory with optional display metadata and no separate runtime cache.
 */
export async function readPluginInventory(ctx: Context): Promise<PluginInventorySnapshot> {
  const entries: PluginInventoryEntry[] = []
  const packages = ctx.get('pluginPackages')
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    const base = entry.parent.tree.ctx.baseUrl
    const meta = base === undefined ? undefined : packages?.metaOf(entry.options.name, base)
    const fiber = entry.fiber
    const fiberPhase = fiber === undefined ? null : FIBER_PHASE[fiber.state]
    let diagnostic: string | undefined
    if (fiber !== undefined && fiberPhase === 'failed') {
      try { await fiber.await() } catch (error) { diagnostic = error instanceof Error ? error.message : String(error) }
    }
    entries.push({
      entryId: pluginEntryId(entry.id),
      moduleName: entry.options.name,
      enabled: !entry.disabled,
      fiberPhase,
      ...diagnostic === undefined ? {} : { diagnostic },
      ...meta === undefined ? {} : { meta },
    })
  }
  const presets = ctx.get('agentPresets')
  const management = ctx.get('pluginManager') === undefined ? {} : { managementAvailable: true }
  if (presets === undefined) return { entries, ...management }
  const agentPresets: AgentPresetPluginGroup[] = (await presets.compositionInventory()).map(
    composition => ({
      ...composition,
      rows: composition.rows.map(({ fiberState, ...row }) => {
        const meta = ctx.baseUrl === undefined ? undefined : packages?.metaOf(row.moduleName, ctx.baseUrl)
        return {
          ...row,
          fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
          ...meta === undefined ? {} : { meta },
        }
      }),
    }),
  )
  return { entries, agentPresets, ...management }
}
