/** Complete `recon-engine` settings page. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { reconSettingsFormLabels, type ReconKey } from './locales.ts'
import type { ReconSettingsCardFace, ReconSettingsField } from './recon-settings-controller.ts'
import css from './ReconSettingsCard.module.css'

export type ReconSettingsCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'recon'>
  & InjectFace<ReconSettingsCardFace>

const numericFields: readonly [ReconSettingsField, ReconKey, ReconKey][] = [
  ['requestTimeoutMs', 'settings.requestTimeout', 'settings.requestTimeoutHint'],
  ['maxRedirects', 'settings.maxRedirects', 'settings.maxRedirectsHint'],
  ['maxResponseBytes', 'settings.maxResponseBytes', 'settings.maxResponseBytesHint'],
  ['maxDiscoveryBodyBytes', 'settings.maxDiscoveryBytes', 'settings.maxDiscoveryBytesHint'],
  ['maxJsFiles', 'settings.maxJsFiles', 'settings.maxJsFilesHint'],
  ['maxEvidenceOutputChars', 'settings.maxEvidenceChars', 'settings.maxEvidenceCharsHint'],
  ['maxPages', 'settings.maxPages', 'settings.maxPagesHint'],
  ['maxDepth', 'settings.maxDepth', 'settings.maxDepthHint'],
  ['crawlConcurrency', 'settings.crawlConcurrency', 'settings.crawlConcurrencyHint'],
  ['maxSourceMaps', 'settings.maxSourceMaps', 'settings.maxSourceMapsHint'],
  ['maxApiEndpoints', 'settings.maxApiEndpoints', 'settings.maxApiEndpointsHint'],
  ['maxHosts', 'settings.maxHosts', 'settings.maxHostsHint'],
  ['maxTotalRequests', 'settings.maxTotalRequests', 'settings.maxTotalRequestsHint'],
  ['maxRunDurationMs', 'settings.maxRunDuration', 'settings.maxRunDurationHint'],
  ['connectTimeoutMs', 'settings.connectTimeout', 'settings.connectTimeoutHint'],
  ['ctTimeoutMs', 'settings.ctTimeout', 'settings.ctTimeoutHint'],
]

export function ReconSettingsCard(props: ReconSettingsCardProps) {
  const { t } = props
  const state = props.useReconSettingsCard(snapshot => snapshot)
  if (props.view === 'summary') return t('settings.description')
  const field = (
    name: ReconSettingsField,
    label: ReconKey,
    hint: ReconKey,
    options: { numeric?: boolean; multiline?: boolean } = {},
  ) => (
    <SettingsValueField
      key={name}
      id={`plugin-config-recon-${name}`}
      label={t(label)}
      hint={t(hint)}
      overriddenLabel={t('settings.overridden')}
      resetLabel={t('settings.reset')}
      invalidLabel={t(options.numeric ? 'settings.invalidNumber' : 'settings.invalidValue')}
      disabled={!state.writable}
      {...options}
      {...state.fields[name]}
      onEdit={(text) => { props.edit(name, text) }}
      onReset={() => { props.resetField(name) }}
    />
  )
  return (
    <SettingsForm
      labels={reconSettingsFormLabels(t)}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <details className={css.advanced}>
        <summary>{t('settings.advanced')}</summary>
        {field('dynamicTools', 'settings.dynamicTools', 'settings.dynamicToolsHint')}
        {field('evidenceDir', 'settings.evidenceDir', 'settings.evidenceDirHint')}
        {numericFields.map(([name, label, hint]) => field(name, label, hint, { numeric: true }))}
        {field('fingerprintOverlay', 'settings.fingerprintOverlay', 'settings.fingerprintOverlayHint')}
        {field('deepPorts', 'settings.deepPorts', 'settings.deepPortsHint')}
        {field('cacheTtlSeconds', 'settings.cacheTtl', 'settings.cacheTtlHint', { multiline: true })}
      </details>
    </SettingsForm>
  )
}
