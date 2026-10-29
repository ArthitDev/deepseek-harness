/** Lazy discovery through the real Loader and MCP SDK, with native policy enforcement. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { InMemoryTransport, type Transport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as mcpClient from '../src/index.ts'

const { transport } = vi.hoisted(() => ({ transport: vi.fn<() => Transport>() }))
vi.mock('../src/transport.ts', () => ({ createTransport: transport }))

async function boot() {
  const server = new McpServer({ name: 'catalog-fixture', version: '1' })
  const invoked = vi.fn(async ({ text }: { text: string }) => ({ content: [{ type: 'text' as const, text }] }))
  server.registerTool('echo', { description: 'Echo a supplied string', inputSchema: z.object({ text: z.string() }) }, invoked)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const serving = serveStdio(() => server, { transport: serverTransport })
  transport.mockReturnValue(clientTransport)
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-discovery-'))
  const ctx = new Context()
  const errors: unknown[] = []
  ctx.logger.error = (error: unknown) => { errors.push(error) }
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await serving.close()
    await rm(root, { recursive: true, force: true })
  })
  const path = join(root, 'cordis.yml')
  await writeFile(path, [
    '- name: cordis:system-prompt',
    '- name: cordis:tools',
    '- name: cordis:mcp-client',
    '  config:',
    '    transport: stdio',
    '    serverName: fixture',
    '    command: fixture',
    '    failOnStartupError: true',
    '    toolDiscovery: lazy',
    '    discoveryResultLimit: 1',
    '    reconnect:',
    '      enabled: false',
    '',
  ].join('\n'))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  Object.assign(ctx.loader.builtins, { 'system-prompt': SystemPrompt, tools: ToolRuntime, 'mcp-client': mcpClient })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  expect(errors).toEqual([])
  expect([...ctx.loader.entries()].map(entry => ({ name: entry.options.name, state: entry.fiber?.state })))
    .toMatchObject(expect.arrayContaining([{ name: 'cordis:mcp-client', state: FiberState.ACTIVE }]))
  const call = (args: object, agent?: Agent) => ctx.tools.execute({
    name: 'mcp__fixture__discover_tools', arguments: args,
    callId: ToolCallId('catalog-call'), signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent },
  })
  return { ctx, call, server, invoked }
}

describe('lazy MCP discovery', () => {
  it('loads from YAML, searches, reads one schema, dispatches through native policy, and unloads', async () => {
    const { ctx, call, invoked } = await boot()
    expect((await ctx.systemPrompt.assemble()).tools.map(tool => tool.name)).toEqual(['mcp__fixture__discover_tools'])
    expect((await ctx.systemPrompt.assemble()).tools).toMatchSnapshot('lazy tool schema')
    const search = await call({ action: 'search', query: 'echo' })
    expect(search).toMatchSnapshot('search result')
    const schema = await call({ action: 'schema', tool: 'mcp__fixture__echo' })
    expect(schema).toMatchSnapshot('selected schema')
    expect(await call({ action: 'call', tool: 'mcp__fixture__echo', arguments: { text: 'hello' } }))
      .toMatchObject({ isError: false, content: [{ type: 'text', text: 'hello' }] })
    expect(invoked).toHaveBeenCalledOnce()
    const remove = ctx.on('tools/pre-execute', async (exec, next) => exec.name === 'mcp__fixture__echo'
      ? { kind: 'deny', reason: 'operator disabled this tool', info: { name: 'ScopeDenied', code: 'SCOPE_DENIED' } } : next())
    const denied = await call({ action: 'call', tool: 'mcp__fixture__echo', arguments: { text: 'blocked' } })
    expect(denied.isError).toBe(true)
    if (denied.isError) {
      expect(denied.error.message).toContain('operator disabled this tool')
      expect(denied.error.info).toEqual({ name: 'ScopeDenied', code: 'SCOPE_DENIED' })
    }
    expect(invoked).toHaveBeenCalledOnce()
    remove()
    expect((await call({ action: 'call', tool: 'mcp__fixture__echo', arguments: { text: 3 } })).isError).toBe(true)
    expect(invoked).toHaveBeenCalledOnce()
    const entry = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:mcp-client')
    expect(entry?.fiber).toBeDefined()
    await entry?.fiber?.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect((await ctx.systemPrompt.assemble()).tools).toEqual([])
  })

  it('refreshes catalog generations and paginates results without exposing schemas', async () => {
    const { ctx, call, server } = await boot()
    server.registerTool('ping', { description: 'Respond with pong', inputSchema: z.object({}) }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }))
    await vi.waitFor(async () => {
      expect(await call({ action: 'list' })).toMatchObject({ value: { total: 2, nextOffset: 1 } })
    })
    expect(await call({ action: 'list', offset: 1 })).toMatchObject({
      value: { tools: [{ name: 'mcp__fixture__ping' }], nextOffset: null },
    })
    expect((await ctx.systemPrompt.assemble()).tools.map(tool => tool.name)).toEqual(['mcp__fixture__discover_tools'])
    expect((await call({ action: 'search', query: '   ' })).isError).toBe(true)
    expect((await call({ action: 'list', offset: -1 })).isError).toBe(true)
    expect((await call({ action: 'call', tool: 'mcp__other__ping' })).isError).toBe(true)
  })

  it('does not discover or execute native tools hidden from the calling agent', async () => {
    const { ctx, call, invoked } = await boot()
    const agent = {} as Agent
    await ctx.plugin({ inject: ['tools'], apply(inner: Context) {
      const scoped = createScope(inner, agent)
      inner.effect(() => scoped.rawDispose)
      scoped.ctx.tools.restrict({ allow: ['mcp__fixture__discover_tools'] })
    } })
    expect(await call({ action: 'list' }, agent)).toMatchObject({ value: { tools: [], total: 0 } })
    expect((await call({ action: 'schema', tool: 'mcp__fixture__echo' }, agent)).isError).toBe(true)
    expect((await call({ action: 'call', tool: 'mcp__fixture__echo', arguments: { text: 'hidden' } }, agent)).isError).toBe(true)
    expect(invoked).not.toHaveBeenCalled()
  })

  it('keeps native schemas when an existing allow-list excludes the discovery helper', async () => {
    const { ctx } = await boot()
    const agent = {} as Agent
    await ctx.plugin({ inject: ['tools'], apply(inner: Context) {
      const scoped = createScope(inner, agent)
      inner.effect(() => scoped.rawDispose)
      scoped.ctx.tools.restrict({ allow: ['mcp__fixture__echo'] })
    } })
    expect((await ctx.systemPrompt.assemble({ scope: agent })).tools.map(tool => tool.name)).toEqual(['mcp__fixture__echo'])
  })
})
