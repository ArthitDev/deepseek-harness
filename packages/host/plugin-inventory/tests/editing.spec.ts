import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import PluginInventoryGateway from '../src/index.ts'
import { readRows } from '../src/enablement.ts'
import { boot } from '../../../boot/app-boot/src/index.ts'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-edit-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(dir + '/').href
  await ctx.plugin(Loader)
  const moduleName = '@deepseek-ai/dsh-tool-test'
  ctx.loader.internal = { import: async () => ({ apply() {} }) } as never
  await ctx.loader.root.update([{ id: 'test', name: moduleName }])
  await ctx.plugin(PluginInventoryGateway)
  const api = ctx.get('pluginInventory') as PluginInventoryGateway
  const path = join(dir, 'cordis.patch.yml')
  await writeFile(path, '# existing config\n[]\n')
  return { api, path, moduleName, ctx }
}

it('persists a toggle, keeps a backup, and rejects a stale second browser', async () => {
  const { api, path, moduleName } = await fixture()
  const before = await api.edit('test', moduleName)
  expect(before.reason).toBeUndefined()
  const saved = await api.setEnabled('test', moduleName, false, before.revision)
  expect(saved.enabled).toBe(false)
  expect(await readFile(path + '.bak', 'utf8')).toBe('# existing config\n[]\n')
  expect(readRows(await readFile(path, 'utf8'))).toEqual([{ id: 'test', name: moduleName, disabled: true }])
  await expect(api.setEnabled('test', moduleName, true, before.revision)).rejects.toThrow('Configuration changed')
  expect(await api.edit('test', moduleName)).toEqual(saved)
})

it('refuses forged infrastructure mutations and unlisted plugins without writing', async () => {
  const { api, path } = await fixture()
  const before = await readFile(path, 'utf8')
  expect((await api.edit('webserver', '@deepseek-ai/dsh-host-webserver')).reason).toContain('infrastructure')
  await expect(api.setEnabled('webserver', '@deepseek-ai/dsh-host-webserver', false, '')).rejects.toThrow('infrastructure')
  await expect(api.setEnabled('../missing', '@deepseek-ai/dsh-tool-missing', true, '')).rejects.toThrow('missing')
  expect(await readFile(path, 'utf8')).toBe(before)
})

it('saves user preset enablement through the roster and protects built-in presets', async () => {
  const { api, path, ctx } = await fixture()
  const presetPath = path + '.preset.yml'
  const original = '- id: tool\n  name: test-tool\n  config:\n    prompt: |\n      Keep: this prompt\n'
  await writeFile(presetPath, original)
  ctx.provide('agentPresets', {
    resolve: async (id: string) => ({ path: presetPath, trust: id === 'mine' ? 'user' : 'system' }),
    read: async () => await readFile(presetPath, 'utf8'),
    write: async (_id: string, content: string) => { await writeFile(presetPath, content) },
  } as unknown as AgentPresets)
  const before = await api.edit('tool', 'test-tool', 'mine')
  expect(before.reason).toBeUndefined()
  await api.setEnabled('tool', 'test-tool', false, before.revision, 'mine')
  expect(await readFile(presetPath + '.bak', 'utf8')).toBe(original)
  expect(readRows(await readFile(presetPath, 'utf8'))).toEqual([
    { id: 'tool', name: 'test-tool', disabled: true, config: { prompt: 'Keep: this prompt\n' } },
  ])
  await expect(api.setEnabled('tool', 'test-tool', true, before.revision, 'mine')).rejects.toThrow('Configuration changed')
  await expect(api.setEnabled('tool', 'test-tool', true, before.revision, 'standard')).rejects.toThrow('built-in')
})

it('boots the editor through a file composition and persists a global switch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-boot-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const config = join(dir, 'cordis.yml')
  await writeFile(config, '- id: global-default-skills\n  name: ./global-skills.mjs\n- id: inventory\n  name: cordis:inventory\n')
  await writeFile(join(dir, 'global-skills.mjs'), 'export function apply() {}\n')
  await writeFile(join(dir, 'cordis.patch.yml'), '[]\n')
  const ctx = await boot('plugin-editor-test', config, [], (host) => {
    host.loader.builtins.inventory = PluginInventoryGateway
  })
  cleanup.push(() => ctx.fiber.dispose())
  const api = ctx.get('pluginInventory') as PluginInventoryGateway
  const entry = (await api.list()).entries.find(row => row.moduleName === './global-skills.mjs')!
  const doc = await api.edit(entry.entryId, entry.moduleName)
  expect(doc.reason).toBeUndefined()
  await api.setEnabled(entry.entryId, entry.moduleName, false, doc.revision)
  expect(readRows(await readFile(join(dir, 'cordis.patch.yml'), 'utf8'))[0]?.disabled).toBe(true)
})
