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
