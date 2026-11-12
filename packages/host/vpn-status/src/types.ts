/** A sampled Host HTTPS route, never a claim about other processes or destinations. */
export interface VpnStatusSnapshot {
  readonly state: 'checking' | 'verified' | 'unverified' | 'unknown'
  readonly evidence: 'mullvad' | 'expected-exit' | null
  readonly checkedAt: number | null
  readonly validUntil: number | null
}
