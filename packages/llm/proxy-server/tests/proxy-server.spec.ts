import { copyFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import LlmRuntime, { type StreamChunk, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import ProxyServers from '../src/index.ts'
import type { ProxyId } from '../src/types.ts'

async function listen(server: Server): Promise<number> {
  await new Promise<void>((complete) => { server.listen(0, '127.0.0.1', complete) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No TCP address')
  return address.port
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((complete, reject) => { server.close((error) => { if (error === undefined) complete(); else reject(error) }) })
}
async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-test-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const config = {
    routeAllModels: false,
    zcodeEnabled: true, sbEnabled: true,
    zcodePort: 1, sbPort: 3,
    sbProviders: ['sb'], startupTimeoutMs: 1000,
    externalProxies: [] as ProxyId[],
  }
  const dir = join(root, 'profiles/test')
  await mkdir(dir, { recursive: true })
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(root, 'apps/cli/package.json'), cwd: root, home: root, overlays: [], telemetryDisabledEnv: undefined,
  }
  let ctx: Context
  const prepareSidecar = async (): Promise<void> => {
    const reservation = createServer()
    config.sbPort = await listen(reservation)
    await close(reservation)
    await mkdir(join(root, 'scripts'), { recursive: true })
    const script = 'scripts/sb-transport.cjs'
    await mkdir(join(root, script, '..'), { recursive: true })
    await writeFile(join(root, script), "import http from 'node:http';http.createServer((req,res)=>res.end(JSON.stringify({service:'dsh-sb-transport',runtime:process.versions.bun?'bun':'node',customHome:process.env.DSH_HOME}))).listen(Number(process.env.SB_PORT),'127.0.0.1')")
  }
  const mount = async () => {
    await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' },
      { id: 'settings', name: 'cordis:settings' },
      { id: 'llm', name: 'cordis:llm' },
      { id: 'proxy-servers', name: 'cordis:proxy', config },
    ] }]))
    ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (inner) => {
      inner.provide('profileContext', profile)
      inner.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(inner.loader.builtins, { editor: ConfigEditor, settings: Settings, llm: LlmRuntime, proxy: ProxyServers })
    })
    const mounted = ctx
    onTestFinished(() => mounted.fiber.dispose())
    return ctx.proxyServers
  }
  return { root, get ctx() { return ctx }, config, mount, prepareSidecar }
}

it('reads only ZCode and SB without starting either, and records independent usage switches', async () => {
  const f = await fixture()
  const service = await f.mount()
  expect(await service.list()).toMatchObject([
    { id: 'zcode', available: false, status: 'stopped', providers: ['zcode-direct', 'zcode-glm'] },
    { id: 'sb', available: false, status: 'stopped' },
  ])
  await service.setEnabled('zcode', false)
  expect((await service.list()).map(row => row.enabled)).toEqual([false, true])
  await expect(service.setEnabled('sb', true)).rejects.toThrow('missing')
  await f.ctx.fiber.dispose()
  expect((await (await f.mount()).list()).map(row => row.enabled)).toEqual([false, true])
})

it('authenticates managed SB routing with a custom Harness home', async () => {
  const f = await fixture()
  f.config.routeAllModels = true
  await f.prepareSidecar()
  await copyFile(new URL('../../../../scripts/sb-transport.cjs', import.meta.url), join(f.root, 'scripts/sb-transport.cjs'))
  const target = createServer((_request, response) => response.end('custom home CONNECT succeeded'))
  const port = await listen(target)
  onTestFinished(() => close(target))
  await f.mount()
  let answer = ''
  await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', { provider: 'other', model: 'selected-model', messages: [] }, async function* (): AsyncGenerator<StreamChunk> {
    answer = await (await fetch(`http://127.0.0.1:${port}/model`)).text()
    yield { type: 'finish', reason: { kind: 'stop' } }
  }))
  expect(answer).toBe('custom home CONNECT succeeded')
  expect((await f.ctx.proxyServers.list()).find(row => row.id === 'sb')).toMatchObject({ status: 'running' })
})

it('waits for a managed SB child to support CONNECT before model dispatch', async () => {
  const f = await fixture()
  f.config.routeAllModels = true
  await f.prepareSidecar()
  await writeFile(join(f.root, 'scripts/sb-transport.cjs'), "const http=require('node:http');let checks=0;http.createServer((req,res)=>res.end(JSON.stringify({service:'dsh-sb-transport',supportsConnect:++checks>1}))).listen(Number(process.env.SB_PORT),'127.0.0.1')")
  await f.mount()
  const next = vi.fn(async function* (): AsyncGenerator<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } })
  const result = await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', { provider: 'other', model: 'selected-model', messages: [] }, next))
  expect(result).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(next).toHaveBeenCalledOnce()
  expect((await f.ctx.proxyServers.list()).find(row => row.id === 'sb')).toMatchObject({ status: 'running' })
})

