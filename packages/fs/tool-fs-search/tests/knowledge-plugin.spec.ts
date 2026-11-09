import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { expect, it, onTestFinished } from 'vitest'
import * as ToolFsSearch from '../src/index.ts'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'search-wiki-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(LocalSubprocessRuntime)
  return { ctx, directory }
}

it('registers configured Wiki discovery through the plugin and removes it on unload', async () => {
  const { ctx, directory } = await fixture()
  await writeFile(join(directory, 'INDEX.md'), '# Fixture Wiki\n')
  const before = await readFile(join(directory, 'INDEX.md'))
  const fiber = await ctx.plugin(ToolFsSearch, {
    sampleOverCapGlobResults: false, knowledgeRoots: [{ name: 'cyber', path: directory }],
  })
  const result = await executeToolFixture(ctx, {
    name: 'knowledge_list', arguments: {}, callId: ToolCallId('wiki-discovery'), signal: new AbortController().signal,
  })
  const root = await realpath(directory)
  const value: unknown = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join(''))
  expect(value).toEqual({ libraries: [{ name: 'cyber', root, index: join(root, 'INDEX.md') }] })
  expect(ctx.tools.schemas().map(tool => tool.name).sort()).toMatchInlineSnapshot(`
    [
      "glob",
      "grep",
      "knowledge_create_note",
      "knowledge_list",
    ]
  `)
  expect(await readFile(join(directory, 'INDEX.md'))).toEqual(before)
  await fiber.dispose()
  expect(ctx.tools.schemas()).toEqual([])
})

it('keeps Wiki opt-in and rejects an unavailable configured library', async () => {
  const { ctx, directory } = await fixture()
  const fiber = await ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false })
  expect(ctx.tools.get('knowledge_list')).toBeUndefined()
  await fiber.dispose()
  await expect(ctx.plugin(ToolFsSearch, {
    sampleOverCapGlobResults: false, knowledgeRoots: [{ name: 'missing', path: join(directory, 'missing') }],
  })).rejects.toThrow()
  expect(ctx.tools.schemas()).toEqual([])
})

it.each([false, true])('assembles Wiki tools with complete persona %s and removes them on unload', async (complete) => {
  const { ctx, directory } = await fixture()
  await writeFile(join(directory, 'INDEX.md'), '# Fixture Wiki\n')
  ctx.systemPrompt.section({ name: 'persona', order: 0, text: 'Keep the complete preset prompt.', complete })
  const baseline = await ctx.systemPrompt.assemble()
  const fiber = await ctx.plugin(ToolFsSearch, {
    sampleOverCapGlobResults: false, knowledgeRoots: [{ name: 'cyber', path: directory }],
  })
  const assembly = await ctx.systemPrompt.assemble()
  expect(assembly.sections.find(section => section.name === 'persona')?.text).toBe('Keep the complete preset prompt.')
  expect(assembly.tools.map(tool => tool.name).sort()).toEqual(['glob', 'grep', 'knowledge_create_note', 'knowledge_list'])
  if (complete) expect(assembly.sections).toHaveLength(1)
  await fiber.dispose()
  const unloaded = await ctx.systemPrompt.assemble()
  expect(unloaded.tools).toEqual([])
  expect(unloaded.sections).toEqual(baseline.sections)
})
