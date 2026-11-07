// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { ThemeToggle, type ThemeToggleProps } from '../src/client/skeleton/ThemeToggle.tsx'

afterEach(cleanup)

describe('ThemeToggle', () => {
  it('offers and activates the opposite color mode', () => {
    const mode = createSnapshotStore<'light' | 'dark'>('dark')
    const toggleTheme = vi.fn()
    const props = {
      useThemeMode: bindSnapshotSelector(mode),
      toggleTheme,
      t: (key: string) => key === 'theme.toLight' ? 'Switch to light mode' : 'Switch to dark mode',
    } as unknown as ThemeToggleProps

    render(<ThemeToggle {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(toggleTheme).toHaveBeenCalledOnce()

    act(() => { mode.set('light') })
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeDefined()
  })
})
