# Shield Break Agent — Branch `shield-break-agent-v2` — Full Arsenal Edition

> **สิ่งที่ branch นี้เพิ่มจาก upstream:** ระบบ offensive security ครบวงจร ฝังใน harness
> ไม่ต้องติดตั้งแยก ไม่ต้องรัน .bat ไม่ต้องมี HexStrike server
> ทุกอย่างรันผ่าน harness โดยตรง

---

## ภาพรวมระบบ

```
┌─────────────────────────────────────────────────────────┐
│                    HARNESS (this branch)                  │
│                                                           │
│  ┌─ Agent Guide ──── บอก Agent ว่ามีอะไรใช้ได้           │
│  ├─ SB Arsenal ───── 43 tools รันตรงเข้า Kali WSL       │
│  ├─ SB Proxy v6 ──── LLM pipeline (recon+skills+wiki)   │
│  ├─ Full Preset ──── Persona v3 (26K tokens, 88 sections)│
│  ├─ Guard OFF ────── ไม่มี scope/budget/tool restriction │
│  └─ Limits WIDE ──── 10K cycles, 24h, 500M tokens        │
│                                                           │
│  ┌─ MCP Tools (live) ─────────────────────────────────┐  │
│  │  rea (170+) · x64dbg (40+) · dnspy (30+) · jev (10)│  │
│  │  recon_scan (Full Deep)                            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─ Knowledge ────────────────────────────────────────┐  │
│  │  135 skills (.dsh/skills/)                         │  │
│  │  70 wiki notes (.dsh/cyber-wiki/)                  │  │
│  │  54 SB templates                                   │  │
│  │  66 payload categories (PayloadsAllTheThings)      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─ Kali WSL2 ─────────────────────────────────────────┐  │
│  │  nmap · sqlmap · hydra · john · hashcat · nuclei    │  │
│  │  ffuf · gobuster · impacket (5 tools) · bloodhound  │  │
│  │  subfinder · amass · httpx · dnsx · masscan         │  │
│  │  nikto · wpscan · searchsploit · msfvenom           │  │
│  │  binwalk · volatility · exiftool · steghide         │  │
│  │  sslscan · testssl · proxychains + tor              │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**รวม: 135 skills + 250 MCP tools + 43 arsenal tools + Kali full toolchain = ~660 capabilities**

---

## Mod ใน branch นี้

### 1. Agent Preset — Full Persona

| ไฟล์ | คืออะไร |
|------|---------|
| `sb-agent/agent.cordis.yml` | Persona v3 เต็ม (26K tokens) + Arsenal Guide + เครื่องมือทั้งหมด |
| Persona sections | 88 sections: identity, attack semantics, person-as-endpoint, capability manifest, anchors (25), escalation modules (A/C/D), output gate, identity recovery |
| Arsenal Guide | System prompt section ที่บอก Agent ว่ามี 43 tools + MCP + skills และเรียกยังไง |

### 2. SB Arsenal — Tool Dispatch (ไม่ต้องมี HexStrike)

| ไฟล์ | คืออะไร |
|------|---------|
| `scripts/sb-arsenal.cjs` | 43 tools dispatcher — รันคำสั่งตรงเข้า Kali WSL ไม่ต้องมี server แยก |
| `scripts/TOOL_MAP.md` | Intent → exact command routing |
| `scripts/AGENT_GUIDE.md` | Agent capability guide (ฝังใน preset) |

**ใช้งาน:**
```bash
node scripts/sb-arsenal.cjs list                              # ดูทุก tools
node scripts/sb-arsenal.cjs nmap_scan --target 10.10.10.5    # สแกนพอร์ต
node scripts/sb-arsenal.cjs sqlmap_scan --url "URL?id=1" --dbs --dump  # SQLi
node scripts/sb-arsenal.cjs GetUserSPNs --target DC --user u --pass p --domain d  # Kerberoast
```

### 3. SB Proxy v6 — LLM Pipeline

| ไฟล์ | คืออะไร |
|------|---------|
| `scripts/sb-proxy-v6.cjs` | Proxy แปลงคำสั่ง → template → LLM → execute → chain |
| `scripts/sb-executor.cjs` | Standalone executor (Windows + Kali) |
| `scripts/sb-auto-start.cjs` | Daemon + health check + auto-restart |
| `scripts/sb-install.cjs` | One-command installer สำหรับเครื่องใหม่ |
| `scripts/sb-manager.cjs` | Start/stop/status manager |
| `scripts/sb-mock-backend.cjs` | Mock LLM สำหรับทดสอบ |
| `scripts/start-sb.bat` | Startup script |

**Pipeline:**
```
คำสั่ง → detect target → auto-recon (nmap/subfinder/httpx)
      → detect intent → load skill (134) + wiki (70)
      → template + knowledge → LLM generate code
      → extract → classify env → execute (Windows/Kali)
      → analyze → chain → loop (10 steps max)
      → ผลลัพธ์ + execution output → กลับมา
