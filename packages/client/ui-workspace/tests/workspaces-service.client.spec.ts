import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ISessions, SessionListState, SessionReference, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionCreateError } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ClientRemote, DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { RowToast } from '../src/client/contract/slots.ts'
import { DirectoryBrowseError, UiWorkspaceService } from '../src/client/navigation.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'

const sid = (id: string): SessionId => SessionId(id)
const wid = (id: string): WorkspaceId => id as WorkspaceId

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function persistSelection(selection: {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}): Map<string, string> {
  const backing = new Map([['dsh.sessions.current', JSON.stringify(selection)]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => { backing.set(key, value) },
    removeItem: (key: string) => { backing.delete(key) },
  })
  return backing
}

function workspace(
  id: string,
  sessionIds: readonly SessionId[] = [],
  createdAt = '2026-01-01T00:00:00.000Z',
): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/w/${id}`,
    title: id,
    sessionIds,
    createdAt,
    updatedAt: createdAt,
  }
}

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
    retainedBy: overrides.retainedBy ?? {},
  }
}

function sessionState(
  summaries: readonly SessionSummary[] = [],
  phase: SessionListState['phase'] = 'ready',
): SessionListState {
  return {
    ids: summaries.map(item => item.id),
    byId: Object.fromEntries(summaries.map(item => [item.id, item])),
    phase,
    projectionsBySession: {},
  }
}

function workspaceState(
  items: WorkspaceSnapshot['items'] = [],
  archivedSessionIds: readonly SessionId[] = [],
  phase: WorkspaceSnapshot['phase'] = 'ready',
): WorkspaceSnapshot {
  return {
    items,
    archivedSessionIds,
    pinnedSessionIds: [],
    phase,
    state: phase === 'ready' ? 'idle' : 'loading',
    error: null,
  }
}

class MutableSource<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: T) {}

  getSnapshot(): T {
    return this.value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }

  update(update: (value: T) => T): void {
    this.set(update(this.value))
  }

  listenersSnapshot(): readonly (() => void)[] {
    return [...this.listeners]
  }
}

interface RetainedSession {
  readonly reference: SessionReference
  readonly release: ReturnType<typeof vi.fn<() => void>>
}

class FakeSessions implements ISessions {
  readonly list: MutableSource<SessionListState>
  readonly create: ReturnType<typeof vi.fn<ISessions['create']>>
  readonly delete = vi.fn<ISessions['delete']>(async () => undefined)
  readonly fork = vi.fn<ISessions['fork']>(async () => sid('forked'))
  readonly retained: RetainedSession[] = []
  readonly refreshProjections = vi.fn<ISessions['refreshProjections']>(() => Promise.resolve())
  readonly retain = vi.fn<ISessions['retain']>((target) => {
    const release = vi.fn<() => void>()
    const sessionId = typeof target === 'string' ? target : target.childSessionId
    const binding = { sessionId } as SessionReference['binding']
    const reference: SessionReference = {
      sessionId,
      binding,
      ready: Promise.resolve(binding),
      release,
      [Symbol.dispose]: release,
    }
    this.retained.push({ reference, release })
    return reference
  })
  readonly subagentAddress = vi.fn<ISessions['subagentAddress']>()
  declare readonly using: ISessions['using']
  declare readonly retainInfo: ISessions['retainInfo']
  declare readonly searchResultLimit: ISessions['searchResultLimit']
  declare readonly refresh: ISessions['refresh']
  declare readonly search: ISessions['search']
  declare readonly scope: ISessions['scope']
  declare readonly scopeOf: ISessions['scopeOf']
  declare readonly sessionOf: ISessions['sessionOf']
  declare readonly binding: ISessions['binding']

  constructor(initial: SessionListState) {
    this.list = new MutableSource(initial)
    this.create = vi.fn<ISessions['create']>(async options =>
      options?.sessionId ?? sid(`created-${String(options?.workspaceId ?? 'none')}`))
  }
}

class FakeWorkspaces implements IWorkspaces {
  readonly initializeDefault = vi.fn<IWorkspaces['initializeDefault']>(async () => undefined)
  readonly list: MutableSource<WorkspaceSnapshot>
  readonly archiveCalls: SessionId[] = []
  readonly unarchiveCalls: SessionId[] = []
  onArchive: IWorkspaces['archiveSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      archivedSessionIds: [...state.archivedSessionIds, sessionId],
    }))
  }

  onUnarchive: IWorkspaces['unarchiveSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
    }))
  }

  declare readonly create: IWorkspaces['create']
  declare readonly rename: IWorkspaces['rename']
  declare readonly delete: IWorkspaces['delete']
  declare readonly insertBefore: IWorkspaces['insertBefore']
  declare readonly insertSessionBefore: IWorkspaces['insertSessionBefore']
  readonly pinCalls: SessionId[] = []
  readonly unpinCalls: SessionId[] = []
  onPin: IWorkspaces['pinSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      pinnedSessionIds: [sessionId, ...state.pinnedSessionIds.filter(id => id !== sessionId)],
    }))
  }

  constructor(initial: WorkspaceSnapshot) {
    this.list = new MutableSource(initial)
  }

  archiveSession(sessionId: SessionId): Promise<void> {
    this.archiveCalls.push(sessionId)
    return this.onArchive(sessionId)
  }

  unarchiveSession(sessionId: SessionId): Promise<void> {
    this.unarchiveCalls.push(sessionId)
    return this.onUnarchive(sessionId)
  }

  pinSession(sessionId: SessionId): Promise<void> {
    this.pinCalls.push(sessionId)
    return this.onPin(sessionId)
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    this.unpinCalls.push(sessionId)
    this.list.update(state => ({
      ...state,
      pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== sessionId),
    }))
  }
}

const listing: DirectoryListing = {
  path: '/home/u',
  home: '/home/u',
  crumbs: [{ name: '/', path: '/', hidden: false }],
  entries: [{ name: 'project', path: '/home/u/project', hidden: false }],
  truncated: false,
}

/** The directory-picking Remote namespace, recorded and scripted per case. */
class FakeDirectoryPicker {
  readonly calls: { method: string; payload: unknown }[] = []

  onPick: () => Promise<RemoteResult<string | null>> = () => Promise.resolve({ ok: true, value: null })
  onList: () => Promise<RemoteResult<DirectoryListing>> = () => Promise.resolve({ ok: true, value: listing })
  onCreateDirectory: () => Promise<RemoteResult<string>> =
    () => Promise.resolve({ ok: true, value: '/home/u/new' })

  readonly remote: ClientRemote['directoryPicker'] = {
    pick: () => this.record('pick', {}, this.onPick()),
    list: (path?: string) => this.record('list', { path }, this.onList()),
    createDirectory: (path: string, name: string) =>
      this.record('createDirectory', { path, name }, this.onCreateDirectory()),
  }

  callsOf(method: string): unknown[] {
    return this.calls.filter(call => call.method === method).map(call => call.payload)
  }

  private record<T>(method: string, payload: unknown, result: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return result
  }
}

interface BenchOptions {
  readonly language?: string
  readonly configureWorkspaces?: (workspaces: FakeWorkspaces) => void
  readonly workspaces?: WorkspaceSnapshot
  readonly sessions?: SessionListState
  readonly configureSessions?: (sessions: FakeSessions) => void
}

function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const locale = new LocaleRuntime(ctx)
  if (options.language === 'fr') locale.addLanguage({ id: 'fr', label: 'Français', fallback: 'en' })
  locale.setLocale(options.language ?? 'en')
  ctx.provide('locale', locale)
  const layout = new LayoutController({
    selectPanel: vi.fn(), retainMainPanels: vi.fn(),
    setSidebar: vi.fn(), toggleSidebar: vi.fn(), setViewportWidth: vi.fn(),
    setRightbar: vi.fn(), openRightbar: vi.fn(), closeRightbar: vi.fn(),
  }, () => true)
  const selectPanel = vi.spyOn(layout, 'selectPanel')
  ctx.provide('layout', layout)
  ctx.effect(() => () => { layout.dispose() })
  const directoryPicker = new FakeDirectoryPicker()
  const workspaces = new FakeWorkspaces(options.workspaces ?? workspaceState([], [], 'pending'))
  const sessions = new FakeSessions(options.sessions ?? sessionState([], 'pending'))
  options.configureWorkspaces?.(workspaces)
  options.configureSessions?.(sessions)
  const view = createWorkspaceViewStore().create()
  const notify = vi.fn<(toast: RowToast) => void>()
  const uiWorkspace = new UiWorkspaceService(
    ctx,
    directoryPicker.remote,
    workspaces,
    sessions,
    view.actions,
    notify,
  )
  return { ctx, directoryPicker, sessions, uiWorkspace, workspaces, layout, selectPanel, view, notify }
}

describe('UiWorkspaceService', () => {
  it.each([
    ['zh', '默认工作区', '默认工作区'],
    ['en', 'Default workspace', 'Default workspace'],
    ['fr', 'default-workspace', 'Default workspace'],
  ])('prepares and selects the default Workspace after both startup baselines (%s)', async (language, directoryName, title) => {
    const b = bench({ language, configureWorkspaces: (workspaces) => {
      workspaces.initializeDefault.mockImplementation(async () => {
        const item = workspace('default')
        workspaces.list.set(workspaceState([item]))
        return item
      })
    } })
    expect(b.workspaces.initializeDefault).not.toHaveBeenCalled()
    b.sessions.list.set(sessionState())
    expect(b.workspaces.initializeDefault).not.toHaveBeenCalled()
    b.workspaces.list.set(workspaceState())
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('created-default'), { source: 'mainView' })
    })
    expect(b.workspaces.initializeDefault).toHaveBeenCalledExactlyOnceWith({ directoryName, title }, expect.any(AbortSignal))
    expect(b.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('default') })
    expect(b.notify).not.toHaveBeenCalled()
  })

  it('leaves an ineligible empty installation without a Session or failure notice', async () => {
    const b = bench({ workspaces: workspaceState(), sessions: sessionState() })
    await setImmediate()
    b.workspaces.list.set(workspaceState())
    b.sessions.list.set(sessionState())
    await setImmediate()
    expect(b.workspaces.initializeDefault).toHaveBeenCalledOnce()
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.notify).not.toHaveBeenCalled()
  })

  it('requires explicit selection when the startup Session list contains history', async () => {
    const b = bench({ workspaces: workspaceState(), sessions: sessionState([summary('history')]) })
    await setImmediate()
    expect(b.workspaces.initializeDefault).not.toHaveBeenCalled()
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('publishes a startup directory failure once without creating a Session', async () => {
    const b = bench({ workspaces: workspaceState(), sessions: sessionState(), configureWorkspaces: (workspaces) => {
      workspaces.initializeDefault.mockRejectedValueOnce(new Error('denied'))
    } })
    await vi.waitFor(() => { expect(b.notify).toHaveBeenCalledExactlyOnceWith({ kind: 'defaultWorkspaceFailed' }) })
    b.workspaces.list.set(workspaceState())
    await setImmediate()
    expect(b.workspaces.initializeDefault).toHaveBeenCalledOnce()
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.notify).toHaveBeenCalledExactlyOnceWith({ kind: 'defaultWorkspaceFailed' })
  })

  it.each(['session', 'panel', 'disposal'] as const)('cancels startup directory preparation after %s navigation', async (kind) => {
    const pending = Promise.withResolvers<WorkspaceView>()
    const b = bench({ workspaces: workspaceState(), sessions: sessionState(), configureWorkspaces: (workspaces) => {
      workspaces.initializeDefault.mockReturnValueOnce(pending.promise)
    } })
    if (kind === 'session') b.uiWorkspace.openSession(sid('manual'))
    else if (kind === 'panel') b.layout.selectPanel('other-panel' as MainPanelId)
    else await b.ctx.fiber.dispose()
    expect(b.workspaces.initializeDefault.mock.calls[0]![1]?.aborted).toBe(true)
    pending.resolve(workspace('default'))
    await setImmediate()
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.sessions.retain.mock.calls.map(args => args[0])).toEqual(kind === 'session' ? [sid('manual')] : [])
    expect(b.notify).not.toHaveBeenCalled()
  })

  it.each(['session', 'panel', 'disposal'] as const)('suppresses a startup directory failure after %s navigation', async (kind) => {
    const pending = Promise.withResolvers<WorkspaceView>()
    const b = bench({ workspaces: workspaceState(), sessions: sessionState(), configureWorkspaces: (workspaces) => {
      workspaces.initializeDefault.mockReturnValueOnce(pending.promise)
    } })
    if (kind === 'session') b.uiWorkspace.openSession(sid('manual'))
    else if (kind === 'panel') b.layout.selectPanel('other-panel' as MainPanelId)
    else await b.ctx.fiber.dispose()
    pending.reject(new Error('late failure'))
    await setImmediate()
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.notify).not.toHaveBeenCalled()
  })

  it.each([false, true])('reports Session failure without a directory error and retains the Workspace (superseded: %s)', async (superseded) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const created = Promise.withResolvers<SessionId>()
    const b = bench({ workspaces: workspaceState(), sessions: sessionState(), configureWorkspaces: (workspaces) => {
      workspaces.initializeDefault.mockImplementationOnce(async () => {
        const item = workspace('default')
        workspaces.list.set(workspaceState([item]))
        return item
      })
    }, configureSessions: (sessions) => { sessions.create.mockReturnValueOnce(created.promise) } })
    await vi.waitFor(() => { expect(b.sessions.create).toHaveBeenCalledOnce() })
    if (superseded) b.layout.selectPanel('other-panel' as MainPanelId)
    const failure = new Error('session failed')
    created.reject(failure)
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledExactlyOnceWith('initial Session restoration failed:', failure)
    })
    expect(b.workspaces.list.getSnapshot().items).toEqual([workspace('default')])
    expect(b.notify).not.toHaveBeenCalled()
    expect(b.sessions.retain).not.toHaveBeenCalled()
  })

  it('retains an explicit main target before revealing its Conversation', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('target'))
    expect(b.selectPanel).toHaveBeenCalledWith(null)
    expect(b.sessions.retain).toHaveBeenCalledWith(sid('target'), { source: 'mainView' })
    expect(b.sessions.refreshProjections).not.toHaveBeenCalled()
  })

  it('keeps the current panel when retaining the target fails', () => {
    const b = bench()
    b.sessions.retain.mockImplementationOnce(() => { throw new Error('open failed') })
    expect(() => { b.uiWorkspace.openSession(sid('target')) }).toThrow('open failed')
    expect(b.selectPanel).not.toHaveBeenCalled()
  })

  it('releases a newly retained target when Workspace preparation throws', async () => {
    const b = bench({
      workspaces: workspaceState([workspace('a')]),
      sessions: sessionState([], 'pending'),
    })
    b.uiWorkspace.openSession(sid('current'))
    const failure = new Error('preparation failed')

    await expect(b.uiWorkspace.openWorkspace(wid('a'), () => { throw failure })).rejects.toBe(failure)

    expect(b.sessions.retained.map(item => item.reference.sessionId)).toEqual([sid('current'), sid('created-a')])
    expect(b.sessions.retained[0]!.release).not.toHaveBeenCalled()
    expect(b.sessions.retained[1]!.release).toHaveBeenCalledOnce()
  })

  it('opens only the latest Workspace when creation finishes out of order', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a'), workspace('b')]) })
    const first = Promise.withResolvers<SessionId>()
    const second = Promise.withResolvers<SessionId>()
    b.sessions.create.mockImplementation(options => options?.workspaceId === wid('a') ? first.promise : second.promise)
    const prepareA = vi.fn()
    const prepareB = vi.fn()
    const openingA = b.uiWorkspace.openWorkspace(wid('a'), prepareA)
    const openingB = b.uiWorkspace.openWorkspace(wid('b'), prepareB)
    second.resolve(sid('newer'))
    await openingB
    first.resolve(sid('older'))
    await openingA
    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('newer'), { source: 'mainView' })
    expect(prepareB).toHaveBeenCalledExactlyOnceWith(sid('newer'))
    expect(prepareA).not.toHaveBeenCalled()
  })

  it('does not reopen a Workspace after a later panel or Session navigation', async () => {
    for (const panel of [true, false]) {
      const b = bench({ workspaces: workspaceState([workspace('a')]) })
      const created = Promise.withResolvers<SessionId>()
      b.sessions.create.mockReturnValueOnce(created.promise)
      const opening = b.uiWorkspace.openWorkspace(wid('a'))
      if (panel) b.layout.selectPanel('other-panel' as MainPanelId)
      else b.uiWorkspace.openSession(sid('chosen'))
      created.resolve(sid('late'))
      await opening
      expect(b.sessions.retain.mock.calls.map(args => args[0])).toEqual(panel ? [] : [sid('chosen')])
    }
  })

  it('does not deliver pending Workspace and fork targets after disposal', async () => {
    for (const kind of ['workspace', 'fork'] as const) {
      const b = bench({ workspaces: workspaceState([workspace('a')]) })
      const created = Promise.withResolvers<SessionId>()
      b.sessions.create.mockReturnValueOnce(created.promise)
      b.sessions.fork.mockReturnValueOnce(created.promise)
      const pending = kind === 'workspace' ? b.uiWorkspace.openWorkspace(wid('a')) : b.uiWorkspace.forkSession(sid('source'))
      await b.ctx.fiber.dispose()
      created.resolve(sid('late'))
      await pending
      expect(b.sessions.retain).not.toHaveBeenCalled()
    }
  })

  it('creates a fresh Session even when the Workspace already has a reusable blank', async () => {
    const blank = summary('blank', { blank: true, cwd: '/w/alpha' })
    const b = bench({
      sessions: sessionState([blank]),
      workspaces: workspaceState([workspace('alpha', [blank.id])]),
    })
    b.sessions.create.mockResolvedValue(sid('fresh'))

    b.uiWorkspace.startSession(wid('alpha'))

    await vi.waitFor(() => {
      expect(b.sessions.create).toHaveBeenLastCalledWith({ workspaceId: wid('alpha') })
      expect(b.sessions.retain).toHaveBeenCalledWith(sid('fresh'), { source: 'mainView' })
    })
  })

  it('targets an explicit, current-session, then recent Workspace and reports failed starts', async () => {
    const current = summary('current', { cwd: '/w/current-home', updatedAt: 1 })
    const recent = summary('recent', { cwd: '/w/recent-home', updatedAt: 2 })
    const b = bench({
      sessions: sessionState([current, recent]),
      workspaces: workspaceState([
        workspace('old'),
        workspace('current-home', [current.id]),
        workspace('recent-home', [recent.id]),
      ]),
    })
    b.uiWorkspace.startSession(wid('old'))
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenLastCalledWith(sid('created-old'), { source: 'mainView' })
    })
    b.uiWorkspace.openSession(current.id)
    b.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenLastCalledWith(sid('created-current-home'), { source: 'mainView' })
    })
    const recentOnly = bench({
      sessions: sessionState([current, recent]),
      workspaces: workspaceState([
        workspace('current-home', [current.id]),
        workspace('recent-home', [recent.id]),
      ]),
    })
    recentOnly.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(recentOnly.sessions.retain).toHaveBeenLastCalledWith(sid('created-recent-home'), { source: 'mainView' })
    })
    b.sessions.create.mockRejectedValueOnce(new Error('create failed'))
    b.uiWorkspace.startSession(wid('recent-home'))
    await vi.waitFor(() => {
      expect(b.notify).toHaveBeenCalledWith({ kind: 'createFailed', message: 'create failed' })
    })
    const empty = bench()
    empty.uiWorkspace.startSession()
    expect(empty.selectPanel).toHaveBeenCalledWith(null)

    const missingMember = bench({
      sessions: sessionState(),
      workspaces: workspaceState([
        workspace('older', [sid('missing')], '2026-01-01T00:00:00.000Z'),
        workspace('newer', [], '2026-02-01T00:00:00.000Z'),
      ]),
    })
    missingMember.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(missingMember.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('newer') })
    })
  })

  it('keeps New Session on the last active remote Workspace after its current Session is deleted', async () => {
    const remoteCurrent = summary('remote-current', { updatedAt: 1 })
    const localRecent = summary('local-recent', { updatedAt: 2 })
    const local = workspace('local', [localRecent.id])
    const remote = {
      ...workspace('remote', [remoteCurrent.id]),
      path: '/__dsh_ssh__/lab/srv/project',
    }
    const b = bench({
      sessions: sessionState([remoteCurrent, localRecent]),
      workspaces: workspaceState([local, remote]),
    })
    b.uiWorkspace.openSession(remoteCurrent.id)
    b.sessions.create.mockClear()

    b.workspaces.list.set(workspaceState([local, { ...remote, sessionIds: [] }]))
    b.sessions.list.set(sessionState([localRecent]))
    b.uiWorkspace.startSession()

    await vi.waitFor(() => {
      expect(b.sessions.create).toHaveBeenCalledWith({ workspaceId: wid('remote') })
    })
  })

  it('releases a prepared Workspace target when synchronous preparation supersedes it', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]) })

    await b.uiWorkspace.openWorkspace(wid('a'), () => {
      b.uiWorkspace.openSession(sid('override'))
    })

    expect(b.sessions.retained.map(item => item.reference.sessionId)).toEqual([
      sid('created-a'), sid('override'),
    ])
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.sessions.retained[1]!.release).not.toHaveBeenCalled()
  })

  it('opens the most recent Workspace after both startup catalogs become ready', async () => {
    const b = bench()
    b.workspaces.list.set(workspaceState([
      workspace('newest', [], '2026-03-01T00:00:00.000Z'),
      workspace('same-time', [], '2026-03-01T00:00:00.000Z'),
      workspace('older', [], '2026-01-01T00:00:00.000Z'),
    ]))
    b.sessions.list.set(sessionState())
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenCalledWith(sid('created-newest'), { source: 'mainView' })
    })
  })

  it('uses catalog order for Workspace connects without reading the saved selection', async () => {
    persistSelection({ sessionId: sid('saved') })
    const b = bench({
      sessions: sessionState([
        summary('first', { blank: true, cwd: '/w/a' }),
        summary('saved', { blank: true, cwd: '/w/a' }),
      ], 'pending'),
      workspaces: workspaceState([workspace('a', [sid('first'), sid('saved')])]),
    })
    await expect(b.uiWorkspace.connectWorkspace(wid('a'))).resolves.toBe(sid('first'))
  })

  it.each([
    { archived: true, cwd: '/w/a' },
    { archived: false, cwd: '/other' },
  ])('does not reclaim an ineligible saved blank: %j', async ({ archived, cwd }) => {
    persistSelection({ sessionId: sid('saved') })
    const b = bench({
      sessions: sessionState([summary('saved', { blank: true, cwd })]),
      workspaces: workspaceState([workspace('a', [sid('saved')])], archived ? [sid('saved')] : []),
    })
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('created-a'), { source: 'mainView' })
    })
    expect(b.sessions.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: wid('a') })
  })

  it('restores a saved ungrouped blank directly', () => {
    persistSelection({ sessionId: sid('saved') })
    const b = bench({
      sessions: sessionState([summary('saved', { blank: true })]),
      workspaces: workspaceState(),
    })
    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('saved'), { source: 'mainView' })
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('reclaims the saved blank before opening history, even when another blank is listed first', async () => {
    persistSelection({ sessionId: sid('saved') })
    const acquired = Promise.withResolvers<SessionId>()
    const b = bench({
      sessions: sessionState([
        summary('other', { blank: true, cwd: '/w/a' }),
        summary('saved', { blank: true, cwd: '/w/a' }),
      ]),
      workspaces: workspaceState([workspace('a', [sid('other'), sid('saved')])]),
      configureSessions: (sessions) => { sessions.create.mockReturnValue(acquired.promise) },
    })
    expect(b.sessions.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: wid('a'), sessionId: sid('saved') })
    expect(b.sessions.retain).not.toHaveBeenCalled()
    acquired.resolve(sid('saved'))
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('saved'), { source: 'mainView' })
    })
  })

  it.each(['saved', 'workspace'])('creates after the selected %s blank is held without trying another blank', async (source) => {
    if (source === 'saved') persistSelection({ sessionId: sid('held') })
    const b = bench({
      sessions: sessionState([
        summary('held', { blank: true, cwd: '/w/a' }),
        summary('free', { blank: true, cwd: '/w/a' }),
      ], source === 'saved' ? 'ready' : 'pending'),
      workspaces: workspaceState([workspace('a', [sid('held'), sid('free')])]),
      configureSessions: (sessions) => {
        sessions.create.mockRejectedValueOnce(new SessionCreateError(
          new RemoteError('session/writer-held', 'held', { sessionId: sid('held') }), sid('held'),
        ))
      },
    })
    if (source === 'saved') {
      await vi.waitFor(() => {
        expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('created-a'), { source: 'mainView' })
      })
    } else {
      await expect(b.uiWorkspace.connectWorkspace(wid('a'))).resolves.toBe(sid('created-a'))
    }
    expect(b.sessions.create.mock.calls).toEqual([
      [{ workspaceId: wid('a'), sessionId: sid('held') }],
      [{ workspaceId: wid('a') }],
    ])
  })

  it.each(['workspace', 'panel'])('does not let saved blank restoration replace a later %s navigation', async (target) => {
    persistSelection({ sessionId: sid('saved') })
    const acquired = Promise.withResolvers<SessionId>()
    const created = Promise.withResolvers<SessionId>()
    const acquisitionDone = vi.fn()
    const b = bench({
      sessions: sessionState([summary('saved', { blank: true, cwd: '/w/a' })]),
      workspaces: workspaceState([workspace('a', [sid('saved')]), workspace('b')]),
      configureSessions: (sessions) => {
        sessions.create.mockImplementation(options => options?.sessionId === sid('saved')
          ? acquired.promise.then((id) => { acquisitionDone(); return id }) : created.promise)
      },
    })
    const opening = target === 'workspace' ? b.uiWorkspace.openWorkspace(wid('b')) : undefined
    if (target === 'panel') b.layout.selectPanel('other-panel' as MainPanelId)
    acquired.resolve(sid('saved'))
    await vi.waitFor(() => { expect(acquisitionDone).toHaveBeenCalledOnce() })
    expect(b.sessions.retain).not.toHaveBeenCalled()
    created.resolve(sid('created-b'))
    await opening
    expect(b.sessions.retain.mock.calls.map(([id]) => id)).toEqual(target === 'workspace' ? [sid('created-b')] : [])
  })

  it('coalesces overlapping blank acquisitions before starting history', async () => {
    const acquired = Promise.withResolvers<SessionId>()
    const b = bench({
      sessions: sessionState([summary('blank', { blank: true, cwd: '/w/a' })], 'pending'),
      workspaces: workspaceState([workspace('a', [sid('blank')])]),
      configureSessions: (sessions) => { sessions.create.mockReturnValue(acquired.promise) },
    })
    const first = b.uiWorkspace.connectWorkspace(wid('a'))
    const second = b.uiWorkspace.connectWorkspace(wid('a'))
    expect(b.sessions.create).toHaveBeenCalledOnce()
    acquired.resolve(sid('blank'))
    await expect(Promise.all([first, second])).resolves.toEqual([sid('blank'), sid('blank')])
  })

  it.each([
    new Error('filesystem denied'),
    'failed transport',
    new SessionCreateError(new RemoteError('gateway/internal', 'read failed', {}), sid('blank')),
  ])('does not replace a blank after a non-contention failure: %s', async (error) => {
    const b = bench({
      sessions: sessionState([summary('blank', { blank: true, cwd: '/w/a' })], 'pending'),
      workspaces: workspaceState([workspace('a', [sid('blank')])]),
      configureSessions: (sessions) => { sessions.create.mockRejectedValue(error) },
    })
    await expect(b.uiWorkspace.connectWorkspace(wid('a'))).rejects.toBe(error)
    expect(b.sessions.create).toHaveBeenCalledOnce()
    expect(b.sessions.retain).not.toHaveBeenCalled()
  })

  it('waits for a new catalog before retrying failed startup blank acquisition', async () => {
    persistSelection({ sessionId: sid('blank') })
    const failure = new Error('read failed')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const b = bench({
      sessions: sessionState([summary('blank', { blank: true, cwd: '/w/a' })]),
      workspaces: workspaceState([workspace('a', [sid('blank')])]),
      configureSessions: (sessions) => { sessions.create.mockRejectedValueOnce(failure) },
    })
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('initial Session restoration failed:', failure)
    })
    expect(b.sessions.retain).not.toHaveBeenCalled()
    b.sessions.list.set(b.sessions.list.getSnapshot())
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('blank'), { source: 'mainView' })
    })
  })

  it('settles empty startup without creating a Session on later catalog updates', () => {
    const b = bench({ sessions: sessionState(), workspaces: workspaceState() })
    b.workspaces.list.set(workspaceState([workspace('a')]))
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('clears a selected blank archived by a catalog update without reconnecting', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('blank'))
    b.workspaces.list.set(workspaceState([workspace('a', [sid('blank')])], [sid('blank')]))
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('does not let a pending startup Workspace replace a manual Session selection', async () => {
    const created = Promise.withResolvers<SessionId>()
    const b = bench({
      workspaces: workspaceState([workspace('a')]),
      sessions: sessionState(),
      configureSessions: (sessions) => { sessions.create.mockReturnValue(created.promise) },
    })
    b.uiWorkspace.openSession(sid('chosen'))

    created.resolve(sid('automatic'))
    await b.uiWorkspace.connectWorkspace(wid('a'))

    expect(b.sessions.retain.mock.calls.map(([target]) => target)).toEqual([sid('chosen')])
  })

  it('keeps a chosen panel and pending navigation when initial connection finishes', async () => {
    const created = Promise.withResolvers<SessionId>()
    const b = bench({
      workspaces: workspaceState([workspace('a')]),
      sessions: sessionState(),
      configureSessions: (sessions) => { sessions.create.mockReturnValueOnce(created.promise) },
    })
    const panel = 'other-panel' as MainPanelId
    b.layout.selectPanel(panel)
    const navigation = b.layout.beginNavigation()
    created.resolve(sid('restored'))
    await b.uiWorkspace.connectWorkspace(wid('a'))
    expect(b.sessions.retained).toHaveLength(0)
    expect(b.selectPanel.mock.calls).toEqual([[panel]])
    expect(navigation.aborted).toBe(false)
  })

  it('keeps a chosen panel when the saved target becomes discoverable', () => {
    const saved = sid('saved')
    persistSelection({ sessionId: saved })
    const b = bench({ workspaces: workspaceState(), sessions: sessionState([], 'pending') })
    const panel = 'other-panel' as MainPanelId
    b.layout.selectPanel(panel)
    b.sessions.list.set(sessionState([summary('saved')]))
    expect(b.sessions.retained[0]!.reference.sessionId).toBe(saved)
    expect(b.selectPanel.mock.calls).toEqual([[panel]])
  })

  it('restores a persisted subagent address without a parent catalog', () => {
    const address: SubagentAddress = {
      parentSessionId: sid('parent'),
      childSessionId: sid('child'),
      mode: 'continuable',
    }
    persistSelection({ sessionId: address.childSessionId, subagentAddress: address })

    const b = bench({
      workspaces: workspaceState(),
      sessions: sessionState(),
    })

    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(address, { source: 'mainView' })
    expect(b.sessions.refreshProjections).not.toHaveBeenCalled()
  })

  it('persists a catalog-resolved address after string subagent navigation', () => {
    const address: SubagentAddress = {
      parentSessionId: sid('parent'),
      childSessionId: sid('child'),
      mode: 'continuable',
    }
    const backing = persistSelection({})
    const b = bench({
      configureSessions: (sessions) => { sessions.subagentAddress.mockReturnValue(address) },
    })

    b.uiWorkspace.openSession(address.childSessionId)

    expect(JSON.parse(backing.get('dsh.sessions.current')!)).toEqual({
      sessionId: address.childSessionId,
      subagentAddress: address,
    })
  })

  it('reports and retries a failed persisted Session restoration', async () => {
    const failure = new Error('restore failed')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sessions = sessionState([summary('saved')])
    persistSelection({ sessionId: sid('saved') })
    const b = bench({
      workspaces: workspaceState(),
      sessions,
      configureSessions: (face) => {
        face.retain.mockImplementationOnce(() => { throw failure })
      },
    })

    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('initial Session restoration failed:', failure)
    })
    b.sessions.list.set(sessions)

    expect(b.sessions.retain).toHaveBeenCalledTimes(2)
    expect(b.sessions.retained).toHaveLength(1)
    expect(b.sessions.retained[0]!.reference.sessionId).toBe(sid('saved'))
  })

  it('clears a selected Session when an external archive snapshot arrives', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('current'))

    b.workspaces.list.set(workspaceState([], [sid('current')]))

    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
  })

  it('clears a selected Session after archiving it without an intervening snapshot', async () => {
    const b = bench()
    b.workspaces.onArchive = async () => {}
    b.uiWorkspace.openSession(sid('current'))

    await b.uiWorkspace.archiveSession(sid('current'))

    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
  })

  it('forwards archive commands and preserves failures', async () => {
    const idle = sid('idle')
    const b = bench()

    await b.uiWorkspace.archiveSession(idle)
    expect(b.workspaces.archiveCalls).toEqual([idle])

    b.workspaces.onArchive = () => Promise.reject(new Error('archive rejected'))
    await expect(b.uiWorkspace.archiveSession(idle)).rejects.toThrow('archive rejected')
    expect(b.workspaces.archiveCalls).toEqual([idle, idle])
  })

  it('forwards unarchive commands and preserves failures', async () => {
    const idle = sid('idle')
    const b = bench()

    await b.uiWorkspace.unarchiveSession(idle)
    expect(b.workspaces.unarchiveCalls).toEqual([idle])

    b.workspaces.onUnarchive = () => Promise.reject(new Error('unarchive rejected'))
    await expect(b.uiWorkspace.unarchiveSession(idle)).rejects.toThrow('unarchive rejected')
    expect(b.workspaces.unarchiveCalls).toEqual([idle, idle])
  })

  it('passes directory operations to the Host and preserves structured browse failures', async () => {
    const b = bench()
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: '/w/alpha' })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBe('/w/alpha')
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: null })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBeNull()
    expect(b.directoryPicker.callsOf('pick')).toEqual([{}, {}])

    await expect(b.uiWorkspace.listDirectory()).resolves.toEqual(listing)
    await expect(b.uiWorkspace.listDirectory('/home/u')).resolves.toEqual(listing)
    expect(b.directoryPicker.callsOf('list')).toEqual([{ path: undefined }, { path: '/home/u' }])
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).resolves.toBe('/home/u/new')
    expect(b.directoryPicker.callsOf('createDirectory')).toEqual([{ path: '/home/u', name: 'new' }])
    b.directoryPicker.onPick = () => Promise.resolve({
      ok: false, error: new RemoteError('gateway/internal', 'no chooser', {}),
    })
    await expect(b.uiWorkspace.pickDirectory()).rejects.toThrow('directory picker failed: no chooser')
    b.directoryPicker.onList = () => Promise.resolve({
      ok: false, error: new RemoteError('directory-picker/unreadable', 'denied', { path: '/private' }),
    })
    const listFailure = b.uiWorkspace.listDirectory('/private')
    await expect(listFailure).rejects.toBeInstanceOf(DirectoryBrowseError)
    await expect(listFailure).rejects.toMatchObject({ rpcError: { code: 'directory-picker/unreadable' } })
    b.directoryPicker.onCreateDirectory = () => Promise.resolve({
      ok: false, error: new RemoteError('directory-picker/exists', 'taken', { path: '/home/u/new' }),
    })
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).rejects.toMatchObject({
      rpcError: { code: 'directory-picker/exists' },
    })
  })
})
