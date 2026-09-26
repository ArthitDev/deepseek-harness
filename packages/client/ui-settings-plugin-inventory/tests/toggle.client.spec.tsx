// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginToggle } from '../src/client/PluginToggle.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'
import type { PluginInventorySettingsTabProps } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'

afterEach(cleanup)
const t = ((key: PluginInventoryLocaleKey, params?: Record<string, string>) => Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as PluginInventorySettingsTabProps['t']

it('refreshes the badge immediately after saving', async () => {
  let enabled = true
  const list = vi.fn(async () => ({ entries: [{ entryId: 'tool' as never, moduleName: 'fs', enabled, fiberPhase: null }] }))
  render(<PluginInventorySettingsTab {...({
    list,
    presetName: () => '',
    resolveText: () => '',
    useClientSync: () => ({ syncing: false, failures: [] }),
    retryClient: () => {},
    t,
    edit: async () => ({ enabled, revision: 'v1' }),
    setEnabled: async (_id: string, _name: string, value: boolean) => { enabled = value; return { enabled, revision: 'v2' } },
  } as unknown as PluginInventorySettingsTabProps)} />)
  fireEvent.click(await screen.findByRole('button', { name: en.globalTitle }))
  fireEvent.click(await screen.findByRole('button', { name: 'fs, tool, Enabled' }))
  fireEvent.click(await screen.findByRole('switch'))
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await screen.findByRole('button', { name: 'fs, tool, Disabled' })
  expect(list).toHaveBeenCalledTimes(2)
})

it('confirms preset changes and sends the read revision', async () => {
  const edit = vi.fn().mockResolvedValue({ enabled: true, revision: 'first' })
  const setEnabled = vi.fn().mockResolvedValue({ enabled: false, revision: 'second' })
  const onSaved = vi.fn()
  render(<PluginToggle entryId="tool-fs" moduleName="fs" preset="mine" edit={edit} setEnabled={setEnabled} onSaved={onSaved} t={t} />)
  const toggle = await screen.findByRole('switch', { name: 'Enable fs' })
  fireEvent.click(toggle)
  expect(setEnabled).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('tool-fs', 'fs', false, 'first', 'mine') })
  expect((await screen.findByRole('status')).textContent).toContain('Start a new session')
  expect(onSaved).toHaveBeenCalledOnce()
})

it('shows protected-row reasons instead of a switch', async () => {
  render(<PluginToggle entryId="gateway" moduleName="gateway" edit={async () => ({ enabled: true, revision: '', reason: 'Infrastructure plugin' })} setEnabled={vi.fn()} t={t} />)
  expect(await screen.findByText('Infrastructure plugin')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
})
