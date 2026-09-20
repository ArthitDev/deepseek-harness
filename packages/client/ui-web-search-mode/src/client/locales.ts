/** Global Web search settings dictionaries. */

export const zh = {
  title: '始终使用网页搜索',
  description: '每次回答前强制搜索一次。关闭后，仅在需要最新信息时由模型自行搜索。',
  'toggle.aria': '始终使用网页搜索',
} satisfies Record<string, string>

/** Supported Web search settings locale keys. */
export type WebSearchModeKey = keyof typeof zh

export const en = {
  title: 'Always use web search',
  description: 'Require one search before every answer. Turn off to let the model search only when current information is needed.',
  'toggle.aria': 'Always use web search',
} satisfies Record<WebSearchModeKey, string>
