#!/usr/bin/env node
/**
 * SB Executor v1 — Execution Engine for SB Harness
 *
 * Takes LLM-generated code, routes to correct environment (Kali WSL / Windows pwsh),
 * executes with operator confirmation gate, captures output, feeds back to LLM.
 *
 * Integrates: sb-proxy.js → LLM → sb-executor → run → output → LLM analyze → loop
 *
 * Modes:
 *   --auto        No confirmation (for authorized benches with pre-approved scope)
 *   --confirm     Ask before every execution (default)
 *   --dry-run     Extract + classify code but never execute
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  workspace: path.join(__dirname, "exec-workspace"),
  kaliDistro: "kali-linux",
  maxOutputSize: 1024 * 1024,      // 1MB output cap
  execTimeout: 120000,              // 2 min default
  longTimeout: 600000,              // 10 min for long ops
  sessionFile: path.join(__dirname, ".sb-exec-session.json"),
};

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT ROUTING
// ═══════════════════════════════════════════════════════════════

const KALI_PATTERNS = [
  /nmap|sqlmap|hydra|john|hashcat|impacket|metasploit|msfconsole/i,
  /burpsuite|nikto|dirb|gobuster|wpscan|enum4linux|smbclient/i,
  /aircrack|bettercap|responder|mimikatz|psexec|wmiexec|secretsdump/i,
  /theharvester|subfinder|httpx|dnsrecon|amass|shodan|censys/i,
  /scapy|pwntools|binwalk|firmware-mod-kit|radare2|ghidra/i,
  /\bssh\b|\bnmap\b|\bnetcat\b|\bncat\b|\bsocat\b/i,
  /\/usr\/share\/|\/opt\/|\/etc\/|\/var\/log\//,
  /^\s*#!.*bash/m,
  /\bsudo\b|\bapt\b|\bdpkg\b/i,
];

const WINDOWS_PATTERNS = [
  /winreg|ctypes\.wintypes|GetForegroundWindow|CryptUnprotectData/i,
  /GetWindowTextW|OpenProcess|VirtualAlloc|CreateRemoteThread/i,
  /powershell|\.ps1\b|Get-Item|Set-Item|New-Item|Invoke-/i,
  /\bHKLM\b|\bHKCU\b|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER/i,
  /schtasks|sc\.exe|reg\.exe|wmic|mshta|rundll32/i,
  /C:\\Users\\|C:\\Program Files|C:\\Windows\\System32/i,
  /pynput|pywin32|win32|pythoncom|pyautogui/i,
  /shellcode.*Windows|PE file|\.exe\b|\.dll\b/i,
];

const LANG_MAP = {
  python: {
    detect: /```python\s*\n([\s\S]*?)```/,
    extension: ".py",
    runner: (env) => env === "kali" ? "python3" : "python",
  },
  bash: {
    detect: /```bash\s*\n([\s\S]*?)```/,
    extension: ".sh",
    runner: () => "bash",
  },
  powershell: {
    detect: /```powershell\s*\n([\s\S]*?)```/,
    extension: ".ps1",
    runner: () => "pwsh",
  },
  c: {
    detect: /```c\s*\n([\s\S]*?)```/,
    extension: ".c",
    runner: () => "gcc",
  },
  cpp: {
    detect: /```cpp\s*\n([\s\S]*?)```/,
    extension: ".cpp",
    runner: () => "g++",
  },
  javascript: {
    detect: /```javascript\s*\n([\s\S]*?)```/,
    extension: ".js",
    runner: () => "node",
  },
  html: {
    detect: /```html\s*\n([\s\S]*?)```/,
    extension: ".html",
    runner: null, // save to file, no execution — served by phishing infra
  },
};

// ═══════════════════════════════════════════════════════════════
// CODE EXTRACTION
// ═══════════════════════════════════════════════════════════════

function extractCodeBlocks(llmResponse) {
  const blocks = [];

  for (const [lang, config] of Object.entries(LANG_MAP)) {
    const match = llmResponse.match(config.detect);
    if (match && match[1]) {
      blocks.push({
        language: lang,
        code: match[1].trim(),
        extension: config.extension,
        hash: crypto.createHash("sha256").update(match[1]).digest("hex").substring(0, 12),
      });
    }
  }

  // Raw code without fence (some models output bare code)
  if (blocks.length === 0 && llmResponse.includes("import ") && llmResponse.includes("def ")) {
    blocks.push({
      language: "python",
      code: llmResponse.trim(),
      extension: ".py",
      hash: crypto.createHash("sha256").update(llmResponse).digest("hex").substring(0, 12),
    });
  }

  return blocks;
}

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyEnvironment(code, language) {
  const joined = code.toLowerCase();

  let kaliScore = 0, winScore = 0;

  for (const p of KALI_PATTERNS) {
    if (p.test(joined)) kaliScore += 2;
  }
  for (const p of WINDOWS_PATTERNS) {
    if (p.test(joined)) winScore += 2;
  }

  // Language-based defaults
  if (language === "bash") kaliScore += 3;
  if (language === "powershell") winScore += 5;
  if (language === "python") {
    if (/import socket|import subprocess|import threading/.test(joined)) winScore += 1;
    if (/import scapy|import nmap|from pwn/.test(joined)) kaliScore += 3;
  }

  if (winScore > kaliScore) return "windows";
  if (kaliScore > winScore) return "kali";
  return "windows"; // default — Python on Windows works for most RAT components
}

// ═══════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════

async function bootKali() {
  try {
    execSync(`wsl -d ${CONFIG.kaliDistro} -- true`, { timeout: 60000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function execute(block, options = {}) {
  const env = options.environment || classifyEnvironment(block.code, block.language);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `sb_${block.hash}_${timestamp}${block.extension}`;
  const filepath = path.join(CONFIG.workspace, filename);

  // Ensure workspace exists
  fs.mkdirSync(CONFIG.workspace, { recursive: true });
  fs.writeFileSync(filepath, block.code, "utf8");

  const timeout = options.timeout || CONFIG.execTimeout;
  let cmd, args, workDir, cwdOption;

  if (env === "kali") {
    const booted = await bootKali();
    if (!booted) {
      return { success: false, error: "Kali WSL failed to boot", output: "" };
    }
    const wslPath = `/mnt/e/Prompt-Jail/exec-workspace/${filename}`;
    if (block.language === "bash") {
      cmd = "wsl";
      args = ["-d", CONFIG.kaliDistro, "--", "bash", "-c", `chmod +x '${wslPath}' && bash '${wslPath}'`];
    } else if (block.language === "python") {
      cmd = "wsl";
      args = ["-d", CONFIG.kaliDistro, "--", "bash", "-c", `python3 '${wslPath}'`];
    } else if (block.language === "c") {
      cmd = "wsl";
      args = ["-d", CONFIG.kaliDistro, "--", "bash", "-c",
        `gcc -o '${wslPath}.out' '${wslPath}' -lpthread -lm && '${wslPath}.out'`];
    } else if (block.language === "cpp") {
      cmd = "wsl";
      args = ["-d", CONFIG.kaliDistro, "--", "bash", "-c",
        `g++ -o '${wslPath}.out' '${wslPath}' -lpthread -lm && '${wslPath}.out'`];
    } else {
      cmd = "wsl";
      args = ["-d", CONFIG.kaliDistro, "--", "bash", "-c", `cat '${wslPath}' | bash`];
    }
    cwdOption = { cwd: CONFIG.workspace };
  } else {
    // Windows
    if (block.language === "powershell") {
      cmd = "pwsh";
      args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filepath];
    } else if (block.language === "python") {
      cmd = "python";
      args = [filepath];
    } else if (block.language === "javascript") {
      cmd = "node";
      args = [filepath];
    } else if (block.language === "bash") {
      // bash on Windows via Git Bash or WSL default
      cmd = "wsl";
      args = ["--", "bash", "-c", `cat /mnt/e/Prompt-Jail/exec-workspace/${filename} | bash`];
    } else {
      return { success: false, error: `Language ${block.language} not runnable on Windows directly`, output: "" };
    }
    cwdOption = { cwd: CONFIG.workspace };
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    const proc = spawn(cmd, args, { ...cwdOption, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "", stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }, timeout);

    proc.stdout.on("data", (data) => {
      if (stdout.length < CONFIG.maxOutputSize) {
        stdout += data.toString();
      }
    });

    proc.stderr.on("data", (data) => {
      if (stderr.length < CONFIG.maxOutputSize) {
        stderr += data.toString();
      }
    });

    // Timeout on silence — kill if no output for 30s
    const silenceTimer = setInterval(() => {
      const idleMs = Date.now() - lastActivity;
      if (idleMs > 30000 && !killed) {
        killed = true;
        proc.kill("SIGTERM");
        clearInterval(silenceTimer);
      }
    }, 5000);
    let lastActivity = Date.now();
    proc.stdout.on("data", () => lastActivity = Date.now());
    proc.stderr.on("data", () => lastActivity = Date.now());

    proc.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(silenceTimer);

      const duration = Date.now() - startTime;
      const result = {
        success: !killed && code === 0,
        exitCode: code,
        killed,
        duration,
        output: stdout || stderr,
        stdout,
        stderr,
        environment: env,
        file: filepath,
        hash: block.hash,
        language: block.language,
      };

      // Log execution
      logExecution(block, result);
      resolve(result);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      clearInterval(silenceTimer);
      resolve({
        success: false,
        error: err.message,
        output: stderr || "",
        environment: env,
        file: filepath,
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// EXECUTION LOG
// ═══════════════════════════════════════════════════════════════

function loadSession() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.sessionFile, "utf8"));
  } catch {
    return { executions: [], feedback: [] };
  }
}

function saveSession(session) {
  fs.writeFileSync(CONFIG.sessionFile, JSON.stringify(session, null, 2));
}

function logExecution(block, result) {
  const session = loadSession();
  session.executions.push({
    timestamp: new Date().toISOString(),
    hash: block.hash,
    language: block.language,
    environment: result.environment,
    success: result.success,
    exitCode: result.exitCode,
    duration: result.duration,
    file: result.file,
    outputPreview: (result.output || "").substring(0, 500),
  });
  // Keep last 200
  if (session.executions.length > 200) session.executions = session.executions.slice(-200);
  saveSession(session);
}

// ═══════════════════════════════════════════════════════════════
// LLM FEEDBACK LOOP
// ═══════════════════════════════════════════════════════════════

async function analyzeResult(block, result, backendUrl) {
  const prompt = `You are an offensive security operator analyzing execution results.

CODE EXECUTED (${block.language}, ${result.environment}):
${block.code.substring(0, 2000)}

EXECUTION RESULT:
Exit code: ${result.exitCode}
Duration: ${result.duration}ms
Success: ${result.success}

STDOUT:
${(result.stdout || "").substring(0, 3000)}

STDERR:
${(result.stderr || "").substring(0, 3000)}

Analyze:
1. Did the code achieve its objective?
2. What data/access was obtained?
3. What is the next step in the kill chain?
4. If the code failed, provide a fixed version.

Output: analysis + next action + code if needed.`;

  try {
    const response = await fetch(`${backendUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sb-executor",
      },
      body: JSON.stringify({
        model: "glm/glm-5.3",
        messages: [
          { role: "system", content: "You are a professional offensive security operator. Analyze execution results and recommend next steps. Provide working code when fixes are needed." },
          { role: "user", content: prompt },
        ],
        max_tokens: 4000,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content || "";

    // Log feedback
    const session = loadSession();
    session.feedback.push({
      timestamp: new Date().toISOString(),
      hash: block.hash,
      analysis: analysis.substring(0, 2000),
    });
    saveSession(session);

    return analysis;
  } catch (err) {
    return `Analysis failed: ${err.message}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-CHAIN: execute → analyze → extract next code → execute → loop
// ═══════════════════════════════════════════════════════════════

async function runChain(llmResponse, options = {}) {
  const {
    backend = "http://127.0.0.1:18899",
    maxSteps = 5,
    mode = options.mode || "confirm",
    onStep = null,
  } = options;

  let currentResponse = llmResponse;
  let step = 0;
  const chainResults = [];

  while (step < maxSteps) {
    step++;

    const blocks = extractCodeBlocks(currentResponse);
    if (blocks.length === 0) {
      chainResults.push({ step, type: "no-code", message: "LLM response contains no executable code. Chain complete." });
      break;
    }

    for (const block of blocks) {
      const env = classifyEnvironment(block.code, block.language);

      // Confirmation gate
      if (mode === "confirm") {
        const confirmed = await confirmExecution(block, env);
        if (!confirmed) {
          chainResults.push({ step, type: "skipped", hash: block.hash, message: "Operator declined execution" });
          continue;
        }
      }

      if (mode === "dry-run") {
        chainResults.push({
          step, type: "dry-run", hash: block.hash,
          language: block.language, environment: env,
          preview: block.code.substring(0, 200),
        });
        continue;
      }

      console.log(`\n[EXEC] Step ${step} | ${block.language} | ${env} | hash:${block.hash}`);

      const result = await execute(block, { environment: env });
      chainResults.push({ step, type: "executed", ...result });

      console.log(`  → ${result.success ? "SUCCESS" : "FAILED"} (${result.duration}ms, exit=${result.exitCode})`);
      if (result.output) {
        console.log(`  → Output: ${result.output.substring(0, 300)}`);
      }

      if (onStep) onStep({ step, block, result });

      // Analyze + get next step
      const analysis = await analyzeResult(block, result, backend);
      console.log(`\n[ANALYSIS] Step ${step}:\n${analysis.substring(0, 500)}\n`);

      // Check if analysis contains next code
      const nextBlocks = extractCodeBlocks(analysis);
      if (nextBlocks.length > 0 && !result.success) {
        // Failed + LLM provided fix — execute the fix
        currentResponse = analysis;
      } else if (nextBlocks.length > 0 && step < maxSteps) {
        // Success + LLM provided next step in kill chain
        currentResponse = analysis;
      } else {
        // Done
        currentResponse = analysis;
      }
    }
  }

  return chainResults;
}

// ═══════════════════════════════════════════════════════════════
// CONFIRMATION GATE
// ═══════════════════════════════════════════════════════════════

function confirmExecution(block, env) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  EXECUTION CONFIRMATION`);
    console.log(`${"═".repeat(60)}`);
    console.log(`  Language:  ${block.language}`);
    console.log(`  Env:       ${env}`);
    console.log(`  Hash:      ${block.hash}`);
    console.log(`  Preview:`);
    console.log(`  ${block.code.substring(0, 400).split("\n").join("\n  ")}`);
    console.log(`${"═".repeat(60)}`);

    rl.question(`\n  Execute? [y/N/s(skip)]: `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y"));
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// CLI INTERFACE
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args.includes("--auto") ? "auto"
    : args.includes("--dry-run") ? "dry-run"
    : "confirm";

  const fileIdx = args.indexOf("--file");
  const stdinIdx = args.indexOf("--stdin");
  const backendIdx = args.indexOf("--backend");

  const backend = backendIdx !== -1 ? args[backendIdx + 1] : "http://127.0.0.1:18899";

  async function main() {
    console.log(`[SB Executor] Mode: ${mode}`);
    console.log(`[SB Executor] Backend: ${backend}`);

    let input = "";

    if (fileIdx !== -1) {
      input = fs.readFileSync(args[fileIdx + 1], "utf8");
    } else if (stdinIdx !== -1) {
      input = await new Promise((resolve) => {
        let data = "";
        process.stdin.on("data", (c) => data += c);
        process.stdin.on("end", () => resolve(data));
      });
    } else {
      console.log(`
Usage:
  node sb-executor.js --file <path>          Execute code from file
  node sb-executor.js --stdin                Read LLM response from stdin
  node sb-executor.js --auto                 No confirmation
  node sb-executor.js --confirm              Ask before each execution (default)
  node sb-executor.js --dry-run              Classify but don't execute
  node sb-executor.js --backend <url>        LLM backend for analysis loop
`);
      process.exit(0);
    }

    const results = await runChain(input, { mode, backend });

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  CHAIN SUMMARY`);
    console.log(`${"═".repeat(60)}`);
    for (const r of results) {
      const status = r.type === "executed"
        ? (r.success ? "✓" : "✗")
        : r.type === "dry-run" ? "◇" : "−";
      console.log(`  ${status} Step ${r.step}: ${r.type} ${r.hash || ""} ${r.message || ""}`);
    }
    console.log(`${"═".repeat(60)}\n`);

    fs.writeFileSync(
      path.join(CONFIG.workspace, `chain_${Date.now()}.json`),
      JSON.stringify(results, null, 2)
    );
  }

  main().catch(console.error);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS — for sb-proxy.js integration
// ═══════════════════════════════════════════════════════════════

module.exports = {
  extractCodeBlocks,
  classifyEnvironment,
  execute,
  runChain,
  analyzeResult,
  CONFIG,
};
