/** Bounded, credential-free HTTPS egress verification on Windows and Linux. */
import { request } from 'node:https'
import { randomUUID } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import type { VpnStatusSnapshot } from './types.ts'

/** Compile operator-supplied IPv4/IPv6 addresses and CIDRs; invalid entries fail plugin loading.
 * @param entries - trusted VPN exit addresses; an empty list permits only official Mullvad attestation.
 * @returns a matcher retaining no public response data.
 */
export function exitMatcher(entries: readonly string[]): (ip: string) => boolean {
  const list = new BlockList()
  for (const entry of entries) {
    const [ip, prefix, extra] = entry.split('/')
    const family = ip === undefined ? 0 : isIP(ip)
    if (ip === undefined || !family || extra !== undefined || (prefix !== undefined && !/^\d+$/.test(prefix))) {
      throw new Error('Invalid VPN exit IP/CIDR')
    }
    const type = family === 4 ? 'ipv4' : 'ipv6'
    if (prefix === undefined) list.addAddress(ip, type)
    else {
      const bits = Number(prefix)
      if (bits < 1 || bits > (family === 4 ? 32 : 128)) throw new Error('VPN exit CIDR must be narrower than /0')
      list.addSubnet(ip, bits, type)
    }
  }
  return ip => list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
}

/** Validate the external JSON before trusting a provider assertion or matching an exit address.
 * @param value - JSON from the fixed official HTTPS endpoint.
 * @param matches - configured exit matcher.
 * @returns only the verification fields; IP addresses never leave this function.
 */
export function verifyResponse(value: unknown, matches: (ip: string) => boolean): Pick<VpnStatusSnapshot, 'state' | 'evidence'> {
  if (typeof value !== 'object' || value === null || !('ip' in value) || typeof value.ip !== 'string' || !isIP(value.ip)
    || !('mullvad_exit_ip' in value) || typeof value.mullvad_exit_ip !== 'boolean') {
    return { state: 'unknown', evidence: null }
  }
  if (value.mullvad_exit_ip) return { state: 'verified', evidence: 'mullvad' }
  if (matches(value.ip)) return { state: 'verified', evidence: 'expected-exit' }
  return { state: 'unverified', evidence: null }
}

/** Read a fresh response from Mullvad's official HTTPS endpoint; reject redirects and oversized bodies.
 * @param signal - the owner combines lifetime cancellation and a whole-request deadline.
 * @returns untrusted parsed JSON; callers validate its fields before using it.
 */
export function fetchEgress(signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request('https://am.i.mullvad.net/json?dsh=' + randomUUID(), {
      signal, agent: false, headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    }, (res) => {
      if (res.statusCode !== 200 || !res.headers['content-type']?.includes('application/json')) {
        res.resume()
        reject(new Error('VPN verification endpoint unavailable'))
        return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      res.on('error', reject)
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 16384) { res.destroy(new Error('VPN verification response too large')); return }
        chunks.push(chunk)
      })
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}
