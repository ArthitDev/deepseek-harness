/** Cross-platform absolute namespace reserved for remote execution identities. */
export const REMOTE_PATH_ROOT = '/__dsh_ssh__/'
const MACHINE_ID = /^[a-z][a-z0-9-]{0,63}$/

function normalizeAbsolute(path: string): string {
  if (!path.startsWith('/')) throw new TypeError(`remote path must be absolute: ${JSON.stringify(path)}`)
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** Parsed machine identity and POSIX path from the internal remote namespace. */
export interface RemoteExecutionPath {
  readonly machineId: string
  readonly path: string
}

/**
 * Check whether a value can identify a saved machine in a remote path.
 * @param value - Candidate identifier.
 * @returns whether the identifier is valid.
 */
export function isRemoteMachineId(value: string): boolean {
  return MACHINE_ID.test(value)
}

/**
 * Encode a machine and absolute POSIX path for shared filesystem consumers.
 * @param machineId - Valid saved machine identifier.
 * @param path - Absolute remote path.
 * @returns the machine-qualified internal path.
 */
export function remoteExecutionPath(machineId: string, path: string): string {
  if (!isRemoteMachineId(machineId)) throw new TypeError(`invalid remote machine id: ${JSON.stringify(machineId)}`)
  return `${REMOTE_PATH_ROOT}${machineId}${normalizeAbsolute(path)}`
}

/**
 * Parse a machine-qualified internal path.
 * @param value - Candidate path.
 * @returns the parsed remote location, or undefined for a local path.
 */
export function parseRemoteExecutionPath(value: string): RemoteExecutionPath | undefined {
  if (!value.startsWith(REMOTE_PATH_ROOT)) return undefined
  const rest = value.slice(REMOTE_PATH_ROOT.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  const machineId = rest.slice(0, slash)
  if (!isRemoteMachineId(machineId)) return undefined
  const path = normalizeAbsolute(rest.slice(slash))
  return { machineId, path }
}

/**
 * Resolve a path against a remote working directory when present.
 * @param path - Absolute, relative, or machine-qualified path.
 * @param cwd - Optional machine-qualified working directory.
 * @returns the resolved remote location, or undefined for local execution.
 */
export function resolveRemoteExecutionPath(path: string, cwd?: string): RemoteExecutionPath | undefined {
  const direct = parseRemoteExecutionPath(path)
  if (direct !== undefined) return direct
  const base = cwd === undefined ? undefined : parseRemoteExecutionPath(cwd)
  if (base === undefined) return undefined
  return { machineId: base.machineId, path: normalizeAbsolute(path.startsWith('/') ? path : `${base.path}/${path}`) }
}

/**
 * Remove the internal machine prefix from a remote path for display.
 * @param path - Local or machine-qualified path.
 * @returns the remote POSIX path or the unchanged local path.
 */
export function displayExecutionPath(path: string): string {
  return parseRemoteExecutionPath(path)?.path ?? path
}
