/**
 * Agent-preset management controller: the roster as a list, create and copy dialogs,
 * a read-only viewer over shipped compositions, and a custom-preset editor.
 *
 * Direct creation keeps the default preset's tools and replaces its persona
 * prompt in one Host operation. Composition writes name only a preset id; the
 * Host resolves its user-root path.
 *
 * The host stays the single fact source. Every mutation writes through the
 * wire and the page re-reads the roster afterwards, because a copy changes
 * more than the row it targeted.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { beginRosterRead, writeDefaultPreset } from './settings-store.ts'

/** Ids a preset directory may be named, mirroring the host's own rule. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** One preset row the page renders. */
export interface PresetRow {
  /** Preset id and directory name; the display name falls back to it. */
  id: string
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
  /** Whether the preset ships with the deployment or was authored locally. */
  trust: 'system' | 'user'
  /** Whether a session that names no preset gets this one. */
  isDefault: boolean
  /**
   * Why the preset cannot compose a session, absent when it can. A broken
   * row renders marked and unselectable — its directory still occupies the
   * id, so deleting it (or fixing the files) is the way out, and this page
   * is where both of those live.
   */
  broken?: string
}

/** The copy dialog: a new id and optional display name over a fixed source. */
export interface CopyDraft {
  /** The preset being copied. */
  from: string
  /** Display name of the source, for the dialog title. */
  fromTitle: string
  /** New preset id being typed; the directory name, so it is required. */
  id: string
  /** Display name being typed; empty falls back to the id. */
  name: string
  /** Whether the copy is in flight. */
  saving: boolean
  /** The last copy failure, cleared by the next edit. */
  error: string | null
}

/** A preset created directly from an id, display name, and system prompt. */
export interface CreateDraft {
  /** New preset id being typed; the directory name, so it is required. */
  id: string
  /** Display name being typed; empty falls back to the id. */
  name: string
  /** Persona prompt stored in the new preset. */
  prompt: string
  /** Whether creation is in flight. */
  saving: boolean
  /** Last creation failure, cleared by the next edit. */
  error: string | null
}

/** The composition viewer or editor over one preset. */
export interface PresetView {
  /** The preset whose composition is shown. */
  id: string
  /** Display name, for the dialog title. */
  title: string
  /** Composition text exactly as stored. */
  content: string
  /** Current editor text. */
  draft: string
  /** Prompt text currently stored in the composition. */
  savedDraft: string
  /** Whether this document belongs to the writable user root. */
  editable: boolean
  /** Whether a write is in flight. */
  saving: boolean
  /** Last write failure, kept beside the draft. */
  error: string | null
}

interface PersonaTextField {
  readonly prompt: string
  readonly startLine: number
  readonly endLine: number
  readonly newline: string
}

/** Locate the persona prompt without parsing or rewriting the rest of the YAML. */
function personaTextField(content: string): PersonaTextField {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const persona = lines.findIndex(line => /^- id:\s*persona\s*$/.test(line))
  if (persona < 0) throw new Error('This preset has no "persona" row.')
  const rowEnd = lines.findIndex((line, index) => index > persona && /^-\s/.test(line))
  const limit = rowEnd < 0 ? lines.length : rowEnd
  const startLine = lines.findIndex((line, index) =>
    index > persona && index < limit && /^ {4}text:/.test(line))
  if (startLine < 0) throw new Error('The "persona" row has no config.text system prompt.')

  const value = lines[startLine]?.replace(/^ {4}text:\s*/, '') ?? ''
  if (!/^[>|][+-]?(?:\s+#.*)?$/.test(value)) {
    const trimmed = value.trim()
    const prompt = trimmed.startsWith("'") && trimmed.endsWith("'")
      ? trimmed.slice(1, -1).replace(/''/g, "'")
      : trimmed.startsWith('"') && trimmed.endsWith('"')
        ? JSON.parse(trimmed) as string
        : trimmed
    return { prompt, startLine, endLine: startLine + 1, newline }
  }

  let endLine = startLine + 1
  while (endLine < limit) {
    const line = lines[endLine] ?? ''
    if (line !== '' && !line.startsWith('      ')) break
    endLine += 1
  }
  const promptLines = lines.slice(startLine + 1, endLine)
    .map(line => line === '' ? '' : line.slice(6))
  while (promptLines.at(-1) === '') promptLines.pop()
  return { prompt: promptLines.join('\n'), startLine, endLine, newline }
}

/**
 * Replace only the persona prompt, encoding arbitrary text as a YAML literal.
 * @param content - The complete preset composition.
 * @param prompt - The replacement persona prompt.
 * @returns The composition with only the persona prompt replaced.
 */
export function replacePersonaPrompt(content: string, prompt: string): string {
  const field = personaTextField(content)
  const lines = content.split(/\r?\n/)
  const replacement = ['    text: |-', ...prompt.replace(/\r\n?/g, '\n').split('\n').map(line => `      ${line}`)]
  lines.splice(field.startLine, field.endLine - field.startLine, ...replacement)
  return lines.join(field.newline)
}

/** Page snapshot. */
export interface AgentPresetSectionState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** Whole-load failure text; a copy failure stays on the dialog. */
  error: string | null
  /** Whether the deployment configures a root new presets can be written to. */
  authorable: boolean
  /** Whether the host can open a preset directory on a native desktop. */
  hasDocument: boolean
  /** Every preset the deployment currently supplies. */
  rows: readonly PresetRow[]
  /** The open copy dialog, or null. */
  copy: CopyDraft | null
  /** The open direct-create dialog, or null. */
  create: CreateDraft | null
  /** The open composition viewer or editor, or null. */
  view: PresetView | null
  /** The preset awaiting delete confirmation. */
  pendingDelete: string | null
  /** Whether a delete is in flight. */
  deleting: boolean
  /**
   * Preset directories shown as text because the host has no desktop opener
   * — the answer `openDocument` gives instead of opening.
   */
  revealedPaths: Readonly<Record<string, string>>
}

