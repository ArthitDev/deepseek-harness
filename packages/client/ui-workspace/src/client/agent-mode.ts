import type { ThemeRuntime, ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

export type AgentMode = 'blue' | 'red' | 'black'

export interface AgentModeSettings {
  readonly mode: AgentMode
}

export interface AgentModeSettingsBinding {
  getSnapshot: () => SettingsScopeSnapshot<AgentModeSettings>
  subscribe: (listener: () => void) => () => void
  set: (key: 'mode', value: AgentMode) => Promise<void>
}

const STORAGE_KEY = 'dsh.agentMode'
const SOURCE = '@deepseek-ai/dsh-client-ui-workspace/agent-mode'
const MODE_LOGOS: Record<AgentMode, string> = {
  blue: '/new-logo-blue.png',
  red: '/new-logo.png',
  black: '/new-logo-black.png',
}
const same = (value: string) => ({ light: value, dark: value })
const mix = (foreground: string, amount: number, background = 'transparent') =>
  `color-mix(in srgb, ${foreground} ${amount}%, ${background})`

interface Scheme {
  accent: string
  accentHover: string
  base: string
  layer1: string
  onAccent: string
  text: string
  toast: string
}

function modeTokens(options: {
  logo: string
  headline: string
  glow: { light: string; dark: string }
  light: Scheme
  dark: Scheme
}): ThemeTokenOverrides {
  const tone = (pick: (scheme: Scheme) => string) => ({
    light: pick(options.light),
    dark: pick(options.dark),
  })
  const tint = (amount: number, layer: keyof Pick<Scheme, 'base' | 'layer1'> = 'base') =>
    tone(scheme => mix(scheme.accent, amount, scheme[layer]))
  const fade = (amount: number) => tone(scheme => mix(scheme.accent, amount))
  const label = (amount: number) => tone(scheme => mix(scheme.text, amount, scheme.base))

  return {
    '--dsh-agent-logo': same(`url('${options.logo}')`),
    '--dsh-agent-glow': options.glow,
    '--dsh-agent-accent': tone(scheme => scheme.accent),
    '--dsh-agent-headline': same(`"${options.headline}"`),
    '--dsw-alias-bg-base': tone(scheme => scheme.base),
    '--dsw-alias-bg-layer-1': tone(scheme => scheme.layer1),
    '--dsw-alias-bg-layer-2': tint(3, 'layer1'),
    '--dsw-alias-bg-layer-3': tint(6, 'layer1'),
    '--dsw-alias-bg-layer-4': tint(10, 'layer1'),
    '--dsw-alias-bg-module-platform': tint(5, 'layer1'),
    '--dsw-alias-bg-multi-select': tint(5, 'layer1'),
    '--dsw-alias-bg-overlay': tint(8, 'layer1'),
    '--dsw-alias-border-inverted2': fade(8),
    '--dsw-alias-border-inverted': fade(6),
    '--dsw-alias-border-l1': fade(8),
    '--dsw-alias-border-l2-darkmode-thin': fade(12),
    '--dsw-alias-border-l2': fade(16),
    '--dsw-alias-border-l3': fade(24),
    '--dsw-alias-border-l4': fade(34),
    '--dsw-alias-brand-primary-invert': tone(scheme => scheme.text),
    '--dsw-alias-brand-primary': tone(scheme => scheme.accent),
    '--dsw-alias-brand-text': tone(scheme => scheme.accent),
    '--dsw-alias-button-contrast-fill': tone(scheme => scheme.text),
    '--dsw-alias-button-elevated-fill': tint(5, 'layer1'),
    '--dsw-alias-button-floating-fill': tint(3, 'layer1'),
    '--dsw-alias-button-floating-hover': tint(10, 'layer1'),
    '--dsw-alias-button-ghost-active-border': fade(34),
    '--dsw-alias-button-ghost-active-fill': tint(10, 'layer1'),
    '--dsw-alias-button-ghost-active-hover': tint(14, 'layer1'),
    '--dsw-alias-button-info-fill': tone(scheme => scheme.accent),
    '--dsw-alias-button-info-hover': tone(scheme => scheme.accentHover),
    '--dsw-alias-button-primary-dimmed': tint(14, 'layer1'),
    '--dsw-alias-button-primary-fill': tone(scheme => scheme.accent),
    '--dsw-alias-button-primary-hover': tone(scheme => scheme.accentHover),
    '--dsw-alias-interactive-bg-active': fade(18),
    '--dsw-alias-interactive-bg-hover-accent': fade(24),
    '--dsw-alias-interactive-bg-hover-solid': tint(18, 'layer1'),
    '--dsw-alias-interactive-bg-hover': fade(10),
    '--dsw-alias-label-caption': label(45),
    '--dsw-alias-label-dimmed': label(28),
    '--dsw-alias-label-primary-bluish': tone(scheme => scheme.accent),
    '--dsw-alias-label-primary-dimmed': label(88),
    '--dsw-alias-label-primary-foreground': tone(scheme => scheme.onAccent),
    '--dsw-alias-label-primary-inverted': tone(scheme => scheme.onAccent),
    '--dsw-alias-label-primary': tone(scheme => scheme.text),
    '--dsw-alias-label-secondary': label(70),
    '--dsw-alias-label-tertiary': label(55),
    '--dsw-alias-link': tone(scheme => scheme.accent),
    '--dsw-alias-markdown-code-block-banner': tint(5, 'layer1'),
    '--dsw-alias-markdown-code-block': tint(3),
    '--dsw-alias-markdown-inline-code': tint(6, 'layer1'),
    '--dsw-alias-scrollbar-bg-l1': label(16),
    '--dsw-alias-scrollbar-bg-l2': label(22),
    '--dsw-alias-scrollbar-hover-l1': label(30),
    '--dsw-alias-scrollbar-hover-l2': label(38),
    '--dsw-alias-state-business-primary': tone(scheme => scheme.accent),
    '--dsw-alias-state-business-tertiary': tint(18, 'layer1'),
    '--dsw-alias-toast-bg': tone(scheme => scheme.toast),
    '--dsw-alias-tooltip-bg': tone(scheme => scheme.toast),
    '--dsw-specific-bubble-highlight': tint(16, 'layer1'),
    '--dsw-specific-bubble': tint(7, 'layer1'),
    '--dsw-specific-input-major': tone(scheme => scheme.layer1),
    '--dsw-specific-login-input': tint(3, 'layer1'),
    '--dsw-specific-menu': tint(6, 'layer1'),
    '--dsw-specific-selector': tint(8, 'layer1'),
    '--dsw-specific-sidebar-fill': tint(3),
    '--dsw-specific-sidebar-nav-item-active-accent': fade(18),
    '--dsw-specific-sidebar-nav-item-active': tint(10, 'layer1'),
    '--dsw-specific-sidebar-nav-item-hover': tint(6, 'layer1'),
    '--dsw-specific-tip': tint(6, 'layer1'),
  }
}

const MODE_TOKENS: Record<AgentMode, ThemeTokenOverrides> = {
  red: modeTokens({
    logo: MODE_LOGOS.red,
    headline: 'Red Team Agent',
    glow: { light: 'rgb(213 38 67 / 45%)', dark: 'rgb(255 51 71 / 70%)' },
    light: { accent: '#d52643', accentHover: '#b91c36', base: '#fff9fa', layer1: '#fff', onAccent: '#fff', text: '#27171b', toast: '#39161e' },
    dark: { accent: '#ff5263', accentHover: '#ff7180', base: '#09070a', layer1: '#160f12', onAccent: '#21060b', text: '#fff4f5', toast: '#35181f' },
  }),
  blue: modeTokens({
    logo: MODE_LOGOS.blue,
    headline: 'Blue Team Agent',
    glow: { light: 'rgb(37 99 235 / 40%)', dark: 'rgb(0 153 255 / 70%)' },
    light: { accent: '#2563eb', accentHover: '#1d4ed8', base: '#f7faff', layer1: '#fff', onAccent: '#fff', text: '#101a2d', toast: '#14213a' },
    dark: { accent: '#4d8dff', accentHover: '#72a5ff', base: '#070b14', layer1: '#0d1424', onAccent: '#07101f', text: '#f2f6ff', toast: '#1b2940' },
  }),
  black: modeTokens({
    logo: MODE_LOGOS.black,
    headline: 'Black Team Agent',
    glow: { light: 'rgb(0 0 0 / 28%)', dark: 'rgb(255 255 255 / 55%)' },
    light: { accent: '#181818', accentHover: '#333', base: '#f7f7f7', layer1: '#fff', onAccent: '#fff', text: '#111', toast: '#202020' },
    dark: { accent: '#f5f5f5', accentHover: '#d4d4d4', base: '#050505', layer1: '#0d0d0d', onAccent: '#111', text: '#f5f5f5', toast: '#242424' },
  }),
}

function storedMode(): AgentMode {
  try {
    const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    if (value === 'blue' || value === 'red' || value === 'black') return value
  } catch {
    // Storage access can be blocked (sandboxed frame or disabled storage); the shipped default applies.
  }
  return 'red'
}

/** Owns the global operator mode and its theme-token layer. */
export class AgentModeController {
  private mode = storedMode()
  private readonly listeners = new Set<() => void>()
  private disposeTokens: (() => void) | undefined
  private readonly disposeSettings: (() => void) | undefined

  constructor(
    private readonly theme: ThemeRuntime,
    private readonly settings?: AgentModeSettingsBinding,
  ) {
    this.applyTheme()
    this.disposeSettings = settings?.subscribe(() => { this.syncSettings() })
    this.syncSettings()
  }

  readonly getSnapshot = (): AgentMode => this.mode

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(mode: AgentMode): void {
    if (this.mode === mode) return
    this.setLocal(mode)
    void this.settings?.set('mode', mode).catch((error: unknown) => {
      console.warn('agent mode setting failed:', error)
    })
  }

  private setLocal(mode: AgentMode): void {
    this.mode = mode
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // Persisted mode is best-effort; the in-memory mode and theme still apply for this page.
    }
    this.applyTheme()
    for (const listener of this.listeners) listener()
  }

  dispose(): void {
    this.disposeSettings?.()
    this.disposeTokens?.()
    this.disposeTokens = undefined
  }

  private applyTheme(): void {
    this.disposeTokens?.()
    this.disposeTokens = this.theme.overrideTokens(SOURCE, MODE_TOKENS[this.mode])
    try {
      document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', MODE_LOGOS[this.mode])
    } catch {
      // The favicon link is optional markup; a themed favicon is decorative only.
    }
  }

  private syncSettings(): void {
    const mode = this.settings?.getSnapshot().value?.mode
    if ((mode === 'blue' || mode === 'red' || mode === 'black') && mode !== this.mode) this.setLocal(mode)
  }
}
