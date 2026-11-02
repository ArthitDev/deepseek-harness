/** TUI retention config reaches the real Loader, tool pipeline, and recoverable local spill files. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SpillLocator } from '@deepseek-ai/dsh-spill'
import LocalSpillStore from '@deepseek-ai/dsh-spill-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as SpillPolicy from '../src/index.ts'

const textOf = (content: readonly ContentBlock[]) => content.filter(block => block.type === 'text').map(block => block.text).join('')

async function shippedRow(relative: string): Promise<string> {
  const lines = (await readFile(resolve(import.meta.dirname, '../../../..', relative), 'utf8')).split('\n')
  const start = lines.findIndex(line => /^\s*- id: spill-policy\s*$/.test(line))
  if (start < 0) throw new Error(`No spill-policy row in ${relative}`)
  const indent = lines[start]!.search(/\S/)
  let end = start + 1
  while (end < lines.length && (!lines[end]!.trim() || lines[end]!.search(/\S/) > indent)) end++
  return lines.slice(start, end).map(line => line.slice(indent)).join('\n')
}

async function setup(tui: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-spill-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(FileSystem)
  await ctx.plugin(ToolFs)
  await ctx.plugin(LocalSpillStore, { root: join(root, 'spill'), cleanupPeriodDays: 0 })
  const base = await shippedRow('packages/bundle/base/cordis.patch.yml')
  await writeFile(join(root, 'base.yml'), base)
  const patch = tui ? await shippedRow('packages/experimental/pi-tui/cordis.patch.yml') : ''
  await writeFile(join(root, 'cordis.yml'), [
    '- name: cordis:include', '  config:', '    path: ./base.yml',
    ...tui ? ['    patches:', ...patch.split('\n').map(line => `      ${line}`)] : [], '',
  ].join('\n'))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const internal: ModuleLoaderV2 = {
    version: 'v2', loadCache: new Map(),
    import(specifier) {
      if (specifier !== '@deepseek-ai/dsh-spill-policy') throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(SpillPolicy)
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
  await ctx.loader.await()
  const session = ctx.sessions.create(SessionId('spill-config'), { meta: { cwd: root } })
  const execute = (name: string, args: Record<string, string | number> = {}) => ctx.tools.execute({
    callId: ToolCallId(`config-${name}`), name, arguments: args,
    agent: { session } as never, signal: new AbortController().signal,
  })
  return { ctx, execute, session }
}

describe('shipped TUI spill budget', () => {
  it.each([false, true])('retains recoverable tool output with TUI override=%s', async (tui) => {
    const { ctx, execute, session } = await setup(tui)
    const lines = Array.from({ length: 160 }, (_, index) => `line-${index}: ${'result '.repeat(22)}`)
    const body = lines.join('\n')
    const content: ContentBlock[] = [{ type: 'text', text: body }]
    expect(estimateContent(content)).toBeGreaterThan(4096)
    expect(estimateContent(content)).toBeLessThan(12500)
    const saves = vi.spyOn(ctx.spillStore, 'saveText')
    ctx.tools.register(defineContentToolFixture({
      name: 'inspect', description: 'Synthetic tool output', parameters: {},
      execute: async () => content,
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'small', description: 'Small synthetic output', parameters: {},
      execute: async () => [{ type: 'text', text: 'small output remains intact' }],
    }))
    const result = await execute('inspect')
    expect(result.isError).toBe(false)
    expect(result.value).toEqual(content)
    if (tui) {
      expect(estimateContent(result.content)).toBeLessThanOrEqual(4096)
      expect(saves).toHaveBeenCalledTimes(1)
      const locator = /Full formatted result stored at: (.+?)\. Use read/.exec(textOf(result.content))?.[1]
      if (locator === undefined) throw new Error('No recovery locator in retained result')
      expect(await readFile(locator, 'utf8')).toBe(body)
      const recovered = await ctx.spillStore.readText({ owner: { sessionId: session.header.id }, locator: SpillLocator(locator) })
      expect(recovered.content).toBe(body)
      const read = await execute('read', { file_path: locator, offset: 80, limit: 2 })
      expect(read.isError).toBe(false)
      expect(textOf(read.content)).toContain(lines[79])
      expect(textOf(read.content)).toContain(lines[80])
    } else {
      expect(result.content).toEqual(content)
      expect(saves).not.toHaveBeenCalled()
    }
    const small = await execute('small')
    expect(small.content).toEqual([{ type: 'text', text: 'small output remains intact' }])
    expect(saves).toHaveBeenCalledTimes(tui ? 1 : 0)
  })
})
