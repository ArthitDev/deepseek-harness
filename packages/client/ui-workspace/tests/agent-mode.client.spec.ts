// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AgentModeTheme } from '../src/client/agent-mode.ts'
import { AgentModeController } from '../src/client/agent-mode.ts'

describe('AgentModeController', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { document.querySelector('[data-test-favicon]')?.remove() })

  function favicon(): HTMLLinkElement {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.dataset.testFavicon = ''
    document.head.append(link)
    return link
  }

  function runtime(): { theme: AgentModeTheme; overrides: { source: string; tokens: ThemeTokenOverrides }[] } {
    const overrides: { source: string; tokens: ThemeTokenOverrides }[] = []
    const theme = {
      overrideTokens: vi.fn((source: string, tokens: ThemeTokenOverrides) => {
        overrides.push({ source, tokens })
        return () => {}
      }),
    }
    return { theme, overrides }
  }

  it('starts red and installs one global token layer with the red identity', () => {
    const link = favicon()
    const { theme, overrides } = runtime()
    const controller = new AgentModeController(theme)

    expect(controller.getSnapshot()).toBe('red')
    expect(link.getAttribute('href')).toBe('/new-logo.png')
    expect(overrides).toHaveLength(1)
    expect(overrides[0]!.source).toBe('@deepseek-ai/dsh-client-ui-workspace/agent-mode')
    expect(overrides[0]!.tokens['--dsh-agent-logo']).toEqual({
      light: "url('/new-logo.png')",
      dark: "url('/new-logo.png')",
    })
    expect(overrides[0]!.tokens['--dsw-alias-brand-primary']).toEqual({ light: '#d52643', dark: '#ff5263' })
  })

  it('switches modes, persists the choice, and swaps the whole token layer', () => {
    const link = favicon()
    const { theme, overrides } = runtime()
    const controller = new AgentModeController(theme)

    controller.set('blue')
    expect(controller.getSnapshot()).toBe('blue')
    expect(localStorage.getItem('dsh.agentMode')).toBe('blue')
    expect(link.getAttribute('href')).toBe('/new-logo-blue.png')
    expect(overrides.at(-1)!.tokens['--dsh-agent-logo']).toEqual({
      light: "url('/new-logo-blue.png')",
      dark: "url('/new-logo-blue.png')",
    })
    expect(overrides.at(-1)!.tokens['--dsw-alias-brand-primary']).toEqual({ light: '#2563eb', dark: '#4d8dff' })

    controller.set('dead')
    expect(overrides.at(-1)!.tokens['--dsw-alias-brand-primary']).toEqual({ light: '#7e22ce', dark: '#c084fc' })
    expect(link.getAttribute('href')).toBe('/new-logo-black.png')
    controller.dispose()
  })

  it('notifies subscribers after each accepted change and ignores repeats', () => {
    const { theme } = runtime()
    const controller = new AgentModeController(theme)
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.set('red')
    expect(listener).not.toHaveBeenCalled()
    controller.set('black')
    expect(listener).toHaveBeenCalledExactlyOnceWith()
    controller.dispose()
  })

  it('restores a persisted mode on construction', () => {
    localStorage.setItem('dsh.agentMode', 'black')
    const link = favicon()
    const { theme, overrides } = runtime()
    const controller = new AgentModeController(theme)

    expect(controller.getSnapshot()).toBe('black')
    expect(link.getAttribute('href')).toBe('/new-logo-black.png')
    expect(overrides[0]!.tokens['--dsh-agent-headline']).toEqual({
      light: '"Black Team Agent"',
      dark: '"Black Team Agent"',
    })
    controller.dispose()
  })

  it('ignores an unknown persisted value', () => {
    localStorage.setItem('dsh.agentMode', 'purple')
    const { theme } = runtime()
    const controller = new AgentModeController(theme)
    expect(controller.getSnapshot()).toBe('red')
    controller.dispose()
  })
})
