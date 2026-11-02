/** Web proxy startup through a real Loader tree and listening HTTP server. */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as WebApp from '../src/index.ts'

const originalDistIndex = WebApp.internals.resolveDistIndex
const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  WebApp.internals.resolveDistIndex = originalDistIndex
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    expect(resolve(root).startsWith(join(tmpdir(), 'dsh-web-zcode-'))).toBe(true)
    await rm(root, { recursive: true, force: true })
  }
})

class Adapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async listModels(provider: string) {
    return ['direct-model', 'glm-5.3', 'glm-5.3-flash', 'zcode/glm-5.3', 'zcode/glm-5.3-flash']
      .map(id => ({ provider, id, name: id }))
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'WEB_MODEL_OK' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function fixture(mode: 'gated' | 'failed') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-zcode-'))
  roots.push(root)
  const anchor = join(root, 'apps', 'cli', 'package.json')
  await mkdir(join(root, 'apps', 'cli'), { recursive: true })
  await mkdir(join(root, 'scripts'))
  await writeFile(anchor, '{}')
  await writeFile(join(root, 'index.html'), '<head></head><body>WEB_READY</body>')
  WebApp.internals.resolveDistIndex = () => join(root, 'index.html')
  await writeFile(join(root, 'scripts', 'sb-auto-start.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] !== 'start-zcode') process.exit(99);
fs.writeFileSync(path.join(__dirname, '../helper.pid'), String(process.pid));
fs.appendFileSync(path.join(__dirname, '../helper-starts'), 'start\\n');
${mode === 'failed' ? 'process.exit(17);' : 'setInterval(() => { if (fs.existsSync(path.join(__dirname, "../helper-ready"))) process.exit(0); }, 10);'}
`)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('profileContext', { home: root, name: 'web', installAnchor: anchor })
  // Authentication is outside startup ownership; serve only this isolated fixture page.
  ctx.provide('connection', { authorizeIndex: () => true } as never)
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { include: Include, server: WebServer, llm: LlmRuntime, web: WebApp })
  const config = join(root, 'cordis.yml')
  await writeFile(config, JSON.stringify([
    { id: 'server', name: 'cordis:server', config: { host: '127.0.0.1', port: 0 } },
    { id: 'llm', name: 'cordis:llm' },
    { id: 'web', name: 'cordis:web', config: { openBrowser: false, printUrl: false, surfaceContext: false } },
  ]))
  await ctx.loader.root.update([{ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(config).href } }])
  await ctx.loader.await()
  expect(ctx.loader.resolve('include:web').fiber?.state).toBe(FiberState.ACTIVE)
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['direct', 'zcode-direct', 'gateway'], adapter)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const web = ctx.loader.resolve('include:web').fiber!
  const url = `http://127.0.0.1:${String(ctx.webServer.port)}/`
  const stream = async (provider: string, model: string, signal?: AbortSignal): Promise<StreamChunk[]> => {
    const chunks: StreamChunk[] = []
    const stream = ctx.llm.stream({ provider, model, messages: [], ...signal === undefined ? {} : { signal } })
    for await (const chunk of stream) chunks.push(chunk)
    return chunks
  }
  const helperPid = async (): Promise<number> => {
    let pid = 0
    await vi.waitFor(async () => { pid = Number(await readFile(join(root, 'helper.pid'), 'utf8')) })
    return pid
  }
  return { ctx, root, adapter, warn, web, url, stream, helperPid }
}

describe('Web automatic ZCode startup', () => {
  it.each([
    ['zcode-direct', 'glm-5.3'], ['zcode-direct', 'glm-5.3-flash'],
    ['gateway', 'zcode/glm-5.3'], ['gateway', 'zcode/glm-5.3-flash'],
  ])('awaits one startup for concurrent %s/%s requests', async (provider, model) => {
    const { root, adapter, url, stream, helperPid } = await fixture('gated')
    expect(await (await fetch(url)).text()).toContain('WEB_READY')
    await expect(access(join(root, 'helper.pid'))).rejects.toThrow()
    const first = stream(provider, model)
    const second = stream(provider, model)
    await helperPid()
    expect(adapter.requests).toHaveLength(0)
    await expect(stream('direct', 'direct-model')).resolves.toContainEqual({ type: 'text-delta', index: 0, text: 'WEB_MODEL_OK' })
    expect(await (await fetch(url)).text()).toContain('WEB_READY')
    await writeFile(join(root, 'helper-ready'), '')
    await Promise.all([first, second])
    await stream(provider, model)
    expect(adapter.requests).toHaveLength(4)
    expect(await readFile(join(root, 'helper-starts'), 'utf8')).toBe('start\n')
  })

  it('warns once on startup failure while Web and other providers stay usable', async () => {
    const { root, warn, url, stream } = await fixture('failed')
    await stream('zcode-direct', 'glm-5.3-flash')
    await stream('gateway', 'zcode/glm-5.3')
    await expect(stream('direct', 'direct-model')).resolves.toContainEqual({ type: 'text-delta', index: 0, text: 'WEB_MODEL_OK' })
    expect(await (await fetch(url)).text()).toContain('WEB_READY')
    expect(await readFile(join(root, 'helper-starts'), 'utf8')).toBe('start\n')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]).toMatchInlineSnapshot(`
      [
        "ZCode proxy startup failed. Other providers remain available. Run pnpm zcode:setup and check ZCode login.",
      ]
    `)
  })

  it('cancels one wait independently, then disposes the pending helper and listener', async () => {
    const { ctx, adapter, warn, web, stream, helperPid } = await fixture('gated')
    const abort = new AbortController()
    const cancelled = stream('zcode-direct', 'glm-5.3', abort.signal)
    const pending = stream('gateway', 'zcode/glm-5.3-flash')
    const pid = await helperPid()
    abort.abort()
    expect(await cancelled).toEqual([{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'ZCode startup wait cancelled' } } }])
    expect(() => process.kill(pid, 0)).not.toThrow()
    await expect(stream('direct', 'direct-model')).resolves.toHaveLength(2)
    await web.dispose()
    expect(await pending).toEqual([{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'ZCode startup wait cancelled' } } }])
    expect(() => process.kill(pid, 0)).toThrow()
    expect(warn).not.toHaveBeenCalled()
    for await (const _chunk of ctx.llm.stream({ provider: 'zcode-direct', model: 'glm-5.3', messages: [] })) { /* Consume after listener disposal. */ }
    expect(adapter.requests).toHaveLength(2)
  })
})
