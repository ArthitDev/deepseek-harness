/**
 * Git working-tree state for the status bar: current branch + dirty flag.
 * Runs `git` subprocesses in the session cwd; any failure (not a git repo,
 * no git binary) resolves undefined so the status bar simply omits the
 * segment. Deliberately NOT in the streaming hot path — the screen refreshes
 * it at boot and on session switch only.
 */
import { execFile } from 'node:child_process'

/** Status-bar facts for one git work tree: the branch and its dirty flag. */
export interface GitState {
  /** Branch name (`main`, `HEAD` for detached, …). */
  branch: string
  /** True when `git status --porcelain` reports any change. */
  dirty: boolean
}

/**
 * Read the branch and dirty flag under `cwd`. Resolves undefined when the
 * directory is not inside a git work tree or git is unavailable.
 * @param cwd - the directory the git commands run in.
 * @param timeoutMs - per-command timeout in milliseconds.
 * @returns the branch and dirty flag, or undefined when git fails or times out.
 */
export function readGitState(cwd: string, timeoutMs = 3000): Promise<GitState | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: timeoutMs },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined)
          return
        }
        const branch = stdout.trim()
        if (branch === '') {
          resolve(undefined)
          return
        }
        execFile(
          'git',
          ['status', '--porcelain'],
          { cwd, timeout: timeoutMs },
          (statusError, statusOut) => {
            resolve({ branch, dirty: statusError === null && statusOut.trim() !== '' })
          },
        )
      },
    )
  })
}
