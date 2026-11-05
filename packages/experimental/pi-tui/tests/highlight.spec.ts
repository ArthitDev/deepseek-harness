/** Grammar coverage and lossless terminal rendering of complete and streaming code. */
import chalk from 'chalk'
import hljs from 'highlight.js'
import { describe, expect, it } from 'vitest'
import { highlightCode, highlightLine, languageFamily } from '../src/ui/highlight.js'

// The test runner has no TTY so chalk auto-disables; force ANSI-16 before any
// call so the color assertions below see real escape codes.
chalk.level = 1

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('languageFamily', () => {
  it('maps known ids and aliases', () => {
    expect(languageFamily('ts')).toBe('typescript')
    expect(languageFamily('Python')).toBe('python')
    expect(languageFamily(' bash ')).toBe('bash')
    expect(languageFamily('golang')).toBe('go')
  })

  it('returns undefined for unknown or empty ids', () => {
    expect(languageFamily(undefined)).toBeUndefined()
    expect(languageFamily('')).toBeUndefined()
    expect(languageFamily('unsupported-language')).toBeUndefined()
    expect(languageFamily('constructor')).toBeUndefined()
    expect(languageFamily('__proto__')).toBeUndefined()
    expect(languageFamily('language-C++ filename=main.cpp')).toBe('cpp')
  })
})

describe('highlightLine', () => {
  it('returns plain lines for unknown languages', () => {
    expect(highlightLine('const x = 1', 'unsupported-language')).toBe('const x = 1')
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

  it('colors JSON keys and string values using their grammar scopes', () => {
    const source = '{"k": "value"}'
    const out = highlightLine(source, 'json')
    expect(strip(out)).toBe(source)
    expect(out).toContain('\x1b[33m"k"')
    expect(out).toContain('\x1b[32m"value"')
  })

  it('colors sql dash-dash comments gray', () => {
    const out = highlightLine('-- select all', 'sql')
    expect(out).toBe('\x1b[90m-- select all\x1b[39m')
  })
})

describe('highlightCode', () => {
  it.each([
    ['c', 'int main(void) { return 42; }'], ['c++', 'class Widget { public: int value = 42; };'],
    ['c#', 'public class Widget { string text = "hello"; }'], ['java', 'public class Widget { String text = "hello"; }'],
    ['powershell', 'Get-ChildItem -Path "C:/work"'], ['html', '<div class="card">hello</div>'],
    ['css', '.card { color: red; }'], ['php', '<?php echo "hello";'],
    ['ruby', 'def greet; puts "hello"; end'], ['swift', 'let text = "hello"'],
    ['kotlin', 'val text = "hello"'], ['lua', 'local text = "hello"'],
    ['yaml', 'name: "hello"'], ['toml', 'name = "hello"'], ['dockerfile', 'FROM node:24'],
    ['diff', '+added\n-removed'], ['tsx', 'const item = <div>hello</div>'],
  ])('colors %s without changing its code', (lang, code) => {
    const lines = highlightCode(code, lang)
    expect(lines.map(strip).join('\n')).toBe(code)
    expect(lines.join('\n')).toMatch(/\x1b\[/)
  })

  it('retains multiline comment state, blank lines, trailing newlines, and partial input', () => {
    const code = '/* comment\nreturn 42;\n\n*/ int main(void) { return 1; }\n'
    const lines = highlightCode(code, 'c')
    expect(lines.map(strip)).toEqual(code.split('\n'))
    expect(lines[1]).toContain('\x1b[90mreturn 42;')
    expect(lines[1]).not.toContain('\x1b[35mreturn')
    for (let end = 1; end <= code.length; end++) {
      expect(highlightCode(code.slice(0, end), 'c').map(strip).join('\n')).toBe(code.slice(0, end))
    }
  })

  it('decodes escaped token text once, including literal spans and entity names', () => {
    const code = 'const html = "<span class=\\"hljs-string\\">&lt; &amp; &#x27;</span>";\n// < > & " \' ไทย\n'
    expect(highlightCode(code, 'js').map(strip).join('\n')).toBe(code)
  })

  it('preserves source and line counts for every bundled grammar', () => {
    const code = '<tag key="value">&lt; &amp; \'ไทย\'</tag>\n/* comment\n42\n*/\n'
    expect(hljs.listLanguages().length).toBeGreaterThan(190)
    for (const language of hljs.listLanguages()) {
      expect(highlightCode(code, language).map(strip), language).toEqual(code.split('\n'))
    }
  })
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