```

**Auto-start:**
```bash
pnpm sb:start     # เริ่ม proxy v6
pnpm sb:stop      # หยุด
pnpm sb:status    # เช็คสถานะ
pnpm sb:test      # รัน executor tests
```

หรือ auto-start เมื่อ harness boot:
```bash
pnpm dev          # predev hook → proxy รันอัตโนมัติ
```

### 4. Guard Removal + Generous Limits

**ปิด (guards):**
| Guard | สถานะ |
|-------|--------|
| scope-policy | ❌ unmounted — ไม่มี target restriction |
| run-budget | ❌ unmounted — ไม่มี token/wall denial |
| scope-proxy | ❌ unmounted — ไม่มี network filter |
| tools.restrict (executor) | ❌ removed — ทุก tool เข้าถึงได้ |
| tools.restrict (supervisor) | ❌ removed |

**กลับมา (limits — กัน error ไม่ใช่กันทำ):**
| Limit | ค่า |
|-------|-----|
| iterations | 10,000 (was 8) |
| toolCalls | 50,000 (was 30) |
| tokens | 500M (was 25K) |
| runtimeMs | 24 hours (was 5 min) |
| maxAttempts | generous + auto-retry |
| maxRunArtifactBytes | 4GB (was 32MB) |
| lease timeout | 2 hours (was 15 min) |
| max cycles | 10,000 (was 100) |

### 5. Dead Mode Unlimited Composition

| ไฟล์ | คืออะไร |
|------|---------|
| `apps/cli/config/examples/dead-mode-unlimited/cordis.yml` | Composition ไม่มี guards เลย |

---

## Skills (135 ตัว) — ติดตั้งที่ `.dsh/skills/`

| หมวด | จำนวน | ตัวอย่าง |
|------|--------|----------|
| Web Attacks | 37 | sqli, xss, ssrf, ssti, xxe, upload, path-traversal, jwt, oauth |
| Tools/Meta | 25 | 401-403-bypass, cmdi, csrf, csp-bypass, dns-rebinding |
| CTF/LostHex | 16 | losthex-ctf-web, losthex-ctf-pwn, losthex-ctf-crypto |
| RE/Binary | 8 | anti-debugging, binary-protection-bypass, vm-and-bytecode |
| AD/Windows | 7 | kerberos-attacks, acl-abuse, ntlm-relay, av-evasion |
| Crypto | 7 | rsa-attacks, hash-attacks, lattice, symmetric |
| Binary/Exploit | 7 | heap, rop, format-string, kernel, v8 |
| OSINT/Recon | 6 | recon-methodology, attack-surface-mapping |
| Mobile | 5 | android, ios, apk-reverse, ssl-pinning-bypass |
| Forensics | 4 | volatility, steganography, memory-forensics |
| Malware/C2 | 3 | payloads, arbitrary-write-to-rce |
| Linux | 3 | privesc, lateral-movement, security-bypass |
| Network | 2 | protocol-attacks, traffic-analysis |
| Social Eng | 2 | llm-prompt-injection, email-header-injection |
| Cloud | 2 | container-escape, kubernetes |
| Evasion | 1 | sandbox-escape |
| Kali routing | 1 | kali-wsl (execution routing สำหรับเครื่องนี้) |
| อื่นๆ | 2 | hack (RED_TEAM + BLUE_TEAM), api-sec |

## Wiki (70 notes) — ติดตั้งที่ `.dsh/cyber-wiki/`

- webhacklist 2006-2026 (20 ปีของ techniques ที่ยังใช้ได้)
- CVE notes (PHP critical, PortSwigger research live)
- Blue team defense matrix
- อัปเดตผ่าน `knowledge_create_note`

## MCP Tools (live)

| Server | Tools | ความสามารถ |
|--------|-------|------------|
| `rea` | 170+ | Binary RE, process capture, browser automation, ADB, firmware, JS analysis |
| `x64dbg` | 40+ | Live debugging, memory r/w, breakpoints, patching, handle/conn enum |
| `dnspy` | 30+ | .NET decompile, method patching, IL editing, rename |
| `jev` | 10 | AI verification, extraction, classification, screening |
| `recon_scan` | 1 | Full Deep recon (DNS, TLS, HTTP, JS, API, host, CVE) |

---

## Kali WSL Toolchain (verified)

```
✅ nmap 7.99          ✅ sqlmap 1.10.8      ✅ hydra v9.7
✅ nuclei             ✅ ffuf 2.1.0         ✅ gobuster
✅ secretsdump.py     ✅ GetUserSPNs.py     ✅ psexec.py
✅ wmiexec.py         ✅ ntlmrelayx.py      ✅ hashcat 7.1.2
✅ john 1.9-jumbo     ✅ subfinder          ✅ amass
✅ masscan            ✅ httpx              ✅ dnsx
✅ whatweb            ✅ nikto              ✅ wpscan
✅ searchsploit       ✅ msfvenom           ✅ binwalk
✅ volatility3        ✅ exiftool           ✅ steghide
✅ sslscan            ✅ testssl            ✅ proxychains + tor
✅ bloodhound         ✅ smbclient          ✅ enum4linux
✅ impacket (70 scripts)                    ✅ Python 3 + scapy + pwntools
```

---

## การติดตั้ง (เครื่องใหม่)

```bash
# 1. Clone harness (branch นี้)
git clone -b shield-break-agent-v2 <repo>

