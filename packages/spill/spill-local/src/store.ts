/**
 * Cordis-free storage mechanics for the local spill backend: private
 * session-scoped directory selection, safe-name derivation, path-traversal
 * protection, and the exclusive owner-only write.
 *
 * @module @deepseek-ai/dsh-spill-local/store
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { mkdir, open, readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'

/** Prefix shared by default-root creation and startup discovery. */
export const DEFAULT_ROOT_PREFIX = 'dsh-spill-'

/**
 * Test a caught value for a Node system error code.
 *
 * @param error The caught value.
 * @param code The expected system error code.
 * @returns Whether the code matches.
 */
export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

let defaultRoot: string | undefined

/**
 * Return the lazily-created private per-process spill root.
 *
 * @returns The private root path.
 */
export function privateRoot(): string {
  defaultRoot ??= mkdtempSync(join(tmpdir(), DEFAULT_ROOT_PREFIX))
  return defaultRoot
}

// Spill keeps its empty-name policy local so storage backends stay decoupled.
/* jscpd:ignore-start */
/**
 * Encode an arbitrary string as one safe path segment, injectively over ALL JS
 * (UTF-16) strings. A session id / suggested name is untrusted input, so this
 * neutralizes `../`, absolute paths, NUL, and separators before any filesystem
 * use. Each code unit is kept literal (`[A-Za-z0-9._-]`, minus `~`) or escaped
 * as `~XXXX`; `~` is itself escaped, so the mapping is reversible and distinct
 * inputs never collide. The whole-segment tokens `.`/`..` are escaped so they
 * can never traverse. An empty string encodes to `~` (never an empty segment).
 *
 * @param raw Untrusted text.
 * @returns One injective filesystem-safe path segment.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) return '~'
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    out += ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)
      ? ch
      : '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}
/* jscpd:ignore-end */

/**
 * Derive the stable session-scoped directory under a spill root.
 *
 * @param root The spill root.
 * @param sessionId The owning session id.
 * @returns The stable session-scoped directory.
 */
export function sessionDir(root: string, sessionId: string): string {
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
  return join(root, `session-${hash}`)
}

/** Inputs for reading back one saved spill file. */
export interface ReadTextOptions {
  /** Spill root. */
  root: string
  /** Owning session id. */
  sessionId: string
  /** Locator previously returned by {@link saveTextFile}. */
  locator: string
}

/** Inputs needed to save a local spill file. */
export interface SaveTextOptions {
  /** Spill root. */
  root: string
  /** Owning session id. */
  sessionId: string
  /** Caller-suggested filename. */
  suggestedName: string
  /** Full text to persist. */
  content: string
}

/** A written spill file. */
export interface SavedText {
  /** Absolute saved path. */
  path: string
  /** UTF-8 content length. */
  bytes: number
}

/**
 * Read back one saved spill file for its owning session. The locator resolves
 * only inside the owner's session directory — both sides resolve symlinks
 * first, so a planted link can never carry the read outside the owner's
 * scope, and a locator that is gone, unreadable, or foreign rejects.
 * @param options The root, owning session id, and saved locator.
 * @returns The verbatim content and UTF-8 byte length.
 */
export async function readTextFile(options: ReadTextOptions): Promise<{ path: string; content: string; bytes: number }> {
  const dir = sessionDir(options.root, options.sessionId)
  const [resolvedFile, resolvedDir] = await Promise.all([
    realpath(options.locator).catch((error: unknown) => {
      if (isErrno(error, 'ENOENT')) {
        throw new Error('spill artifact is no longer available at its retention location')
      }
      throw error
    }),
    // A missing owner session directory means nothing was ever saved for it,
    // so any locator is outside this owner's scope by definition.
    realpath(dir).catch((error: unknown) => {
      if (isErrno(error, 'ENOENT')) {
        throw new Error('spill artifact locator is outside the owning session scope')
      }
      throw error
    }),
  ])
  if (resolvedFile !== resolvedDir && !resolvedFile.startsWith(resolvedDir + sep)) {
    throw new Error('spill artifact locator is outside the owning session scope')
  }
  const content = await readFile(resolvedFile, 'utf8')
  return { path: resolvedFile, content, bytes: Buffer.byteLength(content, 'utf8') }
}

/**
 * Write text to a fresh 0600 file below its private session directory.
 * @param options The save request.
 * @returns The saved path and UTF-8 byte length.
 */
export async function saveTextFile(options: SaveTextOptions): Promise<SavedText> {
  const dir = sessionDir(options.root, options.sessionId)
  const path = join(dir, `${randomBytes(6).toString('hex')}-${encodeSegment(options.suggestedName)}`)
  let handle
  for (;;) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      handle = await open(path, 'wx', 0o600)
      break
    } catch (error: unknown) {
      /* v8 ignore start -- requires another process to remove the directory
         between mkdir and open, or an external permission/IO race. */
      if (isErrno(error, 'ENOENT')) continue
      throw error
      /* v8 ignore stop */
    }
  }
  try {
    await handle.writeFile(options.content)
  } finally {
    await handle.close()
  }
  return { path, bytes: Buffer.byteLength(options.content, 'utf8') }
}
