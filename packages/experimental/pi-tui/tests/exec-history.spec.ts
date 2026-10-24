import { describe, expect, it } from 'vitest'
import { collectExecHistory, execCommandOf, execShellOf } from '../src/core/exec-history.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const shellCall = (seq: number, callId: string, name: string, args: unknown): SessionEvent => ({
  type: 'tool/call',
  seq: seq as never,
  time: 1_700_000_000_000 + seq,
  data: { callId, name, arguments: args },
} as unknown as SessionEvent)

const result = (seq: number, callId: string, isError = false): SessionEvent => ({
  type: 'tool/result',
  seq: seq as never,
  time: 1_700_000_000_001,
  data: { callId, isError, content: [] },
} as unknown as SessionEvent)

describe('execShellOf', () => {
  it('classifies kali routes through wsl -d kali-linux', () => {
    expect(execShellOf('wsl -d kali-linux -- bash -lc "nmap -sV target"')).toBe('kali')
    expect(execShellOf('wsl.exe -d kali-linux -- nmap')).toBe('kali')
    expect(execShellOf('pwsh -c "wsl -d kali-linux -- nmap"')).toBe('kali')
  })

  it('classifies plain Windows commands as windows', () => {
    expect(execShellOf('Get-ChildItem E:\\work')).toBe('windows')
    expect(execShellOf('wsl --list --verbose')).toBe('windows')
    expect(execShellOf('wsl -d ubuntu -- ls')).toBe('windows')
  })
})

describe('execCommandOf', () => {
  it('reads command, cmd, and persistent-send arguments', () => {
    expect(execCommandOf('pwsh', { command: 'dir' })).toBe('dir')
    expect(execCommandOf('bash', { cmd: 'ls -la' })).toBe('ls -la')
    expect(execCommandOf('pwsh-persistent', { send: 'git status' })).toBe('git status')
    expect(execCommandOf('pwsh', { other: true })).toBeUndefined()
    expect(execCommandOf('pwsh', 'not-an-object')).toBeUndefined()
  })
})

describe('collectExecHistory', () => {
  it('pairs calls with results and classifies the execution world', () => {
    const events = [
      shellCall(1, 'c1', 'pwsh', { command: 'wsl -d kali-linux -- nmap -sV 10.0.0.1' }),
      result(2, 'c1'),
      shellCall(3, 'c2', 'pwsh-persistent', { send: 'Get-Content C:\\x' }),
      result(4, 'c2', true),
    ]
    const entries = collectExecHistory(events)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ callId: 'c1', shell: 'kali', status: 'ok', tool: 'pwsh' })
    expect(entries[1]).toMatchObject({ callId: 'c2', shell: 'windows', status: 'error', tool: 'pwsh-persistent' })
  })

  it('reports an unresolved call as running and skips non-shell tools', () => {
    const events = [
      shellCall(1, 'c1', 'read', { file_path: 'x' }),
      shellCall(2, 'c2', 'bash', { command: 'ls' }),
    ]
    const entries = collectExecHistory(events)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ callId: 'c2', status: 'running' })
  })

  it('skips shell calls whose arguments carry no command', () => {
    const entries = collectExecHistory([shellCall(1, 'c1', 'pwsh', { cwd: 'E:\\' })])
    expect(entries).toEqual([])
  })
})
