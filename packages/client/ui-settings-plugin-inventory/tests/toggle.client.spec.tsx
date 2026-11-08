// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientEntryState } from '@deepseek-ai/dsh-client-modules/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { PluginToggle } from '../src/client/PluginToggle.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'
import type { PluginInventorySettingsTabProps } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'

afterEach(cleanup)
const t = ((key: PluginInventoryLocaleKey, params?: Record<string, string>) => Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as PluginInventorySettingsTabProps['t']

it('refreshes the badge immediately after saving', async () => {
  let enabled = true
  const list = vi.fn(async (): Promise<PluginInventorySnapshot> => ({
    entries: [{ entryId: 'tool' as PluginInventorySnapshot['entries'][number]['entryId'], moduleName: 'fs', enabled, fiberPhase: null }],
  }))
  render(<PluginInventorySettingsTab {...{
    list,
    presetName: () => '',
    resolveText: () => '',
    useClientSync: bindSnapshotSelector(createSnapshotStore<ClientEntryState>({ syncing: false, failures: [] })),
    retryClient: () => {},
    t,
    edit: async () => ({ enabled, revision: 'v1' }),
    setEnabled: async (_entryId, _moduleName, value) => { enabled = value; return { enabled, revision: 'v2' } },
  } as PluginInventorySettingsTabProps} />)
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
  // The saved-notice copy travels with the preset path; a localized presetName
  // winning over self-named built-ins belongs to the agent-preset registry's
  // surface, so this spec does not assert any preset display name here.
  expect((await screen.findByRole('status')).textContent).toContain('Start a new session')
  expect(onSaved).toHaveBeenCalledOnce()
})

it('shows protected-row reasons instead of a switch', async () => {
  render(<PluginToggle entryId="gateway" moduleName="gateway" edit={async () => ({ enabled: true, revision: '', reason: 'Infrastructure plugin' })} setEnabled={vi.fn()} t={t} />)
  expect(await screen.findByText('Infrastructure plugin')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
})
