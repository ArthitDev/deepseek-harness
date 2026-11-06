import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as Persona from '@deepseek-ai/dsh-persona'
import PentestModePolicy from '@deepseek-ai/dsh-pentest-executor'
import { type Terminal } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'
import AgentDefaultModel from '../../../core/agent-default-model/src/index.ts'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentPreset from '../../../preset/agent-preset/src/index.ts'
import * as piTui from '../src/index.ts'
import { ensureSbProxy, ensureZcodeProxy } from '../src/core/zcode-proxy.ts'

const { terminal } = vi.hoisted(() => ({ terminal: {
  columns: 180, rows: 60, kittyProtocolActive: false,
  start: vi.fn<Terminal['start']>(), stop: vi.fn(), drainInput: async () => {},
  write: vi.fn(), moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(),
  clearLine: vi.fn(), clearFromCursor: vi.fn(), clearScreen: vi.fn(),
  setTitle: vi.fn(), setProgress: vi.fn(), setProgramStatus: vi.fn(),
} }))
vi.mock('../src/ui/clipboard-terminal.js', () => ({
  ClipboardTerminal: function ClipboardTerminal() { return terminal },
}))
vi.mock('../src/core/git.js', () => ({ readGitState: async () => undefined }))

class DirectAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async listModels(provider: string) {
    const ids = provider === 'direct' ? ['direct-model'] : provider === 'zcode-direct'
      ? ['glm-5.3', 'glm-5.3-flash'] : ['zcode/glm-5.3', 'zcode/glm-5.3-flash']
    return ids.map(id => ({ provider, id, name: id }))
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'DIRECT_MODEL_OK' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'DIRECT_MODEL_OK' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture(mode: 'ready' | 'failed' | 'pending' | 'gated', sbMode = mode) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-tui-zcode-'))
  const anchor = join(home, 'apps', 'cli', 'package.json')
  await mkdir(join(home, 'apps', 'cli'), { recursive: true })
  await mkdir(join(home, 'scripts'))
  await writeFile(anchor, '{}')
  await writeFile(join(home, 'scripts', 'sb-auto-start.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] !== 'start-zcode') process.exit(99);
fs.writeFileSync(path.join(__dirname, '../helper.pid'), String(process.pid));
fs.appendFileSync(path.join(__dirname, '../helper-starts'), 'start\\n');
${mode === 'gated' ? 'setInterval(() => { if (fs.existsSync(path.join(__dirname, "../helper-ready"))) process.exit(0); }, 10);'
  : mode === 'pending' ? 'setInterval(() => {}, 1000);' : `process.exit(${mode === 'ready' ? '0' : '17'});`}
`)
  await writeFile(join(home, 'scripts', 'sb-transport.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] !== 'start') process.exit(99);
fs.writeFileSync(path.join(__dirname, '../sb-helper.pid'), String(process.pid));
${sbMode === 'pending' ? 'setInterval(() => {}, 1000);' : `process.exit(${sbMode === 'ready' ? '0' : '17'});`}
`)
  return { home, anchor }
}

async function cleanup(home: string): Promise<void> {
  expect(resolve(home).startsWith(join(tmpdir(), 'dsh-tui-zcode-'))).toBe(true)
  await rm(home, { recursive: true, force: true })
}

describe('ZCode startup helper', () => {
  it.each(['ready', 'failed'] as const)('settles a relocated SB launcher that is %s', { timeout: 30_000 }, async (mode) => {
    const { home, anchor } = await fixture(mode)
    try {
      const result = ensureSbProxy(anchor)
      if (mode === 'ready') await expect(result).resolves.toBeUndefined()
      else await expect(result).rejects.toThrow('SB startup helper exited with 17')
      expect(Number(await readFile(join(home, 'sb-helper.pid'), 'utf8'))).toBeGreaterThan(0)
    } finally { await cleanup(home) }
  })
  it.each(['ready', 'failed'] as const)('settles a relocated launcher that is %s', { timeout: 30_000 }, async (mode) => {
    const { home, anchor } = await fixture(mode)
    try {
      const result = ensureZcodeProxy(anchor)
      if (mode === 'ready') await expect(result).resolves.toBeUndefined()
      else await expect(result).rejects.toThrow('exited with 17')
      expect(Number(await readFile(join(home, 'helper.pid'), 'utf8'))).toBeGreaterThan(0)
    } finally { await cleanup(home) }
  })

  it('waits for a cancelled helper to exit', { timeout: 30_000 }, async () => {
    const { home, anchor } = await fixture('pending')
    const abort = new AbortController()
    const result = ensureZcodeProxy(anchor, abort.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    try {
      let pid = 0
      await vi.waitFor(async () => { pid = Number(await readFile(join(home, 'helper.pid'), 'utf8')) })
      abort.abort()
      await rejected
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      abort.abort()
      await rejected
      await cleanup(home)
    }
  })
})

describe('TUI startup through Loader with optional proxies', () => {
  it.each([
    ['ready', 'ready', 'direct', 'direct-model'],
    ['failed', 'failed', 'direct', 'direct-model'],
    ['pending', 'pending', 'direct', 'direct-model'],
    ['pending', 'failed', 'direct', 'direct-model'],
    ['failed', 'pending', 'direct', 'direct-model'],
    ['ready', 'ready', 'zcode-direct', 'glm-5.3'],
    ['ready', 'ready', 'zcode-direct', 'glm-5.3-flash'],
    ['ready', 'ready', 'gateway', 'zcode/glm-5.3'],
    ['ready', 'ready', 'gateway', 'zcode/glm-5.3-flash'],
    ['failed', 'ready', 'zcode-direct', 'glm-5.3-flash'],
    ['pending', 'ready', 'zcode-direct', 'glm-5.3-flash'],
    ['gated', 'ready', 'zcode-direct', 'glm-5.3-flash'],
  ] as const)('starts ZCode only on use: %s/%s %s/%s', { timeout: 30_000 }, async (mode, sbMode, provider, model) => {
    const { home, anchor } = await fixture(mode, sbMode)
    const ctx = new Context()
    const adapter = new DirectAdapter()
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    terminal.start.mockClear()
    terminal.write.mockClear()
    try {
      await mountAgentLoopTestDependencies(ctx, { systemPrompt: { personaPrefix: 'DIRECT_MODEL_SYSTEM' } })
      ctx.llm.registerAdapter(['direct', 'zcode-direct', 'gateway'], adapter)
      ctx.provide('cmdlineArgs', { get: () => [] })
      ctx.provide('profileContext', { home, dir: home, name: 'tui', installAnchor: anchor })
      ctx.provide('workspaceRegistry', { resolveByPath: async () => ({ attachSession: async () => {} }) })
      await ctx.plugin(Loader)
      Object.assign(ctx.loader.builtins, {
        include: Include, loop: AgentLoop, sessions: SessionStore, agents: AgentRegistry, agentPresets: AgentPresetRegistry,
        preset: AgentPreset, projections: SessionProjectionRegistry, model: AgentDefaultModel,
        policy: PentestModePolicy, persona: Persona, tui: piTui,
      })
      const composition = join(home, 'cordis.yml')
      await writeFile(composition, JSON.stringify([
        { id: 'agent-loop', name: 'cordis:loop', config: { agents: [] } },
        { id: 'pentest-mode', name: 'cordis:policy', config: { mode: 'red', suppressSections: false } },
        { id: 'agent-preset-registry', name: 'cordis:agentPresets', config: { default: 'test' } },
        { id: 'agent-preset-test', name: 'cordis:preset', config: { id: 'test', name: 'Test', plugins: [] } },
        { id: 'agent-default-model', name: 'cordis:model', config: { provider, model } },
        { id: 'tui', name: 'cordis:tui', config: { cwd: home } },
      ]))
      await ctx.loader.root.update([{ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(composition).href } }])
      await ctx.loader.await()
      expect(terminal.start).toHaveBeenCalledOnce()
      const visible = () => stripVTControlCharacters(terminal.write.mock.calls.flat().join(''))
      await expect(access(join(home, 'helper.pid'))).rejects.toThrow()
      expect(visible()).not.toContain('ZCode proxy startup failed.')
      if (sbMode === 'failed') {
        await vi.waitFor(() => { expect(visible()).toContain('SB transport startup failed.') })
        expect(visible().match(/SB transport startup failed\.[^│]+/)?.[0].trim()).toMatchInlineSnapshot('"SB transport startup failed. Direct providers remain available. Run pnpm sb:status and check the SB log or port conflict."')
      }
      const input = terminal.start.mock.calls[0]![0]
      if (provider !== 'direct' && mode === 'pending') {
        const abort = new AbortController()
        const chunks: StreamChunk[] = []
        const request = (async () => {
          for await (const chunk of ctx.llm.stream({ provider, model, messages: [], signal: abort.signal })) chunks.push(chunk)
        })()
        await vi.waitFor(async () => { expect(Number(await readFile(join(home, 'helper.pid'), 'utf8'))).toBeGreaterThan(0) })
        expect(adapter.requests).toHaveLength(0)
        abort.abort()
        await request
        expect(chunks).toEqual([{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'ZCode startup wait cancelled' } } }])
        input('/model direct/direct-model')
        input('\r')
        await vi.waitFor(() => { expect(visible()).toContain('model → direct-model (direct)') })
      }
      input('direct provider still works')
      input('\r')
      if (mode === 'gated') {
        await vi.waitFor(async () => { expect(Number(await readFile(join(home, 'helper.pid'), 'utf8'))).toBeGreaterThan(0) })
        expect(adapter.requests).toHaveLength(0)
        const concurrent = (async () => {
          for await (const _chunk of ctx.llm.stream({ provider, model, messages: [] })) { /* Consume the concurrent request. */ }
        })()
        await writeFile(join(home, 'helper-ready'), '')
        await concurrent
      }
      await vi.waitFor(() => { expect(adapter.requests).toHaveLength(mode === 'gated' ? 2 : 1) })
      await vi.waitFor(() => { expect(visible()).toContain('DIRECT_MODEL_OK') })
      const route = mode === 'pending' ? { provider: 'direct', model: 'direct-model' } : { provider, model }
      expect(adapter.requests[0]).toMatchObject(route)
      if (provider === 'direct') {
        await expect(access(join(home, 'helper.pid'))).rejects.toThrow()
      } else {
        await vi.waitFor(async () => { expect(Number(await readFile(join(home, 'helper.pid'), 'utf8'))).toBeGreaterThan(0) })
        if (mode === 'failed') {
          await vi.waitFor(() => { expect(visible()).toContain('ZCode proxy startup failed.') })
          expect(visible().match(/ZCode proxy startup failed\.[^│]+/)?.[0].trim()).toMatchInlineSnapshot('"ZCode proxy startup failed. Use /model to select another provider. Run pnpm zcode:setup and check ZCode login."')
        }
        if (mode !== 'pending') {
          for await (const _chunk of ctx.llm.stream({ provider, model, messages: [] })) { /* Consume the second request. */ }
          expect(await readFile(join(home, 'helper-starts'), 'utf8')).toBe('start\n')
        }
      }
      if (sbMode === 'pending') {
        await vi.waitFor(async () => { expect(Number(await readFile(join(home, 'sb-helper.pid'), 'utf8'))).toBeGreaterThan(0) })
        const sbPid = Number(await readFile(join(home, 'sb-helper.pid'), 'utf8'))
        await ctx.fiber.dispose()
        expect(() => process.kill(sbPid, 0)).toThrow()
      }
      if (provider !== 'direct' && mode === 'pending') {
        const pid = Number(await readFile(join(home, 'helper.pid'), 'utf8'))
        await ctx.fiber.dispose()
        expect(() => process.kill(pid, 0)).toThrow()
      }
    } finally {
      await ctx.fiber.dispose()
      if (stdoutTTY === undefined) Reflect.deleteProperty(process.stdout, 'isTTY')
      else Object.defineProperty(process.stdout, 'isTTY', stdoutTTY)
      await cleanup(home)
    }
  })
})
