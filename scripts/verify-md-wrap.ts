/**
 * Reject Markdown prose paragraphs spanning multiple physical lines. The GFM
 * AST distinguishes paragraphs—including those in lists and blockquotes—from
 * multiline structural nodes. The checker never rewrites; symlinked instruction
 * files are deduped. VitePress frontmatter and custom-container delimiters are
 * masked before parsing. The owning convention is in `docs/AGENTS.md`.
 */

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Nodes } from 'mdast'
import { parseMarkdown, visitMarkdown } from './markdown.ts'
import { isArchivedAgentNotePath, uniqueRepoFiles } from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

/** Files to check: doc-typecheck's scope, system-prompt expected outputs, and the AGENTS.md pair. */
const PATTERNS = [
  'README.md',
  'README.zh.md',
  '.agents/notes/**/*.md',
  'docs/**/*.md',
  'packages/*/*.md',
  'packages/*/*/*.md',
  'packages/*/*/docs/*.md',
  'snapshots/**/system-prompt.expected.md',
  'snapshots/**/system-prompt.windows.expected.md',
  'packages/**/system-prompt.expected.md',
  'AGENTS.md',
  'packages/AGENTS.md',
  'snapshots/AGENTS.md',
]

/** A located hard-wrap: a prose paragraph spanning more than one source line. */
export interface Violation {
  /** Repository-relative Markdown path. */
  file: string
  /** 1-based line where the hard-wrapped paragraph starts. */
  line: number
  /** First line of the rejected paragraph. */
  text: string
}

// Recorded raw policy blocks retain runtime line breaks; prose elsewhere is still checked.
const LITERAL_PROMPT_BLOCKS = new Set([
  '═══════════════════════════════════════════\nMODE: RED_TEAM\n═══════════════════════════════════════════\n[MODE: RED_TEAM — ACTIVE]',
  'RECON WORKFLOW\nTriggers — user asks to: assess / scan / enumerate a target find vulnerabilities in a target exploit or attack any host or URL',
  'Workflow (strict order):\n  1.Call recon_scan on the target→ deterministic, no-LLM, Full Deep profile\n  2.Read report → extract coverage + warnings\n  3.Continue with targeted tools based on findings\nRe-run condition: recon_scan is NOT re-run unless target state may have changed.',
])

function maskVitePressStructure(source: string): string {
  const lines = source.split('\n')
  if (lines[0] === '---') {
    const closing = lines.indexOf('---', 1)
    if (closing !== -1) {
      for (let index = 0; index <= closing; index++) lines[index] = ''
    }
  }
  return lines.map(line => line.trimStart().startsWith(':::') ? '' : line).join('\n')
}

/**
 * Find hard-wrapped Markdown prose, retaining exact recorded raw policy blocks.
 * @param file - Repository-relative path; literal blocks are limited to their owning Web pins.
 * @param source - Markdown text with LF or CRLF line endings.
 * @returns Located paragraphs requiring one physical line.
 */
export function hardWrappedProse(file: string, source: string): Violation[] {
  const lines = source.split(/\r?\n/)
  const parsedSource = maskVitePressStructure(source)
  const tree = parseMarkdown(parsedSource)
  const out: Violation[] = []

  visitMarkdown(tree, (node: Nodes): boolean | void => {
    if (node.type === 'paragraph' && node.position) {
      const { start, end } = node.position
      if (end.line > start.line) {
        const raw = lines.slice(start.line - 1, end.line).join('\n')
        const literalOwner = /^snapshots\/web\/(creator-persona|optional-string-editor-windows|optional-string-editor-landlock-partial)\/system-prompt(?:\.windows)?\.expected\.md$/.test(file.replaceAll('\\', '/'))
        if (literalOwner && LITERAL_PROMPT_BLOCKS.has(raw)) return false
        const firstLine = lines[start.line - 1] ?? ''
        out.push({ file, line: start.line, text: firstLine.trim() })
      }
      // Paragraph children are inline, so no further paragraph can be nested.
      return false
    }
  })
  return out
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  const files = uniqueRepoFiles(root, PATTERNS, isArchivedAgentNotePath)
  const all = files.flatMap(file => hardWrappedProse(relative(root, file.abs), readFileSync(file.abs, 'utf8')))
  if (all.length === 0) {
    console.log(`verify-md-wrap: ${files.length} file(s) checked, no hard-wrapped prose paragraphs.`)
  } else {
    console.error('verify-md-wrap: hard-wrapped prose paragraphs found (write one physical line per paragraph):')
    for (const v of all) {
      console.error(`  ${v.file}:${v.line}  ${v.text.slice(0, 80)}${v.text.length > 80 ? '…' : ''}`)
    }
    process.exitCode = 1
  }
}
