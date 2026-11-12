---
description: "构建并验证适用于受限 Linux Docker 部署及服务器迁移的 Kali CLI 镜像。"
---
# Kali CLI 镜像

[English](README.md) | 中文

## 概述

在启动受限 Harness 容器之前构建 Kali 工具链。镜像提供 [packages.txt](packages.txt) 中的软件包以及 Rust、Go、Python、Node.js 和 uv，无需复制现有服务器的文件系统。Windows 继续使用原有的 `kali-linux` WSL 后端；本方案为 Linux Docker 后端提供镜像。

## 目录

- [构建与验证](#build-and-verify)
- [部署与迁移](#deployment-and-migration)
- [运行时软件包操作](#runtime-package-operations)
- [实现](#implementation)
- [开发备注](#dev-note)

<a id="build-and-verify"></a>

## 构建与验证

使用可信的代码检出、运行 Linux 引擎的 Docker 和 Node.js。从仓库根目录执行命令。构建需要通过 IPv4 访问有签名的 Kali 软件源，并需要足够的磁盘空间存放编译器和工具软件包。

```sh
docker build -t dsh-kali-cli:portable-20261112 scripts/kali
node scripts/kali/verify.mjs dsh-kali-cli:portable-20261112
```

验证程序创建不联网、不挂载宿主机目录的临时容器。它要求软件包数据库完整，且工具可在 `cap-drop ALL`、`NET_RAW`、`no-new-privileges` 和 seccomp 过滤限制下启动。它还验证未完成的软件包安装、缺失的 APT 配置、错误的缓存所有权以及关闭 seccomp 均被拒绝。检查失败或超时会导致命令失败，并删除测试容器。仅凭 seccomp 模式无法识别过滤策略；部署必须保留经批准的策略。

需要在线就绪检查时，通过部署配置的 Kali 后端运行 `/usr/local/libexec/dsh-kali/check.sh online`。该命令严格报告软件包索引更新错误，并下载小型 `hello` 软件包而不安装。运维人员必须另外验证部署的 VPN 路由和 broker；离线镜像检查无法证明这两项正确。

<a id="deployment-and-migration"></a>

## 部署与迁移

将验证后的镜像设为现有 Kali 服务的 `image`。保留部署的挂载、root 用户、`network_mode: none`、`cap_drop: [ALL]`、`cap_add: [NET_RAW]` 和 `security_opt: [no-new-privileges:true]`。可信的宿主机生命周期程序负责 VPN 网络连接与 broker 身份。本目录不安装部署专用的生命周期程序，也不向 Agent 授予 Docker 访问权限。

替换运行中的服务之前，保存 Compose 配置和旧镜像标识，检查活动任务，再通过该部署的网络生命周期程序重建容器并刷新 broker 身份。使用真实 Harness 执行身份运行在线检查，然后测试 broker 访问和 VPN 断开行为。任何检查失败时，都通过相同生命周期恢复旧镜像和配置。对于由外部管理网络命名空间的容器，仅重启 Compose 无法安全地完成替换。

通过需要认证的镜像仓库按摘要迁移验证后的镜像，或导出并导入 Docker 镜像文件，再比较两台服务器上的镜像标识。单独传输私有配置、挂载和数据。不要将运行中容器的快照作为构建方案。固定基础镜像使构建输入明确，但 Kali Rolling 软件包版本会变化；日后重新构建无法保证软件包完全相同。镜像在 `/usr/local/share/dsh-kali/versions.tsv` 保存已安装版本。需要精确版本时应迁移已构建的镜像文件。

<a id="runtime-package-operations"></a>

## 运行时软件包操作

APT 使用容器 root 身份运行下载进程，因为运行时无法切换到 `_apt`。root 所有的下载目录允许更新和下载操作，无需添加 `SETUID`、`SETGID`、`CHOWN` 或 `FOWNER`。下载进程能够写入容器的可写挂载；应将宿主机私有文件保存在挂载之外，并仅使用可信软件源。APT 仍会验证软件源签名和 HTTPS 证书。

镜像在构建时配置所有声明的软件包，包括维护脚本需要修改所有权的软件包。新增或升级的软件包可能需要运行时不具备的权限：将其添加至 `packages.txt`，重新构建并验证后再部署。不保证任意运行时 `apt install` 都能成功。不要绕过签名验证、添加运行时权限，或循环手动下载依赖来修复镜像。在线更新失败时，应诊断 DNS、镜像站可达性和 VPN 策略；旧索引不算成功。

<a id="implementation"></a>

## 实现

[Dockerfile](Dockerfile) 固定官方 Kali 和 uv 镜像。[prepare-runtime.sh](prepare-runtime.sh) 在构建时准备 APT 目录和 Redis 所有权元数据，移除与运行时能力边界冲突的 nmap 文件能力，并将 Kali 的 `httpx-toolkit` 暴露为 `httpx`。账户名称在镜像内部解析，不使用宿主机专属的数字 ID。

[check.sh](check.sh) 验证部署后的文件系统和实际运行时限制。它检查命令是否存在，并启动 nmap 和各语言运行时；它不会执行所有安全工具或扫描任何目标。[verify.mjs](verify.mjs) 管理随机命名的测试容器，同时检查失败诊断和退出状态。

<a id="dev-note"></a>

## 开发备注

无。
