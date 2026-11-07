/** Real Loader composition: the bridge mounted from a cordis.yml row beside the shipped core plugins. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
// Loader and Include are imported from their source paths directly: the
// package-name forms can resolve to built `lib/` bundles or compiled
// intermediates, which would load a second module-singleton copy and move
// entry imports outside Vitest's graph.
import Loader from '../../../../vendor/loader/src/index.ts'
import Include from '../../../../vendor/include/src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const FIXTURES = resolve(import.meta.dirname, 'fixtures')

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  ctx = undefined
  root = undefined
})

it('loads from cordis.yml, counts the model\'s tool calls, and answers /tally through the composed command registry', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-cc-mods-composition-'))
  // A package scope here keeps the loader's resolver helpers inside the
  // fixture instead of walking up to an ancestor scope on hosts whose
  // directory chain owns a package.json.
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  const configPath = join(root, 'cordis.yml')
  // Every row mounts its plugin by source file URL. Dynamic imports inside
  // the loader resolve through node_modules, whose links depend on the host
  // install; a file URL loads the exact source-graph module the static
  // imports above already hold, on every platform.
  const workspaceEntry = (srcPath: string): string =>
    pathToFileURL(resolve(import.meta.dirname, '../../../..', srcPath)).href
  const modules = new Map<string, string>([
    ['@deepseek-ai/dsh-llm', 'packages/llm/llm/src/index.ts'],
    ['@deepseek-ai/dsh-session', 'packages/core/session/src/index.ts'],
    ['@deepseek-ai/dsh-session-projection', 'packages/session/session-projection/src/index.ts'],
    ['@deepseek-ai/dsh-system-prompt', 'packages/core/system-prompt/src/index.ts'],
    ['@deepseek-ai/dsh-fs-local', 'packages/fs/fs-local/src/index.ts'],
    ['@deepseek-ai/dsh-working-directory', 'packages/session/working-directory/src/index.ts'],
    ['@deepseek-ai/dsh-tools', 'packages/core/tools/src/index.ts'],
    ['@deepseek-ai/dsh-tool-executor-native', 'packages/core/tool-executor-native/src/index.ts'],
    ['@deepseek-ai/dsh-agent', 'packages/core/agent/src/index.ts'],
    ['@deepseek-ai/dsh-agent-loop', 'packages/core/agent-loop/src/index.ts'],
    ['@deepseek-ai/dsh-commands', 'packages/interaction/commands/src/index.ts'],
    ['@deepseek-ai/dsh-experimental-claude-code-mods', 'packages/experimental/claude-code-mods/src/index.ts'],
  ])
  // A mod is a plugin like any other: here the tutorial mod's `defineMod` wrapper, mounted by file URL after the bridge.
  const firstMod = pathToFileURL(resolve(FIXTURES, 'first-mod.ts')).href
  await writeFile(configPath, [
    ...[...modules.entries()].map(([, srcPath]) => `- name: '${workspaceEntry(srcPath)}'`),
    `- name: '${firstMod}'`,
    '  config:',
    '    greeting: The model made',
  ].join('\n') + '\n')

  const context = ctx = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = undefined
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  for (const entry of context.loader.entries()) await entry.fiber?.await()

  const adapter = new MockAdapter([toolCallResponse('c1', 'echo', { command: 'ls' }), textResponse('listed')])
  context.llm.registerAdapter(['mock'], adapter)
  context.tools.register(defineContentToolFixture({
    name: 'echo', description: 'echo', parameters: { command: { type: 'string' } },
    async execute(args) { return [{ type: 'text', text: `ran ${args.command}` }] },
  }))
  const agent = await context.agentLoop.create(SessionId('composed'), { provider: 'mock', model: 'mock' })
  expect(context.commands.list(agent).map(command => command.name)).toEqual(['tally'])
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'list the files here' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(adapter.requests).toHaveLength(2)
  const run = await context.commands.execute(agent, '/tally', [], new AbortController().signal)
  expect(run?.result).toEqual({ kind: 'success', text: 'first-mod: The model made 1 tool calls since this mod loaded' })
})
