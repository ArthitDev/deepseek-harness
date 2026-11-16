---
kind: upgrade-guide
description: 内置代理生命周期选择现在要求显式提供方 id，不再使用模型前缀。
---

# 内置代理提供方选择

[English](guide.md) | 中文

## 变更

内置代理的启动和使用开关仅匹配配置的提供方列表。`zcode/` 或 `sb/` 等模型前缀不再为无关的路由器提供方启动或阻止本地代理。TUI 的旧版 ZCode 启动辅助程序也仅匹配 `zcode-direct`，并将管理权交给已安装的代理管理器。`routeAllModels: true` 的 SB 转发仍覆盖所有模型提供方。

## 迁移

1. 在 `proxy-servers` 配置中，不要将指向 9router 的提供方加入 `zcodeProviders` 或 `sbProviders`。
2. 对于直接指向内置代理的自定义提供方，将其提供方 id 加入对应代理的提供方列表。内置 `zcode-direct` 提供方已经匹配，其端点为 `http://127.0.0.1:18080/v1`。让 `zcodePort` 与该端点保持一致，而不是使用 9router 的端口。
3. 确认禁用无关的本地代理后，路由器模型仍可使用；禁用直连提供方后则返回 `proxy-server/disabled`。
4. 如果设置程序之前从 shell 导入了 `ZCODE_PROXY_API_KEY`，请将后端 `config.yaml` 中的 `auth.proxyApiKey` 设为所需密钥，然后重新运行 `pnpm zcode:setup`。设置程序现在导入该文件中的密钥，与受管理后端经过清理的环境保持一致。
