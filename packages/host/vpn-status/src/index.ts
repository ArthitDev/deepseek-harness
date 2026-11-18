/** Host-owned VPN verification cache, shared by every Web/TUI consumer in this process. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { exitMatcher, fetchEgress, verifyResponse } from './probe.ts'
import type { VpnStatusSnapshot } from './types.ts'
import type { VpnReconnectResult, VpnRotateResult } from './types.ts'
import { controlVpn, type VpnControlResult } from './control.ts'

/** Deployment-specific probe policy; disabled by default to avoid unsolicited third-party requests. */
export interface Config {
  /** Opt in to public HTTPS egress observation. */
  enabled: boolean
  /** Delay between settled checks, in milliseconds; at least one minute. */
  intervalMs: number
  /** Whole HTTPS request deadline, in milliseconds. */
  timeoutMs: number
  /** Known VPN exit addresses or CIDRs for providers without official attestation. */
  expectedExitCidrs: string[]
  /** Restricted Linux control broker socket; empty uses the installed Mullvad CLI. */
  controlSocketPath?: string
  /** Maximum duration of one local control operation, in milliseconds. */
  controlTimeoutMs?: number
}
/** Validated polling policy; never permit frequent external checks. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  intervalMs: z.number().min(60000).max(3600000).default(300000),
  timeoutMs: z.number().min(1000).max(30000).default(10000),
  expectedExitCidrs: z.array(z.string()).default([]),
  controlSocketPath: z.string().default(''),
  controlTimeoutMs: z.number().min(1000).max(120000).default(45000),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Current Host HTTPS egress verification, without IP addresses. */
    vpnStatus: VpnStatusService
  }
}

