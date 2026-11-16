/** Local Mullvad control; no shell or operator-supplied command arguments. */
import { execFile } from 'node:child_process'
import { request } from 'node:http'
import { win32 } from 'node:path'

/** The control plane never establishes that traffic uses the VPN. */
export interface VpnControlResult {
  kind: 'ok' | 'busy' | 'unavailable' | 'failed'
  tunnel: 'connected' | 'connecting' | 'disconnected' | 'disconnecting' | 'error' | 'unknown'
}

/** Resolve the installed CLI, without searching the project working directory.
 * @param platform - operating system of this Host.
 * @param programFiles - Windows installation root; ignored on Linux.
 * @returns absolute Mullvad executable, or undefined on unsupported systems.
 */
export function mullvadExecutable(platform: string, programFiles: string): string | undefined {
  if (platform === 'linux') return '/usr/bin/mullvad'
  if (platform === 'win32' && win32.isAbsolute(programFiles)) return win32.join(programFiles, 'Mullvad VPN', 'resources', 'mullvad.exe')
  return undefined
}

/** Validate local CLI/broker output and discard addresses and other account data.
 * @param value - parsed JSON from the local control plane.
 * @returns sanitized tunnel state.
 */
export function tunnelState(value: unknown): VpnControlResult['tunnel'] {
  if (typeof value !== 'object' || value === null || !('state' in value)) return 'unknown'
  switch (value.state) {
    case 'connected': case 'connecting': case 'disconnected': case 'disconnecting': case 'error': return value.state
    default: return 'unknown'
  }
}

/** Run one bounded local operation; a socket selects the restricted Linux broker.
 * @param action - fixed operation chosen by the operator command.
 * @param socketPath - configured broker socket, or empty to use the installed local CLI.
 * @param signal - lifetime/deadline cancellation owned by the service.
 * @returns sanitized control outcome, never CLI output or a verification claim.
 */
export async function controlVpn(action: 'status' | 'reconnect', socketPath: string, signal: AbortSignal): Promise<VpnControlResult> {
  if (signal.aborted) return { kind: 'failed', tunnel: 'unknown' }
  if (socketPath !== '') return socketControl(action, socketPath, signal)
  const executable = mullvadExecutable(process.platform, process.env.ProgramFiles ?? 'C:\\Program Files')
  if (executable === undefined) return { kind: 'unavailable', tunnel: 'unknown' }
  const args = action === 'status' ? ['status', '--json'] : ['reconnect', '--wait']
  return new Promise((resolve) => {
    const child = execFile(executable, args, { windowsHide: true, maxBuffer: 16384, killSignal: 'SIGKILL', env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } }, (error, stdout) => {
      let result: VpnControlResult = { kind: 'failed', tunnel: 'unknown' }
      if (error === null && !signal.aborted) {
        if (action === 'reconnect') result = { kind: 'ok', tunnel: 'unknown' }
        else {
          try { result = { kind: 'ok', tunnel: tunnelState(JSON.parse(stdout)) } }
          catch (parseError) { void parseError /* Malformed local output cannot confirm tunnel state. */ }
        }
      } else if (error !== null && 'code' in error && error.code === 'ENOENT') result.kind = 'unavailable'
      outcome = result
    })
    let outcome: VpnControlResult = { kind: 'failed', tunnel: 'unknown' }
    const abort = (): void => { child.kill('SIGKILL') }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.once('close', () => { signal.removeEventListener('abort', abort); resolve(outcome) })
  })
}

function socketControl(action: 'status' | 'reconnect', socketPath: string, signal: AbortSignal): Promise<VpnControlResult> {
  return new Promise((resolve) => {
    const req = request({ socketPath, path: '/' + action, method: action === 'status' ? 'GET' : 'POST', signal, agent: false }, (res) => {
      let body = ''
      res.on('data', (part: Buffer) => { body += part.toString('utf8'); if (body.length > 16384) res.destroy(new Error('VPN control response too large')) })
      res.on('error', () => { resolve({ kind: 'failed', tunnel: 'unknown' }) })
      res.on('end', () => {
        if (res.statusCode === 409) { resolve({ kind: 'busy', tunnel: 'unknown' }); return }
        if (res.statusCode !== 200) { resolve({ kind: 'failed', tunnel: 'unknown' }); return }
        try { resolve({ kind: 'ok', tunnel: tunnelState(JSON.parse(body)) }) }
        catch (error) { void error; resolve({ kind: 'failed', tunnel: 'unknown' }) }
      })
    })
    req.on('error', (error) => { resolve({ kind: 'code' in error && error.code === 'ENOENT' ? 'unavailable' : 'failed', tunnel: 'unknown' }) })
    req.end()
  })
}
