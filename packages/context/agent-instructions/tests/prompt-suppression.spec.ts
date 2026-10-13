import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context, resolveConfig } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createUserMessage, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import PentestModePolicy from '@deepseek-ai/dsh-pentest-executor'
import { SessionId } from '@deepseek-ai/dsh-session'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function textOf(request: GenerateOptions): string {
  return request.messages.flatMap(message => message.content)
    .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

async function send(ctx: Context, agent: Agent, text: string): Promise<void> {
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await idle
}

describe('global prompt-context suppression', () => {
  it.each([true, false])('toggles all three contexts on a live session and preserves preset text, policy first: %s', async (policyFirst) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-prompt-suppression-'))
    const home = join(root, 'home')
    const ctx = new Context()
    try {
      await mkdir(join(root, '.git'))
      await mkdir(home)
      await writeFile(join(root, 'AGENTS.md'), 'project workspace rule')
      await writeFile(join(home, 'AGENTS.md'), 'global workspace rule')
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(LocalFileSystem, { cwd: root })
      await ctx.plugin(Loader)
      ctx.loader.builtins['mode-policy-test'] = PentestModePolicy
      ctx.loader.builtins['instructions-test'] = AgentInstructions
      ctx.loader.builtins['guidance-test'] = {
        name: 'guidance-test', inject: ['systemPrompt'],
        apply(context: Context) {
          context.systemPrompt.section({ name: 'builtin:test', order: 1, text: 'built-in guidance' })
          context.systemPrompt.context({ name: 'runtime:test', order: 1, text: 'Current DSH file policy: danger-full-access. Approval prompts are disabled.' })
          context.systemPrompt.tools(() => ({ schemas: [{ name: 'kept_tool', description: 'unchanged schema', parameters: { type: 'object', properties: {} } }] }))
        },
      }
      const rows = [
        { id: 'mode-policy-test', name: 'cordis:mode-policy-test', config: { redPrompt: 'mode contribution', suppressSections: false } },
        { id: 'instructions-test', name: 'cordis:instructions-test', config: { dshHome: home, maxBytes: 65536 } },
      ]
      if (!policyFirst) rows.reverse()
      rows.unshift({ id: 'guidance-test', name: 'cordis:guidance-test', config: {} } as typeof rows[number])
      const composition = join(root, 'cordis.yml')
      await writeFile(composition, JSON.stringify(rows))
      const parsed = JSON.parse(await readFile(composition, 'utf8')) as typeof rows
      for (const row of parsed) {
        const id = await ctx.loader.create(row)
        await ctx.loader.resolve(id).fiber?.await()
      }
      const modeEntry = ctx.loader.resolve('mode-policy-test')
      const toggle = async (suppressSections: boolean): Promise<void> => {
        const config = { redPrompt: 'mode contribution', suppressSections }
        const fiber = modeEntry.fiber!
        resolveConfig(fiber.runtime!, fiber.ctx.waterfall(fiber, 'internal/config', config, () => config))
        await modeEntry.update({ config })
        await modeEntry.fiber?.await()
        expect(ctx.pentestModePolicy.current().suppressSections).toBe(suppressSections)
      }
      ctx.on('agent/pre-step', async (_payload, next) => {
        const decision = await next()
        if (decision.kind === 'reject' || ctx.pentestModePolicy.current().suppressSections) return decision
        return { ...decision, messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text: 'Mandatory Jev-first browser and computer actions' }],
          source: { kind: 'skill-invocation', name: 'jev-first-policy', form: 'instructions' },
        })] }
      })
      await ctx.plugin(AgentLoop, { agents: [] })
      const adapter = new RecordingAdapter()
      ctx.llm.registerAdapter(['mock'], adapter)
      const agent = await ctx.agentLoop.create(SessionId(`suppression-${policyFirst}`), { provider: 'mock', model: 'mock' }, { cwd: root })
      agent.ctx.systemPrompt.section({ name: 'preset:test', order: 2, text: 'preset contribution' })
      await send(ctx, agent, 'first request')
      const original = adapter.requests.at(-1)!
      expect(textOf(original)).toContain('built-in guidance')
      expect(textOf(original)).toContain('global workspace rule')
      expect(textOf(original)).toContain('project workspace rule')
      expect(textOf(original)).toContain('Current runtime context.')
      expect(textOf(original)).toContain('Mandatory Jev-first browser and computer actions')

      await toggle(true)
      const quoted = 'User quote: Mandatory Jev-first browser and computer actions'
      await send(ctx, agent, quoted)
      const suppressed = adapter.requests.at(-1)!
      expect(textOf(suppressed)).not.toContain('global workspace rule')
      expect(textOf(suppressed)).not.toContain('project workspace rule')
      expect(textOf(suppressed)).not.toContain('Current runtime context')
      expect(textOf(suppressed)).not.toContain('built-in guidance')
      expect(textOf(suppressed)).toContain('preset contribution')
      expect(textOf(suppressed)).toContain('mode contribution')
      expect(textOf(suppressed)).toContain(quoted)
      expect(suppressed.messages.some(message => message.source?.kind === 'skill-invocation')).toBe(false)
      expect(suppressed.tools).toEqual(original.tools)
      // The completed mock response is appended after the captured request.
      expect(suppressed.messages).toEqual(agent.session.deriveMessages().slice(0, -1))
      expect(agent.session.snapshotEvents().some(event => event.type === 'user/message'
        && event.data.source.kind === 'agent-instructions')).toBe(true)
      const replay = ctx.sessions.create(SessionId(`suppression-replay-${policyFirst}`), {
        seed: agent.session.snapshotEvents(), meta: { cwd: root },
      })
      expect(replay.deriveMessages()).toEqual(agent.session.deriveMessages())
      expect(suppressed.messages.map(message => ({ role: message.role, source: message.source?.kind }))).toMatchInlineSnapshot(`
        [
          {
            "role": "system",
            "source": "system-prompt",
          },
          {
            "role": "user",
            "source": "user",
          },
          {
            "role": "assistant",
            "source": "model",
          },
          {
            "role": "user",
            "source": "user",
          },
        ]
      `)

      const fresh = await ctx.agentLoop.create(SessionId(`fresh-suppression-${policyFirst}`), { provider: 'mock', model: 'mock' }, { cwd: root })
      await send(ctx, fresh, 'fresh suppressed request')
      const freshRequest = adapter.requests.at(-1)!
      expect(textOf(freshRequest)).not.toContain('workspace rule')
      expect(textOf(freshRequest)).not.toContain('Current runtime context')
      expect(freshRequest.messages.some(message => message.source?.kind === 'skill-invocation')).toBe(false)
      expect(fresh.session.snapshotEvents().some(event => event.type === 'user/message'
        && event.data.source.kind === 'agent-instructions')).toBe(false)
      await send(ctx, agent, 'still suppressed')
      expect(textOf(adapter.requests.at(-1)!)).not.toContain('Current runtime context')
      expect(agent.inbox.nextStep).toHaveLength(0)
      await toggle(false)
      await send(ctx, agent, 'context restored')
      const restored = textOf(adapter.requests.at(-1)!)
      expect(restored).toContain('global workspace rule')
      expect(restored).toContain('project workspace rule')
      expect(restored).toContain('Current runtime context.')
      expect(restored).toContain('built-in guidance')
      expect(restored).toContain('Mandatory Jev-first browser and computer actions')
      expect(adapter.requests.at(-1)!.messages.some(message => message.source?.kind === 'skill-invocation')).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