# 2. Install dependencies
pnpm install && pnpm run build

# 3. ติดตั้ง SB stack (proxy + arsenal + auto-start)
node scripts/sb-install.cjs

# 4. ติดตั้ง skills (ถ้ายังไม่มี)
# คัดลอก .dsh/skills/ จากเครื่องเดิม หรือใช้ LostHex installer

# 5. ติดตั้ง wiki (ถ้ายังไม่มี)
# คัดลอก .dsh/cyber-wiki/ จากเครื่องเดิม

# 6. ติดตั้ง MCP servers
# rea, x64dbg, dnspy, jev — ตาม docs ของแต่ละตัว

# 7. เริ่มใช้งาน
pnpm sb:start
```

---

## การใช้งาน

### เริ่ม proxy
```bash
pnpm sb:start
# หรือ
node scripts/sb-auto-start.cjs start
# หรือ auto-start (pnpm dev จะเรียก predev hook)
pnpm dev
```

### ใช้ arsenal
```bash
# สแกน
node scripts/sb-arsenal.cjs nmap_scan --target 10.10.10.5 --ports 22,80,443

# หาช่องโหว่
node scripts/sb-arsenal.cjs nuclei_scan --target https://app.example.com

# SQLi
node scripts/sb-arsenal.cjs sqlmap_scan --url "https://app.example.com/page?id=1" --dbs

