const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const solverUrl = pathToFileURL(path.resolve(__dirname, "../../third-party/zcode-api/src/proxy/captcha-solver.ts")).href;

test("CAPTCHA requests share a process-wide worker limit and release slots after errors", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-solver-limit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worker = path.join(directory, "worker.cjs");
  fs.writeFileSync(worker, `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', message => {
  setTimeout(() => parentPort.postMessage(message.scene === 'fail'
    ? { id: message.id, ok: false, error: 'fixture failure' }
    : { id: message.id, ok: true, param: 'token-' + message.scene }), 30);
});
`);
  const scenario = path.join(directory, "scenario.ts");
  fs.writeFileSync(scenario, `
import assert from 'node:assert/strict';
import * as solver from ${JSON.stringify(solverUrl)};
solver.setCaptchaSolverConcurrency(2);
const jobs = Array.from({ length: 12 }, (_, index) => solver.runCaptchaSolve(String(index), 'test', 'test'));
assert.equal(solver.captchaSolverStats().active, 2);
assert.equal(solver.captchaSolverStats().queued, 10);
assert.deepEqual(await Promise.all(jobs), Array.from({ length: 12 }, (_, index) => 'token-' + index));
assert.equal(solver.captchaSolverStats().peakActive, 2);
const failure = assert.rejects(solver.runCaptchaSolve('fail', 'test', 'test'), /fixture failure/);
assert.equal(await solver.runCaptchaSolve('after-failure', 'test', 'test'), 'token-after-failure');
await failure;
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(solver.captchaSolverStats().active, 0);
assert.equal(solver.captchaSolverStats().queued, 0);
assert.equal(solver.captchaSolverStats().failed, 1);
assert.equal(solver.captchaSolverConcurrency(), 2);
assert.throws(() => solver.setCaptchaSolverConcurrency(0), /Invalid/);
assert.throws(() => solver.setCaptchaSolverConcurrency(NaN), /Invalid/);
solver.shutdownCaptchaSolver();
console.log(JSON.stringify(solver.captchaSolverStats()));
`);
  const result = spawnSync("bun", ["run", scenario], {
    env: { ...process.env, ZCODE_CAPTCHA_WORKER: worker, ZCODE_CAPTCHA_REQUIRE_WORKER: "1", ZCODE_CAPTCHA_WARM_WORKERS: "0", CAPTCHA_SOLVE_TIMEOUT_MS: "10000" },
    encoding: "utf8", windowsHide: true, timeout: 20000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).peakActive, 2);
});

test("queued CAPTCHA solves expire or reject on shutdown without starting extra workers", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-solver-shutdown-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worker = path.join(directory, "worker.cjs");
  fs.writeFileSync(worker, `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', message => setTimeout(() => parentPort.postMessage({ id: message.id, ok: true, param: 'token' }), 150));
`);
  const scenario = path.join(directory, "scenario.ts");
  fs.writeFileSync(scenario, `
import assert from 'node:assert/strict';
import * as solver from ${JSON.stringify(solverUrl)};
solver.setCaptchaSolverConcurrency(1);
const active = solver.runCaptchaSolve('active', 'test', 'test');
process.env.CAPTCHA_SOLVE_TIMEOUT_MS = '20';
await assert.rejects(solver.runCaptchaSolve('expired', 'test', 'test'), /queue timeout/);
assert.equal(solver.captchaSolverStats().queued, 0);
assert.equal(solver.captchaSolverStats().active, 1);
process.env.CAPTCHA_SOLVE_TIMEOUT_MS = '10000';
const queued = assert.rejects(solver.runCaptchaSolve('shutdown', 'test', 'test'), /stopped before execution/);
solver.shutdownCaptchaSolver();
await queued;
await assert.rejects(solver.runCaptchaSolve('late', 'test', 'test'), /stopped/);
await active;
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(solver.captchaSolverStats().active, 0);
assert.equal(solver.captchaSolverStats().completed, 1);
assert.equal(solver.captchaSolverStats().peakActive, 1);
`);
  const result = spawnSync("bun", ["run", scenario], {
    env: { ...process.env, ZCODE_CAPTCHA_WORKER: worker, ZCODE_CAPTCHA_REQUIRE_WORKER: "1", ZCODE_CAPTCHA_WARM_WORKERS: "0", CAPTCHA_SOLVE_TIMEOUT_MS: "10000" },
    encoding: "utf8", windowsHide: true, timeout: 20000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});
