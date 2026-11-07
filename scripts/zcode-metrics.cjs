const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const YAML = createRequire(path.resolve(__dirname, "../packages/experimental/pi-tui/package.json"))("yaml");

async function main() {
  const directory = process.env.ZCODE_DIR || path.resolve(__dirname, "../third-party/zcode-api");
  const config = YAML.parse(fs.readFileSync(path.join(directory, "config.yaml"), "utf8"));
  const key = process.env.ZCODE_PROXY_API_KEY || config.auth?.proxyApiKey;
  const port = Number(process.env.ZCODE_PORT || 18080);
  if (typeof key !== "string" || !key.trim() || /[\r\n]/.test(key)) throw new Error();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  const response = await fetch(`http://127.0.0.1:${port}/v1/diagnostics`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) {
    console.error("ZCode diagnostics unavailable. The running proxy needs the updated bundled source on its next restart.");
    process.exitCode = 1;
    return;
  }
  if (!response.ok) throw new Error();
  const data = await response.json();
  const numbers = (object, keys) => Object.fromEntries(keys.map(name => {
    const value = object?.[name];
    if (!Number.isFinite(value) || value < 0) throw new Error();
    return [name, value];
  }));
  const memory = numbers(data.memoryBytes, ["rss", "heapUsed", "heapTotal", "external"]);
  console.log(JSON.stringify({
    sampledAt: new Date().toISOString(),
    ...numbers(data, ["pid", "uptimeSeconds"]),
    memoryMiB: Object.fromEntries(Object.entries(memory).map(([name, bytes]) => [name, Math.round(bytes / 1048576 * 10) / 10])),
    peakRssMiB: Math.round(numbers(data, ["maxRssBytes"]).maxRssBytes / 1048576 * 10) / 10,
    cpuMicroseconds: numbers(data.cpuMicroseconds, ["user", "system"]),
    solver: numbers(data.solver, ["active", "queued", "limit", "peakActive", "completed", "failed"]),
    pool: numbers(data.pool, ["ready", "target", "min", "max", "activeSolves", "solverWorkers"]),
  }, null, 2));
}

main().catch(() => {
  console.error("ZCode metrics failed. Check the proxy listener, port and local config key. No credential values were displayed.");
  process.exitCode = 1;
});
