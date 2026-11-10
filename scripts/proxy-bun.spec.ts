import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'

type Kind = 'sb' | 'antigravity'
const scripts: Record<Kind, string> = {
  sb: fileURLToPath(new URL('./sb-transport.cjs', import.meta.url)),
  antigravity: fileURLToPath(new URL('../packages/experimental/pi-tui/tools/antigravity-proxy/antigravity_proxy.mjs', import.meta.url)),
}
const answer = { candidates: [{ content: { parts: [{ text: 'สวัสดี Bun' }] }, finishReason: 'STOP' }] }

async function fixture(kind: Kind, handler: (request: IncomingMessage, response: ServerResponse) => void, timeoutMs = 1000) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bun-proxy-'))
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
  const tokenFile = join(home, 'token.json')
  await writeFile(tokenFile, JSON.stringify({
    refresh_token: 'fixture-refresh', access_token: 'fixture-access',
    expiry: Date.now() + 3600_000, project_id: 'fixture-project',
  }))
  const child = spawn('bun', ['--no-env-file', scripts[kind], ...(kind === 'sb' ? ['serve'] : [])], {
    cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, HOST: '127.0.0.1', DSH_HOME: home,
      SB_PORT: '0', SB_BACKEND: base + '/v1', SB_BACKEND_KEY: '', SB_TIMEOUT_MS: String(timeoutMs),
      ANTIGRAVITY_PORT: '0', ANTIGRAVITY_API_BASE: base, ANTIGRAVITY_TOKEN_FILE: tokenFile,
      ANTIGRAVITY_TIMEOUT_MS: String(timeoutMs), ANTIGRAVITY_CLIENT_ID: 'fixture-client',
      ANTIGRAVITY_CLIENT_SECRET: 'fixture-secret', ANTIGRAVITY_OAUTH_TOKEN_URL: base + '/token',
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
  return { endpoint, post }
}

it('SB preserves request bytes, paths, caller authorization and JSON responses under Bun', async () => {
  const f = await fixture('sb', (request, response) => {
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

it('Antigravity translates JSON with its own synthetic OAuth token under Bun', async () => {
  let authorization: string | undefined
  const f = await fixture('antigravity', (request, response) => {
    authorization = request.headers.authorization
    request.resume()
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(answer))
  })
  const response = await f.post()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    object: 'chat.completion', choices: [{ message: { content: 'สวัสดี Bun' }, finish_reason: 'stop' }],
  })
  expect(authorization).toBe('Bearer fixture-access')
})

it.each(['sb', 'antigravity'] as const)('%s streams incrementally through Bun', async (kind) => {
  const release = Promise.withResolvers<undefined>()
  const f = await fixture(kind, (request, response) => {
    request.resume()
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify(kind === 'sb' ? { choices: [{ delta: { content: 'สวัสดี Bun' } }] } : answer)}\n\n`)
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

it.each(['sb', 'antigravity'] as const)('%s returns 504 when its upstream stalls', async (kind) => {
  const f = await fixture(kind, (request) => { request.resume() })
  const response = await f.post()
  expect(response.status).toBe(504)
  expect(await response.json()).toHaveProperty('error')
})

it.each(['sb', 'antigravity'] as const)('%s cancels upstream when its client disconnects', async (kind) => {
  const disconnected = Promise.withResolvers<undefined>()
  const f = await fixture(kind, (request, response) => {
    request.resume()
    response.on('close', () => { disconnected.resolve(undefined) })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify(kind === 'sb' ? { choices: [] } : answer)}\n\n`)
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
