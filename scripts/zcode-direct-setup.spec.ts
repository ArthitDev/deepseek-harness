import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'

async function fixture(key: string) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-zcode-setup-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  await writeFile(join(home, 'config.yaml'), YAML.dump({ auth: { proxyApiKey: key } }))
  await writeFile(join(home, '.credentials.yaml'), YAML.dump({ version: 1, refs: { EXISTING: 'fixture-existing' } }))
  await writeFile(join(home, 'cordis.patch.yml'), YAML.dump([{ id: 'llm-pi-ai', config: {
    providers: { router: { baseURL: 'http://127.0.0.1:20128/v1', models: [{ id: 'zcode/glm-5.3' }] } },
  } }]))
  const run = () => spawnSync('bun', ['--no-env-file', fileURLToPath(new URL('./zcode-direct-setup.mjs', import.meta.url)), home], {
    env: { ...process.env, DSH_HOME: home, ZCODE_PROXY_API_KEY: 'fixture-unrelated-shell-key' },
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
  })
  return { home, run }
}

it('imports the managed config key and adds a separate direct provider without changing the router', async () => {
  const f = await fixture('fixture-config-key')
  const result = f.run()
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).toBe(0)
  expect(result.stdout + result.stderr).not.toContain('fixture-config-key')
  expect(YAML.load(await readFile(join(f.home, '.credentials.yaml'), 'utf8'))).toEqual({
    version: 1, refs: { EXISTING: 'fixture-existing', ZCODE_DIRECT_API_KEY: 'fixture-config-key' },
  })
  const patch = YAML.load(await readFile(join(f.home, 'cordis.patch.yml'), 'utf8'))
  expect(patch).toMatchObject([{ config: { providers: {
    router: { baseURL: 'http://127.0.0.1:20128/v1', models: [{ id: 'zcode/glm-5.3' }] },
    'zcode-direct': { baseURL: 'http://127.0.0.1:18080/v1', apiKeyEnv: 'ZCODE_DIRECT_API_KEY' },
  } } }])
  const before = await readFile(join(f.home, 'cordis.patch.yml'), 'utf8')
  expect(f.run().status).toBe(0)
  expect(await readFile(join(f.home, 'cordis.patch.yml'), 'utf8')).toBe(before)
})

it('rejects an invalid config key before changing the credential store', async () => {
  const f = await fixture('invalid\nkey')
  const before = await readFile(join(f.home, '.credentials.yaml'), 'utf8')
  const result = f.run()
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).toBe(1)
  expect(await readFile(join(f.home, '.credentials.yaml'), 'utf8')).toBe(before)
})
