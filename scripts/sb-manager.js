#!/usr/bin/env node
/**
 * SB Proxy Manager — start/stop/status the proxy without killing other processes
 * Usage: node sb-manager.js start|stop|status|restart
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PID_FILE = path.join(__dirname, ".sb-proxy.pid");
const PROXY_SCRIPT = path.join(__dirname, "sb-proxy.js");
const PORT = 18899;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch { return false; }
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

  // Kill stale PID file
  if (existingPid) fs.unlinkSync(PID_FILE);

  const backendIdx = process.argv.indexOf("--backend");
  const backend = backendIdx !== -1 ? process.argv[backendIdx + 1] : "http://127.0.0.1:20128";

  const proc = spawn("node", [PROXY_SCRIPT, "--port", String(PORT), "--backend", backend], {
    stdio: "ignore",
    detached: true,
  });

  proc.unref();
  fs.writeFileSync(PID_FILE, String(proc.pid));
  console.log(`[SB Manager] Started (PID ${proc.pid})`);
  console.log(`[SB Manager] Port: ${PORT}`);
  console.log(`[SB Manager] Backend: ${backend}`);

  // Wait and verify
  setTimeout(() => {
    if (isRunning(proc.pid)) {
      console.log("[SB Manager] Proxy is running");
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
  } else {
    console.log("[SB Manager] Not running");
  }
}

const cmd = process.argv[2];
switch (cmd) {
  case "start": start(); break;
  case "stop": stop(); break;
  case "restart": stop(); setTimeout(start, 1000); break;
  case "status": status(); break;
  default: console.log("Usage: node sb-manager.js start|stop|status|restart");
}