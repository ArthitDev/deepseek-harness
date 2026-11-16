# SB Harness Deploy — Strict Routing, SSE Enrichment และ Harvest บน Server

**วันที่:** 2026-11-16
**สถานะ:** เสร็จสมบูรณ์ — ทุกหัวข้อยืนยัน live ทั้งสองฝั่ง (Windows + Server)
**สาย commit:** `77013c5e5b` → `05da8b0ea` → `f3efe4acc` → `5008caab2` → `5e022ba3f` → `93bd5045e` → `83c074fe9` → `6af6e6d11` → `98da2ce4e` → `5239ce74c` → `019b2eb4d` → `ef06f1531`

---

## 1. งานหลักที่ทำวันนี้

| งาน | commit | ผล |
|---|---|---|
| v6 pipeline เข้า git (harvest suite + merged transport + rollback copy) | `77013c5e5b` | deploy Server ผ่าน compose mount |
| strict routing — `routeAllModels` บล็อกก่อน dispatch เมื่อ SB ล่ม | `6af6e6d11` | เจอ WIP ครบใน deployed checkout — tests 58/58 ผ่าน |
| `localAgentPolicy: parent` mode + enforcement | `6af6e6d11` | spawn ไม่ตรง policy = deny (ทดสอบจริง) |
| policy เปิดจริงทั้งสองฝั่ง | — | Server `/var/lib/dsh-harness/.dsh/cordis.patch.yml` + Windows `~\.dsh\cordis.patch.yml` (backup `.bak-20261116` คู่) |
| docker kali exec adapter ใน v6 | `cbaedd3acb` | execDocker ผ่าน broker socket (create → hijack start Tty → inspect exit) + Env PATH |
| httpx positional URL (แก้ timeout ทุกรอบ) | `83c074fe9` | recon + direct-call ใช้ positional ตาม syntax จริงของ pd httpx |
| ตัวปรับคำครอบคลุม SSE | `93bd5045e` | processBody ทำงานทุกคำขอ chat — stream pipe SSE กลับ, direct-tool บน stream ตอบ chunk ถูก protocol |
| skipDomains → env `SB_SKIP_DOMAINS` | `019b2eb4d` | ค่าว่าง `""` fallback default — ปิดกรองใช้ `,` |
| tunables ครบ env 12 ตัว | `5239ce74c` | ไม่มี hardcode เหลือใน v6/transport |
| auto-start daemon spawn ตัวถูก | `98da2ce4e` | เดิมยิง v6 standalone (ไม่มี /health และ CONNECT) — แก้เป็น `sb-transport.cjs serve` |
| boot hooks | `ef06f1531` | `predev`/`prestart` + `sb:start/stop/status` ใน package.json (deployment fork) |

## 2. การ deploy บน Server

- compose `~/stacks/harness-vpn` service `sb`: mount `sb-proxy-v6.cjs` ro + broker socket + `exec-workspace` rw + skills/wiki ro + `.credentials.yaml` ro · env `SB_DOCKER_SOCKET`/`SB_KALI_CONTAINER=dsh-vpn-kali`/`SB_KALI_WORKSPACE`/`SB_EXEC_WORKSPACE`/`SB_TIMEOUT_MS=300000` (ไม่มี `SB_EXEC_MODE` = auto)
- backups: `compose.yaml.before-sb-v6-20261116`, `compose.yaml.before-sb-docker-exec`
- web รัน strict build — restart ผ่าน `dsh-vpn-web.service`
- systemd `dsh-vpn-proxies.service` (enabled) = auto-start ตอน boot

## 3. Harvest บน Server (container Kali)

