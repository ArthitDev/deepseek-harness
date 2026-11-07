import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')
  expect(index).toContain('<link rel="apple-touch-icon" href="./new-logo.png" />')
  expect(index).toContain('<meta name="mobile-web-app-capable" content="yes" />')
  expect(index).toContain('<meta name="apple-mobile-web-app-title" content="Shield Break" />')
  expect(index).toContain('<link rel="icon" type="image/png" href="./new-logo.png" />')
  expect(index).toContain('<title>Shield Break Agent</title>')
  // No `theme-color` here: `ThemePresenter` owns the single metadata node and
  // follows the resolved in-application theme, which a static media query
  // cannot. `settings-chrome.e2e.ts` pins the live contract.

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  // No `id`: a browser resolves an explicit `id` against the start URL's origin,
  // so only an absent `id`, which defaults to the resolved `start_url`, gives
  // each mount its own identity. `public-mount.e2e.ts` reads the resolved form.
  expect(manifest).toEqual({
    name: 'Shield Break Agent',
    short_name: 'Shield Break',
    start_url: './',
    scope: './',
    display: 'fullscreen',
    icons: [
      { src: '/new-logo.png', sizes: '1280x1280', type: 'image/png', purpose: 'any' },
    ],
  })
})

it('ships the Shield Break logo as a square PNG favicon', async () => {
  const png = await readFile(join(DIST_ROOT, 'new-logo.png'))
  // PNG signature, then the IHDR chunk: width and height as big-endian uint32.
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR')
  expect(png.readUInt32BE(16)).toBe(1280)
  expect(png.readUInt32BE(20)).toBe(1280)
})
