/**
 * Shield Break theme: brand-red accents with truecolor gradients, dim
 * reasoning, and compact tool cards over pi-tui's theme functions.
 */
import chalk from 'chalk'
import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'
import { highlightCode } from './highlight.js'

/** Brand red — the accent every selection and prompt glyph carries. */
export const BRAND_RED = '#ff4655'

const muted = chalk.hex('#8899aa')
const accent = chalk.hex(BRAND_RED)

/**
 * Truecolor per-character gradient for short brand strings. Identity below
 * the truecolor level (terminals without 24-bit color keep plain text).
 * @param text - the string to paint.
 * @param from - starting `#rrggbb` color.
 * @param to - ending `#rrggbb` color.
 * @returns the gradient-painted string.
 */
export function gradient(text: string, from: string, to: string): string {
  if (chalk.level < 3 || text.length === 0) return text
  const channel = (hex: string, shift: number) => Number.parseInt(hex.slice(shift, shift + 2), 16)
  const [r0, g0, b0] = [channel(from, 1), channel(from, 3), channel(from, 5)]
  const [r1, g1, b1] = [channel(to, 1), channel(to, 3), channel(to, 5)]
  const last = text.length - 1
  let out = ''
  for (let index = 0; index < text.length; index++) {
    const t = last === 0 ? 0 : index / last
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
    out += chalk.rgb(mix(r0, r1), mix(g0, g1), mix(b0, b1))(text[index])
  }
  return out
}

/** Markdown render styles for transcript text: headings, links, code, quotes, and lists. */
export const markdownTheme: MarkdownTheme = {
  heading: text => chalk.bold.hex('#ff6b7a')(text),
  link: text => chalk.underline.blue(text),
  linkUrl: text => chalk.dim(text),
  code: text => chalk.cyan(text),
  codeBlock: text => muted(text),
  codeBlockBorder: text => chalk.dim(text),
  quote: text => chalk.dim(text),
  quoteBorder: text => chalk.dim(text),
  hr: text => chalk.dim(text),
  listBullet: text => accent(text),
  bold: text => chalk.bold(text),
  italic: text => chalk.italic(text),
  strikethrough: text => chalk.strikethrough(text),
  underline: text => chalk.underline(text),
  highlightCode: (code, lang) => highlightCode(code, lang),
}

/** Markdown formatting for reasoning; its view supplies the muted base color. */
export const reasoningMarkdownTheme: MarkdownTheme = {
  ...markdownTheme,
  italic: text => chalk.italic.dim(text),
}

/** Picker styles: brand-red selection glyph, bold selected row, dim descriptions and scroll state. */
export const selectListTheme: SelectListTheme = {
  selectedPrefix: _text => accent('❯ '),
  selectedText: text => chalk.bold.white(text),
  description: text => chalk.dim(text),
  scrollInfo: text => chalk.dim(text),
  noMatch: text => chalk.dim(text),
}

/** Input-editor chrome: dim border and the shared select-list styles. */
export const editorTheme: EditorTheme = {
  borderColor: text => chalk.dim(text),
  selectList: selectListTheme,
}

/** Style helpers for transcript chrome: prompt glyphs, thinking and tool labels, status bar, queue, and spinner. */
export const style = {
  accent,
  muted,
  userPrefix: (_text: string) => accent('› '),
  userText: (text: string) => chalk.bold(text),
  thinkingLabel: (text: string) => chalk.dim.italic(text),
  toolName: (text: string) => chalk.cyan.bold(text),
  toolOk: (text: string) => chalk.green(text),
  toolError: (text: string) => chalk.red(text),
  toolBorder: (text: string) => chalk.dim(text),
  toolArgs: (text: string) => chalk.dim(text),
  toolResult: (text: string) => muted(text),
  statusBar: (text: string) => chalk.dim(text),
  queueHeader: (text: string) => chalk.yellow(text),
  queueItem: (text: string) => chalk.italic(text),
  spinner: (text: string) => chalk.hex(BRAND_RED)(text),
  workingLabel: (text: string) => chalk.dim(text),
}
