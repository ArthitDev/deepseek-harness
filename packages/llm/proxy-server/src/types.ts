/** Embedded proxies supported by this checkout. */
export type ProxyId = 'zcode' | 'antigravity' | 'sb'

/** Secret-free state returned to the operator. Enabled controls new Harness requests. */
export interface ProxyServerRow {
  id: ProxyId
  name: string
  endpoint: string
  enabled: boolean
  available: boolean
  status: 'stopped' | 'running' | 'external' | 'port-in-use'
  providers: readonly string[]
}
