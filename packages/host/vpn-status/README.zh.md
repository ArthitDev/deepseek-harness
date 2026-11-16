---
description: "缓存验证宿主 HTTPS 出口，供 VPN 状态显示使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-vpn-status

[English](README.md) | 中文

## 概述

宿主在 Windows 和 Linux 上检查 HTTPS 出口，Web 和 TUI 共享同一份缓存。读取操作不会触发网络请求，结果和日志不包含 IP 地址或凭证。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>

## 配置

将组合中的 `vpn-status` 条目设为 `enabled: true` 以启用。每次检查访问 `https://am.i.mullvad.net/json`；Mullvad 能看到请求的公网出口 IP。首次在启动时检查，随后在每次检查完成后等待 `intervalMs`（默认 300000，最小 60000）。`timeoutMs` 默认 10000。检查不重叠，拒绝重定向，销毁时取消并等待当前请求结束。

Mullvad 官方的 `mullvad_exit_ip: true` 可验证其出口。其他服务商，包括 WireGuard 和 OpenVPN 部署，需要在 `expectedExitCidrs` 中配置已知的 VPN 出口 IP/CIDR，支持 IPv4 和 IPv6。宽泛或共享的范围会削弱验证依据。公网 IP 变化本身不能验证 VPN。无效 CIDR 会导致加载失败，拒绝通用 /0 范围。

`vpnStatus/read` Remote 和进程内 `ctx.vpnStatus.read()` 返回 checking、verified、unverified 或 unknown，以及依据、上次检查时间和失效时间。不匹配为 unverified；网络、解析或端点失败为 unknown。每次新检查清除旧验证，过期样本不能保持 verified。Web 标注宿主 HTTPS，TUI 使用同一缓存。不同宿主进程各自管理检查周期。

<a id="dev-note"></a>

## 开发备注

<a id="tui-control"></a>

### TUI 控制

`/vpn status` 读取本机 Mullvad tunnel 和缓存的 Host HTTPS 证据，不发送额外公网请求。`/vpn reconnect` 重连 Mullvad，使旧结果失效并重新检查 HTTPS。控制命令完成但 HTTPS 为 unknown/unverified 时，不代表出口已验证。并发重连会被拒绝。命令保留 VPN 设置、firewall、proxy 路由和 kill-switch policy；共享 tunnel 的 Web/TUI 会短暂中断。其他 VPN 继续支持 `expectedExitCidrs` 验证，目前自动重连仅支持 Mullvad。

Windows 使用 `%ProgramFiles%\Mullvad VPN\resources\mullvad.exe`，普通 Linux 使用 `/usr/bin/mullvad`，以固定参数执行，不经过 shell。`controlTimeoutMs` 默认为 45000。禁用监测时拒绝重连；CLI 或 broker 缺失显示 unavailable，不会退回其他网络路径。

### 隔离 Linux Server 设置

无法访问 Mullvad 管理 socket 的隔离 Host 使用受限 [control broker](../../../scripts/vpn-control-broker.mjs)。它仅监听 `/run/dsh-kali-broker/vpn.sock`，只接受无 body 的 `GET /status` 和 `POST /reconnect`，执行固定 Mullvad 命令，删除 IP/account 数据，并跨 TUI 进程串行处理重连。Web Remote API 不暴露控制操作。

Server 已有的 `/run/dsh-kali-broker` 必须由 root 拥有，mode 为 `0750`，group 为 Harness 用户组；workload 保留只读 bind mount。先备份现有脚本、unit 和配置，再安装 root 拥有的文件并启用 [unit](../../../scripts/vpn-control-broker.service)：

```sh
sudo install -o root -g root -m 0644 scripts/vpn-control-broker.mjs /usr/local/libexec/dsh-vpn-control-broker.mjs
sudo install -o root -g root -m 0644 scripts/vpn-control-broker.service /etc/systemd/system/dsh-vpn-control.service
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-vpn-control.service
```

unit 使用 root 拥有的 `/usr/local/libexec/dsh-vpn-node` launcher 和现有 Mullvad/Kali broker 服务。保留 `vpn-status` 的其他配置，设置 `controlSocketPath: /run/dsh-kali-broker/vpn.sock` 后重新打开 TUI。验证 `/vpn status`、socket 的 root/用户组归属与 `0660` mode、未变更的 firewall 和重连后的 HTTPS 证据。回滚时停止并禁用 `dsh-vpn-control.service`，恢复备份文件与配置，运行 `systemctl daemon-reload` 后重新打开 TUI；VPN/firewall 服务保持运行。

验证状态只在观测结果有效且未过期时成立；此结果不能代表其他进程或目的地址的路由。


<a id="model-experience"></a>

## 模型体验

无，本包仅显示操作员状态，不向模型上下文添加内容。

#### KV Cache 影响

不改变模型请求或可复用前缀。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- 这是对一个宿主 HTTPS 目的地的定期采样，不是连续监控、kill switch 或所有流量的证明。两次检查之间路由可能变化。分流、IPv4/IPv6 差异、代理、远程 shell 和 Kali 命名空间可能使用其他路由。其他服务商的验证依赖准确的预期出口，仍使用 Mullvad 公共 JSON 服务观察出口。无法区分 VPN 与共享同一配置出口的其他路径，两个界面均不声称这些其他路由受到保护。
