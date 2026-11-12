// @vitest-environment jsdom
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentPresetSection, type AgentPresetSectionProps } from '../src/client/AgentPresetSection.tsx'
import type { AgentPresetSectionState } from '../src/client/section-store.ts'
import type { AgentPresetPreferences } from '../src/client/settings-store.ts'
import { en } from '../src/client/locales.ts'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))
function unusedHook(): never {
  throw new Error('This section does not read global slot sources')
}
function view(partial: Partial<AgentPresetSectionState> = {}, startCreatorDraft?: () => void, outerClose?: () => void, enabled = true) {
  const developerTools = createSnapshotStore(enabled)
  const preferences = createSnapshotStore<AgentPresetPreferences>({ status: 'ready', value: { showBuiltInPresets: true }, base: {}, user: {}, revision: 0, writable: true })
  const store = createSnapshotStore<AgentPresetSectionState>({ status: 'ready', error: null,
    saving: false, rows: [{ id: 'standard', isDefault: true, trust: 'system' },
      { id: 'mine', name: 'Mine', isDefault: false, trust: 'user' }],
    view: null, ...partial })
  const actions = { load: vi.fn(async () => {}), view: vi.fn(async () => {}),
    closeView: vi.fn(() => { store.set({ ...store.getSnapshot(), view: null }) }), makeDefault: vi.fn(async () => {}),
    close: vi.fn(), setShowBuiltInPresets: vi.fn(async () => {}), create: vi.fn(async () => true),
    write: vi.fn(async () => true), remove: vi.fn(async () => true) }
  const props: AgentPresetSectionProps = { ...actions,
    ...(startCreatorDraft === undefined ? {} : { startCreatorDraft }),
    usePanelInfo: unusedHook, useSessions: unusedHook, useSessionStatus: unusedHook, useSessionRetainInfo: unusedHook,
    useWorkspaces: unusedHook, useResource: unusedHook,
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    useAgentPresetSection: bindSnapshotSelector(store),
    useDeveloperTools: bindSnapshotSelector(developerTools),
    usePresetPreferences: bindSnapshotSelector(preferences),
    t: key => translations.get(key) ?? key }
  render(outerClose === undefined ? <AgentPresetSection {...props} />
    : <Modal open onClose={outerClose} title="Settings" closeLabel="Close"><AgentPresetSection {...props} /></Modal>)
  return { ...actions, store, developerTools, preferences }
}
function rowFor(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-agent-preset-id="${id}"]`)
  if (row === null) throw new Error(`no card for ${id}`)
  return row
}

it('keeps card actions icon-only, named for assistive technology and disabled during saves', () => {
  const actions = view({ authorable: true })
  const buttons = [en.copyPreset, en.edit, en.deletePreset, en.view].map(label =>
    within(rowFor('mine')).getByRole<HTMLButtonElement>('button', { name: `${label}: Mine` }))
  for (const button of buttons) expect(button.textContent).toBe('')
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), saving: true }) })
  for (const button of buttons) expect(button.disabled).toBe(true)
})

it('creates a preset directly without Creator mode, retaining its identity and YAML after a refused save', async () => {
  const actions = view({ authorable: true })
  const trigger = screen.getByRole('button', { name: en.createPreset })
  fireEvent.click(trigger)
  expect(actions.view).toHaveBeenCalledWith('standard')
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), view: { id: 'standard', title: 'standard', content: '[]\n' } }) })
  const dialog = screen.getByRole('dialog', { name: en.createPreset })
  const name = within(dialog).getByRole<HTMLInputElement>('textbox', { name: en.presetName })
  const id = within(dialog).getByRole<HTMLInputElement>('textbox', { name: en.presetId })
  const composition = within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: en.composition })
  expect(document.activeElement).toBe(name)
  expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(true)
  fireEvent.change(name, { target: { value: 'My custom agent' } })
  fireEvent.change(id, { target: { value: 'custom-agent' } })
  fireEvent.change(composition, { target: { value: 'invalid YAML draft' } })
  actions.create.mockResolvedValueOnce(false)
  fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
  await waitFor(() => { expect(actions.create).toHaveBeenCalledWith('standard', 'custom-agent', 'My custom agent', 'invalid YAML draft') })
  expect(name.value).toBe('My custom agent')
  expect(id.value).toBe('custom-agent')
  expect(composition.value).toBe('invalid YAML draft')
  expect(actions.closeView).not.toHaveBeenCalled()
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), saving: true, error: 'Invalid composition' }) })
  expect(within(dialog).getByRole('alert').textContent).toBe('Invalid composition')
  fireEvent.keyDown(id, { key: 'Escape' })
  expect(actions.closeView).not.toHaveBeenCalled()
  expect(id.disabled).toBe(true)
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), saving: false }) })
  fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
  await waitFor(() => { expect(actions.closeView).toHaveBeenCalledOnce() })
  expect(actions.makeDefault).not.toHaveBeenCalled()
})

it.each(['standard', 'mine'])('copies %s into a distinct name and id without changing its composition or the default', async (source) => {
  const actions = view({ authorable: true })
  const label = source === 'standard' ? en.presetStandardName : 'Mine'
  const trigger = within(rowFor(source)).getByRole('button', { name: `${en.copyPreset}: ${label}` })
  trigger.focus()
  fireEvent.click(trigger)
  expect(actions.view).toHaveBeenCalledWith(source)
  const content = '- name: probe\n  disabled: !!js false\n'
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), view: { id: source, title: label, content } }) })
  const dialog = screen.getByRole('dialog', { name: en.copyPreset })
  fireEvent.change(within(dialog).getByRole('textbox', { name: en.presetName }), { target: { value: 'สำเนาของฉัน' } })
  fireEvent.change(within(dialog).getByRole('textbox', { name: en.presetId }), { target: { value: 'my-copy' } })
  fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
  await waitFor(() => { expect(actions.create).toHaveBeenCalledWith(source, 'my-copy', 'สำเนาของฉัน', content) })
  expect(actions.makeDefault).not.toHaveBeenCalled()
  expect(actions.write).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(trigger)
})

it('hides direct creation and copying when the profile cannot author presets', () => {
  view({ authorable: false })
  expect(screen.queryByRole('button', { name: en.createPreset })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Copy preset:/ })).toBeNull()
})

it('offers editing only for profile-owned presets and keeps a draft after a refused save', async () => {
  const actions = view({ authorable: true })
  expect(within(rowFor('standard')).queryByRole('button', { name: `${en.edit}: ${en.presetStandardName}` })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: `${en.edit}: Mine` }))
  expect(actions.view).toHaveBeenCalledWith('mine')
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), view: { id: 'mine', title: 'Mine', content: '[]\n' } }) })
  const dialog = screen.getByRole('dialog', { name: `${en.edit} · Mine` })
  const input = within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: en.composition })
  fireEvent.change(input, { target: { value: '- bad yaml' } })
  actions.write.mockResolvedValueOnce(false)
  fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
  await waitFor(() => { expect(actions.write).toHaveBeenCalledWith('mine', '- bad yaml') })
  expect(input.value).toBe('- bad yaml')
  expect(actions.closeView).not.toHaveBeenCalled()
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), saving: true }) })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(actions.closeView).not.toHaveBeenCalled()
  expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(true)
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), saving: false }) })
  fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
  await waitFor(() => { expect(actions.closeView).toHaveBeenCalledOnce() })
})

it('confirms deletion and keeps the confirmation open on failure', async () => {
  const actions = view({ authorable: true })
  fireEvent.click(screen.getByRole('button', { name: `${en.deletePreset}: Mine` }))
  let dialog = screen.getByRole('dialog', { name: en.deletePreset })
  expect(within(dialog).getByText(en.confirmDelete.replace('{name}', 'Mine'))).toBeTruthy()
  expect(actions.remove).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getAllByRole('button', { name: en.cancel }).at(-1)!)
  expect(screen.queryByRole('dialog', { name: en.deletePreset })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: `${en.deletePreset}: Mine` }))
  dialog = screen.getByRole('dialog', { name: en.deletePreset })
  actions.remove.mockResolvedValueOnce(false)
  fireEvent.click(within(dialog).getByRole('button', { name: en.deletePreset }))
  await waitFor(() => { expect(actions.remove).toHaveBeenCalledWith('mine') })
  expect(screen.getByRole('dialog', { name: en.deletePreset })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: en.deletePreset }))
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: en.deletePreset })).toBeNull() })
})
it('persists built-in visibility and keeps custom presets while the preference changes', () => {
  const actions = view({ rows: [
    { id: 'standard', isDefault: false, trust: 'system' },
    { id: 'mine', name: 'Mine', isDefault: true, trust: 'user' },
    { id: 'ptc', name: 'My PTC', isDefault: false, trust: 'user' },
  ] })
  fireEvent.click(screen.getByRole('switch', { name: en.showBuiltInPresets }))
  expect(actions.setShowBuiltInPresets).toHaveBeenCalledWith(false)
  act(() => { actions.preferences.set({ ...actions.preferences.getSnapshot(), value: { showBuiltInPresets: false } }) })
  expect(document.querySelector('[data-agent-preset-id="standard"]')).toBeNull()
  expect(screen.queryByRole('heading', { name: en.builtInGroup })).toBeNull()
  expect(rowFor('mine')).toBeTruthy()
  expect(rowFor('ptc')).toBeTruthy()
  expect(actions.makeDefault).not.toHaveBeenCalled()
  act(() => { actions.preferences.set({ ...actions.preferences.getSnapshot(), value: { showBuiltInPresets: true } }) })
  expect(rowFor('standard')).toBeTruthy()
})
it.each([false, true])('offers Standard, Creator and custom defaults with Coding Tools %s', (enabled) => {
  const actions = view({ rows: [
    { id: 'standard', isDefault: false, trust: 'system' }, { id: 'ptc', isDefault: false, trust: 'system' },
    { id: 'minimal', isDefault: true, trust: 'system' }, { id: 'cordis', isDefault: false, trust: 'system' },
    { id: 'mine', name: 'Mine', isDefault: false, trust: 'user' },
  ] }, vi.fn(), undefined, enabled)
  expect(screen.queryByRole('button', { name: `${en.setDefault}: ${en.presetPtcName}` }) !== null).toBe(enabled)
  expect(screen.queryByRole('button', { name: `${en.inUse}: ${en.presetMinimalName}` }) !== null).toBe(enabled)
  for (const [id, name] of [['standard', en.presetStandardName], ['cordis', en.presetCordisName], ['mine', 'Mine']]) {
    const button = screen.getByRole<HTMLButtonElement>('button', { name: `${en.setDefault}: ${name}` })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(actions.makeDefault).toHaveBeenLastCalledWith(id)
  }
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.creatorDraft }).disabled).toBe(false)
})
it('updates visible settings choices without writing defaults from the renderer', () => {
  const actions = view({ rows: [
    { id: 'standard', isDefault: false, trust: 'system' }, { id: 'ptc', isDefault: false, trust: 'system' },
    { id: 'minimal', isDefault: true, trust: 'system' }, { id: 'cordis', isDefault: false, trust: 'system' },
  ] })
  const rows = actions.store.getSnapshot().rows
  act(() => { actions.developerTools.set(false) })
  expect(document.querySelector('[data-agent-preset-id="ptc"]')).toBeNull()
  expect(document.querySelector('[data-agent-preset-id="minimal"]')).toBeNull()
  expect(rowFor('standard')).toBeTruthy()
  expect(rowFor('cordis')).toBeTruthy()
  expect(actions.makeDefault).not.toHaveBeenCalled()
  expect(actions.store.getSnapshot().rows).toBe(rows)
  act(() => { actions.developerTools.set(true) })
  expect(screen.getByRole('button', { name: `${en.inUse}: ${en.presetMinimalName}` })).toBeTruthy()
  expect(rowFor('ptc')).toBeTruthy()
})
it.each(['ptc', 'minimal'])('keeps a named custom %s override selectable with Coding Tools off', (id) => {
  const actions = view({ rows: [{ id, name: 'My mode', isDefault: false, trust: 'user' }] }, undefined, undefined, false)
  fireEvent.click(screen.getByRole('button', { name: `${en.setDefault}: My mode` }))
  expect(actions.makeDefault).toHaveBeenCalledWith(id)
})
it('reads the roster once and sets a default from the card body', async () => {
  const actions = view()
  expect(screen.getByRole('switch', { name: en.showBuiltInPresets })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: `${en.setDefault}: Mine` }))
  expect(actions.makeDefault).toHaveBeenCalledWith('mine')
  await waitFor(() =>{  expect(actions.load).toHaveBeenCalledOnce() })
  expect(screen.queryByRole('button', { name: /^Edit plugins/ })).toBeNull()
})
it('replaces the default preset group tag with its new-task default status', () => {
  view()
  const standard = rowFor('standard')
  expect(within(standard).queryByText(en.builtInGroup)).toBeNull()
  expect(within(standard).getByText(en.inUse)).toBeTruthy()
  expect(within(standard).queryByText(en.setDefault)).toBeNull()
  expect(within(rowFor('mine')).getByText(en.customGroup)).toBeTruthy()
})
it('omits an empty group instead of leaving a heading behind', () => {
  view({ rows: [{ id: 'standard', isDefault: true, trust: 'system' }] })
  expect(screen.getByRole('heading', { name: en.builtInGroup })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: en.customGroup })).toBeNull()
})
it('keeps the custom group and its Creator entry while the roster has none', () => {
  view({ rows: [{ id: 'cordis', isDefault: true, trust: 'system' }] }, vi.fn())
  const group = screen.getByRole('heading', { name: en.customGroup }).closest('section')
  expect(group).not.toBeNull()
  expect(within(group!).queryByRole('list')).toBeNull()
  expect(within(group!).getByRole('button', { name: en.creatorDraft })).toBeTruthy()
})
it('launches a Creator-mode task from the entry and closes the settings dialog', () => {
  const launch = vi.fn()
  const actions = view({ rows: [{ id: 'cordis', isDefault: true, trust: 'system' }] }, launch)
  fireEvent.click(screen.getByRole('button', { name: en.creatorDraft }))
  expect(launch).toHaveBeenCalledOnce()
  expect(actions.close).toHaveBeenCalledOnce()
})
it('offers no Creator entry without the conversation flow or the cordis preset', () => {
  view({ rows: [{ id: 'cordis', isDefault: true, trust: 'system' }] })
  expect(screen.queryByRole('button', { name: en.creatorDraft })).toBeNull()
  cleanup()
  view({}, vi.fn())
  expect(screen.queryByRole('button', { name: en.creatorDraft })).toBeNull()
})
it('disables the Creator entry while a default is being saved', () => {
  const launch = vi.fn()
  view({ saving: true, rows: [{ id: 'cordis', isDefault: true, trust: 'system' }] }, launch)
  const button = screen.getByRole<HTMLButtonElement>('button', { name: en.creatorDraft })
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(launch).not.toHaveBeenCalled()
})
it('reads a declared composition read-only from every card, broken ones included', () => {
  const actions = view({ rows: [{ id: 'standard', isDefault: true, trust: 'system' }, { id: 'broken', isDefault: false, broken: 'Missing plugin', trust: 'system' }] })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.view}: ${en.presetStandardName}` }))
  expect(actions.view).toHaveBeenCalledWith('standard')
  fireEvent.click(within(rowFor('broken')).getByRole('button', { name: `${en.view}: broken` }))
  expect(actions.view).toHaveBeenLastCalledWith('broken')
  expect(actions.makeDefault).not.toHaveBeenCalled()
})
it('shows the open composition under the preset display name, without copy, and closes it from the footer', () => {
  const actions = view({ view: { id: 'standard', title: 'standard', content: '- id: tool-fs\n  name: fs\n' } })
  const dialog = screen.getByRole('dialog', { name: `${en.view} · ${en.presetStandardName}` })
  expect(dialog.querySelector('pre')?.textContent).toBe('- id: tool-fs\n  name: fs\n')
  expect(within(dialog).queryByRole('textbox')).toBeNull()
  expect(dialog.querySelectorAll('p')).toHaveLength(0)
  fireEvent.click(within(dialog).getAllByRole('button', { name: en.close }).at(-1)!)
  expect(actions.closeView).toHaveBeenCalledOnce()
  cleanup()
  view({ view: { id: 'gone', title: 'Gone', content: '[]\n' } })
  expect(screen.getByRole('dialog', { name: `${en.view} · Gone` })).toBeTruthy()
})
it('keeps Escape inside the composition viewer when Settings is also open', () => {
  const closeSettings = vi.fn()
  const actions = view({}, undefined, closeSettings)
  const trigger = within(rowFor('standard')).getByRole('button', { name: `${en.view}: ${en.presetStandardName}` })
  trigger.focus()
  fireEvent.click(trigger)
  act(() => { actions.store.set({ ...actions.store.getSnapshot(), view: { id: 'standard', title: 'standard', content: '[]\n' } }) })
  const dialog = screen.getByRole('dialog', { name: `${en.view} · ${en.presetStandardName}` })
  const [header, footer] = within(dialog).getAllByRole('button', { name: en.close })
  expect(document.activeElement).toBe(footer)
  fireEvent.keyDown(footer!, { key: 'Tab' })
  expect(document.activeElement).toBe(header)
  fireEvent.keyDown(header!, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(footer)
  fireEvent.keyDown(footer!, { key: 'Escape' })
  expect(actions.closeView).toHaveBeenCalledOnce()
  expect(closeSettings).not.toHaveBeenCalled()
  expect(actions.close).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(trigger)
})
it('clears an open viewer when the settings section unmounts', () => {
  const actions = view({ view: { id: 'standard', title: 'standard', content: '[]\n' } })
  cleanup()
  expect(actions.closeView).toHaveBeenCalledOnce()
})
it('shows roster errors without hiding the roster', () => {
  const actions = view({ error: 'Roster stale', rows: [
    { id: 'broken', isDefault: false, broken: 'Missing plugin', trust: 'system' },
    { id: 'mine', name: 'Mine', isDefault: false, trust: 'user' },
  ] })
  expect(screen.getAllByRole('alert').map(node => node.textContent)).toEqual(['Roster stale', 'Missing plugin'])
  fireEvent.click(screen.getByRole('button', { name: `${en.setDefault}: Mine` }))
  expect(actions.makeDefault).toHaveBeenCalledWith('mine')
})
it('keeps a broken card focusable for diagnostics and refuses to select it', () => {
  const actions = view({ rows: [{ id: 'broken', isDefault: false, broken: 'Missing plugin', trust: 'system' }] })
  const card = screen.getByRole<HTMLButtonElement>('button', { name: 'Failed to load: broken' })
  expect(card.disabled).toBe(false)
  expect(card.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(card)
  expect(actions.makeDefault).not.toHaveBeenCalled()
})
it.each([
  ['standard', en.presetStandardName, 'How it works', 'Fix a bug'],
  ['ptc', en.presetPtcName, 'How tools are called', 'Check a set of configuration files'],
  ['minimal', en.presetMinimalName, 'What is included', 'Compare performance on a small bug fix'],
  ['cordis', en.presetCordisName, 'What you can create', 'Add a UI'],
])('opens both help sections for %s without changing the default', (id, name, heading, exampleTitle) => {
  const actions = view({ rows: [{ id, isDefault: false, trust: 'system' }] })
  const trigger = within(rowFor(id)).getByRole('button', { name: `${en.modeExplanation}: ${name}` })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name })
  expect(within(dialog).getByRole('heading', { name: heading })).toBeTruthy()
  const usage = within(dialog).getByRole('tab', { name: en.howToUse })
  fireEvent.click(usage)
  expect(usage.getAttribute('aria-selected')).toBe('true')
  expect(within(dialog).getByRole('heading', { name: exampleTitle })).toBeTruthy()
  expect(within(dialog).getAllByText(en.guideExampleTask).length).toBeGreaterThan(0)
  fireEvent.click(within(dialog).getByRole('tab', { name: en.modeExplanation }))
  expect(within(dialog).getByRole('heading', { name: heading })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: en.close }))
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(within(rowFor(id)).getByRole('button', { name: `${en.howToUse}: ${name}` }))
  expect(within(screen.getByRole('dialog')).getByRole('tab', { name: en.howToUse }).getAttribute('aria-selected')).toBe('true')
  expect(actions.makeDefault).not.toHaveBeenCalled()
})
it('keeps keyboard focus in help and dismisses only the reader on Escape', () => {
  const closeSettings = vi.fn()
  const actions = view({}, undefined, closeSettings)
  const trigger = within(rowFor('standard')).getByRole('button', { name: `${en.modeExplanation}: ${en.presetStandardName}` })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: en.presetStandardName })
  const details = within(dialog).getByRole('tab', { name: en.modeExplanation })
  const panel = within(dialog).getByRole('tabpanel', { name: en.modeExplanation })
  const close = within(dialog).getByRole('button', { name: en.close })
  expect(document.activeElement).toBe(details)
  expect(fireEvent.keyDown(details, { key: 'Tab' })).toBe(true)
  panel.focus()
  fireEvent.keyDown(panel, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(panel)
  fireEvent.keyDown(panel, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: en.presetStandardName })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  expect(document.activeElement).toBe(trigger)
  expect(closeSettings).not.toHaveBeenCalled()
  expect(actions.close).not.toHaveBeenCalled()
})
it('connects keyboard selection to the visible guide panel', () => {
  view()
  fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.modeExplanation}: ${en.presetStandardName}` }))
  const dialog = screen.getByRole('dialog')
  const details = within(dialog).getByRole('tab', { name: en.modeExplanation })
  const usage = within(dialog).getByRole('tab', { name: en.howToUse })
  expect(details.tabIndex).toBe(0)
  expect(usage.tabIndex).toBe(-1)
  fireEvent.keyDown(details, { key: 'ArrowRight' })
  const panel = within(dialog).getByRole('tabpanel', { name: en.howToUse })
  expect(panel.id).toBe(usage.getAttribute('aria-controls'))
  expect(document.activeElement).toBe(usage)
  expect(usage.getAttribute('aria-selected')).toBe('true')
  expect(details.tabIndex).toBe(-1)
  expect(usage.tabIndex).toBe(0)
  expect(within(dialog).queryByRole('tabpanel', { name: en.modeExplanation })).toBeNull()
})
it('does not attach built-in claims to named or unknown presets', () => {
  view({ rows: [{ id: 'ptc', name: 'My PTC', isDefault: false, trust: 'user' }, { id: 'third-party', isDefault: false, trust: 'system' }] })
  expect(screen.queryByRole('button', { name: new RegExp(en.modeExplanation) })).toBeNull()
  expect(screen.queryByRole('button', { name: new RegExp(en.howToUse) })).toBeNull()
})
it('leaves help usable while a default is being saved', () => {
  const actions = view({ saving: true })
  fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.howToUse}: ${en.presetStandardName}` }))
  expect(screen.getByRole('dialog', { name: en.presetStandardName })).toBeTruthy()
  expect(actions.makeDefault).not.toHaveBeenCalled()
})
it('closes help even when the browser reports no previously focused element', () => {
  const descriptor: TypedPropertyDescriptor<Element | null> = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')!
  const readActiveElement = descriptor.get!.bind(document)
  // Only the initial unfocused body is absent; modal controls must observe subsequent focus.
  const activeElement = vi.spyOn(document, 'activeElement', 'get').mockImplementation(() => {
    const focused = readActiveElement()
    return focused === document.body ? null : focused
  })
  try {
    view()
    fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.modeExplanation}: ${en.presetStandardName}` }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
  } finally {
    activeElement.mockRestore()
  }
})
it.each([false, true])('only offers a description tooltip when the card clips it: %s', (overflow) => {
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(overflow ? 400 : 80)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(80)
  const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
  vi.useFakeTimers()
  view({ rows: [{ id: 'mine', isDefault: false, description: 'Preset description', trust: 'user' }] })
  fireEvent.pointerEnter(screen.getByText('Preset description'))
  act(() => { vi.advanceTimersByTime(400) })
  expect(screen.queryByRole('tooltip')?.textContent ?? null).toBe(overflow ? 'Preset description' : null)
  cleanup()
  expect(disconnect).toHaveBeenCalledTimes(overflow ? 2 : 1)
})
it('renders descriptions and allows selection without resize observation', () => {
  vi.stubGlobal('ResizeObserver', undefined)
  const actions = view({ rows: [{ id: 'mine', name: 'Mine', isDefault: false, description: 'Preset description', trust: 'user' }] })
  expect(screen.getByText('Preset description')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: `${en.setDefault}: Mine` }))
  expect(actions.makeDefault).toHaveBeenCalledWith('mine')
})
