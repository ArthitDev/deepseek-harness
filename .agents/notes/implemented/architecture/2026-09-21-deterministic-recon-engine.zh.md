# Agent Note：确定性侦察引擎

Status: implemented

[English](2026-09-21-deterministic-recon-engine.md) | 中文

## 问题

初始侦察以重复的模型驱动工具调用运行（curl、DNS 查询、读取响应头），在固定流程上消耗推理轮次与输入 token，并把原始工具输出拉进上下文。结果没有稳定 schema、没有原始证据链，也没有任何东西阻止模型在下一轮重复同样的检查。

## 决策

侦察流程是代码。引擎只暴露两个工具，没有任何模型可触的 scope 旋钮：`recon_scan(target, profile, force)` 与 `recon_get_evidence(ref)`。profile 映射到检查类别——`quick`（DNS 核心、HTTP、TLS）、`standard`（另加完整 DNS OSINT、公开元数据、HTML 表面、JS 清单、指纹）、`deep`（另加 JS 正文挖掘、对配置端口的受控 connect 探测、证书透明度子域查询）。独立探测并行展开；每个模块把原始输出存到 `<evidenceDir>/<runId>/` 下，模型收到一份紧凑的确定性报告，其每条 finding 都携带 evidence 引用。每 host 新鲜度索引配合按类别 TTL，在重复扫描时返回缓存摘要，除非设置 `force`。

三条边界是承重墙。第一，scope 授权复用 pentest-run 的归一化目标词汇，因此约束 exploit 的 scope 以完全相同的语义约束侦察，且模型无法扩大它——工具层在目标之外没有任何范围参数。第二，evidence 引用在读取时做路径包含约束；`recon://` 是指向单个文件的能力令牌，不是目录列表。第三，渲染路径输出有界的行格式，绝不输出原始正文——HTML 与 JS 内容只有通过显式 `recon_get_evidence` 调用才能到达模型，而该调用本身也有大小上限。

## 被否决的替代方案

**以携带侦察方法论的 agent skill 作为起点。** 否决——策略文本在每次对话都要付费且不约束任何行为；引擎通过缓存/去重在结构上使重复不可能，薄 prompt section 覆盖顺序问题。

**外接 nmap/curl。** MVP 否决——外部二进制破坏确定性 fixture 的测试故事且逐 host 各异；Node 自身的 DNS、fetch、TLS 与 net 已覆盖初始阶段。包装外部扫描器作为后续 profile 保持开放。

**把侦察结果存入 pentest-run domain。** 暂缓——侦察是只读观察，有独立的生命周期与缓存；把 interesting targets 提升为规范任务是 harness 层的工作，留到攻击循环集成落地时再做。

## 后果

初始侦察的成本是一次工具调用加一份紧凑报告；原始数据默认不进上下文。证书透明度查询是唯一的外部 OSINT 依赖并做软失败。测试注入 DNS、CT 与（必要时）TLS 表面，因此除一次基于已提交自签 fixture 的本地真实 TLS 握手外，测试套件保持离线且确定。

## 验证

确定性测试覆盖目标/scope 拒绝、本地 HTTP fixture 上的 standard-profile 端到端运行（发现、指纹、邮箱、API 候选、finding）、缓存命中与 force 行为、本地 https fixture 上的真实 TLS 证书事实、受控端口探测、带路径包含拒绝的 evidence 读回，以及每个规则/辅助函数的独立检查。

## 延后

被动 DNS、wayback 与搜索引擎 pivot；外部扫描器 profile；把 `interesting_targets` 喂给 pentest-run 任务创建；对照引擎前基线的成本基准测试。