it('cancels a managed SB startup and awaits child shutdown on unload', async () => {
  const f = await fixture()
  f.config.routeAllModels = true
  f.config.startupTimeoutMs = 5000
  await f.prepareSidecar()
  await writeFile(join(f.root, 'scripts/sb-transport.cjs'), "const http=require('node:http');http.createServer((req,res)=>res.end(JSON.stringify({service:'dsh-sb-transport',supportsConnect:false}))).listen(Number(process.env.SB_PORT),'127.0.0.1')")
  const service = await f.mount()
  const next = vi.fn(async function* (): AsyncGenerator<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } })
  const controller = new AbortController()
  const pending = collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', { provider: 'other', model: 'selected-model', messages: [], signal: controller.signal }, next))
  await expect.poll(async () => (await f.ctx.proxyServers.list()).find(row => row.id === 'sb')?.status).toBe('port-in-use')
  controller.abort()
  expect(await pending).toMatchObject([{ type: 'finish', reason: { kind: 'aborted' } }])
  expect(next).not.toHaveBeenCalled()
  await f.ctx.fiber.dispose()
  expect((await service.list()).find(row => row.id === 'sb')).toMatchObject({ status: 'stopped' })
})

it('leaves an external proxy running after disable and distinguishes occupied ports', async () => {
  const f = await fixture()
  const external = createServer((_req, res) => { res.setHeader('x-dsh-proxy-service', 'zcode-proxy'); res.end('{}') })
  f.config.zcodePort = await listen(external)
  f.config.externalProxies = ['zcode']
  onTestFinished(() => close(external))
  const other = createServer((_req, res) => { res.end('{}') })
  f.config.sbPort = await listen(other)
  onTestFinished(() => close(other))
  const service = await f.mount()
  expect((await service.list()).find(row => row.id === 'zcode')).toMatchObject({ status: 'external' })
  await service.setEnabled('zcode', false)
  expect(external.listening).toBe(true)
  expect((await service.list()).find(row => row.id === 'zcode')).toMatchObject({ enabled: false, status: 'external' })
  await expect(service.setEnabled('sb', true)).rejects.toThrow('occupied')
  expect(other.listening).toBe(true)
})

it('starts sb with Bun, serializes repeated switches and awaits its stop', async () => {
  const id = 'sb'
  const f = await fixture()
  await f.prepareSidecar()
  const service = await f.mount()
  await Promise.all([service.setEnabled(id, true), service.setEnabled(id, true)])
  expect((await service.list()).find(row => row.id === id)).toMatchObject({ status: 'running' })
  const health: unknown = await (await fetch(`http://127.0.0.1:${f.config[`${id}Port`]}/health`)).json()
  expect(health).toMatchObject({ runtime: 'bun' })
  if (id === 'sb') expect(health).toMatchObject({ customHome: f.root })
  const { customHome: _customHome, ...stable } = health as { customHome?: string; runtime: string; service: string }
  expect(stable).toMatchSnapshot()
  await service.setEnabled(id, false)
  expect((await service.list()).find(row => row.id === id)).toMatchObject({ status: 'stopped', enabled: false })
  await service.setEnabled(id, true)
  await f.ctx.fiber.dispose()
  expect((await service.list()).find(row => row.id === id)).toMatchObject({ status: 'stopped' })
})

it('refuses an unowned ZCode port even when it answers with a generic authentication response', async () => {
  const f = await fixture()
  const unrelated = createServer((_req, res) => { res.writeHead(401); res.end('{}') })
  f.config.zcodePort = await listen(unrelated)
  onTestFinished(() => close(unrelated))
  const service = await f.mount()
  expect((await service.list()).find(row => row.id === 'zcode')).toMatchObject({ status: 'port-in-use' })
  await expect(service.setEnabled('zcode', true)).rejects.toMatchObject({ code: 'proxy-server/port-in-use' })
  const next = vi.fn(async function* (): AsyncGenerator<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } })
  const result = await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', { provider: 'zcode-direct', model: 'glm', messages: [] }, next))
  expect(result).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'proxy-server/port-in-use' } } }])
  expect(next).not.toHaveBeenCalled()
  const starterRouter = await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', { provider: 'zcode-glm', model: 'zcode/glm-5.3-flash', messages: [] }, next))
  expect(starterRouter).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'proxy-server/port-in-use' } } }])
  expect(next).not.toHaveBeenCalled()
  expect(unrelated.listening).toBe(true)
})

