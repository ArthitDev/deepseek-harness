#!/usr/bin/env node
/** Sign in to the bundled proxy, then migrate shared routes; Harness owns normal process startup. */
import { spawn, execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../../..')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const port = Number(process.env.ANTIGRAVITY_PORT ?? 18877)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ANTIGRAVITY_PORT')
const endpoint = `http://127.0.0.1:${port}`
const configure = () => execFileSync('bun', ['--no-env-file', join(root, 'scripts/antigravity-direct-setup.mjs')], {
  cwd: root, env: { ...process.env, DSH_HOME: dshHome, ANTIGRAVITY_PORT: String(port) }, windowsHide: true, stdio: 'inherit',
})
if (process.argv.includes('--dry-run')) {
  console.log(`Would sign in at ${endpoint}/auth/login, back up configuration, and migrate Antigravity to ${endpoint}/v1. No Startup launcher is installed.`)
  process.exit(0)
}
if (process.argv.includes('--configure-only')) { configure(); process.exit(0) }

const proxyScript = join(here, 'antigravity_proxy.mjs')
const logFile = join(dshHome, 'logs/antigravity-proxy.log')
let child
let closed
let launchFailed = false
const shutdown = async () => {
  if (!child) return
  if (child.exitCode === null && child.signalCode === null) child.kill()
  const force = setTimeout(() => child.kill('SIGKILL'), 2000)
  try { await closed } finally { clearTimeout(force) }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown().finally(() => process.exit(1)) })

async function health() {
  try {
    const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) })
    const payload = await response.json()
    if (!response.ok || payload.service !== 'antigravity-proxy') throw new Error(`Another service is using ${endpoint}`)
    return true
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED' || error.code === 'ConnectionRefused') return false
    throw error
  }
}

try {
  if (!existsSync(proxyScript)) throw new Error('Bundled Antigravity script is missing')
  if (!await health()) {
    mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 })
    const output = openSync(logFile, 'a', 0o600)
    try {
      child = spawn('bun', ['--no-env-file', proxyScript], {
        cwd: root, stdio: ['ignore', output, output], windowsHide: true,
        env: { ...process.env, HOST: '127.0.0.1', ANTIGRAVITY_PORT: String(port) },
      })
      closed = new Promise(resolveClosed => child.once('close', resolveClosed))
      child.once('error', () => { launchFailed = true })
    } finally { closeSync(output) }
    let ready = false
    for (let attempt = 0; attempt < 30; attempt++) {
      if (launchFailed || child.exitCode !== null || child.signalCode !== null) break
      if (await health()) { ready = true; break }
      await sleep(300)
    }
    if (!ready) throw new Error(`Bundled proxy did not start; check ${logFile}`)
  }
  const authStatus = async () => {
    const response = await fetch(`${endpoint}/auth/status`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) throw new Error('Antigravity auth status is unavailable')
    return response.json()
  }
  let status = await authStatus()
  if (status.authenticated !== true) {
    console.log(`Complete Google sign-in: ${endpoint}/auth/login`)
    if (!process.argv.includes('--no-browser')) {
      const [opener, args] = process.platform === 'win32'
        ? ['rundll32.exe', ['url.dll,FileProtocolHandler', `${endpoint}/auth/login`]]
        : process.platform === 'darwin' ? ['open', [`${endpoint}/auth/login`]] : ['xdg-open', [`${endpoint}/auth/login`]]
      const browser = spawn(opener, args, { stdio: 'ignore', windowsHide: true })
      browser.once('error', () => console.log('Open the sign-in URL manually'))
      browser.unref()
    }
    const deadline = Date.now() + 180000
    while (Date.now() < deadline && status.authenticated !== true) {
      await sleep(2000)
      status = await authStatus()
    }
    if (status.authenticated !== true) throw new Error('Google sign-in did not complete; the existing route was kept. Run setup again to retry.')
  }
  configure()
  console.log('Google token chain present. Restart Web/TUI to use the bundled Antigravity route; upstream quota still requires a model call.')
} catch (error) {
  console.error(`Antigravity setup: ${error.message}`)
  process.exitCode = 1
} finally { await shutdown() }
