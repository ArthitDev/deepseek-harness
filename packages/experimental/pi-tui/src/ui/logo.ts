/**
 * The Shield Break logo renderer: stacks the sampled color grid
 * (logo-data.ts) into half-block terminal rows with truecolor styling, so the
 * official brand mark shows in every truecolor terminal — no graphics
 * protocol needed.
 */
import chalk from 'chalk'
import { LOGO_PALETTE, LOGO_ROWS } from './logo-data.ts'

const parseIndex = (pair: string): number => {
  const index = Number.parseInt(pair.trim(), 16)
  return Number.isNaN(index) ? -1 : index
}

/** Terminal rows for the logo: two grid rows stack per cell as ▀/▄ pairs. */
export function logoLines(): string[] {
  const lines: string[] = []
  for (let row = 0; row < LOGO_ROWS.length; row += 2) {
    const top = LOGO_ROWS[row] ?? ''
    const bottom = LOGO_ROWS[row + 1] ?? ''
    let line = ''
    for (let col = 0; col < top.length; col += 2) {
      const topIndex = parseIndex(top.slice(col, col + 2))
      const bottomIndex = parseIndex(bottom.slice(col, col + 2))
      if (topIndex < 0 && bottomIndex < 0) {
        line += ' '
        continue
      }
      const topColor = topIndex >= 0 ? LOGO_PALETTE[topIndex] : undefined
      const bottomColor = bottomIndex >= 0 ? LOGO_PALETTE[bottomIndex] : undefined
      if (topColor !== undefined && bottomColor !== undefined) {
        if (topIndex === bottomIndex) {
          line += chalk.rgb(topColor.r, topColor.g, topColor.b)('█')
        } else {
          line += chalk.rgb(topColor.r, topColor.g, topColor.b)
            .bgRgb(bottomColor.r, bottomColor.g, bottomColor.b)('▀')
        }
      } else if (topColor !== undefined) {
        line += chalk.rgb(topColor.r, topColor.g, topColor.b)('▀')
      } else if (bottomColor !== undefined) {
        line += chalk.rgb(bottomColor.r, bottomColor.g, bottomColor.b)('▄')
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}
