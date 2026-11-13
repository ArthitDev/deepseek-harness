# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

文档：[https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## 开发者预览

DeepSeek Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

## Shield Break 分支

本仓库是 DeepSeek Harness 的 **Shield Break** 分支，跟随上游 `0.2.2-rc.1`，在完整上游功能之外加入 Shield Break 安全测试能力：渗透测试控制平面（持久化运行、Supervisor/Executor 回合、确定性侦察）、目标范围与运行预算守卫、已保存的 SSH 机器、运行时包不变量、团队化 Agent 集群、Exa 与 Perplexity 网络搜索提供商，以及集成 Kali WSL 的 Shield Break 终端界面。

内置代理（ZCode Direct、Antigravity 和 SB transport）使用 **Bun** 运行；Harness Host 使用 **Node.js** 运行。请确保服务账户的 `PATH` 中可以找到 Bun。详见[代理运行时要求](packages/llm/proxy-server/README.zh.md)和 [Bun 迁移指南](docs/upgrade-guide/v0.2.2-rc.1/embedded-proxy-bun/guide.zh.md)。

仅将 Shield Break 用于合法目的和经授权的安全测试。用户对自己的使用与滥用行为负责；本项目的责任免责声明仅在法律允许的范围内适用。请阅读[合法使用与责任声明](SAFETY.zh.md#lawful-use-and-user-responsibility)。

使用安全测试功能前，请先阅读[渗透测试实验室授权模板](docs/pentest-lab-authorization-template.zh.md)与 [Kali WSL 指南](docs/user/guide/kali-wsl.zh.md)。

### Jev 证据审查

可选的 Jev 集成通过现有 MCP 桥接器为 Web、TUI 和无头 agent 提供十二个语义工具。可用它对侦察观察结果分类和排序、依据证据核验发现，以及审查拟议变更。Jev 不替代确定性扫描、目标范围守卫或 VPN 流量检查。

[Jev 设置与使用指南](docs/user/guide/jev.zh.md)介绍固定版本的 Linux 运行时、服务账户凭据、共享配置、建议工作流和实际调用验证提示词。Jev 由部署配置启用；新检出的仓库不会安装它，也不会继承服务器的私有设置。调用消耗所配置 TypeSafe 账户的配额，并可能产生费用。语义工具与浏览器或原生自动化路由彼此独立。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群！扫描下方二维码填写入群问卷，小助手会定期发送入群邀请。

<table>
  <thead>
    <tr>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
