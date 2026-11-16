import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVpnControlServer } from '../../../../scripts/vpn-control-broker.mjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { controlVpn, mullvadExecutable, tunnelState } from '../src/control.ts'
import type { ExecFileOptions } from 'node:child_process'

const { execute } = vi.hoisted(() => ({ execute: vi.fn<(
  executable: string, args: string[], options: ExecFileOptions,
  callback: (error: NodeJS.ErrnoException | null, stdout: string) => void,
) => EventEmitter & { kill: (signal: string) => boolean }>() }))
vi.mock('node:child_process', () => ({ execFile: execute }))
beforeEach(() => execute.mockReset())
afterEach(() => vi.unstubAllEnvs())

it('selects absolute installed Windows/Linux executables without searching cwd', () => {
  expect(mullvadExecutable('linux', '')).toBe('/usr/bin/mullvad')
  expect(mullvadExecutable('win32', 'D:\\Apps')).toBe('D:\\Apps\\Mullvad VPN\\resources\\mullvad.exe')
  for (const path of ['', '.', 'relative', 'C:relative']) expect(mullvadExecutable('win32', path)).toBeUndefined()
  expect(mullvadExecutable('darwin', '')).toBeUndefined()
  expect(tunnelState({ state: 'connected', account: 'secret' })).toBe('connected')
  expect(tunnelState({ state: 'invented' })).toBe('unknown')
  expect(tunnelState(null)).toBe('unknown')
})

it('uses fixed argv, drops credentials and awaits child close after cancellation', async () => {
  vi.stubEnv('SECRET_TOKEN', 'must-not-reach-cli')
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) })
  let callback: (error: Error | null, stdout: string) => void
  execute.mockImplementation((_file, _args, _options, done) => { callback = done; return child })
  const controller = new AbortController()
  let settled = false
  const pending = controlVpn('reconnect', '', controller.signal).then((value) => { settled = true; return value })
  expect(execute.mock.calls[0]![1]).toEqual(['reconnect', '--wait'])
  expect(execute.mock.calls[0]![2]).toMatchObject({ windowsHide: true, killSignal: 'SIGKILL', maxBuffer: 16384 })
  expect(execute.mock.calls[0]![2].env).not.toHaveProperty('SECRET_TOKEN')
  controller.abort()
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
  callback!(new Error('aborted'), '')
  await Promise.resolve()
  expect(settled).toBe(false)
  child.emit('close', null, 'SIGKILL')
  expect(await pending).toEqual({ kind: 'failed', tunnel: 'unknown' })
})

it('returns sanitized JSON status and reports a missing CLI without success', async () => {
  const children: EventEmitter[] = []
  const callbacks: ((error: NodeJS.ErrnoException | null, stdout: string) => void)[] = []
  execute.mockImplementation((_file, _args, _options, callback) => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) })
    children.push(child); callbacks.push(callback); return child
  })
  const first = controlVpn('status', '', new AbortController().signal)
  expect(execute.mock.calls[0]![1]).toEqual(['status', '--json'])
  callbacks[0]!(null, '{"state":"connected","account":"private","ip":"203.0.113.7"}')
  children[0]!.emit('close', 0)
  expect(await first).toEqual({ kind: 'ok', tunnel: 'connected' })
  const second = controlVpn('reconnect', '', new AbortController().signal)
  callbacks[1]!(Object.assign(new Error('missing'), { code: 'ENOENT' }), '')
  children[1]!.emit('close', -2)
  expect(await second).toEqual({ kind: 'unavailable', tunnel: 'unknown' })
})

it('uses the restricted socket protocol without falling back to the CLI', async () => {
  const socket = process.platform === 'win32' ? '\\\\.\\pipe\\dsh-vpn-' + randomUUID() : join(tmpdir(), 'dsh-vpn-' + randomUUID() + '.sock')
  const run = vi.fn(async () => ({ state: 'connected', ip: '203.0.113.7' }))
  const server = createVpnControlServer(run)
  await new Promise<void>(resolve => server.listen(socket, resolve))
  try {
    expect(await controlVpn('status', socket, AbortSignal.timeout(3000))).toEqual({ kind: 'ok', tunnel: 'connected' })
    expect(await controlVpn('reconnect', socket, AbortSignal.timeout(3000))).toEqual({ kind: 'ok', tunnel: 'connected' })
    expect(run.mock.calls).toHaveLength(2)
    expect(execute).not.toHaveBeenCalled()
  } finally {
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  }
  expect(await controlVpn('status', socket, AbortSignal.timeout(3000))).toEqual({ kind: 'unavailable', tunnel: 'unknown' })
  expect(execute).not.toHaveBeenCalled()
})
