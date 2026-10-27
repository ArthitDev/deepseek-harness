/** Single scrollable Agent Debug timeline, derived from session events. */
import { stripVTControlCharacters } from 'node:util'
import { matchesKey, ScrollView, Text, VStack, type Component } from '@earendil-works/pi-tui'
import type { ActivityEntry } from '../core/activity.js'
import { style } from './theme.js'

/** Recent operations with inline details; observing them never executes commands. */
export class ToolActivityPane extends VStack {
  /** Whether keyboard navigation currently targets this timeline. */
  focused = false
  private activity: readonly ActivityEntry[] = []
  private expanded = new Set<ActivityEntry>()
  private selected: ActivityEntry | undefined
  private rowEntries: ActivityEntry[] = []
  private readonly scroll: ScrollView

  constructor() {
    super()
    const output: Component = {
      invalidate: () => {},
      render: width => this.renderEntries(width),
      handleMouse: (event) => {
        if (event.type !== 'press' || event.button !== 'left') return undefined
        const entry = this.rowEntries[event.y]
        if (entry === undefined) return undefined
        this.selected = entry
        this.toggle(entry)
        return { handled: true }
      },
    }
    this.addChild(new Text(style.muted('── Agent Debug ──'), 0, 0), { basis: 'auto' })
    this.scroll = new ScrollView(output, { follow: 'end', overscroll: 'contain' })
    this.addChild(this.scroll, { basis: 0, grow: 1, minSize: 1 })
  }

  /**
   * Display the current session's recent activity without resetting scroll on ordinary updates.
   * @param entries - Bounded rows from the transcript fold, including replayed history.
   */
  update(entries: readonly ActivityEntry[]): void {
    const switched = this.activity !== entries
    this.activity = entries
    this.expanded = new Set([...this.expanded].filter(entry => entries.includes(entry)))
    if (this.selected === undefined || !entries.includes(this.selected) || (!this.focused && this.scroll.isFollowingEnd)) {
      this.selected = entries.at(-1)
    }
    if (switched) this.scroll.scrollToEnd()
  }

  /**
   * Navigate operations or toggle the selected operation's inline details.
   * @param data - Raw terminal key input routed to this focused pane.
   */
  handleInput(data: string): void {
    if (matchesKey(data, 'enter') && this.selected !== undefined) this.toggle(this.selected)
    else if (matchesKey(data, 'pageUp') || matchesKey(data, 'pageDown')) {
      this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight - 1) * (matchesKey(data, 'pageUp') ? -1 : 1))
    } else if (matchesKey(data, 'up') || matchesKey(data, 'down')) {
      const index = this.selected === undefined ? 0 : this.activity.indexOf(this.selected)
      this.selected = this.activity[Math.max(0, Math.min(this.activity.length - 1,
        index + (matchesKey(data, 'up') ? -1 : 1)))]
      const row = this.selected === undefined ? -1 : this.rowEntries.indexOf(this.selected)
      if (row >= 0 && row < this.scroll.scrollTop) this.scroll.scrollTo(row)
      else if (row >= this.scroll.scrollTop + this.scroll.viewportHeight) {
        this.scroll.scrollTo(row - this.scroll.viewportHeight + 1)
      }
    }
  }

  private toggle(entry: ActivityEntry): void {
    if (this.expanded.has(entry)) this.expanded.delete(entry)
    else this.expanded.add(entry)
    const row = this.rowEntries.indexOf(entry)
    if (row >= 0) this.scroll.scrollTo(row, { disableFollow: true })
  }

  private renderEntries(width: number): string[] {
    this.rowEntries = []
    if (this.activity.length === 0) return new Text(style.muted('No activity yet. Send a task in chat.'), 0, 0).render(width)
    const lines: string[] = []
    for (const entry of this.activity) {
      const color = entry.status === 'error' ? style.toolError : entry.status === 'ok' || entry.status === 'changed'
        ? style.toolOk : entry.status === 'running' || entry.status === 'retry' ? style.accent : style.muted
      const elapsed = Math.max(0, ((entry.endedAt ?? Date.now()) - entry.time) / 1000)
      const open = this.expanded.has(entry)
      const clean = (value: string) => stripVTControlCharacters(value)
      const tool = entry.tool
      const body = open ? [entry.detail, tool?.resultFull ?? tool?.resultPreview ?? '', tool?.errorText ?? ''].filter(Boolean).join('\n\n')
        : tool === undefined ? entry.detail.split('\n')[0] ?? ''
          : [tool.argsPreview, tool.errorText ?? tool.resultFull?.split('\n')[0] ?? tool.resultPreview ?? ''].filter(Boolean).join('\n')
      const detail = body.length > 16000 ? `${body.slice(0, 16000)}\n… details truncated.` : body
      const text = [
        `${this.focused && this.selected === entry ? '›' : open ? '−' : '+'} ${color(`[${entry.status.toUpperCase()}]`)} ${entry.category} · ${clean(entry.label)}${entry.category === 'File' ? '' : ` · ${elapsed.toFixed(1)}s`}`,
        ...(detail ? [style.toolArgs(clean(detail))] : []),
      ].join('\n')
      const rendered = new Text(text, 0, 0).render(width)
      lines.push(...rendered, '')
      this.rowEntries.push(...Array<ActivityEntry>(rendered.length + 1).fill(entry))
    }
    return lines
  }
}
