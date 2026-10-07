/** Tests for the zero-dep terminal syntax highlighter. */
import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import { highlightCode, highlightLine, languageFamily } from '../src/ui/highlight.js'

// The test runner has no TTY so chalk auto-disables; force ANSI-16 before any
// call so the color assertions below see real escape codes.
chalk.level = 1

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('languageFamily', () => {
  it('maps known ids and aliases', () => {
    expect(languageFamily('ts')).toBe('ts')
    expect(languageFamily('Python')).toBe('py')
    expect(languageFamily(' bash ')).toBe('sh')
    expect(languageFamily('golang')).toBe('go')
  })

  it('returns undefined for unknown or empty ids', () => {
    expect(languageFamily(undefined)).toBeUndefined()
    expect(languageFamily('')).toBeUndefined()
    expect(languageFamily('brainfuck')).toBeUndefined()
  })
})

describe('highlightLine', () => {
  it('returns plain lines for unknown languages', () => {
    expect(highlightLine('const x = 1', 'brainfuck')).toBe('const x = 1')
  })

  it('returns empty lines unchanged', () => {
    expect(highlightLine('   ', 'ts')).toBe('   ')
  })

  it('colors keywords, strings, comments, numbers, and calls in one pass', () => {
    const line = 'const n = count(42) // total'
    const out = highlightLine(line, 'ts')
    expect(strip(out)).toBe(line)
    expect(out).toContain('\x1b[35mconst')
    expect(out).toContain('\x1b[36mcount')
    // Comments dim, numbers colored, strings green — exact codes vary by
    // chalk level, so assert on the bare text pieces.
    expect(out).toContain('// total')
    expect(out).toContain('42')
  })

  it('colors python hash comments', () => {
    const out = highlightLine('# deploy', 'py')
    expect(strip(out)).toBe('# deploy')
    expect(out).toContain('\x1b[90m')
  })

  it('colors json strings without keyword coloring', () => {
    const out = highlightLine('"k": true', 'json')
    expect(strip(out)).toBe('"k": true')
    expect(out).toContain('\x1b[32m"k"')
  })

  it('colors sql dash-dash comments gray', () => {
    const out = highlightLine('-- select all', 'sql')
    expect(out).toBe('\x1b[90m-- select all\x1b[39m')
  })
})

describe('highlightCode', () => {
  it('splits a block into one colored line per source line', () => {
    const code = 'const a = 1\nconst b = 2'
    const lines = highlightCode(code, 'ts')
    expect(lines).toHaveLength(2)
    expect(lines.map(strip)).toEqual(['const a = 1', 'const b = 2'])
  })

  it('preserves line count for unknown languages', () => {
    const code = 'alpha\nbeta\ngamma'
    expect(highlightCode(code, undefined)).toHaveLength(3)
  })
})
