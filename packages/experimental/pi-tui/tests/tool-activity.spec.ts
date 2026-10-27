import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TuiAltScreen, visibleWidth, type Terminal } from '@earendil-works/pi-tui'
import type { ActivityEntry } from '../src/core/activity.ts'
import type { ToolCardStatus } from '../src/core/model.ts'
import { ToolActivityPane } from '../src/ui/tool-activity.ts'

function call(id: number, status: ToolCardStatus = 'running'): ActivityEntry {
  return {
    seq: id, key: `tool:${id}`, category: 'Tool', label: `tool_${id}`,
    detail: '{"command":"Get-Date"}', time: Date.now(), status,
    ...(status === 'running' ? {} : { endedAt: Date.now() + 1500 }),
    tool: {
      callId: String(id), name: `tool_${id}`, status,
      argsPreview: '{"command":"Get-Date"}',
      ...(status === 'running' ? {} : { resultFull: status === 'error' ? 'Error: command failed'
        : status === 'rejected' ? 'Approval rejected' : 'exit code: 0\nfull output' }),
      ...(status === 'error' ? { errorText: 'command failed' } : {}),
    },
  }
}

function fixture(pane: ToolActivityPane, width = 46, rows = 100) {
  const start = vi.fn<Terminal['start']>()
  const terminal: Terminal = {
    columns: width, rows, kittyProtocolActive: false,
    start, stop: () => {}, drainInput: async () => {}, write: () => {},
    moveBy: () => {}, hideCursor: () => {}, showCursor: () => {}, clearLine: () => {},
    clearFromCursor: () => {}, clearScreen: () => {}, setTitle: () => {}, setProgress: () => {},
  }
  const tui = new TuiAltScreen(terminal)
  tui.setLayoutRoot(pane)
  tui.start()
  const frame = (): string => {
    tui.renderNow()
    return stripVTControlCharacters(tui.getScreenLines().join('\n')).trimEnd()
  }
  const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
  return { tui, terminal, frame, input }
}

function text(pane: ToolActivityPane, width = 46): string {
  const { tui, frame } = fixture(pane, width)
  try { return frame() } finally { tui.stop() }
}

describe('agent tool activity', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('shows call arguments and lifecycle states, then clears with the transcript', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    const pane = new ToolActivityPane()
    expect(text(pane)).toContain('No activity yet. Send a task in chat.')
    pane.update((['running', 'ok', 'error', 'rejected'] as const).map((status, id) => call(id, status)))
    expect(text(pane)).toMatchSnapshot('tool states and command previews')
    pane.update([])
    expect(text(pane)).toContain('No activity yet.')
    expect(text(pane)).not.toContain('Get-Date')
  })

  it('renders the bounded timeline in order', () => {
    const pane = new ToolActivityPane()
    pane.update([
      ...Array.from({ length: 20 }, (_, id) => call(id + 3)),
    ])
    const output = text(pane)
    expect(output).not.toMatch(/tool_[012]\b/)
    expect(output.match(/\[RUNNING\]/g)).toHaveLength(20)
    expect(output.indexOf('tool_3')).toBeLessThan(output.indexOf('tool_22'))
  })

  it('follows new calls and lets the mouse wheel review earlier entries', () => {
    const pane = new ToolActivityPane()
    const items = Array.from({ length: 10 }, (_, id) => call(id))
    pane.update(items)
    const { tui, frame, input } = fixture(pane, 46, 8)
    try {
      expect(frame()).toContain('tool_9')
      pane.update([...items, call(10)])
      expect(frame()).toContain('tool_10')
      for (let index = 0; index < 4; index++) input('\x1b[<64;2;3M')
      expect(frame()).not.toContain('tool_10')
      expect(frame()).toContain('Agent Debug')
    } finally { tui.stop() }
  })

  it('expands details with mouse or keyboard and preserves them through updates', () => {
    const pane = new ToolActivityPane()
    const row = call(0, 'ok')
    pane.update([row])
    const { tui, frame, input } = fixture(pane, 46, 14)
    tui.setFocus(pane)
    try {
      expect(frame()).not.toContain('full output')
      input('\r')
      expect(frame()).toContain('full output')
      expect(frame()).toMatchSnapshot('expanded activity')
      pane.update([row])
      expect(frame()).toContain('full output')
      input('\x1b[<0;2;2M')
      input('\x1b[<0;2;2m')
      expect(frame()).not.toContain('full output')
      pane.update([call(1)])
      input('\x1b[A')
      input('\r')
      expect(frame()).toContain('tool_1')
      expect(frame()).not.toContain('tool_0')
    } finally { tui.stop() }
  })

  it('measures elapsed time from event timestamps and freezes it after settlement', () => {
    const pane = new ToolActivityPane()
    const row = call(0)
    row.time = 1000
    pane.update([row])
    const now = vi.spyOn(Date, 'now').mockReturnValue(3500)
    expect(text(pane)).toContain('2.5s')
    row.endedAt = 4000
    now.mockReturnValue(10000)
    expect(text(pane)).toContain('3.0s')
  })

  it('removes terminal controls from operation labels and details', () => {
    const pane = new ToolActivityPane()
    const row = call(0)
    row.label = '\x1b]52;c;clipboard\x07tool'
    row.detail = '\x1b[2Jdetails'
    pane.update([row])
    pane.handleInput('\r')
    expect(text(pane)).toContain('details')
    expect(text(pane)).not.toContain('clipboard')
  })

  it('shows different event categories in one timeline', () => {
    const pane = new ToolActivityPane()
    const categories = ['Agent', 'Shell', 'MCP', 'File', 'Approval', 'Retry'] as const
    const statuses = ['running', 'ok', 'error', 'changed', 'waiting', 'retry'] as const
    pane.update(categories.map((category, index) => ({
      seq: index, key: String(index), category, status: statuses[index]!, label: category === 'File' ? 'src/chat.ts' : 'operation',
      detail: 'Recorded event details', time: 1000, endedAt: 2500,
    })))
    expect(text(pane)).toMatchSnapshot('one timeline with multiple statuses')
  })

  it('bounds expanded output and lets the keyboard scroll within it', () => {
    const pane = new ToolActivityPane()
    const row = call(0, 'ok')
    if (row.tool !== undefined) row.tool.resultFull = 'output line\n'.repeat(2000)
    pane.update([row])
    const { tui, frame, input } = fixture(pane, 46, 10)
    tui.setFocus(pane)
    try {
      frame()
      input('\r')
      expect(frame()).toContain('[OK]')
      input('\x1b[6~')
      expect(frame()).not.toContain('[OK]')
      input('\x1b[5~')
      expect(frame()).toContain('[OK]')
    } finally { tui.stop() }
    // A viewport taller than the content must not lift the expanded-output bound.
    const tall = new ToolActivityPane()
    tall.update([row])
    const tallFixture = fixture(tall, 46, 2000)
    tallFixture.tui.setFocus(tall)
    try {
      tallFixture.input('\r')
      const output = tallFixture.frame()
      expect(output).toContain('details truncated')
      expect(output.match(/output line/g)!.length).toBeLessThan(2000)
    } finally { tallFixture.tui.stop() }
  })

  it.each([46, 30, 10, 1])('wraps long Unicode arguments within %i columns', (width) => {
    const pane = new ToolActivityPane()
    const item = call(0)
    if (item.tool !== undefined) item.tool.argsPreview = '測試คำสั่ง'.repeat(30)
    pane.update([item])
    expect(text(pane, width).split('\n').every(line => visibleWidth(line) <= width)).toBe(true)
  })
})
