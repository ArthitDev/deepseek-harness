import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

const script = fileURLToPath(new URL('./sb-transport.cjs', import.meta.url))

async function fixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void, timeoutMs = 1000,
) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bun-proxy-'))
  // Exercise standalone transport without loading the checkout's optional SB pipeline or credentials.
  const transport = join(home, 'sb-transport.cjs')
  await copyFile(script, transport)
  const upstream = createServer(handler)
  const running: { child?: ChildProcess; closed?: Promise<unknown> } = {}
  onTestFinished(async () => {
    if (running.child && running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill()
      const force = setTimeout(() => { running.child?.kill('SIGKILL') }, 2000)
      try { await running.closed } finally { clearTimeout(force) }
    }
    upstream.closeAllConnections()
    if (upstream.listening) await new Promise<void>((done, reject) => upstream.close((error) => { if (error) reject(error); else done() }))
    await rm(home, { recursive: true, force: true })
  })
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done))
  const address = upstream.address()
  if (address === null || typeof address === 'string') throw new Error('Missing upstream port')
  const base = `http://127.0.0.1:${address.port}`
  const child = spawn('bun', ['--no-env-file', transport, 'serve'], {
    cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, HOST: '127.0.0.1', DSH_HOME: home,
      SB_PORT: '0', SB_BACKEND: base + '/v1', SB_BACKEND_KEY: '', SB_TIMEOUT_MS: String(timeoutMs),
    },
  })
  running.child = child
  running.closed = once(child, 'close')
  const endpoint = await new Promise<string>((done, reject) => {
    let output = ''
    const timer = setTimeout(() => { reject(new Error('Proxy startup timed out: ' + output)) }, 5000)
    const finish = (error?: Error, url?: string) => {
      clearTimeout(timer)
      if (error) reject(error)
      else if (url) done(url)
    }
    child.once('error', (error) => { finish(error) })
    child.once('exit', (code) => { finish(new Error('Proxy exited: ' + String(code) + ' ' + output)) })
    child.stderr?.on('data', (chunk) => { output += String(chunk) })
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/i.exec(output)
      if (match) finish(undefined, match[1])
    })
  })
  const post = (stream = false, signal?: AbortSignal) => fetch(endpoint + '/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-client' },
    body: JSON.stringify({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'ทดสอบ' }], stream }),
    signal: signal ?? null,
  })
  return { endpoint, base, post, home }
}

it.each(['/v1/messages', '/v1beta/models/gemini:streamGenerateContent'])('SB CONNECT preserves %s and the selected request', async (path) => {
  const f = await fixture((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
    request.on('end', () => response.end(JSON.stringify({ path: request.url, auth: request.headers.authorization, body })))
  })
  const authenticated = new URL(f.endpoint)
  authenticated.username = 'dsh'
  authenticated.password = await readFile(join(f.home, 'run/sb-connect.key'), 'utf8')
  const proxy = new ProxyAgent({ uri: authenticated.href, proxyTunnel: true })
  onTestFinished(() => proxy.destroy())
  const body = JSON.stringify({ model: 'unchanged-model', prompt: 'unchanged prompt' })
  const response = await undiciFetch(f.base + path, { dispatcher: proxy, method: 'POST', headers: { authorization: 'Bearer fixture' }, body })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ path, auth: 'Bearer fixture', body })
  expect(await (await fetch(f.endpoint + '/health')).json()).toMatchObject({ supportsConnect: true })
})

it('SB rejects CONNECT without the runtime credential before reaching a target', async () => {
  let reached = 0
  const f = await fixture((_req, response) => { reached++; response.end('unexpected') })
  const proxy = new ProxyAgent({ uri: f.endpoint, proxyTunnel: true })
  onTestFinished(() => proxy.destroy())
  await expect(undiciFetch(f.base, { dispatcher: proxy })).rejects.toThrow()
  expect(reached).toBe(0)
})

it('standalone SB transport preserves request bytes, paths, caller authorization and JSON responses under Bun', async () => {
  const f = await fixture((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json')
      const parsed: unknown = JSON.parse(body)
      response.end(JSON.stringify({ path: request.url, authorization: request.headers.authorization, body: parsed }))
    })
  })
  const response = await f.post()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    path: '/v1/chat/completions', authorization: 'Bearer fixture-client',
    body: { model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'ทดสอบ' }], stream: false },
  })
})

it('SB streams incrementally through Bun', async () => {
  const release = Promise.withResolvers<undefined>()
  const f = await fixture((request, response) => {
    request.resume()
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'สวัสดี Bun' } }] })}\n\n`)
    void release.promise.then(() => response.end('data: [DONE]\n\n'))
  })
  try {
    const response = await f.post(true)
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing response stream')
    let text = ''
    while (!text.includes('สวัสดี Bun')) {
      const first = await reader.read()
      if (first.done) throw new Error('Stream ended before content')
      text += new TextDecoder().decode(first.value)
    }
    expect(text).not.toContain('[DONE]')
    release.resolve(undefined)
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      text += new TextDecoder().decode(next.value)
    }
    expect(text).toContain('data: [DONE]')
  } finally { release.resolve(undefined) }
})

it('SB returns 504 when its upstream stalls', async () => {
  const f = await fixture((request) => { request.resume() })
  const response = await f.post()
  expect(response.status).toBe(504)
  expect(await response.json()).toHaveProperty('error')
})

it('SB cancels upstream when its client disconnects', async () => {
  const disconnected = Promise.withResolvers<undefined>()
  const f = await fixture((request, response) => {
    request.resume()
    response.on('close', () => { disconnected.resolve(undefined) })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ choices: [] })}\n\n`)
  }, 10_000)
  const controller = new AbortController()
  try {
    const response = await f.post(true, controller.signal)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing response stream')
    expect((await reader.read()).done).toBe(false)
    controller.abort()
    await disconnected.promise
  } finally { controller.abort() }
})
