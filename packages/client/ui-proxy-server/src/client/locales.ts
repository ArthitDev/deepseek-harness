/** Proxy settings copy; proxy names and route ids are Host data. */
export const en = {
  nav: 'Proxy Server', title: 'Proxy Server',
  description: 'Manage the model proxies embedded in this Harness. Enabled proxies start when used or when switched on.',
  externalNote: 'Turning a proxy off blocks new requests through its listed Harness routes. Processes started by this Host stop after active streams finish; external processes keep running.',
  refresh: 'Refresh', retry: 'Retry', enabled: 'Use {name}', routes: 'Routes: {routes}',
  stopped: 'Stopped', running: 'Running', external: 'Running externally', 'port-in-use': 'Port in use',
  missing: 'Local setup required', loading: 'Loading proxy servers',
  failure: 'Proxy operation failed: {message}', unavailable: 'Proxy settings are unavailable on this Host.',
}
/** Locale keys shared by the settings entry and section. */
export type ProxySettingsKey = keyof typeof en
/** Chinese settings copy. */
export const zh: Record<ProxySettingsKey, string> = {
  nav: 'Proxy Server', title: 'Proxy Server',
  description: '管理此 Harness 内嵌的模型代理。已启用的代理在使用时或打开开关时启动。',
  externalNote: '关闭代理会阻止通过所列 Harness 路由发送新请求。此 Host 启动的进程在活动流结束后停止；外部进程继续运行。',
  refresh: '刷新', retry: '重试', enabled: '使用 {name}', routes: '路由：{routes}',
  stopped: '已停止', running: '运行中', external: '在外部运行', 'port-in-use': '端口已占用',
  missing: '需要本地设置', loading: '正在加载代理服务器',
  failure: '代理操作失败：{message}', unavailable: '此 Host 的代理设置不可用',
}
