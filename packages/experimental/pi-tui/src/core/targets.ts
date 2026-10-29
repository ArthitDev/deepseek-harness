/** Session-local URL observations for the read-only Targets tree. */
import { stripVTControlCharacters } from 'node:util'

/** One normalized URL and whether a human supplied it as a target. */
export interface TargetUrl {
  readonly url: string
  readonly primary: boolean
}

/** Incremental URL index; its cached snapshot stays unchanged during text streaming. */
export class TargetIndex {
  private readonly observations = new Map<number, { urls: readonly string[]; primary: boolean }>()
  private snapshot: readonly TargetUrl[] = []
  private dirty = false

  /**
   * Observe HTTP(S) URLs in a committed message or tool payload.
   * @param seq - Event sequence used to remove shadowed observations.
   * @param text - Message text or raw tool arguments/output.
   * @param primary - Whether this is a direct human message.
   */
  observe(seq: number, text: string, primary = false): void {
    const urls = new Set<string>()
    for (const match of stripVTControlCharacters(text).matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
      let candidate = match[0].replace(/[),.;!}]+$/, '')
      if (!candidate.includes('[')) candidate = candidate.replace(/\]+$/, '')
      let url: URL
      try {
        url = new URL(candidate)
      } catch (error) {
        // Tool output and prose can contain incomplete or malformed URLs.
        if (error instanceof TypeError) continue
        throw error
      }
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      urls.add(url.href)
    }
    if (urls.size === 0) return
    this.observations.set(seq, { urls: [...urls], primary })
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

  /** Remove every observed URL when the visible conversation is cleared. */
  clear(): void {
    this.observations.clear()
    this.snapshot = []
    this.dirty = false
  }

  /**
   * Read deduplicated URLs, promoting a discovered URL when a human later supplies it.
   * @returns Stable snapshot until the displayed URL set or classifications change.
   */
  getSnapshot(): readonly TargetUrl[] {
    if (!this.dirty) return this.snapshot
    const urls = new Map<string, boolean>()
    for (const observation of this.observations.values()) {
      for (const url of observation.urls) urls.set(url, observation.primary || urls.get(url) === true)
    }
    const next = [...urls].map(([url, primary]) => ({ url, primary }))
    if (next.length !== this.snapshot.length || next.some((value, index) =>
      value.url !== this.snapshot[index]?.url || value.primary !== this.snapshot[index].primary)) this.snapshot = next
    this.dirty = false
    return this.snapshot
  }
}
