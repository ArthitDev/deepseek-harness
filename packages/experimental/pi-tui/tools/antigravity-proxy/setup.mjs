#!/usr/bin/env node
/**
 * One-command Antigravity setup for a fresh clone: verifies the Antigravity
 * CLI's OAuth token, installs a silent autostart launcher for the in-repo
 * proxy, starts it, and health-checks the endpoint. The provider itself is
 * already registered by the pi-tui bundle patch, so the TUI lists Antigravity
 * models as soon as this script succeeds — no /provider step, no other repo.
 *
 * Usage: node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs [--dry-run]
 * Windows installs a Startup-folder VBS; other platforms print the manual
 * background command instead.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dryRun = process.argv.includes('--dry-run')
const here = dirname(fileURLToPath(import.meta.url))
const proxyScript = join(here, 'antigravity_proxy.mjs')
const tokenFile = join(homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token')
const endpoint = 'http://127.0.0.1:8877'
const vbsPath = join(homedir(), '.dsh', 'start-antigravity-proxy.vbs')
const startup = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

const fail = (message) => {
  console.error(`setup: ${message}`)
  process.exit(1)
}

if (!existsSync(proxyScript)) fail(`proxy script missing at ${proxyScript}`)

// The proxy refreshes Google's OAuth tokens itself; it only needs the
// Antigravity CLI's login to have produced the token file once.
if (existsSync(tokenFile)) {
  try {
    const raw = JSON.parse(readFileSync(tokenFile, 'utf8'))
    const token = raw.token ?? raw
    if (!token.refresh_token) fail(`token file ${tokenFile} has no refresh_token — re-run the Antigravity CLI (\`agy\`) to authenticate`)
    console.log(`token file OK: ${tokenFile}`)
  } catch (error) {
    fail(`token file ${tokenFile} is not valid JSON (${error.message}) — re-run the Antigravity CLI (\`agy\`)`)
  }
} else {
  fail(
    `no Antigravity OAuth token at ${tokenFile}\n` +
    'Run the Antigravity CLI once to authenticate, then re-run this setup:\n' +
    '  agy',
  )
}

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
  console.log(`dry-run: would start ${endpoint} now`)
  process.exit(0)
}

mkdirSync(dirname(vbsPath), { recursive: true })
writeFileSync(vbsPath, vbs)
mkdirSync(startup, { recursive: true })
copyFileSync(vbsPath, join(startup, 'antigravity-proxy.vbs'))
console.log(`autostart installed: ${join(startup, 'antigravity-proxy.vbs')}`)

spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' }).unref()

let healthy = false
for (let attempt = 0; attempt < 10 && !healthy; attempt++) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 500))
  healthy = await fetch(`${endpoint}/health`)
    .then((response) => response.ok)
    .catch(() => false)
}
if (!healthy) fail(`proxy did not become healthy at ${endpoint}/health — check it manually: node ${proxyScript}`)
console.log(`proxy healthy at ${endpoint}`)
console.log('done — open `dsh tui` (restart it if already open) and pick a model under Antigravity in /model')
