// Remove retired Antigravity routes without changing other providers or account credentials.
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withFileLock, writeFileAtomic } from '../packages/util/atomic-write/src/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const YAML = createRequire(join(root, 'packages/experimental/pi-tui/package.json'))('yaml')
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const tags = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] }

function remove(node) {
  let changed = false
  if (YAML.isSeq(node)) {
    const remaining = node.items.filter(item => !(YAML.isMap(item) && item.get('id') === 'agent-default-model'
      && item.getIn(['config', 'provider']) === 'antigravity'))
    if (remaining.length !== node.items.length) { node.items = remaining; changed = true }
    for (const item of node.items) changed = remove(item) || changed
  } else if (YAML.isMap(node)) {
    const config = node.get('config', true)
    if (node.get('id') === 'llm-pi-ai' && YAML.isMap(config)) {
      const providers = config.get('providers', true)
      if (YAML.isMap(providers)) changed = providers.delete('antigravity') || changed
    }
    if (node.get('id') === 'agent-presets') {
      const models = node.getIn(['config', 'models'], true)
      if (YAML.isMap(models)) changed = models.delete('antigravity') || changed
    }
    if (node.get('id') === 'proxy-servers') {
      const config = node.get('config', true)
      if (YAML.isMap(config)) {
        for (const key of ['antigravityEnabled', 'antigravityPort', 'antigravityProviders']) changed = config.delete(key) || changed
        const external = config.get('externalProxies', true)
        if (YAML.isSeq(external)) {
          const remaining = external.items.filter(item => !YAML.isScalar(item) || item.value !== 'antigravity')
          if (remaining.length !== external.items.length) { external.items = remaining; changed = true }
        } else if (external !== undefined) throw new Error('externalProxies must be a literal list before removal')
      }
    }
    if (node.get('id') === 'pi-tui' && YAML.isMap(config) && config.get('provider') === 'antigravity') {
      for (const key of ['provider', 'model', 'reasoningEffort']) config.delete(key)
      changed = true
    }
    for (const pair of node.items) changed = remove(pair.value) || changed
  }
  return changed
}

let stage = 'validate arguments'
try {
  if (args.some(arg => arg !== '--dry-run')) throw new Error('Only --dry-run is supported')
  const paths = [join(home, 'cordis.patch.yml')]
  let profiles = []
  try { profiles = await readdir(join(home, 'profiles'), { withFileTypes: true }) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const profile of profiles) {
    if (profile.isDirectory() && profile.name !== 'node_modules') paths.push(join(home, 'profiles', profile.name, 'cordis.patch.yml'))
  }
  const plans = []
  stage = 'prepare configuration changes'
  for (const file of paths) {
    let before
    try { before = await readFile(file) }
    catch (error) { if (error.code !== 'ENOENT') throw error; continue }
    const document = YAML.parseDocument(new TextDecoder('utf-8', { fatal: true }).decode(before), tags)
    if (document.errors.length || !YAML.isSeq(document.contents)) throw new Error('Invalid patch document')
    // Shared YAML aliases require manual expansion before editing provider maps.
    YAML.visit(document, { Alias() { throw new Error('Expand YAML aliases before removal') } })
    if (remove(document.contents)) plans.push({ file, before, after: Buffer.from(String(document)) })
  }
  if (dryRun || plans.length === 0) {
    console.log(JSON.stringify({ dryRun, changedFiles: plans.map(plan => plan.file) }))
  } else {
    const backupRoot = join(home, 'backups')
    stage = 'create private configuration backup'
    await mkdir(backupRoot, { recursive: true, mode: 0o700 })
    const backup = await mkdtemp(join(backupRoot, 'antigravity-removal-'))
    for (const [index, plan] of plans.entries()) await writeFile(join(backup, `${index}.yml`), plan.before, { mode: 0o600, flag: 'wx' })
    await writeFile(join(backup, 'manifest.json'), JSON.stringify(plans.map((plan, index) => ({ file: plan.file, backup: `${index}.yml` }))), { mode: 0o600, flag: 'wx' })
    console.log(`Configuration backup: ${backup}`)
    // Config Editor acquires profile package locks before the home patch lock.
    const locks = [...new Set(paths.slice(1).map(file => join(dirname(file), 'package.json')))].sort()
    locks.push(paths[0], ...plans.filter(plan => plan.file !== paths[0]).map(plan => plan.file).sort())
    async function commit(index) {
      if (index < locks.length) return withFileLock(locks[index], () => commit(index + 1), { waitMs: 30000 })
      for (const plan of plans) if (!(await readFile(plan.file)).equals(plan.before)) throw new Error('Configuration changed during removal')
      const applied = []
      try {
        for (const plan of plans) {
          await writeFileAtomic(plan.file, plan.after, { mode: 0o600, dirMode: 0o700 })
          applied.push(plan)
        }
      } catch (error) {
        for (const plan of applied.reverse()) {
          if (!(await readFile(plan.file)).equals(plan.after)) throw new Error('Rollback refused a concurrent edit; restore the backup manually')
          await writeFileAtomic(plan.file, plan.before, { mode: 0o600, dirMode: 0o700 })
        }
        throw error
      }
    }
    stage = 'commit configuration under locks'
    await commit(0)
    console.log(JSON.stringify({ removed: true, changedFiles: plans.map(plan => plan.file) }))
  }
} catch {
  console.error(`Antigravity removal failed during ${stage}; check UTF-8 patch syntax, expand YAML aliases, and restore the printed backup if needed. Credentials were not modified.`)
  process.exitCode = 1
}
