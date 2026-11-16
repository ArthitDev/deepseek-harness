/** Transcript paging hooks on pi-tui's keyboard and mouse scroll operations. */
import { ScrollView, type Component } from '@earendil-works/pi-tui'

/** Shared transcript operations, including explicit first/latest jumps. */
export type HistoryNavigation = 'older' | 'newer' | 'start' | 'end'

/** Applies one paging correction after pi-tui measures the replacement content. */
export class HistoryScrollView extends ScrollView {
  private pendingTop: number | undefined
  private width = 1

  /**
   * @param content - retained transcript views and paging notices.
   * @param navigate - synchronous window update after a reading gesture.
   * @param resize - item-relative position at a changed content width; absent keeps the line offset.
   */
  constructor(
    content: Component,
    private readonly navigate: (direction: HistoryNavigation) => void,
    private readonly resize?: (previousWidth: number, width: number) => number | undefined,
  ) {
    super(content, { follow: 'end', primary: true, overscroll: 'contain' })
  }

  /** Actual chat-column width from the last layout, including a split pane. */
  get contentWidth(): number { return this.width }

  override getContentWidth(width: number): number {
    const next = super.getContentWidth(width)
    if (next !== this.width && !this.isFollowingEnd && this.pendingTop === undefined) {
      this.pendingTop = this.resize?.(this.width, next)
    }
    this.width = next
    return this.width
  }

  /**
   * Retain an item-relative scroll position until replacement views are measured.
   * @param top - line offset in the replacement transcript.
   */
  restoreOnLayout(top: number): void { this.pendingTop = top }

  override updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
    super.updateLayout(contentHeight, viewportHeight, requestRender)
    if (this.pendingTop === undefined) return
    const top = this.pendingTop
    this.pendingTop = undefined
    super.scrollTo(top, { disableFollow: true })
  }

  override scrollBy(lines: number): number {
    if (this.pendingTop !== undefined) {
      this.pendingTop = Math.max(0, this.pendingTop + lines)
      return 0
    }
    const remaining = super.scrollBy(lines)
    if (lines !== 0) this.navigate(lines < 0 ? 'older' : 'newer')
    return remaining
  }

  override scrollToStart(): void {
    this.pendingTop = undefined
    this.navigate('start')
    super.scrollToStart()
    this.restoreOnLayout(0)
  }

  override scrollToEnd(): void {
    this.pendingTop = undefined
    this.navigate('end')
    super.scrollToEnd()
  }
}