const INITIAL: AgentPresetSectionState = {
  status: 'idle',
  error: null,
  authorable: false,
  hasDocument: false,
  rows: [],
  copy: null,
  create: null,
  view: null,
  pendingDelete: null,
  deleting: false,
  revealedPaths: {},
}

/**
 * Why this copy cannot be submitted yet, as a locale key, or undefined when
 * it can. Client-side only: the host re-checks the id and its answer is what
 * the dialog reports on failure.
 * @param draft - the open copy dialog.
 * @param rows - the roster, for the collision check.
 * @returns the blocking reason's locale key, or undefined when submittable.
 */
export function draftBlocker(
  draft: Pick<CopyDraft, 'id'>,
  rows: readonly PresetRow[],
): 'idRequired' | 'idInvalid' | 'idTaken' | undefined {
  if (draft.id === '') return 'idRequired'
  if (!PRESET_ID.test(draft.id)) return 'idInvalid'
  // A copy never overwrites: landing on a name already in use would replace
  // something the user did not open.
  if (rows.some(row => row.id === draft.id)) return 'idTaken'
  return undefined
}

/** Reads the roster and drives the copy dialog, viewer, and location reveals. */
export class AgentPresetSectionController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSectionState> = createSnapshotStore(INITIAL)

  constructor(
    private readonly ctx: ClientContext,
    /**
     * Called after this page changes the roster DIRECTORY, so the other
     * surfaces reading the same roster re-read it. A settings field moving is
     * already announced by the host through the forwarded
     * `settings/document-updated`; a directory copied or deleted here is not,
     * and the new-session chip has no other way to learn a preset it should
     * offer now exists.
     */
    private readonly rosterChanged: () => void = () => {},
  ) {}

  private set(patch: Partial<AgentPresetSectionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private patchCopy(patch: Partial<CopyDraft>): void {
    const { copy } = this.store.getSnapshot()
    if (copy === null) return
    this.set({ copy: { ...copy, ...patch } })
  }

  private patchCreate(patch: Partial<CreateDraft>): void {
    const { create } = this.store.getSnapshot()
    if (create === null) return
    this.set({ create: { ...create, ...patch } })
  }

  private patchView(patch: Partial<PresetView>): void {
    const { view } = this.store.getSnapshot()
    if (view === null) return
    this.set({ view: { ...view, ...patch } })
  }

  /**
   * Load the roster. An empty roster means the deployment composes no
   * presets, which is a valid deployment rather than a failure — the section
   * reports `unavailable` and renders nothing.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    // Whether a preset's directory can be opened is the Host's opener
    // capability rather than a roster property, so the page joins the two.
    // Issued together: one round trip decides the page, and a load that waited
    // for them in turn would hold the section in `loading` twice as long,
    // where a concurrent reload silently returns instead of refreshing.
    const opener = this.ctx.remote.settings.canOpenAgentPresetDirectory()
    const roster = await beginRosterRead(this.ctx, this.store)
    // A refused describe leaves the reveal-the-path path, which needs no opener.
    const described = await opener
    if (roster === undefined) return
    const { presets, authorable } = roster
    const hasDocument = described.ok && described.value
    if (presets.length === 0) {
      // Nothing to manage leaves nothing to keep a dialog open over.
      this.set({ status: 'unavailable', rows: [], authorable, hasDocument, copy: null, create: null, view: null })
      return
    }
    // A reveal outlives a reload but not its preset: a path for a row the
    // roster no longer lists would be a claim about a directory that is gone.
    const revealed = this.store.getSnapshot().revealedPaths
    const kept = Object.fromEntries(
      Object.entries(revealed).filter(([id]) => presets.some(preset => preset.id === id)))
    this.set({
      status: 'ready',
      error: null,
      authorable,
      hasDocument,
      rows: presets.map(preset => ({ ...preset })),
      revealedPaths: kept,
    })
  }

  /**
   * Open one preset's composition in the viewer or editor.
   * @param id - the preset to view.
   * @returns once the composition loaded or the failure is on the page.
   */
  async view(id: string): Promise<void> {
    this.set({ error: null })
    const result = await this.ctx.remote.agentPresets.read(id)
    if (!result.ok) {
      this.set({ error: result.error.message })
      return
    }
    const { name, content, trust } = result.value
    let draft = content
    if (trust === 'user') {
      try {
        draft = personaTextField(content).prompt
      } catch (error: unknown) {
        this.set({ error: error instanceof Error ? error.message : String(error) })
        return
      }
    }
    this.set({
      view: {
        id, title: name ?? id, content, draft, savedDraft: draft,
        editable: trust === 'user', saving: false, error: null,
      },
    })
  }

  /** Close the viewer or editor unless its write is in flight. */
  closeView(): void {
    if (this.store.getSnapshot().view?.saving === true) return
    this.set({ view: null })
  }

  /**
   * Replace the open editor draft.
   * @param content The complete composition text shown in the editor.
   */
  setViewContent(content: string): void {
    this.patchView({ draft: content, error: null })
  }

  /** Persist the open custom preset's composition. */
  async saveView(): Promise<void> {
    const view = this.store.getSnapshot().view
    if (view === null || !view.editable || view.saving || view.draft === view.savedDraft) return
    this.patchView({ saving: true, error: null })
    const content = replacePersonaPrompt(view.content, view.draft)
    const result = await this.ctx.remote.agentPresets.write(view.id, content)
    if (!result.ok) {
      this.patchView({ saving: false, error: result.error.message })
      return
    }
    this.patchView({ saving: false, content, savedDraft: view.draft })
    await this.load()
    this.rosterChanged()
  }

  /** Open the direct-create dialog. */
  beginCreate(): void {
    this.set({
      error: null,
      create: { id: '', name: '', prompt: '', saving: false, error: null },
    })
  }

  /** Close the direct-create dialog, discarding its draft. */
  cancelCreate(): void {
    if (this.store.getSnapshot().create?.saving === true) return
    this.set({ create: null })
  }

  /** Update the new preset id.
   * @param id - new preset id typed into the dialog. */
  setCreateId(id: string): void {
    this.patchCreate({ id, error: null })
  }

  /** Update the new preset display name.
   * @param name - display name typed into the dialog. */
  setCreateName(name: string): void {
    this.patchCreate({ name, error: null })
  }

  /** Update the new preset persona prompt.
   * @param prompt - persona prompt typed into the dialog. */
  setCreatePrompt(prompt: string): void {
    this.patchCreate({ prompt, error: null })
  }

  /** Create a preset from the current default's capabilities and the drafted prompt. */
  async confirmCreate(): Promise<void> {
    const draft = this.store.getSnapshot().create
    if (draft === null || draft.saving) return
    const state = this.store.getSnapshot()
    if (draftBlocker(draft, state.rows) !== undefined) return
    const source = state.rows.find(row => row.isDefault && row.broken === undefined)
    if (source === undefined) return
    this.patchCreate({ saving: true, error: null })
    const document = await this.ctx.remote.agentPresets.read(source.id)
    if (!document.ok) {
      this.patchCreate({ saving: false, error: document.error.message })
      return
    }
    let content: string
    try {
      content = replacePersonaPrompt(document.value.content, draft.prompt)
    } catch (error: unknown) {
      this.patchCreate({ saving: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    const name = draft.name.trim()
    const result = await this.ctx.remote.agentPresets.create(
      source.id, draft.id, name === '' ? undefined : name, content)
    if (!result.ok) {
      this.patchCreate({ saving: false, error: result.error.message })
      return
    }
    this.set({ create: null })
    await this.load()
    this.rosterChanged()
  }

  /**
   * Open the copy dialog over one preset.
   * @param from - the preset the copy will start from.
   */
  beginCopy(from: string): void {
    const row = this.store.getSnapshot().rows.find(candidate => candidate.id === from)
    this.set({
      error: null,
      copy: { from, fromTitle: row?.name ?? from, id: '', name: '', saving: false, error: null },
    })
  }

  /** Close the copy dialog, discarding whatever was typed. */
  cancelCopy(): void {
    this.set({ copy: null })
  }

  /**
   * Name the preset the copy creates.
   * @param id - the id typed into the dialog.
   */
  setCopyId(id: string): void {
    this.patchCopy({ id, error: null })
  }

  /**
   * Name the copy's display name.
   * @param name - the display name typed into the dialog.
   */
  setCopyName(name: string): void {
    this.patchCopy({ name, error: null })
  }

  /**
   * Submit the copy, re-read the roster, then take the user to the new
   * preset's files — the directory opens where the host has a desktop, and
   * its path appears on the new row where it does not.
   * @returns once the copy settled and the page reflects it.
   */
  async confirmCopy(): Promise<void> {
    const draft = this.store.getSnapshot().copy
    if (draft === null || draft.saving) return
    if (draftBlocker(draft, this.store.getSnapshot().rows) !== undefined) return
    this.patchCopy({ saving: true, error: null })
    const name = draft.name.trim()
    // Every declared parameter is passed even when optional: the Remote face
    // checks arity against the declaration and rejects a short call. An
    // empty display name goes as `undefined` — absent rather than empty, so
    // the host falls back to the id instead of labelling the row with ''.
    const result = await this.ctx.remote.agentPresets.copy(
      draft.from, draft.id, name === '' ? undefined : name)
    if (!result.ok) {
      this.patchCopy({ saving: false, error: result.error.message })
      return
    }
    this.set({ copy: null })
    await this.load()
    this.rosterChanged()
    await this.view(draft.id)
  }

  /**
   * Open one preset's directory on the host desktop, or reveal its path on
   * the row where the deployment has no opener to hand it to.
   * @param id - the preset whose files the user wants.
   * @returns once the host answered and the page reflects it.
   */
  async openLocation(id: string): Promise<void> {
    const result = await this.ctx.remote.settings.openAgentPresetDirectory(id)
    if (!result.ok) {
      this.set({ error: result.error.message })
      return
    }
    if (result.value.opened) return
    const { path } = result.value
    this.set({ revealedPaths: { ...this.store.getSnapshot().revealedPaths, [id]: path } })
  }

  /**
   * Ask for confirmation before deleting one preset.
   * @param id - the preset to delete, or null to dismiss the confirmation.
   */
  confirmDelete(id: string | null): void {
    if (this.store.getSnapshot().deleting) return
    this.set({ pendingDelete: id })
  }

  /**
   * Delete the preset awaiting confirmation, then re-read the roster.
   *
   * A session already composed from it keeps running: its composition was
   * mounted at creation and nothing re-reads the file.
   * @returns once the delete settled and the page reflects it.
   */
  async remove(): Promise<void> {
    const { pendingDelete, deleting } = this.store.getSnapshot()
    if (pendingDelete === null || deleting) return
    this.set({ deleting: true, error: null })
    const result = await this.ctx.remote.agentPresets.deletePreset(pendingDelete)
    if (!result.ok) {
      this.set({ deleting: false, pendingDelete: null, error: result.error.message })
      return
    }
    this.set({ deleting: false, pendingDelete: null })
    await this.load()
    this.rosterChanged()
  }

  /**
   * Make one preset the default for sessions created later. Running sessions
   * keep the composition they began with, so this never disturbs work.
   * @param id - the preset to make default.
   * @returns once the write settled and the roster was re-read.
   */
  async makeDefault(id: string): Promise<void> {
    const failure = await writeDefaultPreset(this.ctx, id)
    if (failure !== undefined) {
      this.set({ error: failure })
      return
    }
    await this.load()
  }
}
