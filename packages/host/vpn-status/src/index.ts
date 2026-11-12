/** Host-owned VPN verification cache, shared by every Web/TUI consumer in this process. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { exitMatcher, fetchEgress, verifyResponse } from './probe.ts'
import type { VpnStatusSnapshot } from './types.ts'

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
}
/** Validated polling policy; never permit frequent external checks. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  intervalMs: z.number().min(60000).max(3600000).default(300000),
  timeoutMs: z.number().min(1000).max(30000).default(10000),
  expectedExitCidrs: z.array(z.string()).default([]),
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

  constructor(ctx: Context, config: Config) {
    super(ctx, 'vpnStatus')
    const matches = exitMatcher(config.expectedExitCidrs)
    if (!config.enabled) return
    ctx.effect(() => {
      const lifetime = new AbortController()
      let timer: NodeJS.Timeout | undefined
      const active = (): boolean => !lifetime.signal.aborted
      const poll = async (): Promise<void> => {
        if (!active()) return
        this.snapshot = { ...this.snapshot, state: 'checking', evidence: null, validUntil: null }
        const deadline = AbortSignal.timeout(config.timeoutMs)
        const signal = AbortSignal.any([lifetime.signal, deadline])
        let result: Pick<VpnStatusSnapshot, 'state' | 'evidence'> = { state: 'unknown', evidence: null }
        try { result = verifyResponse(await fetchEgress(signal), matches) } catch (error) {
          // Network failures are unknown; never retain an earlier verified result.
          void error
        }
        if (!active()) return
        const checkedAt = Date.now()
        this.snapshot = { ...result, checkedAt, validUntil: checkedAt + config.intervalMs }
        timer = setTimeout(() => { pending = poll() }, config.intervalMs)
        timer.unref()
      }
      let pending = poll()
      return async () => { lifetime.abort(); clearTimeout(timer); await pending }
    })
  }

  /** Read cached verification only; never triggers network I/O.
   * @param signal - optional Remote carrier cancellation; this synchronous cache read performs no I/O.
   * @returns current sample, or unknown after its expiry.
   */
  @Remote('read')
  read(signal?: AbortSignal): VpnStatusSnapshot {
    void signal
    if (this.snapshot.validUntil !== null && Date.now() >= this.snapshot.validUntil) {
      return { ...this.snapshot, state: 'unknown', evidence: null }
    }
    return this.snapshot
  }
}

export default VpnStatusService
