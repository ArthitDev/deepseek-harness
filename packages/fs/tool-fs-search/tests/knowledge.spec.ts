import { mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createScope } from '@deepseek-ai/dsh-scope'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let dir: string
let wiki: string
let ctx: Context
let counter = 0
const signal = new AbortController().signal

function call(name: string, args = {}) {
  return ctx.tools.execute({ callId: ToolCallId(`knowledge-${++counter}`), name, arguments: args, signal })
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function boot(knowledgeRoots: ToolFsSearch.KnowledgeRoot[], withLoop = false, knowledgeOnly = false) {
  if (withLoop) await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: 'PRESET_SENTINEL' } })
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, {
    include: Include, prompt: SystemPrompt, tools: ToolRuntime, subprocess: LocalSubprocessRuntime,
    fs: LocalFileSystem, read: ToolFs, search: ToolFsSearch,
  })
  const configPath = join(dir, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    ...withLoop ? [] : [
      { id: 'prompt', name: 'cordis:prompt', config: { personaPrefix: 'PRESET_SENTINEL' } },
      { id: 'tools', name: 'cordis:tools' },
    ],
    { id: 'subprocess', name: 'cordis:subprocess' },
    { id: 'fs', name: 'cordis:fs', config: { cwd: dir } },
    { id: 'read', name: 'cordis:read' },
    { id: 'search', name: 'cordis:search', config: { sampleOverCapGlobResults: false, knowledgeRoots, knowledgeOnly } },
  ]))
  await ctx.loader.root.update([{ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }])
  await ctx.loader.await()
  expect(ctx.loader.resolve('include:search').fiber?.state).toBe(FiberState.ACTIVE)
}

