/** Parse the machine-qualified path namespace used by workspace records. */

const REMOTE_PATH_ROOT = '/__dsh_ssh__/'
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

/** @returns the parsed remote location, or undefined for a local path. */
export function parseRemoteExecutionPath(value: string): { readonly machineId: string; readonly path: string } | undefined {
  if (!value.startsWith(REMOTE_PATH_ROOT)) return undefined
  const rest = value.slice(REMOTE_PATH_ROOT.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  const machineId = rest.slice(0, slash)
  if (!MACHINE_ID.test(machineId)) return undefined
  return { machineId, path: normalizeAbsolute(rest.slice(slash)) }
}
