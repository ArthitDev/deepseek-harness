// Run with Bun after Google sign-in; replace only the Antigravity route and keep a rollback copy.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withFileLock, writeFileAtomic } from '../packages/util/atomic-write/src/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const YAML = createRequire(join(root, 'packages/experimental/pi-tui/package.json'))('yaml')
const tags = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] }
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const port = Number(process.env.ANTIGRAVITY_PORT ?? 18877)
const entries = document => document.contents.items.flatMap(row => {
  const insert = YAML.isMap(row) ? row.get('insert', true) : undefined
  return YAML.isSeq(insert) ? insert.items : [row]
})
const parse = text => {
  const document = YAML.parseDocument(text, tags)
  if (document.errors.length || !YAML.isSeq(document.contents)) throw new Error('Invalid patch document')
  return document
}
let stage = 'read bundled provider'

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
  const bundle = parse(await readFile(join(root, 'packages/experimental/pi-tui/cordis.patch.yml'), 'utf8'))
  const native = entries(bundle).find(row => YAML.isMap(row) && row.get('id') === 'llm-pi-ai')
    .getIn(['config', 'providers', 'antigravity'], true).clone()
  native.set('baseURL', `http://127.0.0.1:${port}/v1`)
  const paths = [join(home, 'cordis.patch.yml')]
  let profiles = []
  try { profiles = await readdir(join(home, 'profiles'), { withFileTypes: true }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const profile of profiles) if (profile.isDirectory() && profile.name !== 'node_modules') paths.push(join(home, 'profiles', profile.name, 'cordis.patch.yml'))
  const plans = []
  let homeOwnsProvider = false
  for (const file of paths) {
    stage = `prepare ${file === paths[0] ? 'home' : basename(dirname(file))} patch`
    let before
    let existed = true
    try { before = await readFile(file, 'utf8') }
    catch (error) { if (error.code !== 'ENOENT') throw error; before = '[]\n'; existed = false }
    const document = parse(before)
    let rows = entries(document).filter(row => YAML.isMap(row) && row.get('id') === 'llm-pi-ai')
    if (rows.length > 1) throw new Error('Duplicate provider entries')
    if (file === paths[0]) homeOwnsProvider = rows.length > 0
    if (rows.length === 0 && file !== paths[0] && !homeOwnsProvider) {
      const output = execFileSync('node', [join(root, 'apps/cli/lib/bin.js'), '--profile', basename(dirname(file)), '--dump-config'], {
        cwd: root, env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', windowsHide: true, timeout: 30000,
      })
      const effective = entries(parse(output)).find(row => YAML.isMap(row) && row.get('id') === 'llm-pi-ai')
      if (!effective) throw new Error('Provider entry missing from effective profile')
      const row = effective.clone()
      document.contents.add(row)
      rows = [row]
    }
    for (const row of rows) {
      const providers = row.getIn(['config', 'providers'], true)
      if (!YAML.isMap(providers)) throw new Error('Invalid provider map')
      providers.set('antigravity', native.clone())
    }
    for (const row of entries(document)) {
      if (!YAML.isMap(row) || row.get('id') !== 'proxy-servers') continue
      const config = row.get('config', true)
      if (!YAML.isMap(config)) throw new Error('Invalid proxy manager config')
      config.set('antigravityPort', port)
      config.set('antigravityProviders', ['antigravity'])
      const external = config.get('externalProxies', true)
      if (external !== undefined) {
        if (!YAML.isSeq(external)) throw new Error('externalProxies must be a literal list before migration')
        config.set('externalProxies', external.items.filter(item => item.value !== 'antigravity').map(item => item.clone()))
      }
    }
    const after = String(document)
    if (after !== before) plans.push({ file, before, after, existed })
  }
  if (paths.length === 1 && plans.length === 0) throw new Error('Install a Harness profile before configuring Antigravity')
  if (plans.length === 0) { console.log('Antigravity already uses the bundled backend'); process.exit(0) }
  const backupRoot = join(home, 'backups')
  stage = 'create private configuration backup'
  await mkdir(backupRoot, { recursive: true, mode: 0o700 })
  const backup = await mkdtemp(join(backupRoot, 'antigravity-direct-'))
  for (const [index, plan] of plans.entries()) await writeFile(join(backup, `${index}.yml`), plan.before, { mode: 0o600, flag: 'wx' })
  await writeFile(join(backup, 'manifest.json'), JSON.stringify(plans.map((plan, index) => ({ file: plan.file, backup: `${index}.yml`, existed: plan.existed }))), { mode: 0o600, flag: 'wx' })
  console.log(`Antigravity configuration backup: ${backup}`)
  // Config Editor takes profile package locks before the home patch lock.
  const locks = [...new Set(paths.slice(1).map(file => join(dirname(file), 'package.json')))].sort()
  locks.push(paths[0], ...plans.filter(plan => plan.file !== paths[0]).map(plan => plan.file).sort())
  async function commit(index) {
    if (index < locks.length) return withFileLock(locks[index], () => commit(index + 1), { waitMs: 30000 })
    for (const plan of plans) {
      let current
      try { current = await readFile(plan.file, 'utf8') }
      catch (error) { if (error.code !== 'ENOENT') throw error; current = '[]\n' }
      if (current !== plan.before) throw new Error('Configuration changed during migration; retry setup')
    }
    const applied = []
    try {
      for (const plan of plans) {
        await writeFileAtomic(plan.file, plan.after, { mode: 0o600, dirMode: 0o700 })
        applied.push(plan)
      }
    } catch (error) {
      for (const plan of applied.reverse()) {
        if (await readFile(plan.file, 'utf8') !== plan.after) throw new Error('Rollback refused a concurrent edit; restore the backup manually')
        if (plan.existed) await writeFileAtomic(plan.file, plan.before, { mode: 0o600, dirMode: 0o700 })
        else await unlink(plan.file)
      }
      throw error
    }
  }
  stage = 'commit configuration under locks'
  await commit(0)
  console.log(`Antigravity configured at http://127.0.0.1:${port}/v1; backup: ${backup}`)
} catch {
  console.error(`Antigravity configuration failed during ${stage}. Check patch syntax and restore from the printed backup directory if any files changed. Credentials were not modified.`)
  process.exitCode = 1
}
