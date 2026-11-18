import { EventEmitter } from 'node:events'
import { ProcessTerminal } from '@earendil-works/pi-tui'
import { afterEach, expect, it, vi } from 'vitest'
import { osc52Encode } from '../src/core/clipboard.ts'
import { ClipboardTerminal } from '../src/ui/clipboard-terminal.ts'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: spawnMock,
}))
const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  spawnMock.mockReset()
})

it.each([
  { platform: 'win32', command: 'clip', args: [] },
  { platform: 'darwin', command: 'pbcopy', args: [] },
  { platform: 'linux', command: 'xclip', args: ['-selection', 'clipboard'] },
] as const)('preserves Unicode clipboard text and OSC 52 on $platform with a hidden helper', ({ platform, command, args }) => {
  Object.defineProperty(process, 'platform', { value: platform })
  vi.stubEnv('TMUX', undefined)
  const write = vi.spyOn(ProcessTerminal.prototype, 'write').mockImplementation(() => {})
  const end = vi.fn<(payload: string | Buffer) => void>()
  const child = Object.assign(new EventEmitter(), { stdin: Object.assign(new EventEmitter(), { end }) })
  spawnMock.mockReturnValue(child)
  const text = 'สถานะ agent ทั้งหมดตอนนี้: ไทย 中文 🙂\nบรรทัดที่สอง'
  const sequence = osc52Encode(text)
  new ClipboardTerminal().write(sequence)
  expect(write).toHaveBeenCalledWith(sequence)
  expect(spawnMock).toHaveBeenLastCalledWith(command, args, {
    stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
  })
  const payload = end.mock.lastCall?.[0]
  if (platform === 'win32') {
    if (!Buffer.isBuffer(payload)) throw new Error('Expected Unicode clipboard bytes')
    expect(payload.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]))
    expect(new TextDecoder('utf-16le', { fatal: true }).decode(payload)).toBe(text)
  } else {
    expect(payload).toBe(text)
  }
  child.emit('close', 0)
})

it('keeps the tmux payload as UTF-8 while encoding the Windows native clipboard as Unicode', () => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  vi.stubEnv('TMUX', 'fixture')
  vi.spyOn(ProcessTerminal.prototype, 'write').mockImplementation(() => {})
  const end = vi.fn<(payload: string | Buffer) => void>()
  const child = Object.assign(new EventEmitter(), { stdin: Object.assign(new EventEmitter(), { end }) })
  spawnMock.mockReturnValue(child)
  const text = 'ภาษาไทย 🙂'
  new ClipboardTerminal().write(osc52Encode(text))
  expect(spawnMock).toHaveBeenCalledTimes(2)
  expect(spawnMock).toHaveBeenNthCalledWith(1, 'tmux', ['load-buffer', '-'], expect.any(Object))
  expect(spawnMock).toHaveBeenNthCalledWith(2, 'clip', [], expect.any(Object))
  expect(end.mock.calls[0]).toEqual([text])
  const payload = end.mock.calls[1]?.[0]
  if (!Buffer.isBuffer(payload)) throw new Error('Expected Unicode clipboard bytes')
  expect(new TextDecoder('utf-16le', { fatal: true }).decode(payload)).toBe(text)
  child.emit('close', 0)
})
