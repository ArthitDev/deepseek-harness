import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ViewportTUI } from '@earendil-works/pi-tui'
import { StatusBar } from '../src/ui/views.ts'

afterEach(() => { vi.useRealTimers() })

describe('status bar animation', () => {
  it('keeps the model robot static during work without starting a status animation', () => {
    vi.useFakeTimers()
    const requestRender = vi.fn()
    const bar = new StatusBar({ requestRender } as unknown as ViewportTUI)
    const read = (): string => stripVTControlCharacters(bar.render(35).join('\n'))
    try {
      for (const working of [false, true]) {
        bar.update({ model: 'chosen-model', working })
        const first = read()
        expect(first).toContain('🤖 chosen-model')
        expect(vi.getTimerCount()).toBe(0)
        requestRender.mockClear()
        vi.advanceTimersByTime(500)
        expect(read()).toBe(first)
        expect(requestRender).not.toHaveBeenCalled()
      }
    } finally {
      bar.stop()
    }
  })

  it.each([
    { label: 'jobs', data: { model: 'chosen-model', working: true, jobsRunning: 2 }, text: '2 jobs' },
    { label: 'subagents', data: { model: 'chosen-model', working: true, subagentsRunning: 3 }, text: '3 agents' },
  ])('animates $label without new events and stops when idle', ({ data, text }) => {
    vi.useFakeTimers()
    const requestRender = vi.fn()
    const bar = new StatusBar({ requestRender } as unknown as ViewportTUI)
    const read = (): string => stripVTControlCharacters(bar.render(35).join('\n'))
    try {
      expect(vi.getTimerCount()).toBe(0)
      bar.update(data)
      expect(vi.getTimerCount()).toBe(1)
      const first = read()
      expect(first).toContain(text)
      expect(first).toContain('🤖 chosen-model')
      requestRender.mockClear()
      vi.advanceTimersByTime(60)
      bar.update(data)
      vi.advanceTimersByTime(60)
      expect(requestRender).toHaveBeenCalled()
      expect(read()).not.toBe(first)
      expect(read()).toContain(text)
      expect(read()).toContain('🤖 chosen-model')
      expect(vi.getTimerCount()).toBe(1)
      bar.update({ model: 'chosen-model' })
      expect(vi.getTimerCount()).toBe(0)
      const idle = read()
      requestRender.mockClear()
      vi.advanceTimersByTime(500)
      expect(read()).toBe(idle)
      expect(requestRender).not.toHaveBeenCalled()
      expect(idle).toContain('🤖 chosen-model')
      bar.update(data)
      expect(vi.getTimerCount()).toBe(1)
      bar.stop()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      bar.stop()
    }
  })
})
