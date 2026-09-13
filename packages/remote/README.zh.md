---
description: "remote 包组：保存 SSH 机器，并将工作区文件与命令路由到这些机器。"
kind: "package-group"
---

# remote/ - 已保存的执行机器

[English](README.md) | 中文

## 概述

remote 包组让一个 DSH Host 使用保存在 SSH 机器上的工作区。`remote-machines` 包负责配置存储、主机密钥信任，以及这些工作区使用的文件系统和子进程路由。浏览器客户端只接收脱敏后的配置数据；密码、私钥和私钥口令保留在 Host 设置或 Host 内存中。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

该组目前只有一个包，负责完整的已保存机器路径。

| 包 | 职责 |
|---|---|
| [`remote-machines`](remote-machines/README.zh.md) | 存储 SSH 配置、验证主机指纹，并路由带机器标识的文件系统与子进程工作。 |

<a id="related-documentation"></a>
## 相关文档

- [文件系统子系统](../../docs/subsystems/filesystem.zh.md) - remote 工作区实现的文件操作。
- [子进程子系统](../../docs/subsystems/subprocess.zh.md) - 通过 SSH 路由的命令和终端操作。
- [已保存 SSH 机器决策](../../.agents/notes/implemented/feature/2026-09-12-remote-ssh-machines.zh.md) - 信任、凭据和工作区归属决策。

<a id="dev-note"></a>
## 开发备注

无。
