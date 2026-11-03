import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { Readable } from 'node:stream'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { scanZstdFrames } from '../../../../packages/session/session-persistence-jsonl/src/zstd.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const launch = resolveExampleLaunch({
  srcBin: join(repoRoot, 'apps/cli/src/bin.ts'),
  mode: 'lib',
})
const promptPlugin = fileURLToPath(new URL('../../../../packages/test-support/session-snapshot/tests/fixtures/prompt-lifecycle.mjs', import.meta.url))
function messagesResponse(): string {
  return [
    { type: 'message_start', message: { id: 'prompt-integrity-response', model: 'deepseek-v4-pro', usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'ok' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

interface RpcLine {
  readonly id?: number
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: Record<string, unknown>
}

function startRpcReader(
  stdout: Readable,
  stderr: () => string,
): (predicate: (line: RpcLine) => boolean) => Promise<RpcLine> {
  const pending: string[] = []
  const received: RpcLine[] = []
  let parseError: Error | undefined
  let buffer = ''
  stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    pending.push(...parts)
    while (pending.length > 0) {
      const line = pending.shift()!
      if (!line.trim()) continue
      try {
        received.push(JSON.parse(line) as RpcLine)
      } catch {
        parseError = new Error(`non-JSON stdout from SDK runtime: ${line}`)
      }
    }
  })
  return async (predicate) => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (parseError !== undefined) throw parseError
      const index = received.findIndex(predicate)
      if (index >= 0) return received.splice(index, 1)[0]!
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for SDK JSON-RPC message; stderr=${stderr()}`)
  }
}

function coreText(request: Record<string, unknown>): string {
  const system = request.system
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system.flatMap((block) => {
      if (typeof block !== 'object' || block === null) return []
      const text = (block as { text?: unknown }).text
      return typeof text === 'string' ? [text] : []
    }).join('\n\n')
  }
  const messages = request.messages
  if (Array.isArray(messages)) {
    return messages.flatMap((message) => {
      if (typeof message !== 'object' || message === null || (message as { role?: unknown }).role !== 'system') return []
      const content = (message as { content?: unknown }).content
      return typeof content === 'string' ? [content] : []
    }).join('\n\n')
  }
  throw new Error('local SDK model request omitted its system prompt')
}

describe('SDK prompt integrity lifecycle', () => {
  it('rebuilds changed core text across turns and rejects blank interpolation before HTTP dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-prompt-integrity-'))
    const stateFile = join(root, 'prompt.txt')
    const patchFile = join(root, 'prompt.cordis.yml')
    await writeFile(stateFile, 'SDK_PROMPT_ONE')
    await writeFile(patchFile, [
      '- insert:',
      '    - id: prompt-lifecycle-fixture',
      `      name: ${pathToFileURL(promptPlugin).href}`,
      `      config: { stateFile: ${JSON.stringify(stateFile)} }`,
      '',
    ].join('\n'))
    const requests: Record<string, unknown>[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        requests.push(JSON.parse(body) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(messagesResponse())
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('local SDK model server failed to bind')
    const child = execa(launch.command, [...launch.args, '--profile', 'sdk', '--patch', patchFile], {
      cwd: repoRoot,
      env: {
        ...launch.env,
        DSH_HOME: join(root, '.dsh'),
        DSH_PERMISSION_MODE: 'danger-full-access',
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: 'keyless-local-test',
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
      },
      timeout: 45_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const wait = startRpcReader(child.stdout, () => stderr)
    const send = async (id: number, marker: string): Promise<RpcLine> => {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0', id, method: 'session/prompt',
        params: { sessionId: 'prompt-integrity-sdk', contentBlocks: [{ type: 'text', text: marker }] },
      })}\n`)
      const accepted = await wait(line => line.id === id)
      expect(accepted.error).toBeUndefined()
      return wait(line => line.method === 'session.event'
        && line.params?.sessionId === 'prompt-integrity-sdk'
        && (line.params.event as { type?: string } | undefined)?.type === 'turn/end')
    }

    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { cwd: root, provider: 'deepseek-official', model: 'deepseek-v4-pro', maxTokens: 128 },
      })}\n`)
      expect(await wait(line => line.id === 1)).toMatchObject({ result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } } })

      expect((await send(2, 'first prompt')).params?.event).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(requests).toHaveLength(1)
      expect(coreText(requests[0]!)).toContain('SDK_PROMPT_ONE')

      await writeFile(stateFile, 'SDK_PROMPT_TWO')
      expect((await send(3, 'updated prompt')).params?.event).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(requests).toHaveLength(2)
      expect(coreText(requests[1]!)).toContain('SDK_PROMPT_TWO')
      expect(coreText(requests[1]!)).not.toBe(coreText(requests[0]!))
      expect(JSON.stringify(requests[1]!.messages)).toContain('first prompt')

      await writeFile(stateFile, ' \n\t')
      expect((await send(4, 'blank core')).params?.event).toMatchObject({
        type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'system-prompt: required section "deployment:persona-prefix" rendered empty' } } },
      })
      expect(requests).toHaveLength(2)

      await writeFile(stateFile, 'SDK_PROMPT_RECOVERED')
      expect((await send(5, 'recovered prompt')).params?.event).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(requests).toHaveLength(3)
      expect(coreText(requests[2]!)).toContain('SDK_PROMPT_RECOVERED')

      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'shutdown' })}\n`)
      expect(await wait(line => line.id === 6)).toMatchObject({ result: {} })
      const exit = await child
      expect(exit.exitCode, stderr).toBe(0)
      const files = await import('node:fs/promises').then(fs => fs.readdir(join(root, '.dsh', 'sessions'), { recursive: true }))
      const log = files.find(file => file.endsWith('.jsonl.zstd'))
      expect(log).toBeDefined()
      const compressed = await import('node:fs/promises').then(fs => fs.readFile(join(root, '.dsh', 'sessions', log!)))
      const { frames, tornStart } = scanZstdFrames(compressed)
      expect(tornStart).toBeUndefined()
      const data = Buffer.concat(frames.map(({ start, end }) => zstdDecompressSync(compressed.subarray(start, end)))).toString('utf8')
      const records = data.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      expect(records[0]).toMatchObject({ type: 'session', id: 'prompt-integrity-sdk' })
      expect(records.filter(record => record.type === 'turn/end')).toHaveLength(4)
    } finally {
      child.kill('SIGKILL')
      await child
      await new Promise<void>(resolve => server.close(() => { resolve() }))
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('rejects a wrong required core version without dispatching an HTTP request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-prompt-version-'))
    const patchFile = join(root, 'invalid-version.cordis.yml')
    await writeFile(patchFile, [
      '- id: system-prompt',
      '  config:',
      '    preserveSections: true',
      '    requiredSections:',
      "      tools:calling: '2'",
      "      deployment:persona-prefix: '1'",
      "      deployment:persona-suffix: '1'",
      "      harness:identity: '1'",
      '',
    ].join('\n'))
    let calls = 0
    const server = createServer((_request, response) => {
      calls++
      response.writeHead(500).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('local SDK model server failed to bind')
    const child = execa(launch.command, [...launch.args, '--profile', 'sdk', '--patch', patchFile], {
      cwd: repoRoot,
      env: {
        ...launch.env,
        DSH_HOME: join(root, '.dsh'),
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: 'keyless-local-test',
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${address.port}`,
      },
      timeout: 45_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const wait = startRpcReader(child.stdout, () => stderr)
    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { cwd: root, provider: 'deepseek-official', model: 'deepseek-v4-pro', maxTokens: 128 },
      })}\n`)
      expect(await wait(line => line.id === 1)).toMatchObject({ result: { serverInfo: { name: 'deepseek-harness-sdk-runtime' } } })
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'session/prompt',
        params: { sessionId: 'prompt-version-sdk', contentBlocks: [{ type: 'text', text: 'invalid core' }] },
      })}\n`)
      const accepted = await wait(line => line.id === 2)
      expect(accepted.result?.messageId).toEqual(expect.any(String))
      expect(await wait(line => line.method === 'session.event'
        && line.params?.sessionId === 'prompt-version-sdk'
        && (line.params.event as { type?: string } | undefined)?.type === 'turn/end')).toMatchObject({
        params: { event: { type: 'turn/end', data: { reason: { kind: 'error', error: {
          message: 'system-prompt: required section "tools:calling" has wrong version (expected "2", actual "1")',
        } } } } },
      })
      expect(calls).toBe(0)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'shutdown' })}\n`)
      expect(await wait(line => line.id === 3)).toMatchObject({ result: {} })
      expect((await child).exitCode, stderr).toBe(0)
    } finally {
      child.kill('SIGKILL')
      await child
      await new Promise<void>(resolve => server.close(() => { resolve() }))
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})
