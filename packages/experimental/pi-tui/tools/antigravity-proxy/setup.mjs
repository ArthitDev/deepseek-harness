#!/usr/bin/env node
/**
 * One-command Antigravity setup for a fresh clone: installs a silent
 * autostart launcher for the in-repo proxy, starts it, and walks the Google
 * sign-in in the browser — no Antigravity CLI, no other download. The
 * provider itself is already registered by the pi-tui bundle patch, so the
 * TUI lists Antigravity models as soon as this script succeeds.
 *
 * Usage: node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs [--dry-run] [--no-browser]
 * Windows installs a Startup-folder VBS; other platforms start a background
 * process for this session and require an OS service for startup at login.
 */
import { spawn, execFileSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dryRun = process.argv.includes('--dry-run')
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../../..')
const proxyScript = join(here, 'antigravity_proxy.mjs')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', 'tui')
const port = Number(process.env.ANTIGRAVITY_PORT ?? 18877)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ANTIGRAVITY_PORT')
const endpoint = `http://127.0.0.1:${port}`
const vbsPath = join(dshHome, 'start-antigravity-proxy.vbs')
const logFile = join(dshHome, 'logs', 'antigravity-proxy.log')
const startup = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

const fail = (message) => {
  console.error(`setup: ${message}`)
  process.exit(1)
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

if (!existsSync(proxyScript)) fail(`proxy script missing at ${proxyScript}`)

/** Create the `tui` profile on first run — it lives under ~/.dsh, not the repo. */
function ensureTuiProfile() {
  if (existsSync(join(profileDir, 'package.json'))) {
    console.log(`profile ok: ${profileDir}`)
    return
  }
  const bootstrap = [
    process.execPath, '--import', 'tsx/esm',
    join(repoRoot, 'apps', 'cli', 'src', 'bin.ts'),
    'plugin', '--profile', 'tui', 'add',
    join(repoRoot, 'packages', 'experimental', 'pi-tui'),
  ]
  if (dryRun) {
    console.log(`dry-run: would create the tui profile via:\n  ${bootstrap.join(' ')}`)
    return
  }
  console.log('creating the `tui` profile (first run only)…')
  execFileSync(bootstrap[0], bootstrap.slice(1), { stdio: 'inherit', cwd: repoRoot })
}

// Silent launcher: no console window; the proxy keeps its own token chain.
const vbs = [
  'Set shell = CreateObject("WScript.Shell")',
  'shell.Environment("Process")("HOST") = "127.0.0.1"',
  `shell.Environment("Process")("ANTIGRAVITY_PORT") = "${port}"`,
  `shell.Run """${process.execPath}"" ""${proxyScript}""", 0, False`,
  '',
].join('\n')

if (dryRun) {
  ensureTuiProfile()
  if (process.platform === 'win32') {
    console.log(`dry-run: would write ${vbsPath} and copy it to ${join(startup, 'antigravity-proxy.vbs')}`)
  }
  console.log(`dry-run: would start ${endpoint} and open the Google sign-in if not yet authenticated`)
  process.exit(0)
}

ensureTuiProfile()

if (process.platform === 'win32') {
  mkdirSync(dirname(vbsPath), { recursive: true })
  writeFileSync(vbsPath, vbs)
  mkdirSync(startup, { recursive: true })
  copyFileSync(vbsPath, join(startup, 'antigravity-proxy.vbs'))
  console.log(`autostart installed: ${join(startup, 'antigravity-proxy.vbs')}`)
} else {
  console.log('setup starts the proxy for this session; configure your OS service manager for startup at login')
}

// Reuse an already-running proxy (a repeat setup or the autostart launcher);
// its auth state is what matters, not which process owns the port.
const health = async () => {
  try {
    const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) })
    const payload = await response.json()
    if (!response.ok || payload.service !== 'antigravity-proxy') fail(`another service is using ${endpoint}`)
    return true
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false
    fail(`could not verify ${endpoint}/health; ${error.message}`)
  }
}
let healthy = await health()
if (!healthy) {
  mkdirSync(dirname(logFile), { recursive: true })
  const output = openSync(logFile, 'a', 0o600)
  try {
    const child = spawn(process.execPath, [proxyScript], {
      detached: true, stdio: ['ignore', output, output], windowsHide: true,
      env: { ...process.env, HOST: '127.0.0.1', ANTIGRAVITY_PORT: String(port) },
    })
    child.on('error', error => console.error(`setup: proxy launch failed: ${error.message}`))
    child.unref()
  } finally { closeSync(output) }
  for (let attempt = 0; attempt < 20 && !healthy; attempt++) {
    await sleep(500)
    healthy = await health()
  }
}
if (!healthy) fail(`proxy did not become healthy at ${endpoint}/health; see ${logFile}`)
console.log(`proxy healthy at ${endpoint}`)

const authStatus = async () =>
  fetch(`${endpoint}/auth/status`, { signal: AbortSignal.timeout(2000) })
    .then((response) => response.json())
    .catch(() => undefined)

let status = await authStatus()
if (status === undefined) fail(`proxy is up but does not answer ${endpoint}/auth/status`)

if (status.authenticated !== true) {
  console.log(`sign-in URL: ${endpoint}/auth/login`)
  if (!process.argv.includes('--no-browser')) {
    console.log('opening Google sign-in; choose the account and approve the prompt')
    const [opener, args] = process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', `${endpoint}/auth/login`]]
      : process.platform === 'darwin'
        ? ['open', [`${endpoint}/auth/login`]]
        : ['xdg-open', [`${endpoint}/auth/login`]]
    const browser = spawn(opener, args, { detached: true, stdio: 'ignore', windowsHide: true })
    browser.on('error', () => console.log('open the sign-in URL manually in your browser'))
    browser.unref()
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      await sleep(2000)
      status = await authStatus()
      if (status === undefined) continue
      if (status.authenticated === true) break
      if (status.error !== undefined) console.log(`waiting: ${status.error}`)
    }
    if (status?.authenticated !== true) {
      fail(`sign-in did not complete within 3 minutes — open ${endpoint}/auth/login again, or check the log`)
    }
  }
}

if (status?.authenticated === true) {
  console.log('authenticated — token chain saved by the proxy')
  console.log('done — open `dsh tui` (restart it if already open) and pick a model under Antigravity in /model')
} else console.log('proxy running; complete sign-in at the printed URL before using Antigravity')
