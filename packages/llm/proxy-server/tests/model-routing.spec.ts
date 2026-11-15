import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { getGlobalDispatcher } from 'undici'
import { boot, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import LlmRuntime, { type StreamChunk, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import Settings from '@deepseek-ai/dsh-settings'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import ProxyServers from '../src/index.ts'

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing TCP port')
  return address.port
}

async function fixture(available = true, status = 200, partial: boolean | 'broken' = false, responseBody = 'selected model response', sbEnabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-model-route-'))
  const sockets = new Set<Socket>()
  const observed: { path: string | undefined; auth: string | undefined; body: string }[] = []
  const received: string[] = []
  let tunnels = 0
  let authorization: string | undefined
  let breakStream = (): void => {}
  const backend = createServer((req, res) => {
    let body = ''
    req.on('data', (part) => { body += String(part) })
    req.on('end', () => {
      observed.push({ path: req.url, auth: req.headers.authorization, body })
      res.writeHead(status)
      if (partial) { breakStream = () => res.destroy(); res.write('first chunk'); return }
      res.end(responseBody)
    })
  })
  const proxy = createServer((_req, res) => {
    res.writeHead(available ? 200 : 503)
    res.end(JSON.stringify({ service: 'dsh-sb-transport', supportsConnect: available }))
  })
  for (const server of [backend, proxy]) server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  onTestFinished(async () => {
    for (const socket of sockets) socket.destroy()
    for (const server of [proxy, backend]) {
      server.closeAllConnections()
      if (server.listening) await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve() })
      })
    }
    await rm(root, { recursive: true, force: true })
  })
  const port = await listen(backend)
  proxy.on('connect', (req, client, head) => {
    tunnels++
    authorization = req.headers['proxy-authorization']
    expect(req.url).toBe(`127.0.0.1:${port}`)
    const upstream = connect({ host: '127.0.0.1', port })
    sockets.add(upstream)
    upstream.once('close', () => sockets.delete(upstream))
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(client); client.pipe(upstream)
    })
    client.once('close', () => upstream.destroy())
    client.once('error', () => upstream.destroy())
    upstream.once('error', () => client.destroy())
  })
  const proxyPort = await listen(proxy)
  const profile: ProfileContext = { name: 'test', dir: root, home: root, patchPath: join(root, 'cordis.patch.yml'),
    installAnchor: join(root, 'apps/cli/package.json'), cwd: root, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined }
  const file = join(root, 'cordis.yml')
  await writeFile(file, JSON.stringify([
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'llm', name: 'cordis:llm' },
    { id: 'proxy-servers', name: 'cordis:proxy', config: { sbPort: proxyPort, routeAllModels: true, sbEnabled, externalProxies: ['sb'] } },
  ]))
  const previous = getGlobalDispatcher()
  const ctx = await boot('routing-test', file, [], (inner) => {
    inner.provide('profileContext', profile)
    inner.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(inner.loader.builtins, { editor: ConfigEditor, settings: Settings, llm: LlmRuntime, proxy: ProxyServers })
  })
  onTestFinished(() => ctx.fiber.dispose())
  const url = `http://127.0.0.1:${port}`
  async function request(path = '/v1/chat/completions', signal?: AbortSignal) {
    const options: GenerateOptions = { provider: 'chosen-provider', model: 'chosen-model', messages: [], ...(signal ? { signal } : {}) }
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.waterfall(ctx.llm, 'llm/stream', options, async function* (): AsyncGenerator<StreamChunk> {
      const response = await fetch(url + path, { method: 'POST', body: JSON.stringify({ model: options.model, prompt: 'unchanged' }),
        headers: { authorization: 'Bearer fixture' }, signal: signal ?? null })
      if (partial) {
        const reader = response.body?.getReader()
        if (reader === undefined) throw new Error('missing body')
        await reader.read()
        if (partial === 'broken') { breakStream(); await reader.read() }
        else await reader.cancel()
      } else received.push(await response.text())
      yield { type: 'finish', reason: { kind: 'stop' } }
    })) chunks.push(chunk)
    return chunks
  }
  const token = await readFile(join(root, 'run/sb-connect.key'), 'utf8')
  return { ctx, url, request, observed, received, previous, token,
    get authorization() { return authorization }, get tunnels() { return tunnels } }
}

it.each(['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1beta/models/gemini:generateContent'])('keeps provider request %s unchanged through SB', async (path) => {
  const f = await fixture()
  await f.request(path)
  expect(f.tunnels).toBe(1)
  expect(f.authorization).toBe(`Basic ${Buffer.from(`dsh:${f.token}`).toString('base64')}`)
  expect(f.observed).toEqual([{ path, auth: 'Bearer fixture', body: JSON.stringify({ model: 'chosen-model', prompt: 'unchanged' }) }])
})

it('preserves SSE tool-call deltas, Unicode arguments and the completion marker', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_file","arguments":""}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"เอกสาร.txt\\"}"}}]}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')
  const f = await fixture(true, 200, false, sse)
  await f.request()
  expect(f.tunnels).toBe(1)
  expect(f.received).toEqual([sse])
  expect(f.observed).toHaveLength(1)
})

it('blocks before dispatch when the proxy is unavailable', async () => {
  const f = await fixture(false)
  expect(await f.request()).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'proxy-server/start-failed' } } }])
  expect(f.tunnels).toBe(0)
  expect(f.observed).toHaveLength(0)
})

it('blocks before dispatch when SB usage is disabled', async () => {
  const f = await fixture(true, 200, false, undefined, false)
  expect(await f.request()).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'proxy-server/start-failed' } } }])
  expect(f.tunnels).toBe(0)
  expect(f.observed).toHaveLength(0)
})

it('does not replay an upstream error through the direct route', async () => {
  const f = await fixture(true, 500)
  await f.request()
  expect(f.tunnels).toBe(1)
  expect(f.observed).toHaveLength(1)
})

it('does not replay a canceled partial response', async () => {
  const f = await fixture(true, 200, true)
  await f.request()
  expect(f.tunnels).toBe(1)
  expect(f.observed).toHaveLength(1)
})

it('does not replay a broken response after receiving its first chunk', async () => {
  const f = await fixture(true, 200, 'broken')
  await expect(f.request()).rejects.toThrow()
  expect(f.tunnels).toBe(1)
  expect(f.observed).toHaveLength(1)
})

it('keeps unrelated fetches direct and restores the global dispatcher on unload', async () => {
  const f = await fixture()
  await Promise.all([f.request(), fetch(f.url + '/unrelated').then(response => response.text())])
  expect(f.tunnels).toBe(1)
  expect(f.observed).toHaveLength(2)
  await f.ctx.fiber.dispose()
  expect(getGlobalDispatcher()).toBe(f.previous)
  await fetch(f.url + '/after-unload').then(response => response.text())
  expect(f.tunnels).toBe(1)
  expect(f.observed).toHaveLength(3)
})

it('does not dispatch a canceled model request', async () => {
  const f = await fixture()
  const controller = new AbortController(); controller.abort()
  expect(await f.request(undefined, controller.signal)).toMatchObject([{ type: 'finish', reason: { kind: 'aborted' } }])
  expect(f.tunnels).toBe(0)
  expect(f.observed).toHaveLength(0)
})
