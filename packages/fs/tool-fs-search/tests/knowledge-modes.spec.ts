import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import PlanMode from '@deepseek-ai/dsh-plan-mode'
import PentestModePolicy from '@deepseek-ai/dsh-pentest-executor'
import * as Persona from '@deepseek-ai/dsh-persona'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let ctx: Context
let dir: string
let wiki: string
let workspace: string
let counter = 0
const signal = new AbortController().signal
const note = '# Reference\nPRIVATE_NOTE_CONTENT\n'

// The runtime boundary calls real registry bindings; these tests do not evaluate model-supplied programs.
class BindingRuntime extends PtcRuntime {
  readonly language: string
  readonly isolation = 'test'
  constructor(context: Context, config: { language: string }) {
    super(context)
    this.language = config.language
  }
  resolve(request: PtcRunRequest): PtcRunSpec {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 30000 }
  }
  async run(spec: PtcRunSpec): Promise<PtcRunResult> {
    const discover = spec.bindings.find(binding => binding.global === 'tools')?.functions['knowledge_list']
    if (discover === undefined) throw new Error('Missing knowledge binding')
    return { logs: [], value: await discover({}) }
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-wiki-modes-'))
  wiki = join(dir, 'wiki')
  workspace = join(dir, 'workspace')
  await mkdir(wiki)
  await mkdir(workspace)
  await writeFile(join(wiki, 'INDEX.md'), note)
  ctx = new Context()
})

afterEach(async () => {
  await ctx.fiber.dispose()
  expect(dirname(resolve(dir))).toBe(resolve(tmpdir()))
  await rm(dir, { recursive: true, force: true })
})

async function mount(mode: 'native' | 'both' | 'ptc' = 'native', language = 'typescript') {
  await mountAgentLoopTestDependencies(ctx, { tools: { mode } })
  if (mode !== 'native') await ctx.plugin(BindingRuntime, { language })
  await ctx.plugin(LocalSubprocessRuntime)
  return ctx.plugin(ToolFsSearch, {
    sampleOverCapGlobResults: false, knowledgeOnly: true, knowledgeRoots: [{ name: 'cyber', path: wiki }],
  })
}

const cases = (['blue', 'red', 'black', 'dead'] as const).flatMap(team =>
  (['read-only', 'workspace-write', 'danger-full-access'] as const).flatMap(fileMode =>
    [false, true].flatMap(plan => [false, true].map(suppress => ({ team, fileMode, plan, suppress })))),
)

describe('Wiki awareness under session policies', () => {
  it.each(cases)('$team / $fileMode / plan=$plan / suppress=$suppress', async ({ team, fileMode, plan, suppress }) => {
    await mount()
    await ctx.plugin(SandboxPolicy, { mode: fileMode, workspaceRoot: workspace })
    await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
    await ctx.plugin(ToolFs)
    await ctx.plugin(PlanMode, { section: 'PLAN_SENTINEL' })
    await ctx.plugin(PentestModePolicy, { mode: team, suppressSections: suppress })
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create(SessionId('wiki-modes'), { provider: 'mock', model: 'mock' }, { cwd: workspace })
    await agent.ctx.plugin(Persona, { prefix: 'PRESET_SENTINEL', complete: true })
    ctx.planMode.set(agent, plan)
    const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
    const discovery = assembly.tools.find(tool => tool.name === 'knowledge_list')
    expect(discovery?.description).toContain('available: cyber.')
    expect(discovery?.description).toContain('read the relevant INDEX.md')
    expect(discovery?.description).not.toContain(wiki)
    expect(renderPrompt(assembly)).toBe('PRESET_SENTINEL')
    expect(ctx.sandboxPolicy.resolve({ session: agent.session }).mode).toBe(fileMode)
    for (const [name, args] of [['knowledge_list', {}], ['read', { file_path: join(wiki, 'INDEX.md') }]] as const) {
      const result = await ctx.tools.execute({ agent, name, arguments: args, callId: ToolCallId(`mode-${++counter}`), signal })
      expect(result.isError).toBe(false)
    }
    expect(await readFile(join(wiki, 'INDEX.md'), 'utf8')).toBe(note)
    expect(ctx.pentestModePolicy.current().mode).toBe(team)
    const requests: GenerateOptions[] = []
    class Recorder extends LlmAdapter {
      async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(request)
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['mock'], new Recorder())
    for (const text of ['first task', 'continue']) {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
      await agent.whenIdle()
    }
    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(request.messages.filter(message => message.role === 'user' && message.source?.kind === 'knowledge-context')).toHaveLength(1)
      expect(request.messages.find(message => message.role === 'system')?.content).toEqual([{ type: 'text', text: 'PRESET_SENTINEL' }])
    }
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'knowledge-context')).toHaveLength(1)
  })
})

