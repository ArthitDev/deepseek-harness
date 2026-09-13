// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { AgentPresetSection, type AgentPresetSectionProps } from '../src/client/AgentPresetSection.tsx'
import type { AgentPresetSectionState } from '../src/client/section-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const READY: AgentPresetSectionState = {
  status: 'ready',
  error: null,
  authorable: true,
  hasDocument: true,
  rows: [
    { id: 'standard', trust: 'system', isDefault: true, name: '标准模式', description: '完整的编码 agent。' },
    { id: 'mine', trust: 'user', isDefault: false },
  ],
  models: [],
  modelPresets: {},
  binding: false,
  copy: null,
  create: null,
  view: null,
  pendingDelete: null,
  deleting: false,
  revealedPaths: {},
}

const SYSTEM_VIEW = {
  id: 'standard', title: '标准模式', content: '- id: tool-bash\n', draft: '- id: tool-bash\n',
  savedDraft: '- id: tool-bash\n', editable: false, saving: false, error: null,
}

/**
 * Render the section over a fixed snapshot, with every action a spy.
 * @param state - the snapshot to render.
 * @returns the spies, so a test can assert what a click reached.
 */
function renderSection(
  state: Partial<AgentPresetSectionState> = {},
  options: { creator?: boolean } = {},
) {
  const store = createSnapshotStore<AgentPresetSectionState>({ ...READY, ...state })
  const actions = {
    load: vi.fn(() => Promise.resolve()),
    // The shell-owned section affordance (SettingsSectionOwnerProps.close).
    close: vi.fn(),
    ...options.creator === false ? {} : { startCreatorDraft: vi.fn() },
    view: vi.fn(() => Promise.resolve()),
    closeView: vi.fn(),
    setViewContent: vi.fn(),
    saveView: vi.fn(() => Promise.resolve()),
    beginCopy: vi.fn(),
    cancelCopy: vi.fn(),
    setCopyId: vi.fn(),
    setCopyName: vi.fn(),
    confirmCopy: vi.fn(() => Promise.resolve()),
    openLocation: vi.fn(() => Promise.resolve()),
    confirmDelete: vi.fn(),
    remove: vi.fn(() => Promise.resolve()),
    makeDefault: vi.fn(() => Promise.resolve()),
    bindModel: vi.fn(() => Promise.resolve()),
  }
  const props = {
    ...actions,
    useAgentPresetSection: bindSnapshotSelector(store),
    useDeveloperTools: bindSnapshotSelector(createSnapshotStore(developerTools)),
    t: key => translations.get(key) ?? key }
  render(<AgentPresetSection {...props} />)
  return actions
}
function rowFor(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-agent-preset-id="${id}"]`)
  if (row === null) throw new Error(`no card for ${id}`)
  return row
}

describe('the preset list', () => {
  it('reads the roster once when it first renders', async () => {
    const actions = renderSection()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
  })

  it('shows resolved copy for built-ins and falls back to custom ids', () => {
    renderSection()

    // Display copy is what a picker reads; the id stays visible as the key the
    // composition and the session header actually carry.
    expect(screen.getByText(en.presetStandardName)).toBeTruthy()
    expect(screen.getByText(en.presetStandardDescription)).toBeTruthy()
    const mine = rowFor('mine')
    expect(within(mine).getAllByText('mine').length).toBeGreaterThan(0)
    expect(within(mine).getByText(en.noDescription)).toBeTruthy()
  })

  it('assigns models from each preset card', () => {
    const actions = renderSection({
      models: [{ provider: 'provider', providerName: 'Provider', id: 'model', name: 'Model' }],
      modelPresets: { provider: { model: 'mine' } },
    })
    const standard = within(rowFor('standard'))
      .getByRole('checkbox', { name: `${en.presetStandardName}: Provider / Model` })
    const mine = within(rowFor('mine')).getByRole('checkbox', { name: 'mine: Provider / Model' })
    const models = within(rowFor('standard')).getByText(`${en.modelBindings} (1)`).closest('details')

    expect(models).toHaveProperty('open', false)
    fireEvent.click(within(rowFor('standard')).getByText(`${en.modelBindings} (1)`))
    expect(models).toHaveProperty('open', true)
    expect(standard).toHaveProperty('checked', false)
    expect(mine).toHaveProperty('checked', true)
    fireEvent.click(standard)
    fireEvent.click(mine)

    expect(actions.bindModel).toHaveBeenNthCalledWith(1, 'provider', 'model', 'standard')
    expect(actions.bindModel).toHaveBeenNthCalledWith(2, 'provider', 'model', undefined)

    cleanup()
    const defaults = renderSection({
      models: [{ provider: 'provider', providerName: 'Provider', id: 'model', name: 'Model' }],
    })
    const fallback = within(rowFor('standard'))
      .getByRole('checkbox', { name: `${en.presetStandardName}: Provider / Model` })
    const custom = within(rowFor('mine')).getByRole('checkbox', { name: 'mine: Provider / Model' })
    expect(fallback).toHaveProperty('checked', false)
    expect(fallback).toHaveProperty('disabled', false)
    expect(custom).toHaveProperty('checked', false)
    fireEvent.click(fallback)
    fireEvent.click(custom)
    expect(defaults.bindModel).toHaveBeenNthCalledWith(1, 'provider', 'model', 'standard')
    expect(defaults.bindModel).toHaveBeenNthCalledWith(2, 'provider', 'model', 'mine')

    cleanup()
    const explicitDefault = renderSection({
      models: [{ provider: 'provider', providerName: 'Provider', id: 'model', name: 'Model' }],
      modelPresets: { provider: { model: 'standard' } },
    })
    const boundDefault = within(rowFor('standard'))
      .getByRole('checkbox', { name: `${en.presetStandardName}: Provider / Model` })
    expect(boundDefault).toHaveProperty('checked', true)
    expect(boundDefault).toHaveProperty('disabled', false)
    fireEvent.click(boundDefault)
    expect(explicitDefault.bindModel).toHaveBeenCalledWith('provider', 'model', undefined)
  })

  it('marks trust and the one in use, and offers no "set default" on it', () => {
    renderSection()

    const standard = rowFor('standard')
    expect(within(standard).getByText(en.builtIn)).toBeTruthy()
    expect(within(standard).getByText(en.inUse)).toBeTruthy()
    expect(within(standard).queryByText(en.setDefault)).toBeNull()
    expect(within(rowFor('mine')).getByText(en.userTrust)).toBeTruthy()
  })

  it('separates built-in presets from custom ones', () => {
    renderSection()

    // Two different things: one set ships with the deployment and is
    // read-only, the other is the user's own.
    expect(screen.getByRole('heading', { name: en.builtInGroup })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.customGroup })).toBeTruthy()
  })

  it('shows no group heading for a set nobody has', () => {
    renderSection({ rows: [{ id: 'standard', trust: 'system', isDefault: true }] })

    expect(screen.queryByRole('heading', { name: en.customGroup })).toBeNull()
  })

  it('leads with the two ways a preset is created', () => {
    renderSection()

    // The page has no create button: the intro is what tells a first-time
    // reader that copying an existing preset — or drafting one in Creator
    // mode — IS the way to make one.
    expect(screen.getByText(new RegExp('Creator mode'))).toBeTruthy()
  })

  it('picks a preset by clicking its card, and the one in use is inert', () => {
    const actions = renderSection()

    const inUse = within(rowFor('standard')).getByRole('button', { name: `${en.inUse}: ${en.presetStandardName}` })
    expect(inUse).toHaveProperty('disabled', true)
    fireEvent.click(inUse)

    // Clicking the card IS the choice; the preset already in use cannot be
    // re-picked, so the click reaches nothing.
    expect(actions.makeDefault).not.toHaveBeenCalled()
  })

  it('offers View on a shipped row and Edit plus location on a custom one', () => {
    renderSection()

    // A shipped preset is the read-only composition a copy starts from. A
    // custom preset has both the composition editor and its directory action.
    const standard = rowFor('standard')
    expect(within(standard).getByRole('button', { name: `${en.view}: ${en.presetStandardName}` })).toBeTruthy()
    expect(within(standard).queryByRole('button', { name: `${en.openLocation}: ${en.presetStandardName}` })).toBeNull()
    const mine = rowFor('mine')
    expect(within(mine).getByRole('button', { name: `${en.openLocation}: mine` })).toBeTruthy()
    expect(within(mine).getByRole('button', { name: `${en.edit}: mine` })).toBeTruthy()
  })

  it('offers Delete only for a locally authored preset', () => {
    renderSection()

    expect(within(rowFor('mine')).getByRole('button', { name: `${en.delete}: mine` })).toBeTruthy()
    expect(within(rowFor('standard')).queryByRole('button', { name: `${en.delete}: ${en.presetStandardName}` })).toBeNull()
  })

  it('disables duplication when nothing is writable, and says why', () => {
    renderSection({ authorable: false })

    const duplicate = within(rowFor('standard')).getByRole('button', { name: `${en.duplicate}: ${en.presetStandardName}` })
    expect(duplicate).toHaveProperty('disabled', true)
    expect(duplicate.getAttribute('data-tip')).toBe(en.duplicateUnavailable)
  })

  it('marks a broken custom preset: unselectable, uncopyable, still deletable', () => {
    const actions = renderSection({
      rows: [
        { id: 'standard', trust: 'system', isDefault: true },
        {
          id: 'ghost', trust: 'user', isDefault: false, name: '幽灵预设', description: '我自己写的',
          broken: 'the composition file agent.cordis.yml is missing',
        },
      ],
    })

    const ghost = rowFor('ghost')
    // The badge carries the reason for a pointer, and the body cannot pick
    // what cannot mount.
    expect(within(ghost).getByText(en.brokenBadge).textContent)
      .toBe(`${en.brokenBadge}the composition file agent.cordis.yml is missing`)
    // A picker card keeps showing what the preset is; a package specifier in
    // its place would tell a chooser nothing they can act on there.
    expect(within(ghost).getByText('我自己写的')).toBeTruthy()
    // Reachable without a pointer: the disabled body leaves the tab order, so
    // this node is the only reading assistive technology gets.
    expect(within(ghost).getByRole('alert').textContent).toContain('is missing')
    // `aria-disabled`, not `disabled`: the card stays in the tab order so a
    // keyboard reaches the reason the face no longer shows, and refuses the
    // pick itself rather than by being unreachable.
    const body = within(ghost).getByRole('button', { name: `${en.brokenBadge}: 幽灵预设` })
    expect(body).toHaveProperty('disabled', false)
    expect(body.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(body)
    expect(actions.makeDefault).not.toHaveBeenCalled()
    // Copying a broken preset would only mint another broken one; deleting
    // and the location remain — the files are where it gets fixed.
    const duplicate = within(ghost).getByRole('button', { name: `${en.duplicate}: 幽灵预设` })
    expect(duplicate).toHaveProperty('disabled', true)
    expect(duplicate.getAttribute('data-tip')).toBe(en.brokenNoCopy)
    expect(within(ghost).getByRole('button', { name: `${en.delete}: 幽灵预设` })).toBeTruthy()
    expect(within(ghost).getByRole('button', { name: `${en.openLocation}: 幽灵预设` })).toBeTruthy()
  })

  it('withholds the viewer on a broken shipped preset', () => {
    renderSection({
      rows: [{ id: 'standard', trust: 'system', isDefault: false, name: '标准模式', broken: 'the composition is not valid YAML' }],
    })

    // There is no readable composition to offer; the reason on the card is
    // the whole story a shipped row can tell.
    const standard = rowFor('standard')
    expect(within(standard).queryByRole('button', { name: `${en.view}: ${en.presetStandardName}` })).toBeNull()
    expect(within(standard).getByRole('alert').textContent).toContain('not valid YAML')
  })

  it('labels the location by what it will do without a desktop', () => {
    renderSection({ hasDocument: false })

    expect(within(rowFor('mine')).getByRole('button', { name: `${en.showLocation}: mine` })).toBeTruthy()
  })

  it('shows a revealed directory on its row', () => {
    renderSection({ revealedPaths: { mine: '/home/user/.dsh/.agent-presets/mine' } })

    const mine = rowFor('mine')
    expect(within(mine).getByText('/home/user/.dsh/.agent-presets/mine')).toBeTruthy()
    expect(within(mine).getByText(en.revealedPathLabel)).toBeTruthy()
    // The reveal belongs to its row alone.
    expect(within(rowFor('standard')).queryByText(en.revealedPathLabel)).toBeNull()
  })

  it('routes the row actions to the controller', () => {
    const actions = renderSection()

    // The card body is the control that picks a preset.
    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.setDefault}: mine` }))
    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.openLocation}: mine` }))
    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.duplicate}: mine` }))
    fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.view}: ${en.presetStandardName}` }))

    expect(actions.makeDefault).toHaveBeenCalledWith('mine')
    expect(actions.openLocation).toHaveBeenCalledWith('mine')
    expect(actions.beginCopy).toHaveBeenCalledWith('mine')
    expect(actions.view).toHaveBeenCalledWith('standard')
  })

  it('starts a creator-mode draft session and leaves settings', () => {
    const actions = renderSection({
      rows: [...READY.rows, { id: 'cordis', trust: 'system', isDefault: false, name: '创造模式' }],
    })

    fireEvent.click(screen.getByRole('button', { name: en.creatorDraft }))

    expect(actions.startCreatorDraft).toHaveBeenCalledTimes(1)
    // Leaving settings is part of the gesture: the flow lands in the new
    // session, not behind the modal.
    expect(actions.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the empty custom group on screen: heading plus the creator entry', () => {
    renderSection({
      rows: [
        { id: 'standard', trust: 'system', isDefault: true, name: '标准模式' },
        { id: 'cordis', trust: 'system', isDefault: false, name: '创造模式' },
      ],
    })

    // No member yet, but the place where one's own preset will appear stays.
    expect(screen.getByRole('heading', { name: en.customGroup })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.creatorDraft })).toBeTruthy()
    expect(screen.queryByText(`· ${en.userTrust}`)).toBeNull()
  })

  it('hides the creator entry without the flow or the preset, disables it without a root', () => {
    renderSection()
    expect(screen.queryByRole('button', { name: en.creatorDraft })).toBeNull()
    cleanup()

    renderSection({
      rows: [...READY.rows, { id: 'cordis', trust: 'system', isDefault: false, name: '创造模式' }],
    }, { creator: false })
    expect(screen.queryByRole('button', { name: en.creatorDraft })).toBeNull()
    cleanup()

    const actions = renderSection({
      authorable: false,
      rows: [...READY.rows, { id: 'cordis', trust: 'system', isDefault: false, name: '创造模式' }],
    })
    const disabled = screen.getByRole('button', { name: en.creatorDraft })
    expect(disabled).toHaveProperty('disabled', true)
    fireEvent.click(disabled)
    expect(actions.startCreatorDraft).not.toHaveBeenCalled()
  })

  it('shows a page-level failure without hiding the list', () => {
    renderSection({ error: 'settings are read-only' })

    expect(screen.getByRole('alert').textContent).toBe('settings are read-only')
    expect(rowFor('mine')).toBeTruthy()
  })

  it('renders nothing when the deployment composes no presets', () => {
    const { container } = render(<AgentPresetSection {...({
      useAgentPresetSection: bindSnapshotSelector(
        createSnapshotStore<AgentPresetSectionState>({ ...READY, status: 'unavailable', rows: [] })),
      t: (key: keyof typeof en) => en[key],
      load: vi.fn(() => Promise.resolve()),
    } as unknown as AgentPresetSectionProps)} />)

    expect(container.firstChild).toBeNull()
  })

  it('offers a retry when the roster could not be read', () => {
    const actions = renderSection({ status: 'error', error: 'roster unavailable' })

    expect(screen.getByRole('alert').textContent).toContain('roster unavailable')
    fireEvent.click(screen.getByText(en.retry))

    expect(actions.load).toHaveBeenCalledTimes(2)
  })
})
it('reads the roster once and sets a default from the card body', async () => {
  const actions = view()
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
  view({ rows: [{ id: 'standard', isDefault: true }] })
  expect(screen.getByRole('heading', { name: en.builtInGroup })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: en.customGroup })).toBeNull()
})
it('keeps the custom group and its Creator entry while the roster has none', () => {
  view({ rows: [{ id: 'cordis', isDefault: true }] }, vi.fn())
  const group = screen.getByRole('heading', { name: en.customGroup }).closest('section')
  expect(group).not.toBeNull()
  expect(within(group!).queryByRole('list')).toBeNull()
  expect(within(group!).getByRole('button', { name: en.creatorDraft })).toBeTruthy()
})
it('launches a Creator-mode task from the entry and closes the settings dialog', () => {
  const launch = vi.fn()
  const actions = view({ rows: [{ id: 'cordis', isDefault: true }] }, launch)
  fireEvent.click(screen.getByRole('button', { name: en.creatorDraft }))
  expect(launch).toHaveBeenCalledOnce()
  expect(actions.close).toHaveBeenCalledOnce()
})
it('offers no Creator entry without the conversation flow or the cordis preset', () => {
  view({ rows: [{ id: 'cordis', isDefault: true }] })
  expect(screen.queryByRole('button', { name: en.creatorDraft })).toBeNull()
  cleanup()
  view({}, vi.fn())
  expect(screen.queryByRole('button', { name: en.creatorDraft })).toBeNull()
})
it('disables the Creator entry when mode selection is hidden', () => {
  const launch = vi.fn()
  view({ showPicker: false, rows: [{ id: 'cordis', isDefault: true }] }, launch)
  const button = screen.getByRole<HTMLButtonElement>('button', { name: en.creatorDraft })
  expect(button.disabled).toBe(true)
  expect(button.title).toBe(en.enablePickerToCreate)
  fireEvent.click(button)
  expect(launch).not.toHaveBeenCalled()
})
it('shows roster errors while the policy switch stays usable', () => {
  const actions = view({ error: 'Roster stale', rows: [{ id: 'broken', isDefault: false, broken: 'Missing plugin' }] })
  expect(screen.getAllByRole('alert').map(node => node.textContent)).toEqual(['Roster stale', 'Missing plugin'])
  fireEvent.click(screen.getByRole('switch'))
  expect(actions.setPickerVisible).toHaveBeenCalledWith(false)
})
it('identifies the effective default when the picker is hidden', () => {
  view({ showPicker: false })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: `${en.selectionOffDefault}: ${en.presetStandardName}` }).disabled).toBe(true)
})
it('keeps a broken card focusable for diagnostics and refuses to select it', () => {
  const actions = view({ rows: [{ id: 'broken', isDefault: false, broken: 'Missing plugin' }] })
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
  const actions = view({ rows: [{ id, isDefault: false }] })
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
  const actions = view()
  const trigger = within(rowFor('standard')).getByRole('button', { name: `${en.modeExplanation}: ${en.presetStandardName}` })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog')
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
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
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
  view({ rows: [{ id: 'ptc', name: 'My PTC', isDefault: false }, { id: 'third-party', isDefault: false }] })
  expect(screen.queryByRole('button', { name: new RegExp(en.modeExplanation) })).toBeNull()
  expect(screen.queryByRole('button', { name: new RegExp(en.howToUse) })).toBeNull()
})
it('leaves help usable when mode selection is disabled', () => {
  const actions = view({ showPicker: false })
  fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.howToUse}: ${en.presetStandardName}` }))
  expect(screen.getByRole('dialog', { name: en.presetStandardName })).toBeTruthy()
  expect(actions.setPickerVisible).not.toHaveBeenCalled()
})
it('closes help even when the browser reports no previously focused element', () => {
  const activeElement = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null)
  try {
    view()
    fireEvent.click(within(rowFor('standard')).getByRole('button', { name: `${en.modeExplanation}: ${en.presetStandardName}` }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
  } finally {
    activeElement.mockRestore()
  }
})

describe('the read-only viewer', () => {
  it('shows the composition text under the preset\'s name', () => {
    renderSection({ view: SYSTEM_VIEW })

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe(`${en.view} · ${en.presetStandardName}`)
    expect(within(dialog).getByText(en.composition)).toBeTruthy()
    expect(within(dialog).getByText(/tool-bash/).textContent).toBe('- id: tool-bash\n')
  })

  it('keeps the loaded title when the viewed row leaves the roster', () => {
    renderSection({ view: { ...SYSTEM_VIEW, id: 'retired', title: 'Retired mode' } })

    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(`${en.view} · Retired mode`)
  })

  it('closes through the controller', () => {
    const actions = renderSection({ view: SYSTEM_VIEW })

    fireEvent.click(within(screen.getByRole('dialog')).getByText(en.close))

    expect(actions.closeView).toHaveBeenCalledTimes(1)
  })

  it('dismisses on Escape', () => {
    const actions = renderSection({ view: SYSTEM_VIEW })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(actions.closeView).toHaveBeenCalledTimes(1)
  })
})

describe('the custom preset editor', () => {
  it('edits and saves the system prompt while preserving a write error', () => {
    const actions = renderSection({
      view: {
        id: 'mine', title: 'mine', content: '- id: persona\n', draft: 'New prompt', savedDraft: 'Old prompt',
        editable: true, saving: false, error: 'disk full',
      },
    })

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe(`${en.editSystemPrompt} · mine`)
    expect(within(dialog).getByText(en.systemPromptHelp)).toBeTruthy()
    const editor = within(dialog).getByRole('textbox', { name: en.systemPrompt })
    expect(editor).toHaveProperty('value', 'New prompt')
    expect(within(dialog).getByRole('alert').textContent).toBe('disk full')
    fireEvent.change(editor, { target: { value: 'Changed: # plain text' } })
    fireEvent.click(within(dialog).getByText(en.save))

    expect(actions.setViewContent).toHaveBeenCalledWith('Changed: # plain text')
    expect(actions.saveView).toHaveBeenCalledTimes(1)
  })
})

describe('deleting a preset', () => {
  it('asks before deleting', () => {
    const actions = renderSection()

    fireEvent.click(within(rowFor('mine')).getByRole('button', { name: `${en.delete}: mine` }))

    expect(actions.confirmDelete).toHaveBeenCalledWith('mine')
  })

  it('confirms and dismisses through the controller', () => {
    const actions = renderSection({ pendingDelete: 'mine' })

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText(en.deleteConfirm))
    fireEvent.click(within(dialog).getByText(en.cancel))

    expect(actions.remove).toHaveBeenCalledTimes(1)
    expect(actions.confirmDelete).toHaveBeenLastCalledWith(null)
  })

  it('dismisses the confirmation on Escape', () => {
    const actions = renderSection({ pendingDelete: 'mine' })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(actions.confirmDelete).toHaveBeenCalledWith(null)
  })

  it('reports a delete in flight', () => {
    const actions = renderSection({ pendingDelete: 'mine', deleting: true })

    fireEvent.click(within(screen.getByRole('dialog')).getByText(en.deleting))

    expect(actions.remove).not.toHaveBeenCalled()
  })
})

