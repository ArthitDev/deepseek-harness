#!/usr/bin/env node
/**
 * Post-clone environment setup for the Shield Break Harness checkout.
 *
 * Checks the required toolchain (git, node, npm, pnpm), reports anything
 * missing with its fix, then installs dependencies, builds, and prepares the
 * optional root `.env`. Zero dependencies: runnable with plain `node` before
 * the first `pnpm install`.
 *
 * Usage:
 *   node scripts/setup.mjs                 check → fix → install → build → env
 *   node scripts/setup.mjs --check         report only; fix and run nothing
 *   node scripts/setup.mjs --no-install    skip `pnpm install`
 *   node scripts/setup.mjs --no-build      skip `pnpm run build`
 *
 * @module setup
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const IS_WIN = process.platform === 'win32'

const args = new Set(process.argv.slice(2))
const CHECK_ONLY = args.has('--check')
const SKIP_INSTALL = args.has('--no-install')
const SKIP_BUILD = args.has('--no-build')

/** Root manifest read once; engines and packageManager drive the version checks. */
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const NODE_RANGE = manifest.engines?.node ?? '>=22'
const PNPM_VERSION = manifest.packageManager?.split('@')[1] ?? 'latest'

/**
 * Run one command, inheriting stdio so long steps stream live.
 * @param command - executable name; Windows `.cmd` shims resolve through the shell.
 * @param argv - arguments passed verbatim.
 * @returns the completed result with stdout captured when silent.
 */
