/** Staged settings form for the complete `recon-engine` Cordis config. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField, settingsTextField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions,
  type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

export const RECON_SETTINGS_NS = 'recon-engine'

export interface ReconSettings {
  evidenceDir?: string
  dynamicTools?: string[]
  requestTimeoutMs?: number
  maxRedirects?: number
  maxResponseBytes?: number
  maxDiscoveryBodyBytes?: number
  maxJsFiles?: number
  maxEvidenceOutputChars?: number
  maxPages?: number
  maxDepth?: number
  crawlConcurrency?: number
  maxSourceMaps?: number
  maxApiEndpoints?: number
  maxHosts?: number
  maxTotalRequests?: number
  maxRunDurationMs?: number
  deepPorts?: number[]
  connectTimeoutMs?: number
  ctTimeoutMs?: number
  fingerprintOverlay?: string
  cacheTtlSeconds?: Record<string, number>
}

export const RECON_SETTINGS_FIELDS = [
  'evidenceDir', 'dynamicTools',
  'requestTimeoutMs', 'maxRedirects', 'maxResponseBytes', 'maxDiscoveryBodyBytes',
  'maxJsFiles', 'maxEvidenceOutputChars', 'maxPages', 'maxDepth', 'crawlConcurrency',
  'maxSourceMaps', 'maxApiEndpoints', 'maxHosts', 'maxTotalRequests', 'maxRunDurationMs',
  'deepPorts', 'connectTimeoutMs', 'ctTimeoutMs', 'fingerprintOverlay', 'cacheTtlSeconds',
] as const

export type ReconSettingsField = typeof RECON_SETTINGS_FIELDS[number]

export interface ReconSettingsCardState extends SettingsFormShell {
  fields: Record<ReconSettingsField, SettingsFieldState>
}

export interface ReconSettingsCardFace extends SettingsFormActions {
  hooks: { reconSettingsCard: SnapshotStore<ReconSettingsCardState> }
}

const numberListField = (field: string): SettingsFieldSpec => ({
  field,
  format: value => Array.isArray(value) ? value.join(', ') : '',
  parse: (text) => {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'clear' }
    const values = trimmed.split(/[\s,]+/).filter(Boolean).map(Number)
    return values.every(Number.isFinite) ? { kind: 'set', value: values } : undefined
  },
})

const stringListField = (field: string): SettingsFieldSpec => ({
  field,
  format: value => Array.isArray(value) ? value.join(', ') : '',
  parse: (text) => {
    const values = [...new Set(text.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))]
    return values.length === 0 ? { kind: 'clear' } : { kind: 'set', value: values }
  },
})

const jsonObjectField = (field: string): SettingsFieldSpec => ({
  field,
  format: value => value !== undefined ? JSON.stringify(value, null, 2) : '',
  parse: (text) => {
    if (text.trim() === '') return { kind: 'clear' }
    try {
      const value = JSON.parse(text) as unknown
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { kind: 'set', value }
        : undefined
    } catch {
      return undefined
    }
  },
})

/** Connect the recon namespace to one staged settings page. */
export class ReconSettingsCardController {
  private readonly form: SettingsFormModel<ReconSettings>
  private readonly store: SnapshotStore<ReconSettingsCardState>

  constructor(scope: SettingsFormScope<ReconSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsTextField('evidenceDir'),
      stringListField('dynamicTools'),
      settingsNumberField('requestTimeoutMs'),
      settingsNumberField('maxRedirects'),
      settingsNumberField('maxResponseBytes'),
      settingsNumberField('maxDiscoveryBodyBytes'),
      settingsNumberField('maxJsFiles'),
      settingsNumberField('maxEvidenceOutputChars'),
      settingsNumberField('maxPages'),
      settingsNumberField('maxDepth'),
      settingsNumberField('crawlConcurrency'),
      settingsNumberField('maxSourceMaps'),
      settingsNumberField('maxApiEndpoints'),
      settingsNumberField('maxHosts'),
      settingsNumberField('maxTotalRequests'),
      settingsNumberField('maxRunDurationMs'),
      numberListField('deepPorts'),
      settingsNumberField('connectTimeoutMs'),
      settingsNumberField('ctTimeoutMs'),
      settingsTextField('fingerprintOverlay'),
      jsonObjectField('cacheTtlSeconds'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ReconSettingsCardState {
    return {
      ...this.form.shell(),
      fields: Object.fromEntries(
        RECON_SETTINGS_FIELDS.map(field => [field, this.form.field(field)]),
      ) as Record<ReconSettingsField, SettingsFieldState>,
    }
  }

  inject(): ReconSettingsCardFace {
    return { hooks: { reconSettingsCard: this.store }, ...this.form.actions() }
  }

  dispose(): void { this.form.dispose() }
}
