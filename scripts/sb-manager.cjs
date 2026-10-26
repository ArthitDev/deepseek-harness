#!/usr/bin/env node
/**
 * SB Proxy Manager v5 — start/stop/status for proxy v4 or v5
 * Usage:
 *   node sb-manager.js start [--v5] [--exec auto|confirm|dry-run|off] [--backend url]
 *   node sb-manager.js stop
 *   node sb-manager.js status
 *   node sb-manager.js restart [--v5]
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PID_FILE = path.join(__dirname, ".sb-proxy.pid");
const PROXY_V4 = path.join(__dirname, "sb-proxy.cjs");
const PROXY_V5 = path.join(__dirname, "sb-proxy-v5.cjs");
const PROXY_V6 = path.join(__dirname, "sb-proxy-v6.cjs");
const PORT = 18899;

// Resolve the API key for a backend URL from the dsh credential store so the
// proxy can authenticate upstream regardless of which client key arrives.
function resolveBackendKey(backend) {
  if (!backend) return null;
  const b = backend.toLowerCase();
  let credName = null;
  if (b.includes("z.ai")) credName = "ZAI_API_KEY";
  else if (b.includes("deepseek.com")) credName = "DEEPSEEK_API_KEY";
  else if (b.includes(":20128")) credName = "NINE_ROUTER_GLM_DEEPSEEK_API_KEY";
  if (!credName) return null;
  try {
    const os = require("os");
    const yaml = fs.readFileSync(path.join(os.homedir(), ".dsh", ".credentials.yaml"), "utf8");
    const m = yaml.match(new RegExp(credName + ":\\s*(\\S+)"));
    return m ? m[1] : null;
  } catch { return null; }
}

function isRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getPid() {
  try { return parseInt(fs.readFileSync(PID_FILE, "utf8").trim()); } catch { return null; }
}

const ARGS_FILE = path.join(__dirname, ".sb-proxy.args.json");

function loadSavedArgs() {
  try { return JSON.parse(fs.readFileSync(ARGS_FILE, "utf8")); } catch { return {}; }
}

function start() {
  const existingPid = getPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`[SB Manager] Already running (PID ${existingPid})`);
    return;
  }

  if (existingPid) fs.unlinkSync(PID_FILE);

  // Parse args; fall back to the last explicitly started configuration
  const saved = loadSavedArgs();
  const hasFlags = process.argv.includes("--v6") || process.argv.includes("--v5")
    || process.argv.includes("--exec") || process.argv.includes("--backend");
  const argv = hasFlags ? process.argv : ["node", "sb-manager", "start",
    ...(saved.useV6 ? ["--v6"] : []), ...(saved.execMode ? ["--exec", saved.execMode] : []),
    ...(saved.backend ? ["--backend", saved.backend] : [])];

  const useV6 = argv.includes("--v6");
  const useV5 = argv.includes("--v5");
  const execIdx = argv.indexOf("--exec");
  const execMode = execIdx !== -1 ? argv[execIdx + 1] : null;
  const backendIdx = argv.indexOf("--backend");
  const backend = backendIdx !== -1 ? argv[backendIdx + 1] : "http://127.0.0.1:20128";

  const script = useV6 ? PROXY_V6 : useV5 || execMode ? PROXY_V5 : PROXY_V4;
  const args = ["--port", String(PORT), "--backend", backend];

  if (execMode) args.push("--exec", execMode);

  const backendKey = resolveBackendKey(backend);
  const proc = spawn("node", [script, ...args], {
    stdio: "ignore",
    detached: true,
    windowsHide: true,
    env: backendKey ? { ...process.env, SB_BACKEND_KEY: backendKey } : process.env,
  });

  proc.unref();
  fs.writeFileSync(PID_FILE, String(proc.pid));
  fs.writeFileSync(ARGS_FILE, JSON.stringify({ useV6, useV5, execMode, backend }, null, 2));

  const version = script === PROXY_V6 ? "v6" : script === PROXY_V5 ? "v5" : "v4";
  console.log(`[SB Manager] Started ${version} (PID ${proc.pid})`);
  console.log(`[SB Manager] Port: ${PORT}`);
  console.log(`[SB Manager] Backend: ${backend}`);
  if (execMode) console.log(`[SB Manager] Exec: ${execMode}`);

  setTimeout(() => {
    if (isRunning(proc.pid)) {
      console.log(`[SB Manager] Proxy ${version} running`);
    } else {
      console.log("[SB Manager] Proxy failed to start");
      fs.unlinkSync(PID_FILE);
    }
  }, 2000);
}

function stop() {
  const pid = getPid();
  if (!pid) { console.log("[SB Manager] Not running"); return; }
  if (isRunning(pid)) {
    process.kill(pid, "SIGTERM");
    console.log(`[SB Manager] Stopped (PID ${pid})`);
  } else {
    console.log("[SB Manager] Process not found, cleaning up");
  }
  fs.unlinkSync(PID_FILE);
}

function status() {
  const pid = getPid();
  if (pid && isRunning(pid)) {
    console.log(`[SB Manager] Running (PID ${pid}) on port ${PORT}`);
    // Try to detect version
    try {
      const cmdline = execSync(`wmic process where processid=${pid} get commandline`, { encoding: "utf8", windowsHide: true });
      const isV6 = cmdline.includes("v6");
      const isV5 = cmdline.includes("v5");
      console.log(`[SB Manager] Version: ${isV6 ? "v6 (gen+exec+chain)" : isV5 ? "v5 (gen+exec)" : "v4 (gen only)"}`);
    } catch {}
  } else {
    console.log("[SB Manager] Not running");
  }
}

function restart() {
  stop();
  setTimeout(start, 1000);
}

const cmd = process.argv[2] || "status";
switch (cmd) {
  case "start": start(); break;
  case "stop": stop(); break;
  case "status": status(); break;
  case "restart": restart(); break;
  default:
    console.log(`Usage: node sb-manager.js start|stop|status|restart [--v5] [--exec auto|confirm|dry-run|off] [--backend url]`);
}
