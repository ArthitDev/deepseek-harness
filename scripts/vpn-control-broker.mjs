/** Restricted Linux Mullvad control socket for isolated Harness processes. */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, chownSync, lstatSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const socketPath = '/run/dsh-kali-broker/vpn.sock'
const states = new Set(['connected', 'connecting', 'disconnected', 'disconnecting', 'error'])

/** Build the fixed two-operation server; callers own its listening socket and shutdown. */
export function createVpnControlServer(run) {
  let reconnecting = false
  return createServer(async (req, res) => {
    const reply = (code, value) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    const action = req.method === 'GET' && req.url === '/status' ? 'status'
      : req.method === 'POST' && req.url === '/reconnect' ? 'reconnect' : undefined
    if (action === undefined || req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
      req.resume(); reply(400, { error: 'invalid-operation' }); return
    }
    if (action === 'reconnect' && reconnecting) { reply(409, { error: 'reconnect-in-progress' }); return }
    if (action === 'reconnect') reconnecting = true
    try {
      const value = await run(action)
      reply(200, { state: states.has(value?.state) ? value.state : 'unknown' })
    } catch (error) {
      void error // CLI output may contain account/network details; return only the outcome.
      reply(503, { error: 'control-failed' })
    } finally {
      if (action === 'reconnect') reconnecting = false
    }
  })
}

function runMullvad(action) {
  return new Promise((resolve, reject) => {
    let outcome
    let failure
    const child = execFile('/usr/bin/mullvad', action === 'status' ? ['status', '--json'] : ['reconnect', '--wait'], {
      env: {}, timeout: action === 'status' ? 10000 : 45000, killSignal: 'SIGKILL', maxBuffer: 16384,
    }, (error, stdout) => {
      failure = error
      if (error === null) {
        try { outcome = action === 'status' ? JSON.parse(stdout) : { state: 'unknown' } }
        catch (parseError) { failure = parseError }
      }
    })
    child.once('close', () => { if (failure) reject(failure); else resolve(outcome) })
  })
}

function main() {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Run this broker as root on Linux')
  const directory = statSync(dirname(socketPath))
  if (directory.uid !== 0 || (directory.mode & 0o022) !== 0) throw new Error('VPN control directory must be root-owned without group/other write access')
  try {
    const existing = lstatSync(socketPath)
    if (!existing.isSocket() || existing.uid !== 0) throw new Error('Refusing to replace a non-root socket')
    unlinkSync(socketPath)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const server = createVpnControlServer(runMullvad)
  server.listen(socketPath, () => { chownSync(socketPath, 0, directory.gid); chmodSync(socketPath, 0o660) })
  const stop = () => { server.close(); server.closeAllConnections() }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
