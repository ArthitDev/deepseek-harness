/** Persistent, id-targeted enablement edits for trusted Web clients. */
import { createHash } from 'node:crypto'
import { load, dump } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

type Row = Record<string, unknown>

/**
 * Hash the exact document so stale browser edits cannot overwrite newer text.
 * @param content - exact document text the hash covers.
 * @returns the SHA-256 hex digest of the content.
 */
export function revision(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Parse the Loader dialect without evaluating configuration expressions.
 * @param content - YAML document text holding an array of entries.
 * @returns the parsed entry rows.
 * @throws when the document is not a YAML array of entries.
 */
export function readRows(content: string): Row[] {
  const value: unknown = load(content, { schema: entryListSchema })
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Plugin configuration must be a YAML array of entries')
  }
  return value as Row[]
}

/**
 * Find an unambiguous literal row; disabled/conditional ancestors cannot be bypassed.
 * @param rows - parsed entry rows to search, including nested groups.
 * @param id - entry id as the inventory spells it; a full id ending in the row id also matches.
 * @param moduleName - plugin module name the row must carry.
 * @returns the single matching literal row.
 * @throws when the match is missing or ambiguous, or an ancestor disables it.
 */
export function findRow(rows: Row[], id: string, moduleName: string): Row {
  const matches: { row: Row; blocked: boolean }[] = []
  const visit = (entries: Row[], blocked: boolean): void => {
    for (const row of entries) {
      if (typeof row.id === 'string' && (row.id === id || id.endsWith(`:${row.id}`)) && row.name === moduleName && !row.group) matches.push({ row, blocked })
      if (row.group === true && Array.isArray(row.config)) visit(row.config as Row[], blocked || Boolean(row.disabled))
    }
  }
  visit(rows, false)
  const [match] = matches
  if (matches.length !== 1 || !match) throw new Error('Plugin entry is missing or ambiguous; refresh the list')
  if (match.blocked || (match.row.disabled !== undefined && typeof match.row.disabled !== 'boolean')) {
    throw new Error('This plugin is controlled by a group or expression; edit its composition')
  }
  return match.row
}

/**
 * Change only one preset row's disabled value, preserving YAML expression values.
 * @param content - preset YAML document text holding the entry rows.
 * @param id - entry id identifying the row to change.
 * @param moduleName - plugin module name the row must carry.
 * @param enabled - enablement state to store in the row.
 * @returns the re-serialized preset document.
 */
export function presetEnablement(content: string, id: string, moduleName: string, enabled: boolean): string {
  const rows = readRows(content)
  findRow(rows, id, moduleName).disabled = !enabled
  return dump(rows, { schema: entryListSchema, noRefs: true, lineWidth: -1 })
}

/**
 * Append a narrow override; earlier comments, config values and expressions stay byte-identical.
 * @param content - profile YAML document text receiving the override row.
 * @param id - entry id the override row targets.
 * @param moduleName - plugin module name the override row targets.
 * @param enabled - enablement state the override row stores.
 * @returns the updated document text.
 */
export function globalEnablement(content: string, id: string, moduleName: string, enabled: boolean): string {
  const rows = readRows(content)
  const override = dump([{ id, name: moduleName, disabled: !enabled }], { schema: entryListSchema, lineWidth: -1 })
  const appended = `${content.trimEnd()}\n${override}`
  if (rows.length > 0) {
    try {
      readRows(appended)
      return appended
    } catch {
      // Flow-style arrays and explicit document terminators require re-serialization.
    }
  }
  return dump([...rows, { id, name: moduleName, disabled: !enabled }], { schema: entryListSchema, noRefs: true, lineWidth: -1 })
}

/**
 * Global tools and the local default-skill hook can be toggled without removing Web infrastructure.
 * @param id - entry id as the inventory spells it.
 * @param moduleName - plugin module name of the entry.
 * @returns whether the entry may be toggled from the global surface.
 */
export function globalToggleAllowed(id: string, moduleName: string): boolean {
  return /^@deepseek-ai\/dsh-tool-[a-z0-9-]+(?:\/[a-z0-9-]+)?$/.test(moduleName)
    || ((id === 'global-default-skills' || id.endsWith(':global-default-skills')) && moduleName.endsWith('/global-skills.mjs'))
}