describe('Wiki awareness through programmatic tools', () => {
  it.each((['both', 'ptc'] as const).flatMap(mode => (['typescript', 'python'] as const).flatMap(language =>
    [false, true].flatMap(suppress => [false, true].map(complete => ({ mode, language, suppress, complete }))),
  )))('$mode / $language / suppress=$suppress / complete=$complete', async ({ mode, language, suppress, complete }) => {
    await mount(mode, language)
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(ToolFs)
    await ctx.plugin(PentestModePolicy, { mode: 'black', suppressSections: suppress })
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create(SessionId('wiki-program'), { provider: 'mock', model: 'mock' }, { cwd: workspace })
    await agent.ctx.plugin(Persona, { prefix: 'PRESET_SENTINEL', complete })
    await agent.ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false })
    const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
    const discovery = assembly.tools.find(tool => tool.name === 'knowledge_list')
    const code = assembly.tools.find(tool => tool.name === 'run_code')
    const visibleText = discovery === undefined ? code?.description : `${discovery.name} ${discovery.description}`
    expect(visibleText).toContain('available: cyber.')
    expect(visibleText).toContain('knowledge_list')
    expect(JSON.stringify(assembly)).not.toContain('PRIVATE_NOTE_CONTENT')
    if (mode === 'ptc') {
      expect(discovery).toBeUndefined()
      expect(visibleText).toContain('file_path')
      expect(visibleText).toContain('grep')
      const native = await ctx.tools.execute({ agent, name: 'knowledge_list', arguments: {}, callId: ToolCallId('native-denied'), signal })
      expect(native.isError).toBe(true)
    }
    const result = await ctx.tools.execute({ agent, name: 'run_code', arguments: { code: 'return await tools.knowledge_list({})', description: 'Find reference libraries' }, callId: ToolCallId('program'), signal })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.value)).toContain('cyber')
  })

  it('does not advertise a denied Wiki or retain awareness after plugin unload', async () => {
    const fiber = await mount('ptc')
    ctx.systemPrompt.suppressSections({ except: [] })
    const key = {}
    let scoped!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { scoped = createScope(inner, key) }, { inject: ['tools'] }))
    scoped.ctx.tools.restrict({ deny: ['knowledge_list'] })
    const hidden = await ctx.systemPrompt.assemble({ scope: key })
    expect(hidden.tools.find(tool => tool.name === 'run_code')?.description).not.toContain('available: cyber.')
    await scoped.dispose()
    const active = await ctx.systemPrompt.assemble()
    expect(active.tools.find(tool => tool.name === 'run_code')?.description).toContain('available: cyber.')
    expect((await ctx.systemPrompt.assemble()).tools.find(tool => tool.name === 'run_code')?.description.match(/available: cyber\./g)).toHaveLength(1)
    await fiber.dispose()
    expect((await ctx.systemPrompt.assemble()).tools.find(tool => tool.name === 'run_code')?.description).not.toContain('available: cyber.')
  })
})
