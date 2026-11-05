import { agentPresets } from './agent-presets-context.ts'
/**
 * The default preset is a user setting behind the preset picker. While the
 * picker is hidden, `config.default` remains the deployment's safe default;
 * once shown, the settings document overrides it and is hot-reloaded.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { afterEach, describe, expect, it } from 'vitest'
import AgentPresets, { COMPOSITION_FILE } from '@deepseek-ai/dsh-agent-presets'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ROOTS = [{ path: join(FIXTURES, 'system'), trust: 'system' as const }]

class CatalogAdapter extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([
      { provider, id: 'fixture-model', name: 'Fixture Model' },
      { provider, id: 'other-model', name: 'Other Model' },
    ])
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Every temp root created by this file, removed after each test. */
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A live Loader entry plus the Settings mutation used when a preset is deleted. */
async function harness(
  extraRoots: readonly { path: string; trust: 'system' | 'user' }[] = [],
) {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['fixture'], new CatalogAdapter())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModel, { provider: 'fixture', model: 'fixture-model' })
  await ctx.plugin(AgentLoop, { agents: [] })

  const initial = {
    default: 'standard',
    roots: [...ROOTS, ...extraRoots],
    includeShippedRoot: false,
    includeUserRoot: false,
  }
  ctx.provide('settings', {
    configure: () => () => {},
    mutate: async (_namespace: string, ops: readonly { op: string; path: readonly string[] }[]) => {
      const next = structuredClone(live.entry.options.config as Record<string, unknown>)
      for (const op of ops) {
        if (op.op !== 'unset') throw new Error(`unsupported test settings operation: ${op.op}`)
        let cursor = next
        const path = [...op.path]
        const leaf = path.pop()
        for (const segment of path) cursor = cursor[segment] as Record<string, unknown>
        if (leaf !== undefined) Reflect.deleteProperty(cursor, leaf)
      }
      await live.replace(next)
    },
  } as never)
  const live = await liveConfig(ctx, AgentPresets, initial)
  return { ctx, live, initial }
}

const toolNames = (ctx: Context, agent?: unknown): string[] =>
  ctx.tools.schemas(agent as never).map(schema => schema.name).sort()

