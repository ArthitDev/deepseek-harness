const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawnSync } = require("node:child_process");

assert.equal(spawnSync("bun", ["--version"], { windowsHide: true }).status, 0, "Install Bun to run ZCode tests");
const harnessRoot = path.resolve(__dirname, "../..");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-zcode-test-"));
  const directory = path.join(root, "third-party", "zcode-api");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(directory, "src", "proxy"), { recursive: true });
  fs.mkdirSync(path.join(directory, "scripts"));
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"zcode-launcher-fixture","private":true}');
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
  fs.copyFileSync(path.join(harnessRoot, "scripts", "sb-auto-start.cjs"), path.join(root, "scripts", "sb-auto-start.cjs"));
  fs.copyFileSync(path.join(harnessRoot, "third-party", "zcode-api", "harness.config.example.yaml"), path.join(directory, "harness.config.example.yaml"));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module", dependencies: {} }));
  fs.writeFileSync(path.join(directory, "bun.lock"), "fixture-lock-v1\n");
  fs.writeFileSync(path.join(directory, "src", "proxy", "captcha-worker-entry.ts"), 'import { parentPort } from "node:worker_threads"; parentPort.postMessage("ready"); parentPort.on("message", () => {});');
  fs.writeFileSync(path.join(directory, "src", "index.ts"), `
import { Worker } from "node:worker_threads";
const worker = new Worker(process.env.ZCODE_CAPTCHA_WORKER);
worker.once("message", () => Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.ZCODE_PROXY_PORT),
  fetch: () => Response.json({pid: process.pid, strict: process.env.ZCODE_CAPTCHA_REQUIRE_WORKER, worker: process.env.ZCODE_CAPTCHA_WORKER, cwd: process.cwd()}, {status: 401}),
}));
`);
  fs.writeFileSync(path.join(directory, "scripts", "build-fork-worker.ts"), `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
writeFileSync("build-count", String(existsSync("build-count") ? Number(readFileSync("build-count", "utf8")) + 1 : 1));
writeFileSync("src/proxy/captcha-worker-entry.bundle.js", readFileSync("src/proxy/captcha-worker-entry.ts", "utf8"));
`);
  const launcher = require(path.join(root, "scripts", "sb-auto-start.cjs"));
  t.after(async () => {
    launcher.stopZcodeProxy();
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), "dsh-zcode-test-")));
        fs.rmSync(root, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 29) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  });
  return { root, directory, launcher };
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("relocated harness resolves its bundled proxy and preserves an explicit override", t => {
  const { root, directory, launcher } = fixture(t);
  assert.equal(launcher.resolveZcodeDir(root, ""), directory);
  assert.equal(launcher.resolveZcodeDir("unused", directory), directory);
  assert.equal(launcher.resolveZcodeDir(root, path.join(root, "missing")), null);
});

test("setup builds the worker and creates a private Starter config without overwriting it", t => {
  const { directory, launcher } = fixture(t);
  launcher.prepareZcodeProxy({ zcodeDir: directory }, true);
  assert.ok(fs.existsSync(path.join(directory, "src", "proxy", "captcha-worker-entry.bundle.js")));
  const configPath = path.join(directory, "config.yaml");
  const original = fs.readFileSync(configPath, "utf8");
  assert.match(original, /host: "127\.0\.0\.1"/);
  assert.match(original, /plan: start-plan/);
  assert.match(original, /proxyApiKey: "[a-f0-9]{64}"/);
  assert.doesNotMatch(original, /__GENERATE_PROXY_API_KEY__/);
  launcher.prepareZcodeProxy({ zcodeDir: directory }, true);
  assert.equal(fs.readFileSync(configPath, "utf8"), original);
});

test("relocated launcher starts a real worker with strict settings despite stale local environment", async t => {
  const { directory, launcher } = fixture(t);
  fs.writeFileSync(path.join(directory, ".env.local"), "ZCODE_CAPTCHA_WORKER=/old-machine/missing.js\nZCODE_CAPTCHA_REQUIRE_WORKER=0\nZCODE_PROXY_PORT=1\n");
  const port = await unusedPort();
  assert.equal(await launcher.startZcodeProxy({ zcodeDir: directory, zcodePort: port }, true), true);
  const response = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.strict, "1");
  assert.equal(body.worker, path.join(directory, "src", "proxy", "captcha-worker-entry.bundle.js"));
  assert.equal(body.cwd.toLowerCase(), directory.toLowerCase());
});

