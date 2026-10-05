// One-off: install the CLIProxyAPI autostart entry (Startup folder + launcher).
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const packageTools = 'packages/experimental/pi-tui/tools/antigravity-proxy'
const cliproxyDir = resolve('E:/Cybersecure-Pentest/cliproxy')
const startup = join(homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

if (!existsSync(join(cliproxyDir, 'cli-proxy-api.exe'))) {
  console.error(`CLIProxyAPI not found at ${cliproxyDir} — download the release zip first`)
  process.exit(1)
}

// Silent launcher: no console window, config beside the binary.
const vbs = [
  'Set shell = CreateObject("WScript.Shell")',
  'shell.Run """E:\\Cybersecure-Pentest\\cliproxy\\cli-proxy-api.exe"" --config ""E:\\Cybersecure-Pentest\\cliproxy\\config.yaml""", 0, False',
  '',
].join('\n')
writeFileSync(join(cliproxyDir, 'start-cliproxy.vbs'), vbs)
mkdirSync(startup, { recursive: true })
copyFileSync(join(cliproxyDir, 'start-cliproxy.vbs'), join(startup, 'cliproxy.vbs'))

console.log('installed: cliproxy autostart (Startup folder) → http://127.0.0.1:8317')
