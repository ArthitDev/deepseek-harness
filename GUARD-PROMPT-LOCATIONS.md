# Guard & Prompt Locations — แผนที่แก้ไขด้วยตัวเอง

สารบัญตำแหน่งโค้ดทั้งหมดที่เกี่ยวกับ guard, prompt sections, และ switch ซ่อน prompt ในตัว
( branch `shield-break-agent-v2`, อัปเดต 2026-09-30 )

## 1. Runtime guard (โค้ดบังคับจริง — switch prompt ไม่มีผล)

ชั้นนี้เป็น enforcement ระดับโค้ด เปิด/ปิดด้วย composition หรือแก้ที่โค้ดโดยตรง

| สิ่ง | ตำแหน่ง | รายละเอียด |
|---|---|---|
| Scope guard ตอนเปิด executor episode | [pentest-executor/src/index.ts:640](packages/pentest/pentest-executor/src/index.ts#L640) | `agentCtx.tools.guard(createPentestScopeGuard(...))` — ลบ/ครอบด้วยเงื่อนไข = episode นั้นไม่มี guard |
| ตัว guard function | [pentest-executor/src/scope.ts:50](packages/pentest/pentest-executor/src/scope.ts#L50) | `createPentestScopeGuard(lease, onDeny)` |
| scope-policy (deployment-level) | [guard/scope-policy/src/index.ts:130](packages/guard/scope-policy/src/index.ts#L130) | `apply()` → hook `tools/execute` (บรรทัด 153) ปฏิเสธด้วย `SCOPE_DENIED` (บรรทัด 30, 106) |
| run-budget | [guard/run-budget/src/index.ts:80](packages/guard/run-budget/src/index.ts#L80) | `apply()` — ปฏิเสธ call เมื่อ `maxTotalTokens` / `maxWallMs` เกิน |
| scope-proxy (network) | [guard/scope-proxy/src/index.ts:111](packages/guard/scope-proxy/src/index.ts#L111) | `class ScopeProxy` — forward proxy จริง, env `SCOPE_PROXY_ENV` บรรทัด 48 |

จุด mount ของ guard plugin: อยู่ใน composition ที่ deployment ใช้ (cordis.yml / profile patch) —
ค้นหา id `scope-policy` / `run-budget` ในไฟล์ composition แล้วลบ row ออก = ไม่ mount

## 2. Prompt section suppression (switch ที่เพิ่ม)

| สิ่ง | ตำแหน่ง |
|---|---|
| Core API `suppressSections({ except })` | [core/system-prompt/src/index.ts:533](packages/core/system-prompt/src/index.ts#L533) |
| Layer store `sectionSuppressors` | [core/system-prompt/src/index.ts:381](packages/core/system-prompt/src/index.ts#L381) |
| Filter ตอน assemble (evaluate provider ทุกครั้ง) | ค้น `sectionSuppressors` ในไฟล์เดียวกัน |
| Schema field `suppressSections` | [pentest-executor/src/index.ts:315](packages/pentest/pentest-executor/src/index.ts#L315) |
| Wiring allowlist provider | [pentest-executor/src/index.ts:352](packages/pentest/pentest-executor/src/index.ts#L352) |

หลักการ: allowlist เป็น provider ที่ evaluate ใหม่ทุกครั้งที่ assemble — switch จาก UI มีผลตั้งแต่
request ถัดไป ไม่ต้อง restart — suppressor หลายตัว stack แบบเข้มสุด (section รอดได้ต้องอยู่ใน
allowlist ของทุก suppressor)

Semantics ปัจจุบัน: switch เปิด = ซ่อนเฉพาะ **built-in global sections** (tool guidance, RECON
WORKFLOW, identity, deployment persona) — **prompt ที่มากับ Preset composition (agent-scope
sections) ไม่ถูกซ่อน** และ Team Prompt แทนที่เฉพาะบรรทัดโหมด ไม่แตะ prompt ของ Preset
(คีย์: `globalOnly: true` ที่ core/system-prompt suppressSections + wiring ที่ pentest-executor)

## 3. Team mode prompts (การ์ดตั้งค่า)

| สิ่ง | ตำแหน่ง |
|---|---|
| Schema: mode + 4 prompt fields (default = built-in text) | [pentest-executor/src/index.ts:303](packages/pentest/pentest-executor/src/index.ts#L303) |
| Built-in texts (`GENERAL_MODE_POLICY`) | [pentest-executor/src/index.ts:281](packages/pentest/pentest-executor/src/index.ts#L281) |
| Session prompt inject | [pentest-executor/src/index.ts:343](packages/pentest/pentest-executor/src/index.ts#L343) |
| Executor prompt (`renderPentestExecutorPrompt`) | [pentest-executor/src/index.ts:378](packages/pentest/pentest-executor/src/index.ts#L378) — call site ที่ 642 |
| Supervisor prompt (`supervisorPrompt`) | [pentest-executor/src/control.ts:167](packages/pentest/pentest-executor/src/control.ts#L167) — inject ที่ 218-222 |
| Card component (Switch + 4 ช่อง) | [ui-workspace/src/client/TeamModePromptsCard.tsx](packages/client/ui-workspace/src/client/TeamModePromptsCard.tsx) |
| Card controller (staged form + `toggleSuppress`) | [ui-workspace/src/client/team-mode-prompts-controller.ts](packages/client/ui-workspace/src/client/team-mode-prompts-controller.ts) |
| Register เข้าหน้า Settings | [ui-workspace/src/client/index.ts:138](packages/client/ui-workspace/src/client/index.ts#L138) — namespace `pentest-mode`, order 40 |
| Labels en/zh | [ui-workspace/src/client/locales.ts](packages/client/ui-workspace/src/client/locales.ts) — ค้น `teamMode.` |

## 4. Prompt sections อื่น ๆ (switch ปิดได้ทั้งหมด)

| Section | เจ้าของ |
|---|---|
| `tool:recon_scan` (RECON WORKFLOW) | [recon-engine/src/index.ts:286](packages/pentest/recon-engine/src/index.ts#L286) |
| `tools:calling` (ห้ามประกาศ tool call ใน text) | [core/tools/src/index.ts](packages/core/tools/src/index.ts) |
| `tool:read` / `tool:write` / `tool:edit` | [fs/tool-fs/src](packages/fs/tool-fs/src/read.ts) |
| `tool:glob` / `tool:grep` | [fs/tool-fs-search](packages/fs/tool-fs-search) |
| `tool:bash` (exit-code rules) | [shell/tool-bash/src/render.ts](packages/shell/tool-bash/src/render.ts) |
| WEB_SURFACE (Web GUI context ที่ 127.0.0.1:3080) | [bundle/web-app/src/index.ts](packages/bundle/web-app/src/index.ts) |
| HARNESS_SOURCE (checkout path) | [boot/app-boot/src/index.ts](packages/boot/app-boot/src/index.ts) |
| `tool:jobs` | [jobs/tool-jobs](packages/jobs/tool-jobs) |
| web_search / web_fetch | [web/tool-web](packages/web/tool-web) |
| goal / workflow / ralph / subagent | แพ็กเกจเจ้าของตามชื่อ |

## สรุปจุดแก้สำหรับการทดลอง

- **ปิด prompt guidance**: switch ในหน้า Settings → Plugins → Team mode prompts
- **ปิด scope enforcement ใน executor**: ครอบบรรทัด 640 ของ pentest-executor/src/index.ts ด้วยเงื่อนไข
- **ปิด guard ถาวร**: ลบ row ออกจาก composition (cordis.yml / profile patch) ที่ mount ปลั๊กอิน
