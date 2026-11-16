---
kind: upgrade-guide
description: Harness 移除内置 Antigravity 提供方及代理配置。
---

# 移除 Antigravity

[English](guide.md) | 中文

## 变更

Harness 不再包含或管理内置 Antigravity 提供方和代理。`proxy-servers` 配置不再接受 `antigravityEnabled`、`antigravityPort`、`antigravityProviders`，也不再允许在 `externalProxies` 中使用 `antigravity`。可选的 OAR 提供方会拒绝 `runtime: antigravity`；请移除相应的提供方行及工具映射。外部应用（包括 CLIProxyAPI）、其进程和凭据仍由 Harness 之外的系统管理。

## 迁移

1. 在每台曾使用内置集成的机器上，从 Harness 检出目录运行 `pnpm antigravity:remove --dry-run`，预览 YAML 变更。
2. 重启 Harness 前运行 `pnpm antigravity:remove`。此命令备份并原子更新 Harness home patch 和已安装的 profile patch，移除 Antigravity 提供方/模型映射及已废弃的管理器配置，同时保留其他提供方。备份可能包含私有配置，应妥善保管以备恢复。
3. 如果当前模型使用已移除的提供方，请在 Web 或 TUI 中选择其他已安装的提供方。重启 Harness 并确认新选择可用。
4. 此命令不会停止进程或删除启动项。若存在旧的 Harness 内置 Antigravity 启动器，请核验目标后手动删除。不要删除或停止外部 CLIProxyAPI 或其他外部应用；账号令牌也会保留。
