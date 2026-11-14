---
kind: upgrade-guide
description: "Antigravity 设置会迁移已有路由，并由 Harness 负责正常代理启动。"
---

# Antigravity 托管设置

[English](guide.md) | 中文

## 变更

Antigravity 设置不再创建 TUI profile、安装 Windows 启动项，或在登录后保留自己启动的代理。它通过临时子进程登录，备份已有配置，并将已安装 profile 迁移到端口 18877 的内置后端。内置 Google 模型列表替换外部 Antigravity 列表。其他提供方和其他项目的 CLIProxyAPI 进程保持不变。

## 迁移

1. 安装需要的 Harness profile，并确保运行账户的 `PATH` 中有 Bun。
2. 在源码根目录运行 `pnpm antigravity:setup` 并完成 Google 登录。手动浏览器交接时添加 `--no-browser`；设置会等待登录，而非留下分离的进程。登录超时则保留原路由配置。
3. 重启 Web/TUI。确认 Antigravity 指向 `http://127.0.0.1:18877/v1`，并发送简短模型请求。令牌存在和静态模型列表不能验证上游访问。
4. 如果存在旧启动项，先确认目标，再仅删除该内置 Antigravity 启动器的快捷方式。设置命令不会删除或停止外部应用。
5. 撤销配置修改时，停止 Harness，并按打印的备份目录中的 `manifest.json` 恢复 patch。账户、模型、路由和回滚说明见[代理设置参考](../../../../packages/llm/proxy-server/README.zh.md#set-up-and-use-the-bundled-proxies)。
