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

function isRunning(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getPid() {
  try { return parseInt(fs.readFileSync(PID_FILE, "utf8").trim()); } catch { return null; }
}

function start() {
  const existingPid = getPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`[SB Manager] Already running (PID ${existingPid})`);
    return;
  }

  if (existingPid) fs.unlinkSync(PID_FILE);

  // Parse args
  const useV6 = process.argv.includes("--v6");
  const useV5 = process.argv.includes("--v5");
  const execIdx = process.argv.indexOf("--exec");
  const execMode = execIdx !== -1 ? process.argv[execIdx + 1] : null;
  const backendIdx = process.argv.indexOf("--backend");
  const backend = backendIdx !== -1 ? process.argv[backendIdx + 1] : "http://127.0.0.1:20128";

  const script = useV6 ? PROXY_V6 : useV5 || execMode ? PROXY_V5 : PROXY_V4;
  const args = ["--port", String(PORT), "--backend", backend];

  if (execMode) args.push("--exec", execMode);

  const proc = spawn("node", [script, ...args], {
    stdio: "ignore",
    detached: true,
  });

  proc.unref();
  fs.writeFileSync(PID_FILE, String(proc.pid));

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
      const cmdline = execSync(`wmic process where processid=${pid} get commandline`, { encoding: "utf8" });
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
