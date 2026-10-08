/**
 * The Shield Break logo, sampled from apps/web/public/new-logo.png into a
 * 12x12 color grid — one palette entry per rounded RGB triplet, one
 * two-hex-digit character pair per pixel (' .' transparent, else the palette
 * index). Two grid rows stack into one terminal cell as a half-block pair.
 * Regenerate with the logo-sample script; do not edit by hand.
 */

/** sRGB triplets indexed by the hex pairs in {@link LOGO_ROWS}. */
export const LOGO_PALETTE: readonly { r: number; g: number; b: number }[] = [
  { r: 157, g: 25, b: 36 },
  { r: 106, g: 47, b: 52 },
  { r: 133, g: 47, b: 52 },
  { r: 110, g: 54, b: 57 },
  { r: 154, g: 50, b: 55 },
  { r: 70, g: 21, b: 27 },
  { r: 41, g: 33, b: 35 },
  { r: 66, g: 48, b: 50 },
  { r: 139, g: 41, b: 38 },
  { r: 64, g: 35, b: 35 },
  { r: 82, g: 36, b: 39 },
  { r: 117, g: 37, b: 44 },
  { r: 70, g: 30, b: 35 },
  { r: 58, g: 21, b: 25 },
  { r: 44, g: 24, b: 27 },
  { r: 192, g: 8, b: 19 },
  { r: 59, g: 14, b: 17 },
  { r: 57, g: 57, b: 59 },
  { r: 13, g: 13, b: 14 },
  { r: 92, g: 27, b: 25 },
  { r: 60, g: 37, b: 39 },
  { r: 53, g: 8, b: 10 },
  { r: 47, g: 15, b: 16 },
  { r: 44, g: 11, b: 13 },
  { r: 31, g: 2, b: 3 },
  { r: 97, g: 20, b: 25 },
  { r: 75, g: 10, b: 16 },
  { r: 16, g: 16, b: 17 },
  { r: 66, g: 6, b: 9 },
  { r: 80, g: 11, b: 13 },
  { r: 86, g: 15, b: 21 },
  { r: 98, g: 11, b: 13 },
]

/** 12 rows of 12 two-hex-digit pixels; ' .' renders as terminal background. */
export const LOGO_ROWS: readonly string[] = [
  ' . . .000102 .0304 . . .',
  ' .02050607020807090a0b .',
  ' .0c0d090a07060b090d0e0f',
  '0d0d10050911120e13050d13',
  '140d15130d16171713150d06',
  ' .131714121718121417190e',
  ' .1a161b121c15121b0e10 .',
  ' . .1c0e121d15120d1c . .',
  ' . . .1a0e1d150e1e . . .',
  ' . . . .1c1f151c . . . .',
  ' . . . . .1f1d . . . . .',
  ' . . . . . . . . . . . .',
]
