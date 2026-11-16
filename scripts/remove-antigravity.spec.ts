import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, onTestFinished } from 'vitest'

const { parse } = createRequire(new URL('../packages/experimental/pi-tui/package.json', import.meta.url))('yaml') as { parse: (source: string) => unknown }

const execute = promisify(execFile)
const script = fileURLToPath(new URL('./remove-antigravity.mjs', import.meta.url))
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-remove-antigravity-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const run = (...args: string[]) => execute('bun', ['--no-env-file', script, ...args], {
    env: { ...process.env, DSH_HOME: home }, windowsHide: true, timeout: 30_000,
  })
  return { home, run }
}

it('removes only retired routes and preset bindings, keeping exact private backups and other providers', async () => {
  const f = await fixture()
  const patch = join(f.home, 'cordis.patch.yml')
  const original = JSON.stringify([{ insert: [
    { id: 'llm-pi-ai', config: { providers: {
      antigravity: { baseURL: 'http://127.0.0.1:18877/v1' },
      custom: { baseURL: 'http://127.0.0.1:8317/v1', apiKeyEnv: 'OTHER_PROJECT_KEY' },
      'zcode-direct': { baseURL: 'http://127.0.0.1:18080/v1' },
    } } },
    { id: 'agent-presets', config: { default: 'main', models: { antigravity: { gemini: 'google-preset' }, custom: { model: 'custom-preset' } } } },
    { id: 'agent-default-model', config: { provider: 'antigravity', model: 'old-model', reasoningEffort: 'high' } },
    { id: 'proxy-servers', config: { antigravityEnabled: true, antigravityPort: 18877, antigravityProviders: ['antigravity'], externalProxies: ['sb', 'antigravity'], routeAllModels: true, sbPort: 18899 } },
    { id: 'unrelated', config: { providers: { antigravity: 'keep' }, provider: 'antigravity', model: 'keep', reasoningEffort: 'keep' } },
  ] }])
  await writeFile(patch, original)
  const profile = join(f.home, 'profiles', 'tui')
  await mkdir(profile, { recursive: true })
  const profilePatch = '- id: pi-tui\n  config:\n    provider: antigravity\n    model: old-model\n    historyLimit: 30\n- id: unrelated\n  config:\n    keep: !!js "process.env.TEST_VALUE"\n'
  await writeFile(join(profile, 'cordis.patch.yml'), profilePatch)
  await writeFile(join(f.home, '.credentials.yaml'), 'KEEP_PRIVATE_CREDENTIALS\n')
  const preview = await f.run('--dry-run')
  expect(JSON.parse(preview.stdout)).toMatchObject({ changedFiles: [patch, join(profile, 'cordis.patch.yml')] })
  expect(await readFile(patch, 'utf8')).toBe(original)
  expect(await readdir(f.home)).not.toContain('backups')
  const result = await f.run()
  expect(result.stdout).toContain('Configuration backup:')
  const data = parse(await readFile(patch, 'utf8'))
  expect(data).toEqual([{ insert: [
    { id: 'llm-pi-ai', config: { providers: { custom: { baseURL: 'http://127.0.0.1:8317/v1', apiKeyEnv: 'OTHER_PROJECT_KEY' }, 'zcode-direct': { baseURL: 'http://127.0.0.1:18080/v1' } } } },
    { id: 'agent-presets', config: { default: 'main', models: { custom: { model: 'custom-preset' } } } },
    { id: 'proxy-servers', config: { externalProxies: ['sb'], routeAllModels: true, sbPort: 18899 } },
    { id: 'unrelated', config: { providers: { antigravity: 'keep' }, provider: 'antigravity', model: 'keep', reasoningEffort: 'keep' } },
  ] }])
  const afterProfile = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
  expect(afterProfile).toContain('historyLimit: 30')
  expect(afterProfile).toContain('!!js "process.env.TEST_VALUE"')
  expect(afterProfile).not.toContain('old-model')
  expect(await readFile(join(f.home, '.credentials.yaml'), 'utf8')).toBe('KEEP_PRIVATE_CREDENTIALS\n')
  const backups = await readdir(join(f.home, 'backups'))
  expect(backups).toHaveLength(1)
  const backup = join(f.home, 'backups', backups[0]!)
  const manifest = JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')) as { file: string; backup: string }[]
  expect(await readFile(join(backup, manifest.find(row => row.file === patch)!.backup), 'utf8')).toBe(original)
  expect(await readFile(join(backup, manifest.find(row => row.file !== patch)!.backup), 'utf8')).toBe(profilePatch)
  const again = await f.run()
  expect(JSON.parse(again.stdout)).toMatchObject({ changedFiles: [] })
  expect(await readdir(join(f.home, 'backups'))).toEqual(backups)
})

it('rejects malformed patches before changing any file or creating a backup', async () => {
  const f = await fixture()
  const patch = join(f.home, 'cordis.patch.yml')
  const original = '[{id: llm-pi-ai, config: {providers: {antigravity: {}}}}]'
  await writeFile(patch, original)
  const profile = join(f.home, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'cordis.patch.yml'), 'broken: [')
  await expect(f.run()).rejects.toMatchObject({ code: 1 })
  expect(await readFile(patch, 'utf8')).toBe(original)
  expect(await readdir(f.home)).not.toContain('backups')
})

it('rejects invalid UTF-8 without rewriting original bytes', async () => {
  const f = await fixture()
  const patch = join(f.home, 'cordis.patch.yml')
  const original = Buffer.concat([Buffer.from('- id: llm-pi-ai\n  config:\n    providers:\n      antigravity: '), Buffer.from([0xff])])
  await writeFile(patch, original)
  await expect(f.run()).rejects.toMatchObject({ code: 1 })
  expect(await readFile(patch)).toEqual(original)
  expect(await readdir(f.home)).not.toContain('backups')
})

it('rejects shared YAML aliases before changing configuration', async () => {
  const f = await fixture()
  const patch = join(f.home, 'cordis.patch.yml')
  const original = '- id: unrelated\n  config: &shared\n    providers:\n      antigravity: {}\n- id: llm-pi-ai\n  config: *shared\n'
  await writeFile(patch, original)
  await expect(f.run()).rejects.toMatchObject({ code: 1 })
  expect(await readFile(patch, 'utf8')).toBe(original)
  expect(await readdir(f.home)).not.toContain('backups')
})
