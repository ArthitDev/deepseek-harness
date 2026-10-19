/** Configuration edits in the owning user layer, serialized with Loader hot reload. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { Context, FiberState, Service, resolveConfig } from '@deepseek-ai/cordis'
import { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import yaml from 'js-yaml'
import type { Entry, EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-hmr'
import { composeEntries, loadOptionalPatches, loadProfileDirectory, readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMap, isSeq, parseDocument, Scalar, visit } from 'yaml'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent edits to the active profile's plugin configuration. */
    configEditor: ConfigEditor
  }
}

function flatten(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...row.group && Array.isArray(row.config) ? flatten(row.config as EntryOptions[]) : []])
}

/** Persist complete raw configs in their owning user layer and apply them through Loader. */
export class ConfigEditor extends Service {
  static inject = ['loader', 'profileContext']

  constructor(private readonly ownerContext: Context) {
    super(ownerContext, 'configEditor')
  }

  /** The profile patch edited by this service. */
  get documentPath(): string { return this.ownerContext.profileContext.patchPath }

  /** Addressable profile rows; nested Includes have independent configuration ownership.
   * @returns Active entries with unique profile patch ids.
   */
  entries(): Entry[] {
    const candidates = [...this.ownerContext.loader.entries()].filter(entry => entry.parent.tree.ctx.fiber.entry?.id === 'include')
    const counts = new Map<string, number>()
    for (const entry of candidates) counts.set(entry.options.id, (counts.get(entry.options.id) ?? 0) + 1)
    return candidates.filter(entry => counts.get(entry.options.id) === 1)
  }

  /** Read inherited and explicit values from each entry's owning user layer.
   * @returns Detached layer values alongside their Loader entries.
   */
  configuration(): Array<{ entry: Entry; inherited: Record<string, unknown>; override: Record<string, unknown> }> {
    const profile = this.ownerContext.profileContext
    const loaded = loadProfileDirectory('dsh', profile.dir, profile.installAnchor)
    const home = loadOptionalPatches('dsh', join(profile.home, 'cordis.patch.yml')) ?? []
    return this.entries().map((entry) => {
      const homeOwned = this.homeOwns(entry, home)
      const target = homeOwned ? home : loaded.patches
      return {
        entry, inherited: this.inherited(entry, loaded, homeOwned ? home : undefined),
        override: structuredClone((target.findLast(
          row => row.id === entry.options.id && row.config !== undefined,
        )?.config ?? {}) as Record<string, unknown>),
      }
    })
  }

  private homeOwns(entry: Entry, patches: readonly PatchOptions[]): boolean {
    return patches.some(patch => patch.id === entry.options.id && patch.config !== undefined
      && patch.insert === undefined && (patch.name === undefined || patch.name === entry.options.name))
  }

  private inherited(
    entry: Entry, loaded: ReturnType<typeof loadProfileDirectory>, home?: readonly PatchOptions[],
  ): Record<string, unknown> {
    const patches = (home ?? loaded.patches).map((patch) => {
      if (patch.id !== entry.options.id || patch.insert !== undefined) return patch
      const rest = { ...patch }; Reflect.deleteProperty(rest, 'config')
      return rest
    })
    const layers = [...loaded.layers.map(layer => layer.patches), ...(home === undefined ? [] : [loaded.patches]), patches]
    const row = flatten(composeEntries(layers)).find(row => row.id === entry.options.id)
    return structuredClone((row?.config ?? {}) as Record<string, unknown>)
  }