describe('a long card description', () => {
  /** jsdom has no ResizeObserver; the description watches its own box through one. */
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  const LONG = '始终用简体中文交流的友好通用助手，提供持久 bash 与文件编辑能力。'.repeat(8)

  /** Force the clamp to report an overflow: jsdom lays nothing out, so both heights are 0. */
  function clamp(overflowing: boolean): void {
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(overflowing ? 400 : 80)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(80)
  }

  beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('offers the whole description on hover once the card cuts it off', () => {
    clamp(true)
    vi.useFakeTimers()
    try {
      renderSection({ rows: [{ id: 'zh', trust: 'user', isDefault: false, name: '中文助手', description: LONG }] })

      fireEvent.mouseEnter(within(rowFor('zh')).getByText(LONG))
      act(() => { vi.advanceTimersByTime(400) })

      expect(screen.getByRole('tooltip').textContent).toBe(LONG)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays quiet when the description already fits', () => {
    clamp(false)
    vi.useFakeTimers()
    try {
      renderSection({ rows: [{ id: 'zh', trust: 'user', isDefault: false, name: '中文助手', description: '短描述。' }] })

      fireEvent.mouseEnter(within(rowFor('zh')).getByText('短描述。'))
      act(() => { vi.advanceTimersByTime(400) })

      // A bubble repeating what is already fully on the card is noise.
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders where the runtime has no ResizeObserver', () => {
    vi.unstubAllGlobals()
    clamp(true)

    expect(() => {
      renderSection({ rows: [{ id: 'zh', trust: 'user', isDefault: false, description: LONG }] })
    }).not.toThrow()
    // The first measurement does not depend on the observer.
    expect(within(rowFor('zh')).getByText(LONG).getAttribute('title')).toBe('')
  })
})
