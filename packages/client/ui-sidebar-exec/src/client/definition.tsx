/**
 * Stage one of this package's registration: what the `exec` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address and takes no
 * parameters. The guide page offers it as an entry capsule, and picking it
 * opens the single executed-commands page in the pane.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const EXEC_KIND = 'exec'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const EXEC_ID = '@deepseek-ai/dsh-client-ui-sidebar-exec'

/** The type's dark terminal card at the guide capsule's glyph size, with a Kali-route prompt. */
function TerminalSheetGlyph({ size, className }: IconProps) {
  return <svg width={size} height={size} className={className} viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <path d="M22 5H6C4.34315 5 3 6.34315 3 8V21C3 22.6569 4.34315 24 6 24H22C23.6569 24 25 22.6569 25 21V8C25 6.34315 23.6569 5 22 5Z" fill="#17191D" />
    <path d="M8 10L12 14L8 18M15 18H20" stroke="white" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
}

/**
 * The exec type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function execDefinition(t: TranslateNS<'sidebarExec'>): SidebarRightTabDefinition {
  return {
    id: EXEC_ID,
    kind: EXEC_KIND,
    multiple: false,
    priority: 'builtin',
    title: () => t('type'),
    guide: [{
      id: 'history',
      order: 30,
      title: () => t('guideTitle'),
      description: () => t('guideDescription'),
      icon: TerminalSheetGlyph,
    }],
  }
}
