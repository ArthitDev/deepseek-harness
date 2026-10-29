/** Single scrollable Agent Debug timeline from session events and live job snapshots. */
import { stripVTControlCharacters } from 'node:util'
import type { JobView } from '@deepseek-ai/dsh-jobs'
import { matchesKey, ScrollView, Text, VStack, type Component } from '@earendil-works/pi-tui'
import type { ActivityEntry } from '../core/activity.js'
import type { TargetUrl } from '../core/targets.js'
import { TargetsPane } from './targets-pane.js'
import { style } from './theme.js'

/** Recent operations with inline details; observing them never executes commands. */
export class ToolActivityPane extends VStack {
  /** Whether keyboard navigation currently targets this timeline. */
  private active = false
  private readonly targets = new TargetsPane()
  /**
   * Whether keyboard navigation currently targets the pane or its Targets tree.
   * @returns true while the pane holds keyboard focus.
   */
  get focused(): boolean { return this.active }
  set focused(value: boolean) {
    this.active = value
    if (!value) this.targets.focused = false
  }
  private activity: readonly ActivityEntry[] = []
  private jobs: readonly JobView[] = []
  private expanded = new Set<ActivityEntry>()
  private selected: ActivityEntry | undefined
  private rowEntries: (ActivityEntry | undefined)[] = []
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
    this.addChild(this.targets, { basis: 'auto', shrink: 1, maxSize: 10, minSize: 0, visible: () => this.targets.hasUrls })
    this.addChild({
      invalidate: () => {},
      render: width => new Text(style.muted(`── Agent Debug${this.targets.hasUrls ? ' · Tab Targets' : ''} ──`), 0, 0).render(width),
    }, { basis: 'auto' })
    this.scroll = new ScrollView(output, { follow: 'end', overscroll: 'contain' })
    this.addChild(this.scroll, { basis: 0, grow: 1, minSize: 1 })
  }

  /**
   * Display the current session's recent activity without resetting scroll on ordinary updates.
   * @param entries - Bounded rows from the transcript fold, including replayed history.
   * @param jobs - Live registry snapshots for the visible session, independent of tool completion.
   * @param urls - Cached URL observations from committed session events.
   */
  update(entries: readonly ActivityEntry[], jobs: readonly JobView[] = [], urls: readonly TargetUrl[] = []): void {
    this.targets.update(urls)
    const visibleJobs = [
      ...jobs.filter(job => job.status !== 'running' && job.status !== 'stopping').slice(-20),
      ...jobs.filter(job => job.status === 'running' || job.status === 'stopping'),
    ]
    const switched = this.activity !== entries || visibleJobs.some(job => !this.jobs.some(prior => prior.id === job.id))
    this.activity = entries
    this.jobs = visibleJobs
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
    if (matchesKey(data, 'tab') && this.targets.hasUrls) {
      this.targets.focused = !this.targets.focused
    } else if (this.targets.focused) {
      const scroll = this.targets.scroll
      if (matchesKey(data, 'up') || matchesKey(data, 'down')) scroll.scrollBy(matchesKey(data, 'up') ? -1 : 1)
      else if (matchesKey(data, 'pageUp') || matchesKey(data, 'pageDown')) {
        scroll.scrollBy(Math.max(1, scroll.viewportHeight - 1) * (matchesKey(data, 'pageUp') ? -1 : 1))
      } else if (matchesKey(data, 'home')) scroll.scrollToStart()
      else if (matchesKey(data, 'end')) scroll.scrollToEnd()
    } else if (matchesKey(data, 'enter') && this.selected !== undefined) this.toggle(this.selected)
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
    if (this.activity.length === 0 && this.jobs.length === 0) return new Text(style.muted('No activity yet. Send a task in chat.'), 0, 0).render(width)
    const lines: string[] = []
    for (const entry of this.activity) {
      const color = entry.status === 'error' ? style.toolError : entry.status === 'ok' || entry.status === 'changed'
        ? style.toolOk : entry.status === 'running' || entry.status === 'retry' ? style.accent : style.muted
      const elapsed = Math.max(0, ((entry.endedAt ?? Date.now()) - entry.time) / 1000)
      const open = this.expanded.has(entry)
      const clean = (value: string) => stripVTControlCharacters(value)
      const tool = entry.tool
      const body = open ? [entry.detail, tool?.resultFull ?? tool?.resultPreview ?? '', tool?.errorText ?? ''].filter(Boolean).join('\n\n')
        : tool === undefined ? entry.detail.split('\n', 1)[0] ?? ''
          : [tool.argsPreview, tool.errorText ?? tool.resultFull?.split('\n', 1)[0] ?? tool.resultPreview ?? ''].filter(Boolean).join('\n')
      const detail = body.length > 16000 ? `${body.slice(0, 16000)}\n… details truncated.` : body
      const text = [
        `${this.focused && this.selected === entry ? '›' : open ? '−' : '+'} ${color(`[${entry.status.toUpperCase()}]`)} ${entry.category} · ${clean(entry.label)}${entry.category === 'File' ? '' : ` · ${elapsed.toFixed(1)}s`}`,
        ...(detail ? [style.toolArgs(clean(detail))] : []),
      ].join('\n')
      const rendered = new Text(text, 0, 0).render(width)
      lines.push(...rendered, '')
      this.rowEntries.push(...Array<ActivityEntry>(rendered.length + 1).fill(entry))
    }
    for (const job of this.jobs) {
      const color = job.status === 'failed' ? style.toolError : job.status === 'completed' ? style.toolOk
        : job.status === 'running' || job.status === 'stopping' ? style.accent : style.muted
      const elapsed = Math.max(0, ((job.finishedAt ?? Date.now()) - job.startedAt) / 1000)
      const rendered = new Text(`${color(`[${job.status.toUpperCase()}]`)} Job · ${stripVTControlCharacters(job.id)} · ${elapsed.toFixed(1)}s`, 0, 0).render(width)
      lines.push(...rendered)
      this.rowEntries.push(...Array<undefined>(rendered.length).fill(undefined))
    }
    return lines
  }
}
