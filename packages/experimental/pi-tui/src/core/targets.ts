/** Session-local target observations for the read-only Targets tree. */
import { isIP } from 'node:net'
import { posix, win32 } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

/** One display identifier and whether a human supplied it as a target; never execution scope. */
export interface TargetEntry {
  readonly kind: 'web' | 'host' | 'network' | 'file' | 'app' | 'other'
  readonly value: string
  readonly primary: boolean
}

function classify(value: string, hint?: string): Omit<TargetEntry, 'primary'> | undefined {
  if (value.trim().length === 0) return undefined
  if (/^https?:\/\//i.test(value)) {
    let url: URL
    try { url = new URL(value) } catch (error) {
      // Committed prose can contain malformed or incomplete identifiers.
      if (error instanceof TypeError) return undefined
      throw error
    }
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return { kind: 'web', value: url.href }
  }
  const cidr = /^(.+)\/(\d{1,3})$/.exec(value)
  const networkHost = cidr?.[1]
  if (networkHost !== undefined) {
    const version = isIP(networkHost)
    const prefix = Number(cidr?.[2])
    if (version !== 0 && prefix <= (version === 4 ? 32 : 128)) {
      return { kind: 'network', value: `${networkHost.toLowerCase()}/${prefix}` }
    }
    if (hint === 'network' || version !== 0) return undefined
  }
  const endpoint = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(value)
  const host = endpoint === null ? value.replace(/^\[([^\]]+)\]$/, '$1') : endpoint[1] ?? endpoint[2]
  if (host === undefined) return undefined
  const port = endpoint?.[3]
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return undefined
  const filename = /\.(?:exe|dll|so|dylib|bin|elf|apk|ipa|app|msi|zip|tar|gz|pdf|wasm)$/i.test(value)
  if (isIP(host) !== 0 || ((hint === 'host' || (hint === 'target' && !filename && (host.includes('.') || host === 'localhost')))
    && /^(?:localhost|[a-z\d](?:[a-z\d.-]*[a-z\d])?)$/i.test(host))) {
    return { kind: 'host', value: value.toLowerCase() }
  }
  if (hint === 'host' || hint === 'network') return undefined
  if (/^(?:[a-z]:[\\/]|\\\\|\.{1,2}\\)/i.test(value)) return { kind: 'file', value: win32.normalize(value) }
  if (/^(?:\/|\.\.?\/|~\/)/.test(value) && !value.startsWith('//')) {
    return { kind: 'file', value: posix.normalize(value) }
  }
  if (hint === 'file' || filename) {
    return { kind: 'file', value }
  }
  if (hint === 'app' || hint === 'program') return { kind: 'app', value }
  if (hint === 'target') return { kind: 'other', value }
  return undefined
}

function observationsIn(text: string, primary: boolean): Omit<TargetEntry, 'primary'>[] {
  const found = new Map<string, Omit<TargetEntry, 'primary'>>()
  const clean = stripVTControlCharacters(text)
  for (const match of clean.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
    let value = match[0].replace(/[),.;!}]+$/, '')
    if (!value.includes('[')) value = value.replace(/\]+$/, '')
    const target = classify(value)
    if (target !== undefined) found.set(`${target.kind}:${target.value}`, target)
  }
  // A quoted value keeps spaces in program names and Windows paths intact.
  const tokens = /(?:\b(host|network|file|app|program|target):\s*)?(?:"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`|([^\s<>"'`]+))/gi
  for (const match of clean.matchAll(tokens)) {
    const token = match[2] ?? match[3] ?? match[4] ?? match[5]
    if (token === undefined) continue
    let value = token.replace(/^[({]+/, '').replace(/[),.;!}]+$/, '')
    if (!value.includes('[')) value = value.replace(/\]+$/, '')
    const hint = match[1]?.toLowerCase()
    if (/https?:\/\//i.test(value) || (!primary && hint === undefined)) continue
    const target = classify(value, hint)
    if (target !== undefined) found.set(`${target.kind}:${target.value}`, target)
  }
  return [...found.values()]
}

/** Incremental target index; its cached snapshot stays unchanged during text streaming. */
export class TargetIndex {
  private readonly observations = new Map<number, readonly TargetEntry[]>()
  private snapshot: readonly TargetEntry[] = []
  private dirty = false

  /**
   * Observe URLs and explicit typed identifiers in committed messages or tool payloads.
   * Direct human messages also recognize bare IPs, networks and file paths.
   * @param seq - Event sequence used to remove shadowed observations.
   * @param text - Message text or raw tool arguments/output.
   * @param primary - Whether this is a direct human message.
   */
  observe(seq: number, text: string, primary = false): void {
    const entries = observationsIn(text, primary).map(entry => ({ ...entry, primary }))
    if (entries.length === 0) return
    this.observations.set(seq, entries)
    this.dirty = true
  }

  /**
   * Remove observations covered by a clear or rewind marker.
   * @param start - First shadowed event sequence, inclusive.
   * @param end - Last shadowed event sequence, inclusive.
   */
  removeRange(start: number, end: number): void {
    for (const seq of this.observations.keys()) {
      if (seq >= start && seq <= end) {
        this.observations.delete(seq)
        this.dirty = true
      }
    }
  }

  /** Remove every observed target when the visible conversation is cleared. */
  clear(): void {
    this.observations.clear()
    this.snapshot = []
    this.dirty = false
  }

  /**
   * Read deduplicated targets, promoting discoveries later supplied by a human.
   * @returns Stable snapshot until the displayed identifiers or classifications change.
   */
  getSnapshot(): readonly TargetEntry[] {
    if (!this.dirty) return this.snapshot
    const entries = new Map<string, TargetEntry>()
    for (const observation of this.observations.values()) {
      for (const entry of observation) {
        const key = `${entry.kind}:${entry.value}`
        entries.set(key, { ...entry, primary: entry.primary || entries.get(key)?.primary === true })
      }
    }
    const next = [...entries.values()]
    if (next.length !== this.snapshot.length || next.some((value, index) =>
      value.kind !== this.snapshot[index]?.kind || value.value !== this.snapshot[index].value
      || value.primary !== this.snapshot[index].primary)) this.snapshot = next
    this.dirty = false
    return this.snapshot
  }
}
