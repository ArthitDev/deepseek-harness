---
kind: upgrade-guide
description: "内置 Antigravity 和 SB 代理要求使用 Bun，而不再使用 Host 的 Node.js 可执行文件。"
---

# 内置代理要求使用 Bun

[English](guide.md) | 中文

## 变更

Antigravity 和 SB transport 此前通过 Node.js 运行。它们的受管进程、共享启动辅助脚本和新生成的 Antigravity 自动启动器现在使用 Bun。ZCode 已使用 Bun；Harness Host 继续使用 Node.js。新 Bun 启动命令使用 `--no-env-file`，因此代理环境值仍由 Host 传入，不会额外加载 `.env` 文件。

## 迁移

1. 在运行 Harness 的机器上安装 Bun，并确保其服务账户能成功执行 `bun --version`。
2. 构建后重启 Harness。已有外部代理进程会被复用，直到其所有者停止它们；Harness 不会终止外部监听进程。
3. 如果此前安装过 Antigravity 自动启动器，重新运行 `node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs --no-browser` 以重新生成启动器。该命令会启动代理；需要认证时，只打印登录 URL，不打开浏览器。保留已有 token 文件。
4. 在 **Settings → Proxy Server** 中验证代理，并确认新启动的 Antigravity 或 SB 进程使用 Bun。现有端口、提供方 id 和凭据不变。
