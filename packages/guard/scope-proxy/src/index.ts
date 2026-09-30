/**
 * Scope-pinning forward proxy for autonomous (Dead Mode) runs without a
 * sandbox. The proxy listens on loopback and speaks the two forms HTTP clients
 * actually send through `HTTP_PROXY`: absolute-form requests (`GET
 * http://host/path`) and `CONNECT host:port` tunnels. Every connection is
 * judged against the same normalized scope vocabulary as `scope-policy`
 * (`dsh-pentest-run`), the hostname is resolved exactly once, and the outbound
 * socket is opened to the validated address — so a DNS rebinding race between
 * judgment and connection cannot re-point the socket. TLS stays end-to-end:
 * CONNECT tunnels are blind pipes, so certificate validation remains the
 * client's.
 *
 * The proxy URL is contributed to the managed shell environment as
 * `DSH_SCOPE_PROXY`; point the run's `HTTP_PROXY`/`HTTPS_PROXY` at it (curl,
 * pwsh `Invoke-WebRequest`, and most tooling honor those) and every shell
 * connection is scope-enforced and pinned. Bind to loopback only — the proxy
 * judges by target, not by caller.
 *
 * @module @deepseek-ai/dsh-scope-proxy
 */

import { lookup as systemLookup } from 'node:dns/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import { isIP } from 'node:net'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  formatPentestNetworkTarget, normalizePentestTarget, pentestPathCovers, pentestTargetMatches,
  type PentestNetworkTarget,
} from '@deepseek-ai/dsh-pentest-run'
import { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-shell'
import type { BashEnvContributor, ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/cordis' {
  interface Context {
    scopeProxy: ScopeProxy
  }
}

export const name = 'scope-proxy'
export const inject: string[] = []

/** The managed environment variable carrying the proxy URL. */
export const SCOPE_PROXY_ENV = `${DSH_ENV_PREFIX}SCOPE_PROXY` as const

/**
 * Plugin config, validated at load exactly like `scope-policy`: every scope
 * entry must parse, `allowedSchemes` must be non-empty lowercase tokens.
 * `host`/`port` place the listener; the default is loopback with an
 * OS-assigned port.
 */
export interface Config {
  /** Hosts the run may touch; empty means every host is authorized. */
  authorizedTargets?: string[]
  /** Hosts refused even when authorized; exclusions always win. */
  excludedTargets?: string[]
  /** URL schemes an absolute-form request may use (default `['http', 'https', 'ws', 'wss']`). */
  allowedSchemes?: string[]
  /** Resolve each hostname once and refuse answers that hit an excluded IP literal (default `true`). */
  resolveAddresses?: boolean
  /** Listener bind address (default `127.0.0.1`). */
  host?: string
  /** Listener port; `0` picks a free one (default). */
  port?: number
}

export const Config: z<Config> = z.object({
  authorizedTargets: z.array(z.string()).default([]),
  excludedTargets: z.array(z.string()).default([]),
  allowedSchemes: z.array(z.string()).default(['http', 'https', 'ws', 'wss']),
  resolveAddresses: z.boolean().default(true),
  host: z.string().default('127.0.0.1'),
  port: z.number().default(0),
})

/** One answer from the address resolver for one candidate hostname. */
export interface ResolvedAddress {
  readonly address: string
  readonly family: number
}

/** The resolver the proxy queries once per candidate hostname. */
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>

/** Whether one host token is an IP literal (`isIP` reads the bracketed form as invalid). */
function isIpLiteral(host: string): boolean {
  return isIP(host.replace(/^\[|\]$/g, '')) !== 0
}

/** System DNS narrowed to the plugin's all-answers shape. */
const resolveWithSystemDns: AddressResolver = hostname => systemLookup(hostname, { all: true, order: 'verbatim' })

interface Scope {
  readonly authorized: readonly PentestNetworkTarget[]
  readonly excluded: readonly PentestNetworkTarget[]
  readonly schemes: ReadonlySet<string>
  readonly excludedAddresses: ReadonlySet<string>
  readonly resolves: boolean
}

/**
 * The local forward proxy. Mounted through `ctx.plugin(ScopeProxy, config)`;
 * `ctx.scopeProxy.url` is the `http://host:port` URL to point
 * `HTTP_PROXY`/`HTTPS_PROXY` at. Disposing the owning fiber stops the listener
 * and destroys every open tunnel.
 */
export class ScopeProxy extends Service {
  private readonly scope: Scope
  private readonly resolve: AddressResolver
  private readonly server: http.Server
  private readonly sockets = new Set<Duplex>()
  private readonly listenHost: string
  private readonly listenPort: number
  private readonly ready: Promise<void>

  constructor(ctx: Context, raw: Config, resolve: AddressResolver = resolveWithSystemDns) {
    super(ctx, 'scopeProxy')
    // Class plugins receive the raw config object; the schema fills defaults.
    const config = Config(raw) as Config
    const parseScope = (target: string): PentestNetworkTarget => {
      const parsed = normalizePentestTarget(target)
      if (parsed === undefined) {
        throw new Error(`scope-proxy: scope target '${target}' is not a parsable URL, host:port, or host form`)
      }
      return parsed
    }
    const authorized = (config.authorizedTargets as string[]).map(parseScope)
    const excluded = (config.excludedTargets as string[]).map(parseScope)
    const schemes = new Set((config.allowedSchemes as string[]).map(value => value.toLowerCase()))
    if (schemes.size === 0) throw new Error('scope-proxy: `allowedSchemes` must not be empty')
    for (const scheme of schemes) {
      if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
        throw new Error(`scope-proxy: invalid scheme token '${scheme}'`)
      }
    }
    const resolves = config.resolveAddresses as boolean && (excluded.length > 0 || authorized.length > 0)
    this.scope = {
      authorized,
      excluded,
      schemes,
      resolves,
      excludedAddresses: new Set(
        excluded.filter(entry => isIpLiteral(entry.host)).map(entry => entry.host.toLowerCase()),
      ),
    }
    this.resolve = resolve
    this.listenHost = config.host as string
    this.listenPort = config.port as number
    this.server = http.createServer()
    this.server.on('request', (request, response) => { void this.forwardAbsolute(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
      // Surface the proxy-side failure on the client socket instead of leaving it open.
      response.once('close', () => { request.socket.destroy() })
      void error
    }) })
    this.server.on('connect', (request, clientSocket, head) => { this.tunnel(request, clientSocket, head) })
    this.server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.once('close', () => { this.sockets.delete(socket) })
    })
    this.ready = this.listen()
    // Defer past plugin execution: the shell-env registry's effect-scoped
    // disposal must not re-enter the context during another plugin's load.
    queueMicrotask(() => { this.registerEnvironmentFact() })
  }

  /** Resolves once the listener is bound; rejects if the port could not be taken. */
  whenReady(): Promise<void> {
    return this.ready
  }

  /** The `http://host:port` URL clients use as their proxy. Valid after boot; `listen()` fails loud otherwise. */
  get url(): string {
    const address = this.server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('scope-proxy: listener is not bound to a TCP address yet')
    }
    return `http://${this.listenHost}:${address.port}`
  }

  /** Stop the listener and destroy every open connection. Idempotent. */
  stop(): void {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.server.close()
  }

  private async listen(): Promise<void> {
    await new Promise<void>((resolveListen, rejectListen) => {
      this.server.once('error', rejectListen)
      this.server.listen(this.listenPort, this.listenHost, () => resolveListen())
    })
  }

  /** Register `DSH_SCOPE_PROXY` so every managed shell call can find the proxy. */
  private registerEnvironmentFact(): void {
    const registry = this.ctx.get('shellEnv')
    if (registry === undefined || typeof (registry as ShellEnvRegistry).register !== 'function') {
      throw new Error('scope-proxy: the shell-env service (`ctx.shellEnv`) must be mounted to expose DSH_SCOPE_PROXY')
    }
    const contributor: BashEnvContributor = {
      name: 'scope-proxy',
      variables: {
        [SCOPE_PROXY_ENV]: {
          description: 'Local scope-pinning forward proxy URL; set HTTP_PROXY and HTTPS_PROXY to it (with NO_PROXY for loopback) to route run traffic through scope enforcement and address pinning.',
        },
      },
      resolve: (_execution: ToolExecution) => ({ [SCOPE_PROXY_ENV]: this.url }),
    }
    registry.register(contributor)
  }

  /** Absolute-form request: judge, resolve, pin, forward. */
  private async forwardAbsolute(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const deny = (message: string): void => {
      response.writeHead(403, { 'content-type': 'text/plain' })
      response.end(message)
    }
    const rawUrl = request.url ?? ''
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      return deny("denied by scope proxy: only absolute-form proxy requests (scheme://host/path) are served; origin-form is not a proxy request'")
    }
    const scheme = url.protocol.replace(/:$/, '').toLowerCase()
    if (!this.scope.schemes.has(scheme)) {
      return deny(`denied by scope proxy: '${scheme}://' uses a scheme outside the allowed protocol list`)
    }
    const candidate = normalizePentestTarget(rawUrl)
    if (candidate === undefined) return deny(`denied by scope proxy: '${rawUrl}' is not a parsable target`)
    const refusal = this.judge(candidate)
    if (refusal !== undefined) return deny(refusal)

    let addresses: readonly ResolvedAddress[] = [{ address: candidate.host, family: isIpLiteral(candidate.host) ? (candidate.host.includes(':') ? 6 : 4) : 0 }]
    if (!isIpLiteral(candidate.host)) {
      if (!this.scope.resolves) return deny(`denied by scope proxy: '${candidate.host}' must resolve but resolution is disabled by configuration`)
      try {
        addresses = await this.resolve(candidate.host)
      } catch {
        return deny(`denied by scope proxy: '${formatPentestNetworkTarget(candidate)}' could not be resolved and scope enforcement is active`)
      }
      const refusedAddress = this.judgeResolved(addresses)
      if (refusedAddress !== undefined) return deny(refusedAddress)
    }
    // Pin: the outbound socket opens to the validated address, so a later DNS
    // answer cannot re-point this connection. An empty answer set is refused
    // fail-closed rather than dialled.
    const pinned = addresses[0]
    if (pinned === undefined) return deny(`denied by scope proxy: '${formatPentestNetworkTarget(candidate)}' resolved to no address`)
    const upstream = http.request({
      host: pinned.address,
      port: url.port === '' ? (scheme === 'https' ? 443 : 80) : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: request.method,
      headers: { ...request.headers, host: url.host },
    })
    upstream.on('response', (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    })
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end('upstream connection failed')
    })
    request.pipe(upstream)
  }

  /** CONNECT tunnel: judge, resolve, pin, then blind-pipe. TLS stays end-to-end. */
  private tunnel(request: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
    const deny = (message: string): void => {
      clientSocket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n${message}`)
    }
    const authority = request.url ?? ''
    const candidate = normalizePentestTarget(authority)
    if (candidate === undefined || candidate.port === '') {
      return deny(`denied by scope proxy: CONNECT requires a parsable host:port authority, got '${authority}'`)
    }
    const refusal = this.judge(candidate)
    if (refusal !== undefined) return deny(refusal)

    void (async () => {
      let addresses: readonly ResolvedAddress[]
      if (isIpLiteral(candidate.host)) {
        addresses = [{ address: candidate.host, family: candidate.host.includes(':') ? 6 : 4 }]
      } else {
        if (!this.scope.resolves) return deny(`denied by scope proxy: '${candidate.host}' must resolve but resolution is disabled by configuration`)
        try {
          addresses = await this.resolve(candidate.host)
        } catch {
          return deny(`denied by scope proxy: '${formatPentestNetworkTarget(candidate)}' could not be resolved and scope enforcement is active`)
        }
        const refusedAddress = this.judgeResolved(addresses)
        if (refusedAddress !== undefined) return deny(refusedAddress)
      }
      const pinnedTunnel = addresses[0]
      if (pinnedTunnel === undefined) return deny(`denied by scope proxy: '${formatPentestNetworkTarget(candidate)}' resolved to no address`)
      const upstream = net.connect({ host: pinnedTunnel.address, port: Number(candidate.port) })
      upstream.once('connect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      })
      const fail = (): void => {
        clientSocket.destroy()
        upstream.destroy()
      }
      upstream.once('error', fail)
      clientSocket.once('error', fail)
    })()
  }

  /** Text-level judgment: exclusions (path-covered) win, then authorization. */
  private judge(candidate: PentestNetworkTarget): string | undefined {
    const display = formatPentestNetworkTarget(candidate)
    if (this.scope.excluded.some(scope =>
      pentestTargetMatches(candidate, scope) && pentestPathCovers(candidate, scope))) {
      return `denied by scope proxy: '${display}' is an excluded target`
    }
    if (this.scope.authorized.length > 0
      && !this.scope.authorized.some(scope => pentestTargetMatches(candidate, scope))) {
      return `denied by scope proxy: '${display}' is outside the authorized targets`
    }
    return undefined
  }

  /** Resolved-address judgment: any answer on an excluded IP literal refuses the connection. */
  private judgeResolved(addresses: readonly ResolvedAddress[]): string | undefined {
    for (const entry of addresses) {
      if (this.scope.excludedAddresses.has(entry.address.toLowerCase())) {
        return `denied by scope proxy: resolved address ${entry.address} is an excluded target`
      }
    }
    return undefined
  }
}

/**
 * Load the scope-proxy plugin: bind the loopback listener, register the
 * `DSH_SCOPE_PROXY` fact with the mounted shell-env registry, and dispose the
 * listener with the owning fiber.
 * @param ctx - plugin context; the listener and contribution are disposed with it.
 * @param config - validated {@link Config}; scope entries are re-checked in the service.
 * @param resolve - resolver override for focused tests; defaults to system DNS.
 */
export function apply(ctx: Context, config: Config, resolve: AddressResolver = resolveWithSystemDns): void {  const proxy = new ScopeProxy(ctx, Config(config) as Config, resolve)
  // Registered from `apply` (not the constructor): an effect created inside a
  // Service constructor re-enters the context mid-load and deadlocks the fiber.
  // The effect's execute returns the disposer callback (see entries.ts usage).
  ctx.effect(() => () => { proxy.stop() })
}
