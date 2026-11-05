import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ViewportTUI } from '@earendil-works/pi-tui'
import { StatusBar } from '../src/ui/views.ts'
import { TEAM_MODE_OPTIONS } from '../src/core/team-mode.ts'

afterEach(() => { vi.useRealTimers() })

describe('status bar animation', () => {
  it('shows Wiki availability without a spinner and removes it when disabled', () => {
    vi.useFakeTimers()
    const bar = new StatusBar({ requestRender: vi.fn() } as unknown as ViewportTUI)
    try {
      bar.update({ wikiAvailable: true })
      expect(stripVTControlCharacters(bar.render(30).join('\n'))).toContain('📚 Wiki')
      expect(vi.getTimerCount()).toBe(0)
      bar.update({ wikiAvailable: false })
      expect(stripVTControlCharacters(bar.render(30).join('\n'))).not.toContain('Wiki')
    } finally { bar.stop() }
  })
  it('shows Jev state and provider-reported session cost without a spinner', () => {
    vi.useFakeTimers()
    const bar = new StatusBar({ requestRender: vi.fn() } as unknown as ViewportTUI)
    try {
      bar.update({ jev: { state: 'on', cost: 0.001234 } })
      expect(stripVTControlCharacters(bar.render(40).join('\n'))).toContain('Jev ON · cost 0.001234')
      expect(vi.getTimerCount()).toBe(0)
      bar.update({ jev: { state: 'off', cost: 0 } })
      expect(stripVTControlCharacters(bar.render(40).join('\n'))).toContain('Jev OFF · cost 0')
      bar.update({ jev: { state: 'unavailable' } })
      expect(stripVTControlCharacters(bar.render(40).join('\n'))).toContain('Jev unavailable')
    } finally { bar.stop() }
  })
  it.each(TEAM_MODE_OPTIONS)('shows the $label icon and name without adding a loading animation', (option) => {
    vi.useFakeTimers()
    const bar = new StatusBar({ requestRender: vi.fn() } as unknown as ViewportTUI)
    try {
      bar.update({ model: 'chosen-model', teamMode: option.value })
      const text = stripVTControlCharacters(bar.render(35).join('\n'))
      expect(text).toContain(`${option.icon} ${option.label}`)
      expect(text).toContain('🤖 chosen-model')
      expect(vi.getTimerCount()).toBe(0)
    } finally { bar.stop() }
  })
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
