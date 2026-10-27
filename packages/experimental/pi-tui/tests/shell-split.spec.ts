import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { Text, TuiAltScreen, visibleWidth, type Terminal } from '@earendil-works/pi-tui'
import { ShellSplit } from '../src/ui/shell-split.ts'

function fixture() {
  const start = vi.fn<Terminal['start']>()
  const terminal = {
    columns: 100, rows: 5, kittyProtocolActive: false,
    start, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(),
    moveBy: vi.fn(), hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(),
    clearFromCursor: vi.fn(), clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(),
  } satisfies Terminal
  const tui = new TuiAltScreen(terminal)
  const split = new ShellSplit(new Text('chat', 0, 0), new Text('shell', 0, 0), tui)
  tui.setLayoutRoot(split)
  tui.start()
  const frame = (): string[] => {
    tui.renderNow()
    return tui.getScreenLines().map(line => stripVTControlCharacters(line))
  }
  const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
  return { terminal, tui, split, frame, input }
}

describe('the chat/shell divider', () => {
  it('captures a drag across panes and releases it without selecting text', () => {
    const { tui, frame, input } = fixture()
    try {
      expect(frame()).toMatchSnapshot('open split')
      expect(frame()[0]?.indexOf('shell')).toBe(54)
      input('\x1b[<0;53;3M')
      input('\x1b[<32;43;3M')
      expect(frame()[0]?.indexOf('shell')).toBe(44)
      expect(frame()).toMatchSnapshot('dragging left')
      expect(tui.hasActiveSelection()).toBe(false)
      input('\x1b[<0;43;3m')
      expect(frame()[0]).toContain('│')
      input('\x1b[<32;40;3M')
      expect(frame()[0]?.indexOf('shell')).toBe(44)
    } finally { tui.stop() }
  })

  it('shows both columns immediately and remembers their width across terminal resize', () => {
    const { terminal, tui, split, frame } = fixture()
    try {
      expect(frame()[0]?.indexOf('shell')).toBe(54)
      split.resize(-1000)
      expect(frame()[0]?.indexOf('shell')).toBe(33)
      split.resize(1000)
      expect(frame()[0]?.indexOf('shell')).toBe(70)
      split.resize(-12)
      expect(frame()[0]?.indexOf('shell')).toBe(58)
      split.setOpen(false)
      expect(frame().join('\n')).not.toMatch(/shell|│|↔/)
      split.resize(-10)
      split.setOpen(true)
      expect(frame()[0]?.indexOf('shell')).toBe(58)
      terminal.columns = 60
      expect(frame()[0]?.indexOf('shell')).toBe(31)
      terminal.columns = 100
      expect(frame()[0]?.indexOf('shell')).toBe(58)
    } finally { tui.stop() }
  })

  it.each([100, 63, 60, 40, 3, 2, 1])('keeps the rendered split inside a %i-column terminal', (columns) => {
    const { terminal, tui, frame } = fixture()
    try {
      terminal.columns = columns
      const lines = frame()
      expect(lines).toHaveLength(terminal.rows)
      expect(lines.every(line => visibleWidth(line) <= columns)).toBe(true)
      if (columns >= 40) expect(lines.join('\n')).toContain('shell')
    } finally { tui.stop() }
  })
})
