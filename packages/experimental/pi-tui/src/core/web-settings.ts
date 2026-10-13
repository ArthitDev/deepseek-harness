import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml'

/**
 * Read one saved Web profile override without evaluating executable YAML tags.
 * @param ctx - context with the shared profile home.
 * @param id - plugin row whose config to read.
 * @returns the saved config, or undefined when the file or row is absent.
 */
export function readWebProfileConfig(ctx: Context, id: string): YAMLMap | undefined {
  const profile = ctx.get('profileContext') as { home: string } | undefined
  if (profile === undefined) return undefined
  const path = join(profile.home, 'profiles', 'web', 'cordis.patch.yml')
  let source: string
  try { source = readFileSync(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  const document = parseDocument(source, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  })
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error(`pi-tui: ${path} must contain a patch sequence`)
  const index = document.contents.items.findLastIndex((item, index) =>
    isMap(item) && document.getIn([index, 'id']) === id)
  if (index < 0) return undefined
  const config = document.getIn([index, 'config'], true)
  if (!isMap(config)) throw new Error(`pi-tui: ${id} config in ${path} must be a mapping`)
  return config
}
