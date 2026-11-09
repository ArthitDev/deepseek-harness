/** Operator controls for embedded model proxies; no startup work until explicitly enabled or used. */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { get } from 'node:http'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, remoteErrorOf, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ProxyId, ProxyServerRow } from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** New model requests cannot use a disabled embedded proxy. */
    'proxy-server/disabled': { id: ProxyId }
    /** An unrelated process occupies the configured loopback port. */
    'proxy-server/port-in-use': { id: ProxyId }
    /** Required bundled files or local proxy setup are absent. */
    'proxy-server/setup-required': { id: ProxyId }
    /** The managed child failed to become healthy before its deadline. */
    'proxy-server/start-failed': { id: ProxyId }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Embedded proxy roster and lifecycle, shared by model routes and operator controls. */
    proxyServers: ProxyServers
  }
}

/** Live usage switches and deployment-specific ports, routes and startup deadline. */
export interface Config {
  zcodeEnabled: Volatile<boolean>
  antigravityEnabled: Volatile<boolean>
  sbEnabled: Volatile<boolean>
  zcodePort: number
  antigravityPort: number
  sbPort: number
  zcodeProviders: string[]
  antigravityProviders: string[]
  sbProviders: string[]
  startupTimeoutMs: number
}

interface Descriptor {
  id: ProxyId
  name: string
  port: number
  enabled: Volatile<boolean>
  providers: string[]
  command: string
  args: string[]
  cwd: string
  files: string[]
  active: number
}
interface OwnedProcess { child: ChildProcess; closed: Promise<void> }

/** Probe only a loopback port; no credentials or upstream requests. */
async function listening(port: number): Promise<boolean> {
  return new Promise((complete) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(500)
    const finish = (alive: boolean): void => { socket.destroy(); complete(alive) }
    socket.once('connect', () => { finish(true) })
    socket.once('error', () => { finish(false) })
    socket.once('timeout', () => { finish(false) })
  })
}

/** Validate sidecar identity without reading model output or authentication state. */
async function healthy(server: Descriptor, ownedZcode = false): Promise<boolean> {
  // ZCode has no unique health identity; generic HTTP status cannot identify an unowned listener.
  if (server.id === 'zcode' && !ownedZcode) return false
  return new Promise((complete) => {
    const request = get({ hostname: '127.0.0.1', port: server.port, path: server.id === 'zcode' ? '/v1/models' : '/health', signal: AbortSignal.timeout(1000) }, (response) => {
      if (server.id === 'zcode') {
        response.resume()
        complete(response.statusCode === 401 || response.statusCode === 200)
        return
      }
      let body = ''
      response.once('close', () => { complete(false) })
      response.setEncoding('utf8')
      response.on('data', (part: string) => { body += part; if (body.length > 4096) response.destroy() })
      response.once('error', () => { complete(false) })
      response.once('end', () => {
        try {
          const value: unknown = JSON.parse(body)
          complete(response.statusCode === 200 && typeof value === 'object' && value !== null && 'service' in value
            && value.service === (server.id === 'sb' ? 'dsh-sb-transport' : 'antigravity-proxy'))
        } catch { complete(false) }
      })
    })
    request.once('error', () => { complete(false) })
  })
}

