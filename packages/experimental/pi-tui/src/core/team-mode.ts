/** Team modes shared by the TUI picker and status bar. */
export const TEAM_MODE_OPTIONS = [
  { value: 'blue', label: 'Blue Team', icon: '🛡' },
  { value: 'red', label: 'Red Team', icon: '⚔' },
  { value: 'black', label: 'Black Team', icon: '◆' },
  { value: 'dead', label: 'Dead Mode', icon: '☠' },
] as const

/** Selected team-mode value accepted by the shared policy service. */
export type TeamMode = typeof TEAM_MODE_OPTIONS[number]['value']
