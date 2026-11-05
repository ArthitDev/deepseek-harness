---
description: "保存 SSH 机器、验证主机指纹，并从一个 DSH Host 在这些机器上运行工作区文件与命令操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-remote-machines

[English](README.md) | 中文

## 概述

`dsh-remote-machines` 让一个 DSH Host 保存具名 SSH 配置，并打开这些机器上的工作区。带机器标识的文件操作通过 SFTP 路由，命令和终端操作通过 SSH 路由，本地路径仍使用现有本地 provider。浏览器响应绝不包含密码、私钥或私钥口令。工作区开始执行前，用户必须确认探测到的 SHA-256 主机指纹。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在为 Web 客户端提供服务的 Host 组合中挂载此包。用户随后可在设置中添加、探测、信任和移除机器，并在添加工作区时选择已保存的机器。

### 何时选择

当仓库或工具位于可通过 SSH 访问的 Linux 或 macOS 机器上，并且需要由一个 DSH 实例管理时，选择此包。如果所有工作区都在 Host 上运行，只保留本地文件系统和子进程 provider。此包支持 SSH Agent、保存的密码、仅当前 Host 生命周期使用的临时密码，以及可带口令的已保存私钥。

### 最小配置

该插件没有直接配置字段。它通过 `ctx.settings` 存储配置，并且绝不通过 Remote API 返回 secret 字段。

```yaml
- name: '@deepseek-ai/dsh-remote-machines'
```

### 连接信任与失败

探测会打开一个临时 SSH 连接，报告观察到的指纹和远端平台。信任操作会再次探测，并且只保存完全匹配的指纹。之后的文件系统和进程连接会拒绝不同的密钥。只要已注册工作区仍引用某台机器，移除该机器就会失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 - 点击展开</summary>

此包用内部的带机器标识路径前缀编码远端位置。`SshFileSystem` 和 `SshSubprocessRuntime` 扩展本地 provider，只委托带该前缀的路径。`SshConnectionPool` 共享已验证的 SSH 客户端，并打开由调用方持有的 SFTP 或命令 channel。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 已保存配置服务、脱敏 Remote 方法、信任和 provider 组合。 |
| [`src/connection.ts`](src/connection.ts) | SSH 认证、指纹检查、连接复用和探测。 |
| [`src/path.ts`](src/path.ts) | 带机器标识的内部路径编码与解析。 |
| [`src/fs.ts`](src/fs.ts) | 本地与 SFTP 文件系统路由。 |
| [`src/subprocess.ts`](src/subprocess.ts) | 本地与 SSH 子进程路由。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Remote 包组](../README.zh.md) - 包系列地图。
- [文件系统子系统](../../../docs/subsystems/filesystem.zh.md) - 共享文件操作语义。
- [子进程子系统](../../../docs/subsystems/subprocess.zh.md) - 共享进程和终端语义。
- [已保存 SSH 机器决策](../../../.agents/notes/implemented/feature/2026-09-12-remote-ssh-machines.zh.md) - 安全与归属依据。

-----

<a id="model-experience"></a>
## 模型体验

### Remote 工作区执行

#### 模型看到的内容

现有文件和命令工具保留原有 schema，并返回所选工作区 `cwd` 的 remote 路径、命令输出和失败。此包不添加单独的工具或系统提示文本。

#### Token 影响

此包不添加请求前缀。Remote 文件内容和命令输出消耗的结果 token 与同等本地工具调用一致。

#### KV Cache 影响

选择 remote 工作区会改变工具执行路径，不会改变模型请求前缀，因此不会直接使缓存的请求前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制决定哪些 SSH 机器可以承载工作区。

- **只支持 POSIX 命令 runtime** - 探测可以识别 Windows SSH Host，但 Web 客户端会拒绝创建其工作区，因为 remote 命令使用 POSIX shell 引号和环境变量语法。
- **不展开 jump host 或 SSH config** - 每个配置使用所选认证方式，直接连接一个 Host 和端口。
- **Host 保存的凭据依赖已配置的 settings backend** - 临时输入的密码只在当前 Host 生命周期存在；已保存的密码、私钥和私钥口令具有该 backend 提供的持久性与保护。

<a id="dev-note"></a>
### 开发备注

本包不发布 runtime invariant companion，因为此传输层没有可单独检查的模型侧 invariant。

<details>
<summary>维护者工作上下文 - 点击展开</summary>

无。

</details>
