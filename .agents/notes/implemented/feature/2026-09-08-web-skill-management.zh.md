# Agent Note: Web skill 管理

状态：已实现

[English](2026-09-08-web-skill-management.md) | 中文

## 问题

Web 客户端可以调用 DSH 已经可见的 skill，但无法发现或安装全局 skill。用户必须离开应用，手动把文件放到 DSH 主目录下。

## 决策

新增一个 **设置 > Skills** 区域，由三个根地址 Remote（`skills/installed`、`skills/search` 和 `skills/add`）支持：列出已安装的全局 skill、通过 `npx skills find` 搜索 skills.sh，以及通过 `npx skills add --agent universal -y --copy` 安装一个选中的 `owner/repository@skill`。模拟终端同时接受 `npx skills add owner/repository@skill` 和官方格式 `owner/repository --skill skill-name`，也接受 HTTPS GitHub 仓库 URL。浏览器按照允许列表解析命令格式，只提取规范的目录标识，绝不执行粘贴的文本。

Host 不经过 shell 直接执行 `npx`，限制运行时间与输出，从子进程环境中移除 Harness 凭据，并在 DSH 主目录之外暂存结果。只有暂存目录恰好包含请求的一个 skill 和普通文件 `SKILL.md` 时才会发布。替换过程使用 pending 目录和 `$DSH_HOME/skill-backups` 下的可恢复备份；最终移动失败时恢复旧版本。

## 考虑过的替代方案

**在浏览器中运行安装器。** 拒绝，因为浏览器无法安全写入 Host skill 目录，而且会暴露不必要的执行边界。

**直接安装到 `$DSH_HOME/skills`。** 拒绝，因为失败或恶意的软件包操作可能留下不完整的 skill，或在无法恢复的情况下覆盖当前版本。

**构建第二个目录客户端。** 拒绝，因为维护中的 `skills` CLI 已经定义了 skills.sh 的发现和安装行为。

## 后果

用户可以在类似终端的控件中输入熟悉的 npx 命令，也可以无需离开 Web UI 即可发现和安装目录 skill；每个 preset 都能看到同一套 `$DSH_HOME/skills` 集合。安装需要网络访问与 `npx`，一次只接受一个目录标识，并有意不提供更新和卸载控件。skill 仍是受信任的指令内容，可以指导 Agent 执行命令，因此 UI 要求明确确认并显示来源警告。
