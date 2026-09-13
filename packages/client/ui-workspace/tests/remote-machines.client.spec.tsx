// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { remoteExecutionPath } from '@deepseek-ai/dsh-remote-machines/path'
import { RemoteMachineControl, type RemoteMachineControlProps } from '../src/client/RemoteMachines.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en, commonEn) as RemoteMachineControlProps['t']

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

describe('RemoteMachineControl', () => {
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
