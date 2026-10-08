// Shared decoder for the 8-bit RGBA, non-interlaced brand PNG. The icon
// generator (logo-icon.mjs) starts from this.
import { inflateSync } from 'node:zlib'

/**
 * Decode the brand logo PNG into raw RGBA rows.
 * @param {Buffer} png - the encoded PNG file.
 * @returns {{ width: number, height: number, pixels: Buffer }} row-major RGBA.
 */
export function decodeLogoPng(png) {
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString()
    if (type === 'IHDR') {
      width = png.readUInt32BE(offset + 8)
      height = png.readUInt32BE(offset + 12)
      if (png[offset + 16] !== 8 || png[offset + 17] !== 6 || png[offset + 20] !== 0) {
        throw new Error(
          `unsupported PNG: depth=${png[offset + 16]} color=${png[offset + 17]} interlace=${png[offset + 20]}`,
        )
      }
    } else if (type === 'IDAT') {
      idat.push(png.subarray(offset + 8, offset + 8 + length))
    } else if (type === 'IEND') break
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const pixels = Buffer.alloc(height * stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const source = y * (stride + 1) + 1
    const target = y * stride
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[source + x]
      const left = x >= 4 ? pixels[target + x - 4] : 0
      const up = y > 0 ? pixels[target + x - stride] : 0
      const upLeft = x >= 4 && y > 0 ? pixels[target + x - stride - 4] : 0
      let value
      if (filter === 0) value = rawByte
      else if (filter === 1) value = rawByte + left
      else if (filter === 2) value = rawByte + up
      else if (filter === 3) value = rawByte + ((left + up) >> 1)
      else value = rawByte + paeth(left, up, upLeft)
      pixels[target + x] = value & 0xff
    }
  }
  return { width, height, pixels }
}
