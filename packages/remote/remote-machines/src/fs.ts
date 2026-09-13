/** Hybrid filesystem: local semantics from fs-sandbox, SSH paths through SFTP. */

import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import type { Stats, SFTPWrapper } from 'ssh2'
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry,
  FsEditOutcome,
  FsEditRequest,
  FsInfo,
  FsPathInfo,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { parseRemoteExecutionPath, remoteExecutionPath, resolveRemoteExecutionPath } from './path.ts'

const SAMPLE_BYTES = 8192

function aborted(signal: AbortSignal | undefined, operation: string): void {
  if (signal?.aborted === true) throw new FsError(`${operation} aborted`, 'FS_ABORTED')
}

function mapError(error: unknown, operation: string, path: string, signal?: AbortSignal): FsError {
  if (error instanceof FsError) return error
  if (signal?.aborted === true) return new FsError(`${operation} aborted`, 'FS_ABORTED', { cause: error })
  const code = (error as { code?: unknown } | null)?.code
  if (code === 2 || code === 'ENOENT') return new FsError(`cannot ${operation} "${path}": not found`, 'FS_NOT_FOUND', { cause: error })
  if (code === 3 || code === 'EACCES' || /permission denied/i.test(String(error))) {
    return new FsError(`cannot ${operation} "${path}": permission denied`, 'FS_PERMISSION_DENIED', { cause: error })
  }
  return new FsError(`cannot ${operation} "${path}": ${error instanceof Error ? error.message : String(error)}`, 'FS_IO_ERROR', { cause: error })
}

function call<T>(invoke: (done: (error: Error | null | undefined, value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    invoke((error, value) => {
      if (error == null) resolve(value)
      else reject(error)
    })
  })
}

function callVoid(invoke: (done: (error?: Error | null) => void) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    invoke((error) => {
      if (error == null) resolve()
      else reject(error)
    })
  })
}

function statVersion(machineId: string, path: string, stat: Stats): ReturnType<typeof FsVersion> {
  return FsVersion(`ssh:${createHash('sha256').update(JSON.stringify([
    machineId, path, stat.mode, stat.uid, stat.gid, stat.size, stat.mtime,
  ])).digest('hex')}`)
}

function kindOf(stat: Stats): FsInfo['type'] {
  return stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other'
}

function decodeText(bytes: Uint8Array, path: string): string {
  if (bytes.subarray(0, SAMPLE_BYTES).includes(0)) throw new FsError(`cannot read "${path}": binary file`, 'FS_NOT_TEXT')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\r\n', '\n')
  } catch (error) {
    throw new FsError(`cannot read "${path}": invalid UTF-8`, 'FS_NOT_TEXT', { cause: error })
  }
}

function replaceLiteral(content: string, edit: FsEditRequest, path: string): string {
  if (edit.oldString.length === 0) throw new FsError(`cannot edit "${path}": old_string must be non-empty`, 'FS_EDIT_NOT_FOUND')
  const matches = content.split(edit.oldString).length - 1
  if (matches === 0) throw new FsError(`cannot edit "${path}": old_string was not found`, 'FS_EDIT_NOT_FOUND')
  if (!edit.replaceAll && matches !== 1) throw new FsError(`cannot edit "${path}": old_string matched ${matches} times`, 'FS_AMBIGUOUS_EDIT')
  return edit.replaceAll ? content.split(edit.oldString).join(edit.newString) : content.replace(edit.oldString, edit.newString)
}

