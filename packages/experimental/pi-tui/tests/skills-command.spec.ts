import { setTimeout } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'

const SKILL = {
  name: 'fixture-skill',
  description: 'Fixture skill',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'runtime',
  provider: 'fixture',
} as const

const OTHER_SKILL = {
  name: 'other-skill',
  description: 'Other skill',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'runtime',
  provider: 'fixture',
} as const

async function visible(tui: TuiAltScreen): Promise<string> {
  tui.requestRender()
  await setTimeout(30)
  return stripVTControlCharacters(tui.getScreenLines().join('\n'))
}

it('/skills disables discovery and invocation, then restores them', async () => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ctx.provide('skills', { list: async () => [SKILL, OTHER_SKILL] })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('skills-command'))
  const second = await harness.create(SessionId('skills-command-second'))
  for (const subject of [agent, second]) {
    subject.ctx.tools.register({
      name: 'skill',
      description: 'Load a skill',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value as string }],
      },
      execute: async () => 'loaded',
    })
    subject.ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text: '- `fixture-skill`: Fixture skill\n- `other-skill`: Other skill' }],
            source: { kind: 'skill-catalog', form: 'catalog', entries: [SKILL, OTHER_SKILL] },
          }),
          createUserMessage({
            content: [{ type: 'text', text: 'instructions' }],
            source: { kind: 'skill-invocation', name: SKILL.name, form: 'instructions' },
          }),
          createUserMessage({
            content: [{ type: 'text', text: 'other instructions' }],
            source: { kind: 'skill-invocation', name: OTHER_SKILL.name, form: 'instructions' },
          }),
          createUserMessage({ content: [{ type: 'text', text: 'ordinary' }], source: { kind: 'user' } }),
        ],
      }
    })
  }
  const startInput = vi.fn<Terminal['start']>()
  const terminal: Terminal = {
    columns: 100, rows: 40, kittyProtocolActive: false,
    start: startInput, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
    moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
  }
  const tui = new TuiAltScreen(terminal)
  const screen = new ChatScreen({ ctx, tui, agent, config: {}, onQuit: vi.fn() })
  const toolNames = async (subject = agent) =>
    (await ctx.systemPrompt.assemble({ scope: subject })).tools.map(tool => tool.name)
  const sourceMessages = async (subject = agent) => {
    const decision = await agentEvents(ctx, subject).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter' as const, messages: [] }),
    )
    return decision.kind === 'enter' ? decision.messages : []
  }
  const sourceKinds = async (subject = agent) =>
    (await sourceMessages(subject)).map(message => message.source.kind)
  const runSkill = (name: string = SKILL.name) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`skill-call-${name}`),
    name: 'skill',
    arguments: { name },
    agent,
  })
  tui.start()
  const input = (data: string): void => { startInput.mock.calls[0]?.[0](data) }
  try {
    expect(await toolNames()).toContain('skill')
    expect(await sourceKinds()).toEqual(['skill-catalog', 'skill-invocation', 'skill-invocation', 'user'])
    screen.submit('/skills')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
    expect(await visible(tui)).toContain('Skills')
    expect(await visible(tui)).toContain('ON  fixture-skill')
    input('\r')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
    expect(await visible(tui)).toContain('skills: fixture-skill OFF')
    expect(await toolNames()).toContain('skill')
    expect(await sourceKinds()).toEqual(['skill-catalog', 'skill-invocation', 'user'])
    expect(JSON.stringify(await sourceMessages())).not.toContain('fixture-skill')
    const itemDenied = await runSkill()
    expect(itemDenied.isError).toBe(true)
    expect(itemDenied.content.some(block =>
      block.type === 'text' && block.text.includes('Skill "fixture-skill" is disabled'))).toBe(true)
    expect(await runSkill(OTHER_SKILL.name)).toMatchObject({ isError: false, value: 'loaded' })

    screen.switchAgent(second)
    expect(await sourceKinds(second)).toEqual(['skill-catalog', 'skill-invocation', 'user'])
    screen.switchAgent(agent)
    screen.submit('/skills status')
    expect(await visible(tui)).toContain('skills: ON · 1/2 skill(s) available')
    screen.submit('/skills')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
    expect(await visible(tui)).toContain('OFF fixture-skill')
    input('\r')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
    expect(await sourceKinds()).toEqual(['skill-catalog', 'skill-invocation', 'skill-invocation', 'user'])

    screen.submit('/skills off')
    expect(await visible(tui)).toContain('skills: OFF · 0/2 skill(s) available')
    expect(await toolNames()).not.toContain('skill')
    expect(await sourceKinds()).toEqual(['user'])
    const denied = await runSkill()
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('Skills are disabled in this TUI')

    screen.switchAgent(second)
    expect(await toolNames(second)).not.toContain('skill')
    expect(await sourceKinds(second)).toEqual(['user'])
    screen.switchAgent(agent)

    screen.submit('/skills status')
    expect(await visible(tui)).toContain('skills: OFF · 0/2 skill(s) available')
    screen.submit('/skills on')
    await visible(tui)
    expect(await toolNames()).toContain('skill')
    expect(await sourceKinds()).toEqual(['skill-catalog', 'skill-invocation', 'skill-invocation', 'user'])
    expect(await runSkill()).toMatchObject({ isError: false, value: 'loaded' })
    screen.submit('/skills invalid')
    expect(await visible(tui)).toContain('usage: /skills [on|off|toggle|status]')
  } finally {
    tui.stop()
    await ctx.fiber.dispose()
  }
})
