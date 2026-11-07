import { SHIELD_OUTLINE_PATH } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the Shield Break mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the Shield Break shield mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={SHIELD_OUTLINE_PATH} fill="currentColor" />
    </svg>
  )
}
