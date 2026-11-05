import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// Runtime side-effect import: the service-face module is type-only, and the
// coverage gate still accounts for its (empty) runtime surface.
import '../src/core/services.ts'
import * as piTui from '../src/index.ts'

describe('plugin entry', () => {
  it('declares the canonical plugin identity and required injections', () => {
    expect(piTui.name).toBe('pi-tui')
    expect(piTui.inject).toEqual(['agents', 'cmdlineArgs', 'workspaceRegistry', 'loader', 'profileContext', 'pentestModePolicy', 'systemPrompt', 'agentPresets', 'agentDefaultModel'])
  })

  it('exposes the row-config schema', () => {
    expect(piTui.Config).toBeDefined()
  })

  it('defaults to 20 visible history items and accepts only positive integers', () => {
    expect(piTui.Config({}).historyLimit).toBe(20)
    expect(piTui.Config({ historyLimit: 50 }).historyLimit).toBe(50)
    for (const historyLimit of [0, -1, 1.5]) {
      expect(() => piTui.Config({ historyLimit })).toThrow()
    }
  })

  it('refuses to boot outside an interactive terminal', async () => {
    const ctx = new Context()
    ctx.provide('cmdlineArgs', { get: () => [] as string[] })
    await expect(piTui.apply(ctx, {})).rejects.toThrow('needs an interactive terminal')
  })
})
