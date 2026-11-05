import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ScopePolicy from '@deepseek-ai/dsh-scope-policy'
import type { AddressResolver, Config } from '@deepseek-ai/dsh-scope-policy'

/**
 * Behavior suite for the target-scope policy: text-level scope judgment
 * (authorized/excluded/unparseable), the protocol allowlist, resolved-address
 * exclusion with fail-closed resolution, resolver-free literal handling, and
 * fail-loud config validation — all through the real tools pipeline with a
 * scripted resolver (no network).
 */

const PUBLIC_ANSWER: AddressResolver = async () => [{ address: '93.184.216.34', family: 4 }]

/** Boot the tools spine + the policy; the resolver is always scripted. */
async function harness(config: Config = {}, resolve: AddressResolver = PUBLIC_ANSWER): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ScopePolicy.apply(ctx, ScopePolicy.Config(config) as Config, resolve)
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'done' }] } }))
  return ctx
}

function probe(ctx: Context, args: unknown): Promise<{ isError: boolean; info: Record<string, unknown>; text: string }> {
  return ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('c1'), name: 'probe', arguments: args })
    .then(result => ({
      isError: result.isError === true,
      info: (result.error?.info ?? {}) as Record<string, unknown>,
      text: result.content.map(block => block.type === 'text' ? block.text : '').join(''),
    }))
}

describe('text-level scope judgment', () => {
  it('delegates a call inside the authorized scope unchanged', async () => {
    const ctx = await harness({ authorizedTargets: ['api.example.test'] })
    const result = await probe(ctx, { url: 'http://api.example.test/x' })
    expect(result.isError).toBe(false)
    expect(result.text).toBe('done')
  })

  it('denies a host outside the authorized list with the normalized target in info', async () => {
    const ctx = await harness({ authorizedTargets: ['api.example.test'] })
    const result = await probe(ctx, { url: 'http://other.example.test/x' })
    expect(result.isError).toBe(true)
    expect(result.info.code).toBe('SCOPE_DENIED')
    expect(result.info.reason).toContain('outside_authorized')
    expect(result.info.reason).toContain('target=other.example.test:80/x')
    expect(result.text).toContain("denied by scope policy: 'other.example.test:80/x' is outside the authorized targets")
  })

  it('an excluded target wins over authorization, including port-scoped exclusions', async () => {
    const ctx = await harness({ authorizedTargets: ['10.0.0.8'], excludedTargets: ['10.0.0.8:8080'] })
    const admin = await probe(ctx, { url: 'http://10.0.0.8:8080/admin' })
    expect(admin.info.reason).toContain('excluded_target')
    const other = await probe(ctx, { url: 'http://10.0.0.8:80/x' })
    expect(other.isError).toBe(false)
  })

  it('reads host:port tokens out of shell-command arguments', async () => {
    const ctx = await harness({ authorizedTargets: ['10.0.0.8'] })
    const result = await probe(ctx, { command: 'curl -s http://10.0.0.9:8080/x' })
    expect(result.info.reason).toContain('outside_authorized')
    expect(result.info.reason).toContain('target=10.0.0.9:8080/x')
  })

  it('an empty authorized list is unrestricted: only exclusions bind', async () => {
    const ctx = await harness({})
    const result = await probe(ctx, { url: 'http://anywhere.example.test/' })
    expect(result.isError).toBe(false)
  })

  it('denies a URL-shaped argument that fails normalization (fail-closed)', async () => {
    const ctx = await harness({})
    const result = await probe(ctx, { url: 'http://[bad' })
    expect(result.info.reason).toContain('unparseable_target')
  })
})

describe('protocol allowlist', () => {
  it('denies a scheme outside the allowed list before any target judgment', async () => {
    const ctx = await harness({ authorizedTargets: ['file.example.test'] })
    const file = await probe(ctx, { url: 'file:///etc/passwd' })
    expect(file.info.reason).toContain('unsupported_protocol')
    const ftp = await probe(ctx, { command: 'curl ftp://10.0.0.8/x' })
    expect(ftp.info.reason).toContain('unsupported_protocol')
  })
})

describe('resolved-address judgment', () => {
  it('denies a hostname that resolves to an excluded IP literal', async () => {
    const ctx = await harness(
      { excludedTargets: ['127.0.0.1'] },
      async () => [{ address: '127.0.0.1', family: 4 }],
    )
    const result = await probe(ctx, { url: 'http://localhost:3000/' })
    expect(result.info.reason).toContain('resolved_excluded')
  })

  it('fails closed when a candidate hostname does not resolve', async () => {
    const ctx = await harness(
      { authorizedTargets: ['api.example.test'] },
      async () => { throw new Error('ENOTFOUND') },
    )
    const result = await probe(ctx, { url: 'http://api.example.test/' })
    expect(result.info.reason).toContain('unresolved_host')
  })

  it('skips resolution for IP literals and when enforcement has no scope entries', async () => {
    const resolve = vi.fn(PUBLIC_ANSWER)
    const literal = await harness({ authorizedTargets: ['10.0.0.8'] }, resolve)
    await probe(literal, { url: 'http://10.0.0.8:80/x' })
    expect(resolve).not.toHaveBeenCalled()

    const unrestricted = await harness({}, resolve)
    await probe(unrestricted, { url: 'http://named.example.test/' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('resolveAddresses: false disables resolution entirely', async () => {
    const resolve = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }])
    const ctx = await harness({ excludedTargets: ['127.0.0.1'], resolveAddresses: false }, resolve)
    const result = await probe(ctx, { url: 'http://localhost:3000/' })
    expect(result.isError).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('config validation fails loud', () => {
  it('rejects an unparsable scope entry', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(ScopePolicy, { authorizedTargets: ['not a host'] })).rejects.toThrow(/parsable/)
  })

  it('rejects an empty allowedSchemes list and malformed tokens', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(ScopePolicy, { allowedSchemes: [] })).rejects.toThrow(/allowedSchemes/)
    const ctx2 = new Context()
    await mountAgentLoopTestDependencies(ctx2)
    await expect(ctx2.plugin(ScopePolicy, { allowedSchemes: ['bad scheme'] })).rejects.toThrow(/invalid scheme token/)
  })
})
