// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginToggle } from '../src/client/PluginToggle.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'
import type { PluginInventorySettingsTabProps } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'

afterEach(cleanup)
const t = ((key: PluginInventoryLocaleKey, params?: Record<string, string>) => Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as PluginInventorySettingsTabProps['t']

it('refreshes the badge immediately after saving and polls later Host changes', async () => {
  let enabled = true
  const list = vi.fn(async () => ({ entries: [{ entryId: 'tool' as never, moduleName: 'fs', enabled, fiberPhase: null }] }))
  const props = {
    list, presetName: () => '', t,
    edit: async () => ({ enabled, revision: 'v1' }),
    setEnabled: async (_id: string, _name: string, value: boolean) => { enabled = value; return { enabled, revision: 'v2' } },
  } as PluginInventorySettingsTabProps
  render(<PluginInventorySettingsTab {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'fs, tool, Enabled' }))
  fireEvent.click(await screen.findByRole('switch'))
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await screen.findByRole('button', { name: 'fs, tool, Disabled' })
  expect(list.mock.calls.length).toBeGreaterThanOrEqual(2)
  enabled = true
  await screen.findByRole('button', { name: 'fs, tool, Enabled' }, { timeout: 2500 })
})

it('confirms preset changes, sends the read revision, and reports new-session timing', async () => {
  const edit = vi.fn().mockResolvedValue({ enabled: true, revision: 'first' })
  const setEnabled = vi.fn().mockResolvedValue({ enabled: false, revision: 'second' })
  const onSaved = vi.fn()
  render(<PluginToggle entryId="tool-fs" moduleName="fs" preset="mine" edit={edit} setEnabled={setEnabled} onSaved={onSaved} t={t} />)
  const toggle = await screen.findByRole('switch', { name: 'Enable fs' })
  fireEvent.click(toggle)
  expect(setEnabled).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  expect((toggle as HTMLInputElement).checked).toBe(true)
  fireEvent.click(toggle)
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await waitFor(() =>{  expect(setEnabled).toHaveBeenCalledWith('tool-fs', 'fs', false, 'first', 'mine') })
  expect((await screen.findByRole('status')).textContent).toMatchInlineSnapshot('"Configuration saved with a .bak backup. Start a new session with this preset."')
  expect(onSaved).toHaveBeenCalledTimes(1)
})

it('shows protected-row reasons instead of a switch', async () => {
  render(<PluginToggle entryId="gateway" moduleName="gateway" edit={async () => ({ enabled: true, revision: '', reason: 'Infrastructure plugin' })} setEnabled={vi.fn()} t={t} />)
  expect(await screen.findByText('Infrastructure plugin')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
})

it('retains failed edits and refreshes the revision on retry', async () => {
  const edit = vi.fn().mockResolvedValueOnce({ enabled: true, revision: 'old' }).mockResolvedValue({ enabled: false, revision: 'new' })
  const setEnabled = vi.fn().mockRejectedValue(new Error('Configuration changed'))
  render(<PluginToggle entryId="x" moduleName="x" edit={edit} setEnabled={setEnabled} t={t} />)
  fireEvent.click(await screen.findByRole('switch'))
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  expect((await screen.findByRole('alert')).textContent).toContain('Configuration changed')
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  await waitFor(() =>{  expect(edit).toHaveBeenCalledTimes(2) })
  await waitFor(() => { expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(false) })
})
