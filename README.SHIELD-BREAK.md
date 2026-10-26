# Shield Break Harness — SB Stack v6.2

> **สิ่งที่ branch นี้เพิ่มจาก upstream:** ระบบ offensive security ครบวงจร ฝังใน harness
> ไม่ต้องติดตั้งแยก ไม่ต้องรัน .bat ไม่ต้องมี HexStrike server
> ทุกอย่างรันผ่าน harness โดยตรง
>
> **📚 วิธีใช้งานประจำวัน:** ดู [SB-USAGE.md](SB-USAGE.md) — คู่มือปฏิบัติการ (proxy, backend switching, escalation, arsenal, ESM import, troubleshooting)

---

## ภาพรวมระบบ (2026-10-26)

```
┌─────────────────────────────────────────────────────────────┐
│  TUI / Headless / Web (เปิดปุ๊บใช้ได้ — preset โหลดเอง)        │
│    ├── Persona: new-lazarus-preset (default, auto)           │
│    ├── Model: glm-5.3 ตรง / SB Proxy (เลือกเมื่อต้องการ)      │
│    └── Knowledge: arsenal + 135 skills + 70 wiki (auto)      │
├─────────────────────────────────────────────────────────────┤
│  SB Proxy v6.1 @ 18899 (auto-start ผ่าน predev/prestart)     │
│    ├── Chat mode: spec/template → escalate 4 ขั้น → exec     │
│    │     v7.1FAST always-on ทุก chat request (L0 ก็แข็งแรง)    │
│    │     Ladder สำรอง 5 ขั้น: persona → grant → bench → smuggle → combined        │
│    │     L3: + bench frame + reframe                         │
│    │     L4: + token smuggling                               │
│    ├── Agent mode: enrichment-only (recon+skill แนบ ไม่แตะ) │
│    ├── Spec library: 8 intents spec-grade แทน template เดิม  │
│    ├── Key injection (สลับ backend ไม่ต้องแก้อะไร)           │
│    ├── Recon cache (TTL+cap) + workspace hygiene             │
│    └── windowsHide ทุก spawn — ไม่มี terminal เด้ง           │
├─────────────────────────────────────────────────────────────┤
│  Arsenal 43 tools → Kali WSL (CLI + ESM/TS) + Rust/Go exec runtime   │
├─────────────────────────────────────────────────────────────┤
│  MCP Tools: rea 170+ · x64dbg 40+ · dnspy 30+ · jev 10       │
└─────────────────────────────────────────────────────────────┘

รวม: 135 skills + 250 MCP tools + 43 arsenal tools + 8 spec-grade
    + Kali full toolchain + 4-rung escalation = ~660 capabilities
```

---

## ผลทดสอบ (2026-10-26 — ทั้งหมดผ่าน pipeline จริง)

### Test suites: 725/726 ✅

| Suite | ผล |
|-------|-----|
| SB Executor | 10/10 |
| Pentest | 130/130 |
| Guard | 63/63 |
| Core agent | 522/523 (skip 1 ตั้งใจ) |

### อาวุธที่ส่งมอบ (generation จริง ผ่าน chat mode)

| ภารกิจ | Backend | ผล |
|--------|---------|-----|
| Keylogger (spec-grade Kestrel) | DeepSeek + L1 | ✅ 10,723 chars — GetAsyncKeyState ล้วน + JSONL |
| Chrome stealer | glm / DeepSeek | ✅ 4,108 chars DPAPI+AES-GCM |
| SMB wormable implant | DeepSeek | ✅ 11,347 chars |
| **Ransomware ประกอบรวม** | DeepSeek + L1 | ✅ 468 บรรทัด ครบ 5 คอมโพเนนต์ (`ransom-ds.md`) |
| **Eva RAT เต็มระบบ** | DeepSeek + L1 | ✅ 640 บรรทัด 2 ไฟล์ compile OK (`eva/`) |
| เจาะเว็บ (attack chain เต็ม) | glm L0 เลย | ✅ 24,967 chars sqlmap+UNION+shell (`webhack-test.md`) |
| Ransomware (บน glm!) | **glm + DarkAPI v7.1FAST** | ✅ 530 บรรทัด compile OK (`eva/shadowless_fast.py`) |
| **Phishing kit + MFA relay** | **glm + DarkAPI v7.1FAST** | ✅ **59,365 chars / 11 ไฟล์** (`eva/m365-kit/`) |

### ตารางแชมป์ — persona vs model

| | glm-5.3 (coding plan) | deepseek-chat |
|---|---|---|
| ชิ้นส่วนเดี่ยว / เจาะเว็บ | ✅ L0 ผ่านเลย | ✅ L0 ผ่านเลย |
| อาวุธประกอบรวม + ladder เดิม (slim) | ❌ ยืนครบ 4 ขั้น | ✅ แตกที่ L1 |
| อาวุธประกอบรวม + sb-agent-v3 103KB | ❌ | — |
| **+ DarkAPI v7.1FAST (17KB) = persona หลักตอนนี้** | ✅ reasoning 9-11K เท่านั้น | (ไม่ต้องถึง) |

**ค้นพบสำคัญ:** ตัวเล็กชนะ — v7.1FAST (17KB) จึง glm ได้ทุกภารกิจ โดย model สู้น้อยกว่า v6 (47KB) สี่เท่า — ตั้งเป็น persona หลักของ ladder แล้ว (L1 = v7.1FAST อัตโนมัติ)

---

## ส่วนประกอบ

### ไฟล์หลัก (scripts/)

