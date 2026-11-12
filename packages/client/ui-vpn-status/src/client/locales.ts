/** Locale-owned status labels; sampled route scope stays visible in every state. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'vpn.status': VpnLocaleKey }
}
/** English status labels. */
const en = { verified: 'VPN verified', unverified: 'VPN unverified', unknown: 'VPN unknown', checking: 'VPN checking', host: 'Host HTTPS', checked: 'Checked', never: 'No check yet', mullvad: 'Mullvad', expected: 'Expected exit' }
/** Chinese status labels. */
const zh: typeof en = { verified: 'VPN 已验证', unverified: 'VPN 未验证', unknown: 'VPN 状态未知', checking: 'VPN 检查中', host: '主机 HTTPS', checked: '检查时间', never: '尚未检查', mullvad: 'Mullvad', expected: '预期出口' }
/** Japanese status labels. */
const ja: typeof en = { verified: 'VPN 確認済み', unverified: 'VPN 未確認', unknown: 'VPN 不明', checking: 'VPN 確認中', host: 'ホスト HTTPS', checked: '確認時刻', never: '未確認', mullvad: 'Mullvad', expected: '指定の出口' }
/** Spanish status labels. */
const es: typeof en = { verified: 'VPN verificada', unverified: 'VPN sin verificar', unknown: 'VPN desconocida', checking: 'Verificando VPN', host: 'HTTPS del host', checked: 'Comprobado', never: 'Sin comprobar', mullvad: 'Mullvad', expected: 'Salida prevista' }
/** French status labels. */
const fr: typeof en = { verified: 'VPN vérifié', unverified: 'VPN non vérifié', unknown: 'VPN inconnu', checking: 'Vérification VPN', host: 'HTTPS hôte', checked: 'Vérifié', never: 'Pas de vérification', mullvad: 'Mullvad', expected: 'Sortie prévue' }
/** German status labels. */
const de: typeof en = { verified: 'VPN bestätigt', unverified: 'VPN unbestätigt', unknown: 'VPN unbekannt', checking: 'VPN wird geprüft', host: 'Host-HTTPS', checked: 'Geprüft', never: 'Noch nicht geprüft', mullvad: 'Mullvad', expected: 'Erwarteter Ausgang' }
/** Russian status labels. */
const ru: typeof en = { verified: 'VPN подтверждён', unverified: 'VPN не подтверждён', unknown: 'VPN неизвестен', checking: 'Проверка VPN', host: 'HTTPS хоста', checked: 'Проверено', never: 'Ещё не проверено', mullvad: 'Mullvad', expected: 'Ожидаемый выход' }
/** Portuguese status labels. */
const pt: typeof en = { verified: 'VPN verificada', unverified: 'VPN não verificada', unknown: 'VPN desconhecida', checking: 'A verificar VPN', host: 'HTTPS do host', checked: 'Verificado', never: 'Sem verificação', mullvad: 'Mullvad', expected: 'Saída esperada' }
export { en, zh, ja, es, fr, de, ru, pt }
/** Status dictionary key. */
export type VpnLocaleKey = keyof typeof en