/** Owns one non-overlapping external check and a bounded-lifetime cached result. */
export class VpnStatusService extends TypertRemoteService<Config> {
  static Config = Config
  private snapshot: VpnStatusSnapshot = { state: 'unknown', evidence: null, checkedAt: null, validUntil: null }
  private reconnectTask: Promise<VpnReconnectResult> | undefined
  private performReconnect: (() => Promise<VpnReconnectResult>) | undefined
  private performRotate: ((country: string) => Promise<VpnRotateResult>) | undefined
  private resumePolling: (() => void) | undefined
  private readonly lifetime = new AbortController()
  private readonly policy: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'vpnStatus')
    this.policy = config
    const matches = exitMatcher(config.expectedExitCidrs)
    if (!config.enabled) return
    ctx.effect(() => {
      const lifetime = this.lifetime
      let timer: NodeJS.Timeout | undefined
      const active = (): boolean => !lifetime.signal.aborted
      const poll = async (): Promise<void> => {
        if (!active()) return
        this.snapshot = { state: 'checking', evidence: null, checkedAt: this.snapshot.checkedAt, validUntil: null }
        const deadline = AbortSignal.timeout(config.timeoutMs)
        const signal = AbortSignal.any([lifetime.signal, deadline])
        let result: Pick<VpnStatusSnapshot, 'state' | 'evidence' | 'country'> = { state: 'unknown', evidence: null }
        try { result = verifyResponse(await fetchEgress(signal), matches) } catch (error) {
          // Network failures are unknown; never retain an earlier verified result.
          void error
        }
        if (!active()) return
        const checkedAt = Date.now()
        this.snapshot = { ...result, checkedAt, validUntil: checkedAt + config.intervalMs }
        if (this.reconnectTask === undefined) schedule()
      }
      const schedule = (): void => {
        clearTimeout(timer)
        if (!active()) return
        timer = setTimeout(() => { pending = poll() }, config.intervalMs)
        timer.unref()
      }
      this.resumePolling = schedule
      let pending = poll()
      this.performReconnect = async () => {
        clearTimeout(timer)
        await pending
        if (!active()) return { kind: 'failed', snapshot: this.read() }
        this.snapshot = { state: 'checking', evidence: null, checkedAt: null, validUntil: null }
        const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.controlTimeoutMs ?? 45000)])
        const control = await controlVpn('reconnect', config.controlSocketPath ?? '', signal)
        if (!active()) return { kind: 'failed', snapshot: this.read() }
        if (control.kind !== 'ok') {
          this.snapshot = { state: 'unknown', evidence: null, checkedAt: null, validUntil: null }
          return { kind: control.kind, snapshot: this.read() }
        }
        pending = poll()
        await pending
        return { kind: 'reconnected', snapshot: this.read() }
      }
      this.performRotate = async (country: string) => {
        clearTimeout(timer)
        await pending
        if (!active()) return { kind: 'failed', snapshot: this.read() } as VpnRotateResult
        this.snapshot = { state: 'checking', evidence: null, checkedAt: null, validUntil: null }
        const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.controlTimeoutMs ?? 45000)])
        const control = await controlVpn('rotate', config.controlSocketPath ?? '', signal, country)
        if (!active()) return { kind: 'failed', snapshot: this.read() }
        if (control.kind !== 'ok') {
          this.snapshot = { state: 'unknown', evidence: null, checkedAt: null, validUntil: null }
          return { kind: control.kind, snapshot: this.read() }
        }
        pending = poll()
        await pending
        return control.relay === undefined
          ? { kind: 'reconnected', snapshot: this.read() }
          : { kind: 'reconnected', snapshot: this.read(), relay: control.relay }
      }
      return async () => {
        lifetime.abort(); clearTimeout(timer)
        await pending
        await this.reconnectTask
        this.performReconnect = undefined
        this.performRotate = undefined
        this.resumePolling = undefined
      }
    })
  }

  /** Read the local tunnel without sending public traffic; never exposed as a Remote mutation.
   * @returns sanitized CLI/broker state, independent of the cached HTTPS evidence.
   */
  async tunnel(): Promise<VpnControlResult> {
    return controlVpn('status', this.policy.controlSocketPath ?? '', AbortSignal.any([
      this.lifetime.signal, AbortSignal.timeout(this.policy.timeoutMs),
    ]))
  }

  /** Reconnect Mullvad once, then replace the HTTPS sample; concurrent calls are rejected.
   * @returns control outcome and fresh egress result; a completed reconnect can still be unknown/unverified.
   */
  async reconnect(): Promise<VpnReconnectResult> {
    if (this.reconnectTask !== undefined) return { kind: 'busy', snapshot: this.read() }
    if (this.performReconnect === undefined) return { kind: 'unavailable', snapshot: this.read() }
    const task = this.performReconnect()
    this.reconnectTask = task
    try { return await task }
    finally {
      this.reconnectTask = undefined
      // The poll inside reconnect does not schedule while reconnectTask is owned.
      this.resumePolling?.()
    }
  }

  /** Rotate the Mullvad exit to one whitelisted Asia location through the control broker, then replace the
   * HTTPS sample. Shares the reconnect guard: only one control operation runs at a time.
   * @param country - whitelisted Asia country code; the broker enforces the location whitelist.
   * @returns control outcome, fresh egress result, and the exit relay the broker reported.
   */
  async rotate(country: string): Promise<VpnRotateResult> {
    if (this.reconnectTask !== undefined) return { kind: 'busy', snapshot: this.read() }
    if (this.performRotate === undefined) return { kind: 'unavailable', snapshot: this.read() }
    const task = this.performRotate(country)
    this.reconnectTask = task
    try { return await task }
    finally {
      this.reconnectTask = undefined
      // The poll inside rotate does not schedule while reconnectTask is owned.
      this.resumePolling?.()
    }
  }

  /** Read cached verification only; never triggers network I/O.
   * @param signal - optional Remote carrier cancellation; this synchronous cache read performs no I/O.
   * @returns current sample, or unknown after its expiry.
   */
  @Remote('read')
  read(signal?: AbortSignal): VpnStatusSnapshot {
    void signal
    if (this.snapshot.validUntil !== null && Date.now() >= this.snapshot.validUntil) {
      return { state: 'unknown', evidence: null, checkedAt: this.snapshot.checkedAt, validUntil: this.snapshot.validUntil }
    }
    return this.snapshot
  }
}

export default VpnStatusService
