/**
 * Creating, copying, rewriting, and deleting presets in the active profile's
 * patch file — the same layer the Loader composes every launch from.
 *
 * A preset declaration is one preset row (`cordis:preset`, the builtin the
 * registry installs). Shipped presets arrive through bundle patch layers; an
 * authored preset is a row the profile's own `cordis.patch.yml` inserts, so
 * authoring is confined to that file: a browser can only change what the next
 * launch of this profile reads anyway, and a deployment without a profile (a
 * bare composition) authorizes nothing. A preset declared by a home patch or
 * a command-line overlay ships with the machine rather than this profile, so
 * it counts as system and is refused for editing here.
 *
 * Every mutation parses the patch document, edits the declaring row in place,
 * writes atomically under the profile's package lock, and reconciles the
 * Loader; a reconcile that rejects restores the previous file and reconciles
 * back, so a refused composition never reaches the patch on disk.
 * @module @deepseek-ai/dsh-agent-preset-registry/authoring
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import z from '@deepseek-ai/schemastery'
import { loadProfileDirectory, reconcileProfilePatches, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { load } from 'js-yaml'
import { isMap, isSeq, parseDocument, Scalar, visit, type Document } from 'yaml'
import { entryListProblem, type PresetDefinition } from './definition.ts'

/**
 * Row `name` a created preset declaration carries. The `cordis:preset`
 * builtin — which the registry itself installs — resolves it in every
 * composition that can author, without depending on the profile's package
 * installation state.
 */
export const PRESET_ROW_NAME = 'cordis:preset'

/** Entry id prefix a created preset declaration carries; the preset id completes it. */
export const PRESET_ENTRY_PREFIX = 'preset-'

/** Ids a created preset may take; the id becomes part of the declaring entry's id. */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Refuse one authoring request the deployment does not allow.
 * @param presetId - what the caller tried to change, for the diagnostic.
 * @param reason - why authoring is refused.
 * @returns the failure to throw.
 */
export function notWritable(presetId: string, reason: string): RemoteError<'agent-preset/read-only'> {
  return new RemoteError(
    'agent-preset/read-only',
    `agent preset "${presetId}" cannot be changed: ${reason}`,
    { agentPreset: presetId, reason },
  )
}

/**
 * Refuse an id something already occupies. Both the roster check and the
 * on-disk row check answer with it, so a taken id reads the same either way.
 * @param presetId - the id that is already taken.
 * @returns the failure to throw.
 */
export function presetExists(presetId: string): RemoteError<'agent-preset/invalid'> {
  const reason = `preset "${presetId}" already exists — a copy never overwrites; delete the existing preset first or choose another id`
  return new RemoteError('agent-preset/invalid', `agent presets: ${reason}`, { agentPreset: presetId, reason })
}

/**
 * Refuse an unusable id before it reaches the patch file.
 * @param presetId - the rejected id.
 * @returns the failure to throw.
 */
export function presetIdInvalid(presetId: string): RemoteError<'agent-preset/invalid'> {
  const reason = `preset id ${JSON.stringify(presetId)} must match ${PRESET_ID.toString()} — `
    + 'the id names the declaring entry in the profile patch, so anything else could collide with another row'
  return new RemoteError('agent-preset/invalid', `agent presets: ${reason}`, { agentPreset: presetId, reason })
}

/** A parsed composition: usable rows, or the first problem found. */
export interface ParsedComposition {
  /** Complete entry list for the declaring row's `config.plugins`. */
  readonly plugins: PresetDefinition['plugins']
}

/**
 * Parse caller-supplied composition text in the Loader's own dialect, so
 * `!!js` conditions read as expressions exactly as a shipped row carries them.
 * @param content - complete entry-list YAML.
 * @returns the parsed rows.
 * @throws a `RemoteError('agent-preset/invalid')` naming the first invalid row.
 */
export function parseComposition(content: string): ParsedComposition {
  let parsed: unknown
  try {
    parsed = load(content, { schema: entryListSchema })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new RemoteError('agent-preset/invalid', `agent presets: the composition is not valid YAML: ${reason}`, {
      agentPreset: '',
      reason,
    })
  }
  const problem = entryListProblem(parsed)
  if (problem !== undefined) {
    throw new RemoteError('agent-preset/invalid', `agent presets: ${problem}`, { agentPreset: '', reason: problem })
  }
  return { plugins: structuredClone(parsed) as PresetDefinition['plugins'] }
}

/** One preset declaration the profile patch holds. */
interface DeclaredRow {
  /** Index of the patch row holding the `insert` list. */
  readonly patchIndex: number
  /** Index of the entry inside that insert list. */
  readonly entryIndex: number
  /** Preset id the entry's config declares. */
  readonly presetId: string
  /** Entry id of the declaring row. */
  readonly entryId: string
}

