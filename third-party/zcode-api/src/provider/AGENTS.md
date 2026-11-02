# src/provider/ — 服务商与模型目录

> 维护基线：2026-10-23，HEAD 8f421a3（e025baa+5，4.8.2；广告面/默认值改动已随 1ae8cf8 提交）。溯源证据见 `_reverse/NOTEPAD.md`。

## FILES
| 文件 | 角色 |
|---|---|
| models.ts | 钉死目录 `MODELS`（11 型，spec 对齐 3.11.2 逆向 catalog）+ 广告子集 `ADVERTISED_MODELS` |
| providers.ts | zai/bigmodel 端点定义（anthropic/openai base、bizHost） |
| reasoning.ts | GLM-5.3 effort 契约：eligibility、budget 配对与钳制 |
| types.ts | `ProviderId` / `ProviderDef` / `ModelDef` |

## 契约（改错即全线回归）
- **MODELS ≠ 广告面**：`MODELS` 供 translator 钳制 maxOutputTokens / reasoning 判定（未广告模型仍照常转发、仍需 spec）；`/v1/models`（含 `client_version=pi` 富目录）与 webui 只出 `ADVERTISED_MODELS`（2026-10-20 起 = glm-5.3 + glm-5.3-flash）。裁 MODELS 前先看 translator/openai-to-anthropic.ts 的 find/some 消费。
- **vision 是显式字段**（`ModelDef.vision`），不是 id 含 "v" 启发式——glm-5.3-flash 无 v 但多模态；routes-openai 的 `input_modalities` 与 webui `isVisionModel(/v|flash/)` 都依赖该标志，改一处要三处对齐。
- effort 必须配对 budget_tokens；`"none"`→`"low"`（不可关）；预算按模型 maxOutputTokens 钳制。
- 目录序：当前代默认对领先，其余新→旧——纯呈现层排序，消费方全按 id 查找，序不参与行为。
- **换广告对/默认模型需四处同步**：`ADVERTISED_MODEL_IDS`（models.ts）、webui `KNOWN_MODELS`、config `DEFAULTS.DEFAULT_MODEL`+`DEFAULTS.MODELS`（loader.ts）、config.example.yaml + template.ts（双编辑契约）。

## WHERE TO LOOK
| 任务 | 位置 |
|---|---|
| 新模型上架 | models.ts（spec 钉逆向 catalog）+ providers.test.ts 顺序断言 |
| 换广告面 | models.ts `ADVERTISED_MODEL_IDS` + server/webui.txt `KNOWN_MODELS` |
| 默认模型 | config/loader.ts `DEFAULTS`（DEFAULT_MODEL / MODELS） |
| effort/thinking 预算 | reasoning.ts + translator/openai-to-anthropic.ts（applyAnthropicThinkingCompat） |

## ANTI-PATTERNS
- 永不为"精简"裁 MODELS 全目录（translator 依赖未广告模型的 spec）。
- 永不复活 id-含-"v" 视觉启发式（flash 反例已实锤）。
- spec 数值（contextWindow/maxOutputTokens）钉自逆向 catalog，勿凭印象填。