test("setup reuses an unchanged worker and invalidates source, lockfile, builder and damaged artifacts", t => {
  const { directory, launcher } = fixture(t);
  const prepare = () => launcher.prepareZcodeProxy({ zcodeDir: directory }, true);
  const count = () => Number(fs.readFileSync(path.join(directory, "build-count"), "utf8"));
  const samples = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const started = performance.now();
    prepare();
    samples.push(Number((performance.now() - started).toFixed(2)));
  }
  t.diagnostic(`prepare fixture samples ms: ${JSON.stringify(samples)}`);
  assert.equal(count(), 1, "unchanged setup must not rebuild");
  for (const file of ["src/proxy/captcha-worker-entry.ts", "bun.lock", "scripts/build-fork-worker.ts"]) {
    const originalTimes = fs.statSync(path.join(directory, file));
    fs.appendFileSync(path.join(directory, file), "\n");
    fs.utimesSync(path.join(directory, file), originalTimes.atime, originalTimes.mtime);
    const previous = count();
    prepare();
    assert.equal(count(), previous + 1, file);
  }
  const bundle = path.join(directory, "src", "proxy", "captcha-worker-entry.bundle.js");
  fs.writeFileSync(bundle, "damaged bundle");
  prepare();
  assert.equal(count(), 5);
  fs.unlinkSync(bundle);
  prepare();
  assert.equal(count(), 6);
  fs.writeFileSync(path.join(directory, ".cache", "captcha-worker-build.json"), "{broken");
  prepare();
  assert.equal(count(), 7);
  const config = fs.readFileSync(path.join(directory, "config.yaml"), "utf8");
  fs.appendFileSync(path.join(directory, "config.yaml"), "\n# local setting\n");
  fs.writeFileSync(path.join(directory, ".env.local"), "CREDENTIAL=private\n");
  prepare();
  assert.equal(count(), 7, "account config and env must not enter the build fingerprint");
  assert.equal(fs.readFileSync(path.join(directory, "config.yaml"), "utf8"), config + "\n# local setting\n");
});

test("worker cache follows installed dependency metadata and survives relocating the checkout", t => {
  const { directory, launcher } = fixture(t);
  const dependency = path.join(directory, "node_modules", "fixture-dependency");
  fs.mkdirSync(dependency, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module", dependencies: { "fixture-dependency": "*" } }));
  fs.writeFileSync(path.join(dependency, "package.json"), '{"version":"1.0.0"}');
  const prepare = () => launcher.prepareZcodeProxy({ zcodeDir: directory }, true);
  prepare();
  assert.equal(fs.readFileSync(path.join(directory, "build-count"), "utf8"), "1");
  fs.writeFileSync(path.join(dependency, "package.json"), '{"version":"1.0.1"}');
  prepare();
  assert.equal(fs.readFileSync(path.join(directory, "build-count"), "utf8"), "2");
  const moved = fixture(t);
  fs.cpSync(directory, moved.directory, { recursive: true });
  moved.launcher.prepareZcodeProxy({ zcodeDir: moved.directory }, true);
  assert.equal(fs.readFileSync(path.join(moved.directory, "build-count"), "utf8"), "2");
});

test("a changed builder failure never replaces the last successful worker stamp", t => {
  const { directory, launcher } = fixture(t);
  const prepare = () => launcher.prepareZcodeProxy({ zcodeDir: directory }, true);
  prepare();
  const stamp = path.join(directory, ".cache", "captcha-worker-build.json");
  const original = fs.readFileSync(stamp, "utf8");
  const builder = path.join(directory, "scripts", "build-fork-worker.ts");
  fs.writeFileSync(builder, "throw new Error('fixture failed rebuild');\n");
  assert.throws(prepare, /ZCode setup failed/);
  assert.equal(fs.readFileSync(stamp, "utf8"), original);
  assert.throws(prepare, /ZCode setup failed/, "the failed build must be retried");
});

test("failed worker build prevents proxy startup", async t => {
  const { directory, launcher } = fixture(t);
  fs.writeFileSync(path.join(directory, "scripts", "build-fork-worker.ts"), "throw new Error('fixture build failure');\n");
  assert.throws(() => launcher.prepareZcodeProxy({ zcodeDir: directory }, true), /ZCode setup failed/);
  const port = await unusedPort();
  assert.equal(await launcher.startZcodeProxy({ zcodeDir: directory, zcodePort: port }, true), false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(2000) }));
  assert.equal(fs.existsSync(path.join(directory, "config.yaml")), false);
});

test("ZCode-only CLI exits while its proxy keeps serving and a second start reuses it", async t => {
  const { root, directory } = fixture(t);
  const port = await unusedPort();
  let proxyPid;
  try {
    const launch = () => spawnSync(process.execPath, [path.join(root, "scripts", "sb-auto-start.cjs"), "start-zcode"], {
      env: { ...process.env, ZCODE_DIR: directory, ZCODE_PORT: String(port) },
      encoding: "utf8", windowsHide: true, timeout: 20000,
    });
    const first = launch();
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    assert.equal(body.cwd.toLowerCase(), directory.toLowerCase());
    proxyPid = body.pid;
    assert.equal(first.status, 0, first.stderr);
    assert.equal(body.strict, "1");
    const second = launch();
    assert.equal(second.status, 0, second.stderr);
    const reused = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(2000) });
    assert.equal((await reused.json()).pid, proxyPid);
  } finally {
    if (proxyPid !== undefined) process.kill(proxyPid, "SIGTERM");
  }
});
