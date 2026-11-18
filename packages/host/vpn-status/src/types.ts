/** A sampled Host HTTPS route, never a claim about other processes or destinations. */
export interface VpnStatusSnapshot {
  readonly state: 'checking' | 'verified' | 'unverified' | 'unknown'
  readonly evidence: 'mullvad' | 'expected-exit' | null
  readonly checkedAt: number | null
  readonly validUntil: number | null
}

/** Operator-only reconnect outcome; only snapshot.state can attest egress. */
export interface VpnReconnectResult {
  readonly kind: 'reconnected' | 'busy' | 'unavailable' | 'failed'
  readonly snapshot: VpnStatusSnapshot
}
/** Operator-only rotate outcome; only snapshot.state can attest egress. */
export interface VpnRotateResult {
  readonly kind: 'reconnected' | 'busy' | 'unavailable' | 'failed'
  readonly snapshot: VpnStatusSnapshot
  /** Exit relay hostname the broker reported after the rotation, when provided. */
  readonly relay?: string
}
