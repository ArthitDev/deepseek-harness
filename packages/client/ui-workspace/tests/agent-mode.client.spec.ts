// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { AgentModeController, type AgentModeSettings } from '../src/client/agent-mode.ts'

describe('AgentModeController', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { document.querySelector('[data-test-favicon]')?.remove() })

  it('starts red and swaps one global token layer for blue and black', () => {
    const favicon = document.createElement('link')
    favicon.rel = 'icon'
    favicon.dataset.testFavicon = ''
    document.head.append(favicon)
    const dispose = vi.fn()
    const setTheme = vi.fn()
    const overrideTokens = vi.fn(() => dispose)
    const controller = new AgentModeController({ setTheme, overrideTokens } as unknown as ThemeRuntime)

    expect(controller.getSnapshot()).toBe('red')
    expect(favicon.getAttribute('href')).toBe('/new-logo.png')
    expect(setTheme).not.toHaveBeenCalled()
    expect(overrideTokens).toHaveBeenLastCalledWith(
      '@deepseek-ai/dsh-client-ui-workspace/agent-mode',
      expect.objectContaining({
        '--dsh-agent-logo': { light: "url('/new-logo.png')", dark: "url('/new-logo.png')" },
      }),
    )

    controller.set('blue')
    expect(localStorage.getItem('dsh.agentMode')).toBe('blue')
    expect(favicon.getAttribute('href')).toBe('/new-logo-blue.png')
    expect(overrideTokens).toHaveBeenLastCalledWith(
      '@deepseek-ai/dsh-client-ui-workspace/agent-mode',
      expect.objectContaining({
        '--dsw-alias-brand-primary': { light: '#2563eb', dark: '#4d8dff' },
        '--dsw-alias-bg-module-platform': {
          light: 'color-mix(in srgb, #2563eb 5%, #fff)',
          dark: 'color-mix(in srgb, #4d8dff 5%, #0d1424)',
        },
        '--dsw-specific-input-major': { light: '#fff', dark: '#0d1424' },
      }),
    )

    controller.set('black')
    expect(favicon.getAttribute('href')).toBe('/new-logo-black.png')
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(overrideTokens).toHaveBeenLastCalledWith(
      '@deepseek-ai/dsh-client-ui-workspace/agent-mode',
      expect.objectContaining({
        '--dsw-alias-brand-primary': { light: '#181818', dark: '#f5f5f5' },
        '--dsw-alias-bg-layer-4': {
          light: 'color-mix(in srgb, #181818 10%, #fff)',
          dark: 'color-mix(in srgb, #f5f5f5 10%, #0d0d0d)',
        },
        '--dsw-alias-label-primary-foreground': { light: '#fff', dark: '#111' },
        '--dsw-specific-input-major': { light: '#fff', dark: '#0d0d0d' },
      }),
    )
  })
})

it('follows the Host mode and persists explicit mode changes', () => {
  const settings = stubSettingsScope<AgentModeSettings>()
  settings.publish({ status: 'ready', value: { mode: 'blue' } })
  const controller = new AgentModeController({ overrideTokens: vi.fn(() => vi.fn()) } as unknown as ThemeRuntime, settings.scope)

  expect(controller.getSnapshot()).toBe('blue')
  expect(settings.listenerCount()).toBe(1)

  controller.set('black')
  expect(settings.set).toHaveBeenCalledExactlyOnceWith('mode', 'black')

  settings.publish({ value: { mode: 'red' } })
  expect(controller.getSnapshot()).toBe('red')

  controller.dispose()
  expect(settings.listenerCount()).toBe(0)
})
