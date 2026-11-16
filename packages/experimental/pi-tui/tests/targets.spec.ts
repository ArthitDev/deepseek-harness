import { describe, expect, it, vi } from 'vitest'
import { TargetIndex, type TargetEntry } from '../src/core/targets.ts'
import { targetTreeLines } from '../src/ui/targets-pane.ts'

describe('TargetIndex', () => {
  it('recognizes non-web identifiers from human messages on either platform', () => {
    const index = new TargetIndex()
    index.observe(1, '10.10.0.5:22 2001:db8::1 10.10.0.0/24 2001:db8::/64 host:LAB.internal:8443 '
      + '"C:\\Program Files\\Demo\\app.exe" /opt/demo/123 ./samples/demo.apk app:"Desktop Demo" target:"USB device"', true)
    expect(index.getSnapshot()).toEqual([
      { kind: 'host', value: '10.10.0.5:22', primary: true },
      { kind: 'host', value: '2001:db8::1', primary: true },
      { kind: 'network', value: '10.10.0.0/24', primary: true },
      { kind: 'network', value: '2001:db8::/64', primary: true },
      { kind: 'host', value: 'lab.internal:8443', primary: true },
      { kind: 'file', value: 'C:\\Program Files\\Demo\\app.exe', primary: true },
      { kind: 'file', value: '/opt/demo/123', primary: true },
      { kind: 'file', value: 'samples/demo.apk', primary: true },
      { kind: 'app', value: 'Desktop Demo', primary: true },
      { kind: 'other', value: 'USB device', primary: true },
    ])
  })

  it('requires explicit non-web discoveries instead of collecting every output path or version', () => {
    const index = new TargetIndex()
    index.observe(1, '3.13.0 /tmp/report.log 10.10.0.5 demo.exe normal prose')
    expect(index.getSnapshot()).toEqual([])
    index.observe(2, 'host:10.10.0.5 file:/tmp/demo.exe program:"Demo App" target:"USB device"')
    expect(index.getSnapshot()).toHaveLength(4)
    expect(index.getSnapshot().every(entry => !entry.primary)).toBe(true)
    index.observe(3, 'host:10.10.0.5 app:"Demo App"', true)
    expect(index.getSnapshot().filter(entry => entry.primary)).toHaveLength(2)
    index.removeRange(3, 3)
    expect(index.getSnapshot().every(entry => !entry.primary)).toBe(true)
    index.clear()
    expect(index.getSnapshot()).toEqual([])
  })

  it('recognizes relative Windows paths and keeps explicit binary targets out of Hosts', () => {
    const index = new TargetIndex()
    index.observe(1, 'target:sample.exe .\\folder\\binary [::1] app:"   "', true)
    expect(index.getSnapshot()).toEqual([
      { kind: 'file', value: 'sample.exe', primary: true },
      { kind: 'file', value: 'folder\\binary', primary: true },
      { kind: 'host', value: '[::1]', primary: true },
    ])
  })

  it.each(['network:10.0.0.0/33', 'network:2001:db8::/129', 'host:10.0.0.1:65536',
    'host:10.0.0.1:0', 'network:invalid/24', 'host:bad/host', 'https://'])('ignores malformed identifier %s', (text) => {
    const index = new TargetIndex()
    index.observe(1, text, true)
    expect(index.getSnapshot()).toEqual([])
  })

  it('normalizes and deduplicates URLs while removing credentials, query, fragments and terminal controls', () => {
    const index = new TargetIndex()
    index.observe(1, '\x1b]52;c;hidden\x07(https://user:password@EXAMPLE.test:443/api?q=secret#token). [https://example.test/api] https:// https://[::1]:8080/a', true)
    expect(index.getSnapshot()).toEqual([
      { kind: 'web', value: 'https://example.test/api', primary: true },
      { kind: 'web', value: 'https://[::1]:8080/a', primary: true },
    ])
    const snapshot = index.getSnapshot()
    index.observe(2, 'https://example.test/api?other=value')
    expect(index.getSnapshot()).toBe(snapshot)
    index.observe(3, 'no URL; ftp://files.test/')
    expect(index.getSnapshot()).toBe(snapshot)
  })

  it('promotes surviving human observations and removes only sources shadowed by rewind', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/')
    index.observe(2, 'https://example.test/', true)
    expect(index.getSnapshot()[0]?.primary).toBe(true)
    index.removeRange(2, 2)
    expect(index.getSnapshot()[0]?.primary).toBe(false)
    const snapshot = index.getSnapshot()
    index.removeRange(5, 8)
    expect(index.getSnapshot()).toBe(snapshot)
    index.removeRange(1, 1)
    expect(index.getSnapshot()).toEqual([])
    index.observe(3, 'https://next.test/', true)
    index.clear()
    expect(index.getSnapshot()).toEqual([])
  })
})

