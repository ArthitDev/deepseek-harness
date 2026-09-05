import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconDarkOutline16, IconLightOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ThemeToggle.module.css'

export type ThemeMode = 'light' | 'dark'

export interface ThemeToggleInjected {
  hooks: {
    themeMode: SnapshotStore<ThemeMode>
  }
  toggleTheme: () => void
}

export type ThemeToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'conversation'>
  & InjectFace<ThemeToggleInjected>

/** Toggle directly between light and dark mode. */
export function ThemeToggle({ useThemeMode, toggleTheme, t }: ThemeToggleProps) {
  const dark = useThemeMode(mode => mode === 'dark')
  const label = t(dark ? 'theme.toLight' : 'theme.toDark')
  const Icon = dark ? IconLightOutline16 : IconDarkOutline16

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
