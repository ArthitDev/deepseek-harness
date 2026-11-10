import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Text, TuiAltScreen, visibleWidth, type Component, type Terminal } from '@earendil-works/pi-tui'
import { JobId, type JobView } from '@deepseek-ai/dsh-jobs'
import type { ActivityEntry } from '../src/core/activity.ts'
import type { ToolCardStatus } from '../src/core/model.ts'
import { ToolActivityPane } from '../src/ui/tool-activity.ts'
import { TargetIndex } from '../src/core/targets.ts'
import { TargetsPane } from '../src/ui/targets-pane.ts'
import { style } from '../src/ui/theme.ts'

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
  const dimensions = { columns: width, rows }
  const terminal: Terminal = {
    get columns() { return dimensions.columns }, get rows() { return dimensions.rows }, kittyProtocolActive: false,
    start, stop: () => {}, drainInput: async () => {}, write: () => {},
    moveBy: () => {}, hideCursor: () => {}, showCursor: () => {}, clearLine: () => {},
    clearFromCursor: () => {}, clearScreen: () => {}, setTitle: () => {}, setProgress: () => {}, setProgramStatus: () => {},
  }
  const tui = new TuiAltScreen(terminal)
  tui.setLayoutRoot(pane)
  tui.start()
  const frame = (): string => {
    tui.renderNow()
    return stripVTControlCharacters(tui.getScreenLines().join('\n')).trimEnd()
  }
  const input = (data: string): void => { start.mock.calls[0]?.[0](data) }
  return { tui, terminal, dimensions, frame, input }
}

function text(pane: ToolActivityPane, width = 46): string {
  const { tui, frame } = fixture(pane, width)
  try { return frame() } finally { tui.stop() }
}

function targetPaneWithUnicodeRows(): TargetsPane {
  const owner: Component & { focused: boolean } = { focused: false, invalidate() {}, render: () => [] }
  const pane = new TargetsPane(owner, () => {})
  const root = 'https://example.test/ไทย/漢字/😀/'
  pane.update([
    { url: root, primary: true },
    { url: `${root}ascii/alpha`, primary: false },
    { url: `${root}ascii/beta/gamma`, primary: false },
    { url: `${root}ไทย/二`, primary: false },
    { url: `${root}漢字/二`, primary: false },
    { url: `${root}emoji/😂`, primary: false },
  ])
  return pane
}