  /** Validate, persist, and reconcile config in its existing home override or the profile patch.
   * Home edits affect every profile using that override; command-line overrides remain read-only.
   * @param entry Current Loader entry, also used to detect replacement during the write.
   * @param change Derive a raw config from the current entry and its inherited layer.
   * @returns Fulfillment after Loader reconciliation completes.
   */
  async edit(
    entry: Entry,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const run = async (): Promise<void> => {
      const profile = this.ownerContext.profileContext
      await withFileLock(join(profile.dir, 'package.json'), () => withFileLock(join(profile.home, 'package.json'), async () => {
        if (!this.entries().includes(entry) || entry.fiber === undefined) throw new Error('Configuration entry is no longer available')
        const beforePatches = readProfilePatches('dsh', this.ownerContext.profileContext)
        await reconcileProfilePatches(this.ownerContext.root, beforePatches, 'dsh')
        if (!this.entries().includes(entry)) throw new Error('Configuration entry changed during reload')
        const current = structuredClone((entry.options.config ?? {}) as Record<string, unknown>)
        const homePath = join(profile.home, 'cordis.patch.yml')
        const home = loadOptionalPatches('dsh', homePath) ?? []
        const homeOwned = this.homeOwns(entry, home)
        const path = homeOwned ? homePath : this.documentPath
        const loaded = loadProfileDirectory('dsh', profile.dir, profile.installAnchor)
        const inherited = this.inherited(entry, loaded, homeOwned ? home : undefined)
        const next = change(current, inherited)
        const fiber = entry.fiber
        if (fiber.state !== FiberState.ACTIVE) throw new Error('Configuration plugin is no longer active')
        const resolved: unknown = fiber.ctx.waterfall(fiber, 'internal/config', next, () => next)
        resolveConfig(fiber.runtime as NonNullable<typeof fiber.runtime>, resolved)
        let before: string
        try { before = await readFile(path, 'utf8') }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          before = '[]\n'
        }
        const document = parseDocument(before, {
          customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
        })
        if (document.errors[0] !== undefined) throw document.errors[0]
        if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
        document.contents.flow = false
        const index = document.contents.items.findLastIndex((item, index) => isMap(item)
          && document.getIn([index, 'id']) === entry.options.id && !item.has('insert')
          && (!item.has('name') || document.getIn([index, 'name']) === entry.options.name))
        if (isDeepStrictEqual(next, inherited)) {
          for (let index = document.contents.items.length - 1; index >= 0; index--) {
            const row = document.contents.items[index]
            if (!isMap(row) || document.getIn([index, 'id']) !== entry.options.id || row.has('insert')) continue
            row.delete('config')
            if (row.items.length === Number(row.has('id')) + Number(row.has('name'))) document.delete(index)
          }
        } else if (index < 0) document.add(document.createNode({ id: entry.options.id, name: entry.options.name, config: next }))
        else document.setIn([index, 'config'], document.createNode(next))
        visit(document, { Map(_key, node) {
          if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
          const expression = new Scalar(node.get('__jsExpr'))
          expression.tag = 'tag:yaml.org,2002:js'
          return expression
        } })
        const candidate = yaml.load(String(document), { schema: entryListSchema }) as PatchOptions[]
        const patches = homeOwned
          ? readProfilePatches('dsh', profile, loaded, candidate)
          : readProfilePatches('dsh', profile, { ...loaded, patches: candidate })
        const effective = flatten(composeEntries([patches])).find(row => row.id === entry.options.id)
        if (!isDeepStrictEqual(effective?.config ?? {}, next)) {
          throw new Error(`Configuration for "${entry.options.id}" is overridden by a home patch or command-line overlay`)
        }
        await writeFileAtomic(path, String(document), { mode: 0o600 })
        try {
          await reconcileProfilePatches(this.ownerContext.root, patches, 'dsh', [entry.options.id])
        } catch (error) {
          await writeFileAtomic(path, before, { mode: 0o600 })
          await reconcileProfilePatches(this.ownerContext.root, beforePatches, 'dsh')
          throw error
        }
      }))
    }
    const hmr = this.ownerContext.get('hmr')
    await (hmr === undefined ? run() : hmr.runExclusive(run))
  }
}

/** js-tag resolver shared by every patch document this package touches. */
const homePatchYamlOptions = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] }

/**
 * Insert or update one entry's config in the deployment home patch
 * (`<dshHome>/cordis.patch.yml`) — the layer that overrides every profile,
 * so a namespace overridden here must be edited here rather than through the
 * per-profile settings document.
 * @param dshHome - the deployment home directory that owns the patch.
 * @param entryId - the overridden entry's id.
 * @param entryName - the overridden entry's plugin name.
 * @param merge - maps the row's current config (undefined when absent) to the next one.
 */
export function upsertHomePatchEntry(
  dshHome: string,
  entryId: string,
  entryName: string,
  merge: (current: Record<string, unknown> | undefined) => Record<string, unknown>,
): void {
  const path = join(dshHome, 'cordis.patch.yml')
  const source = existsSync(path) ? readFileSync(path, 'utf8') : '[]\n'
  const document = parseDocument(source, homePatchYamlOptions)
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Home patch must be a YAML sequence')
  const index = document.contents.items.findLastIndex((item, itemIndex) => isMap(item)
    && document.getIn([itemIndex, 'id']) === entryId && !item.has('insert')
    && (!item.has('name') || document.getIn([itemIndex, 'name']) === entryName))
  const currentRow = index >= 0 ? document.getIn([index, 'config']) : undefined
  const current = isMap(currentRow) ? (currentRow.toJSON() as Record<string, unknown>) : undefined
  const next = merge(current)
  if (index >= 0) document.setIn([index, 'config'], document.createNode(next))
  else document.add(document.createNode({ id: entryId, name: entryName, config: next }))
  visit(document, { Map(_key, node) {
    if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return
    const expression = new Scalar(node.get('__jsExpr'))
    expression.tag = 'tag:yaml.org,2002:js'
    return expression
  } })
  writeFileSync(path, String(document), { mode: 0o600 })
}

export default ConfigEditor
