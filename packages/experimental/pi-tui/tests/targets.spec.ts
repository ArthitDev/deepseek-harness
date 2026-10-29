import { describe, expect, it } from 'vitest'
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
})
