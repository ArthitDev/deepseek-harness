// Regenerates assets/shield-break.ico from the brand logo for shell profiles
// (Windows Terminal tab icon, shortcuts). Sizes ≤48 embed BMP entries, larger
// sizes embed PNG entries — the most widely compatible ICO mix.
// Run from anywhere: `node packages/experimental/pi-tui/tools/logo-icon.mjs`.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { decodeLogoPng } from './logo-png.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
// tools/.. is the package dir; the repo root is three levels above it.
const logo = decodeLogoPng(
  readFileSync(join(packageRoot, '../../../apps/web/public/new-logo.png')),
)

/** Content bounding box (alpha > 32), so downscales center on the mark. */
const bbox = () => {
  let minX = logo.width; let minY = logo.height; let maxX = 0; let maxY = 0
  for (let y = 0; y < logo.height; y++) {
    for (let x = 0; x < logo.width; x++) {
      if (logo.pixels[y * logo.width * 4 + x * 4 + 3] > 32) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, minY, maxX, maxY }
}
const box = bbox()

/** Box-average downscale of the cropped logo to size×size RGBA. */
const sample = (size) => {
  const out = Buffer.alloc(size * size * 4)
  const cropW = box.maxX - box.minX + 1
  const cropH = box.maxY - box.minY + 1
  for (let y = 0; y < size; y++) {
    const y0 = box.minY + Math.floor((cropH * y) / size)
    const y1 = box.minY + Math.floor((cropH * (y + 1)) / size)
    for (let x = 0; x < size; x++) {
      const x0 = box.minX + Math.floor((cropW * x) / size)
      const x1 = box.minX + Math.floor((cropW * (x + 1)) / size)
      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0
      for (let sy = y0; sy < Math.max(y1, y0 + 1); sy++) {
        for (let sx = x0; sx < Math.max(x1, x0 + 1); sx++) {
          const o = sy * logo.width * 4 + sx * 4
          const alpha = logo.pixels[o + 3] / 255
          r += logo.pixels[o] * alpha
          g += logo.pixels[o + 1] * alpha
          b += logo.pixels[o + 2] * alpha
          a += alpha
          n++
        }
      }
      const target = (y * size + x) * 4
      if (a / n < 0.18) continue
      out[target] = Math.round(r / a)
      out[target + 1] = Math.round(g / a)
      out[target + 2] = Math.round(b / a)
      out[target + 3] = 255
    }
  }
  return out
}

/** Minimal PNG encoder (filter 0 scanlines) for the large ICO entries. */
const encodePng = (rgba, size) => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32LE(0, 0)
    let state = 0xffffffff
    for (const byte of body) state = crcTable[(state ^ byte) & 0xff] ^ (state >>> 8)
    crc.writeUInt32BE((state ^ 0xffffffff) >>> 0, 0)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** BMP entry: 40-byte BITMAPINFOHEADER + bottom-up BGRA + empty AND mask. */
const bmpEntry = (size) => {
  const rgba = sample(size)
  const maskRow = Math.ceil(size / 32) * 4
  const body = Buffer.alloc(40 + size * size * 4 + maskRow * size)
  body.writeUInt32LE(40, 0)
  body.writeInt32LE(size, 4)
  body.writeInt32LE(size * 2, 8)
  body.writeUInt16LE(1, 12)
  body.writeUInt16LE(32, 14)
  for (let y = 0; y < size; y++) {
    const sourceRow = size - 1 - y
    for (let x = 0; x < size; x++) {
      const source = (sourceRow * size + x) * 4
      const target = 40 + (y * size + x) * 4
      body[target] = rgba[source + 2]
      body[target + 1] = rgba[source + 1]
      body[target + 2] = rgba[source]
      body[target + 3] = rgba[source + 3]
    }
  }
  return body
}

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const entries = SIZES.map((size) => {
  const rgba = sample(size)
  return { size, body: size <= 48 ? bmpEntry(size) : encodePng(rgba, size) }
})
const total = entries.reduce((sum, entry) => sum + entry.body.length, 0)
const header = Buffer.alloc(6 + entries.length * 16)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(entries.length, 4)
let offset = header.length
for (const entry of entries) {
  const dir = 6 + SIZES.indexOf(entry.size) * 16
  header[dir] = entry.size === 256 ? 0 : entry.size
  header[dir + 1] = entry.size === 256 ? 0 : entry.size
  header.writeUInt16LE(1, dir + 4)
  header.writeUInt16LE(entry.size <= 48 ? 32 : 32, dir + 6)
  header.writeUInt32LE(entry.body.length, dir + 8)
  header.writeUInt32LE(offset, dir + 12)
  offset += entry.body.length
}
const ico = Buffer.concat([header, ...entries.map((entry) => entry.body)])
const target = join(packageRoot, 'assets/shield-break.ico')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, ico)
console.log(`shield-break.ico: ${SIZES.join('/')}, ${ico.length} bytes`)
