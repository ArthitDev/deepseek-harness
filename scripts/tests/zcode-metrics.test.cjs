const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

async function fixture(t, status = 200) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-zcode-metrics-"));
  const key = "fixture-private-value";
  fs.writeFileSync(path.join(directory, "config.yaml"), `auth:\n  proxyApiKey: ${key}\n`);
  let authorized = false;
  const server = http.createServer((request, response) => {
    authorized = request.headers.authorization === `Bearer ${key}`;
    assert.equal(request.url, "/v1/diagnostics");
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({
      pid: 123, uptimeSeconds: 10, maxRssBytes: 104857600,
      memoryBytes: { rss: 52428800, heapUsed: 10485760, heapTotal: 20971520, external: 1048576 },
      cpuMicroseconds: { user: 1000, system: 100 },
      solver: { active: 2, queued: 4, limit: 3, peakActive: 3, completed: 8, failed: 1 },
      pool: { ready: 4, target: 15, min: 15, max: 60, activeSolves: 6, solverWorkers: 3 },
      apiKey: key,
    }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, "../zcode-metrics.cjs")], {
      env: { ...process.env, ZCODE_DIR: directory, ZCODE_PORT: String(server.address().port), ZCODE_PROXY_API_KEY: key },
      windowsHide: true, timeout: 10000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  assert.equal(result.signal, null);
  assert.ok(authorized);
  assert.ok(!result.stdout.includes(key));
  assert.ok(!result.stderr.includes(key));
  return result;
}

test("metrics reports numeric resource counts without echoing response secrets", async t => {
  const result = await fixture(t);
  assert.equal(result.code, 0, result.stderr);
  const metrics = JSON.parse(result.stdout);
  assert.equal(metrics.memoryMiB.rss, 50);
  assert.equal(metrics.peakRssMiB, 100);
  assert.equal(metrics.solver.limit, 3);
  assert.equal(metrics.pool.ready, 4);
  assert.equal(metrics.apiKey, undefined);
});

test("older proxies report that diagnostics needs a restart", async t => {
  const result = await fixture(t, 404);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /next restart/);
  assert.equal(result.stdout, "");
});

test("authentication errors do not print response bodies", async t => {
  const result = await fixture(t, 401);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /No credential values/);
  assert.equal(result.stdout, "");
});