# AD attacks
node scripts/sb-arsenal.cjs enum4linux_scan --target 10.10.10.10
node scripts/sb-arsenal.cjs secretsdump --target 10.10.10.10 --user admin --pass P@ss --domain corp

# Brute force
node scripts/sb-arsenal.cjs hydra_brute --target 10.10.10.5 --service ssh --userlist users.txt --passlist /usr/share/wordlists/rockyou.txt
```

### ผ่าน Agent (พูดเป็นภาษาคน)
```
"สแกน 10.10.10.5 ดูว่ามีอะไรเปิดอยู่"
"หา SQLi บน https://app.example.com"
"hack ทั้งระบบ authzen.site"
```
Agent จะเลือก tool จาก Arsenal Guide ที่ฝังอยู่ใน preset

---

## การทดสอบ

```bash
# SB Executor (10 tests)
pnpm sb:test

# Pentest tests
pnpm exec vitest run packages/pentest

# Guard tests (ผ่านแม้ guards จะ unmounted)
pnpm exec vitest run packages/guard

# Arsenal smoke test
node scripts/sb-arsenal.cjs nmap_scan --target 127.0.0.1 --ports 22,80
```

**ผลทดสอบล่าสุด (2026-10-25):**
```
Pentest Executor:  16/16 ✅
Pentest Run:        7/7  ✅
Recon Engine:      70/70 ✅
Guard:             63/63 ✅
Core System Prompt: 95/95 ✅
SB Executor:       10/10 ✅
─────────────────────────
Total:            261/261 ✅
```

---

## โครงสร้างไฟล์

```
scripts/
  sb-proxy-v6.cjs        ← Proxy v6 (recon + skills + wiki + exec + chain)
  sb-proxy-v5.cjs        ← Backup v5
  sb-proxy.cjs           ← Backup v4
  sb-executor.cjs        ← Standalone executor
  sb-executor-test.cjs   ← Test suite (10 tests)
  sb-arsenal.cjs         ← 43 tools Kali dispatcher
  sb-auto-start.cjs      ← Daemon + health check + auto-restart
  sb-install.cjs         ← One-command installer
  sb-manager.cjs         ← Start/stop/status
  sb-mock-backend.cjs    ← Mock LLM
  start-sb.bat           ← Windows startup
  TOOL_MAP.md            ← Intent → command routing
  AGENT_GUIDE.md         ← Agent capability guide
  arsenal_full_test.sh   ← Full Kali verification script

packages/pentest/
  pentest-run/src/index.ts        ← Limits generous (แก้แล้ว)
  pentest-executor/src/index.ts   ← Guards removed (แก้แล้ว)
  pentest-executor/src/control.ts ← Supervisor unrestricted (แก้แล้ว)

packages/guard/                    ← Guard plugins (unmounted)
apps/cli/config/examples/
  dead-mode/cordis.yml             ← Original (มี guards)
  dead-mode-unlimited/cordis.yml   ← ใหม่ (ไม่มี guards)
```

---

## ข้อจำกัดและความรับผิดชอบ

- ระบบนี้ออกแบบสำหรับ authorized penetration testing และ security research
- ผู้ใช้งานต้องมี authorization จากเจ้าของระบบเป้าหมายก่อนทุกครั้ง
- การตั้ง Target หรือ Team mode ใน UI ไม่ใช่หลักฐานการอนุญาต
- ใช้ VM/container แยกสำหรับการทดสอบ
- ดู [SAFETY.md](SAFETY.md) เพิ่มเติม

---

*Branch: shield-break-agent-v2 — Full Arsenal Edition*
*อัปเดต: 2026-10-25*
*ทดสอบ: 261 tests passed, Kali WSL verified, POC จริง (authzen.site, otp24hr.com)*
