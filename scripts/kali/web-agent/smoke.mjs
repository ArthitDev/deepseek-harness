import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

assert.equal(process.platform, 'linux', 'Run inside the configured Kali backend');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-web-agent-'));
fs.chmodSync(dir, 0o700);
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><title>DSH local canary</title><body>DSH-WEB-AGENT-CANARY</body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const target = `http://127.0.0.1:${server.address().port}`;
const active = new Set();

/** Keep the scanner and its descendants in one owned, cancellable process group. */
async function run(command, args, name, seconds = 180) {
  const log = fs.openSync(path.join(dir, `${name}.log`), 'w', 0o600);
  const child = spawn('timeout', ['--kill-after=10s', `${seconds}s`, command, ...args], {
    detached: true, stdio: ['ignore', log, log],
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key))),
  });
  active.add(child);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
  } finally {
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    active.delete(child);
    fs.closeSync(log);
  }
}

const stop = () => {
  for (const child of active) {
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
};
process.once('SIGTERM', () => { stop(); process.exit(143); });
process.once('SIGINT', () => { stop(); process.exit(130); });

try {
  const plan = {
    env: { contexts: [{ name: 'local', urls: [target], includePaths: [target + '/.*'] }],
      parameters: { failOnError: true, failOnWarning: true, progressToStdout: true } },
    jobs: [
      { type: 'requestor', requests: [{ url: target + '/', method: 'GET', responseCode: 200 }] },
      { type: 'passiveScan-wait', parameters: { maxDuration: 1 } },
      { type: 'report', parameters: { template: 'traditional-json', reportDir: dir, reportFile: 'zap.json' } },
    ],
  };
  const planPath = path.join(dir, 'plan.yaml');
  fs.writeFileSync(planPath, JSON.stringify(plan), { mode: 0o600 });
  const zapArgs = ['-cmd', '-silent', '-notel', '-host', '127.0.0.1', '-port', '0', '-dir', path.join(dir, 'zap-home')];
  assert.deepEqual(await run('zaproxy', [...zapArgs, '-autorun', planPath], 'zap'), { code: 0, signal: null });
  const zap = JSON.parse(fs.readFileSync(path.join(dir, 'zap.json'), 'utf8'));
  assert(zap.site.some(site => site['@name'] === target), 'ZAP report must retain the fixture URL');
  assert(zap.site.flatMap(site => site.alerts).some(alert => String(alert.pluginid) === '10020'), 'Expected missing anti-clickjacking header evidence');
  assert(requests.length > 0);

  const template = path.join(dir, 'canary.yaml');
  fs.writeFileSync(template, JSON.stringify({
    id: 'dsh-web-agent-canary',
    info: { name: 'Local canary', author: 'dsh', severity: 'info' },
    http: [{ method: 'GET', path: ['{{BaseURL}}/'], matchers: [{ type: 'word', words: ['DSH-WEB-AGENT-CANARY'] }] }],
  }), { mode: 0o600 });
  const nucleiPath = path.join(dir, 'nuclei.jsonl');
  assert.deepEqual(await run('nuclei', ['-u', target, '-t', template, '-jsonl', '-o', nucleiPath,
    '-duc', '-ni', '-rl', '2', '-c', '1', '-timeout', '5', '-retries', '0'], 'nuclei', 60), { code: 0, signal: null });
  const findings = fs.readFileSync(nucleiPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]['template-id'], 'dsh-web-agent-canary');
  assert.equal(findings[0].info.severity, 'info');
  assert.equal(findings[0]['matched-at'], target + '/');

  fs.writeFileSync(planPath, JSON.stringify({ env: plan.env, jobs: [{ type: 'dsh-invalid-job' }] }));
  const invalid = await run('zaproxy', [...zapArgs, '-autorun', planPath], 'zap-invalid');
  assert.equal(invalid.code, 1, 'Invalid automation jobs must fail');
  const cancelled = await run('/bin/sleep', ['30'], 'timeout', 1);
  assert.equal(cancelled.code, 124);
  console.log(JSON.stringify({ passed: true, dir, requests: requests.length, zapAlert: '10020', nucleiRecords: findings.length, invalidPlanRejected: true, timeout: true }));
} catch (error) {
  console.error(`Web agent check failed; evidence: ${dir}`);
  throw error;
} finally {
  stop();
  await new Promise(resolve => server.close(resolve));
}
