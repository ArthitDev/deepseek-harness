import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'

const script = fileURLToPath(new URL('./antigravity-direct-setup.mjs', import.meta.url))
const tags = { schema: YAML.DEFAULT_SCHEMA.extend([new YAML.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (value: unknown) => value })]) }
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-antigravity-setup-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const patch = join(home, 'cordis.patch.yml')
  await writeFile(patch, YAML.dump([{ insert: [{ id: 'llm-pi-ai', config: { providers: {
    antigravity: { apiKeyEnv: 'OTHER_PROJECT_KEY', baseURL: 'http://127.0.0.1:8317/v1', models: [{ id: 'legacy-model' }] },
    router: { baseURL: 'http://127.0.0.1:20128/v1', models: [{ id: 'router-model' }] },
    'zcode-direct': { baseURL: 'http://127.0.0.1:18080/v1', apiKeyEnv: 'ZCODE_DIRECT_API_KEY' },
  } } }] }]))
  await writeFile(join(home, '.credentials.yaml'), 'fixture-private-content\n')
  const run = () => spawnSync('bun', ['--no-env-file', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DSH_HOME: home, ANTIGRAVITY_PORT: '18877' },
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  })
  return { home, patch, run }
}

it('migrates shared and profile routes, retains other providers and credentials, and backs up original bytes', async () => {
  const f = await fixture()
  const profile = join(f.home, 'profiles/web')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'cordis.patch.yml'), '- id: proxy-servers\n  config:\n    routeAllModels: true\n    externalProxies: [sb, antigravity]\n    zcodePort: 18080\n- id: unrelated\n  config:\n    value: !!js "process.env.TEST_VALUE"\n- id: llm-pi-ai\n  config:\n    providers:\n      custom: {baseURL: "http://127.0.0.1:9999/v1"}\n')
  const before = await readFile(f.patch, 'utf8')
  const result = f.run()
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status).toBe(0)
  const data = YAML.load(await readFile(f.patch, 'utf8')) as { insert: { config: { providers: Record<string, unknown> } }[] }[]
  expect(data[0]?.insert[0]?.config.providers).toMatchObject({
    antigravity: { baseURL: 'http://127.0.0.1:18877/v1', headers: { Authorization: 'Bearer local-antigravity' } },
    router: { baseURL: 'http://127.0.0.1:20128/v1', models: [{ id: 'router-model' }] },
    'zcode-direct': { baseURL: 'http://127.0.0.1:18080/v1', apiKeyEnv: 'ZCODE_DIRECT_API_KEY' },
  })
  expect(data[0]?.insert[0]?.config.providers.antigravity).not.toHaveProperty('apiKeyEnv')
  const profileText = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
  expect(YAML.load(profileText, tags)).toMatchObject([
    { id: 'proxy-servers', config: { externalProxies: ['sb'], antigravityPort: 18877, routeAllModels: true, zcodePort: 18080 } },
    { id: 'unrelated', config: { value: 'process.env.TEST_VALUE' } },
    { id: 'llm-pi-ai', config: { providers: { custom: { baseURL: 'http://127.0.0.1:9999/v1' } } } },
  ])
  expect(profileText).toContain('!!js')
  expect(await readFile(join(f.home, '.credentials.yaml'), 'utf8')).toBe('fixture-private-content\n')
  const backups = await readdir(join(f.home, 'backups'))
  expect(await readFile(join(f.home, 'backups', backups[0]!, '0.yml'), 'utf8')).toBe(before)
  const after = await readFile(f.patch, 'utf8')
  expect(f.run().status).toBe(0)
  expect(await readFile(f.patch, 'utf8')).toBe(after)
  expect(await readdir(join(f.home, 'backups'))).toHaveLength(1)
})

it('validates every profile before writing any configuration', async () => {
  const f = await fixture()
  const profile = join(f.home, 'profiles/tui')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'cordis.patch.yml'), '- id: proxy-servers\n  config:\n    externalProxies: !!js "process.env.EXTERNAL_PROXIES"\n')
  const before = await readFile(f.patch, 'utf8')
  expect(f.run().status).toBe(1)
  expect(await readFile(f.patch, 'utf8')).toBe(before)
})

