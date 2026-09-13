/** Hybrid subprocess runtime: local ranges unchanged, remote cwd values use SSH channels. */

import { Buffer } from 'node:buffer'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import type { ClientChannel } from 'ssh2'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type {
  SubprocessCollect,
  SubprocessCollectedOutputs,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputMode,
  SubprocessOutputRead,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { parseRemoteExecutionPath } from './path.ts'

function quote(value: string): string {
  return `'${value.replaceAll("'", '\'"\'"\'')}'`
}

function executableName(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.exe') ? name.slice(0, -4) : name
}

function remoteCommand(spec: Pick<SubprocessSpawnSpec, 'argv' | 'env'>, cwd: string): string {
  const [program, ...args] = spec.argv
  if (program === undefined || program.length === 0) throw new TypeError('remote subprocess argv must contain a program')
  const environment = Object.entries(spec.env ?? {}).flatMap(([key, value]) => value === undefined ? [] : [`${key}=${quote(value)}`])
  const command = [quote(executableName(program)), ...args.map(quote)].join(' ')
  return `cd -- ${quote(cwd)} && exec ${environment.length === 0 ? '' : `env ${environment.join(' ')} `}${command}`
}

class TailReader implements SubprocessOutputReader {
  private chunks: Buffer[] = []
  private retained = 0
  private total = 0

  constructor(private readonly limit: number) {}

  push(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    this.total += bytes.length
    this.chunks.push(bytes)
    this.retained += bytes.length
    while (this.retained > this.limit) {
      const head = this.chunks[0] as Buffer
      const drop = Math.min(head.length, this.retained - this.limit)
      if (drop === head.length) this.chunks.shift()
      else this.chunks[0] = head.subarray(drop)
      this.retained -= drop
    }
  }

  readFrom(fromByte: number): SubprocessOutputRead {
    const retained = Buffer.concat(this.chunks, this.retained)
    const first = this.total - this.retained
    const lossy = fromByte < first
    const start = lossy ? 0 : Math.min(retained.length, Math.max(0, fromByte - first))
    return { text: retained.subarray(start).toString('utf8'), nextOffset: this.total, lossy }
  }
}

function isCollect(mode: SubprocessOutputMode): mode is SubprocessCollect {
  return typeof mode === 'object'
}

class SshProcessHandle implements SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>

  private channel: ClientChannel | undefined
  private terminated = false
  private settled = false

  constructor(open: Promise<ClientChannel>, spec: SubprocessSpawnSpec) {
    const input = spec.stdio.stdin === 'pipe' ? new PassThrough() : undefined
    const output = spec.stdio.stdout === 'pipe' ? new PassThrough() : undefined
    const errors = spec.stdio.stderr === 'pipe' ? new PassThrough() : undefined
    const stdoutReader = isCollect(spec.stdio.stdout) ? new TailReader(spec.stdio.stdout.maxBytes) : undefined
    const stderrReader = isCollect(spec.stdio.stderr) ? new TailReader(spec.stdio.stderr.maxBytes) : undefined
    this.stdin = input
    this.stdout = output
    this.stderr = errors
    this.collected = {
      ...(stdoutReader === undefined ? {} : { stdout: stdoutReader }),
      ...(stderrReader === undefined ? {} : { stderr: stderrReader }),
    }
    this.done = open.then(channel => new Promise<SubprocessOutcome>((resolve, reject) => {
      this.channel = channel
      if (this.terminated) channel.close()
      if (input !== undefined) input.pipe(channel)
      else if (typeof spec.stdio.stdin === 'object') channel.end(spec.stdio.stdin.data)
      else channel.end()
      this.route(channel, spec.stdio.stdout, output, stdoutReader, process.stdout)
      this.route(channel.stderr, spec.stdio.stderr, errors, stderrReader, process.stderr)
      let exitCode: number | null = null
      let signal: NodeJS.Signals | null = null
      channel.once('exit', (code: number | undefined, remoteSignal: string | undefined) => {
        exitCode = typeof code === 'number' ? code : null
        signal = remoteSignal === undefined ? null : remoteSignal as NodeJS.Signals
      })
      channel.once('error', reject)
      channel.once('close', () => {
        this.settled = true
        output?.end()
        errors?.end()
        resolve({ exitCode, signal })
      })
    }))
    spec.signal?.addEventListener('abort', () => { this.terminate() }, { once: true })
  }

  terminate(): void {
    if (this.settled || this.terminated) return
    this.terminated = true
    try { this.channel?.signal('TERM') } catch { this.channel?.close() }
  }

  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted === true) return false
    if (signal === undefined) {
      await this.done.catch(() => {})
      return true
    }
    return await Promise.race([
      this.done.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        signal.addEventListener('abort', () => { resolve(false) }, { once: true })
      }),
    ])
  }

  private route(
    source: Readable,
    mode: SubprocessOutputMode,
    pipe: PassThrough | undefined,
    reader: TailReader | undefined,
    inherited: Writable,
  ): void {
    if (mode === 'pipe') source.pipe(pipe as PassThrough)
    else if (mode === 'inherit') source.pipe(inherited, { end: false })
    else source.on('data', (chunk: Buffer | string) => reader?.push(chunk))
  }
}