describe('agent tool activity', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('reuses wrapped activity rows while the visible content and width stay unchanged', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    const pane = new ToolActivityPane()
    pane.update(Array.from({ length: 20 }, (_, id) => {
      const row = call(id, 'ok')
      row.tool!.argsPreview = '測試คำสั่ง'.repeat(40)
      return row
    }))
    const { tui, frame } = fixture(pane, 46, 16)
    const render = vi.spyOn(Text.prototype, 'render')
    try {
      const before = frame()
      render.mockClear()
      for (let index = 0; index < 100; index++) expect(frame()).toBe(before)
      expect(render.mock.calls.length).toBeLessThanOrEqual(200)
    } finally { tui.stop() }
  })
  it('refreshes cached rows after in-place changes, expansion, selection and resizing', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3500)
    const pane = new ToolActivityPane()
    const row = call(0)
    row.time = 1000
    pane.update([row])
    const { tui, dimensions, frame } = fixture(pane, 46, 18)
    try {
      expect(frame()).toContain('2.5s')
      now.mockReturnValue(4000)
      expect(frame()).toContain('3.0s')
      row.status = 'error'
      row.label = 'failed operation'
      row.endedAt = 4500
      row.tool!.argsPreview = 'changed arguments'
      row.tool!.errorText = 'changed error'
      row.tool!.resultFull = 'first result line\nchanged full output'
      now.mockReturnValue(9000)
      expect(frame()).toContain('[ERROR]')
      expect(frame()).toContain('failed operation · 3.5s')
      expect(frame()).toContain('changed arguments')
      expect(frame()).toContain('changed error')
      expect(frame()).not.toContain('changed full output')
      pane.focused = true
      expect(frame()).toContain('›')
      pane.handleInput('\r')
      expect(frame()).toContain('changed full output')
      row.tool!.resultFull += '\nnew output'
      expect(frame()).toContain('new output')
      dimensions.columns = 19
      expect(frame().split('\n').every(line => visibleWidth(line) <= 19)).toBe(true)
      dimensions.columns = 46
      expect(frame()).toContain('failed operation · 3.5s')
      pane.focused = false
      expect(frame()).toContain('−')
      expect(frame()).not.toContain('›')
    } finally { tui.stop() }
  })
  it('discards cached rows when the timeline changes sessions', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    const pane = new ToolActivityPane()
    const row = call(0, 'ok')
    pane.update([row])
    const { tui, frame } = fixture(pane)
    const render = vi.spyOn(Text.prototype, 'render')
    try {
      frame()
      pane.update([])
      expect(frame()).toContain('No activity yet.')
      pane.update([row])
      render.mockClear()
      expect(frame()).toContain('tool_0')
      expect(render.mock.calls.length).toBeGreaterThan(1)
    } finally { tui.stop() }
  })
  it('shows Targets above Debug and scrolls the tree independently by keyboard and mouse', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    const pane = new ToolActivityPane()
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/', true)
    index.observe(2, Array.from({ length: 15 }, (_, id) => `https://example.test/path-${id}`).join(' ') + ' https://docs.test/')
    const row = call(0, 'ok')
    pane.update([row], [], index.getSnapshot())
    const { tui, frame, input } = fixture(pane, 46, 18)
    tui.setFocus(pane)
    try {
      expect(frame()).toContain('╭─ Targets')
      expect(frame()).toContain('Target · 1')
      expect(frame()).toContain('tool_0')
      expect(frame().split('\n').map(line => line.trimEnd()).join('\n')).toMatchSnapshot('targets above agent activity')
      input('\t')
      input('\x1b[F')
      expect(frame()).toContain('Other · 1')
      expect(frame()).toContain('https://docs.test/')
      expect(frame()).not.toContain('Target · 1')
      expect(frame()).not.toContain('full output')
      // End selects the last leaf; Home clears the selection so Enter toggles the box.
      input('\x1b[H')
      expect(frame()).toContain('Target · 1')
      input('\r')
      expect(frame()).toContain('Targets ▸')
      input('\r')
      expect(frame()).toContain('Targets ▾')
      expect(frame()).toContain('Target · 1')
      input('\x1b[6~')
      expect(frame()).not.toContain('Target · 1')
      input('\x1b[5~')
      input('\x1b[B')
      input('\x1b[A')
      expect(frame()).toContain('Target · 1')
      for (let step = 0; step < 24; step++) input('\x1b[<65;3;4M')
      expect(frame()).toContain('https://docs.test/')
      input('\t')
      input('\r')
      expect(frame()).toContain('full output')
      const fresh = new TargetIndex()
      fresh.observe(1, 'https://next.test/', true)
      pane.update([], [], fresh.getSnapshot())
      expect(frame()).toContain('https://next.test/')
      pane.update([])
      expect(frame()).not.toContain('Targets')
    } finally { tui.stop() }
  })

  it('preserves complete Target rows across narrow widths and avoids redundant wide clipping', () => {
    const pane = targetPaneWithUnicodeRows()
    const widths = [0, 1, 2, 3, 4, 5, 6, 46]
    const fullRows: Record<string, string[]> = {}
    const capture = (state: string): void => {
      for (const width of widths) fullRows[`${state}, width ${width}`] = pane.render(width)
    }

    const muted = vi.spyOn(style, 'muted').mockImplementation(value => `\x1b[90m${value}\x1b[39m`)
    const toolName = vi.spyOn(style, 'toolName').mockImplementation(value => `\x1b[36;1m${value}\x1b[39;22m`)
    const accent = vi.spyOn(style, 'accent').mockImplementation(value => `\x1b[31m${value}\x1b[39m`)
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      capture('unfocused')
      pane.focused = true
      pane.handleInput('\x1b[B')
      pane.handleInput('\x1b[B')
      capture('selected')
      pane.handleInput('\r')
      capture('collapsed')
      pane.handleInput('\r')
      capture('expanded')
      expect(fullRows).toMatchSnapshot('complete Target rows across widths and states')

      segment.mockClear()
      const measuredPane = targetPaneWithUnicodeRows()
      measuredPane.render(46)
      const borderedRuns = segment.mock.calls.filter(([value]) => value === '│').length
      expect(borderedRuns).toBe(0)
    } finally {
      segment.mockRestore()
      accent.mockRestore()
      toolName.mockRestore()
      muted.mockRestore()
    }
  })

  it('reuses rendered Target rows while the URL snapshot and render state stay unchanged', () => {
    const pane = new ToolActivityPane()
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/根', true)
    index.observe(2, Array.from({ length: 24 }, (_, id) => `https://example.test/根/段-${id}/葉`).join(' '))
    pane.update([], [], index.getSnapshot())
    const { tui, dimensions, frame, input } = fixture(pane, 100, 35)
    const renderRow = vi.spyOn(style, 'toolName')
    const renderSelected = vi.spyOn(style, 'accent')
    try {
      const before = frame()
      expect(renderRow).toHaveBeenCalled()
      renderRow.mockClear()
      for (let iteration = 0; iteration < 5; iteration++) expect(frame()).toBe(before)
      expect(renderRow).not.toHaveBeenCalled()

      dimensions.columns = 80
      expect(frame()).not.toBe(before)
      expect(renderRow).toHaveBeenCalled()
      renderRow.mockClear()
      tui.setFocus(pane)
      input('\t')
      input('\x1b[B')
      expect(frame()).toContain('›')
      expect(renderRow).toHaveBeenCalled()

      renderRow.mockClear()
      renderSelected.mockClear()
      input('\r')
      expect(frame()).not.toContain('%E6%AE%B5-0')
      expect(renderSelected).toHaveBeenCalled()
      input('\r')
      expect(frame()).toContain('%E6%AE%B5-0')

      renderRow.mockClear()
      const reordered = [...index.getSnapshot()]
      const root = reordered.shift()!
      pane.update([], [], [root, ...reordered.reverse()])
      const reorderedFrame = frame()
      expect(reorderedFrame).toContain('%E6%AE%B5-23')
      expect(renderRow).toHaveBeenCalled()

      pane.update([], [], [])
      expect(frame()).not.toContain('Targets')
      pane.update([], [], index.getSnapshot())
      renderRow.mockClear()
      expect(frame()).toContain('https://example.test/')
      expect(renderRow).toHaveBeenCalled()
    } finally { tui.stop() }
  })

  it.each([46, 15, 2, 1])('keeps the Targets frame within %i columns', (width) => {
    const pane = new ToolActivityPane()
    pane.update([], [], [{ url: `https://example.test/${'คำ'.repeat(40)}`, primary: true }])
    expect(text(pane, width).split('\n').every(line => visibleWidth(line) <= width)).toBe(true)
  })

  it('collapses the whole Targets box by mouse and reopens it from the focused header', () => {
    const pane = new ToolActivityPane()
    pane.update([call(0, 'ok')], [], [{ url: 'https://example.test/', primary: true }])
    const { tui, frame, input } = fixture(pane, 64, 18)
    try {
      const debugRow = () => frame().split('\n').findIndex(line => line.includes('Agent Debug'))
      const expandedHeight = debugRow()
      input('\x1b[<0;4;1M')
      input('\x1b[<0;4;1m')
      expect(frame()).toContain('Targets ▸')
      expect(frame()).not.toContain('https://example.test/')
      expect(frame()).toContain('tool_0')
      expect(debugRow()).toBe(1)
      expect(tui.getFocusedComponent()).toBe(pane)
      input('\r')
      expect(frame()).toContain('Targets ▾')
      expect(frame()).toContain('https://example.test/')
      expect(debugRow()).toBe(expandedHeight)
      expect(frame()).not.toContain('full output')
      input(' ')
      expect(frame()).not.toContain('https://example.test/')
      input('\x1b[C')
      expect(frame()).toContain('https://example.test/')
      input('\t')
      input('\r')
      expect(frame()).toContain('full output')
    } finally { tui.stop() }
  })

  it('collapses each header independently and retains hidden summary updates', () => {
    const pane = new ToolActivityPane()
    const entries = [call(0, 'ok')]
    const urls = [{ url: 'https://example.test/', primary: true }]
    pane.update(entries, [], urls, 'task: inspect the service · elapsed: 1.0s')
    const { tui, frame, input } = fixture(pane, 64, 18)
    const click = (label: string): void => {
      const y = frame().split('\n').findIndex(line => line.includes(label))
      expect(y).toBeGreaterThanOrEqual(0)
      input(`\x1b[<0;4;${y + 1}M`)
      input(`\x1b[<0;4;${y + 1}m`)
    }
    try {
      const expandedRow = frame().split('\n').findIndex(line => line.includes('tool_0'))
      click('Main Agent ▾')
      expect(frame()).toContain('Main Agent ▸')
      expect(frame()).not.toContain('task: inspect')
      expect(frame()).toContain('https://example.test/')
      expect(frame().split('\n').findIndex(line => line.includes('tool_0'))).toBeLessThan(expandedRow)
      expect(tui.getFocusedComponent()).toBe(pane)
      click('Targets ▾')
      expect(frame()).toContain('Targets ▸')
      expect(frame()).toContain('Main Agent ▸')
      expect(frame()).not.toContain('https://example.test/')
      pane.update(entries, [], [...urls, { url: 'https://example.test/api/v1', primary: false }],
        'task: latest summary · elapsed: 2.0s')
      expect(frame()).toContain('Main Agent ▸')
      expect(frame()).not.toContain('latest summary')
      click('Main Agent ▸')
      expect(frame()).toContain('latest summary')
      expect(frame()).toContain('Targets ▸')
      click('Targets ▸')
      expect(frame()).toContain('https://example.test/')
      expect(frame()).toContain('latest summary')
      input('\r')
      expect(frame()).toContain('Targets ▸')
      expect(frame()).toContain('latest summary')
    } finally { tui.stop() }
  })

  it('cycles keyboard focus through Targets, Main Agent and activity', () => {
    const pane = new ToolActivityPane()
    const entries = [call(0, 'ok')]
    pane.update(entries, [], [{ url: 'https://example.test/', primary: true }], 'task: keyboard controls')
    const { tui, frame, input } = fixture(pane, 64, 18)
    tui.setFocus(pane)
    try {
      input('\t')
      input('\r')
      expect(frame()).toContain('Targets ▸')
      input('\t')
      input(' ')
      expect(frame()).toContain('Main Agent ▸')
      expect(frame()).not.toContain('task: keyboard')
      input('\x1b[C')
      expect(frame()).toContain('task: keyboard')
      input('\x1b[D')
      expect(frame()).not.toContain('task: keyboard')
      input('\t')
      input('\r')
      expect(frame()).toContain('full output')
      expect(frame()).toContain('Main Agent ▸')
      pane.update(entries, [], [], 'task: no targets')
      input('\t')
      input('\r')
      expect(frame()).toContain('task: no targets')
      pane.update(entries)
      input('\r')
      expect(frame()).not.toContain('full output')
      expect(frame()).not.toContain('Main Agent')
    } finally { tui.stop() }
  })

  it('drags each bottom border independently and retains its height across collapse and updates', () => {
    const pane = new ToolActivityPane()
    const urls = [{ url: 'https://example.test/', primary: true },
      ...Array.from({ length: 30 }, (_, id) => ({ url: `https://example.test/path-${id}`, primary: false }))]
    const entries = Array.from({ length: 20 }, (_, id) => call(id, 'ok'))
    const summary = Array.from({ length: 20 }, (_, id) => `summary line ${id}`).join('\n')
    pane.update(entries, [], urls, summary)
    const { tui, dimensions, frame, input } = fixture(pane, 64, 40)
    const lines = () => frame().split('\n')
    const bounds = (label: string): [number, number] => {
      const rows = lines()
      const top = rows.findIndex(line => line.includes(label))
      const bottom = rows.findIndex((line, y) => y > top && line.includes('↕'))
      expect(top).toBeGreaterThanOrEqual(0)
      expect(bottom).toBeGreaterThan(top)
      return [top, bottom]
    }
    const height = (label: string) => { const [top, bottom] = bounds(label); return bottom - top + 1 }
    const drag = (label: string, delta: number) => {
      const [, y] = bounds(label)
      input(`\x1b[<0;30;${y + 1}M`)
      frame()
      input(`\x1b[<32;30;${y + delta + 1}M`)
      frame()
      input(`\x1b[<0;30;${y + delta + 1}m`)
      frame()
      expect(tui.hasActiveSelection()).toBe(false)
    }
    try {
      const targetHeight = height('Targets')
      const summaryHeight = height('Main Agent')
      drag('Main Agent', -5)
      expect(height('Main Agent')).toBe(summaryHeight - 5)
      expect(height('Targets')).toBe(targetHeight)
      drag('Targets', 4)
      expect(height('Targets')).toBe(targetHeight + 4)
      expect(height('Main Agent')).toBe(summaryHeight - 5)
      expect(frame()).toContain('tool_19')
      const [y] = bounds('Targets')
      input(`\x1b[<0;4;${y + 1}M`)
      input(`\x1b[<0;4;${y + 1}m`)
      expect(frame()).toContain('Targets ▸')
      input('\r')
      expect(height('Targets')).toBe(targetHeight + 4)
      pane.update(entries, [], [...urls], `${summary}\nlatest update`)
      expect(height('Targets')).toBe(targetHeight + 4)
      expect(height('Main Agent')).toBe(summaryHeight - 5)
      expect(lines().map(line => line.trimEnd()).join('\n')).toMatchSnapshot('independently resized debug boxes')
      drag('Targets', -12)
      expect(height('Targets')).toBe(3)
      drag('Targets', 30)
      expect(bounds('Main Agent')[1]).toBeLessThan(39)
      drag('Targets', -4)
      expect(frame()).toContain('tool_19')
      dimensions.rows = 10
      expect(lines().length).toBeLessThanOrEqual(10)
      expect(lines().every(line => visibleWidth(line) <= 64)).toBe(true)
    } finally { tui.stop() }
  })

  it('resizes focused panels with Shift arrows and scrolls a shortened Main Agent box', () => {
    const pane = new ToolActivityPane()
    pane.update([], [], [{ url: 'https://example.test/', primary: true },
      ...Array.from({ length: 12 }, (_, id) => ({ url: `https://example.test/path-${id}`, primary: false }))],
    Array.from({ length: 20 }, (_, id) => `summary line ${id}`).join('\n'))
    const { tui, frame, input } = fixture(pane, 64, 40)
    tui.setFocus(pane)
    try {
      frame()
      input('\t')
      input('\x1b[1;2B')
      expect(frame().split('\n').findIndex(line => line.includes('Agent Debug'))).toBe(11)
      input('\t')
      for (let step = 0; step < 10; step++) { input('\x1b[1;2A'); frame() }
      expect(frame()).toContain('summary line 0')
      expect(frame()).not.toContain('summary line 19')
      input('\x1b[F')
      expect(frame()).toContain('summary line 19')
      expect(frame()).not.toContain('summary line 0')
      input('\x1b[H')
      expect(frame()).toContain('summary line 0')
      const summaryRow = frame().split('\n').findIndex(line => line.includes('summary line 0'))
      input(`\x1b[<65;3;${summaryRow + 1}M`)
      expect(frame()).not.toContain('summary line 0')
    } finally { tui.stop() }
  })

  it.each([64, 30, 10, 1])('bounds both boxes at %i columns in a short pane', (width) => {
    const pane = new ToolActivityPane()
    pane.update([call(0, 'ok')], [], [{ url: 'https://example.test/', primary: true }],
      `task: ${'ตรวจระบบ漢字'.repeat(20)}`)
    const { tui, frame, input } = fixture(pane, width, 6)
    tui.setFocus(pane)
    try {
      const bounded = (): void => {
        const lines = frame().split('\n')
        expect(lines.length).toBeLessThanOrEqual(6)
        expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
      }
      bounded()
      input('\t')
      input('\r')
      input('\t')
      input('\r')
      bounded()
      if (width >= 30) {
        expect(frame()).toContain('Targets ▸')
        expect(frame()).toContain('Main Agent ▸')
      }
    } finally { tui.stop() }
  })

  it('keeps collapsed branches through URL updates and navigates their parents with arrow keys', () => {
    const pane = new ToolActivityPane()
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/', true)
    index.observe(2, 'https://example.test/api/v1 https://example.test/api/v2')
    pane.update([], [], index.getSnapshot())
    const { tui, frame, input } = fixture(pane, 64, 18)
    tui.setFocus(pane)
    try {
      frame()
      input('\t')
      input('\x1b[B')
      input('\x1b[C')
      input('\x1b[C')
      input('\r')
      expect(frame()).toContain('▸ Sub Target · 2')
      expect(frame()).not.toContain('v1')
      index.observe(3, 'https://example.test/new/v3')
      pane.update([], [], index.getSnapshot())
      expect(frame()).toContain('▸ Sub Target · 3')
      expect(frame()).not.toContain('v3')
      expect(frame().split('\n').map(line => line.trimEnd()).join('\n')).toMatchSnapshot('collapsed sub target after discovery')
      input(' ')
      expect(frame()).toContain('v1')
      expect(frame()).toContain('v3')
      input('\x1b[C')
      input('\x1b[D')
      expect(frame()).toContain('▸ api')
      expect(frame()).not.toContain('v1')
      expect(frame()).toContain('v3')
      input('\x1b[D')
      input('\x1b[D')
      expect(frame()).not.toContain('v3')
      input('\x1b[D')
      input('\x1b[D')
      expect(frame()).not.toContain('Sub Target')
      input('\x1b[C')
      expect(frame()).toContain('▸ Sub Target')
      input('\x1b[C')
      input('\x1b[C')
      expect(frame()).toContain('▸ api')
      expect(frame()).toContain('v3')
      pane.update([])
      expect(frame()).not.toContain('Targets')
      pane.update([], [], index.getSnapshot())
      expect(frame()).toContain('v1')
    } finally { tui.stop() }
  })

  it('toggles nested branches by mouse without collapsing siblings', () => {
    const pane = new ToolActivityPane()
    const index = new TargetIndex()
    index.observe(1, 'https://example.test/', true)
    index.observe(2, 'https://example.test/api/v1 https://example.test/other/v2')
    pane.update([], [], index.getSnapshot())
    const { tui, frame, input } = fixture(pane, 64, 18)
    const click = (label: string) => {
      const y = frame().split('\n').findIndex(line => line.includes(label))
      expect(y).toBeGreaterThanOrEqual(0)
      input(`\x1b[<0;8;${y + 1}M`)
      input(`\x1b[<0;8;${y + 1}m`)
    }
    try {
      click('▾ api')
      expect(frame()).toContain('▸ api')
      expect(frame()).not.toContain('v1')
      expect(frame()).toContain('v2')
      click('▸ api')
      expect(frame()).toContain('v1')
      click('Sub Target')
      expect(frame()).not.toContain('v1')
      expect(frame()).not.toContain('v2')
      click('Sub Target')
      expect(frame()).toContain('v1')
      expect(frame()).toContain('v2')
      click('▾ api')
      input('\r')
      expect(frame()).toContain('v1')
      index.observe(3, Array.from({ length: 9 }, (_, id) => `https://example.test/path-${id}/item-${id}`).join(' '))
      pane.update([], [], index.getSnapshot())
      frame()
      input('\x1b[F')
      expect(frame()).toContain('item-8')
      click('▾ path-8')
      expect(frame()).not.toContain('item-8')
      expect(frame()).toContain('item-7')
      input('\r')
      expect(frame()).toContain('▾ path-8')
      input('\x1b[C')
      expect(frame()).toContain('item-8')
    } finally { tui.stop() }
  })

  it('keeps every active job and the latest 20 settled statuses without repeating command text', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    const pane = new ToolActivityPane()
    const job = (id: string, status: JobView['status']): JobView => ({
      id: JobId(id), kind: 'any-producer', label: 'do not duplicate this long command', status,
      startedAt: 1000, ...(status === 'running' || status === 'stopping' ? {} : { finishedAt: 1500 }),
      output: { total: 0, earliest: 0 },
    })
    const jobs = [job('old-running', 'running'), ...Array.from({ length: 23 }, (_, id) => job(`finished-${id}`, 'completed')),
      job('old-stopping', 'stopping')]
    pane.update([], jobs)
    const output = text(pane, 100)
    expect(output.match(/\[COMPLETED\]/g)).toHaveLength(20)
    expect(output).toContain('[RUNNING] Job · old-running · 1.0s')
    expect(output).toContain('[STOPPING] Job · old-stopping · 1.0s')
    expect(output).not.toMatch(/finished-[012]\b/)
    expect(output).not.toContain('do not duplicate')
    pane.update([], [])
    expect(text(pane)).toContain('No activity yet.')
  })

  it('renders bounded job and MCP progress without reading job output', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    const pane = new ToolActivityPane()
    const row = call(1)
    row.category = 'MCP'
    row.status = 'executing'
    row.progress = { progress: 3, message: 'working' }
    const job: JobView = {
      id: JobId('subagent-1'), kind: 'subagent', label: 'child', status: 'running',
      progress: 'Inspecting files', startedAt: 1000, output: { total: 4096, earliest: 0 },
    }
    pane.update([row], [job])
    const rendered = text(pane, 28)
    expect(rendered).toContain('Progress 3')
    expect(rendered).toContain('Inspecting files')
    expect(rendered).not.toContain('4096')
    expect(rendered.split('\n').every(line => visibleWidth(line) <= 28)).toBe(true)
  })

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
    pane.update(items, [], [], 'task: inspect service · elapsed: 1.0s')
    const { tui, frame, input } = fixture(pane, 46, 14)
    try {
      expect(frame()).toContain('tool_9')
      const expandedItems = [...items, call(10)]
      pane.update(expandedItems, [], [], 'task: inspect service · elapsed: 2.0s')
      expect(frame()).toContain('tool_10')
      const row = frame().split('\n').findIndex(line => line.includes('tool_10'))
      for (let index = 0; index < 4; index++) input(`\x1b[<64;2;${row + 1}M`)
      expect(frame()).not.toContain('tool_10')
      expect(frame()).toContain('Agent Debug')
      pane.update(expandedItems, [], [], 'task: inspect service · elapsed: 3.0s')
      expect(frame()).not.toContain('tool_10')
      items[8]!.progress = { progress: 3, total: 10, message: 'still running' }
      pane.update(expandedItems, [], [], 'task: inspect service · elapsed: 4.0s')
      expect(frame()).not.toContain('tool_10')
      expect(frame()).toContain('still running')
    } finally { tui.stop() }
  })

  it('maps mouse rows below the fixed Main Agent summary', () => {
    const pane = new ToolActivityPane()
    pane.update([call(0, 'ok'), call(1, 'ok')], [], [], 'task: inspect the service')
    const { tui, frame, input } = fixture(pane, 64, 14)
    tui.setFocus(pane)
    try {
      const row = frame().split('\n').findIndex(line => line.includes('tool_1'))
      expect(row).toBeGreaterThanOrEqual(0)
      input(`\x1b[<0;2;${row + 1}M`)
      input(`\x1b[<0;2;${row + 1}m`)
      expect(frame()).toContain('full output')
      expect(frame()).toContain('task: inspect the service')
    } finally { tui.stop() }
  })

  it('keeps the Main Agent box fixed during keyboard and mouse scrolling and summary updates', () => {
    const pane = new ToolActivityPane()
    const entries = Array.from({ length: 20 }, (_, id) => call(id, 'ok'))
    const urls = [{ url: 'https://example.test/', primary: true }]
    const summary = 'task: ตรวจ service · calls: 20 completed · elapsed: 153.3s · usage: 752 in / 3005 out tokens'
    pane.update(entries, [], urls, summary)
    const { tui, frame, input } = fixture(pane, 64, 22)
    tui.setFocus(pane)
    try {
      const initial = frame().split('\n')
      const summaryStart = initial.findIndex(line => line.includes('Main Agent'))
      const end = initial.findIndex((line, index) => line.startsWith('╰') && index > summaryStart)
      const header = initial.slice(0, end + 1).join('\n')
      expect(header).toContain('Main Agent')
      expect(header).toContain('752 in / 3005 out tokens')
      expect(frame()).toContain('tool_19')
      expect(frame().split('\n').map(line => line.trimEnd()).join('\n')).toMatchSnapshot('fixed summary above scrollable activity')
      pane.handleInput('\x1b[5~')
      expect(frame()).not.toContain('tool_19')
      expect(frame().split('\n').slice(0, end + 1).join('\n')).toBe(header)
      const scrolled = frame().split('\n').slice(end + 1).join('\n')
      pane.update(entries, [], urls, summary.replace('153.3s', '154.3s'))
      expect(frame()).toContain('154.3s')
      expect(frame().split('\n').slice(end + 1).join('\n')).toBe(scrolled)
      const row = frame().split('\n').findIndex(line => line.includes('tool_'))
      input(`\x1b[<64;2;${row + 1}M`)
      expect(frame()).toContain('Main Agent')
      expect(frame()).toContain('154.3s')
      pane.update([], [], urls)
      expect(frame()).not.toContain('Main Agent')
      expect(frame()).toContain('No activity yet.')
    } finally { tui.stop() }
  })

  it.each([64, 30, 10, 1])('fits the fixed summary and timeline within %i columns', (width) => {
    const pane = new ToolActivityPane()
    pane.update([call(0, 'ok')], [], [], 'task: ตรวจระบบ漢字 · elapsed: 1.0s · calls: 1 completed')
    const { tui, frame } = fixture(pane, width, 16)
    try {
      const lines = frame().split('\n')
      expect(lines.length).toBeLessThanOrEqual(16)
      expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
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
