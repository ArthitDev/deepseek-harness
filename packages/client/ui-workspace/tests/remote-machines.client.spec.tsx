// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { remoteExecutionPath } from '@deepseek-ai/dsh-remote-machines/path'
import { RemoteMachineControl, type RemoteMachineControlProps } from '../src/client/RemoteMachines.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const t = makeTranslate(en, commonEn) as RemoteMachineControlProps['t']
const agentMode = { getSnapshot: () => 'red', subscribe: () => () => {}, set: vi.fn() }

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

describe('RemoteMachineControl', () => {
  it('uses the probed remote home when no workspace path is configured', async () => {
    const path = remoteExecutionPath('machine-server', '/home/tester')
    const workspace = {
      workspaceId: 'workspace-remote', path, title: 'tester', sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const localWorkspace = {
      workspaceId: 'workspace-local', path: 'C:\\lab', title: 'Lab', sessionIds: ['session-local'],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const probe = vi.fn(async () => ({
      fingerprint: 'SHA256:test-fingerprint', trusted: true, home: '/home/tester', platform: 'linux' as const,
    }))
    const createWorkspace = vi.fn(async () => workspace)
    const startSession = vi.fn()
    const run = {
      id: 'run-lab', objective: 'Assess the lab', mode: 'red' as const, status: 'active' as const,
      authorizedTargets: ['lab.example'], excludedTargets: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const listPentestRuns = vi.fn(async () => [run])
    const loadPentestRun = vi.fn(async () => ({
      run,
      tasks: [{
        id: 'task-map', runId: 'run-lab', objective: 'Map the lab', kind: 'discover' as const,
        status: 'ready' as const, priority: 1, attempt: 0, maxAttempts: 1, dependencies: [],
        basisEvidenceIds: [], basisFindingIds: [], createdAt: run.createdAt, updatedAt: run.updatedAt,
      }, {
        id: 'task-enum', runId: 'run-lab', objective: 'Enumerate routes', kind: 'enumerate' as const,
        hypothesis: 'Routes are exposed', expectedSignal: 'Routes answer', refutingSignal: 'No routes answer',
        status: 'blocked' as const, priority: 1, attempt: 0, maxAttempts: 1, dependencies: ['task-map'],
        basisEvidenceIds: [], basisFindingIds: [], createdAt: run.createdAt, updatedAt: run.updatedAt,
      }],
      ptt: [{
        id: 'task-map', children: ['task-enum'], objective: 'Map the lab', kind: 'discover' as const,
        target: 'lab.example', doneWhen: 'Lab mapped', strategyClass: 'direct observation',
        status: 'ready' as const, priority: 1,
        dependencies: [], attemptCount: 0, evidenceIds: [], findingIds: [],
        reasonForNextAction: 'Map the lab',
      }, {
        id: 'task-enum', parentTaskId: 'task-map', children: [], objective: 'Enumerate routes',
        kind: 'enumerate' as const, target: 'lab.example', doneWhen: 'Routes enumerated',
        hypothesis: 'Routes are exposed', expectedSignal: 'Routes answer', refutingSignal: 'No routes answer',
        status: 'blocked' as const, priority: 1, dependencies: ['task-map'], attemptCount: 0,
        evidenceIds: [], findingIds: [], reasonForNextAction: 'Expand the mapped branch',
      }],
      coverage: {
        complete: false, nextRequiredTaskKind: 'enumerate' as const,
        phases: [
          { kind: 'discover' as const, goal: 'Map', required: true, status: 'covered' as const, taskIds: ['task-map'] },
          { kind: 'enumerate' as const, goal: 'Enumerate', required: true, status: 'pending' as const, taskIds: [] },
        ],
      },
      convergence: { stagnant: false, recentEpisodeWindow: 3, warnings: [] },
      branches: [{
        rootTaskId: 'task-map', taskIds: ['task-map', 'task-enum'], status: 'active' as const,
        iterations: 0, toolCalls: 0, tokens: 0, runtimeMs: 0,
        recentProgressScores: [], noProgress: false,
        limits: { iterations: 8, toolCalls: 30, tokens: 25_000, runtimeMs: 300_000 }, exceeded: [],
      }],
      hypotheses: [{
        id: 'hypothesis:task-enum', runId: 'run-lab', taskId: 'task-enum',
        description: 'Routes are exposed', target: 'lab.example', expectedSignal: 'Routes answer',
        refutingSignal: 'No routes answer', status: 'supported' as const, confidence: 0.8,
        derivedFromHypothesisIds: [], derivedFromObservationIds: [], evidenceIds: ['evidence-map'],
        evaluationReason: 'The route answered', createdAt: run.createdAt, updatedAt: run.updatedAt,
      }],
      attempts: [],
      events: [{
        id: 'task:task-map:created', kind: 'task_created' as const,
        at: run.createdAt, summary: 'Map the lab', taskId: 'task-map',
      }],
      observations: [{
        id: 'observation-enum', runId: 'run-lab', taskId: 'task-enum', summary: 'A route answered',
        evidenceIds: ['evidence-map'], details: [], createdAt: run.updatedAt,
        evaluation: { verdict: 'supported' as const, reason: 'The route answered' },
      }],
      evidence: [{
        id: 'evidence-map', runId: 'run-lab', taskId: 'task-map', kind: 'fixture', reference: 'fixture:map',
        summary: 'Lab mapped', createdAt: run.updatedAt,
      }],
      artifacts: [], findings: [], graphNodes: [], graphEdges: [], episodes: [], toolCalls: [],
      usage: {
        meteredEpisodes: 0, pricedEpisodes: 0, inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0,
      },
      operatorDecisions: [{
        id: 'decision-create', runId: run.id, sequence: 0, action: 'create_run' as const,
        summary: 'Created red run for lab.example', createdAt: run.createdAt,
      }],
    }))
    const controlPentestRun = vi.fn(async () => run)
    const controlPentestTask = vi.fn(async () => undefined)
    const replacePentestScope = vi.fn(async () => run)
    const createPentestRun = vi.fn(async () => run)
    const startPentestLoop = vi.fn(async () => undefined)
    const stopPentestLoop = vi.fn(async () => undefined)
    const listRunningPentestLoops = vi.fn(async () => ['run-lab'])

    render(<RemoteMachineControl {...({
      locked: false,
      useSession: hook({ sessionId: 'session-local' }),
      useWorkspaces: hook({ items: [localWorkspace] }),
      useHostInfo: hook({ home: undefined, hostname: 'TEST-HOST', isLoopback: true }),
      useRemoteMachines: hook({
        status: 'ready', error: null,
        machines: [{
          id: 'machine-server', name: 'Server', host: 'server.test', port: 22,
          username: 'tester', auth: 'agent', hasPassword: false,
          hasPrivateKey: false, hasPassphrase: false,
        }],
      }),
      controller: { load: vi.fn(), probe, trust: vi.fn() },
      agentMode,
      createWorkspace,
      startSession,
      listPentestRuns,
      loadPentestRun,
      controlPentestRun,
      controlPentestTask,
      replacePentestScope,
      createPentestRun,
      startPentestLoop,
      stopPentestLoop,
      listRunningPentestLoops,
      t,
    } as unknown as RemoteMachineControlProps)} />)

    const modeButton = screen.getByRole('button', { name: 'Agent mode: Red Team' })
    const machineButton = screen.getByRole('button', { name: 'Execution machine: TEST-HOST' })
    expect(modeButton.compareDocumentPosition(machineButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(modeButton)
    const modeIcons = ['Blue Team', 'Red Team', 'Black Team'].map(name =>
      screen.getByRole('menuitem', { name }).querySelector('svg')?.innerHTML)
    expect(modeIcons.every(Boolean)).toBe(true)
    expect(new Set(modeIcons).size).toBe(3)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Blue Team' }))
    expect(agentMode.set).toHaveBeenCalledWith('blue')
    expect(screen.getByRole('status').textContent).toContain('Switching to Blue Team…')

    fireEvent.click(screen.getByRole('button', { name: 'Pentest runs' }))
    await waitFor(() => { expect(loadPentestRun).toHaveBeenCalledWith('run-lab') })
    expect(listPentestRuns).toHaveBeenCalledOnce()
    expect(screen.getAllByText('Assess the lab')).toHaveLength(2)
    expect(screen.getByText('1/2')).toBeTruthy()
    expect(screen.getAllByText('Map the lab')).toHaveLength(2)
    const rootItem = screen.getAllByText('Map the lab')[0]!.closest('li')!
    expect(within(rootItem).getByText(/direct observation/)).toBeTruthy()
    expect(rootItem.contains(screen.getByText('Enumerate routes'))).toBe(true)
    fireEvent.click(screen.getByText('Test contract'))
    expect(screen.getByText('Routes are exposed')).toBeTruthy()
    expect(screen.getByText('Routes answer')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByText('supported: The route answered')).toBeTruthy()
    expect(screen.getByText('Event timeline')).toBeTruthy()
    expect(screen.getByText('task created')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeTruthy()
    expect(screen.getByText('fixture:map')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop loop' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Operations' }))
    expect(screen.getByRole('button', { name: 'Stop loop' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop loop' }))
    await waitFor(() => { expect(stopPentestLoop).toHaveBeenCalledWith('run-lab') })
    fireEvent.change(screen.getByLabelText('Authorized targets, one per line'), {
      target: { value: 'lab.example\napi.lab.example\nlab.example' },
    })
    fireEvent.change(screen.getByLabelText('Excluded targets, one per line'), {
      target: { value: 'admin.lab.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save scope' }))
    await waitFor(() => {
      expect(replacePentestScope).toHaveBeenCalledWith(
        'run-lab', ['lab.example', 'api.lab.example'], ['admin.lab.example'],
      )
    })
    const childItem = screen.getByText('Enumerate routes').closest('li')!
    fireEvent.click(within(childItem as HTMLElement).getByRole('button', { name: 'Reject' }))
    await waitFor(() => { expect(controlPentestTask).toHaveBeenCalledWith('task-enum', { action: 'reject' }) })
    fireEvent.click(within(rootItem as HTMLElement).getByRole('button', { name: 'Block' }))
    await waitFor(() => { expect(controlPentestTask).toHaveBeenCalledWith('task-map', { action: 'block' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => { expect(controlPentestRun).toHaveBeenCalledWith('run-lab', 'pause') })
    fireEvent.click(screen.getByRole('button', { name: 'New run' }))
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Assess the second lab' } })
    fireEvent.change(screen.getByLabelText('Test window starts'), { target: { value: '2026-09-20T09:00' } })
    fireEvent.change(screen.getByLabelText('Test window ends'), { target: { value: '2026-09-20T17:00' } })
    const authorizedAreas = screen.getAllByLabelText('Authorized targets, one per line')
    fireEvent.change(authorizedAreas[authorizedAreas.length - 1]!, { target: { value: 'second.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create run' }))
    await waitFor(() => {
      expect(createPentestRun).toHaveBeenCalledWith({
        objective: 'Assess the second lab', mode: 'red',
        authorizedTargets: ['second.example'], excludedTargets: [],
        testWindow: {
          startsAt: new Date('2026-09-20T09:00').toISOString(),
          endsAt: new Date('2026-09-20T17:00').toISOString(),
        },
        execution: { machineId: 'local', workspaceId: 'workspace-local', cwd: 'C:\\lab' },
      })
    })
    await waitFor(() => { expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1) })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(machineButton)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Server' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => { expect(startSession).toHaveBeenCalledWith('workspace-remote') })
    expect(probe).toHaveBeenCalledWith('machine-server', undefined)
    expect(createWorkspace).toHaveBeenCalledWith(path)
  })

  it('verifies and trusts a saved host before opening an existing remote workspace', async () => {
    const path = remoteExecutionPath('machine-server', '/srv/project')
    const workspace = {
      workspaceId: 'workspace-remote', path, title: 'Project', sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const probe = vi.fn(async () => ({
      fingerprint: 'SHA256:test-fingerprint', trusted: false, platform: 'linux' as const,
    }))
    const trust = vi.fn(async () => ({
      id: 'machine-server', name: 'Server', host: 'server.test', port: 22,
      username: 'tester', auth: 'agent' as const, fingerprint: 'SHA256:test-fingerprint',
      hasPassword: false, hasPrivateKey: false, hasPassphrase: false,
    }))
    const createWorkspace = vi.fn(async () => workspace)
    const startSession = vi.fn()

    render(<RemoteMachineControl {...({
      locked: false,
      useSession: hook({ sessionId: 'session-local' }),
      useWorkspaces: hook({ items: [workspace] }),
      useHostInfo: hook({ home: undefined, hostname: 'TEST-HOST', isLoopback: true }),
      useRemoteMachines: hook({
        status: 'ready', error: null,
        machines: [{
          id: 'machine-server', name: 'Server', host: 'server.test', port: 22,
          username: 'tester', auth: 'password-prompt', hasPassword: false,
          hasPrivateKey: false, hasPassphrase: false,
        }],
      }),
      controller: { load: vi.fn(), probe, trust },
      agentMode,
      createWorkspace,
      startSession,
      t,
    } as unknown as RemoteMachineControlProps)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Execution machine: TEST-HOST' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Server' }))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Project' }))

    await waitFor(() => { expect(screen.getByText('SHA256:test-fingerprint')).toBeTruthy() })
    expect(createWorkspace).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Trust and connect' }))
    await waitFor(() => { expect(startSession).toHaveBeenCalledWith('workspace-remote') })
    expect(probe).toHaveBeenCalledWith('machine-server', 'fixture-password')
    expect(trust).toHaveBeenCalledWith('machine-server', 'SHA256:test-fingerprint')
    expect(createWorkspace).toHaveBeenCalledWith(path)
    expect(trust.mock.invocationCallOrder[0]).toBeLessThan(startSession.mock.invocationCallOrder[0]!)
  })
})
