#!/usr/bin/env node
/**
 * SB Install — one command to set up SB Proxy v6 on any machine.
 *
 * What it does:
 *   1. Verifies Node.js
 *   2. Detects or creates directory structure
 *   3. Copies proxy stack files (if run from repo)
 *   4. Installs skills (copies or links .dsh/skills)
 *   5. Installs wiki (copies or links .dsh/cyber-wiki)
 *   6. Detects Kali WSL / Linux tools
 *   7. Configures auto-start hooks
 *   8. Runs health check
 *
 * Usage (from harness repo):
 *   node scripts/sb-install.cjs
 *
 * Usage (standalone, specify target):
 *   node sb-install.cjs --target /path/to/install
 */

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function log(icon, msg) { console.log(`  ${icon} ${msg}`); }
function ok(msg) { log(colors.green("✓"), msg); }
function warn(msg) { log(colors.yellow("⚠"), msg); }
function fail(msg) { log(colors.red("✗"), msg); }
function info(msg) { log(colors.cyan("→"), msg); }

async function main() {
  console.log(`
${colors.cyan("╔════════════════════════════════════════════════╗")}
${colors.cyan("║")}     ${colors.green("SB Proxy v6 — Installer")}                        ${colors.cyan("║")}
${colors.cyan("║")}     Recon + Skills + Wiki + Kali + Execute      ${colors.cyan("║")}
${colors.cyan("╚════════════════════════════════════════════════╝")}
`);

  // ── 1. Node.js check ─────────────────────────────────────
  console.log(colors.dim("── Node.js ──"));
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.split(".")[0].substring(1));
  if (nodeMajor >= 18) {
    ok(`Node.js ${nodeVersion}`);
  } else {
    fail(`Node.js ${nodeVersion} — need >= 18`);
    process.exit(1);
  }

  // ── 2. Determine install location ────────────────────────
  console.log(`\n${colors.dim("── Install Location ──")}`);
  const targetIdx = process.argv.indexOf("--target");
  const harnessRoot = targetIdx !== -1
    ? path.resolve(process.argv[targetIdx + 1])
    : (() => {
      // Walk up from script to find harness root
      let dir = __dirname;
      for (let i = 0; i < 5; i++) {
        if (fs.existsSync(path.join(dir, "package.json"))
          && fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
        dir = path.dirname(dir);
      }
      return __dirname;
    })();

  const scriptsDir = path.join(harnessRoot, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  ok(`Harness root: ${harnessRoot}`);
  ok(`Scripts dir:  ${scriptsDir}`);

  // ── 3. Copy proxy stack ──────────────────────────────────
  console.log(`\n${colors.dim("── Proxy Stack ──")}`);
  const proxyFiles = [
    { src: path.join(__dirname, "sb-proxy-v6.cjs"), dst: path.join(scriptsDir, "sb-proxy-v6.cjs"), required: true },
    { src: path.join(__dirname, "sb-auto-start.cjs"), dst: path.join(scriptsDir, "sb-auto-start.cjs"), required: true },
    { src: path.join(__dirname, "sb-manager.cjs"), dst: path.join(scriptsDir, "sb-manager.cjs"), required: false },
    { src: path.join(__dirname, "sb-executor.cjs"), dst: path.join(scriptsDir, "sb-executor.cjs"), required: false },
    { src: path.join(__dirname, "sb-mock-backend.cjs"), dst: path.join(scriptsDir, "sb-mock-backend.cjs"), required: false },
  ];

  for (const { src, dst, required } of proxyFiles) {
    if (fs.existsSync(src)) {
      if (src !== dst) {
        fs.copyFileSync(src, dst);
        ok(`Copied: ${path.basename(dst)}`);
      } else {
        ok(`Already in place: ${path.basename(dst)}`);
      }
    } else if (required) {
      fail(`Missing: ${path.basename(src)} (required)`);
      process.exit(1);
    } else {
      warn(`Optional file not found: ${path.basename(src)}`);
    }
  }

  // ── 4. Skills directory ──────────────────────────────────
  console.log(`\n${colors.dim("── Skills ──")}`);
  const dshDir = path.join(os.homedir(), ".dsh");
  const skillsDir = path.join(dshDir, "skills");

  if (fs.existsSync(skillsDir)) {
    const count = fs.readdirSync(skillsDir).filter(d =>
      fs.existsSync(path.join(skillsDir, d, "SKILL.md"))
    ).length;
    ok(`Skills: ${count} skills at ${skillsDir}`);
  } else {
    warn("No skills directory found");
    info("Creating minimal skills structure...");
    fs.mkdirSync(skillsDir, { recursive: true });
    // Create a marker SKILL.md so detection works
    fs.writeFileSync(path.join(skillsDir, ".gitkeep"), "");
    warn(`Created empty: ${skillsDir}`);
    info("Copy skills from source repo to enable skill routing");
  }

  // ── 5. Wiki directory ────────────────────────────────────
  console.log(`\n${colors.dim("── Wiki ──")}`);
  const wikiDir = path.join(dshDir, "cyber-wiki");

  if (fs.existsSync(wikiDir)) {
    const notes = (function count(dir) {
      let n = 0;
      for (const f of fs.readdirSync(dir, { recursive: true })) {
        if (String(f).endsWith(".md")) n++;
      }
      return n;
    })(wikiDir);
    ok(`Wiki: ${notes} notes at ${wikiDir}`);
  } else {
    warn("No wiki directory found");
    info("Creating empty wiki...");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.mkdirSync(path.join(wikiDir, "red-team", "techniques", "web"), { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "INDEX.md"), "# Cyber Wiki index\n\nEmpty — copy notes from source.\n");
    warn(`Created empty: ${wikiDir}`);
    info("Copy wiki from source repo to enable reference intel");
  }

  // ── 6. Kali detection ────────────────────────────────────
  console.log(`\n${colors.dim("── Kali / Tools ──")}`);
  let kaliAvailable = false;

  if (os.platform() === "win32") {
    try {
      execSync("wsl -d kali-linux -- true", { timeout: 10000, stdio: "pipe" });
      kaliAvailable = true;

      // Check tools (simple individual checks to avoid quoting issues)
      const tools = ["nmap", "sqlmap", "hydra", "john", "hashcat", "gobuster", "subfinder"];
      let ok_ = 0;
      for (const tool of tools) {
        try {
          execSync(`wsl -d kali-linux -- which ${tool}`, { timeout: 5000, stdio: "pipe" });
          ok_++;
        } catch { }
      }
      const miss = tools.length - ok_;
      ok(`Kali WSL: ${ok_}/${tools.length} tools available`);
      if (miss > 0) {
        warn(`${miss} tools missing — install: wsl -d kali-linux -- apt install <pkg>`);
      }
    } catch {
      warn("Kali WSL not available — recon/direct-call will be limited");
    }
  } else if (os.platform() === "linux") {
    try {
      execSync("which nmap", { timeout: 3000, stdio: "pipe" });
      kaliAvailable = true;
      ok("Linux tools available (native)");
    } catch {
      warn("No nmap found — install for recon: apt install nmap");
    }
  } else {
    warn(`Platform ${os.platform()} — Kali/tools may not be available`);
  }

  // ── 7. Package.json hooks ────────────────────────────────
  console.log(`\n${colors.dim("── Auto-Start Hooks ──")}`);
  const pkgPath = path.join(harnessRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch {
      warn("package.json parse error — skip hooks");
      pkg = null;
    }

    if (pkg) {
      if (!pkg.scripts) pkg.scripts = {};

      // Auto-start hooks
      const autoScript = "node scripts/sb-auto-start.cjs start --background";
      if (!pkg.scripts["predev"]) {
        pkg.scripts["predev"] = autoScript;
        ok("Added predev hook");
      } else { info("predev already exists (not overwritten)"); }

      if (!pkg.scripts["prestart"]) {
        pkg.scripts["prestart"] = autoScript;
        ok("Added prestart hook");
      } else { info("prestart already exists (not overwritten)"); }

      // SB commands
      const sbScripts = {
        "sb:start": "node scripts/sb-auto-start.cjs start",
        "sb:stop": "node scripts/sb-auto-start.cjs stop",
        "sb:status": "node scripts/sb-auto-start.cjs status",
        "sb:restart": "node scripts/sb-auto-start.cjs restart",
        "sb:install": "node scripts/sb-auto-start.cjs install",
        "sb:test": "node scripts/sb-executor-test.cjs",
      };
      for (const [name, script] of Object.entries(sbScripts)) {
        if (!pkg.scripts[name]) {
          pkg.scripts[name] = script;
          ok(`Added ${name}`);
        }
      }

      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
      ok("package.json saved");
    }
  } else {
    warn("No package.json — auto-start hooks skipped");
  }

  // ── 8. Startup script ────────────────────────────────────
  const batPath = path.join(scriptsDir, "start-sb.bat");
  if (os.platform() === "win32" && !fs.existsSync(batPath)) {
    fs.writeFileSync(batPath, `@echo off
title SB Proxy v6
echo Starting SB Proxy v6...
node "%~dp0sb-auto-start.cjs" start
pause
`);
    ok("Created start-sb.bat");
  }

  const shPath = path.join(scriptsDir, "start-sb.sh");
  if (os.platform() !== "win32" && !fs.existsSync(shPath)) {
    fs.writeFileSync(shPath, `#!/bin/bash
echo "Starting SB Proxy v6..."
node "$(dirname "$0")/sb-auto-start.cjs" start
`, { mode: 0o755 });
    ok("Created start-sb.sh");
  }

  // ── 9. Quick health test ─────────────────────────────────
  console.log(`\n${colors.dim("── Health Check ──")}`);
  const port = parseInt(process.env.SB_PORT || "18899");
  const backendUrl = process.env.SB_BACKEND || "http://127.0.0.1:20128";

  info(`Proxy will listen on :${port}`);
  info(`Backend: ${backendUrl}`);

  const backendReachable = await new Promise((resolve) => {
    const u = new URL(backendUrl);
    const req = http.get({ hostname: u.hostname, port: u.port, path: "/", timeout: 3000 }, () => resolve(true));
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });

  if (backendReachable) {
    ok("Backend reachable");
  } else {
    warn("Backend not reachable — proxy will start but LLM calls will fail until backend is up");
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`
${colors.cyan("╔════════════════════════════════════════════════╗")}
${colors.cyan("║")}     ${colors.green("Install Complete")}                                ${colors.cyan("║")}
${colors.cyan("╚════════════════════════════════════════════════╝")}

  ${colors.dim("Quick start:")}
    node scripts/sb-auto-start.cjs start
    ${colors.dim("or: pnpm sb:start")}

  ${colors.dim("Auto-start on harness boot:")}
    pnpm dev          ${colors.dim("(triggers predev → proxy auto-starts)")}
    pnpm start        ${colors.dim("(triggers prestart → proxy auto-starts)")}

  ${colors.dim("Environment:")}
    Skills:      ${fs.existsSync(skillsDir) ? "✓" : "✗"} ${skillsDir}
    Wiki:        ${fs.existsSync(wikiDir) ? "✓" : "✗"} ${wikiDir}
    Kali/tools:  ${kaliAvailable ? "✓" : "✗"}
    Backend:     ${backendReachable ? "✓" : "⚠"} ${backendUrl}
    Proxy port:  ${port}

  ${colors.dim("Env vars (optional):")}
    SB_PORT=18899
    SB_BACKEND=http://127.0.0.1:20128
    SB_EXEC_MODE=auto
    SB_SKILLS_DIR=...
    SB_WIKI_DIR=...
`);
}

main().catch(e => { console.error(e); process.exit(1); });
