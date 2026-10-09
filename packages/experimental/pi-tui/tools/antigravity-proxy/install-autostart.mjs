// Installs the CLIProxyAPI autostart entry: a minimal config.yaml when absent,
// a silent VBS launcher beside the binary, and the Startup-folder link.
// Usage: node packages/experimental/pi-tui/tools/antigravity-proxy/install-autostart.mjs [cliproxyDir]
// The directory defaults to $CLIPROXY_DIR, else ~/.dsh/cliproxy.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const cliproxyDir = resolve(
  process.argv[2] ?? process.env.CLIPROXY_DIR ?? join(homedir(), '.dsh', 'cliproxy'),
)
const exe = join(cliproxyDir, 'cli-proxy-api.exe')
const config = join(cliproxyDir, 'config.yaml')
const startup = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

if (!existsSync(exe)) {
  console.error(
    `CLIProxyAPI not found at ${exe}\n` +
    'Download the release zip from https://github.com/router-for-me/CLIProxyAPI/releases\n' +
    'and unzip it there (or pass the directory as the first argument).',
  )
  process.exit(1)
}

// Minimal v8 config: local-only OpenAI-compatible endpoint on 127.0.0.1:8317
// with the 'shield-break' key; the Antigravity OAuth tokens land in ~/.cli-proxy-api.
if (!existsSync(config)) {
  writeFileSync(config, `config-version: 8
server:
  host: "127.0.0.1"
  port: 8317
access:
  api-keys:
    - "shield-break"
oauth:
  auth-dir: "~/.cli-proxy-api"
`)
  console.log(`wrote ${config}`)
}

// Silent launcher: no console window, config beside the binary.
const vbs = [
  'Set shell = CreateObject("WScript.Shell")',
  `shell.Run """${exe}"" --config ""${config}""", 0, False`,
  '',
].join('\n')
writeFileSync(join(cliproxyDir, 'start-cliproxy.vbs'), vbs)
mkdirSync(startup, { recursive: true })
copyFileSync(join(cliproxyDir, 'start-cliproxy.vbs'), join(startup, 'cliproxy.vbs'))

console.log(`installed: cliproxy autostart (Startup folder) → http://127.0.0.1:8317`)
console.log(`next: run "${exe}" --antigravity-login once to link the Google account`)