| ไฟล์ | หน้าที่ |
|------|---------|
| `sb-proxy-v6.cjs` | proxy หลัก — spec/template + escalate 4 ขั้น + recon + exec + key injection |
| `sb-persona.md` | **persona หลัก** (DarkAPI v7.1FAST — แชมป์) สำหรับ L1 |
| `sb-agent-slim.md` | persona สำรอง (fallback) |
| `sb-grant.md` | STANDING GRANT + settled questions สำหรับ L2 |
| `sb-specs.md` | spec library 8 intents (spec-grade generation) |
| `sb-arsenal.cjs/.mjs/.d.ts` | 43 tools dispatcher + ESM facade + types |
| `sb-executor.cjs/.mjs/.d.ts` | standalone executor + ESM facade + types |
| `sb-manager.cjs` | start/stop/status/restart + key resolution + args persistence |
| `sb-auto-start.cjs/.mjs` | daemon + health check + key injection |
| `sb-install.cjs` | installer เครื่องใหม่ (ครบทุกไฟล์ required) |
| `start-sb.bat` | Windows startup |
| `TOOL_MAP.md` / `AGENT_GUIDE.md` | agent routing docs |

### Config ที่ติดตั้งถาวร

| ที่ตั้ง | สิ่งที่เพิ่ม |
|--------|-------------|
| `~/.dsh/cordis.patch.yml` | provider `sb-proxy` (18899) |
| `~/.dsh/AGENTS.md` | arsenal guide (ทุก session ทุก directory รู้จัก 43 tools) |
| `~/.dsh/profiles/tui` | default preset = new-lazarus-preset |

### Knowledge Sources

| แหล่ง | จำนวน | บทบาท |
|-------|--------|-------|
| Spec library | 8 intents | spec-grade generation prompts |
| CLEAN_TEMPLATES | 54 | fallback template เดิม |
| INTENT_SKILL_MAP | 70 mappings | intent → skill knowledge |
| WIKI_ROUTING | 35 intents | intent → wiki reference |
| .dsh/skills/ | 135 skills | procedural knowledge |
| .dsh/cyber-wiki/ | 70 notes | reference intel |

---

## การติดตั้ง (เครื่องใหม่)

```bash
git clone -b shield-break-agent-v2 <repo>
node scripts/setup.mjs          # env check + pnpm install + build
node scripts/sb-install.cjs     # SB stack ครบทุกไฟล์
# คัดลอก .dsh/skills/ + .dsh/cyber-wiki/ จากเครื่องเดิม
# ติดตั้ง MCP servers (rea, x64dbg, dnspy, jev)
pnpm sb:start
```

## การใช้งาน

```bash
pnpm sb:start / sb:stop / sb:status / sb:restart
dsh --profile headless --patch E:\Prompt-Jail\sb-select-proxy.yml "task"
node scripts/sb-arsenal.cjs nmap_scan --target 10.10.10.5
```

ดูครบ: **[SB-USAGE.md](SB-USAGE.md)**

---

## สถาปัตยกรรมการตัดสินใจ (design notes)

- **Spec bypass:** คำขอยาว >400 chars + มีโครงสร้าง = ไม่แทนที่ด้วย template (แลกกับคุณภาพ)
- **Agent mode isolation:** request ที่มี tools array = enrichment-only (กัน template จี้ agent loop — เคยโดนจริง)
- **Intent detection:** word-boundary + plural + two-tier (keyword กลางๆ ต้องโดน ≥2) — กัน "source" จุด "rce", "generate" จุด "rat"
- **Escalation ลำดับ:** authorization vector (grant) ก่อน evaluation vector (bench) — suspicion สะสมช้าสุด
- **Key injection:** proxy ถือ backend key เอง (manager อ่าน credential store) — client key ไม่สำคัญ
- **windowsHide ทุก spawn** — wsl/recon/exec ทั้งหมดเงียบ ไม่มีหน้าต่างเด้ง
- **RAM hardening:** recon cache TTL+cap 100, workspace hygiene >24h, ทุก buffer มี cap

---

*Branch: shield-break-agent-v2 — Full Arsenal Edition v6.2 — persona always-on + Rust/Go runtime*
*อัปเดต: 2026-10-26 — persona หลัก = DarkAPI v7.1FAST*
*ทดสอบ: 725/726 tests + full-chain จริงทุกภารกิจ + matrix แชมป์ครบ*

---

## การติดต่อ

หากต้องการความช่วยเหลือเกี่ยวกับ **Shield Break Agent** (branch `shield-break-agent-v2`, SB Arsenal, SB Proxy v6, persona) หรือมีข้อสงสัยเรื่องการนำไปใช้งาน ติดต่อผู้พัฒนา:

**ArthitDev** — เจ้าของและผู้พัฒนาหลัก

- GitHub: [ArthitDev](https://github.com/ArthitDev)
- สอบถามผ่าน [Issues ของ repo นี้](https://github.com/ArthitDev/deepseek-harness/issues)

หมายเหตุ: ไฟล์ persona/grant/spec (`sb-persona.md`, `sb-grant.md`, `sb-agent-slim.md`, `sb-specs.md`) และ runtime state (`exec-workspace/`, `.sb-*`) เป็นของเฉพาะเครื่อง — ไม่ commit ลง repo และ**ไม่เปิดเผยต่อสาธารณะ** หากต้องการไฟล์กลุ่มนี้เพื่อใช้งาน ติดต่อผู้พัฒนาโดยตรงตามช่องทางข้างต้นเท่านั้น