it('retains ownership of a live but non-listening child until an explicit stop', async () => {
  const f = await fixture()
  await f.prepareSidecar()
  await writeFile(join(f.root, 'scripts/sb-transport.cjs'), "const http=require('node:http');const server=http.createServer((req,res)=>{if(req.url==='/stop-listening'){res.end('ok');server.close();setInterval(()=>{},1000)}else res.end(JSON.stringify({service:'dsh-sb-transport'}))});server.listen(Number(process.env.SB_PORT),'127.0.0.1')")
  const service = await f.mount()
  await service.setEnabled('sb', true)
  await fetch(`http://127.0.0.1:${f.config.sbPort}/stop-listening`)
  await expect.poll(async () => (await service.list()).find(row => row.id === 'sb')?.status).toBe('stopped')
  await expect(service.setEnabled('sb', true)).rejects.toThrow('child is not ready')
  await service.setEnabled('sb', false)
})

it('disables new use immediately and stops its child only after the active model stream settles', async () => {
  const f = await fixture()
  await f.prepareSidecar()
  const service = await f.mount()
  const gate = Promise.withResolvers<undefined>()
  const next = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    await gate.promise
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const request: GenerateOptions = { provider: 'sb', model: 'fixture', messages: [] }
  const running = collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', request, next))
  try {
    await expect.poll(() => next.mock.calls.length).toBe(1)
    await service.setEnabled('sb', false)
    expect((await service.list()).find(row => row.id === 'sb')).toMatchObject({ status: 'running', enabled: false })
    const blocked = await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', request, next))
    expect(blocked).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'proxy-server/disabled' } } }])
    expect(next).toHaveBeenCalledOnce()
  } finally { gate.resolve(undefined); await running }
  expect((await service.list()).find(row => row.id === 'sb')).toMatchObject({ status: 'stopped', enabled: false })
})

it.each(['zcode', 'sb'] as const)('keeps router models independent of the disabled %s direct provider', async (id) => {
  const f = await fixture()
  const service = await f.mount()
  await service.setEnabled(id, false)
  const next = vi.fn(async function* (): AsyncGenerator<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } })
  const request: GenerateOptions = { provider: id === 'zcode' ? 'zcode-direct' : id, model: 'fixture', messages: [] }
  const direct = await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', request, next))
  expect(direct).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'proxy-server/disabled' } } }])
  expect(next).not.toHaveBeenCalled()
  const routed = await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', { ...request, provider: '9router', model: `${id}/fixture` }, next))
  expect(routed).toMatchObject([{ type: 'finish', reason: { kind: 'stop' } }])
  expect(next).toHaveBeenCalledOnce()
  await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', { ...request, provider: 'other' }, next))
  expect(next).toHaveBeenCalledTimes(2)
})


it.each(['zcode', 'sb'] as const)('uses externally managed %s without owning its lifecycle', async (id) => {
  const f = await fixture()
  f.config.externalProxies = [id]
  const external = createServer((_req, res) => {
    if (id === 'zcode') res.setHeader('x-dsh-proxy-service', 'zcode-proxy')
    res.end(JSON.stringify({ service: id === 'sb' ? 'dsh-sb-transport' : 'zcode-proxy' }))
  })
  f.config[id === 'zcode' ? 'zcodePort' : 'sbPort'] = await listen(external)
  onTestFinished(() => close(external))
  const service = await f.mount()
  expect((await service.list()).find(row => row.id === id)).toMatchObject({ available: true, status: 'external' })
  await service.setEnabled(id, true)
  const next = vi.fn(async function* (): AsyncGenerator<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } })
  const request: GenerateOptions = { provider: id === 'zcode' ? 'zcode-direct' : id, model: 'fixture', messages: [] }
  expect(await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', request, next))).toMatchObject([{ type: 'finish', reason: { kind: 'stop' } }])
  await service.setEnabled(id, false)
  next.mockClear()
  expect(await collect(f.ctx.waterfall(f.ctx.llm, 'llm/stream', request, next))).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'proxy-server/disabled' } } }])
  expect(next).not.toHaveBeenCalled()
  await f.ctx.fiber.dispose()
  expect(external.listening).toBe(true)
})

it('rejects an externally configured ZCode listener without its integration identity', async () => {
  const f = await fixture()
  f.config.externalProxies = ['zcode']
  const external = createServer((_req, res) => { res.writeHead(401); res.end('{}') })
  f.config.zcodePort = await listen(external)
  onTestFinished(() => close(external))
  const service = await f.mount()
  expect((await service.list()).find(row => row.id === 'zcode')).toMatchObject({ available: false, status: 'port-in-use' })
  await expect(service.setEnabled('zcode', true)).rejects.toThrow('managed externally')
  expect(external.listening).toBe(true)
})

it('reports an unavailable external service without trying the local installation', async () => {
  const f = await fixture()
  f.config.externalProxies = ['zcode']
  const reservation = createServer()
  f.config.zcodePort = await listen(reservation)
  await close(reservation)
  const service = await f.mount()
  await expect(service.setEnabled('zcode', true)).rejects.toThrow('managed externally')
  expect((await service.list()).find(row => row.id === 'zcode')).toMatchObject({ available: false, status: 'stopped' })
})
