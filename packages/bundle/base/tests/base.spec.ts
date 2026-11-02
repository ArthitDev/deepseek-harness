/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import { createScope, scopeOf, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown>; disabled?: boolean }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.disabled).toBeUndefined()
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.config?.['mode']).toEqual({
      __jsExpr: "process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'",
    })
    expect(rows.find(row => row.id === 'hmr')).toMatchObject({
      config: { root: [] },
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(0)
    expect(rows.find(row => row.id === 'web')?.config).toMatchObject({ fetchProvider: 'http' })
    expect(rows.find(row => row.id === 'web-fetch-http')).toBeDefined()
    expect(rows.find(row => row.id === 'tool-web')?.config).toMatchObject({ fetch: true })
    expect(rows.find(row => row.id === 'tool-fs-search')?.config).toMatchObject({
      sampleOverCapGlobResults: false,
      knowledgeRoots: [{
        name: 'default',
        path: { __jsExpr: "dshHomePath('knowledge')" },
        bootstrap: true,
      }],
    })
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-claude-code')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-web-fetch-http')
  })

  it('loads the shipped required-section policy and rejects a scoped wrong-version shadow', async () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const patches = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    ) as { insert?: { id?: string; name?: string; config?: Record<string, unknown> }[] }[]
    const row = patches.flatMap(patch => patch.insert ?? []).find(candidate => candidate.id === 'system-prompt')
    if (row?.config === undefined) throw new Error('base patch must configure system-prompt')
    expect(row.config.requiredSections).toEqual({
      'tools:calling': '1',
      'deployment:persona-prefix': '1',
      'deployment:persona-suffix': '1',
      'harness:identity': '1',
    })

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins['system-prompt-fixture'] = SystemPrompt
    const entryId = await ctx.loader.create({ name: 'cordis:system-prompt-fixture', config: row.config })
    await ctx.loader.await()
    expect(ctx.loader.resolve(entryId).options.config).toEqual(row.config)

    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(/"tools:calling" is missing/)
    const global = ctx.systemPrompt.section({
      name: 'tools:calling', version: '1', order: 0, text: 'calling instructions',
    })
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name)).toContain('tools:calling')
    let scope!: Scope
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name: 'child' }) }, {
      inject: ['systemPrompt'],
    }))
    const scopedPersona = scope.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix', version: '1', order: 0, text: 'child persona',
    })
    expect((await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })).sections
      .find(section => section.name === 'deployment:persona-prefix')?.text).toBe('child persona')
    scopedPersona()
    expect((await ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! })).sections
      .find(section => section.name === 'deployment:persona-prefix')?.text).toBe('')
    const wrongVersion = scope.ctx.systemPrompt.section({
      name: 'tools:calling', version: '2', order: 0, text: 'scoped replacement',
    })
    await expect(ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! }))
      .rejects.toThrow(/"tools:calling" has wrong version \(expected "1", actual "2"\)/)
    wrongVersion()
    scope.ctx.systemPrompt.section({
      name: 'tools:calling', order: 0, text: 'unversioned scoped replacement',
    })
    await expect(ctx.systemPrompt.assemble({ scope: scopeOf(scope.ctx)! }))
      .rejects.toThrow(/"tools:calling" has wrong version \(expected "1", actual <unversioned>\)/)
    global()
    await scope.dispose()
  })

  it('pins the universal prompt sections in every shipped profile patch', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const expected = (identity: boolean) => ({
      'tools:calling': '1',
      'deployment:persona-prefix': '1',
      'deployment:persona-suffix': '1',
      ...(identity ? { 'harness:identity': '1' } : {}),
    })
    for (const [profile, identity] of [
      ['headless', true], ['sdk-app', true], ['acp-app', true], ['web-app', false], ['sdk-minimal', false],
    ] as const) {
      const patches = yaml.load(readFileSync(resolve(root, '..', profile, 'cordis.patch.yml'), 'utf8'), {
        schema: entryListSchema,
      }) as { id?: string; config?: Record<string, unknown>; insert?: { id?: string; config?: Record<string, unknown> }[] }[]
      const row = patches.flatMap(patch => patch.insert ?? [patch]).find(candidate => candidate.id === 'system-prompt')
      expect(row?.config?.requiredSections, profile).toEqual(expected(identity))
      expect(Boolean(row?.config?.includeHarnessIdentity ?? true), profile).toBe(identity)
    }
  })

  it('gates each shell stack by platform with a symmetric disabled expression', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    // Symmetric gating: each stack's executor and tool rows carry the same
    // platform fact, inverted between the bash and pwsh twins, so exactly one
    // shell stack mounts per host. Evaluate with a platform-scoped context
    // (the `with` scope shadows the global `process`) so both outcomes pin on
    // every host.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['tool-bash', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    expect(rows.find(row => row.id === 'bash-sandbox')?.config).toMatchObject({ timeoutMs: 60_000 })
    expect(rows.find(row => row.id === 'pwsh-sandbox')?.config).toMatchObject({ timeoutMs: 60_000 })
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})
