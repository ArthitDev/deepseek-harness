// Regenerates src/ui/logo-data.ts: samples the brand logo (the web app's
// new-logo.png) into the half-block color grid the TUI banner renders.
// Run from anywhere: `node packages/experimental/pi-tui/tools/logo-sample.mjs`.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { decodeLogoPng } from './logo-png.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
// tools/.. is the package dir; the repo root is three levels above it.
const { width, height, pixels } = decodeLogoPng(
  readFileSync(join(packageRoot, '../../../apps/web/public/new-logo.png')),
)
const stride = width * 4

// ── content bbox ─────────────────────────────────────────────────────────
let minX = width; let minY = height; let maxX = 0; let maxY = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (pixels[y * stride + x * 4 + 3] > 32) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}

// ── box-downsample to COLS×COLS grid ─────────────────────────────────────
const COLS = 20
const ROWS = 20
const grid = []
for (let gy = 0; gy < ROWS; gy++) {
  const row = []
  for (let gx = 0; gx < COLS; gx++) {
    const x0 = minX + Math.floor(((maxX - minX + 1) * gx) / COLS)
    const x1 = minX + Math.floor(((maxX - minX + 1) * (gx + 1)) / COLS)
    const y0 = minY + Math.floor(((maxY - minY + 1) * gy) / ROWS)
    const y1 = minY + Math.floor(((maxY - minY + 1) * (gy + 1)) / ROWS)
    let r = 0; let g = 0; let b = 0; let a = 0; let n = 0
    for (let y = y0; y < Math.max(y1, y0 + 1); y++) {
      for (let x = x0; x < Math.max(x1, x0 + 1); x++) {
        const o = y * stride + x * 4
        const alpha = pixels[o + 3] / 255
        r += pixels[o] * alpha
        g += pixels[o + 1] * alpha
        b += pixels[o + 2] * alpha
        a += alpha
        n++
      }
    }
    row.push(a / n < 0.18 ? null : { r: Math.round(r / a), g: Math.round(g / a), b: Math.round(b / a) })
  }
  grid.push(row)
}

// ── palette quantize (round to /8, drop dupes) ───────────────────────────
const palette = []
const paletteIndex = new Map()
const quantize = (c) => {
  const key = `${c.r >> 4},${c.g >> 4},${c.b >> 4}`
  let index = paletteIndex.get(key)
  if (index === undefined) {
    index = palette.length
    paletteIndex.set(key, index)
    palette.push(c)
  }
  return index
}
const digits = '0123456789abcdef'
const hex2 = (n) => digits[(n >> 4) & 0xf] + digits[n & 0xf]
const rows = grid.map((row) => row
  .map((cell) => (cell === null ? ' .' : hex2(quantize(cell))))
  .join(''))

if (palette.length > 256) throw new Error(`palette overflow: ${palette.length}`)

const ts = `/**
 * The Shield Break logo, sampled from apps/web/public/new-logo.png into a
 * ${COLS}x${ROWS} color grid — one palette entry per rounded RGB triplet, one
 * two-hex-digit character pair per pixel (' .' transparent, else the palette
 * index). Two grid rows stack into one terminal cell as a half-block pair.
 * Regenerate with the logo-sample script; do not edit by hand.
 */

/** sRGB triplets indexed by the hex pairs in {@link LOGO_ROWS}. */
export const LOGO_PALETTE: readonly { r: number; g: number; b: number }[] = [
${palette.map((c) => `  { r: ${c.r}, g: ${c.g}, b: ${c.b} },`).join('\n')}
]

/** ${ROWS} rows of ${COLS} two-hex-digit pixels; ' .' renders as terminal background. */
export const LOGO_ROWS: readonly string[] = [
${rows.map((row) => `  '${row}',`).join('\n')}
]
`
writeFileSync(join(packageRoot, 'src/ui/logo-data.ts'), ts)
console.log(`palette ${palette.length}, grid ${COLS}x${ROWS}, bbox ${maxX - minX + 1}x${maxY - minY + 1}`)
