/** Stdio diagnostics stay in harness logs without corrupting protocol output. */
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Config } from '../src/index.ts'
import { probeServer } from '../src/probe.ts'
import { startConnection, resolveReconnectPolicy } from '../src/connection.ts'
import { McpStatusCell } from '../src/status.ts'
import { TestCredentials } from './credential-fixture.ts'

const fixture = fileURLToPath(new URL('./fixtures/noisy-server.mjs', import.meta.url))

it.each(['probe', 'connection'] as const)('captures %s startup and shutdown diagnostics without writing to the terminal', async (mode) => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TestCredentials)
  const credentials = ctx.credentials as TestCredentials
  credentials.values.set('MCP_TOKEN', 'fixture-token')
  const config = Config({ transport: 'stdio', serverName: 'noisy', command: process.execPath,
    args: [fixture], env: { FIXTURE_TOKEN: '${credential:MCP_TOKEN}' }, expandTemplates: true,
    cwd: process.cwd(), startupTimeoutMs: 10_000,
    reconnect: { enabled: false } })
  const stderr = vi.spyOn(process.stderr, 'write')
  onTestFinished(() => { stderr.mockRestore() })
  if (mode === 'probe') {
    expect(await probeServer(ctx, config)).toMatchObject({ ok: true, serverInfo: { name: 'noisy' }, toolNames: [], closeConfirmed: true })
  } else {
    const handle = startConnection(ctx, config, resolveReconnectPolicy(config.reconnect, 'noisy'), new McpStatusCell(() => {}))
    onTestFinished(() => handle.dispose())
    expect(await handle.ready).toEqual({})
    await handle.dispose()
  }
  const logs: unknown[] = ctx.logger.buffer.flatMap((message): unknown[] => message.args)
  expect(logs).toContain('พร้อม')
  expect(logs).toContain('initialize: [redacted]')
  expect(logs).toContain('tools/list: [redacted]')
  expect(logs).toContain('final diagnostic')
  expect(JSON.stringify(logs)).not.toContain('fixture-token')
  expect(ctx.logger.buffer.map(message => ({ type: message.type, args: message.args }))).toMatchSnapshot()
  expect(stderr).not.toHaveBeenCalled()
})

it('keeps failed startup visible through connection diagnostics', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const config = Config({ transport: 'stdio', serverName: 'noisy', command: process.execPath,
    args: [fixture, '--fail'], env: {}, cwd: process.cwd(), startupTimeoutMs: 10_000,
    reconnect: { enabled: false } })
  const status = new McpStatusCell(() => {})
  const handle = startConnection(ctx, config, resolveReconnectPolicy(config.reconnect, 'noisy'), status)
  onTestFinished(() => handle.dispose())
  expect((await handle.ready).error).toBeDefined()
  await vi.waitFor(() => {
    expect(ctx.logger.buffer.some(message => message.type === 'warn' && String(message.args[0]).includes('connection attempt failed'))).toBe(true)
  })
  expect(ctx.logger.buffer.flatMap((message): unknown[] => message.args)).toContain('initialize: no token')
})