it('keeps per-profile providers effective when no global provider override exists', async () => {
  const f = await fixture()
  await writeFile(f.patch, '[]\n')
  for (const name of ['web', 'tui']) {
    const directory = join(f.home, 'profiles', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'cordis.patch.yml'), YAML.dump([{ id: 'llm-pi-ai', config: {
      providers: { [name + '-custom']: { baseURL: 'http://127.0.0.1:9999/v1' } },
    } }]))
  }
  expect(f.run().status).toBe(0)
  expect(await readFile(f.patch, 'utf8')).toBe('[]\n')
  for (const name of ['web', 'tui']) {
    const document = YAML.load(await readFile(join(f.home, 'profiles', name, 'cordis.patch.yml'), 'utf8'))
    expect(document).toMatchObject([{ config: { providers: {
      [name + '-custom']: { baseURL: 'http://127.0.0.1:9999/v1' },
      antigravity: { baseURL: 'http://127.0.0.1:18877/v1' },
    } } }])
  }
})

it('retains the installed bundle providers when a profile has no provider override', async () => {
  const f = await fixture()
  await writeFile(f.patch, '[]\n')
  const profile = join(f.home, 'profiles/fixture')
  const bundle = join(profile, 'node_modules/fixture-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-fixture', private: true, dependencies: {},
    dsh: { profile: { bundles: ['fixture-bundle'] } },
  }))
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({
    name: 'fixture-bundle', version: '0.0.0', type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(join(bundle, 'cordis.patch.yml'), YAML.dump([{ insert: [{
    id: 'llm-pi-ai', name: 'fixture-provider', config: { providers: {
      'bundle-custom': { baseURL: 'http://127.0.0.1:9999/v1', models: [{ id: 'bundle-model' }] },
    } },
  }] }]))
  const result = f.run()
  expect(result.status, result.stderr).toBe(0)
  expect(await readFile(f.patch, 'utf8')).toBe('[]\n')
  expect(YAML.load(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'))).toMatchObject([{
    id: 'llm-pi-ai', name: 'fixture-provider', config: { providers: {
      'bundle-custom': { baseURL: 'http://127.0.0.1:9999/v1', models: [{ id: 'bundle-model' }] },
      antigravity: { baseURL: 'http://127.0.0.1:18877/v1' },
    } },
  }])
})

it.each([true, false])('setup migrates only after authentication state is available: %s', async (authenticated) => {
  const f = await fixture()
  const before = await readFile(f.patch, 'utf8')
  const service = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/health') response.end(JSON.stringify({ service: 'antigravity-proxy' }))
    else { response.statusCode = authenticated ? 200 : 503; response.end(JSON.stringify({ authenticated })) }
  })
  onTestFinished(async () => { service.closeAllConnections(); await new Promise<void>((done) => { service.close(() => { done() }) }) })
  await new Promise<void>(done => service.listen(0, '127.0.0.1', done))
  const address = service.address()
  if (!address || typeof address === 'string') throw new Error('Fixture port missing')
  const setup = fileURLToPath(new URL('../packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs', import.meta.url))
  const result = await new Promise<{ code: number | null; output: string }>((done, reject) => {
    const child = spawn('bun', ['--no-env-file', setup, '--no-browser'], {
      env: { ...process.env, DSH_HOME: f.home, ANTIGRAVITY_PORT: String(address.port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timeout = setTimeout(() => child.kill(), 15000)
    child.stdout.on('data', (value) => { output += String(value) })
    child.stderr.on('data', (value) => { output += String(value) })
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('close', (code) => { clearTimeout(timeout); done({ code, output }) })
  })
  expect(result.code).toBe(authenticated ? 0 : 1)
  expect(result.output).not.toContain('fixture-private-content')
  expect(service.listening).toBe(true)
  if (authenticated) expect(await readFile(f.patch, 'utf8')).toContain(`http://127.0.0.1:${address.port}/v1`)
  else expect(await readFile(f.patch, 'utf8')).toBe(before)
})
