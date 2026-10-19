/**
 * Long-session fold window computation. Pure and unit-testable: once a
 * transcript passes `threshold` items, the screen renders only the newest
 * `threshold` items and replaces the hidden head with a one-line notice.
 * `/expand-all` (or a find jump into the folded region) lifts the fold.
 *
 * The transcript's item ids are sequential from 0, so "first visible id" is
 * exactly the fold count — everything below it is hidden.
 */
export interface FoldWindow {
  /** Container rebuild key: 'none' | 'all' | 'folded:<count>'. */
  key: string
  /** First visible item id (0 when not folded or expanded). */
  boundary: number
}

/**
 * Compute the visible window for a transcript: all items when expanded,
 * otherwise the newest `threshold` items with the hidden head replaced by
 * the fold notice. Item ids are sequential, so `boundary` is both the fold
 * count and the first visible id.
 * @param itemsLength - Total transcript item count.
 * @param expandedAll - True when the fold is lifted (`/expand-all` or a find jump into the folded region).
 * @param threshold - Newest-item count kept visible while folded.
 * @returns The container rebuild key and the first visible item id.
 */
export function foldWindow(
  itemsLength: number,
  expandedAll: boolean,
  threshold: number,
): FoldWindow {
  if (expandedAll) return { key: 'all', boundary: 0 }
  const folded = itemsLength - threshold
  if (folded > 0) return { key: `folded:${folded}`, boundary: folded }
  return { key: 'none', boundary: 0 }
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
  if (window.key.startsWith('folded:')) offset += noticeHeight
  for (let id = 0; id < targetId; id += 1) {
    if (id < window.boundary) continue
    offset += heights(id)
  }
  return offset
}
