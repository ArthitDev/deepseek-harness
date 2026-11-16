/**
 * Long-session fold window computation. Pure and unit-testable: once a
 * transcript passes `threshold` items, the screen starts at the newest
 * `threshold` items. Browsing retains at most two pages around `start`.
 * `/expand-all` lifts the window explicitly.
 *
 * The transcript's item ids are sequential from 0, so "first visible id" is
 * exactly the fold count — everything below it is hidden.
 */
export interface FoldWindow {
  /** Container rebuild key, including offscreen counts for paging notices. */
  key: string
  /** First visible item id (0 when not folded or expanded). */
  boundary: number
  /** Exclusive last visible item id. */
  end: number
}

/**
 * Compute the visible window for a transcript: all items when expanded,
 * otherwise the newest `threshold` items, or two pages from a browsing start.
 * @param itemsLength - Total transcript item count.
 * @param expandedAll - True when `/expand-all` lifts the window.
 * @param threshold - Newest-item count kept visible while folded.
 * @param start - First browsing item; absent follows the newest items.
 * @param pageSize - Items per browsing page, at least the viewport's line count.
 * @returns The rebuild key and visible half-open item range.
 */
export function foldWindow(
  itemsLength: number,
  expandedAll: boolean,
  threshold: number,
  start?: number,
  pageSize = threshold,
): FoldWindow {
  if (expandedAll) return { key: 'all', boundary: 0, end: itemsLength }
  if (start !== undefined) {
    const boundary = Math.min(start, Math.max(0, itemsLength - 1))
    const end = Math.min(itemsLength, boundary + 2 * pageSize)
    return { key: `window:${boundary}:${end}:${itemsLength}`, boundary, end }
  }
  const folded = itemsLength - threshold
  if (folded > 0) return { key: `folded:${folded}`, boundary: folded, end: itemsLength }
  return { key: 'none', boundary: 0, end: itemsLength }
}

/**
 * Scroll offset of `targetId` inside the transcript: the sum of rendered
 * line heights of every VISIBLE item before it, plus the fold notice's
 * height when folded. Hidden (folded) items are skipped because the layout
 * never renders them — counting them would overshoot the scroll position.
 * `heights(id)` returns a view's rendered line count.
 * @param targetId - Item id to measure the offset up to (exclusive).
 * @param window - Active fold window from `foldWindow`.
 * @param heights - Rendered line count per item id.
 * @param noticeHeight - Rendered line count of the fold notice.
 * @returns Sum of visible line heights before `targetId`, plus the notice height when folded.
 */
export function visibleItemsBefore(
  targetId: number,
  window: FoldWindow,
  heights: (id: number) => number,
  noticeHeight = 1,
): number {
  let offset = 0
  if (window.boundary > 0) offset += noticeHeight
  for (let id = window.boundary; id < Math.min(targetId, window.end); id += 1) {
    offset += heights(id)
  }
  return offset
}
