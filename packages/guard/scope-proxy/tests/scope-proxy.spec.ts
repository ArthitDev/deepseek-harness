import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import { SCOPE_PROXY_ENV, ScopeProxy } from '@deepseek-ai/dsh-scope-proxy'
import type { Config } from '@deepseek-ai/dsh-scope-proxy'

/**
 * Behavior suite for the scope-pinning proxy: absolute-form forwarding through
 * a pinned connection, CONNECT tunnel establishment, text-level and
 * resolved-address refusals, scheme refusal, the `DSH_SCOPE_PROXY` environment
 * fact, and fail-loud scope validation — all against loopback servers (no
 * external network).
 */

let origin: http.Server
let originPort: number

beforeAll(async () => {
  origin = http.createServer((_request, response) => { response.end('origin-ok') })
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve))
  originPort = (origin.address() as AddressInfo).port
})

afterAll(() => { origin.close() })

async function harness(config: Partial<Config> = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(ShellEnvRegistry, {})
  await ctx.plugin(ScopeProxy, {
    authorizedTargets: [`127.0.0.1:${originPort}`],
    excludedTargets: ['127.0.0.1:1'],
    ...config,
  } as Config)
  await ctx.scopeProxy.whenReady()
  return ctx
}

/** One absolute-form request through the proxy; resolves status + body. */
function proxyGet(ctx: Context, targetUrl: string): Promise<{ status: number; body: string }> {
  const proxy = new URL(ctx.scopeProxy.url)
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxy.hostname,
      port: proxy.port,
      path: targetUrl,
      headers: { host: new URL(targetUrl).host },
    }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += String(chunk) })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
    request.on('error', reject)
    request.end()
  })
}

/** One CONNECT tunnel through the proxy; resolves status + one HTTP GET spoken through it. */
function proxyConnect(ctx: Context, authority: string): Promise<{ status: number; body: string }> {
  const proxy = new URL(ctx.scopeProxy.url)
  return new Promise((resolve, reject) => {
    const request = http.request({ host: proxy.hostname, port: proxy.port, method: 'CONNECT', path: authority })
    request.on('connect', (response, socket) => {
      const status = response.statusCode ?? 0
      if (status !== 200) {
        let body = ''
        socket.on('data', (chunk) => { body += String(chunk) })
        socket.on('end', () => resolve({ status, body }))
        return
      }
      socket.write(`GET / HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`)
      let raw = ''
      socket.on('data', (chunk) => { raw += String(chunk) })
      socket.on('close', () => resolve({ status, body: raw.includes('origin-ok') ? 'origin-ok' : raw }))
      socket.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

describe('absolute-form forwarding', () => {
  it('forwards an in-scope request pinned to the resolved address', async () => {
    const ctx = await harness()
    const result = await proxyGet(ctx, `http://127.0.0.1:${originPort}/x`)
    expect(result.status).toBe(200)
    expect(result.body).toBe('origin-ok')
  })

  it('refuses an excluded target before any connection', async () => {
    const ctx = await harness({ authorizedTargets: [] })
    const result = await proxyGet(ctx, 'http://127.0.0.1:1/excluded')
    expect(result.status).toBe(403)
    expect(result.body).toContain("'127.0.0.1:1/excluded' is an excluded target")
  })

  it('refuses a host outside the authorized list', async () => {
    const ctx = await harness()
    const result = await proxyGet(ctx, `http://127.0.0.2:${originPort}/x`)
    expect(result.status).toBe(403)
    expect(result.body).toContain('is outside the authorized targets')
  })

  it('refuses a scheme outside the allowed list', async () => {
    const ctx = await harness({ allowedSchemes: ['https'] })
    const result = await proxyGet(ctx, `http://127.0.0.1:${originPort}/x`)
    expect(result.status).toBe(403)
    expect(result.body).toContain('uses a scheme outside the allowed protocol list')
  })

  it('fails closed when a hostname does not resolve', async () => {
    const ctx = await harness({ authorizedTargets: [] })
    const result = await proxyGet(ctx, 'http://does-not-resolve.invalid/x')
    expect(result.status).toBe(403)
    expect(result.body).toContain('could not be resolved and scope enforcement is active')
  })
})

describe('CONNECT tunneling', () => {
  it('establishes an in-scope tunnel pinned to the resolved address', async () => {
    const ctx = await harness()
    const result = await proxyConnect(ctx, `127.0.0.1:${originPort}`)
    expect(result.status).toBe(200)
    expect(result.body).toBe('origin-ok')
  })

  it('refuses an excluded authority with 403', async () => {
    const ctx = await harness({ authorizedTargets: [] })
    const result = await proxyConnect(ctx, '127.0.0.1:1')
    // Node's CONNECT client does not always surface the raw denial body; the
    // 403 status is the contract (curl shows the body).
    expect(result.status).toBe(403)
  })
})

describe('managed environment fact', () => {
  it('exposes the proxy URL as DSH_SCOPE_PROXY for every shell call', async () => {
    const ctx = await harness()
    const url = ctx.scopeProxy.url
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const value = ctx.shellEnv.collect({
      name: 'probe', arguments: {}, callId: 'c1' as never, token: Symbol('t') as never,
    } as never)[SCOPE_PROXY_ENV]
    expect(value).toBe(url)
  })
})

describe('config validation fails loud', () => {
  it('rejects an unparsable scope entry', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(ShellEnvRegistry, {})
    await expect(ctx.plugin(ScopeProxy, { authorizedTargets: ['not a host'] })).rejects.toThrow(/parsable/)
  })

  it('rejects an empty allowedSchemes list', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(ShellEnvRegistry, {})
    await expect(ctx.plugin(ScopeProxy, { allowedSchemes: [] })).rejects.toThrow(/allowedSchemes/)
  })
})