describe('Markdown knowledge discovery through Loader', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-'))
    wiki = join(dir, 'wiki with spaces')
    await mkdir(wiki)
    await writeFile(join(wiki, 'INDEX.md'), '# Wiki\n[Access control](authorization.md)\nPRIVATE_INDEX_SENTINEL\n')
    await writeFile(join(wiki, 'authorization.md'), '# Authorization\ntags: [authorization]\nREFERENCE_CONTENT_SENTINEL\n')
    ctx = new Context()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    expect(dirname(resolve(dir))).toBe(resolve(tmpdir()))
    await rm(dir, { recursive: true, force: true })
  })

  it('lists paths without admitting note content or adding prompt sections, then reads live notes', async () => {
    await boot([{ name: 'cyber', path: wiki }])
    const root = await realpath(wiki)
    const result = await call('knowledge_list')
    expect(result.isError).toBe(false)
    expect(JSON.parse(text(result))).toEqual({ libraries: [{ name: 'cyber', root, index: join(root, 'INDEX.md') }] })
    expect(text(result)).not.toMatch(/PRIVATE_INDEX_SENTINEL|REFERENCE_CONTENT_SENTINEL/)
    expect(ctx.tools.get('knowledge_list')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Knowledge libraries', kind: 'search', rawInput: '',
    })
    expect(ctx.tools.schemas().find(schema => schema.name === 'knowledge_list')).toMatchInlineSnapshot(`
      {
        "description": "Local Markdown knowledge libraries available: cyber. For tasks needing reference knowledge, list the libraries, read the relevant INDEX.md, and use available read/glob/grep tools to retrieve only the notes needed. Cite the note path and source URLs when using their facts. Returns paths only; note contents are retrieved on demand.",
        "name": "knowledge_list",
        "parameters": {
          "properties": {},
          "type": "object",
        },
      }
    `)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('PRESET_SENTINEL')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toMatch(/PRIVATE_INDEX_SENTINEL|REFERENCE_CONTENT_SENTINEL|knowledge_list/)
    expect((await ctx.systemPrompt.assemble()).contexts).toEqual([])
    const index = await call('read', { file_path: join(root, 'INDEX.md') })
    expect(index.isError).toBe(false)
    expect(text(index)).toContain('authorization.md')
    const found = await call('glob', { pattern: '*.md', path: root })
    expect(found.isError).toBe(false)
    expect(text(found)).toContain(join(root, 'authorization.md'))
    const matches = await call('grep', { pattern: 'authorization', path: root, include: '*.md' })
    expect(matches.isError).toBe(false)
    expect(text(matches)).toContain('tags: [authorization]')
    await writeFile(join(root, 'authorization.md'), '# Updated authorization\nNEW_CONTENT_SENTINEL\n')
    expect(text(await call('read', { file_path: join(root, 'authorization.md') }))).toContain('NEW_CONTENT_SENTINEL')
  })

  it('bootstraps a missing library without overwriting existing files', async () => {
    const root = join(dir, 'automatic-knowledge')
    await boot([{ name: 'default', path: root, bootstrap: true }])
    expect(await readFile(join(root, 'INDEX.md'), 'utf8')).toContain('# Knowledge')
    expect(await readFile(join(root, 'CONTRIBUTING.md'), 'utf8')).toContain('Never store credentials')
    expect(await readFile(join(root, 'templates', 'NOTE.md'), 'utf8')).toContain('status: draft')
  })

  it('preserves a pre-existing index while completing a bootstrapped library', async () => {
    const root = join(dir, 'existing-knowledge')
    await mkdir(root)
    await writeFile(join(root, 'INDEX.md'), 'CUSTOM_INDEX\n')
    await boot([{ name: 'default', path: root, bootstrap: true }])
    expect(await readFile(join(root, 'INDEX.md'), 'utf8')).toBe('CUSTOM_INDEX\n')
    expect(await readFile(join(root, 'CONTRIBUTING.md'), 'utf8')).toContain('# Contributing')
  })

  it('creates sourced draft notes without traversal or overwrite', async () => {
    await boot([{ name: 'cyber', path: wiki }])
    const created = await call('knowledge_create_note', {
      library: 'cyber', slug: 'access-review', title: 'Access review',
      body: 'Reusable review procedure.', sources: ['https://example.test/reference'],
    })
    expect(created.isError).toBe(false)
    expect(JSON.parse(text(created))).toEqual({
      library: 'cyber', path: join(await realpath(wiki), 'access-review.md'), index: join(await realpath(wiki), 'INDEX.md'),
    })
    expect(await readFile(join(wiki, 'access-review.md'), 'utf8')).toBe([
      '# Access review', '', 'status: draft', '', 'Reusable review procedure.', '',
      '## Sources', '', '- https://example.test/reference', '',
    ].join('\n'))
    expect(await readFile(join(wiki, 'INDEX.md'), 'utf8')).toContain('- [Access review](access-review.md)')

    const duplicate = await call('knowledge_create_note', {
      library: 'cyber', slug: 'access-review', title: 'Replacement', body: 'Do not overwrite.', sources: ['manual'],
    })
    expect(duplicate.isError).toBe(true)
    expect(await readFile(join(wiki, 'access-review.md'), 'utf8')).toContain('Reusable review procedure.')
    for (const [library, slug] of [['missing', 'valid-slug'], ['cyber', '../escape']] as const) {
      const refused = await call('knowledge_create_note', {
        library, slug, title: 'Invalid', body: 'Must fail.', sources: ['manual'],
      })
      expect(refused.isError).toBe(true)
    }
    await expect(readFile(join(dir, 'escape.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes a new note when its index cannot be updated', async () => {
    await boot([{ name: 'cyber', path: wiki }])
    await rm(join(wiki, 'INDEX.md'))
    const result = await call('knowledge_create_note', {
      library: 'cyber', slug: 'rolled-back', title: 'Rolled back', body: 'Must not remain.', sources: ['manual'],
    })
    expect(result.isError).toBe(true)
    await expect(readFile(join(wiki, 'rolled-back.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps discovery available with suppressed built-in sections and independent session scopes', async () => {
    await boot([{ name: 'cyber', path: wiki }])
    const original = renderPrompt(await ctx.systemPrompt.assemble())
    ctx.systemPrompt.suppressSections({ except: ['deployment:persona-prefix'] })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('PRESET_SENTINEL')
    for (const key of [{}, {}]) {
      const scope = createScope(ctx, key)
      expect((await ctx.systemPrompt.assemble({ scope: key })).tools.some(tool => tool.name === 'knowledge_list')).toBe(true)
      expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))).toBe('PRESET_SENTINEL')
      await scope.dispose()
    }
    expect(original).not.toContain('PRIVATE_INDEX_SENTINEL')
    expect((await call('knowledge_list')).isError).toBe(false)
    expect(await readFile(join(wiki, 'INDEX.md'), 'utf8')).toContain('PRIVATE_INDEX_SENTINEL')
  })

  it('does not advertise a tool when no Wiki is configured', async () => {
    await boot([])
    expect(ctx.tools.get('knowledge_list')).toBeUndefined()
    expect(ctx.tools.get('knowledge_create_note')).toBeUndefined()
  })

  it('loads the discovery-only deployment row without registering duplicate search tools', async () => {
    await boot([{ name: 'cyber', path: wiki }], false, true)
    expect(ctx.tools.get('knowledge_list')).toBeDefined()
    expect(ctx.tools.get('knowledge_create_note')).toBeDefined()
    expect(ctx.tools.get('glob')).toBeUndefined()
    expect(ctx.tools.get('grep')).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toMatch(/knowledge_list|Use the glob tool|Use the grep tool/)
    expect((await call('knowledge_list')).isError).toBe(false)
  })

  it('mounts a discovery-only instance beside preset-owned search without adding guidance', async () => {
    await ctx.plugin(SystemPrompt, { personaPrefix: 'PRESET_SENTINEL' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(ToolFs)
    const existingTools = ctx.tools.schemas().map(tool => tool.name).sort()
    const before = renderPrompt(await ctx.systemPrompt.assemble())
    const fiber = await ctx.plugin(ToolFsSearch, {
      sampleOverCapGlobResults: false, knowledgeOnly: true, knowledgeRoots: [{ name: 'cyber', path: wiki }],
    })
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual([...existingTools, 'knowledge_create_note', 'knowledge_list'].sort())
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(before)
    const key = {}
    const scope = createScope(ctx, key)
    await scope.ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false })
    expect(ctx.tools.get('glob', key)).toBeDefined()
    expect(ctx.tools.get('knowledge_list', key)).toBeDefined()
    expect((await call('knowledge_list')).isError).toBe(false)
    await scope.dispose()
    await fiber.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual(existingTools)
  })

  it('records discovery as one tool result and sends no Wiki content on the initial model request', async () => {
    await boot([{ name: 'cyber', path: wiki }], true)
    const requests: GenerateOptions[] = []
    class RecordingAdapter extends LlmAdapter {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(options)
        if (requests.length === 1) {
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('discover'), name: 'knowledge_list', arguments: '{}' } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else {
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
    }
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.effect(() => ctx.llm.registerAdapter(['mock'], new RecordingAdapter()))
    const agent = await ctx.agentLoop.create(SessionId('knowledge-session'), { provider: 'mock', model: 'mock' })
    expect(ToolFsSearch.knowledgeLibraries(ctx, agent)).toEqual([{ name: 'cyber', root: await realpath(wiki), index: join(await realpath(wiki), 'INDEX.md') }])
    expect(ctx.sessionProjections.snapshot(agent.session).values.knowledgeStatus).toEqual({ libraries: ['cyber'] })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Find the reference library' }] }))
    await agent.whenIdle()
    expect(requests).toHaveLength(2)
    const root = await realpath(wiki)
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    const message = results[0]!.data.message
    const discovery = JSON.parse(text(message)) as { libraries: { name: string; root: string; index: string }[] }
    const projection = {
      initialHasTool: requests[0]?.tools?.some(tool => tool.name === 'knowledge_list'),
      initialKnowsLibrary: requests[0]?.tools?.find(tool => tool.name === 'knowledge_list')?.description.includes('available: cyber.'),
      initialHasWikiText: /PRIVATE_INDEX_SENTINEL|REFERENCE_CONTENT_SENTINEL/.test(JSON.stringify(requests[0]?.messages)),
      initialHasWikiPath: JSON.stringify(requests[0]?.messages).includes(root),
      initialWikiNotice: requests[0]?.messages.filter(message => message.role === 'user' && message.source?.kind === 'knowledge-context').length,
      result: {
        role: message.role,
        isError: message.isError,
        libraries: discovery.libraries.map(library => ({
          name: library.name, root: library.root === root ? '<wiki>' : library.root,
          index: relative(root, library.index).split(sep).join('/'),
        })),
      },
    }
    expect(projection.initialHasTool).toBe(true)
    expect(projection.initialHasWikiText).toBe(false)
    expect(projection.initialHasWikiPath).toBe(false)
    expect(projection.initialWikiNotice).toBe(1)
    expect(JSON.stringify(requests[0]?.messages)).toContain('CONTRIBUTING.md')
    expect(JSON.stringify(requests[1]?.messages)).toContain('knowledge_list')
    expect(JSON.stringify(requests[1]?.messages)).not.toContain('PRIVATE_INDEX_SENTINEL')
    expect(projection).toMatchSnapshot()
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue' }] }))
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'knowledge-context')).toHaveLength(1)
    expect(requests.at(-1)?.messages.filter(message => message.role === 'user' && message.source?.kind === 'knowledge-context')).toHaveLength(1)
  })

  it('unregisters discovery on unload and restores it after reload', async () => {
    await boot([{ name: 'cyber', path: wiki }])
    const entry = ctx.loader.resolve('include:search')
    await entry.fiber?.dispose()
    expect(ctx.tools.get('knowledge_list')).toBeUndefined()
    await entry.update({ disabled: false })
    await ctx.loader.await()
    expect((await call('knowledge_list')).isError).toBe(false)
  })

  it.each([
    { knowledgeRoots: [{ name: 'cyber', path: 'relative-wiki' }] },
    { knowledgeRoots: [{ name: 'Bad Name', path: 'unused' }] },
  ])('rejects invalid configuration before registration: $knowledgeRoots', async ({ knowledgeRoots }) => {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await expect(ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false, knowledgeRoots })).rejects.toThrow(/knowledgeRoots/)
    expect(ctx.tools.get('knowledge_list')).toBeUndefined()
    expect(ctx.tools.get('glob')).toBeUndefined()
  })

  it('rejects duplicate names and an absent entry point', async () => {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await expect(ctx.plugin(ToolFsSearch, {
      sampleOverCapGlobResults: false, knowledgeRoots: [{ name: 'cyber', path: wiki }, { name: 'cyber', path: wiki }],
    })).rejects.toThrow(/unique/)
    await expect(ctx.plugin(ToolFsSearch, {
      sampleOverCapGlobResults: false, knowledgeRoots: [{ name: 'missing', path: dir }],
    })).rejects.toThrow(/ENOENT/)
    expect(ctx.tools.get('knowledge_list')).toBeUndefined()
  })

  it.skipIf(process.platform === 'win32')('refuses an index symlink outside its configured root', async () => {
    const outside = join(dir, 'outside.md')
    await writeFile(outside, '# Outside')
    await rm(join(wiki, 'INDEX.md'))
    const index = join(wiki, 'INDEX.md')
    await symlink(outside, index)
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalSubprocessRuntime)
      await expect(ctx.plugin(ToolFsSearch, {
        sampleOverCapGlobResults: false, knowledgeRoots: [{ name: 'cyber', path: wiki }],
      })).rejects.toThrow(/inside its root/)
    } finally {
      await unlink(index)
    }
  })
})
