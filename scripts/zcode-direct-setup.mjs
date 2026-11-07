// Run with Bun after preparing ZCode. Reuse the harness's credential writer before a full build exists.
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withFileLock, writeFileAtomic } from '../packages/util/atomic-write/src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const YAML = createRequire(resolve(here, '../packages/experimental/pi-tui/package.json'))('yaml')
const filename = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')

try {
  const config = YAML.parse(await readFile(join(resolve(process.argv[2] || join(here, '../third-party/zcode-api')), 'config.yaml'), 'utf8'))
  const key = process.env.ZCODE_PROXY_API_KEY || config.auth?.proxyApiKey
  if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw new Error('Invalid proxy key')
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
  await withFileLock(filename, async () => {
    let text
    try { text = await readFile(filename, 'utf8') }
    catch (error) { if (error.code !== 'ENOENT') throw error; text = 'version: 1\nrefs: {}\n' }
    const document = YAML.parseDocument(text)
    if (document.errors.length || !YAML.isMap(document.contents)) throw new Error('Invalid credential document')
    if (document.get('version') !== 1) throw new Error('Unsupported credential document version')
    if (document.has('refs') && !YAML.isMap(document.get('refs', true))) throw new Error('Invalid credential refs')
    document.setIn(['refs', 'ZCODE_DIRECT_API_KEY'], key)
    await writeFileAtomic(filename, String(document), { mode: 0o600, dirMode: 0o700 })
  }, { waitMs: 30_000 })
  const patchFile = join(dirname(filename), 'cordis.patch.yml')
  try {
    await readFile(patchFile, 'utf8')
    await withFileLock(patchFile, async () => {
      const tags = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] }
      const patch = YAML.parseDocument(await readFile(patchFile, 'utf8'), tags)
      if (patch.errors.length || !YAML.isSeq(patch.contents)) throw new Error('Invalid home patch')
      const entries = document => document.contents.items.flatMap(row => {
        const insert = YAML.isMap(row) ? row.get('insert', true) : undefined
        return YAML.isSeq(insert) ? insert.items : [row]
      })
      const row = entries(patch).find(entry => YAML.isMap(entry) && entry.get('id') === 'llm-pi-ai')
      const providers = row?.getIn(['config', 'providers'], true)
      if (providers === undefined) return
      if (!YAML.isMap(providers)) throw new Error('Invalid home provider map')
      if (providers.has('zcode-direct')) return
      const bundle = YAML.parseDocument(await readFile(join(here, '../packages/experimental/pi-tui/cordis.patch.yml'), 'utf8'), tags)
      const source = entries(bundle).find(entry => YAML.isMap(entry) && entry.get('id') === 'llm-pi-ai')
      providers.set('zcode-direct', source.getIn(['config', 'providers', 'zcode-direct'], true).clone())
      await writeFileAtomic(patchFile, String(patch), { mode: 0o600, dirMode: 0o700 })
    }, { waitMs: 30_000 })
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  console.log('ZCode Direct credential configured: ZCODE_DIRECT_API_KEY')
} catch {
  console.error('ZCode Direct setup failed. Check config.yaml, pnpm dependencies and the harness credential document. No key was displayed.')
  process.exitCode = 1
}