/** Host-owned children are stopped through their live handles; external listeners are never killed. */
export default class ProxyServers extends TypertRemoteService {
  static inject = ['profileContext', 'settings']
  static Config = z.object({
    zcodeEnabled: z.boolean().default(true).volatile(),
    antigravityEnabled: z.boolean().default(true).volatile(),
    sbEnabled: z.boolean().default(true).volatile(),
    zcodePort: z.number().step(1).min(1).max(65535).default(Number(process.env.ZCODE_PORT ?? 18080)),
    antigravityPort: z.number().step(1).min(1).max(65535).default(Number(process.env.ANTIGRAVITY_PORT ?? 18877)),
    sbPort: z.number().step(1).min(1).max(65535).default(Number(process.env.SB_PORT ?? 18899)),
    zcodeProviders: z.array(z.string()).default(['zcode-direct']),
    antigravityProviders: z.array(z.string()).default(['antigravity']),
    sbProviders: z.array(z.string()).default(['sb', 'sb-proxy']),
    startupTimeoutMs: z.number().step(1).min(100).default(15_000),
  })
  private readonly servers: Descriptor[]
  private readonly owned = new Map<ProxyId, OwnedProcess>()
  private readonly pending = new Map<ProxyId, Promise<void>>()
  private readonly controller = new AbortController()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'proxyServers')
    const root = resolve(dirname(ctx.profileContext.installAnchor), '../..')
    const zcode = resolve(process.env.ZCODE_DIR ?? join(root, 'third-party/zcode-api'))
    const antigravity = join(root, 'packages/experimental/pi-tui/tools/antigravity-proxy/antigravity_proxy.mjs')
    const sb = join(root, 'scripts/sb-transport.cjs')
    this.servers = [
      { id: 'zcode', name: 'ZCode Direct', active: 0, port: config.zcodePort, enabled: config.zcodeEnabled, providers: config.zcodeProviders,
        command: 'bun', args: ['run', 'src/index.ts', 'serve', join(zcode, 'config.yaml')], cwd: zcode,
        files: [join(zcode, 'src/index.ts'), join(zcode, 'config.yaml'), join(zcode, 'src/proxy/captcha-worker-entry.bundle.js')] },
      { id: 'antigravity', name: 'Antigravity', active: 0,
        port: config.antigravityPort, enabled: config.antigravityEnabled, providers: config.antigravityProviders,
        command: process.execPath, args: [antigravity], cwd: root, files: [antigravity] },
      { id: 'sb', name: 'SB transport', active: 0, port: config.sbPort, enabled: config.sbEnabled, providers: config.sbProviders,
        command: process.execPath, args: [sb, 'serve'], cwd: root, files: [sb] },
    ]
    ctx.settings.configure({ auto: false }, ctx.fiber)
    ctx.on('llm/stream', this.stream.bind(this), { global: true })
    ctx.effect(() => async () => {
      this.controller.abort()
      await Promise.allSettled(this.pending.values())
      await Promise.all(this.servers.map(server => this.stop(server)))
    }, 'proxy-server: managed children')
  }

  /** Return current loopback listener state without starting anything.
   * @returns Three embedded proxy descriptors with persistent usage preferences.
   */
  @Remote
  async list(): Promise<ProxyServerRow[]> {
    return Promise.all(this.servers.map(async server => ({
      id: server.id, name: server.name, endpoint: `http://127.0.0.1:${server.port}/v1`,
      enabled: server.enabled.get(), available: server.files.every(file => existsSync(file)), providers: server.providers,
      status: await healthy(server, this.owned.has(server.id)) ? this.owned.has(server.id) ? 'running' : 'external'
        : await listening(server.port) ? 'port-in-use' : 'stopped',
    })))
  }

  /** Persist usage and start or stop the selected proxy. Other proxies and external processes remain untouched.
   * @param id Embedded proxy identity.
   * @param enabled Whether new Harness model requests may use this proxy.
   * @returns After saving and startup/idle shutdown; active streams defer shutdown, and startup failure retains the preference.
   */
  @Remote
  async setEnabled(id: ProxyId, enabled: boolean): Promise<void> {
    const server = this.servers.find(row => row.id === id)
    if (server === undefined) throw new RemoteError('gateway/bad-request', 'Unknown embedded proxy', {})
    await this.queue(server, async () => {
      await this.ctx.settings.update('proxy-servers', { [`${id}Enabled`]: enabled })
      if (enabled) await this.start(server)
      else if (server.active === 0) await this.stop(server)
    })
  }

  private async * stream(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const server = this.servers.find(row => row.providers.includes(options.provider) || options.model.startsWith(`${row.id}/`))
    if (server === undefined) { yield* next(); return }
    try {
      await this.queue(server, async () => {
        if (!server.enabled.get()) {
          throw new RemoteError('proxy-server/disabled', `${server.name} is disabled in Proxy Server settings`, { id: server.id })
        }
        await this.start(server)
        server.active++
      })
    } catch (error) {
      const failure = remoteErrorOf(error)
      yield { type: 'finish', reason: { kind: 'error', failure: {
        code: failure?.code ?? 'proxy-server/start-failed',
        message: failure?.message ?? `${server.name} could not start; check Proxy Server settings and local setup`,
      } } }
      return
    }
    try { yield* next() }
    finally {
      server.active--
      if (server.active === 0 && !server.enabled.get() && !this.controller.signal.aborted) {
        await this.queue(server, async () => {
          if (!server.enabled.get() && server.active === 0) await this.stop(server)
        })
      }
    }
  }

  private queue(server: Descriptor, operation: () => Promise<void>): Promise<void> {
    const previous = this.pending.get(server.id) ?? Promise.resolve()
    // A failed operation is reported to its caller; later explicit attempts remain usable.
    const task = previous.catch((error: unknown) => { void error }).then(() => {
      if (this.controller.signal.aborted) throw new Error('Proxy host is closing')
      return operation()
    })
    this.pending.set(server.id, task)
    const settled = (): void => { if (this.pending.get(server.id) === task) this.pending.delete(server.id) }
    void task.then(settled, settled)
    return task
  }

  private async start(server: Descriptor): Promise<void> {
    if (await healthy(server, this.owned.has(server.id))) return
    if (this.owned.has(server.id)) {
      throw new RemoteError('proxy-server/start-failed', `${server.name} child is not ready; turn it off before retrying`, { id: server.id })
    }
    if (await listening(server.port)) {
      throw new RemoteError('proxy-server/port-in-use', `${server.name} port is occupied by another service`, { id: server.id })
    }
    if (!server.files.every(file => existsSync(file))) {
      throw new RemoteError('proxy-server/setup-required', `${server.name} bundled files or local setup are missing`, { id: server.id })
    }
    const env = { ...scrubbedParentEnv(), HOST: '127.0.0.1', ZCODE_PORT: String(this.config.zcodePort),
      ZCODE_PROXY_PORT: String(this.config.zcodePort), ANTIGRAVITY_PORT: String(this.config.antigravityPort),
      SB_PORT: String(this.config.sbPort),
      ZCODE_CAPTCHA_WORKER: join(server.cwd, 'src/proxy/captcha-worker-entry.bundle.js'), ZCODE_CAPTCHA_REQUIRE_WORKER: '1' }
    const child = spawn(server.command, server.args, { cwd: server.cwd, env, stdio: 'ignore', windowsHide: true })
    const state = { failed: false }
    child.once('error', () => { state.failed = true })
    const closed = new Promise<void>((complete) => { child.once('close', () => { if (this.owned.get(server.id)?.child === child) this.owned.delete(server.id); complete() }) })
    this.owned.set(server.id, { child, closed })
    try {
      const deadline = Date.now() + this.config.startupTimeoutMs
      while (Date.now() < deadline) {
        if (state.failed || child.exitCode !== null || child.signalCode !== null) break
        if (await healthy(server, true)) return
        await delay(100, undefined, { signal: this.controller.signal })
      }
      throw new RemoteError('proxy-server/start-failed', `${server.name} did not become ready; check its local installation`, { id: server.id })
    } catch (error) { await this.stop(server); throw error }
  }

  private async stop(server: Descriptor): Promise<void> {
    const owned = this.owned.get(server.id)
    if (owned === undefined) return
    owned.child.kill()
    const timer = new AbortController()
    try {
      await Promise.race([owned.closed, delay(2000, undefined, { signal: timer.signal })])
      if (this.owned.get(server.id) === owned) owned.child.kill('SIGKILL')
      await owned.closed
    } finally { timer.abort() }
  }
}