describe('target tree', () => {
  it('shows only relevant type groups and keeps discoveries separate from direct targets', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/ 10.0.0.5 10.0.0.0/24 /opt/demo/app app:"Desktop Demo" target:"USB device"', true)
    index.observe(2, 'https://example.test/api host:10.0.0.6 file:/opt/demo/library.so')
    expect(targetTreeLines(index.getSnapshot())).toMatchInlineSnapshot(`
      [
        "Web · 1",
        "└─ https://example.test/",
        "   └─ Sub Target · 1",
        "      └─ api",
        "Hosts · 2",
        "├─ 10.0.0.5",
        "└─ Observed · 1",
        "   └─ 10.0.0.6",
        "Networks · 1",
        "└─ 10.0.0.0/24",
        "Files / folders · 2",
        "├─ /opt/demo/app",
        "└─ Observed · 1",
        "   └─ /opt/demo/library.so",
        "Apps / programs · 1",
        "└─ Desktop Demo",
        "Targets · 1",
        "└─ USB device",
      ]
    `)
    const nonWeb = new TargetIndex()
    nonWeb.observe(1, 'app:"Desktop Demo"', true)
    expect(targetTreeLines(nonWeb.getSnapshot())).toEqual(['Apps / programs · 1', '└─ Desktop Demo'])
    expect(targetTreeLines([])).toEqual([])
    const observedWeb = new TargetIndex()
    observedWeb.observe(1, 'https://observed.test/')
    expect(targetTreeLines(observedWeb.getSnapshot())).toEqual(['Other web · 1', '└─ https://observed.test/'])
  })

  it('places discoveries under the most specific matching host and path target', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/foo https://example.test/bar https://api.example.test/', true)
    index.observe(2, 'https://example.test/bar/v1 https://api.example.test/v2')
    expect(targetTreeLines(index.getSnapshot())).toEqual([
      'Web · 3', '├─ https://example.test/foo', '├─ https://example.test/bar',
      '│  └─ Sub Target · 1', '│     └─ v1', '└─ https://api.example.test/',
      '   └─ Sub Target · 1', '      └─ v2',
    ])
  })

  it('groups targets, subdomains and nested paths separately from unrelated URLs', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/', true)
    index.observe(2, 'https://example.test/api/v1 https://example.test/api/v2 https://api.example.test/v1 https://docs.test/ https://example.test.evil.test/')
    expect(targetTreeLines(index.getSnapshot())).toMatchInlineSnapshot(`
      [
        "Web · 1",
        "└─ https://example.test/",
        "   └─ Sub Target · 3",
        "      ├─ api",
        "      │  ├─ v1",
        "      │  └─ v2",
        "      └─ https://api.example.test",
        "         └─ v1",
        "Other web · 2",
        "├─ https://docs.test/",
        "└─ https://example.test.evil.test/",
      ]
    `)
  })

  it('retains path roots, distinct ports and exact IP hosts', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/app https://[::1]:443/', true)
    index.observe(2, 'https://example.test/app/api https://example.test:8080/app https://[::1]/api https://[::2]/')
    const lines = targetTreeLines(index.getSnapshot()).join('\n')
    expect(lines).toContain('└─ api')
    expect(lines).toContain('https://example.test:8080')
    expect(lines).toContain('Other web · 1\n└─ https://[::2]/')
  })

  it('keeps the first equal host and path score across origins', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test:8443/app https://example.test:9443/app', true)
    index.observe(2, 'https://example.test:10443/application https://example.test:10443/app/v1')

    expect(targetTreeLines(index.getSnapshot())).toEqual([
      'Web · 2',
      '├─ https://example.test:8443/app',
      '│  └─ Sub Target · 2',
      '│     └─ https://example.test:10443',
      '│        ├─ application',
      '│        └─ app',
      '│           └─ v1',
      '└─ https://example.test:9443/app',
    ])
  })

  it('keeps path prefixes on segment boundaries', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/app', true)
    index.observe(2, 'https://example.test/application/v1')

    expect(targetTreeLines(index.getSnapshot())).toEqual([
      'Web · 1',
      '└─ https://example.test/app',
      '   └─ Sub Target · 1',
      '      └─ application',
      '         └─ v1',
    ])
  })

  it('scores each primary path once per discovery', () => {
    const rootCount = 128
    const urls: TargetEntry[] = [
      ...Array.from({ length: rootCount }, (_, index): TargetEntry => ({
        kind: 'web', value: `https://example.test/root-${index}`,
        primary: true,
      })),
      { kind: 'web', value: 'https://example.test/discovery', primary: false },
    ]
    const pathname = vi.spyOn(URL.prototype, 'pathname', 'get')
    let lines: string[]
    let pathReads: number
    try {
      lines = targetTreeLines(urls)
      pathReads = pathname.mock.calls.length
    } finally {
      pathname.mockRestore()
    }

    expect(lines[0]).toBe('Web · 128')
    expect(lines).toContain('│  └─ Sub Target · 1')
    expect(lines).toContain('│     └─ discovery')
    expect(pathReads).toBeLessThanOrEqual(3 * rootCount + 8)
  })

  it('reads URL pathnames linearly across roots and discoveries', () => {
    const rootCount = 64
    const discoveryCount = 64
    const urls: TargetEntry[] = [
      ...Array.from({ length: rootCount }, (_, index): TargetEntry => ({
        kind: 'web', value: `https://example.test/root-${index}`,
        primary: true,
      })),
      ...Array.from({ length: discoveryCount }, (_, index): TargetEntry => ({
        kind: 'web', value: `https://example.test/root-${index}/discovery`,
        primary: false,
      })),
    ]
    const pathname = vi.spyOn(URL.prototype, 'pathname', 'get')
    let lines: string[]
    let pathReads: number
    try {
      lines = targetTreeLines(urls)
      pathReads = pathname.mock.calls.length
    } finally {
      pathname.mockRestore()
    }

    expect(lines[0]).toBe('Web · 64')
    expect(lines.filter(line => line.includes('Sub Target'))).toHaveLength(discoveryCount)
    expect(lines.some(line => line.includes('discovery'))).toBe(true)
    // Three reads per discovery allow path matching and addPath work; each root needs one metadata read.
    expect(pathReads).toBeLessThanOrEqual(rootCount + 3 * discoveryCount + 8)
  })
})
