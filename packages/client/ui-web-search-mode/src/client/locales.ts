/** Global Web search settings dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  title: '始终使用网页搜索',
  description: '每次回答前强制搜索一次。关闭后，仅在需要最新信息时由模型自行搜索。',
  'toggle.aria': '始终使用网页搜索',
} satisfies Record<string, string>

/** Supported Web search settings locale keys. */
export type WebSearchModeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  title: 'Always use web search',
  description: 'Require one search before every answer. Turn off to let the model search only when current information is needed.',
  'toggle.aria': 'Always use web search',
} satisfies Record<WebSearchModeKey, string>

/** Japanese dictionary, checked complete against the zh key set. */
export const ja = {
  title: '常にウェブ検索を使用',
  description: '毎回の回答前に必ず検索します。オフにすると、最新情報が必要な場合にのみモデルが検索します。',
  'toggle.aria': '常にウェブ検索を使用',
} satisfies Record<WebSearchModeKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  title: 'Usar siempre la búsqueda web',
  description: 'Exige una búsqueda antes de cada respuesta. Desactívalo para que el modelo busque solo cuando necesite información actual.',
  'toggle.aria': 'Usar siempre la búsqueda web',
} satisfies Record<WebSearchModeKey, string>

/** French dictionary, checked complete against the zh key set. */
export const fr = {
  title: 'Toujours utiliser la recherche web',
  description: 'Impose une recherche avant chaque réponse. Désactivez pour que le modèle ne cherche que lorsqu\'une information à jour est nécessaire.',
  'toggle.aria': 'Toujours utiliser la recherche web',
} satisfies Record<WebSearchModeKey, string>

/** German dictionary, checked complete against the zh key set. */
export const de = {
  title: 'Immer Websuche verwenden',
  description: 'Erzwingt eine Suche vor jeder Antwort. Deaktivieren, damit das Modell nur sucht, wenn aktuelle Informationen nötig sind.',
  'toggle.aria': 'Immer Websuche verwenden',
} satisfies Record<WebSearchModeKey, string>

/** Russian dictionary, checked complete against the zh key set. */
export const ru = {
  title: 'Всегда использовать веб-поиск',
  description: 'Выполнять один поиск перед каждым ответом. Отключите, чтобы модель искала только когда нужна актуальная информация.',
  'toggle.aria': 'Всегда использовать веб-поиск',
} satisfies Record<WebSearchModeKey, string>

/** Portuguese dictionary, checked complete against the zh key set. */
export const pt = {
  title: 'Sempre usar a pesquisa web',
  description: 'Exige uma busca antes de cada resposta. Desative para que o modelo busque apenas quando informações atuais forem necessárias.',
  'toggle.aria': 'Sempre usar a pesquisa web',
} satisfies Record<WebSearchModeKey, string>
