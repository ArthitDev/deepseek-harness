// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WebSearchPolicySettings } from '@deepseek-ai/dsh-tool-web/settings'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { WebSearchModeControl, type WebSearchModeControlProps } from '../src/client/WebSearchModeControl.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WebSearchModeControlProps['t'] = makeTranslate(zh, commonZh)

const snapshot = (
  overrides: Partial<SettingsScopeSnapshot<WebSearchPolicySettings>> = {},
): SettingsScopeSnapshot<WebSearchPolicySettings> => ({
  status: 'ready', value: { always: false }, base: { always: false }, user: undefined,
  revision: 0, writable: true, mode: 'host', ...overrides,
})

function setup(
  initial: SettingsScopeSnapshot<WebSearchPolicySettings>,
  setAlways = vi.fn(() => Promise.resolve()),
) {
  const store = createSnapshotStore(initial)
  const useWebSearchMode = <S,>(selector: (value: SettingsScopeSnapshot<WebSearchPolicySettings>) => S) =>
    bindSnapshotSelector(store)(selector)
  const props = { useWebSearchMode, setAlways, t } as unknown as WebSearchModeControlProps
  return { setAlways, view: render(<WebSearchModeControl {...props} />) }
}

describe('WebSearchModeControl', () => {
  it('hides when unsupported and reflects the persisted state', () => {
    expect(setup(snapshot({ status: 'unavailable' })).view.container.innerHTML).toBe('')
    cleanup()
    setup(snapshot({ value: { always: true } }))
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('writes once, locks while saving, and displays failures', async () => {
    let reject!: (reason: unknown) => void
    const setAlways = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    setup(snapshot(), setAlways)
    const toggle = screen.getByRole<HTMLButtonElement>('switch')
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(setAlways).toHaveBeenCalledExactlyOnceWith(true)
    expect(toggle.disabled).toBe(true)
    reject(new Error('host said no'))
    expect((await screen.findByRole('alert')).textContent).toContain('host said no')
    await waitFor(() => { expect(toggle.disabled).toBe(false) })
  })

  it('disables the switch while loading or read-only', () => {
    setup(snapshot({ status: 'loading', value: undefined, writable: false }))
    expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(true)
  })
})
