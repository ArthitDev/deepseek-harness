import { setTimeout } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen, jevSessionCost } from '../src/ui/chat.ts'
import type { ChatItem } from '../src/core/model.ts'

const MCP_TOOL = 'mcp__fixture__lookup'
const JEV_TOOL = 'mcp__open_dev_browser__automation_task'
const DIRECT_JEV_TOOL = 'mcp__jev__jev_verify'

function toolItem(name: string, status: 'ok' | 'error', resultFull: string): ChatItem {
  return {
    id: 0, kind: 'tool', text: '', streaming: false,
    tool: { callId: name, name, argsPreview: '', status, resultFull },
  }
}

it('sums only valid provider-reported cost from successful direct Jev calls', () => {
  expect(jevSessionCost([
    toolItem(DIRECT_JEV_TOOL, 'ok', '{"usage":{"cost":0.001}}'),
    toolItem('mcp__jev__jev_screen', 'ok', '{"usage":{"cost":0.002}}'),
    toolItem(JEV_TOOL, 'ok', '{"usage":{"cost":9}}'),
    toolItem(DIRECT_JEV_TOOL, 'error', '{"usage":{"cost":9}}'),
    toolItem(DIRECT_JEV_TOOL, 'ok', 'plain text'),
  ])).toBeCloseTo(0.003)
  expect(jevSessionCost([toolItem(DIRECT_JEV_TOOL, 'ok', '{}')])).toBeUndefined()
})

async function visible(tui: TuiAltScreen): Promise<string> {
  tui.requestRender()
  await setTimeout(30)
  return stripVTControlCharacters(tui.getScreenLines().join('\n'))
}

it('/mcp and /jev hide schemas, deny stale calls, and restore both', async () => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('mcp-command'))
  const second = await harness.create(SessionId('mcp-command-second'))
  for (const subject of [agent, second]) {
    for (const name of [MCP_TOOL, JEV_TOOL, DIRECT_JEV_TOOL, 'ordinary']) {
      subject.ctx.tools.register({
        name,
        description: name,
        parameters: { type: 'object', properties: {} },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value as string }],
        },
        execute: async () => `ran:${name}`,
      })
    }
    subject.ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text: 'Mandatory Jev-first browser and computer actions' }],
            source: { kind: 'skill-invocation', name: 'jev-first-policy', form: 'instructions' },
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
  const messageSources = async (subject = agent) => {
    const decision = await agentEvents(ctx, subject).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter' as const, messages: [] }),
    )
    return decision.kind === 'enter'
      ? decision.messages.map(message => message.source.kind === 'skill-invocation' ? message.source.name : message.source.kind)
      : []
  }
  const runMcp = () => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('mcp-call'),
    name: MCP_TOOL,
    arguments: {},
    agent,
  })
  const runJev = () => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('jev-call'),
    name: JEV_TOOL,
    arguments: {},
    agent,
  })
  const runDirectJev = () => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('direct-jev-call'),
    name: DIRECT_JEV_TOOL,
    arguments: {},
    agent,
  })
  tui.start()
  const input = (data: string): void => { startInput.mock.calls[0]?.[0](data) }
  try {
    expect(await toolNames()).toEqual([MCP_TOOL, DIRECT_JEV_TOOL, JEV_TOOL, 'ordinary'])
    expect(await messageSources()).toEqual(['jev-first-policy', 'user'])
    screen.submit('/jev off')
    expect(await visible(tui)).toContain('jev: OFF · policy context hidden · 2/2 tool(s) hidden')
    expect(await visible(tui)).toContain('Jev OFF')
    expect(await toolNames()).toEqual([MCP_TOOL, 'ordinary'])
    expect(await messageSources()).toEqual(['user'])
    const jevDenied = await runJev()
    expect(jevDenied.isError).toBe(true)
    expect(JSON.stringify(jevDenied.content)).toContain('JEV is disabled in this TUI')
    expect((await runDirectJev()).isError).toBe(true)
    await screen.switchAgent(second)
    expect(await toolNames(second)).toEqual([MCP_TOOL, 'ordinary'])
    expect(await messageSources(second)).toEqual(['user'])
    await screen.switchAgent(agent)
    screen.submit('/jev status')
    expect(await visible(tui)).toContain('jev: OFF · policy context hidden · 2/2 tool(s) hidden')
    screen.submit('/jev on')
    expect(await toolNames()).toEqual([MCP_TOOL, DIRECT_JEV_TOOL, JEV_TOOL, 'ordinary'])
    expect(await messageSources()).toEqual(['jev-first-policy', 'user'])
    expect(await runJev()).toMatchObject({ isError: false, value: `ran:${JEV_TOOL}` })
    expect(await runDirectJev()).toMatchObject({ isError: false, value: `ran:${DIRECT_JEV_TOOL}` })
    screen.submit('/jev invalid')
    expect(await visible(tui)).toContain('usage: /jev [on|off|toggle|status]')

    screen.submit('/mcp')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
    expect(await visible(tui)).toContain('MCP servers')
    expect(await visible(tui)).toContain('ON  fixture')
    input('\r')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
    expect(await visible(tui)).toContain('mcp: fixture OFF · 1 tool(s) hidden')
    expect(await toolNames()).toEqual([DIRECT_JEV_TOOL, JEV_TOOL, 'ordinary'])
    const serverDenied = await runMcp()
    expect(serverDenied.isError).toBe(true)
    expect(serverDenied.content.some(block =>
      block.type === 'text' && block.text.includes('MCP server "fixture" is disabled'))).toBe(true)
    screen.submit('/mcp status')
    expect(await visible(tui)).toContain('mcp: ON · 2/3 server(s) enabled · 2/3 tool(s) available')
    screen.submit('/mcp')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
    expect(await visible(tui)).toContain('OFF fixture')
    input('\r')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
    expect(await toolNames()).toEqual([MCP_TOOL, DIRECT_JEV_TOOL, JEV_TOOL, 'ordinary'])

    screen.submit('/mcp off')
    expect(await visible(tui)).toContain('mcp: OFF · 0/3 server(s) enabled · 0/3 tool(s) available')
    expect(await toolNames()).toEqual(['ordinary'])
    screen.submit('/jev off')
    screen.submit('/jev on')
    expect(await visible(tui)).toContain('jev: ON · policy context enabled · 2/2 tool(s) hidden · MCP is OFF')
    const denied = await runMcp()
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('MCP tools are disabled in this TUI')
    await screen.switchAgent(second)
    expect(await toolNames(second)).toEqual(['ordinary'])
    await screen.switchAgent(agent)

    screen.submit('/mcp status')
    expect(await visible(tui)).toContain('mcp: OFF · 0/3 server(s) enabled · 0/3 tool(s) available')
    screen.submit('/mcp on')
    expect(await toolNames()).toEqual([MCP_TOOL, DIRECT_JEV_TOOL, JEV_TOOL, 'ordinary'])
    expect(await runMcp()).toMatchObject({ isError: false, value: `ran:${MCP_TOOL}` })
    screen.submit('/mcp invalid')
    expect(await visible(tui)).toContain('usage: /mcp [on|off|toggle|status]')
  } finally {
    tui.stop()
    await ctx.fiber.dispose()
  }
})
