# Agent Note: 浏览器可编辑的用户 preset 组装

Status: implemented

[English](2026-09-04-browser-editable-user-preset-compositions.md) | 中文

## 问题

先复制再创作会建立安全的本地目录，但 `agent.cordis.yml` 只能通过外部文件编辑器修改。这使 Web UI 并不完整，尤其是在远程或无头 Host 上：它能创建并查看自定义 preset，却不能修改其 system prompt。

## 决策

经过认证的 `agentPresets` Remote 表面提供 `write(id, content)`。浏览器绝不提交文件系统路径。Host 对照 roster 解析 id，要求 `user` 信任，要求 preset 的组装路径精确等于 `<第一个用户根目录>/<id>/agent.cordis.yml`，并以仅属主权限原子替换该文件。随附 preset 保持只读，因此继续作为恢复基准。

Settings 对健康的自定义 preset 使用原生文本区域，对随附 preset 保留既有只读查看器。复制 preset 后会在编辑器中打开新副本。保存失败会保留草稿并显示错误；保存成功会刷新 roster 并丢弃 standing 指针，使后续会话挂载新代际，而已加入的会话继续使用当前代际。

组装 YAML 支持可执行的 `!!js`。因此编辑自定义组装与在磁盘上编辑或使用 shell 访问具有相同的进程级能力；编辑器不会假装能沙箱化或校验这些代码。浏览器认证仍是授权边界，请求也无法把写入重定向到任意路径。

## 考虑过的替代方案

- 编辑随附 preset：否决，因为升级会覆盖它们，而且恢复需要已知完好的来源。
- 继续只允许外部编辑器：否决，因为不满足 Web UI 与无头使用场景。
- 添加 CodeMirror 或其他编辑器依赖：否决；原生文本区域已覆盖所需操作，无需增加运行时依赖。

## 后果

浏览器可以在第一个用户 preset 根目录内持久化高权限组装文本。无效文本可能使 preset 显示为损坏，但传输写入失败时草稿不会丢失，preset 目录也仍可用于恢复。元数据、skill 与资产继续使用普通文件编辑器或位置动作。

本文仅取代[仅复制的 preset 创作](../simplification/2026-08-08-copy-only-preset-authoring.md)中“不允许浏览器写入”的决策。其先复制再创作、内置项不可变、请求不带路径以及位置动作的决策仍然有效。
