import { EventEmitter } from 'node:events'
import { ProcessTerminal } from '@earendil-works/pi-tui'
import { afterEach, expect, it, vi } from 'vitest'
import { osc52Encode } from '../src/core/clipboard.ts'
import { ClipboardTerminal } from '../src/ui/clipboard-terminal.ts'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: spawnMock,
}))
afterEach(() => { vi.restoreAllMocks(); spawnMock.mockReset() })

it('hides the clipboard helper and preserves the clipboard payload and terminal escape sequence', () => {
  const write = vi.spyOn(ProcessTerminal.prototype, 'write').mockImplementation(() => {})
  const end = vi.fn()
  const child = Object.assign(new EventEmitter(), { stdin: Object.assign(new EventEmitter(), { end }) })
  spawnMock.mockReturnValue(child)
  const sequence = osc52Encode('clipboard fixture')
  new ClipboardTerminal().write(sequence)
  expect(write).toHaveBeenCalledWith(sequence)
  expect(spawnMock).toHaveBeenCalledWith(expect.any(String), expect.any(Array), {
    stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
  })
  expect(end).toHaveBeenCalledWith('clipboard fixture')
  child.emit('close', 0)
})
