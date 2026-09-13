/** `webSearchMode` namespace dictionaries. */

export const zh = {
  'chip.label': 'Web Search',
  'chip.auto.aria': '网页搜索为自动模式，按下后每次请求都搜索',
  'chip.auto.title': '网页搜索：自动。点击后每次请求都搜索',
  'chip.always.aria': '每次请求都搜索网页，按下返回自动模式',
  'chip.always.title': '网页搜索：始终。点击返回自动模式',
  'chip.failed': '切换网页搜索模式失败',
} satisfies Record<string, string>

/** Supported Web search mode locale keys. */
export type WebSearchModeKey = keyof typeof zh

/** English Web search mode copy. */
export const en = {
  'chip.label': 'Web Search',
  'chip.auto.aria': 'Web search automatic, press to search on every request',
  'chip.auto.title': 'Web search: automatic. Click to search on every request',
  'chip.always.aria': 'Web search required on every request, press for automatic mode',
  'chip.always.title': 'Web search: always. Click for automatic mode',
  'chip.failed': 'Failed to switch web search mode',
} satisfies Record<WebSearchModeKey, string>
