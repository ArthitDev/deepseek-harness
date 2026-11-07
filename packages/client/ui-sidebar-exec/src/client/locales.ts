/** Copy owned by the sidebar exec panel. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sidebarExec: keyof typeof zh
  }
}

/** Simplified Chinese executed-commands copy. */
export const zh = {
  type: '类型', guideTitle: '已执行的命令', guideDescription: '本会话中 Agent 运行过的 Shell 命令',
  chip: '已执行的命令（{count}）',
  empty: '还没有执行过的命令。', truncated: '更早的命令可能尚未加载。',
  shellKali: 'KALI', shellWin: 'WIN',
  statusOk: '✓', statusError: '✗', statusRunning: '…',
  expand: '展开命令与结果', collapse: '收起命令与结果',
  resultPending: '仍在运行中。', resultEmpty: '结果没有文本输出。',
} satisfies Record<string, string>

/** English executed-commands copy. */
export const en = {
  type: 'Exec', guideTitle: 'Executed commands', guideDescription: 'Shell commands the agent ran in this session',
  chip: 'Executed commands ({count})',
  empty: 'No executed commands yet.', truncated: 'Older commands may exist outside the loaded history.',
  shellKali: 'KALI', shellWin: 'WIN',
  statusOk: '✓', statusError: '✗', statusRunning: '…',
  expand: 'Show command and result', collapse: 'Hide command and result',
  resultPending: 'Still running.', resultEmpty: 'The result carried no text.',
} satisfies Record<keyof typeof zh, string>

/** Japanese executed-commands copy. */
export const ja = {
  type: '実行', guideTitle: '実行されたコマンド', guideDescription: 'このセッションでエージェントが実行したシェルコマンド',
  chip: '実行されたコマンド（{count}）',
  empty: '実行されたコマンドはまだありません。', truncated: '読み込み済みの履歴以外に古いコマンドが存在する可能性があります。',
  shellKali: 'KALI', shellWin: 'WIN',
  statusOk: '✓', statusError: '✗', statusRunning: '…',
  expand: 'コマンドと結果を表示', collapse: 'コマンドと結果を隠す',
  resultPending: '実行中です。', resultEmpty: '結果にテキスト出力がありません。',
} satisfies Record<keyof typeof zh, string>

/** Spanish executed-commands copy. */
export const es = {
  type: 'Ejecución', guideTitle: 'Comandos ejecutados', guideDescription: 'Comandos de shell que el agente ejecutó en esta sesión',
  chip: 'Comandos ejecutados ({count})',
  empty: 'Aún no hay comandos ejecutados.', truncated: 'Pueden existir comandos más antiguos fuera del historial cargado.',
  shellKali: 'KALI', shellWin: 'WIN',
  statusOk: '✓', statusError: '✗', statusRunning: '…',
  expand: 'Mostrar comando y resultado', collapse: 'Ocultar comando y resultado',
  resultPending: 'Sigue en ejecución.', resultEmpty: 'El resultado no contenía texto.',
} satisfies Record<keyof typeof zh, string>

/** French executed-commands copy. */
export const fr = {
  type: 'Exécution', guideTitle: 'Commandes exécutées', guideDescription: 'Commandes shell exécutées par l\'agent dans cette session',
  chip: 'Commandes exécutées ({count})',
  empty: 'Aucune commande exécutée pour l\'instant.', truncated: 'D\'anciennes commandes peuvent exister en dehors de l\'historique chargé.',
  shellKali: 'KALI', shellWin: 'WIN',
  statusOk: '✓', statusError: '✗', statusRunning: '…',
  expand: 'Afficher la commande et le résultat', collapse: 'Masquer la commande et le résultat',
  resultPending: 'Encore en cours.', resultEmpty: 'Le résultat ne contenait pas de texte.',
} satisfies Record<keyof typeof zh, string>

/** German executed-commands copy. */
export const de = {
  type: 'Ausführung', guideTitle: 'Ausgeführte Befehle', guideDescription: 'Shell-Befehle, die der Agent in dieser Sitzung ausgeführt hat',
  chip: 'Ausgeführte Befehle ({count})',
  empty: 'Noch keine ausgeführten Befehle.', truncated: 'Ältere Befehle können außerhalb des geladenen Verlaufs existieren.',
  shellKali: 'KALI', shellWin: 'WIN',
  statusOk: '✓', statusError: '✗', statusRunning: '…',
  expand: 'Befehl und Ergebnis anzeigen', collapse: 'Befehl und Ergebnis ausblenden',
  resultPending: 'Läuft noch.', resultEmpty: 'Das Ergebnis enthielt keinen Text.',
} satisfies Record<keyof typeof zh, string>

/** Russian executed-commands copy. */
export const ru = {
  type: 'Выполнение', guideTitle: 'Выполненные команды', guideDescription: 'Команды shell, выполненные агентом в этом сеансе',
  chip: 'Выполненные команды ({count})',
  empty: 'Выполненных команд пока нет.', truncated: 'За пределами загруженной истории могут существовать более старые команды.',
  shellKali: 'KALI', shellWin: 'WIN',
  statusOk: '✓', statusError: '✗', statusRunning: '…',
  expand: 'Показать команду и результат', collapse: 'Скрыть команду и результат',
  resultPending: 'Всё ещё выполняется.', resultEmpty: 'Результат не содержал текста.',
} satisfies Record<keyof typeof zh, string>

/** Portuguese executed-commands copy. */
export const pt = {
  type: 'Execução', guideTitle: 'Comandos executados', guideDescription: 'Comandos de shell que o agente executou nesta sessão',
  chip: 'Comandos executados ({count})',
  empty: 'Ainda não há comandos executados.', truncated: 'Comandos mais antigos podem existir fora do histórico carregado.',
  shellKali: 'KALI', shellWin: 'WIN',
  statusOk: '✓', statusError: '✗', statusRunning: '…',
  expand: 'Mostrar comando e resultado', collapse: 'Ocultar comando e resultado',
  resultPending: 'Ainda em execução.', resultEmpty: 'O resultado não continha texto.',
} satisfies Record<keyof typeof zh, string>
