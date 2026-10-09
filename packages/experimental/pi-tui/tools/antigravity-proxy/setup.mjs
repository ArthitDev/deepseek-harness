#!/usr/bin/env node
/**
 * One-command Antigravity setup for a fresh clone: installs a silent
 * autostart launcher for the in-repo proxy, starts it, and walks the Google
 * sign-in in the browser — no Antigravity CLI, no other download. The
 * provider itself is already registered by the pi-tui bundle patch, so the
 * TUI lists Antigravity models as soon as this script succeeds.
 *
 * Usage: node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs [--dry-run]
 * Windows installs a Startup-folder VBS; other platforms print the manual
 * background command instead.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dryRun = process.argv.includes('--dry-run')
const here = dirname(fileURLToPath(import.meta.url))
const proxyScript = join(here, 'antigravity_proxy.mjs')
const endpoint = 'http://127.0.0.1:8877'
const vbsPath = join(homedir(), '.dsh', 'start-antigravity-proxy.vbs')
const startup = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

const fail = (message) => {
  console.error(`setup: ${message}`)
  process.exit(1)
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

if (!existsSync(proxyScript)) fail(`proxy script missing at ${proxyScript}`)

// Silent launcher: no console window; the proxy keeps its own token chain.
const vbs = [
  'Set shell = CreateObject("WScript.Shell")',
  `shell.Run """${process.execPath}"" ""${proxyScript}""", 0, False`,
  '',
].join('\n')

if (process.platform !== 'win32') {
  console.log(`non-Windows: run the proxy in the background — node ${proxyScript}`)
  process.exit(0)
}

if (dryRun) {
  console.log(`dry-run: would write ${vbsPath} and copy it to ${join(startup, 'antigravity-proxy.vbs')}`)
  console.log(`dry-run: would start ${endpoint} and open the Google sign-in if not yet authenticated`)
  process.exit(0)
}

mkdirSync(dirname(vbsPath), { recursive: true })
writeFileSync(vbsPath, vbs)
mkdirSync(startup, { recursive: true })
copyFileSync(vbsPath, join(startup, 'antigravity-proxy.vbs'))
console.log(`autostart installed: ${join(startup, 'antigravity-proxy.vbs')}`)

// Reuse an already-running proxy (a repeat setup or the autostart launcher);
// its auth state is what matters, not which process owns the port.
let healthy = false
for (let attempt = 0; attempt < 10 && !healthy; attempt++) {
  if (attempt > 0) await sleep(500)
  spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref()
  healthy = await fetch(`${endpoint}/health`)
    .then((response) => response.ok)
    .catch(() => false)
}
if (!healthy) fail(`proxy did not become healthy at ${endpoint}/health — check it manually: node ${proxyScript}`)
console.log(`proxy healthy at ${endpoint}`)

const authStatus = async () =>
  fetch(`${endpoint}/auth/status`)
    .then((response) => response.json())
    .catch(() => undefined)

let status = await authStatus()
if (status === undefined) fail(`proxy is up but does not answer /auth/status — is another process holding port 8877?`)

if (status.authenticated !== true) {
  console.log('opening Google sign-in in your browser — choose the account and approve the prompt…')
  spawn('cmd.exe', ['/c', 'start', '', `${endpoint}/auth/login`], { detached: true, stdio: 'ignore' }).unref()
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

console.log('authenticated — token chain saved by the proxy')
console.log('done — open `dsh tui` (restart it if already open) and pick a model under Antigravity in /model')
