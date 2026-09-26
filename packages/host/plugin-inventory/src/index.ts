/** Loader inventory with revision-checked plugin enablement editing. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the optional agent-preset roster resolved through `ctx.get`.
import type {} from '@deepseek-ai/dsh-agent-presets'
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
import {
  findRow, globalEnablement, globalToggleAllowed, presetEnablement, readRows, revision,
} from './enablement.ts'

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

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /** Resolve only a Host-owned config path; browser input never supplies a filename. */
  private async target(entryId: string, moduleName: string, preset?: string) {
    if (!entryId || !moduleName) throw new Error('Plugin id and module are required')
    if (preset !== undefined) {
      const roster = this.ctx.get('agentPresets')
      if (!roster) throw new Error('Agent presets are unavailable')
      const resolved = await roster.resolve(preset)
      if (resolved.trust !== 'user') throw new Error('Copy this built-in preset before changing its plugins')
      const content = await roster.read(preset)
      const row = findRow(readRows(content), entryId, moduleName)
      return { path: resolved.path, content, enabled: row.disabled !== true, roster, localId: entryId }
    }
    if (!globalToggleAllowed(entryId, moduleName)) throw new Error('This infrastructure plugin must be managed in the profile configuration')
    const entries = [...this.ctx.loader.entries()].filter(entry =>
      entry.id === entryId && entry.options.name === moduleName && !entry.options.group)
    const [entry] = entries
    if (entries.length !== 1 || !entry) throw new Error('Plugin entry is missing or ambiguous; refresh the list')
    const localId = entry.options.id
    const owner = entry.parent.tree.ctx.fiber.entry
    if (owner && owner.options.id !== 'include') throw new Error('Nested include plugins must be edited in their composition')
    if (entry.disabled && !entry.options.disabled) throw new Error('This plugin is disabled by its group')
    if (entry.options.disabled !== undefined && typeof entry.options.disabled !== 'boolean') throw new Error('This plugin is controlled by an expression')
    const baseUrl = this.ctx.loader.ctx.baseUrl
    if (!baseUrl?.startsWith('file:')) throw new Error('This host has no writable profile')
    const path = fileURLToPath(new URL('cordis.patch.yml', baseUrl))
    const content = await readFile(path, 'utf8')
    const patches = readRows(content)
    const overrides = patches.filter(row => row.id === localId && !row.insert && (row.name === undefined || row.name === moduleName) && typeof row.disabled === 'boolean')
    const last = overrides.at(-1)
    return { path, content, enabled: last ? !last.disabled : !entry.disabled, roster: undefined, localId }
  }

  /** Read one switch's stored state and revision without exposing config contents. */
  @Remote('edit')
  async edit(entryId: string, moduleName: string, preset?: string): Promise<PluginEnablementDocument> {
    try {
      const target = await this.target(entryId, moduleName, preset)
      return { revision: revision(target.content), enabled: target.enabled }
    } catch (error) {
      return { revision: '', enabled: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Persist a confirmed enablement change against the exact revision the browser read. */
  @Remote('setEnabled')
  async setEnabled(
    entryId: string, moduleName: string, enabled: boolean, expectedRevision: string, preset?: string,
  ): Promise<PluginEnablementDocument> {
    const initial = await this.target(entryId, moduleName, preset)
    return await withFileLock(initial.path, async () => {
      const target = await this.target(entryId, moduleName, preset)
      if (revision(target.content) !== expectedRevision) throw new Error('Configuration changed; refresh and try again')
      const content = preset === undefined
        ? globalEnablement(target.content, target.localId, moduleName, enabled)
        : presetEnablement(target.content, entryId, moduleName, enabled)
      await writeFileAtomic(`${target.path}.bak`, target.content, { mode: 0o600, dirMode: 0o700 })
      if (target.roster && preset !== undefined) await target.roster.write(preset, content)
      else await writeFileAtomic(target.path, content, { mode: 0o600, dirMode: 0o700 })
      return { revision: revision(content), enabled }
    })
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
    entries.push({
      entryId: pluginEntryId(entry.id),
      moduleName: entry.options.name,
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
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
