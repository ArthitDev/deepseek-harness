import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { JobHandle, JobKind, JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'
import { fixtureAgent } from './fixture-agent.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap { pwsh: 'pwsh'; workflow: 'workflow' }
}

describe('background job status in Agent Debug', () => {
  it('observes registered jobs through a Loader composition independently of tool and turn completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-job-status-'))
    const ctx = new Context()
    const start = vi.fn<Terminal['start']>()
    const terminal: Terminal = { columns: 120, rows: 38, kittyProtocolActive: false,
      start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(),
      clearLine: vi.fn(), clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn() }
    const tui = new TuiAltScreen(terminal)
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    let screen!: ChatScreen
    try {
      await ctx.plugin(Loader)
      Object.assign(ctx.loader.builtins, { include: Include, sessions: SessionStore, agents: AgentRegistry, jobs: LocalJobRegistry,
        screen: { name: 'job-screen-fixture', inject: ['sessions', 'agents', 'jobs'], apply: async (screenCtx: Context) => {
          screenCtx.jobs.attachController('job-screen-test')
          const agent = fixtureAgent(screenCtx, screenCtx.sessions.create(SessionId('visible-jobs')))
          await screenCtx.agents.register(agent)
          screen = new ChatScreen({ ctx: screenCtx, tui, agent, config: {}, onQuit: vi.fn() })
        } },
      })
      const path = join(root, 'cordis.yml')
      await writeFile(path, JSON.stringify(['sessions', 'agents', 'jobs', 'screen'].map(name => ({ name: `cordis:${name}` }))))
      await ctx.loader.root.update([{ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(path).href } }])
      await ctx.loader.await()
      expect(screen).toBeDefined()
      tui.start()
      const frame = () => { tui.renderNow(); return stripVTControlCharacters(tui.getScreenLines().join('\n')) }
      const debug = () => { frame(); return tui.getScreenLines().map(line => stripVTControlCharacters(line).slice(61)).join('\n') }
      const first = ctx.agents.get(SessionId('visible-jobs'))!
      const second = fixtureAgent(ctx, ctx.sessions.create(SessionId('other-jobs')))
      await ctx.agents.register(second)
      const job = (kind: JobKind, owner: SessionId | undefined = first.id) => {
        const done = Promise.withResolvers<JobOutcome>()
        let handle!: JobHandle
        const id = ctx.jobs.start({ kind, label: 'long-command-preview '.repeat(500), owner,
          run: (value) => { handle = value; return { done: done.promise, cancel: () => { done.resolve({ status: 'killed' }) } } } })
        return { id, handle, settle: done.resolve }
      }
      const windows = job('pwsh')
      const kali = job('bash')
      const workflow = job('workflow')
      const foreign = job('subagent', second.id)
      const read = vi.spyOn(ctx.jobs, 'read')
      const readAt = vi.spyOn(ctx.jobs, 'readAt')
      const kill = vi.spyOn(ctx.jobs, 'kill')
      const callId = ToolCallId('background-command')
      screen.handleEvent(first.session.append('tool/call', { turn: 1, step: 1, callId, name: 'pwsh', arguments: '{"command":"short preview"}' }))
      screen.handleEvent(first.session.append('tool/result', { turn: 1, step: 1, message: createMessage({ role: 'tool',
        source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: `started background job ${windows.id}` }] }) }, { surfaceOp: 'append' }))
      screen.handleEvent(first.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
      now.mockReturnValue(5000)
      expect(debug()).toContain('[OK] Shell · pwsh')
      for (const running of [windows, kali, workflow]) expect(debug()).toContain(`[RUNNING] Job · ${running.id} · 4.0s`)
      expect(debug()).not.toContain(foreign.id)
      expect(debug()).not.toContain('long-command-preview')
      expect(frame()).toContain('3 jobs')
      expect(debug().trimEnd()).toMatchSnapshot('completed tool with running jobs')
      windows.handle.append('output must stay out of status rows')
      expect(debug()).not.toContain('output must stay out')
      screen.submit('/agent-debug')
      expect(frame()).not.toContain('Agent Debug')
      windows.settle({ status: 'completed' })
      kali.settle({ status: 'failed', detail: 'exit code: 1' })
      await vi.waitFor(() => { expect(ctx.jobs.get(windows.id, first.id).status).toBe('completed') })
      screen.submit('/agent-debug')
      expect(debug()).toContain(`[COMPLETED] Job · ${windows.id}`)
      expect(debug()).toContain(`[FAILED] Job · ${kali.id}`)
      expect(debug()).toContain(`[RUNNING] Job · ${workflow.id}`)
      expect(frame()).toContain('1 jobs')
      await screen.switchAgent(second)
      expect(debug()).toContain(`[RUNNING] Job · ${foreign.id}`)
      expect(debug()).not.toContain(windows.id)
      await screen.switchAgent(first)
      expect(debug()).toContain(`[RUNNING] Job · ${workflow.id}`)
      screen.submit('/jobs')
      await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
      expect(frame()).toContain(windows.id)
      start.mock.calls[0]?.[0]('\x1b')
      expect(read).not.toHaveBeenCalled()
      expect(readAt).not.toHaveBeenCalled()
      expect(kill).not.toHaveBeenCalled()
      ctx.jobs.kill(workflow.id, first.id)
      expect(debug()).toContain(`[STOPPING] Job · ${workflow.id}`)
      workflow.settle({ status: 'killed' })
      foreign.settle({ status: 'completed' })
      await vi.waitFor(() => { expect(ctx.jobs.get(workflow.id, first.id).status).toBe('killed') })
      now.mockReturnValue(9000)
      expect(debug()).toContain(`[KILLED] Job · ${workflow.id} · 4.0s`)
      expect(frame()).not.toMatch(/\d+ jobs/)
      ctx.jobs.remove(windows.id, first.id)
      expect(debug()).not.toContain(`[COMPLETED] Job · ${windows.id}`)
      const list = vi.spyOn(ctx.jobs, 'list')
      tui.stop()
      await ctx.fiber.dispose()
      list.mockClear()
      await Promise.resolve()
      expect(list).not.toHaveBeenCalled()
    } finally {
      tui.stop()
      await ctx.fiber.dispose()
      now.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })
})
