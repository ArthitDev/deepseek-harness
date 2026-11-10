import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import PluginInventoryGateway from '../src/index.ts'
import { pluginEntryId, type PluginEntryId } from '../src/index.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

/** One manager row the fake below serves, mirroring the structural subset the gateway reads. */
interface ServedRow {
  readonly entryId: PluginEntryId
  readonly moduleName: string
  enabled: boolean
  readonly readOnlyReason?: 'management-required' | 'unaddressable'
}

async function fixture(): Promise<{
  api: PluginInventoryGateway
  path: string
  rows: ServedRow[]
  writes: Array<{ id: PluginEntryId; enabled: boolean }>
}> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-edit-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: 'test', dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(dir, 'package.json'), cwd: dir, home: dir,
    startedBundles: [], overlays: [],
  })
  const path = join(dir, 'cordis.patch.yml')
  await writeFile(path, '# existing config\n[]\n')
  const rows: ServedRow[] = [
    { entryId: pluginEntryId('test'), moduleName: '@deepseek-ai/dsh-tool-test', enabled: true },
    { entryId: pluginEntryId('webserver'), moduleName: '@deepseek-ai/dsh-host-webserver', enabled: true, readOnlyReason: 'management-required' },
  ]
  const writes: Array<{ id: PluginEntryId; enabled: boolean }> = []
  ctx.provide('pluginManager', {
    listPlugins: async () => rows,
    setPluginEnabled: async (id: PluginEntryId, enabled: boolean) => {
      const row = rows.find(item => item.entryId === id)
      if (row === undefined) throw new Error('unknown plugin')
      if (row.readOnlyReason !== undefined) throw new Error(row.readOnlyReason)
      row.enabled = enabled
      writes.push({ id, enabled })
      await writeFile(path, `# existing config\n- id: ${id}\n  name: test-module\n  disabled: ${String(!enabled)}\n`)
      return {}
    },
  } as never)
  await ctx.plugin(Loader)
  await ctx.plugin(PluginInventoryGateway)
  return { api: ctx.get('pluginInventory') as PluginInventoryGateway, path, rows, writes }
}

it('edits against the profile patch revision and persists through the plugin manager', async () => {
  const { api, path, writes } = await fixture()
  const moduleName = '@deepseek-ai/dsh-tool-test'
  const before = await api.edit('test', moduleName)
  expect(before.enabled).toBe(true)
  expect(before.revision).toBeTypeOf('string')
  expect(Object.keys(before).sort()).toEqual(['enabled', 'revision'])
  expect(await readFile(path, 'utf8')).toBe('# existing config\n[]\n')

  const saved = await api.setEnabled('test', moduleName, false, before.revision)
  expect(writes).toEqual([{ id: pluginEntryId('test'), enabled: false }])
  expect(saved.enabled).toBe(false)
  expect(saved.revision).not.toBe(before.revision)
  expect(await api.edit('test', moduleName)).toEqual(saved)

  await expect(api.setEnabled('test', moduleName, true, before.revision))
    .rejects.toThrow('Configuration changed')
  expect(writes).toHaveLength(1)
})

it('reports blocked switches without going through the manager', async () => {
  const { api, writes } = await fixture()
  const blocked = await api.edit('webserver', '@deepseek-ai/dsh-host-webserver')
  expect(blocked.reason).toContain('plugin management')
  expect(blocked.enabled).toBe(false)
  await expect(api.setEnabled('webserver', '@deepseek-ai/dsh-host-webserver', false, ''))
    .rejects.toThrow('profile configuration')
  expect(writes).toHaveLength(0)

  const absent = await api.edit('gone', '@deepseek-ai/dsh-tool-missing')
  expect(absent.reason).toContain('missing')
})

it('keeps agent preset compositions read-only', async () => {
  const { api } = await fixture()
  const blocked = await api.edit('tool', 'test-tool', 'mine')
  expect(blocked.reason).toContain('read-only')
  await expect(api.setEnabled('tool', 'test-tool', false, '', 'mine')).rejects.toThrow('read-only')
})
