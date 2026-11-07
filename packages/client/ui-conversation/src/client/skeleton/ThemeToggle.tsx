/** Light/dark flip for the conversation header utilities strip. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconDarkOutlineRegular, IconLightOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ThemeToggle.module.css'

/** Resolved color scheme the toggle flips between. */
export type ThemeMode = 'light' | 'dark'

/** Registration-side face for the theme toggle. */
export interface ThemeToggleInjected {
  hooks: {
    /** Active color scheme bound as useThemeMode. */
    themeMode: SnapshotStore<ThemeMode>
  }
  /** Apply the opposite concrete color scheme. */
  toggleTheme: () => void
}

/** Full header-utilities props. */
export type ThemeToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'conversation'>
  & InjectFace<ThemeToggleInjected>

/**
 * Toggle directly between light and dark mode.
 * @param props - composed utilities-slot props.
 * @returns the toggle button element.
 */
export function ThemeToggle({ useThemeMode, toggleTheme, t }: ThemeToggleProps) {
  const dark = useThemeMode(mode => mode === 'dark')
  const label = t(dark ? 'theme.toLight' : 'theme.toDark')
  const Icon = dark ? IconLightOutlineRegular : IconDarkOutlineRegular

  return (
    <Tooltip label={label} side="bottom" delayMs={300}>
      <button
        type="button"
        className={css.button}
        aria-label={label}
        onClick={toggleTheme}
      >
        <Icon />
      </button>
    </Tooltip>
  )
}
