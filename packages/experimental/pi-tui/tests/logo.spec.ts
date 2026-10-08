import chalk from 'chalk'
import { describe, expect, it } from 'vitest'
import { logoLines } from '../src/ui/logo.ts'
import { LOGO_PALETTE, LOGO_ROWS } from '../src/ui/logo-data.ts'

chalk.level = 1

describe('logoLines', () => {
  it('stacks the sampled grid into half-pair rows one cell tall', () => {
    const lines = logoLines()
    expect(lines).toHaveLength(Math.ceil(LOGO_ROWS.length / 2))
    for (const line of lines) {
      expect(line).not.toContain('\n')
    }
  })

  it('paints mixed top/bottom cells with the foreground over background color', () => {
    // Find a mixed cell (top set, bottom set, different indices) and assert
    // its rendered glyph carries both colors; fall back to whatever the grid
    // actually contains so the test stays tied to the real asset.
    const mixed = { top: -1, bottom: -1 }
    for (let row = 0; row + 1 < LOGO_ROWS.length; row += 2) {
      const topRow = LOGO_ROWS[row] ?? ''
      const bottomRow = LOGO_ROWS[row + 1] ?? ''
      for (let col = 0; col < topRow.length; col += 2) {
        const top = Number.parseInt(topRow.slice(col, col + 2).trim(), 16)
        const bottom = Number.parseInt(bottomRow.slice(col, col + 2).trim(), 16)
        if (Number.isNaN(top) || Number.isNaN(bottom) || top === bottom) continue
        mixed.top = top
        mixed.bottom = bottom
        break
      }
      if (mixed.top >= 0) break
    }
    expect(mixed.top).toBeGreaterThanOrEqual(0)
    const topColor = LOGO_PALETTE[mixed.top]
    const bottomColor = LOGO_PALETTE[mixed.bottom]
    if (topColor === undefined || bottomColor === undefined) throw new Error('palette entry missing')
    const rendered = chalk
      .rgb(topColor.r, topColor.g, topColor.b)
      .bgRgb(bottomColor.r, bottomColor.g, bottomColor.b)('▀')
    expect(logoLines().join('\n')).toContain(rendered)
  })

  it('drops transparent trailing cells from every row', () => {
    for (const line of logoLines()) {
      expect(line.endsWith(' ')).toBe(false)
    }
  })
})
