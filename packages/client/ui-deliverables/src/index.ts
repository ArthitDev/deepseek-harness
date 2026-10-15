/**
 * Deliverables plugin, node half. Registers Web file-reference guidance and
 * serves authenticated native opens of declared files. The browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import { registerPresentOpen } from './present-open.ts'

/** Services required for file-reference guidance, change summaries, and authenticated native opens. */
export const inject = ['systemPrompt', 'connection', 'sessionQuery', 'sessionController', 'workspaceFiles', 'fs', 'sandboxPolicy', 'workspaceChanges']

/** Static Web guidance for primary outputs and existing-file references. */
const FILE_REFERENCE_PROMPT = "OUTPUT DISPLAY\nDefault: show primary results inline in final response + brief explanation.\n\nPRESENT TOOL\nUse present ONLY when a separate file card helps user open the deliverable:\n\n  - Office documents, spreadsheets, slide decks\n  - NOT just to list edited source files\n  - NOT to check whether diff view will appear\nLimits: 1-2 most important deliverables max 4 files per present call do not repeat results already shown inline unless card adds useful access\n\nFILE LINKS\nMarkdown links to files: Report → opens in sidebar preview\n\nImages: inline preview:Preview\n\n  - include file link for clients that can't render inline\nFILE REFERENCE FORMAT\nLink every mention of an existing file to its path (relative to cwd or absolute).\n\nLabels: default: filename only (e.g. \"report.html\") disambiguate: add parent dirs only when needed NEVER use full paths as labels\n\nLine numbers (when precise location matters): markdown link → append #L24 or #L24-L30 plain text → append :24 or :24–30 (no # or L)\n\nException: commands, config expressions, code blocks — no links needed."

/**
 * Register Web file-reference guidance and native opens for declared files.
 * @param ctx - host context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  registerPresentOpen(ctx)
  ctx.systemPrompt.section({
    name: 'ui:deliverable-file-references',
    order: ctx.systemPrompt.getSectionOrder('DELIVERABLE_FILE_REFERENCES'),
    text: FILE_REFERENCE_PROMPT,
  })
}