/** Routes machine-qualified targets through SFTP and keeps local targets unchanged. */
export class SshFileSystem extends SandboxedFileSystem {
  static override inject = ['sandboxPolicy', 'remoteMachines']
  private readonly remoteLocks = new Map<string, Promise<unknown>>()

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const remote = resolveRemoteExecutionPath(path, opts?.cwd)
    if (remote === undefined) return await super.resolve(path, opts)
    aborted(opts?.signal, 'resolve')
    const sftp = await this.ctx.remoteMachines.connections.sftp(remote.machineId)
    try {
      const canonical = await this.canonicalPath(sftp, remote.path)
      return {
        targetKey: FsTargetKey(remoteExecutionPath(remote.machineId, canonical)),
        displayPath: remoteExecutionPath(remote.machineId, remote.path),
      }
    } catch (error) {
      throw mapError(error, 'resolve', remote.path, opts?.signal)
    } finally {
      sftp.end()
    }
  }

  override processPath(target: FsTarget): string {
    return parseRemoteExecutionPath(String(target.targetKey))?.path ?? super.processPath(target)
  }

  override fileUrl(target: FsTarget): string {
    const remote = parseRemoteExecutionPath(String(target.targetKey))
    if (remote === undefined) return super.fileUrl(target)
    return `ssh://${remote.machineId}${remote.path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
  }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    const left = parseRemoteExecutionPath(String(parent.targetKey))
    const right = parseRemoteExecutionPath(String(child.targetKey))
    if (left === undefined || right === undefined) return left === undefined && right === undefined && super.contains(parent, child)
    if (left.machineId !== right.machineId) return false
    const relative = posix.relative(left.path, right.path)
    return relative === '' || (relative !== '..' && !relative.startsWith('../') && !posix.isAbsolute(relative))
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    const remote = parseRemoteExecutionPath(String(target.targetKey))
    if (remote === undefined) return await super.stat(target, signal)
    const value = await this.remoteStat(remote.machineId, remote.path, signal)
    return value === undefined ? undefined : {
      version: statVersion(remote.machineId, remote.path, value),
      type: kindOf(value),
      ...(value.isFile() ? { size: value.size } : {}),
    }
  }

  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    const remote = resolveRemoteExecutionPath(path, opts?.cwd)
    if (remote === undefined) return await super.lstat(path, opts, signal)
    const value = await this.remoteStat(remote.machineId, remote.path, signal, true)
    if (value === undefined) return undefined
    return {
      version: statVersion(remote.machineId, remote.path, value),
      type: value.isSymbolicLink() ? 'symlink' : value.isFile() ? 'file' : value.isDirectory() ? 'directory' : 'other',
      ...(value.isFile() ? { size: value.size } : {}),
    }
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    return decodeText(await this.readBytes(target, signal, Number.MAX_SAFE_INTEGER), target.displayPath)
  }

  override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const text = await this.readText(target, signal)
    // oxlint-disable-next-line typescript/require-await -- AsyncIterable requires an async iterator.
    return { async *[Symbol.asyncIterator]() { yield text } }
  }

  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const remote = parseRemoteExecutionPath(String(target.targetKey))
    if (remote === undefined) return await super.readBytes(target, signal, maxBytes)
    const info = await this.stat(target, signal)
    if (info === undefined) throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
    if (info.type !== 'file') throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
    if (info.size !== undefined && info.size > maxBytes) throw new FsError(`cannot read "${target.displayPath}": file exceeds ${maxBytes} bytes`, 'FS_TOO_LARGE')
    const sftp = await this.ctx.remoteMachines.connections.sftp(remote.machineId)
    try {
      aborted(signal, 'read')
      const value = await call<Buffer>((done) => { sftp.readFile(remote.path, done) })
      aborted(signal, 'read')
      if (value.byteLength > maxBytes) throw new FsError(`cannot read "${target.displayPath}": file exceeds ${maxBytes} bytes`, 'FS_TOO_LARGE')
      return value
    } catch (error) {
      throw mapError(error, 'read', remote.path, signal)
    } finally { sftp.end() }
  }

  override async readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array> {
    const bytes = await this.readBytes(target, signal, range.offset + range.length)
    return bytes.subarray(range.offset, range.offset + range.length)
  }

  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const remote = parseRemoteExecutionPath(String(target.targetKey))
    if (remote === undefined) return await super.listDir(target, signal)
    const sftp = await this.ctx.remoteMachines.connections.sftp(remote.machineId)
    try {
      aborted(signal, 'list')
      const entries = await new Promise<Array<{ filename: string; attrs: Stats }>>((resolve, reject) => {
        sftp.readdir(remote.path, (error, list) => {
          if (error == null) resolve(list)
          else reject(error)
        })
      })
      return entries.map((entry) => {
        const child = posix.join(remote.path, entry.filename)
        return {
          name: entry.filename,
          type: kindOf(entry.attrs),
          target: {
            targetKey: FsTargetKey(remoteExecutionPath(remote.machineId, child)),
            displayPath: remoteExecutionPath(remote.machineId, child),
          },
          version: statVersion(remote.machineId, child, entry.attrs),
          ...(entry.attrs.isFile() ? { size: entry.attrs.size } : {}),
        }
      }).sort((a, b) => a.name.localeCompare(b.name))
    } catch (error) {
      throw mapError(error, 'list', remote.path, signal)
    } finally { sftp.end() }
  }

  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    const remote = parseRemoteExecutionPath(String(target.targetKey))
    if (remote === undefined) return await super.writeText(target, content, expected, signal, sandboxPolicy)
    this.assertWritable(target, sandboxPolicy)
    return await this.withRemoteLock(String(target.targetKey), async () => {
      const current = await this.stat(target, signal)
      if (current !== undefined && current.type !== 'file') throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      if (expected?.kind === 'createIfAbsent' && current !== undefined) throw new FsError(`cannot create "${target.displayPath}": target was not observed absent`, 'FS_NOT_OBSERVED')
      if (expected?.kind === 'replaceIfVersion' && (current === undefined || current.version !== expected.version)) throw new FsError(`cannot write "${target.displayPath}": stale file version`, 'FS_STALE_VERSION')
      const before = current === undefined ? null : await this.readText(target, signal)
      const sftp = await this.ctx.remoteMachines.connections.sftp(remote.machineId)
      const temporary = posix.join(posix.dirname(remote.path), `.dsh-${randomUUID()}.tmp`)
      try {
        aborted(signal, 'write')
        await callVoid((done) => { sftp.writeFile(temporary, Buffer.from(content, 'utf8'), done) })
        const rename = Reflect.get(sftp, 'ext_openssh_rename') as
          ((from: string, to: string, done: (error?: Error) => void) => void) | undefined
        if (rename !== undefined) {
          await new Promise<void>((resolve, reject) => {
            rename.call(sftp, temporary, remote.path, (error) => {
              if (error === undefined) resolve()
              else reject(error)
            })
          })
        } else {
          await callVoid((done) => { sftp.rename(temporary, remote.path, done) })
        }
      } catch (error) {
        void new Promise<void>((resolve) => {
          sftp.unlink(temporary, () => { resolve() })
        })
        throw mapError(error, 'write', remote.path, signal)
      } finally { sftp.end() }
      const after = content.replaceAll('\r\n', '\n')
      const next = await this.stat(target, signal)
      if (next === undefined) throw new FsError(`cannot write "${target.displayPath}": published file disappeared`, 'FS_IO_ERROR')
      return { operation: current === undefined ? 'create' : 'update', version: next.version, before, after }
    })
  }

  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: ReturnType<typeof FsVersion> },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    const remote = parseRemoteExecutionPath(String(target.targetKey))
    if (remote === undefined) return await super.editText(target, edit, expected, signal, sandboxPolicy)
    this.assertWritable(target, sandboxPolicy)
    return await this.withRemoteLock(String(target.targetKey), async () => {
      const info = await this.stat(target, signal)
      if (info === undefined) throw new FsError(`cannot edit "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      if (expected !== undefined && info.version !== expected.version) throw new FsError(`cannot edit "${target.displayPath}": stale file version`, 'FS_STALE_VERSION')
      const before = await this.readText(target, signal)
      const after = replaceLiteral(before, edit, target.displayPath)
      const result = await this.writeText(target, after, { kind: 'replaceIfVersion', version: info.version }, signal, sandboxPolicy)
      return { version: result.version, before, after }
    })
  }

  private assertWritable(target: FsTarget, policy?: SandboxExecutionPolicy): void {
    const effective = policy ?? this.ctx.sandboxPolicy.resolve()
    if (effective.mode === 'danger-full-access') return
    if (effective.mode === 'read-only') throw new FsError(`cannot write "${target.displayPath}": read-only mode`, 'FS_SANDBOX_DENIED')
    const root = effective.workspaceRoot
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Runtime policies cross a plugin boundary.
    if (root === undefined) throw new FsError(`cannot write "${target.displayPath}": workspace root unavailable`, 'FS_SANDBOX_DENIED')
    const resolvedRoot = parseRemoteExecutionPath(root)
    const resolvedTarget = parseRemoteExecutionPath(String(target.targetKey))
    if (resolvedRoot === undefined || resolvedTarget === undefined || resolvedRoot.machineId !== resolvedTarget.machineId) {
      throw new FsError(`cannot write "${target.displayPath}": outside remote workspace`, 'FS_SANDBOX_DENIED')
    }
    const relative = posix.relative(resolvedRoot.path, resolvedTarget.path)
    if (relative === '..' || relative.startsWith('../') || posix.isAbsolute(relative)) throw new FsError(`cannot write "${target.displayPath}": outside remote workspace`, 'FS_SANDBOX_DENIED')
  }

  private async remoteStat(machineId: string, path: string, signal?: AbortSignal, lstat = false): Promise<Stats | undefined> {
    const sftp = await this.ctx.remoteMachines.connections.sftp(machineId)
    try {
      aborted(signal, 'stat')
      return await call<Stats>((done) => {
        if (lstat) sftp.lstat(path, done)
        else sftp.stat(path, done)
      })
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      if (code === 2 || code === 'ENOENT') return undefined
      throw mapError(error, 'stat', path, signal)
    } finally { sftp.end() }
  }

  private async canonicalPath(sftp: SFTPWrapper, path: string): Promise<string> {
    const suffix: string[] = []
    let cursor = posix.normalize(path)
    for (;;) {
      try {
        const base = await call<string>((done) => { sftp.realpath(cursor, done) })
        return posix.join(base, ...suffix.reverse())
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code
        if (code !== 2 && code !== 'ENOENT') throw error
        const parent = posix.dirname(cursor)
        if (parent === cursor) throw error
        suffix.push(posix.basename(cursor))
        cursor = parent
      }
    }
  }

  private withRemoteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.remoteLocks.get(key) ?? Promise.resolve()
    const result = prior.then(operation)
    const settled = result.then(() => {}, () => {})
    this.remoteLocks.set(key, settled)
    void settled.finally(() => { if (this.remoteLocks.get(key) === settled) this.remoteLocks.delete(key) })
    return result
  }
}

export default SshFileSystem