- tools ถาวรใต้ bind `/root` ↔ `state/kali-root`: subfinder, gau (`go install` → `/root/go/bin`), theHarvester (`uv tool install git+…` → `/root/.local/bin`)
- ทดสอบผ่าน SB จริง 3/3: subdomain (subfinder → 5 subdomains ✓) · url (gau+CDX ✓) · email (theHarvester ✓) — ทั้งหมด `kali-direct` Success + recon context
- แก้ระหว่างทาง: `url_harvest` รองรับ `getallurls` (Windows) / `gau` (Server) · direct timeout 45s→120s (subfinder ใช้จริง ~55s)

## 4. ผลทดสอบ live สำคัญ

- **strict**: หยุด SB → คำขอถูกบล็อก `proxy-server/start-failed` ไม่มี direct dispatch → เปิดคืน = ปกติ
- **production web**: session ผ่าน API (preset `all-model-preset`) → main ยิงผ่าน SB CONNECT (เห็น connection) → subagent `SB-ROUTE-OK` → **sub-of-sub `SB-NESTED-OK`** — preset เดียวกัน + SB เดียวกันทุกระดับ
- **ตัวปรับคำ**: non-stream + stream ฉีด OPERATOR/SKILL/WIKI ครบ (log ยืนยัน)
- **Windows exec**: wsl path regression ผ่านหลัง respawn ทุกครั้ง
- **auto-start Windows**: kill transport 08:59:25 → daemon ปลุก 09:00:05 (v6-pipeline + supportsConnect)

## 5. ค้างและข้อจำกัดที่รู้ตัว

1. **Windows TUI restart หนึ่งครั้ง** (ทำเอง) — เปิด strict+policy ใน harness process ฝั่ง Windows
2. waybackurls บน container ติด network จาก egress นั้น — gau+CDX ชดเชย
3. `tech_fingerprint`/`vuln_scan` ไม่มี keyword ใน DETECT table — direct ยิงผ่านข้อความไม่ได้ (feature gap)
4. 429 concurrency ของ 9router เมื่อ session หลักยิงหนัก — key เดียวร่วมกัน
5. session ทดสอบใน web UI 3 อัน (`1e9d5736`, `0d84fd96`, `7fd12f07`) — ลบได้จาก UI
6. ชุดเก่า `dsh-sb`/`dsh-zcode`/`dsh-antigravity` หยุดไว้ rollback ได้ (`compose start` ที่ `~/stacks/harness-proxies`) — ลบเมื่อสั่ง
7. `skipDomains` ยัง substring-match — exact-match ทำได้ถ้าต้องการ

## 6. env ทั้งหมด (23 ตัว — default เดิม ไม่ตั้ง = พฤติกรรมเดิม)

โครงสร้าง `SB_PORT` `SB_BACKEND` `SB_BACKEND_KEY` `SB_CREDENTIALS_FILE` `SB_EXEC_MODE` · เส้นทาง `SB_EXEC_WORKSPACE` `SB_KALI_WORKSPACE` `SB_SKILLS_DIR` `SB_WIKI_DIR` `SB_KALI_DISTRO` · Docker `SB_DOCKER_SOCKET` `SB_KALI_CONTAINER` · เวลา/ขนาด `SB_TIMEOUT_MS` `SB_EXEC_TIMEOUT` `SB_RECON_TIMEOUT` `SB_HTTPX_TIMEOUT` `SB_DIRECT_TIMEOUT` `SB_TOOL_TIMEOUT` `SB_BOOT_TIMEOUT` `SB_MAX_OUTPUT_SIZE` `SB_CHAIN_STEPS` · พฤติกรรม `SB_MODEL` `SB_SKIP_DOMAINS`

---

**สถานะปลายทาง:** harness สองฝั่งเข้าโหมดเดียวกันหมด (นับจาก TUI restart ฝั่ง Windows) — main/sub/sub-of-sub ใช้ preset เดียว + SB pipeline เดียว ไม่มี fallback · Kali สองแบบทำงาน · auto-start เฝ้าตัวเอง · เอกสารจริงอยู่ที่ `E:\Cybersecure-Pentest\SERVER-STATE.md`
