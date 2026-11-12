import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const image = process.argv[2]
assert(image && !image.startsWith('-') && process.argv.length === 3,
  'usage: node scripts/kali/verify.mjs <image> (requires a Linux Docker engine)')

const checker = '/usr/local/libexec/dsh-kali/check.sh'
const cases = [
  { name: 'fresh runtime', args: [], command: [checker], expected: 'Kali readiness passed (offline)', status: 0 },
  {
    name: 'disabled seccomp', args: ['--security-opt', 'seccomp=unconfined'],
    command: [checker], expected: 'seccomp filtering is required', status: 1,
  },
  {
    name: 'wrong APT cache owner',
    args: ['--tmpfs', '/var/cache/apt/archives/partial:uid=42,gid=0,mode=700'],
    command: [checker], expected: 'incorrect cache ownership', status: 1,
  },
  {
    name: 'missing APT sandbox configuration', args: [],
    command: ['/bin/sh', '-ec', `rm /etc/apt/apt.conf.d/99dsh-restricted-broker; exec ${checker}`],
    expected: 'APT configuration missing', status: 1,
  },
  {
    name: 'incomplete package database', args: [],
    command: ['python3', '-c', `from pathlib import Path
import os
p = Path('/var/lib/dpkg/status')
p.write_text(p.read_text().replace('Status: install ok installed', 'Status: install ok unpacked', 1))
os.execl('${checker}', '${checker}')`],
    expected: 'dpkg has incomplete packages', status: 1,
  },
]

for (const test of cases) {
  const container = `dsh-kali-check-${randomUUID()}`
  try {
    const result = spawnSync('docker', [
      'run', '--rm', '--name', container, '--network', 'none',
      '--cap-drop', 'ALL', '--cap-add', 'NET_RAW', '--security-opt', 'no-new-privileges:true',
      ...test.args, '--entrypoint', test.command[0], image, ...test.command.slice(1),
    ], { encoding: 'utf8', timeout: 120_000 })
    if (result.error) throw result.error
    assert.equal(result.signal, null, `${test.name}: Docker client ended by signal`)
    assert.equal(result.status, test.status, `${test.name}: ${result.stdout}\n${result.stderr}`)
    assert((result.stdout + result.stderr).includes(test.expected), `${test.name}: expected diagnostic missing`)
    console.log(`PASS: ${test.name}`)
  }
  finally {
    // --rm handles normal exit; remove a container left by a client timeout.
    const cleanup = spawnSync('docker', ['rm', '--force', container], { encoding: 'utf8', timeout: 30_000 })
    if (cleanup.error) throw cleanup.error
    assert.equal(cleanup.signal, null, 'Docker cleanup ended by signal')
    assert(cleanup.status === 0 || /No such container/.test(cleanup.stderr), cleanup.stderr)
  }
}
