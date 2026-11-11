/** Working-directory diagnostics performed only after a local process failed to start. */
import { stat } from 'node:fs/promises'
import { SubprocessWorkingDirectoryError } from '@deepseek-ai/dsh-subprocess'

/**
 * Reject a start failure with confirmed directory state, retaining the original cause.
 * @param error - original local process failure; other failures pass through unchanged.
 * @param workdir - directory requested by the caller.
 * @param signal - when supplied, its exact cancellation reason passes through unchanged.
 * @returns never; rejects with a directory diagnostic or the original failure.
 */
export async function rejectWithWorkingDirectory(error: unknown, workdir: string, signal?: AbortSignal): Promise<never> {
  if (signal?.aborted && error === signal.reason) throw error
  if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    && 'syscall' in error && typeof error.syscall === 'string'
    && (error.syscall === 'spawn' || error.syscall.startsWith('spawn ')
      || error.syscall === 'chdir' || error.syscall === 'execve')) {
    let reason: 'missing' | 'not-directory' | undefined
    try {
      if (!(await stat(workdir)).isDirectory()) reason = 'not-directory'
    } catch (inspectionError) {
      if (inspectionError instanceof Error && 'code' in inspectionError) {
        if (inspectionError.code === 'ENOENT') reason = 'missing'
        else if (inspectionError.code === 'ENOTDIR') reason = 'not-directory'
      }
      // Inconclusive inspection must preserve the original process failure.
    }
    if (reason !== undefined) throw new SubprocessWorkingDirectoryError(workdir, reason, { cause: error })
  }
  throw error
}