class SshTerminalHandle implements SubprocessTerminalHandle {
  readonly pid = 0
  readonly output = new PassThrough()
  readonly done: Promise<SubprocessOutcome>
  private channel: ClientChannel | undefined
  private stopping = false

  constructor(open: Promise<ClientChannel>) {
    this.done = open.then(channel => new Promise<SubprocessOutcome>((resolve, reject) => {
      this.channel = channel
      channel.pipe(this.output)
      let exitCode: number | null = null
      let signal: NodeJS.Signals | null = null
      channel.once('exit', (code: number | undefined, remoteSignal: string | undefined) => {
        exitCode = typeof code === 'number' ? code : null
        signal = remoteSignal === undefined ? null : remoteSignal as NodeJS.Signals
      })
      channel.once('error', reject)
      channel.once('close', () => {
        this.output.end()
        resolve({ exitCode, signal })
      })
      if (this.stopping) channel.close()
    }))
  }

  async write(data: string): Promise<void> {
    const channel = this.channel
    if (channel === undefined) throw new Error('remote terminal is not ready')
    await new Promise<void>((resolve, reject) => {
      channel.write(data, (error) => {
        if (error === undefined) resolve()
        else reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    return Promise.resolve(undefined)
  }

  signalForeground(signal: SubprocessTerminalSignal): Promise<number> {
    const channel = this.channel
    if (channel === undefined) throw new Error('remote terminal is not ready')
    channel.signal(signal)
    return Promise.resolve(0)
  }

  async terminate(): Promise<void> {
    if (this.stopping) {
      await this.done.catch(() => {})
      return
    }
    this.stopping = true
    try { this.channel?.signal('TERM') } catch { this.channel?.close() }
    await this.done.catch(() => {})
  }
}

/** Routes machine-qualified working directories through SSH command channels. */
export class SshSubprocessRuntime extends LocalSubprocessRuntime {
  static inject = ['remoteMachines']

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const remote = parseRemoteExecutionPath(spec.cwd)
    if (remote === undefined) return super.spawn(spec)
    if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
    const command = remoteCommand(spec, remote.path)
    return new SshProcessHandle(this.ctx.remoteMachines.connections.exec(remote.machineId, command), spec)
  }

  override async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    const remote = parseRemoteExecutionPath(spec.cwd)
    if (remote === undefined) return await super.spawnTerminal(spec)
    spec.signal?.throwIfAborted()
    const command = remoteCommand({ argv: spec.argv, env: spec.env }, remote.path)
    const channel = this.ctx.remoteMachines.connections.exec(remote.machineId, command, {
      pty: { term: 'xterm-256color', rows: spec.rows, cols: spec.cols },
    })
    return new SshTerminalHandle(channel)
  }
}

export default SshSubprocessRuntime
