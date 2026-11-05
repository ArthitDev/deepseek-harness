/** Resizable chat/activity columns using pi-tui's layout and mouse capture. */
import { HStack, type Component, type ViewportTUI } from '@earendil-works/pi-tui'
import { LAYOUT_NODE, type StackLayoutNode } from '@earendil-works/pi-tui/dist/layout-node.js'
import { style } from './theme.js'

/** Chat and activity share the viewport, with an optional shell below activity. */
export class ShellSplit extends HStack {
  private open = true
  private preferredColumns = 46
  private drag: { x: number; columns: number } | undefined
  private readonly divider: Component

  /**
   * @param chat - the chat column, including its editor and status bar.
   * @param pane - activity column containing the optional shell.
   * @param tui - fullscreen renderer providing terminal dimensions and redraws.
   */
  constructor(chat: Component, pane: Component, private readonly tui: ViewportTUI) {
    super()
    this.divider = {
      invalidate: () => {},
      render: width => Array.from({ length: this.tui.terminal.rows }, (_, row) => {
        const middle = row === Math.floor(this.tui.terminal.rows / 2)
        const glyph = middle ? '↔' : this.drag === undefined ? '│' : '┃'
        const line = glyph.padStart(Math.floor((width + 1) / 2)).padEnd(width)
        return this.drag === undefined ? style.muted(line) : style.accent(line)
      }),
      handleMouse: (event) => {
        if (event.type === 'press' && event.button === 'left') {
          this.drag = { x: event.screenX, columns: this.columns() }
          return { capture: true }
        }
        if (this.drag === undefined) return undefined
        if (event.type === 'drag') {
          this.setColumns(this.drag.columns + this.drag.x - event.screenX)
          return { handled: true }
        }
        if (event.type === 'release') {
          this.drag = undefined
          return { handled: true, render: true }
        }
        return undefined
      },
    }
    this.addChild(chat, { basis: 0, grow: 1 })
    this.addChild(this.divider, { basis: 3, shrink: 0 })
    this.addChild(pane, { basis: this.preferredColumns, shrink: 0 })
  }

  /**
   * Show the right column when activity or a shell is visible.
   * @param open - whether the right column and divider are visible.
   */
  setOpen(open: boolean): void {
    this.open = open
    this.drag = undefined
    this.tui.requestRender()
  }

  /**
   * Move the divider, preserving at least 30 columns per pane when space permits.
   * @param delta - columns to move right; negative values enlarge the activity column.
   */
  resize(delta: number): void {
    if (this.open) this.setColumns(this.columns() - delta)
  }

  override [LAYOUT_NODE](): StackLayoutNode {
    const node = super[LAYOUT_NODE]()
    if (!this.open) return { ...node, entries: node.entries.slice(0, 1) }
    const dividerColumns = Math.min(3, Math.max(0, this.tui.terminal.columns - 2))
    return {
      ...node,
      entries: node.entries.map((entry, index) => index === 1
        ? { ...entry, basis: dividerColumns }
        : index === 2 ? { ...entry, basis: this.columns() } : entry),
    }
  }

  private columns(preferred = this.preferredColumns): number {
    const available = Math.max(0, this.tui.terminal.columns - 3)
    const minimum = Math.min(30, Math.floor(available / 2))
    return Math.max(minimum, Math.min(available - minimum, preferred))
  }

  private setColumns(columns: number): void {
    this.preferredColumns = this.columns(columns)
    this.tui.requestRender()
  }
}
