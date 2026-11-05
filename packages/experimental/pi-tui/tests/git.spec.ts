import { afterEach, describe, expect, it, vi } from 'vitest'

type ExecFileCallback = (error: Error | null, stdout: string) => void

interface ScriptedResponse {
  error: Error | null
  stdout: string
}

/**
 * Scripted `git` answers per invocation, keyed by the subcommand. The next
 * matching entry is consumed on every call; further calls reuse the last one.
 */
const responses: { match: (args: readonly string[]) => boolean; reply: ScriptedResponse }[] = []
const spawnedCommands: string[][] = []

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const execFileMock = (
    file: string,
    args: readonly string[],
    _options: unknown,
    callback: ExecFileCallback,
  ): void => {
    spawnedCommands.push([file, ...args])
    const entry = responses.find(candidate => candidate.match(args))
    const reply = entry?.reply ?? { error: null, stdout: '' }
    queueMicrotask(() => {
      callback(reply.error, reply.stdout)
    })
  }
  return {
    ...actual,
    execFile: execFileMock as typeof actual.execFile,
  }
})

const { readGitState } = await import('../src/core/git.ts')

afterEach(() => {
  responses.length = 0
  spawnedCommands.length = 0
})

describe('readGitState', () => {
  it('reads the branch and dirty flag from two git runs', async () => {
    responses.push(
      { match: args => args.includes('--abbrev-ref'), reply: { error: null, stdout: 'main\n' } },
      { match: args => args.includes('--porcelain'), reply: { error: null, stdout: 'M a.ts\n' } },
    )
    await expect(readGitState('/repo')).resolves.toEqual({ branch: 'main', dirty: true })
  })

  it('reports a clean tree when status succeeds with no output', async () => {
    responses.push(
      { match: args => args.includes('--abbrev-ref'), reply: { error: null, stdout: 'main\n' } },
      { match: args => args.includes('--porcelain'), reply: { error: null, stdout: '' } },
    )
    await expect(readGitState('/repo')).resolves.toEqual({ branch: 'main', dirty: false })
  })

  it('reports a clean tree when status fails outside a work tree', async () => {
    responses.push(
      { match: args => args.includes('--abbrev-ref'), reply: { error: null, stdout: 'main\n' } },
      {
        match: args => args.includes('--porcelain'),
        reply: { error: new Error('not a git repository'), stdout: '' },
      },
    )
    await expect(readGitState('/repo')).resolves.toEqual({ branch: 'main', dirty: false })
  })

  it('resolves undefined when the directory is not a git repository', async () => {
    responses.push({
      match: args => args.includes('--abbrev-ref'),
      reply: { error: new Error('fatal: not a git repository'), stdout: '' },
    })
    await expect(readGitState('/plain')).resolves.toBeUndefined()
  })

  it('resolves undefined when the branch read succeeds but names no branch', async () => {
    responses.push({
      match: args => args.includes('--abbrev-ref'),
      reply: { error: null, stdout: '' },
    })
    await expect(readGitState('/repo')).resolves.toBeUndefined()
  })
})
