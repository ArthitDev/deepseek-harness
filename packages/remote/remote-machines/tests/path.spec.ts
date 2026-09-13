import { describe, expect, it } from 'vitest'
import { displayExecutionPath, parseRemoteExecutionPath, remoteExecutionPath, resolveRemoteExecutionPath } from '../src/path.ts'

describe('remote execution paths', () => {
  it('round-trips a machine and POSIX path without colliding with local paths', () => {
    const encoded = remoteExecutionPath('lab-one', '/home/red/project')
    expect(encoded).toBe('/__dsh_ssh__/lab-one/home/red/project')
    expect(parseRemoteExecutionPath(encoded)).toEqual({ machineId: 'lab-one', path: '/home/red/project' })
    expect(displayExecutionPath(encoded)).toBe('/home/red/project')
  })

  it('resolves relative paths inside the same remote execution world', () => {
    expect(resolveRemoteExecutionPath('../other', remoteExecutionPath('lab-one', '/home/red/project')))
      .toEqual({ machineId: 'lab-one', path: '/home/red/other' })
    expect(remoteExecutionPath('lab-one', '/srv/./app/../logs'))
      .toBe('/__dsh_ssh__/lab-one/srv/logs')
  })
})
