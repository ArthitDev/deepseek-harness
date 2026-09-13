// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WebSearchModeProjection } from '@deepseek-ai/dsh-tool-web/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { WebSearchModeControl, type WebSearchModeControlProps } from '../src/client/WebSearchModeControl.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WebSearchModeControlProps['t'] = makeTranslate(zh, commonZh)

function setup(
  mode: WebSearchModeProjection | undefined,
  setAlways = vi.fn(() => Promise.resolve<string | null>(null)),
  locked = false,
) {
  const store = createSnapshotStore<{ value: WebSearchModeProjection | undefined }>({ value: mode })
  const useProjection = (_key: string, selector?: (value: unknown) => unknown) =>
    bindSnapshotSelector(store)(state => (selector ?? (value => value))(state.value))
  const props = { useProjection, locked, setAlways, t } as unknown as WebSearchModeControlProps
  return { setAlways, view: render(<WebSearchModeControl {...props} />) }
}

describe('WebSearchModeControl', () => {
  it('renders only when the host exposes the capability', () => {
    expect(setup(undefined).view.container.innerHTML).toBe('')
    cleanup()
    setup({ always: false })
    expect(screen.getByRole('button').textContent).toBe('Web Search')
  })

  it('toggles auto and always once while the command is pending', async () => {
    let resolve!: (value: string | null) => void
    const setAlways = vi.fn(() => new Promise<string | null>((done) => { resolve = done }))
    setup({ always: false }, setAlways)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(setAlways).toHaveBeenCalledExactlyOnceWith(true)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    resolve(null)
    await waitFor(() => { expect((button as HTMLButtonElement).disabled).toBe(false) })

    cleanup()
    const disable = vi.fn(() => Promise.resolve<string | null>(null))
    setup({ always: true }, disable)
    fireEvent.click(screen.getByRole('button'))
    expect(disable).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('honors lock and surfaces command failures', async () => {
    setup({ always: false }, vi.fn(), true)
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true)
    cleanup()
    setup({ always: false }, vi.fn().mockResolvedValue('host said no'))
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByTitle('host said no')).toBeTruthy()
  })

  it('ignores a late rejection after unmount', () => {
    let reject!: (reason: unknown) => void
    const pending = vi.fn(() => new Promise<string | null>((_done, fail) => { reject = fail }))
    const { view } = setup({ always: false }, pending)
    fireEvent.click(screen.getByRole('button'))
    view.unmount()
    expect(() => { reject(new Error('late')) }).not.toThrow()
  })
})
