import { describe, expect, it } from 'vitest'
import { instructionImports } from '../src/imports.ts'

describe('instruction import references', () => {
  it('reads paths in prose and preserves Windows separators and escaped spaces', () => {
    expect(instructionImports(String.raw`Use @./rules.md then @Design\ Docs/style.md
@C:\Users\Sun\rules.md
@~/personal.md
(@../shared.md)`)).toEqual(['./rules.md', 'Design Docs/style.md', 'C:\\Users\\Sun\\rules.md', '~/personal.md', '../shared.md'])
  })

  it('ignores quoted references, email, escapes, code, HTML and link destinations', () => {
    const source = [
      'mail@example.com "@quoted.md" @"quoted.md" \\@escaped.md',
      '`@inline.md` ``@more-inline.md``',
      '```md', '@fenced.md', '```',
      '~~~', '@tilde.md', '~~~',
      '    @indented.md',
      '<!-- @comment.md -->',
      '[link](https://example.com/@url.md)',
      'Use @real.md after `code` and @last.md',
    ].join('\n\n')
    expect(instructionImports(source)).toEqual(['real.md', 'last.md'])
    expect(instructionImports('No references.')).toEqual([])
  })
})
