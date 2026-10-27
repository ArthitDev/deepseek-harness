/**
 * Two-column split layout: left component grows, right component takes a
 * fixed-width column. Children render at their own column widths and the
 * results merge line-by-line — the pi-tui HStack sizes by intrinsic content
 * only, which cannot give a ScrollView a full-viewport height.
 *
 * @module split-layout
 */

import { Container, type Component } from '@earendil-works/pi-tui'

/** Fixed width of the right shell column (including its border). */
export const SHELL_COLUMN_WIDTH = 46

/** A Component that renders into a fixed column width. */
type ColumnComponent = Component & { renderColumn(width: number): string[] }

/**
 * Two-column component. The left child fills the remaining width after the
 * right child's fixed column; both render at the same viewport height. Line
 * counts differ per side, so the shorter side pads with empty lines before
 * the merge.
 */
export class SplitLayout implements Component {
  private readonly left: Container
  private readonly right: ColumnComponent
  private cached: { width: number; lines: string[] } | undefined

  /**
   * @param left - the chat column container; the screen mounts/unmounts its
   *   components into this without touching the split layout.
   * @param right - the shell column, rendered at its fixed width.
   */
  constructor(left: Container, right: ColumnComponent) {
    this.left = left
    this.right = right
  }

  addChild(component: Component): void {
    this.left.addChild(component)
  }

  removeChild(component: Component): void {
    this.left.removeChild(component)
  }

  clear(): void {
    this.left.clear()
  }

  invalidate(): void {
    this.cached = undefined
  }

  handleInput(): void {
    // Input routing is handled by the screen's input listener + focus; the
    // split itself takes no input.
  }

  render(width: number): string[] {
    const rightWidth = Math.min(SHELL_COLUMN_WIDTH, Math.max(0, width - 30))
    const leftWidth = Math.max(1, width - rightWidth)
    if (this.cached?.width === width) return this.cached.lines

    const leftLines = this.left.render(leftWidth)
    const rightLines = this.right.renderColumn(rightWidth)
    const height = Math.max(leftLines.length, rightLines.length)
    const lines: string[] = []
    for (let index = 0; index < height; index += 1) {
      const left = (leftLines[index] ?? '').padEnd(leftWidth)
      const right = rightLines[index] ?? ''
      lines.push(left + right)
    }
    this.cached = { width, lines }
    return lines
  }
}