/** Whether one entry looks like a preset declaration: a plugin row whose config names a preset id and a plugin list. */
function declaresPreset(entry: unknown): entry is { id?: unknown; config: { id: string; plugins: unknown[] } } {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
  const { config } = entry as { config?: unknown }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return false
  const { id, plugins } = config as { id?: unknown; plugins?: unknown }
  return typeof id === 'string' && id !== '' && Array.isArray(plugins)
}

/** Every preset declaration in one patch list, in file order. */
function declaredRows(patches: readonly PatchOptions[]): DeclaredRow[] {
  const found: DeclaredRow[] = []
  patches.forEach((patch, patchIndex) => {
    if (!Array.isArray(patch.insert)) return
    patch.insert.forEach((entry, entryIndex) => {
      if (!declaresPreset(entry)) return
      found.push({
        patchIndex,
        entryIndex,
        presetId: entry.config.id,
        entryId: typeof entry.id === 'string' ? entry.id : '',
      })
    })
  })
  return found
}

/** Read and parse the profile patch document; a missing file is an empty list. */
async function readPatchDocument(profile: ProfileContext): Promise<{ document: Document.Parsed; before: string }> {
  let before: string
  try {
    before = await readFile(profile.patchPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    before = '[]\n'
  }
  const document = parseDocument(before, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  const error = document.errors[0]
  if (error !== undefined) throw error
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  document.contents.flow = false
  return { document, before }
}

/** Re-tag `{ __jsExpr }` markers created by `createNode` back into `!!js` scalars, as stored declarations carry them. */
function retagExpressions(document: Document.Parsed): void {
  visit(document, { Map(_key, node) {
    if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
    const expression = new Scalar(node.get('__jsExpr'))
    expression.tag = 'tag:yaml.org,2002:js'
    return expression
  } })
}

/** The preset ids the profile patch itself declares. */
async function declaredPresetIds(profile: ProfileContext): Promise<Set<string>> {
  const loaded = loadProfileDirectory('dsh', profile.dir, profile.installAnchor)
  return new Set(declaredRows(loaded.patches).map(row => row.presetId))
}

/** Profile-patch-backed preset authoring; one instance per registry. */
export class PresetAuthoring {

  /**
   * Structural mirror of the declarative `cordis:preset` row plugin: same
   * faces the loader needs (apply reading the declared config, inject waiting
   * for the registry) without a project reference back into agent-preset —
   * that package injects agentPresets, which would close a reference cycle.
   * @param definition - the composition's preset declaration.
   * @returns an object plugin registering the declared composition.
   */
  static declarationPlugin(): object {
    return {
      name: 'cordis:preset-authoring',
      inject: { agentPresets: null },
      // The row's own config carries the declaration; `apply` reads it from the
      // plugin config so every reconciled row registers its actual contents.
      Config: z.object({
        id: z.string().required(),
        name: z.string(),
        description: z.string(),
        plugins: z.array(z.any()).required(),
      }),
      apply: (ctx: Context, config: PresetDefinition) => {
        return ctx.agentPresets.register(config)
      },
    }
  }

  /**
   * @param ctx - the registry's own context; its root carries the Loader composition to reconcile.
   * @param profile - the active profile whose patch file receives authored declarations.
   */
  constructor(
    private readonly ctx: Context,
    private readonly profile: ProfileContext,
  ) {}

  /** Entry id a created preset declaration would carry. */
  entryIdFor(presetId: string): string {
    return `${PRESET_ENTRY_PREFIX}${presetId}`
  }

  /** Preset ids the profile patch itself declares; those presets are authorable. */
  async userPresetIds(): Promise<Set<string>> {
    return await declaredPresetIds(this.profile)
  }

  /** Trust of one preset id: `user` when the profile patch declares it. */
  async trustOf(presetId: string): Promise<'system' | 'user'> {
    return (await this.userPresetIds()).has(presetId) ? 'user' : 'system'
  }

  /**
   * Run one document mutation under the profile's package lock, reconciling
   * the Loader afterwards and restoring the previous file when the new
   * composition is refused.
   * @param edit - document mutation; throws to refuse before anything is written.
   * @param requiredIds - entry ids the reconciled composition must start.
   * @returns once the file is written and the Loader settled on it.
   */
  private async commit(edit: (document: Document.Parsed) => void, requiredIds: readonly string[] = []): Promise<void> {
    await withFileLock(join(this.profile.dir, 'package.json'), async () => {
      const { document, before } = await readPatchDocument(this.profile)
      edit(document)
      retagExpressions(document)
      await writeFileAtomic(this.profile.patchPath, String(document), { mode: 0o600 })
      const patches = readProfilePatches('dsh', this.profile)
      try {
        const hmr = this.ctx.get('hmr')
        if (hmr !== undefined) await hmr.reconcileProfile(requiredIds)
        else await reconcileProfilePatches(this.ctx.root, patches, 'dsh', requiredIds)
      } catch (error) {
        // A composition the Loader refuses must not stay in the patch: restore
        // the previous file and reconcile the runtime back onto it.
        await writeFileAtomic(this.profile.patchPath, before, { mode: 0o600 })
        try {
          const hmr = this.ctx.get('hmr')
          if (hmr !== undefined) await hmr.reconcileProfile()
          else await reconcileProfilePatches(this.ctx.root, readProfilePatches('dsh', this.profile), 'dsh')
        } catch (restoreError) {
          this.ctx.logger.warn(`agent presets: restoring the profile patch after a refused edit failed: ${String(restoreError)}`)
        }
        throw error
      }
    })
  }

  /**
   * Append one preset declaration to the profile patch.
   * @param id - new preset id; refused when another declaration already holds it.
   * @param name - display name; omitted publishes none.
   * @param plugins - complete entry list the declaration carries.
   * @param takenIds - every preset id the roster already supplies.
   * @returns once the declaration is written and activated.
   * @throws when the id is unusable or taken, or the composition is refused.
   */
  async create(id: string, name: string | undefined, plugins: PresetDefinition['plugins'], takenIds: readonly string[]): Promise<void> {
    if (!PRESET_ID.test(id)) throw presetIdInvalid(id)
    if (takenIds.includes(id)) throw presetExists(id)
    const entryId = this.entryIdFor(id)
    await this.commit((document) => {
      // The roster check only sees registered presets; a patch row holding the
      // entry id still occupies it and deserves the same readable refusal.
      const occupied = declaredRows(readProfilePatches('dsh', this.profile))
        .some(row => row.presetId === id || row.entryId === entryId)
      if (occupied) throw presetExists(id)
      const config: Record<string, unknown> = { id, plugins }
      if (name !== undefined && name.trim() !== '') config.name = name.trim()
      document.add(document.createNode({ insert: [{ id: entryId, name: PRESET_ROW_NAME, config }] }))
    }, [entryId])
  }

  /**
   * Locate the declaring row of one user preset, or refuse the write.
   * @param document - parsed profile patch.
   * @param presetId - the preset whose declaring row is wanted.
   * @returns the row's coordinates.
   */
  private requireDeclaredRow(document: Document.Parsed, presetId: string): { patchIndex: number; entryIndex: number } {
    const items = isSeq(document.contents) ? document.contents.items : []
    for (const [patchIndex, item] of items.entries()) {
      if (!isMap(item) || !item.has('insert')) continue
      const insert = item.get('insert', true)
      if (!isSeq(insert)) continue
      for (const [entryIndex, entry] of insert.items.entries()) {
        if (!isMap(entry)) continue
        const config = entry.get('config', true)
        if (!isMap(config) || config.get('id') !== presetId) continue
        const plugins = config.get('plugins', true)
        if (!isSeq(plugins) && !Array.isArray(plugins)) continue
        return { patchIndex, entryIndex }
      }
    }
    throw notWritable(presetId, 'the active profile patch does not declare it')
  }

  /**
   * Replace one user preset's declared composition.
   * @param presetId - preset whose declaring row is rewritten.
   * @param plugins - complete parsed entry list to store.
   * @returns once the row is rewritten and the Loader settled on it.
   * @throws when the preset is not declared by the active profile patch.
   */
  async write(presetId: string, plugins: PresetDefinition['plugins']): Promise<void> {
    await this.commit((document) => {
      const { patchIndex, entryIndex } = this.requireDeclaredRow(document, presetId)
      document.setIn([patchIndex, 'insert', entryIndex, 'config', 'plugins'], document.createNode(plugins))
    })
  }

  /**
   * Delete one user preset's declaring row, and every override row addressed
   * to its entry, from the profile patch.
   * @param presetId - preset to remove.
   * @returns once the rows are removed and the Loader settled without them.
   * @throws when the preset is not declared by the active profile patch.
   */
  async remove(presetId: string): Promise<void> {
    await this.commit((document) => {
      const { patchIndex, entryIndex } = this.requireDeclaredRow(document, presetId)
      const insert = document.getIn([patchIndex, 'insert'], true)
      const entryId = document.getIn([patchIndex, 'insert', entryIndex, 'id'])
      const items = isSeq(document.contents) ? document.contents.items : []
      // Override rows addressed to the declaring entry go with it; leaving one
      // behind would warn about an unknown id on every later load.
      if (typeof entryId === 'string') {
        for (let index = items.length - 1; index >= 0; index--) {
          const row = items[index]
          if (!isMap(row) || row.has('insert')) continue
          if (document.getIn([index, 'id']) !== entryId) continue
          document.delete(index)
        }
      }
      if (isSeq(insert)) insert.delete(entryIndex)
      const patchRow = items[patchIndex]
      const remaining = isMap(patchRow) ? patchRow.get('insert', true) : undefined
      if (isMap(patchRow) && isSeq(remaining) && remaining.items.length === 0) document.delete(patchIndex)
    })
  }
}
