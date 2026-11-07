/**
 * Import references in Markdown instruction prose, excluding code and HTML.
 * @module @deepseek-ai/dsh-agent-instructions/imports
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

/**
 * Read unquoted `@path` references, preserving Windows separators and escaped spaces.
 * @param content - original Markdown source, before escape decoding.
 * @returns import paths in document order, excluding inline/fenced/indented code and HTML.
 */
export function instructionImports(content: string): string[] {
  // Most instruction files need neither a Markdown tree nor import metadata.
  if (!content.includes('@')) return []
  const paths: string[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'text') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) return
      const source = content.slice(start, end)
      const references = /(?:^|[\s(])@(?:\\[ \t]|[^\s`"'<>()[\]{},;!?])+/g
      for (const match of source.matchAll(references)) {
        // A text node can start immediately after a Markdown delimiter.
        const at = start + match.index + match[0].indexOf('@')
        if (at > 0 && !/[\s(]/.test(content.charAt(at - 1))) continue
        paths.push(match[0].slice(match[0].indexOf('@') + 1).replace(/\\([ \t])/g, '$1'))
      }
    } else if ('children' in node) {
      for (const child of node.children) visit(child)
    }
  }
  visit(fromMarkdown(content))
  return paths
}
