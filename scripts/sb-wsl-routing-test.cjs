#!/usr/bin/env node
/** Verify Kali/root routing with mocked processes and files; executes no generated code. */
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(script, failBoot = false) {
  const launches = [], probes = [];
  const module = { exports: {} };
  const childProcess = {
    execSync(command, options) {
      probes.push({ command, options });
      if (failBoot) throw new Error("fixture unavailable");
      return Buffer.alloc(0);
    },
    spawn(command, args, options) {
      launches.push({ command, args: Array.from(args), options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => { throw new Error("unexpected timeout"); };
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  };
  const filename = path.join(__dirname, script);
  const source = fs.readFileSync(filename, "utf8");
  vm.runInNewContext(source, {
    module, __dirname, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    process: { env: {}, cwd: () => __dirname },
    require(name) {
      if (name === "child_process") return childProcess;
      if (name === "fs") return {
        mkdirSync() {}, writeFileSync() {}, existsSync: () => false,
        readFileSync() { throw new Error("fixture has no saved session"); },
      };
      if (name === "os") return { platform: () => "win32", homedir: () => __dirname, tmpdir: () => __dirname };
      return require(name);
    },
  }, { filename });
  return { api: module.exports, launches, probes };
}

async function main() {
  let cases = 0;
  for (const language of ["bash", "python", "c", "cpp", "other"]) {
    const f = load("sb-executor.cjs");
    const result = await f.api.execute({ language, code: "fixture", hash: "fixture", extension: ".txt" }, { environment: "kali" });
    assert.equal(result.success, true);
    assert.equal(f.launches.length, 1);
    assert.equal(f.launches[0].command, "wsl");
    assert.deepEqual(f.launches[0].args.slice(0, 7), ["-d", "kali-linux", "-u", "root", "--", "bash", "-c"]);
    assert.equal(f.probes[0].command, "wsl -d kali-linux -u root -- true");
    assert.equal(f.launches[0].options.windowsHide, true);
    cases++;
  }
  const fallback = load("sb-executor.cjs");
  await fallback.api.execute({ language: "bash", code: "fixture", hash: "fixture", extension: ".sh" }, { environment: "windows" });
  assert.deepEqual(fallback.launches[0].args.slice(0, 7), ["-d", "kali-linux", "-u", "root", "--", "bash", "-c"]);
  cases++;
  for (const [language, command] of [["javascript", "node"], ["powershell", "pwsh"], ["python", "python"]]) {
    const f = load("sb-executor.cjs");
    await f.api.execute({ language, code: "fixture", hash: "fixture", extension: ".txt" }, { environment: "windows" });
    assert.equal(f.launches[0].command, command);
    assert.equal(f.probes.length, 0);
    cases++;
  }
  const failed = load("sb-executor.cjs", true);
  const result = await failed.api.execute({ language: "bash", code: "fixture", hash: "fixture", extension: ".sh" }, { environment: "kali" });
  assert.equal(result.success, false);
  assert.equal(failed.launches.length, 0);
  cases++;
  for (const failBoot of [false, true]) {
    const f = load("sb-auto-start.cjs", failBoot);
    assert.equal(f.api.detectEnvironment().kaliAvailable, !failBoot);
    assert.equal(f.probes[0].command, "wsl -d kali-linux -u root -- true");
    assert.equal(f.probes[0].options.windowsHide, true);
    assert.equal(f.launches.length, 0);
    cases++;
  }
  console.log(JSON.stringify({ passed: cases, realSubprocesses: 0, generatedFiles: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
