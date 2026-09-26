import type { ReactNode } from 'react'
import { ICON_MEDIUM_STROKE, ICON_REGULAR_STROKE, SHIELD_OUTLINE_PATH } from './icons/index.tsx'
import type { IconProps } from './icons/props.ts'

interface PermissionIconArtworkProps extends IconProps {
  strokeWidth: number
}

function ReadOnlyArtwork({ size = 16, className, strokeWidth }: PermissionIconArtworkProps): ReactNode {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
      <path d={SHIELD_OUTLINE_PATH} stroke="currentColor" strokeLinejoin="round" />
      <path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor" />
    </svg>
  )
}

function WorkspaceWriteArtwork({ size = 16, className, strokeWidth }: PermissionIconArtworkProps): ReactNode {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
      <path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor" />
      <path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor" />
      <path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor" />
      <path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor" />
      <path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor" />
    </svg>
  )
}

function FullAccessArtwork({ size = 16, className, strokeWidth }: PermissionIconArtworkProps): ReactNode {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={strokeWidth}>
      <path d={SHIELD_OUTLINE_PATH} stroke="currentColor" strokeLinejoin="round" />
      <path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor" />
      <path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor" />
    </svg>
  )
}

/**
 * Render the read-only permission icon with a one-pixel stroke.
 * @param props - Size and optional class.
 * @returns The regular decorative permission glyph.
 */
export function PermissionIconReadOnlyRegular(props: IconProps): ReactNode {
  return <ReadOnlyArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
}

/**
 * Render the read-only permission icon with a 1.3px stroke.
 * @param props - Size and optional class.
 * @returns The medium decorative permission glyph.
 */
export function PermissionIconReadOnlyMedium(props: IconProps): ReactNode {
  return <ReadOnlyArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
}

/**
 * Render the workspace-write permission icon with a one-pixel stroke.
 * @param props - Size and optional class.
 * @returns The regular decorative permission glyph.
 */
export function PermissionIconWorkspaceWriteRegular(props: IconProps): ReactNode {
  return <WorkspaceWriteArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
}

/**
 * Render the workspace-write permission icon with a 1.3px stroke.
 * @param props - Size and optional class.
 * @returns The medium decorative permission glyph.
 */
export function PermissionIconWorkspaceWriteMedium(props: IconProps): ReactNode {
  return <WorkspaceWriteArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
}

/**
 * Render the full-access permission icon with a one-pixel stroke.
 * @param props - Size and optional class.
 * @returns The regular decorative permission glyph.
 */
export function PermissionIconFullAccessRegular(props: IconProps): ReactNode {
  return <FullAccessArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
}

/**
 * Render the full-access permission icon with a 1.3px stroke.
 * @param props - Size and optional class.
 * @returns The medium decorative permission glyph.
 */
export function PermissionIconFullAccessMedium(props: IconProps): ReactNode {
  return <FullAccessArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
}
