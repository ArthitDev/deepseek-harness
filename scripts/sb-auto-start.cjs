#!/usr/bin/env node
/**
 * SB Auto-Start Daemon — keeps SB Proxy v6 alive automatically.
 *
 * Features:
 *   - Auto-detect environment (skills, wiki, Kali WSL, backend)
 *   - Start proxy on harness boot
 *   - Health check every 30s, restart if dead
 *   - Graceful shutdown when harness stops
 *   - Zero configuration on new machines
 *
 * Usage:
 *   node scripts/sb-auto-start.cjs start     — start daemon + proxy
 *   node scripts/sb-auto-start.cjs stop      — stop everything
 *   node scripts/sb-auto-start.cjs status    — check health
 *   node scripts/sb-auto-start.cjs install   — install as harness boot hook
 *
 * Or require as module:
 *   const { startDaemon, stopDaemon } = require('./sb-auto-start.cjs')
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");

// ═══════════════════════════════════════════════════════════════
// AUTO-DETECT ENVIRONMENT
// ═══════════════════════════════════════════════════════════════

function detectEnvironment() {
  const env = {
    platform: os.platform(),
    homeDir: os.homedir(),
    harnessRoot: null,
    scriptsDir: null,
    proxyScript: null,
    skillsDir: null,
    wikiDir: null,
    workspaceDir: null,
    backendUrl: null,
    port: parseInt(process.env.SB_PORT || "18899"),
    execMode: process.env.SB_EXEC_MODE || "auto",
    kaliAvailable: false,
    nodeAvailable: true,
  };

  // Detect harness root (walk up from this script)
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))
      && fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      env.harnessRoot = dir;
      break;
    }
    dir = path.dirname(dir);
  }

  // Detect scripts dir and proxy
  const possibleScriptDirs = [
    __dirname,
    env.harnessRoot ? path.join(env.harnessRoot, "scripts") : null,
    process.cwd(),
  ].filter(Boolean);

  for (const sd of possibleScriptDirs) {
    const v6 = path.join(sd, "sb-proxy-v6.cjs");
    const v6js = path.join(sd, "sb-proxy-v6.js");
    if (fs.existsSync(v6)) { env.proxyScript = v6; env.scriptsDir = sd; break; }
    if (fs.existsSync(v6js)) { env.proxyScript = v6js; env.scriptsDir = sd; break; }
  }

  // Detect skills directory
  const skillPaths = [
    path.join(env.homeDir, ".dsh", "skills"),
    path.join(env.homeDir, ".agent-rules", "skills"),
    process.env.SB_SKILLS_DIR,
  ].filter(Boolean);
  for (const sp of skillPaths) {
    if (fs.existsSync(sp)) { env.skillsDir = sp; break; }
  }

  // Detect wiki directory
  const wikiPaths = [
    path.join(env.homeDir, ".dsh", "cyber-wiki"),
    path.join(env.homeDir, ".dsh", "knowledge"),
    process.env.SB_WIKI_DIR,
  ].filter(Boolean);
  for (const wp of wikiPaths) {
    if (fs.existsSync(wp)) { env.wikiDir = wp; break; }
  }

  // Detect workspace
  env.workspaceDir = process.env.SB_WORKSPACE
    || path.join(env.scriptsDir || process.cwd(), "exec-workspace");

  // Detect backend (try common ports)
  env.backendUrl = process.env.SB_BACKEND || "http://127.0.0.1:20128";

  // Detect Kali WSL
  if (env.platform === "win32") {
    try {
      execSync("wsl -d kali-linux -- true", { timeout: 5000, stdio: "pipe", windowsHide: true });
      env.kaliAvailable = true;
    } catch {
      env.kaliAvailable = false;
    }
  } else if (env.platform === "linux") {
    // On Linux, check if nmap/sqlmap are directly available
    try {
      execSync("which nmap", { timeout: 3000, stdio: "pipe", windowsHide: true });
      env.kaliAvailable = true; // tools available natively
    } catch {
      env.kaliAvailable = false;
    }
  }

  return env;
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

// Also try the proxy root endpoint (v6 doesn't have /health but responds on port)
function checkPortAlive(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, { timeout: 2000 }, () => resolve(true));
    req.on("error", (e) => resolve(e.code !== "ECONNREFUSED"));
    req.on("timeout", () => { req.destroy(); resolve(true); }); // timeout = process alive but slow
  });
}

// ═══════════════════════════════════════════════════════════════
// DAEMON
// ═══════════════════════════════════════════════════════════════

const DAEMON_PID_FILE = path.join(os.tmpdir(), "sb-auto-daemon.pid");
const PROXY_PID_FILE = path.join(os.tmpdir(), "sb-proxy.pid");

let daemonRunning = false;
let proxyProcess = null;
let healthInterval = null;

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getPersistedPid(file) {
  try { return parseInt(fs.readFileSync(file, "utf8").trim()); } catch { return null; }
}

// Resolve the API key for a backend URL from the dsh credential store so the
// proxy can authenticate upstream regardless of which client key arrives.
function resolveBackendKey(backendUrl) {
  if (!backendUrl) return null;
  const b = backendUrl.toLowerCase();
  let credName = null;
  if (b.includes("z.ai")) credName = "ZAI_API_KEY";
  else if (b.includes("deepseek.com")) credName = "DEEPSEEK_API_KEY";
  else if (b.includes(":20128")) credName = "NINE_ROUTER_GLM_DEEPSEEK_API_KEY";
  if (!credName) return null;
  try {
    const yaml = fs.readFileSync(path.join(os.homedir(), ".dsh", ".credentials.yaml"), "utf8");
    const m = yaml.match(new RegExp(credName + ":\\s*(\\S+)"));
    return m ? m[1] : null;
  } catch { return null; }
}

async function startProxy(env, silent = false) {
  if (!env.proxyScript) {
    if (!silent) console.error("[SB Auto] No proxy script found");
    return false;
  }

  // Check if already running
  const alive = await checkPortAlive(env.port);
  if (alive) {
    if (!silent) console.log(`[SB Auto] Proxy already running on :${env.port}`);
    return true;
  }

  const args = [
    env.proxyScript,
    "--port", String(env.port),
    "--backend", env.backendUrl,
    "--exec", env.execMode,
  ];

  const backendKey = resolveBackendKey(env.backendUrl);
  proxyProcess = spawn("node", args, {
    stdio: "ignore",
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      SB_SKILLS_DIR: env.skillsDir || "",
      SB_WIKI_DIR: env.wikiDir || "",
      SB_WORKSPACE: env.workspaceDir || "",
      ...(backendKey ? { SB_BACKEND_KEY: backendKey } : {}),
    },
  });

  proxyProcess.unref();

  if (proxyProcess.pid) {
    fs.writeFileSync(PROXY_PID_FILE, String(proxyProcess.pid));
  }

  // Wait for proxy to come up (max 10s)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const ok = await checkPortAlive(env.port);
    if (ok) {
      if (!silent) console.log(`[SB Auto] Proxy started on :${env.port} (PID ${proxyProcess.pid})`);
      return true;
    }
  }

  if (!silent) console.error("[SB Auto] Proxy failed to start within 10s");
  return false;
}

function stopProxy() {
  const pid = getPersistedPid(PROXY_PID_FILE);
  if (pid && isProcessAlive(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch { }
  }
  if (proxyProcess && proxyProcess.pid) {
    try { process.kill(proxyProcess.pid, "SIGTERM"); } catch { }
  }
  try { fs.unlinkSync(PROXY_PID_FILE); } catch { }
}

async function startDaemon(options = {}) {
  const silent = options.silent || false;
  const env = detectEnvironment();

  if (!silent) console.log("[SB Auto] Environment:");
  if (!silent) console.log(`  Platform:     ${env.platform}`);
  if (!silent) console.log(`  Harness root: ${env.harnessRoot || "not detected"}`);
  if (!silent) console.log(`  Proxy script: ${env.proxyScript || "NOT FOUND"}`);
  if (!silent) console.log(`  Skills dir:   ${env.skillsDir || "not found"}`);
  if (!silent) console.log(`  Wiki dir:     ${env.wikiDir || "not found"}`);
  if (!silent) console.log(`  Kali WSL:     ${env.kaliAvailable ? "✓ available" : "✗ not available"}`);
  if (!silent) console.log(`  Backend:      ${env.backendUrl}`);
  if (!silent) console.log(`  Port:         ${env.port}`);
  if (!silent) console.log(`  Exec mode:    ${env.execMode}`);

  if (!env.proxyScript) {
    console.error("[SB Auto] ERROR: sb-proxy-v6.cjs not found");
    console.error("[SB Auto] Place it in scripts/ or set SB_PROXY_SCRIPT env var");
    process.exit(1);
  }

  // Create workspace
  if (env.workspaceDir) {
    fs.mkdirSync(env.workspaceDir, { recursive: true });
  }

  // Start proxy
  const started = await startProxy(env);
  if (!started) process.exit(1);

  // Health check loop
  daemonRunning = true;
  const checkInterval = parseInt(process.env.SB_HEALTH_INTERVAL || "30000"); // 30s default

  healthInterval = setInterval(async () => {
    if (!daemonRunning) return;
    const alive = await checkPortAlive(env.port);
    if (!alive) {
      console.log("[SB Auto] Proxy died — restarting...");
      await startProxy(env, true);
    }
  }, checkInterval);

  // Graceful shutdown
  const shutdown = () => {
    console.log("[SB Auto] Shutting down...");
    daemonRunning = false;
    if (healthInterval) clearInterval(healthInterval);
    stopProxy();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", shutdown);

  // Write daemon PID
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid));

  console.log(`[SB Auto] Daemon running (PID ${process.pid})`);
  console.log(`[SB Auto] Health check every ${checkInterval / 1000}s`);
  console.log("[SB Auto] Press Ctrl+C to stop");

  // Keep alive
  if (!options.returnPromise) {
    setInterval(() => { }, 1000);
  }
}

function stopDaemon() {
  // Stop daemon
  const daemonPid = getPersistedPid(DAEMON_PID_FILE);
  if (daemonPid && isProcessAlive(daemonPid)) {
    try { process.kill(daemonPid, "SIGTERM"); } catch { }
    console.log(`[SB Auto] Daemon stopped (PID ${daemonPid})`);
  } else {
    console.log("[SB Auto] Daemon not running");
  }

  // Stop proxy
  const proxyPid = getPersistedPid(PROXY_PID_FILE);
  if (proxyPid && isProcessAlive(proxyPid)) {
    try { process.kill(proxyPid, "SIGTERM"); } catch { }
    console.log(`[SB Auto] Proxy stopped (PID ${proxyPid})`);
  }

  try { fs.unlinkSync(DAEMON_PID_FILE); } catch { }
  try { fs.unlinkSync(PROXY_PID_FILE); } catch { }
}

async function status() {
  const env = detectEnvironment();
  const proxyAlive = await checkPortAlive(env.port);
  const daemonPid = getPersistedPid(DAEMON_PID_FILE);
  const daemonAlive = daemonPid ? isProcessAlive(daemonPid) : false;

  console.log("═".repeat(50));
  console.log("  SB Auto-Start Status");
  console.log("═".repeat(50));
  console.log(`  Proxy:   ${proxyAlive ? "✓ running" : "✗ stopped"} (port ${env.port})`);
  console.log(`  Daemon:  ${daemonAlive ? `✓ running (PID ${daemonPid})` : "✗ stopped"}`);
  console.log(`  Skills:  ${env.skillsDir ? "✓ " + env.skillsDir : "✗ not found"}`);
  console.log(`  Wiki:    ${env.wikiDir ? "✓ " + env.wikiDir : "✗ not found"}`);
  console.log(`  Kali:    ${env.kaliAvailable ? "✓ available" : "✗ not available"}`);
  console.log(`  Backend: ${env.backendUrl}`);
  console.log("═".repeat(50));
}

// ═══════════════════════════════════════════════════════════════
// INSTALL — set up auto-start on new machines
// ═══════════════════════════════════════════════════════════════

async function install() {
  const env = detectEnvironment();

  console.log("═".repeat(50));
  console.log("  SB Auto-Start Installer");
  console.log("═".repeat(50));

  // 1. Verify proxy script exists
  if (!env.proxyScript) {
    console.error("  ✗ sb-proxy-v6.cjs not found");
    process.exit(1);
  }
  console.log(`  ✓ Proxy: ${env.proxyScript}`);

  // 2. Check/create workspace
  if (env.workspaceDir) {
    fs.mkdirSync(env.workspaceDir, { recursive: true });
    console.log(`  ✓ Workspace: ${env.workspaceDir}`);
  }

  // 3. Check skills
  if (env.skillsDir) {
    const skillCount = fs.readdirSync(env.skillsDir).filter(d =>
      fs.existsSync(path.join(env.skillsDir, d, "SKILL.md"))
    ).length;
    console.log(`  ✓ Skills: ${env.skillsDir} (${skillCount} skills)`);
  } else {
    console.log("  ⚠ Skills dir not found — skill routing disabled");
  }

  // 4. Check wiki
  if (env.wikiDir) {
    const wikiCount = fs.readdirSync(env.wikiDir, { recursive: true }).filter(f =>
      String(f).endsWith(".md")
    ).length;
    console.log(`  ✓ Wiki: ${env.wikiDir} (${wikiCount} notes)`);
  } else {
    console.log("  ⚠ Wiki dir not found — wiki reference disabled");
  }

  // 5. Check Kali
  if (env.kaliAvailable) {
    console.log(`  ✓ Kali: available (${env.platform === "win32" ? "WSL" : "native"})`);
  } else {
    console.log("  ⚠ Kali not available — recon and direct-call disabled");
  }

  // 6. Check backend
  const backendOk = await new Promise((resolve) => {
    const u = new URL(env.backendUrl);
    const req = http.get({ hostname: u.hostname, port: u.port, path: "/", timeout: 3000 }, () => resolve(true));
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
  console.log(`  ${backendOk ? "✓" : "⚠"} Backend: ${env.backendUrl} ${backendOk ? "" : "(not reachable — will start anyway)"}`);

  // 7. Add pre-start hook to package.json if harness root found
  if (env.harnessRoot) {
    const pkgPath = path.join(env.harnessRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      let pkgContent = fs.readFileSync(pkgPath, "utf8");
      let pkg;
      try { pkg = JSON.parse(pkgContent); } catch { pkg = null; }

      if (pkg && pkg.scripts) {
        // Add pre-dev and pre-start hooks if not present
        const autoScript = "node scripts/sb-auto-start.cjs start --background";
        if (!pkg.scripts["predev"]) {
          pkg.scripts["predev"] = autoScript;
          console.log("  ✓ Added predev hook");
        }
        if (!pkg.scripts["prestart"]) {
          pkg.scripts["prestart"] = autoScript;
          console.log("  ✓ Added prestart hook");
        }

        // Ensure sb:* scripts exist
        if (!pkg.scripts["sb:start"]) pkg.scripts["sb:start"] = "node scripts/sb-auto-start.cjs start";
        if (!pkg.scripts["sb:stop"]) pkg.scripts["sb:stop"] = "node scripts/sb-auto-start.cjs stop";
        if (!pkg.scripts["sb:status"]) pkg.scripts["sb:status"] = "node scripts/sb-auto-start.cjs status";

        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
        console.log("  ✓ package.json updated with sb:* scripts + hooks");
      }
    }
  } else {
    console.log("  ⚠ Harness root not detected — add manually to package.json");
  }

  // 8. Windows Task Scheduler (optional)
  if (env.platform === "win32" && process.env.SB_INSTALL_TASK === "1") {
    try {
      const scriptPath = path.resolve(__filename);
      execSync(
        `schtasks /create /tn "SB-AutoStart" /tr "node ${scriptPath} start --background" /sc onlogon /rl limited /f`,
        { stdio: "pipe", windowsHide: true }
      );
      console.log("  ✓ Windows Task Scheduler: SB-AutoStart on logon");
    } catch {
      console.log("  ⚠ Task Scheduler setup failed (need admin or SB_INSTALL_TASK=1)");
    }
  }

  console.log("═".repeat(50));
  console.log("  Install complete!");
  console.log("");
  console.log("  Quick start:");
  console.log("    node scripts/sb-auto-start.cjs start");
  console.log("    pnpm sb:status");
  console.log("");
  console.log("  Auto-start on harness boot:");
  console.log("    pnpm dev  (triggers predev hook → proxy auto-starts)");
  console.log("═".repeat(50));
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const command = process.argv[2] || "status";
  const background = process.argv.includes("--background");

  switch (command) {
    case "start":
      if (background) {
        // Spawn detached daemon
        const scriptPath = __filename;
        const proc = spawn("node", [scriptPath, "start"], { windowsHide: true,
          stdio: "ignore",
          detached: true,
        });
        proc.unref();
        console.log(`[SB Auto] Daemon spawned (PID ${proc.pid})`);
        setTimeout(() => process.exit(0), 1000);
      } else {
        startDaemon().catch(console.error);
      }
      break;

    case "stop":
      stopDaemon();
      break;

    case "status":
      status();
      break;

    case "install":
      install();
      break;

    case "restart":
      stopDaemon();
      setTimeout(() => {
        if (background) {
          const proc = spawn("node", [__filename, "start"], { stdio: "ignore", detached: true, windowsHide: true });
          proc.unref();
          setTimeout(() => process.exit(0), 1000);
        } else {
          startDaemon().catch(console.error);
        }
      }, 2000);
      break;

    default:
      console.log(`
SB Auto-Start Daemon

Usage:
  node sb-auto-start.cjs start          Start daemon + proxy (foreground)
  node sb-auto-start.cjs start --bg     Start daemon in background
  node sb-auto-start.cjs stop           Stop everything
  node sb-auto-start.cjs status         Check health
  node sb-auto-start.cjs restart        Restart
  node sb-auto-start.cjs install        Install auto-start hooks

Environment variables:
  SB_PORT=18899                         Proxy port
  SB_BACKEND=http://127.0.0.1:20128    Backend URL
  SB_EXEC_MODE=auto                     Execution mode (auto|confirm|dry-run|off)
  SB_SKILLS_DIR=/path/to/skills         Override skills directory
  SB_WIKI_DIR=/path/to/wiki             Override wiki directory
  SB_HEALTH_INTERVAL=30000              Health check interval (ms)
  SB_INSTALL_TASK=1                     Also install Task Scheduler (Windows)
`);
      break;
  }
}

// Export for module use
module.exports = { startDaemon, stopDaemon, status, install, detectEnvironment, startProxy, checkPortAlive };
