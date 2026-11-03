import { describe, expect, it, vi } from 'vitest'
import { TargetIndex } from '../src/core/targets.ts'
import { targetTreeLines } from '../src/ui/targets-pane.ts'

describe('TargetIndex', () => {
  it('normalizes and deduplicates URLs while removing credentials, query, fragments and terminal controls', () => {
    const index = new TargetIndex()
    index.observe(1, '\x1b]52;c;hidden\x07(https://user:password@EXAMPLE.test:443/api?q=secret#token). [https://example.test/api] https:// https://[::1]:8080/a', true)
    expect(index.getSnapshot()).toEqual([
      { url: 'https://example.test/api', primary: true },
      { url: 'https://[::1]:8080/a', primary: true },
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
  it('places discoveries under the most specific matching host and path target', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/foo https://example.test/bar https://api.example.test/', true)
    index.observe(2, 'https://example.test/bar/v1 https://api.example.test/v2')
    expect(targetTreeLines(index.getSnapshot())).toEqual([
      'Target · 3', '├─ https://example.test/foo', '├─ https://example.test/bar',
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
        "Target · 1",
        "└─ https://example.test/",
        "   └─ Sub Target · 3",
        "      ├─ api",
        "      │  ├─ v1",
        "      │  └─ v2",
        "      └─ https://api.example.test",
        "         └─ v1",
        "Other · 2",
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
    expect(lines).toContain('Other · 1\n└─ https://[::2]/')
  })

  it('keeps the first equal host and path score across origins', () => {
    const index = new TargetIndex()
    index.observe(1, 'https://example.test:8443/app https://example.test:9443/app', true)
    index.observe(2, 'https://example.test:10443/application https://example.test:10443/app/v1')

    expect(targetTreeLines(index.getSnapshot())).toEqual([
      'Target · 2',
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
      'Target · 1',
      '└─ https://example.test/app',
      '   └─ Sub Target · 1',
      '      └─ application',
      '         └─ v1',
    ])
  })

  it('scores each primary path once per discovery', () => {
    const rootCount = 128
    const urls = [
      ...Array.from({ length: rootCount }, (_, index) => ({
        url: `https://example.test/root-${index}`,
        primary: true,
      })),
      { url: 'https://example.test/discovery', primary: false },
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

    expect(lines[0]).toBe('Target · 128')
    expect(lines).toContain('│  └─ Sub Target · 1')
    expect(lines).toContain('│     └─ discovery')
    expect(pathReads).toBeLessThanOrEqual(3 * rootCount + 8)
  })

  it('reads URL pathnames linearly across roots and discoveries', () => {
    const rootCount = 64
    const discoveryCount = 64
    const urls = [
      ...Array.from({ length: rootCount }, (_, index) => ({
        url: `https://example.test/root-${index}`,
        primary: true,
      })),
      ...Array.from({ length: discoveryCount }, (_, index) => ({
        url: `https://example.test/root-${index}/discovery`,
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

    expect(lines[0]).toBe('Target · 64')
    expect(lines.filter(line => line.includes('Sub Target'))).toHaveLength(discoveryCount)
    expect(lines.some(line => line.includes('discovery'))).toBe(true)
    // Three reads per discovery allow path matching and addPath work; each root needs one metadata read.
    expect(pathReads).toBeLessThanOrEqual(rootCount + 3 * discoveryCount + 8)
  })
})