function run(command, argv, { silent = false } = {}) {
  // Windows resolves `.cmd` shims only through a shell; a single concatenated
  // command string keeps DEP0190 away (arguments are fixed literals here).
  const invoked = IS_WIN ? [`${command} ${argv.join(' ')}`] : [command, ...argv]
  return spawnSync(...invoked, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: IS_WIN,
    stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
}

/**
 * Read one command's version string (`--version`), tolerating absence.
 * @param command - executable name.
 * @returns the trimmed version output, or undefined when the command is missing.
 */
function versionOf(command) {
  const result = run(command, ['--version'], { silent: true })
  if (result.status !== 0 || result.error !== undefined) return undefined
  return String(result.stdout ?? '').trim().split('\n')[0]
}

/**
 * Decide whether a semantic version satisfies the harness node range.
 * Supports the ranges the manifest declares: `^22.19.0` and `>=24.0.0`.
 * @param version - dotted version, optionally prefixed with `v`.
 * @param range - the engines.node string from the root manifest.
 * @returns true when the version satisfies every clause of the range.
 */
function nodeSatisfies(version, range) {
  const parts = String(version).replace(/^v/, '').split('.').map(Number)
  const [major, minor] = parts
  for (const clause of range.split('||')) {
    const trimmed = clause.trim()
    const caret = /^\^(\d+)\.(\d+)/.exec(trimmed)
    if (caret !== null) {
      const [cMajor, cMinor] = [Number(caret[1]), Number(caret[2])]
      if (major === cMajor && minor >= cMinor) return true
      continue
    }
    const gte = />=(\d+)/.exec(trimmed)
    if (gte !== null && major >= Number(gte[1])) return true
  }
  return false
}

const STATUS = { ok: '✓', missing: '✗', warn: '!' }
const report = []

/**
 * Record one check line.
 * @param name - the tool or condition being reported.
 * @param status - outcome marker.
 * @param detail - version, fix hint, or explanation.
 */
function note(name, status, detail) {
  report.push(`${STATUS[status] ?? '!'} ${name.padEnd(10)} ${detail}`)
}

console.log(`Shield Break Harness setup — ${ROOT}`)
console.log(`node range: ${NODE_RANGE} · pnpm: ${PNPM_VERSION}${CHECK_ONLY ? ' · check only' : ''}\n`)

// ── required toolchain ────────────────────────────────────────────────────
const gitVersion = versionOf('git')
gitVersion === undefined
  ? note('git', 'missing', 'not found on PATH — install from https://git-scm.com')
  : note('git', 'ok', gitVersion)

const nodeVersion = versionOf('node')
let nodeOk = false
if (nodeVersion === undefined) {
  note('node', 'missing', `not found on PATH — install a version matching ${NODE_RANGE} (e.g. winget install OpenJS.NodeJS.LTS)`)
} else if (!(nodeOk = nodeSatisfies(nodeVersion, NODE_RANGE))) {
  note('node', 'missing', `${nodeVersion} does not satisfy ${NODE_RANGE} — upgrade from https://nodejs.org`)
} else {
  note('node', 'ok', nodeVersion)
}

const npmVersion = versionOf('npm')
npmVersion === undefined
  ? note('npm', 'missing', 'ships with node — a node install normally provides it')
  : note('npm', 'ok', npmVersion)

let pnpmVersion = versionOf('pnpm')
if (pnpmVersion === undefined && !CHECK_ONLY) {
  // corepack ships with supported node versions and activates the manifest's
  // pinned pnpm; when it is unavailable, a global npm install is the fallback.
  console.log('pnpm missing — activating via corepack…')
  const enable = run('corepack', ['enable'], { silent: true })
  const prepare = enable.status === 0
    ? run('corepack', ['prepare', `pnpm@${PNPM_VERSION}`, '--activate'], { silent: true })
    : enable
  pnpmVersion = prepare.status === 0 ? versionOf('pnpm') : undefined
}
if (pnpmVersion === undefined) {
  note('pnpm', 'missing', `install it: npm install -g pnpm@${PNPM_VERSION}`)
} else {
  note('pnpm', 'ok', pnpmVersion)
}

// ── optional capabilities (reported, never fail setup) ───────────────────
const pythonVersion = versionOf(IS_WIN ? 'python' : 'python3')
pythonVersion === undefined
  ? note('python', 'warn', 'optional — some analysis skills script against python 3.9+')
  : note('python', 'ok', `${pythonVersion} (optional)`)

if (IS_WIN) {
  const wsl = run('wsl', ['-l', '-q'], { silent: true })
  const distros = String(wsl.stdout ?? '').replaceAll('\0', '')
  note('wsl', distros.includes('kali-linux') ? 'ok' : 'warn',
    distros.includes('kali-linux')
      ? 'kali-linux available (offensive toolchain world)'
      : 'optional — the kali-wsl guide needs a kali-linux WSL distro')
}

console.log(report.join('\n'), '\n')

const blocking = report.filter(line => line.startsWith(STATUS.missing))
if (blocking.length > 0) {
  console.log('Blocked — fix the missing entries above, then rerun this script:')
  for (const line of blocking) console.log(`  ${line.slice(2)}`)
  process.exit(1)
}
if (CHECK_ONLY) {
  console.log('Check complete — nothing missing.')
  process.exit(0)
}

// ── install + build ───────────────────────────────────────────────────────
if (!SKIP_INSTALL) {
  console.log('\n▶ pnpm install')
  const install = run('pnpm', ['install', '--prefer-offline'])
  if (install.status !== 0) process.exit(install.status ?? 1)
}

if (!SKIP_BUILD) {
  console.log('\n▶ pnpm run build')
  const build = run('pnpm', ['run', 'build'])
  if (build.status !== 0) process.exit(build.status ?? 1)
}

// ── env shortcut ──────────────────────────────────────────────────────────
const ENV_PATH = join(ROOT, '.env')
if (existsSync(ENV_PATH)) {
  const set = readFileSync(ENV_PATH, 'utf8')
    .split('\n')
    .filter(line => /^[A-Z_]+=.+/.test(line) && !/^[A-Z_]+=\s*$/.test(line)).length
  console.log(`\n.env exists with ${set} value(s) set — left untouched.`)
} else {
  writeFileSync(ENV_PATH, [
    '# Optional: real-API e2e and demos read these; keyless runs self-skip.',
    '# DEEPSEEK_API_KEY=',
    '# DEEPSEEK_BASE_URL=',
    '',
  ].join('\n'))
  console.log('\n.env created with a commented template — fill DEEPSEEK_API_KEY to run real-API tests.')
}

console.log([
  '',
  'Setup complete. Next:',
  '  pnpm run test          # unit tests (keyless)',
  '  pnpm dsh tui           # terminal front door',
  '  pnpm dsh web           # web front door',
  '',
].join('\n'))
