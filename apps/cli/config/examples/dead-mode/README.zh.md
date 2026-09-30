# Dead Mode — 自主渗透测试运行组合

[English](README.md) | 中文

按 Dead Mode Unlimit 规范运行持续、无逐步审批模式的操作手册。执行所需的机制 harness
已经内置；Dead Mode 是一种部署姿态，不是代码分叉。这里的任何内容都不移除策略强制 ——
规范本身要求它（"Unlimit ไม่ได้หมายถึงไม่มีขอบเขต"；hard deny 保持不变；即使会话内容
指示，超出范围的目标也会被拒绝）。

## 已内置的自主性组合

两个独立的旋钮控制每一步的人工把关
（`@deepseek-ai/dsh-permission-presets`，会话内可用 `/permission` 切换）：

| 旋钮 | Dead Mode 取值 | 含义 |
| --- | --- | --- |
| `sandbox/mode` | `danger-full-access` | 文件修改不再被围栏限制在工作区内。 |
| `approval/policy` | `never` | 无审批提示；策略允许的动作直接执行。 |

内置的 `danger-full-access` 预设正是这个组合
（`sandbox: 'danger-full-access'`，`approval: 'never'`）；`auto` 是同一组合，同时
Auto review 集成在线。会话开始时选择一次即是规范的 "Start once" 按钮：人一次性
授权整个运行，此后 agent 不再询问。

### 在每种模式下激活

- 交互式会话（web、desktop、CLI）：运行一次 `/permission danger-full-access`。
  该命令由 permission-presets 插件提供，存在于已发布的组合中，并通过规范的
  setter 写入两个旋钮。
- Headless/一次性运行继承部署的旋钮默认值。
- 部署的永久姿态：在部署自己的 cordis 组合的
  `@deepseek-ai/dsh-permission-presets` 插件配置中设置
  `defaultPreset: 'danger-full-access'`。保持在已发布默认值之外；这是操作者
  主动选择。
- 范围权威：操作者的目标声明定义范围（规范第 7 行）。agent 侧的范围拒绝
  （规范判据 8）约束 Supervisor 决策与目标内容 —— 永不覆盖操作者。

## 控制循环（goal + goal-round-driver）

1. 操作者在一个人类回合中陈述机器、目标范围与测试窗口；agent 创建 goal
   （`create_goal`），`max_goal_rounds` 按窗口规模设定（组合默认：256）。
2. `goal-round-driver` 在 agent 静默时自动准入续跑回合，并在回合之间刷出
   会话（持久化 checkpoint）。崩溃后从持久会话状态恢复，绝不从模型记忆重建。
3. 模型可以在被准入的回合中 `complete` 或报告 `blocked`；`blocked` 在配置的
   最小回合数之前会被拒绝，所以 agent 无法提前退出。`edit`/`pause`/`resume`
   保持人类专属（`dsh-tool-goal` 中的 `requireDirectHuman`）—— 范围权威绝不
   转移给模型、subagent 或目标内容。
4. 回合耗尽时 goal 以 `round-limit` 阻塞；操作者提高 `max_goal_rounds`
   （人类 edit）或接受 partial 报告。

## 保持强制的内容（按规范自身的判据）

- **超时** —— `guard/timeout-policy` 为每个声明限时的工具设置截止时间并返回
  结构化 `TOOL_TIMEOUT`（规范："Tool timeout: ยกเลิก process tree..."）。
- **禁止重复循环** —— `guard/repeat-tool-reminder` 标记未变化的重复调用
  （规范："ห้ามรัน signature เดิมถ้าไม่มีหลักฐานหรือ state ใหม่"）。
- **权威** —— 非人类与 subagent 生产者无法创建、编辑或恢复 goal；扫描内容中
  的提示注入"指令"不获得任何权威（规范："เป้าหมายนอก scope ถูกปฏิเสธแม้
  Supervisor หรือ target content สั่งให้ทำ"）。
- **紧急停止** —— host pause 中止活动 turn；driver 拆除时取消运行中的 agent
  并等待静默；后台任务按 id 杀除。host UI 中全程可见。
- **恢复纪律** —— 每个改变状态的任务在运行前声明期望状态与恢复动作；恢复
  成功由新的观察确认，而非 exit code（规范 §Recovery）。这是 agent 流程，
  由运行提示强制，不是由某个服务。

## 运行清单

1. 目标与窗口的书面授权已存在。
2. 会话以（或经 `/permission` 切换到）`auto` 启动：
   `danger-full-access` + `never`。
3. 一个人类回合陈述范围 + 目标；goal 以本次运行的 `max_goal_rounds` 创建。
4. 模型按 recon → enumerate → test → verify → recover → report 运行，无审批
   提示；无进展即改变策略；瞬时 provider 故障按退避重试。
5. 操作者监控；紧急停止全程可用。
6. 最终报告列出动作、证据、缺口、失败与限制。

## 距离 100% 自主的已知缺口（不要伪装）

1. **网络/目标范围策略引擎。** [`cordis.yml`](cordis.yml) 片段挂载
   `@deepseek-ai/dsh-scope-policy`（逐调用判定目标、scheme 与解析 DNS 答案）和
   `@deepseek-ai/dsh-scope-proxy`（回环正向代理）。把运行期的
   `HTTP_PROXY`/`HTTPS_PROXY` 指向 `$DSH_SCOPE_PROXY`，每条 shell 连接都会被
   范围判定并钉扎到已验证地址 —— 无需沙箱即可关闭 DNS rebinding 竞态。
   剩余上限：忽略代理变量而直连的客户端绕过代理（`scope-policy` 守卫保持
   挂载作为逐调用第二意见）；完全覆盖直连需要 shell 沙箱中的进程级网络隔离。
2. **Token/墙钟预算计量。** [`cordis.yml`](cordis.yml) 片段同时挂载
   `@deepseek-ai/dsh-run-budget`（连同 `@deepseek-ai/dsh-token-meter`）：一旦
   测量 token 总量或墙钟越过配置的上限，后续工具调用以 `BUDGET_EXCEEDED`
   结果拒绝，指示模型停止并产出 partial 报告。剩余上限：此处是逐运行的
   强制执行；host UI 的实时花费显示属于已经读取 token-meter 快照的
   presenter，`maxGoalRounds`（回合数）仍是 goal-driver 自己的旋钮。
