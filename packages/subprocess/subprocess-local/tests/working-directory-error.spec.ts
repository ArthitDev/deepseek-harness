/** Failed launches distinguish invalid working directories from missing executables. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessWorkingDirectoryError } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '../src/index.ts'
import { rejectWithWorkingDirectory } from '../src/working-directory-error.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dsh-workdir-error-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('working-directory start errors', () => {
  it.each(['missing', 'not-directory'] as const)('reports %s after a real managed Node start fails', async (reason) => {
    const cwd = join(root, 'invalid')
    if (reason === 'not-directory') await writeFile(cwd, 'a file')
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      const handle = ctx.subprocess.spawn({
        argv: [process.execPath, '-e', 'process.exit(0)'], cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 100 }, stderr: { maxBytes: 100 } }, graceMs: 100,
      })
      await expect(handle.done).rejects.toBeInstanceOf(SubprocessWorkingDirectoryError)
      await expect(handle.done).rejects.toMatchObject({ code: 'INVALID_WORKDIR', workdir: cwd, reason })
      const failure: unknown = await handle.done.catch((error: unknown) => error)
      if (!(failure instanceof SubprocessWorkingDirectoryError)) throw new Error('expected directory error')
      expect(failure.cause).toBeInstanceOf(Error)
      await expect(handle.done).rejects.toThrow('Set workdir to an existing directory')
      await expect(handle.waitForExit()).resolves.toBe(true)
    } finally { await fiber.dispose() }
  })

  it('keeps a missing-executable error when the working directory exists', async () => {
    const failure = Object.assign(new Error('spawn missing ENOENT'), { code: 'ENOENT', syscall: 'spawn missing' })
    await expect(rejectWithWorkingDirectory(failure, root)).rejects.toBe(failure)
  })

  it('keeps non-start failures and cancellation reasons unchanged', async () => {
    const failure = new Error('transport unavailable')
    await expect(rejectWithWorkingDirectory(failure, join(root, 'missing'))).rejects.toBe(failure)
    await expect(rejectWithWorkingDirectory(null, join(root, 'missing'))).rejects.toBe(null)
  })

  it('reports an intermediate file component without replacing the original cause', async () => {
    const path = join(root, 'file')
    await writeFile(path, '')
    const failure = Object.assign(new Error('spawn node ENOTDIR'), { code: 'ENOTDIR', syscall: 'spawn node' })
    await expect(rejectWithWorkingDirectory(failure, join(path, 'child'))).rejects.toMatchObject({
      code: 'INVALID_WORKDIR', reason: process.platform === 'win32' ? 'missing' : 'not-directory', cause: failure,
    })
  })

  it('preserves cancellation and failures that are not process-start syscalls', async () => {
    const reason = Object.assign(new Error('cancelled'), { code: 'ENOENT', syscall: 'spawn node' })
    await expect(rejectWithWorkingDirectory(reason, join(root, 'missing'), AbortSignal.abort(reason))).rejects.toBe(reason)
    const failure = Object.assign(new Error('pipe read failed'), { code: 'ENOENT', syscall: 'read' })
    await expect(rejectWithWorkingDirectory(failure, join(root, 'missing'))).rejects.toBe(failure)
  })

  it('preserves the start error when directory inspection is inconclusive', async () => {
    const failure = Object.assign(new Error('spawn missing ENOENT'), { code: 'ENOENT', syscall: 'spawn missing' })
    await expect(rejectWithWorkingDirectory(failure, '\0')).rejects.toBe(failure)
  })
})
