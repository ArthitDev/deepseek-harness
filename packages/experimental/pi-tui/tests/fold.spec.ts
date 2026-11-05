import { describe, expect, it } from 'vitest'
import { foldWindow, visibleItemsBefore } from '../src/core/fold.ts'

describe('foldWindow', () => {
  it('expands everything under /expand-all', () => {
    expect(foldWindow(500, true, 200)).toEqual({ key: 'all', boundary: 0 })
  })

  it('folds the head once the transcript passes the threshold', () => {
    expect(foldWindow(205, false, 200)).toEqual({ key: 'folded:5', boundary: 5 })
  })

  it('stays unfolded at or below the threshold', () => {
    expect(foldWindow(200, false, 200)).toEqual({ key: 'none', boundary: 0 })
    expect(foldWindow(0, false, 200)).toEqual({ key: 'none', boundary: 0 })
  })
})

describe('visibleItemsBefore', () => {
  const heights = (id: number): number => id + 1

  it('sums every visible height before the target when unfolded', () => {
    const window = foldWindow(3, false, 200)
    expect(visibleItemsBefore(3, window, heights)).toBe(1 + 2 + 3)
  })

  it('adds the fold notice height when folded', () => {
    const window = foldWindow(205, false, 200)
    // boundary 5: ids 5.. before target 6 contribute heights(5) = 6, plus the notice.
    expect(visibleItemsBefore(6, window, heights)).toBe(1 + 6)
  })

  it('honors a custom notice height and skips items below the boundary', () => {
    const window = { key: 'folded:3', boundary: 3 }
    expect(visibleItemsBefore(5, window, heights, 2)).toBe(2 + heights(3) + heights(4))
  })

  it('counts nothing before id 0', () => {
    expect(visibleItemsBefore(0, foldWindow(5, false, 200), heights)).toBe(0)
  })
})
