import { Context, FiberState } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import { watchKaliStatus, type KaliStatus } from '../src/core/kali-status.ts'
import { Config } from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-native-command', () => ({ runNativeCommand: vi.fn() }))

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

function fixture() {
  vi.useFakeTimers()
  const ctx = new Context()
  const backend = {
    options: { name: '@deepseek-ai/dsh-terminal-bash' },
    fiber: { state: FiberState.ACTIVE, config: {
      backendType: 'kali', shellDialect: 'bash',
      shellPath: 'C:\\Windows\\System32\\wsl.exe', shellArgs: ['-d', 'custom-kali', '-u', 'operator'],
    } },
  }
  const entries = [backend]
  const backends = ['kali']
  ctx.provide('loader', { entries: () => entries.values() })
  ctx.provide('terminals', { listBackends: () => backends })
  const states: KaliStatus[] = []
  const start = (): void => { watchKaliStatus(ctx, { kaliStatusIntervalMs: 100, kaliStatusTimeoutMs: 50 }, state => states.push(state)) }
  return { ctx, backend, entries, backends, states, start }
}

describe('Kali readiness', () => {
  it('validates probe timings and supplies their defaults', () => {
    expect(Config({})).toMatchObject({ kaliStatusIntervalMs: 30000, kaliStatusTimeoutMs: 10000 })
    for (const key of ['kaliStatusIntervalMs', 'kaliStatusTimeoutMs']) {
      for (const value of [0, -1, 1.5]) expect(() => Config({ [key]: value })).toThrow()
    }
  })

  it('uses configured WSL selectors and recovers after an unavailable result', async () => {
    const f = fixture()
    vi.mocked(runNativeCommand).mockResolvedValueOnce({ stdout: 'DSH_KALI_READY\n', stderr: '' })
      .mockRejectedValueOnce(new Error('distro missing'))
      .mockResolvedValue({ stdout: 'DSH_KALI_READY\n', stderr: '' })
    try {
      f.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(f.states).toEqual(['checking', 'ready'])
      expect(runNativeCommand).toHaveBeenCalledWith(f.backend.fiber.config.shellPath,
        ['-d', 'custom-kali', '-u', 'operator', '--exec', '/bin/bash', '--noprofile', '--norc', '-c',
          '. /etc/os-release && [ "$ID" = kali ] && printf "DSH_KALI_READY\\n"'], expect.any(AbortSignal), 'hidden')
      await vi.advanceTimersByTimeAsync(100)
      expect(f.states.slice(-2)).toEqual(['checking', 'unavailable'])
      await vi.advanceTimersByTimeAsync(100)
      expect(f.states.slice(-2)).toEqual(['checking', 'ready'])
    } finally { await f.ctx.fiber.dispose() }
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['backend', 'entry', 'inactive', 'dialect'] as const)('does not run when %s is unavailable', async (missing) => {
    const f = fixture()
    if (missing === 'backend') f.backends.length = 0
    if (missing === 'entry') f.entries.length = 0
    if (missing === 'inactive') f.backend.fiber.state = FiberState.FAILED
    if (missing === 'dialect') f.backend.fiber.config.shellDialect = 'pwsh'
    try {
      f.start()
      expect(f.states).toEqual(['unavailable'])
      expect(runNativeCommand).not.toHaveBeenCalled()
    } finally { await f.ctx.fiber.dispose() }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports missing optional services without starting a process', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const update = vi.fn()
    try {
      watchKaliStatus(ctx, { kaliStatusIntervalMs: 100, kaliStatusTimeoutMs: 50 }, update)
      expect(update).toHaveBeenCalledWith('unavailable')
      expect(runNativeCommand).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('checks a native Kali Bash and rejects output without the exact marker', async () => {
    const f = fixture()
    f.backend.fiber.config.shellPath = '/bin/bash'
    f.backend.fiber.config.shellArgs = []
    vi.mocked(runNativeCommand).mockResolvedValue({ stdout: 'Ubuntu\n', stderr: '' })
    try {
      f.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(runNativeCommand).toHaveBeenCalledWith('/bin/bash', ['--noprofile', '--norc', '-c', expect.any(String)], expect.any(AbortSignal), 'hidden')
      expect(f.states).toEqual(['checking', 'unavailable'])
    } finally { await f.ctx.fiber.dispose() }
  })

  it('bounds a stalled probe, never overlaps polls, and cancels pending work on disposal', async () => {
    const f = fixture()
    let signal: AbortSignal | undefined
    vi.mocked(runNativeCommand).mockImplementation(async (_command, _args, probeSignal) => {
      signal = probeSignal
      await new Promise<void>((_resolve, reject) => {
        probeSignal.addEventListener('abort', () => { reject(new Error('probe aborted')) }, { once: true })
      })
      return { stdout: '', stderr: '' }
    })
    f.start()
    expect(f.states).toEqual(['checking'])
    await vi.advanceTimersByTimeAsync(49)
    expect(runNativeCommand).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)
    expect(f.states).toEqual(['checking', 'unavailable'])
    await vi.advanceTimersByTimeAsync(99)
    expect(runNativeCommand).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(runNativeCommand).toHaveBeenCalledTimes(2)
    const statesAtDispose = [...f.states]
    await f.ctx.fiber.dispose()
    expect(signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(f.states).toEqual(statesAtDispose)
    expect(runNativeCommand).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
