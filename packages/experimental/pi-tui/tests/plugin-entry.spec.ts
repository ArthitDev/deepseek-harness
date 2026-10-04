import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// Runtime side-effect import: the service-face module is type-only, and the
// coverage gate still accounts for its (empty) runtime surface.
import '../src/core/services.ts'
import * as piTui from '../src/index.ts'

describe('plugin entry', () => {
  it('declares the canonical plugin identity and required injections', () => {
    expect(piTui.name).toBe('pi-tui')
    expect(piTui.inject).toEqual(['agents', 'cmdlineArgs', 'workspaceRegistry'])
  })

  it('exposes the row-config schema', () => {
    expect(piTui.Config).toBeDefined()
  })

  it('refuses to boot outside an interactive terminal', async () => {
    const ctx = new Context()
    ctx.provide('cmdlineArgs', { get: () => [] as string[] })
    await expect(piTui.apply(ctx, {})).rejects.toThrow('needs an interactive terminal')
  })
})
