const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sb-transport-'));
  const script = path.join(root, 'scripts', 'sb-transport.cjs');
  fs.mkdirSync(path.dirname(script));
  fs.copyFileSync(path.join(__dirname, '../sb-transport.cjs'), script);
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, headers: req.headers, body });
    if (options.handler) { await options.handler(req, res, gate); return; }
    res.writeHead(options.status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model' }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, DSH_HOME: path.join(root, 'home'), SB_PORT: '0',
    SB_BACKEND: `http://127.0.0.1:${upstream.address().port}${options.basePath || ''}`,
    SB_BACKEND_KEY: options.key || '', SB_TIMEOUT_MS: String(options.timeout || 3000) };
  const child = spawn(process.execPath, [script, 'serve'], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    release();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'dsh-sb-transport-')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output || 'SB startup timed out')), 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', reject);
    child.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
  });
  return { root, script, env, child, upstream, endpoint, requests, release };
}

test('relocated transport identifies itself and preserves /v1, query and caller auth', async t => {
  const f = await fixture(t);
  const health = await (await fetch(`${f.endpoint}/health`)).json();
  assert.equal(health.service, 'dsh-sb-transport');
  assert.equal(health.mode, 'passthrough');
  assert.equal(health.pid, f.child.pid);
  const response = await fetch(`${f.endpoint}/v1/models?limit=1`, { headers: { Authorization: 'Bearer fake-router' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].id, 'mock-model');
  assert.equal(f.requests[0].url, '/v1/models?limit=1');
  assert.equal(f.requests[0].headers.authorization, 'Bearer fake-router');
  assert.match(response.headers.get('server-timing'), /^sb-upstream;dur=\d/);
  assert.equal((await fetch(`${f.endpoint}/other`)).status, 404);
});

test('invalid backend configuration fails without echoing its value', t => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../sb-transport.cjs'), 'serve'], {
    env: { ...process.env, SB_BACKEND: 'fake-sensitive-value' }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /absolute HTTP\(S\) base URL/);
  assert.doesNotMatch(result.stderr, /fake-sensitive-value/);
});

test('custom base paths, messages and tools pass through unchanged with explicit backend key', async t => {
  const f = await fixture(t, { basePath: '/router/v1/', key: 'fake-backend' });
  const body = JSON.stringify({ model: 'mock-model', stream: false,
    messages: [{ role: 'system', content: 'KEEP_SYSTEM' }, { role: 'user', content: 'Check https://example.com' }],
    tools: [{ type: 'function', function: { name: 'inspect', parameters: { type: 'object' } } }] });
  const response = await fetch(`${f.endpoint}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: 'Bearer fake-client', 'Content-Type': 'application/json' }, body,
  });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(f.requests[0].url, '/router/v1/chat/completions');
  assert.equal(f.requests[0].body, body);
  assert.equal(f.requests[0].headers.authorization, 'Bearer fake-backend');
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'scripts')), ['sb-transport.cjs']);
});

test('SSE first bytes arrive before upstream ends, including UTF-8 and DONE', async t => {
  const f = await fixture(t, { handler: async (_req, res, gate) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"text":"สวัสดี"}\n\n');
    await gate;
    res.end('data: [DONE]\n\n');
  } });
  const response = await fetch(`${f.endpoint}/v1/chat/completions`, { method: 'POST', body: '{"stream":true}' });
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /สวัสดี/);
  f.release();
  let tail = '';
  for (;;) { const part = await reader.read(); if (part.done) break; tail += new TextDecoder().decode(part.value); }
  assert.match(tail, /\[DONE\]/);
});

test('upstream status is retained without retrying', async t => {
  const f = await fixture(t, { status: 429 });
  const response = await fetch(`${f.endpoint}/v1/models`);
  assert.equal(response.status, 429);
  await response.text();
  assert.equal(f.requests.length, 1);
});

test('idle upstream returns 504 and unreachable upstream returns 502', async t => {
  const f = await fixture(t, { timeout: 100, handler: () => {} });
  const response = await fetch(`${f.endpoint}/v1/models`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 504);
  assert.match(await response.text(), /idle timeout/);
  f.upstream.closeAllConnections();
  await new Promise(resolve => f.upstream.close(resolve));
  const down = await fetch(`${f.endpoint}/v1/models`);
  assert.equal(down.status, 502);
});

test('client disconnect cancels upstream without killing the proxy', async t => {
  let closed;
  const upstreamClosed = new Promise(resolve => { closed = resolve; });
  const f = await fixture(t, { handler: (_req, res) => {
    res.on('close', closed);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {}\n\n');
  } });
  const controller = new AbortController();
  const response = await fetch(`${f.endpoint}/v1/chat/completions`, { method: 'POST', body: '{}', signal: controller.signal });
  await response.body.getReader().read();
  controller.abort();
  await Promise.race([upstreamClosed, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('upstream remained connected')), 2000);
    upstreamClosed.then(() => clearTimeout(timer));
  })]);
  assert.equal((await fetch(`${f.endpoint}/health`)).status, 200);
});

test('oversized requests are rejected before forwarding', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.endpoint}/v1/chat/completions`, {
    method: 'POST', body: Buffer.alloc(32 * 1024 * 1024 + 1), signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 413);
  assert.equal(f.requests.length, 0);
});

test('managed relocated start exits, reuses its process, and stops only owned listener', async t => {
  const f = await fixture(t);
  const reserved = http.createServer();
  await new Promise(resolve => reserved.listen(0, '127.0.0.1', resolve));
  const port = reserved.address().port;
  await new Promise(resolve => reserved.close(resolve));
  const env = { ...f.env, SB_PORT: String(port) };
  const run = command => spawnSync(process.execPath, [f.script, command], {
    env, encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  const url = `http://127.0.0.1:${port}/health`;
  let pid;
  t.after(() => { if (pid) { try { process.kill(pid); } catch { /* Already stopped by its owner. */ } } });
  const first = run('start');
  assert.equal(first.status, 0, first.stderr);
  pid = (await (await fetch(url)).json()).pid;
  assert.equal(run('start').status, 0);
  assert.equal((await (await fetch(url)).json()).pid, pid);
  assert.equal(run('status').status, 0);
  assert.equal(run('stop').status, 0);
  pid = undefined;
  await assert.rejects(fetch(url));
});

test('a different listener is neither adopted nor stopped', async t => {
  const f = await fixture(t);
  const env = { ...f.env, SB_PORT: String(f.upstream.address().port) };
  // spawnSync would block the fixture's HTTP server, so run this helper asynchronously.
  const child = spawn(process.execPath, [f.script, 'start'], { env, windowsHide: true, stdio: 'ignore' });
  assert.equal((await once(child, 'exit'))[0], 1);
  assert.equal((await fetch(`http://127.0.0.1:${f.upstream.address().port}/health`)).status, 200);
});
