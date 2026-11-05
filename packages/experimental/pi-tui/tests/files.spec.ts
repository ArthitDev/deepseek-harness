import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

/** Scripted stdout double with the two members runRgFiles touches. */
interface FakeStdout {
  setEncoding(encoding: string): void
  on(event: 'data', listener: (chunk: string) => void): void
  emitData(chunk: string): void
}

/** Scripted child double carrying the error/close/kill faces runRgFiles drives. */
interface FakeChild {
  stdout: FakeStdout
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: (code: number | null) => void): void
  kill(signal: string): boolean
  emitError(error: Error): void
  emitClose(code: number | null): void
}

const killed: string[] = []

function fakeChild(): FakeChild {
  const stream = new EventEmitter()
  const lifecycle = new EventEmitter()
  return {
    stdout: {
      setEncoding: () => {},
      on: (event, listener) => stream.on(event, listener),
      emitData: chunk => stream.emit('data', chunk),
    },
    on: (event, listener) => lifecycle.on(event, listener),
    kill: (signal) => {
      killed.push(signal)
      queueMicrotask(() => lifecycle.emit('close', null))
      return true
    },
    emitError: (error) => {
      queueMicrotask(() => {
        lifecycle.emit('error', error)
      })
    },
    emitClose: (code) => {
      queueMicrotask(() => {
        lifecycle.emit('close', code)
      })
    },
  }
}

/** Scripted children consumed in spawn order; each `emit` drives its child. */
const scripted: { child: FakeChild; emit: (child: FakeChild) => void }[] = []
const spawned: { args: readonly string[]; options: unknown }[] = []

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const spawn = (file: unknown, args: unknown, options: unknown): FakeChild => {
    const argv = Array.isArray(args) ? args.map(entry => String(entry)) : []
    spawned.push({ args: argv, options })
    const entry = scripted.shift()
    if (entry === undefined) throw new Error(`no scripted spawn left for ${String(file)}`)
    queueMicrotask(() => {
      entry.emit(entry.child)
    })
    return entry.child
  }
  return {
    ...actual,
    spawn,
  }
})

const { parseRgFiles, isHiddenPath, RG_DISPLAY_CAP, RG_EXCLUDE_GLOBS, runRgFiles, shouldShowPath } =
  await import('../src/core/files.ts')

describe('parseRgFiles', () => {
  it('splits stdout into trimmed non-empty paths', () => {
    expect(parseRgFiles('a.ts\n b.ts \n\n\nc.ts\n')).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(parseRgFiles('')).toEqual([])
  })
})

describe('isHiddenPath', () => {
  it('flags any dot-prefixed segment but keeps . and .. segments', () => {
    expect(isHiddenPath('.git/config')).toBe(true)
    expect(isHiddenPath('src/.hidden.ts')).toBe(true)
    expect(isHiddenPath('./src/a.ts')).toBe(false)
    expect(isHiddenPath('a/../b.ts')).toBe(false)
    expect(isHiddenPath('src/a.ts')).toBe(false)
  })
})

describe('shouldShowPath', () => {
  it('shows hidden paths only for a dot-prefixed query', () => {
    expect(shouldShowPath('.git', '.git/config')).toBe(true)
    expect(shouldShowPath('config', '.git/config')).toBe(false)
    expect(shouldShowPath('config', 'src/a.ts')).toBe(true)
  })
})

describe('RG constants', () => {
  it('caps the picker display and carries the unconditional excludes', () => {
    expect(RG_DISPLAY_CAP).toBe(100)
    expect(RG_EXCLUDE_GLOBS).toContain('!.git/**')
    expect(RG_EXCLUDE_GLOBS).toContain('!node_modules/**')
  })
})

describe('runRgFiles', () => {
  it('collects streamed file paths until the child closes', async () => {
    const child = fakeChild()
    scripted.push({
      child,
      emit: (it) => {
        it.stdout.emitData('src/a.ts\n')
        it.stdout.emitData('src/b.ts\n')
        it.emitClose(0)
      },
    })
    await expect(runRgFiles('rg', '/repo')).resolves.toEqual(['src/a.ts', 'src/b.ts'])
    expect(spawned[0]?.args).toEqual([
      '--files',
      '--hidden',
      '--sort=modified',
      '-g',
      '!.git/**',
      '-g',
      '!.DS_Store',
      '-g',
      '!**/__pycache__/**',
      '-g',
      '!*.pyc',
      '-g',
      '!*.pyo',
      '-g',
      '!node_modules/**',
      '-g',
      '!dist/**',
      '-g',
      '!build/**',
      '-g',
      '!coverage/**',
      '-g',
      '!.dsh/**',
      '-g',
      '!.svn/**',
      '-g',
      '!.hg/**',
      '-g',
      '!.bzr/**',
      '-g',
      '!.jj/**',
      '-g',
      '!.sl/**',
    ])
    expect(spawned[0]?.options).toMatchObject({ cwd: '/repo' })
    expect(killed).toEqual([])
  })

  it('resolves an empty list when the child errors before closing', async () => {
    const child = fakeChild()
    scripted.push({
      child,
      emit: (it) => {
        it.emitError(new Error('ENOENT: rg is gone'))
        it.emitClose(null)
      },
    })
    await expect(runRgFiles('rg', '/repo')).resolves.toEqual([])
  })

  it('kills the child on timeout and settles with the partial output', async () => {
    const child = fakeChild()
    scripted.push({
      child,
      emit: (it) => {
        it.stdout.emitData('slow.ts\n')
      },
    })
    const files = await runRgFiles('rg', '/big', 5)
    expect(files).toEqual(['slow.ts'])
    expect(killed).toEqual(['SIGKILL'])
  })
})
