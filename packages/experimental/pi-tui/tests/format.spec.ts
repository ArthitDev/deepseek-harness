import { describe, expect, it } from 'vitest'
import chalk from 'chalk'
import {
  contextPctOf,
  ellipsize,
  gitLabel,
  highlightMatches,
  renderContextBar,
  sandboxShort,
  shortTokens,
} from '../src/core/format.ts'

describe('sandboxShort', () => {
  it('maps known modes to short names and keeps unknown modes', () => {
    expect(sandboxShort('workspace-write')).toBe('ws-write')
    expect(sandboxShort('read-only')).toBe('read-only')
    expect(sandboxShort('danger-full-access')).toBe('danger')
    expect(sandboxShort('custom-mode')).toBe('custom-mode')
  })

  it('returns undefined for an absent mode', () => {
    expect(sandboxShort(undefined)).toBeUndefined()
  })
})

describe('ellipsize', () => {
  it('returns short text unchanged', () => {
    expect(ellipsize('abc', 5)).toBe('abc')
    expect(ellipsize('abc', 3)).toBe('abc')
  })

  it('truncates overflowing text with a one-character ellipsis', () => {
    expect(ellipsize('abcdef', 4)).toBe('abc…')
  })

  it('yields an empty string for a non-positive width', () => {
    expect(ellipsize('abc', 0)).toBe('')
    expect(ellipsize('abc', -1)).toBe('')
  })

  it('renders only the ellipsis at width 1', () => {
    expect(ellipsize('abcdef', 1)).toBe('…')
  })
})

describe('highlightMatches', () => {
  it('returns the text unchanged for a blank query or empty text', () => {
    expect(highlightMatches('hello', '')).toBe('hello')
    expect(highlightMatches('hello', '   ')).toBe('hello')
    expect(highlightMatches('', 'x')).toBe('')
  })

  it('underlines every case-insensitive occurrence', () => {
    const marked = highlightMatches('AbXabx', 'abx')
    expect(marked).toBe(
      `${chalk.underline.yellow('AbX')}${chalk.underline.yellow('abx')}`,
    )
  })

  it('keeps unmatched tails and gaps intact', () => {
    const marked = highlightMatches('one two three', 'two')
    expect(marked).toBe(`one ${chalk.underline.yellow('two')} three`)
  })

  it('returns the text unchanged when nothing matches', () => {
    expect(highlightMatches('hello', 'xyz')).toBe('hello')
  })
})

describe('gitLabel', () => {
  it('marks dirty trees with a star', () => {
    expect(gitLabel('main', true)).toBe('git:main*')
    expect(gitLabel('main', false)).toBe('git:main')
  })
})

describe('shortTokens', () => {
  it('keeps small counts bare', () => {
    expect(shortTokens(0)).toBe('0')
    expect(shortTokens(999)).toBe('999')
  })

  it('abbreviates thousands', () => {
    expect(shortTokens(1000)).toBe('1k')
    expect(shortTokens(12345)).toBe('12.3k')
  })

  it('abbreviates millions with a trimmed decimal', () => {
    expect(shortTokens(1_000_000)).toBe('1M')
    expect(shortTokens(1_234_567)).toBe('1.2M')
  })
})

describe('renderContextBar', () => {
  it('returns undefined when the total is unknown or non-positive', () => {
    expect(renderContextBar(undefined, 100)).toBeUndefined()
    expect(renderContextBar(10, undefined)).toBeUndefined()
    expect(renderContextBar(10, 0)).toBeUndefined()
  })

  it('renders a full red bar at 100 percent', () => {
    const bar = renderContextBar(100, 100)
    expect(bar).toBe(chalk.red('▓').repeat(10))
  })

  it('renders a yellow bar in the 70-89 percent band', () => {
    const bar = renderContextBar(75, 100)
    expect(bar).toBe(chalk.yellow('▓').repeat(8) + chalk.dim('░').repeat(2))
  })

  it('renders a green bar below 70 percent', () => {
    const bar = renderContextBar(50, 100)
    expect(bar).toBe(chalk.green('▓').repeat(5) + chalk.dim('░').repeat(5))
  })
})

describe('contextPctOf', () => {
  it('returns undefined without a positive window', () => {
    expect(contextPctOf(undefined)).toBeUndefined()
    expect(contextPctOf({ contextWindow: 0, projectedTokens: 10 })).toBeUndefined()
  })

  it('prefers projected tokens over pressure tokens', () => {
    expect(contextPctOf({ contextWindow: 200, projectedTokens: 50, pressureTokens: 100 })).toBe(25)
  })

  it('falls back to pressure tokens', () => {
    expect(contextPctOf({ contextWindow: 200, pressureTokens: 100 })).toBe(50)
  })

  it('returns undefined without any token count', () => {
    expect(contextPctOf({ contextWindow: 200 })).toBeUndefined()
  })

  it('caps the percentage at 100', () => {
    expect(contextPctOf({ contextWindow: 100, projectedTokens: 500 })).toBe(100)
  })
})
