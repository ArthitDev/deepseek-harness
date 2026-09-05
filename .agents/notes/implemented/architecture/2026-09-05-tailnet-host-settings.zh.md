# Agent Note：允许单个 Tailnet 来源使用 Host 设置

Status: implemented

[English](2026-09-05-tailnet-host-settings.md) | 中文

## 问题

通过 Tailscale 打开的已认证浏览器使用非 loopback 主机名。因此 Client 选择仅内存设置。即使浏览器认证与 Host/Origin 信任检查均已通过，提供商目录仍无法加载。

## 决策

此本地构建允许精确 HTTPS 来源 `msi-cyborg-15-nb.tailaa5429.ts.net` 使用 Host 设置。该例外仅存在于 `ui-settings`。它不会把浏览器归类为 loopback，也不会启用原生文件打开或其他仅限 loopback 的 UI。Host 在分派任何 API 前仍要求匹配已配置的 `trustedHosts`，并验证绑定到 authority 的浏览器 cookie。

## 验证

聚焦测试允许 loopback 与精确 HTTPS 主机名，同时拒绝明文 HTTP 和其他 Tailnet 主机名。设置与提供商目录单元测试均通过，相关 package bundle 也构建成功。

## 后果

在这个精确 Tailnet 来源上的已认证浏览器可以读写现有 wire API 暴露的设置 namespace。如果机器的 MagicDNS 名称变化，必须同步更新该 allowlist。其他远程来源仍使用仅内存模式。
