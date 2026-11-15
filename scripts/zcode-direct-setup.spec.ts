import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import YAML from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'

const script = fileURLToPath(new URL('./zcode-direct-setup.mjs', import.meta.url))
const endpoint = 'http://127.0.0.1:18080/v1'
const tags = { schema: YAML.DEFAULT_SCHEMA.extend([new YAML.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: (value: unknown) => ({ __jsExpr: value }),
})]) }
interface Provider {
  displayName?: string
  baseURL?: string | { __jsExpr: string }
  apiKeyEnv?: string
  models?: { id: string; name?: string }[]
}
interface Entry {
  id?: string
  config?: { providers?: Record<string, Provider> }
  insert?: Entry[]
}

async function fixture(text: string, key = 'fixture-zcode-key') {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-zcode-setup-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const home = join(directory, 'home')
  await mkdir(home)
  await writeFile(join(directory, 'config.yaml'), YAML.dump({ auth: { proxyApiKey: key } }))
  const patch = join(home, 'cordis.patch.yml')
  await writeFile(patch, text)
  await writeFile(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  KEEP: untouched\n')
  const run = () => {
    const result = spawnSync('bun', ['--no-env-file', script, directory], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DSH_HOME: home, ZCODE_PROXY_API_KEY: 'unused-shell-key' },
      encoding: 'utf8', windowsHide: true, timeout: 30000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.stdout + result.stderr).not.toContain('fixture-zcode-key')
    return result
  }
  const providers = async () => {
    const rows = YAML.load(await readFile(patch, 'utf8'), tags) as Entry[]
    return rows.flatMap(row => row.insert ?? [row]).find(row => row.id === 'llm-pi-ai')!.config!.providers!
  }
  return { home, patch, run, providers }
}

it('adds the Starter catalog without changing the router or credential references', async () => {
  const other = { baseURL: 'http://127.0.0.1:20128/v1', models: [{ id: 'router-model', name: 'Main model' }] }
  const f = await fixture(YAML.dump([{ insert: [{ id: 'llm-pi-ai', config: { providers: { router: other } } }] }]))
  expect(f.run().status).toBe(0)
  const providers = await f.providers()
  expect(providers.router).toEqual(other)
  expect(providers['zcode-direct']).toMatchObject({
    displayName: 'zcode(starter-direct)', baseURL: endpoint, apiKeyEnv: 'ZCODE_DIRECT_API_KEY',
    models: [
      { id: 'glm-5.3', name: 'GLM 5.3 (starter-direct)' },
      { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash (starter-direct)' },
    ],
  })
  expect(YAML.load(await readFile(join(f.home, '.credentials.yaml'), 'utf8'))).toEqual({
    version: 1, refs: { KEEP: 'untouched', ZCODE_DIRECT_API_KEY: 'fixture-zcode-key' },
  })
  const before = await readFile(f.patch, 'utf8')
  expect(f.run().status).toBe(0)
  expect(await readFile(f.patch, 'utf8')).toBe(before)
})

it('rejects an invalid config key before changing the credential store', async () => {
  const f = await fixture('- id: llm-pi-ai\n  config:\n    providers: {}\n', 'invalid\nkey')
  const before = await readFile(join(f.home, '.credentials.yaml'), 'utf8')
  expect(f.run().status).toBe(1)
  expect(await readFile(join(f.home, '.credentials.yaml'), 'utf8')).toBe(before)
})

it('distinguishes all four ZCode routes while preserving ids, endpoints and model settings', async () => {
  const original = {
    zai: { models: [{ id: 'glm-5.3', name: 'GLM-5.3' }] },
    'zai-payg': { baseURL: 'https://api.z.ai/api/paas/v4', models: [{ id: 'glm-5.3' }] },
    'zcode-glm': { displayName: 'ZCode Starter via 9Router', baseURL: 'http://127.0.0.1:20128/v1', models: [{ id: 'zcode/glm-5.3' }] },
    'zcode-direct': { displayName: 'zcode-starter', baseURL: endpoint, models: [{ id: 'glm-5.3', name: 'GLM 5.3 (zcode-starter)' }] },
  }
  const f = await fixture(YAML.dump([{ id: 'llm-pi-ai', config: { providers: original } }]))
  expect(f.run().status).toBe(0)
  const providers = await f.providers()
  expect(providers).toEqual({
    zai: { ...original.zai, displayName: 'zcode(coding plan)' },
    'zai-payg': { ...original['zai-payg'], displayName: 'zcode(pay-g)' },
    'zcode-glm': { ...original['zcode-glm'], displayName: 'zcode(starter-9router)' },
    'zcode-direct': { ...original['zcode-direct'], displayName: 'zcode(starter-direct)', models: [{ id: 'glm-5.3', name: 'GLM 5.3 (starter-direct)' }] },
  })
})

it.each([endpoint, JSON.stringify(endpoint)])('repairs the tagged literal URL and legacy labels: %s', async (scalar) => {
  const f = await fixture(`- id: llm-pi-ai
  config:
    providers:
      zcode-direct:
        displayName: ZCode Direct
        baseURL: !!js ${scalar}
        apiKeyEnv: KEEP_REFERENCE
        models:
          - { id: glm-5.3, name: GLM 5.3 (ZCode Direct) }
          - { id: glm-5.3-flash, name: Custom flash name }
      sb-proxy:
        displayName: SB Proxy
        models:
          - { id: zcode/glm-5.3-flash, name: GLM 5.3 Flash (SB Proxy) }
          - { id: other/model, name: Main model }
- id: unrelated
  config:
    value: !!js "process.env.OTHER_SETTING"
`)
  expect(f.run().status).toBe(0)
  const providers = await f.providers()
  expect(providers['zcode-direct']).toMatchObject({
    displayName: 'zcode(starter-direct)', baseURL: endpoint, apiKeyEnv: 'KEEP_REFERENCE',
    models: [{ id: 'glm-5.3', name: 'GLM 5.3 (starter-direct)' }, { id: 'glm-5.3-flash', name: 'Custom flash name' }],
  })
  expect(providers['sb-proxy']).toEqual({ displayName: 'SB Proxy', models: [
    { id: 'zcode/glm-5.3-flash', name: 'GLM 5.3 Flash (starter-9router)' }, { id: 'other/model', name: 'Main model' },
  ] })
  const after = await readFile(f.patch, 'utf8')
  const rows = YAML.load(after, tags) as { id: string; config: { value?: { __jsExpr: string } } }[]
  const expression = rows.find(row => row.id === 'unrelated')!.config.value!.__jsExpr
  expect(expression).toBe('process.env.OTHER_SETTING')
  expect(() => new Script(expression)).not.toThrow()
  expect(f.run().status).toBe(0)
  expect(await readFile(f.patch, 'utf8')).toBe(after)
})

it('preserves a custom display name, URL expression and model label', async () => {
  const f = await fixture(`- id: llm-pi-ai
  config:
    providers:
      zcode-direct:
        displayName: My provider
        baseURL: !!js "process.env.CUSTOM_ZCODE_URL"
        apiKeyEnv: MY_REFERENCE
        models:
          - { id: glm-5.3-flash, name: My flash }
`)
  const before = await f.providers()
  expect(f.run().status).toBe(0)
  expect(await f.providers()).toEqual(before)
})

it('rejects a malformed existing provider without rewriting the home patch', async () => {
  const text = '- id: llm-pi-ai\n  config:\n    providers:\n      zcode-direct: invalid\n'
  const f = await fixture(text)
  expect(f.run().status).toBe(1)
  expect(await readFile(f.patch, 'utf8')).toBe(text)
})
