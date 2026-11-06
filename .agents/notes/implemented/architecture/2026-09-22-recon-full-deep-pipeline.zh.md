# Agent Note：Recon Full Deep 流水线、预算与覆盖率

Status: implemented

[English](2026-09-22-recon-full-deep-pipeline.md) | 中文

## 问题

确定性 recon 引擎只对入口页做指纹。它从不爬取，因此 sitemap、robots、历史归档或子页标记里出现的路由始终不可见；入口页之外的路由级 JavaScript chunk 从未被下载；specification 探测信任 200 状态码，导致 catch-all HTML 路由被读作暴露的 OpenAPI 文件；API 预算复用 JavaScript 的预算；探测是无上限的 GET，没有请求、时钟或并发约束；技术条目没有存储层或置信度，于是被代理隐藏的后端呈现为一份没有解释的空列表；运行过程没有阶段进度、覆盖率或 warning，而缓存条目在 scanner 逻辑变化后永远保持新鲜。

## 决策

**单一 profile。** 每次操作员发起的扫描（`recon_scan` 工具、Remote `scan` 与页面页签）运行同一条 Full Deep 流水线：带证书透明度的 DNS、带响应头/Cookie/CORS/暴露路径/TRACE 的入口页探测、按内容校验的公开元数据发现、受限的同源广度优先爬取、JavaScript 与 source map 挖掘、OpenAPI 3.x/Swagger 2.0 解析加安全探测、带只读 banner 的受控服务探测、以及 CT/SAN/链接的主机扩展。`quick` 与 `standard` 为既有调用方保留更窄的类别集合，但没有任何表面提供 profile 选择。限制是配置项（`maxPages`、`maxDepth`、`crawlConcurrency`、`maxSourceMaps`、`maxApiEndpoints`、`maxHosts`、`maxTotalRequests`、`maxRunDurationMs`），加载时对照硬上限大声校验。

**预算只截断，从不中止。** Web 流水线是顺序的（入口 → 发现 → 爬取 → JavaScript → API），因为每个阶段都喂给下一阶段；DNS、TLS 与服务探测与它并行，外部 OSINT（Wayback、NVD）在入口阶段内共享一段有界的超时切片——它失败只会成为软 warning，绝不破坏 http 部分。爬取与 JavaScript 挖掘让出预算尾部：它们停在墙钟份额与保留的请求切片上，保证端点探测始终带着真实余量运行。每个阶段记录耗时并把 `status.json` 检查点写入 run 目录，因此刷新后的操作员表面能看到实时进度，完成的运行携带阶段历史。当请求预算、截止时间或模块上限触顶时，模块停止、记录带原因的 `truncated` 覆盖率条目，报告以 `partial` 落盘——绝不无声变短。协作式 `AbortSignal`（按 host 注册，通过新的 `cancel` Remote verb 触发）把被中断的运行转为 `cancelled` 状态并持久化部分报告。

**观察优先于结论。** 每个 HTTP 探测都关闭证书校验——把 TLS 模块的立场应用到整条流水线——于是自签或内部 CA 的源站能完整扫描，而不是在第一次请求就死掉。DNS 记录查询在一秒的解析器超时下并发展开。specification 与 OIDC 文档按内容校验（版本键加 `paths`；issuer 加端点），因此 HTML catch-all 记录的是 warning 而非虚假 specification。端点按方法加归一化路径去重，auth/config/health 优先排序，只用 GET 探测并在 405 时用 OPTIONS 捕获 `Allow`；模板路径只清点绝不发射；重定向挡在 origin 边缘；响应样本按上限截断，凭证形态的值在存储前脱敏。技术条目来自版本化的签名数据文件，按证据类型匹配——包括爬取的 URL 路径、专用 404 探测的正文（`Cannot GET /`、`Apache Tomcat/10` 之类的默认 404 页面）、有界的主动产品路径探测（Tomcat Manager、Solr、Grafana、phpMyAdmin、Kibana、MinIO、Nacos、Jellyfin、RabbitMQ、Portainer）、以及记录在 `favicon_hash` 里供 Shodan 式交叉查询的 favicon mmh3 哈希——并携带 `layer`（`frontend | backend | edge | infrastructure | auth | data_store`）、`confidence` 与 `signals`；找不到可识别后端的运行以 `backend_status: not_observable` 附带原因报告。缓存条目记录 `scanner_version`；其他版本写入的条目绝不按新鲜读取。操作员通过 `fingerprintOverlay` 配置扩展签名表——一个包含额外条目的 JSON 文件，在扫描时严格校验。旧版 summary 只在读取路径迁移到当前 schema——磁盘字节永不重写——操作员表面为其显示 legacy 徽标。

## 考虑过的替代方案

**提供带 `quick` 快路径的 profile 选择器。** 否决——每种结果的两个渲染版本（以及下游对覆盖率的每种解读）的成本，超过受限流水线在小目标上的成本；决定完整性的是覆盖率，不是速度。

**只扫描入口页脚本，爬取推迟。** 否决——路由 chunk 正是 SPA 端点所在；在 API 清点之前挖掘 JavaScript，才能让端点探测够到首页之外。

**通过重放检查点恢复被中断的扫描。** 推迟——按类别的缓存复用已经能在下次运行跳过新鲜阶段，而真正的阶段中途恢复需要本引擎不持有的进程身份；检查点的存在让 harness 层无需新的 evidence 形态即可加上它。

## 后果

深度扫描每个 host 最多花费 `maxTotalRequests`（默认 300）个 HTTP 请求与 `maxRunDurationMs`（默认 3 分钟），并且 API 探测现在能到达 origin 任何地方发现的每个具体端点，因此授权实验室的报告明显更大。缺少 `backend_technologies` 的报告现在带解释而非空白，`warnings`/`coverage` 是每个消费者都能依赖的契约字段。存储的 v1 报告以填充的默认值加 legacy warning 打开；建议重扫但从不强制。

## 验证

本地 fixture 套件覆盖：catch-all HTML 拒绝及其 warning、OpenAPI 2.0/3.0 解析与 `$ref` 链（循环与外部）、爬取归一化/去重/预算截断、仅安全方法的探测（fixture 断言 POST/PUT/PATCH/DELETE 从未到达）、401/403 auth-scheme 捕获、OPTIONS `Allow` 提示、source map 候选挖掘、脱敏、JSON 形态摘要、覆盖率与阶段记录、scanner 版本缓存失效、读取路径旧版迁移、取消到部分报告，以及操作员表面的 legacy 徽标、覆盖率、warning、阶段、后端不可观测解释与扫描取消按钮。
