// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { SkillManagerSection } from '../src/client/SkillManagerSection.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SkillManagerSection', () => {
  it('searches and installs a selected skills.sh result', async () => {
    const installed = vi.fn()
      .mockResolvedValueOnce({ skills: [] })
      .mockResolvedValueOnce({ skills: [{ name: 'pentest', enabled: true }] })
    const search = vi.fn().mockResolvedValue({ skills: [{
      source: 'owner/repo@pentest', name: 'pentest', url: 'https://skills.sh/owner/repo/pentest',
    }] })
    const install = vi.fn().mockResolvedValue({ installed: ['pentest'], backedUp: [] })
    render(<SkillManagerSection installed={installed} search={search} install={install} t={makeTranslate(zh, commonZh)} />)

    await waitFor(() => { expect(installed).toHaveBeenCalledOnce() })
    fireEvent.change(screen.getByLabelText('搜索 skill'), { target: { value: 'pentest' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await screen.findByText('owner/repo@pentest')
    fireEvent.click(screen.getByRole('button', { name: '安装' }))

    expect(install).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '安装' }))
    await waitFor(() => { expect(install).toHaveBeenCalledWith('owner/repo@pentest') })
    expect((await screen.findByRole('status')).textContent).toContain('已安装：pentest')
    expect(screen.getByText('pentest', { selector: 'code' })).toBeTruthy()
  })

  it('enables and disables an installed skill', async () => {
    const setEnabled = vi.fn().mockResolvedValue({ name: 'pentest', enabled: false })
    render(<SkillManagerSection
      installed={vi.fn().mockResolvedValue({ skills: [{ name: 'pentest', enabled: true }] })}
      search={vi.fn()}
      install={vi.fn()}
      setEnabled={setEnabled}
      t={makeTranslate(en, commonEn)}
    />)

    const toggle = await screen.findByRole('switch', { name: 'Disable pentest' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('pentest', false) })
    expect(await screen.findByRole('switch', { name: 'Enable pentest' })).toBeTruthy()
  })

  it('removes an installed skill after confirmation', async () => {
    const remove = vi.fn().mockResolvedValue({ name: 'pentest', removed: true })
    render(<SkillManagerSection
      installed={vi.fn().mockResolvedValue({ skills: [{ name: 'pentest', enabled: true }] })}
      search={vi.fn()}
      install={vi.fn()}
      remove={remove}
      t={makeTranslate(en, commonEn)}
    />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove pentest' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith('pentest') })
    expect(screen.queryByText('pentest', { selector: 'code' })).toBeNull()
    expect((await screen.findByRole('status')).textContent).toContain('kept a backup')
  })

  it('runs a pasted command in an interactive terminal after confirmation', async () => {
    const installed = vi.fn().mockResolvedValue({ skills: [] })
    const terminalOpen = vi.fn().mockResolvedValue({ id: 'terminal-1' })
    const terminalRead = vi.fn().mockResolvedValue({
      text: 'Select a skill: ', nextOffset: 16, lossy: false, exited: false,
    })
    const terminalWrite = vi.fn().mockResolvedValue(undefined)
    const terminalClose = vi.fn().mockResolvedValue(undefined)
    render(<SkillManagerSection
      installed={installed}
      search={vi.fn()}
      install={vi.fn()}
      terminalOpen={terminalOpen}
      terminalRead={terminalRead}
      terminalWrite={terminalWrite}
      terminalClose={terminalClose}
      t={makeTranslate(en, commonEn)}
    />)

    await waitFor(() => { expect(installed).toHaveBeenCalledOnce() })
    const input = screen.getByLabelText('Skills terminal')
    fireEvent.change(input, {
      target: { value: 'npx skills add https://github.com/owner/repo' },
    })
    fireEvent.submit(input.closest('form')!)
    expect(terminalOpen).not.toHaveBeenCalled()
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(terminalOpen).toHaveBeenCalledWith('npx skills add https://github.com/owner/repo')
    })
    await screen.findByText('Select a skill:')
    fireEvent.change(input, { target: { value: 'y' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(terminalWrite).toHaveBeenCalledWith('terminal-1', 'y\r') })
  })
})
