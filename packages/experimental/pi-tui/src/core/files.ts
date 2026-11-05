/**
 * @ file-listing data source helpers: ripgrep-backed enumeration with the
 * industry-standard ignore convention (ripgrep/fd semantics) plus a small
 * unconditional exclude list, hidden-file policy (Claude Code style), and a
 * display cap constant. Pure helpers stay unit-testable.
 */
import { spawn } from 'node:child_process'

/** How many items the picker renders before falling back to the filter. */
export const RG_DISPLAY_CAP = 100

/**
 * Unconditional excludes on top of rg's native .gitignore/.ignore handling:
 * build artifacts, caches, and VCS/editor metadata (fd/rg ecosystem
 * consensus + dsh's own glob-tool VCS list).
 */
export const RG_EXCLUDE_GLOBS = [
  '!.git/**',
  '!.DS_Store',
  '!**/__pycache__/**',
  '!*.pyc',
  '!*.pyo',
  '!node_modules/**',
  '!dist/**',
  '!build/**',
  '!coverage/**',
  '!.dsh/**',
  '!.svn/**',
  '!.hg/**',
  '!.bzr/**',
  '!.jj/**',
  '!.sl/**',
]

/**
 * Split rg --files stdout into clean relative paths.
 * @param stdout - Raw rg --files stdout, one path per line.
 * @returns Trimmed, non-empty paths in stdout order.
 */
export function parseRgFiles(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
}

/**
 * Any dot-prefixed path segment (hidden file OR inside a hidden dir).
 * @param path - Slash-separated relative path.
 * @returns True when any segment other than `.`/`..` starts with a dot.
 */
export function isHiddenPath(path: string): boolean {
  return path
    .split('/')
    .some(segment => segment.startsWith('.') && segment !== '.' && segment !== '..')
}

/**
 * Claude Code policy: hidden paths show only when the query starts with '.'.
 * @param query - Current filter query.
 * @param path - Slash-separated relative path.
 * @returns True when the path may appear in the list for this query.
 */
export function shouldShowPath(query: string, path: string): boolean {
  if (query.startsWith('.')) return true
  return !isHiddenPath(path)
}

/**
 * Enumerate visible files under `cwd` with one rg invocation. Resolves []
 * on any failure (the caller falls back to the fs walker).
 * @param rgPath - Path of the rg binary to spawn.
 * @param cwd - Directory enumerated recursively.
 * @param timeoutMs - Milliseconds before the child is killed with SIGKILL (default 15000).
 * @returns Relative file paths in modification-time order; [] when rg cannot spawn, partial results on timeout.
 */
export function runRgFiles(rgPath: string, cwd: string, timeoutMs = 15000): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(
      rgPath,
      [
        '--files',
        '--hidden',
        '--sort=modified',
        ...RG_EXCLUDE_GLOBS.flatMap(glob => ['-g', glob]),
      ],
      { cwd, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let stdout = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    const finish = (value: string[]): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => {
      finish([])
    })
    child.on('close', () => {
      finish(parseRgFiles(stdout))
    })
  })
}
