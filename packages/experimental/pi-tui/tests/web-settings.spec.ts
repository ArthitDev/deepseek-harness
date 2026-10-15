import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { defaultModelSelection } from '../src/core/web-settings.ts'

describe('Web model defaults in TUI', () => {
  it.each([
    { tui: { provider: 'p', model: 'm' }, web: { provider: 'p', model: 'm', reasoningEffort: 'high' }, expected: { provider: 'p', model: 'm', reasoningEffort: 'high' } },
    { tui: { provider: 'p', model: 'm', reasoningEffort: 'low' }, web: { provider: 'p', model: 'm', reasoningEffort: 'high' }, expected: { provider: 'p', model: 'm', reasoningEffort: 'low' } },
    { tui: { provider: 'other', model: 'm' }, web: { provider: 'p', model: 'm', reasoningEffort: 'high' }, expected: { provider: 'other', model: 'm' } },
    { tui: { provider: 'p', model: 'other' }, web: { provider: 'p', model: 'm', reasoningEffort: 'high' }, expected: { provider: 'p', model: 'other' } },
    { tui: undefined, web: { provider: 'p', model: 'm', reasoningEffort: 'high' }, expected: { provider: 'p', model: 'm', reasoningEffort: 'high' } },
    { tui: { provider: 'p', model: 'm' }, web: undefined, expected: { provider: 'p', model: 'm' } },
    { tui: undefined, web: undefined, expected: undefined },
  ])('resolves defaults for $tui with Web $web', async ({ tui, web, expected }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-web-defaults-'))
    const ctx = new Context()
    ctx.provide('profileContext', { home: root } as never)
    if (tui !== undefined) ctx.provide('agentDefaultModel', { currentSelection: () => tui } as never)
    try {
      const path = join(root, 'profiles', 'web', 'cordis.patch.yml')
      let before: string | undefined
      if (web !== undefined) {
        await mkdir(join(root, 'profiles', 'web'), { recursive: true })
        before = JSON.stringify([{ id: 'agent-default-model', config: web }])
        await writeFile(path, before)
      }
      expect(defaultModelSelection(ctx)).toEqual(expected)
      if (before !== undefined) expect(await readFile(path, 'utf8')).toBe(before)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it('rejects invalid saved effort before sending a request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-web-defaults-invalid-'))
    const ctx = new Context()
    ctx.provide('profileContext', { home: root } as never)
    try {
      await mkdir(join(root, 'profiles', 'web'), { recursive: true })
      await writeFile(join(root, 'profiles', 'web', 'cordis.patch.yml'), JSON.stringify([
        { id: 'agent-default-model', config: { provider: 'p', model: 'm', reasoningEffort: 5 } },
      ]))
      expect(() => defaultModelSelection(ctx)).toThrow('Web reasoning effort must be a non-empty string')
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
})