describe('the default preset as a user setting', () => {
  it('shows mode selection on the composition default by default', async () => {
    const { ctx, live } = await harness()

    expect((await agentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(true)
    expect(agentPresets(ctx).defaultId).toBe('standard')

    await live.update({ modeSelectionEnabled: false })
    expect((await agentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(false)
    expect(agentPresets(ctx).defaultId).toBe('standard')
    const roster = await agentPresets(ctx).remoteExportList()
    expect(roster.defaultModel).toEqual({ provider: 'fixture', model: 'fixture-model' })
    expect(roster.models).toEqual([
      { provider: 'fixture', providerName: 'fixture', id: 'fixture-model', name: 'Fixture Model' },
      { provider: 'fixture', providerName: 'fixture', id: 'other-model', name: 'Other Model' },
    ])
  })

  it('temporarily ignores the saved user default while selection is off', async () => {
    const { ctx, live } = await harness()

    await live.update({ selectedDefault: 'minimal' })
    expect(agentPresets(ctx).defaultId).toBe('minimal')

    await live.update({ modeSelectionEnabled: false })
    expect(agentPresets(ctx).defaultId).toBe('standard')

    await live.update({ modeSelectionEnabled: true })
    expect(agentPresets(ctx).defaultId).toBe('minimal')
  })

  it('resolves a model override live and falls back to the current default', async () => {
    const { ctx, live } = await harness()

    expect(agentPresets(ctx).presetIdForModel('deepseek-official', 'deepseek-chat')).toBe('standard')

    await live.update({
      models: { 'deepseek-official': { 'deepseek-chat': 'minimal' } },
    })
    expect(agentPresets(ctx).presetIdForModel('deepseek-official', 'deepseek-chat')).toBe('minimal')

    await live.update({ selectedDefault: 'minimal' })
    expect(agentPresets(ctx).presetIdForModel('deepseek-official', 'deepseek-reasoner')).toBe('minimal')
  })

  it('composes a new session from the user default', async () => {
    const { ctx, live } = await harness()
    await live.update({ selectedDefault: 'minimal' })

    const handle = await ctx.agents.create({
      sessionId: SessionId('settings-default'),
      setup: async (agentCtx: Context) => void await agentPresets(ctx).mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, handle.agent)).toEqual(['beta'])
    } finally {
      await handle.dispose()
    }
  })

  it('leaves a running session on the preset it was composed from', async () => {
    const { ctx, live } = await harness()
    const running = await ctx.agents.create({
      sessionId: SessionId('settings-running'),
      setup: async (agentCtx: Context) => void await agentPresets(ctx).mount(agentCtx),
    })
    try {
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])

      // Changing the default mid-flight must not reach an agent that already
      // composed: its history was produced under `standard`'s tools.
      await live.update({ selectedDefault: 'minimal' })

      expect(agentPresets(ctx).defaultId).toBe('minimal')
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])

      await live.update({ modeSelectionEnabled: false })

      expect(agentPresets(ctx).defaultId).toBe('standard')
      expect(toolNames(ctx, running.agent)).toEqual(['alpha'])
    } finally {
      await running.dispose()
    }
  })

  it('re-inherits the composition default when the user setting is cleared', async () => {
    const { ctx, live, initial } = await harness()
    await live.update({ selectedDefault: 'minimal' })
    expect((await agentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(true)
    expect(agentPresets(ctx).defaultId).toBe('minimal')

    await live.replace(initial)

    expect((await agentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(true)
    expect(agentPresets(ctx).defaultId).toBe('standard')
  })

  it('clears a user default it has just deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-authored-'))
    roots.push(root)
    await mkdir(join(root, 'mine'))
    await writeFile(
      join(root, 'mine', COMPOSITION_FILE),
      `- id: only\n  name: ${join(FIXTURES, 'plugins', 'contribute.js')}\n  config:\n    tool: only\n`,
    )
    const { ctx, live } = await harness([{ path: root, trust: 'user' as const }])
    await live.update({ selectedDefault: 'mine' })
    expect(agentPresets(ctx).defaultId).toBe('mine')

    await agentPresets(ctx).remove('mine')

    // Nothing will ever supply that id again, so leaving the setting pointed at
    // it would fail every session created without an explicit pick. Clearing it
    // exposes the deployment's own default underneath.
    expect(agentPresets(ctx).defaultId).toBe('standard')
    expect((await agentPresets(ctx).resolve()).id).toBe('standard')
  })

  it('clears model bindings to a preset it has just deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preset-authored-'))
    roots.push(root)
    await mkdir(join(root, 'mine'))
    await writeFile(
      join(root, 'mine', COMPOSITION_FILE),
      `- id: only\n  name: ${join(FIXTURES, 'plugins', 'contribute.js')}\n  config:\n    tool: only\n`,
    )
    const { ctx, live } = await harness([{ path: root, trust: 'user' as const }])
    await live.update({
      models: { 'deepseek-official': { 'deepseek-chat': 'mine' } },
    })

    await agentPresets(ctx).remove('mine')

    expect(agentPresets(ctx).presetIdForModel('deepseek-official', 'deepseek-chat')).toBe('standard')
  })

  it('reports an unknown user default only when a session tries to use it', async () => {
    const { ctx, live } = await harness()

    // Storing it succeeds — the roster is a live directory, so a name that is
    // absent now may exist by the time a session asks for it.
    await live.update({ selectedDefault: 'no-such-preset' })

    await expect(agentPresets(ctx).resolve())
      .rejects.toThrow(/preset "no-such-preset" not found/)
  })
})

describe('live config replacement', () => {
  it('falls back to the composition default when the user layer is reset', async () => {
    const { ctx, live, initial } = await harness()
    await live.update({ selectedDefault: 'minimal' })
    expect((await agentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(true)
    expect(agentPresets(ctx).defaultId).toBe('minimal')

    await live.replace(initial)

    expect((await agentPresets(ctx).remoteExportList()).modeSelectionEnabled).toBe(true)
    expect(agentPresets(ctx).defaultId).toBe('standard')
  })
})
