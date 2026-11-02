const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

const source = path.resolve(__dirname, '../../packages/experimental/pi-tui/tools/antigravity-proxy');
const packageRequire = createRequire(path.resolve(source, '../../package.json'));
const YAML = packageRequire('yaml');

async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-antigravity-test-'));
  const directory = path.join(root, 'packages', 'experimental', 'pi-tui', 'tools', 'antigravity-proxy');
  fs.cpSync(source, directory, { recursive: true });
  const stateFile = path.join(root, 'token.json');
  if (!options.noToken) fs.writeFileSync(stateFile, JSON.stringify({ token: {
    access_token: 'fake-expired-access', refresh_token: 'fake-refresh', expiry: 1,
  } }));
  const requests = [];
  let refreshes = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const upstream = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = req.url === '/token' ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text || '{}');
    requests.push({ url: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/token') {
      refreshes++;
      await new Promise(resolve => setTimeout(resolve, 25));
      if (options.refreshFailOnce && refreshes === 1) { res.writeHead(503); res.end('{}'); return; }
      res.end(JSON.stringify({ access_token: 'fake-new-access', refresh_token: 'fake-rotated-refresh', expires_in: 3600 }));
    } else if (req.url === '/v1internal:loadCodeAssist') {
      res.end(JSON.stringify(options.onboard ? { allowedTiers: [{ id: 'free-tier', isDefault: true }] }
        : { cloudaicompanionProject: { id: 'mock-project' } }));
    } else if (req.url === '/v1internal:onboardUser') {
      res.end(JSON.stringify({ done: true, response: { cloudaicompanionProject: { id: 'mock-project' } } }));
    } else if (options.failGeneration) {
      res.writeHead(429); res.end('{}');
    } else if (options.hang) {
      // The client must time out without waiting for a model response.
    } else {
      const tool = body.request.contents[0].parts[0].text === 'CALL_TOOL'
        && !body.request.contents.some(item => item.parts.some(part => part.functionResponse));
      const result = { response: { candidates: [{ content: { parts: tool
        ? [{ functionCall: { name: 'read_file', args: { path: 'README.md' } }, thoughtSignature: 'fake-signature' }]
        : [{ text: 'สวัสดี' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 12 } } };
      if (req.url.startsWith('/v1internal:streamGenerateContent')) {
        res.setHeader('Content-Type', 'text/event-stream');
        const frame = Buffer.from(`data: ${JSON.stringify(result)}\r\n\r\n`);
        for (let i = 0; i < frame.length; i += 7) res.write(frame.subarray(i, i + 7));
        if (options.holdStream) await gate;
        if (options.badStream) res.write('data: not-json\n\n');
        res.end();
      } else res.end(JSON.stringify(result));
    }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const child = spawn(process.execPath, [path.join(directory, 'antigravity_proxy.mjs')], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOST: '127.0.0.1', PORT: '8080', ANTIGRAVITY_PORT: '0', ANTIGRAVITY_TOKEN_FILE: stateFile,
      ANTIGRAVITY_API_BASE: upstreamUrl, ANTIGRAVITY_OAUTH_TOKEN_URL: `${upstreamUrl}/token`,
      ANTIGRAVITY_TIMEOUT_MS: options.hang ? '250' : '3000' },
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    release();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'dsh-antigravity-test-')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`proxy startup timeout: ${output}`)), 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const address = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (address) { clearTimeout(timer); resolve(address[1]); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`proxy exited: ${output}`)); });
    child.once('error', reject);
  });
  const post = body => fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-local-key' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  return { root, directory, stateFile, requests, post, endpoint, release, refreshes: () => refreshes };
}

const request = { model: 'gemini-3-flash', messages: [{ role: 'user', content: 'hello' }] };

test('relocated setup resolves the harness root and dry-run writes no profile', async t => {
  const f = await fixture(t, { noToken: true });
  const home = path.join(f.root, 'fresh-home');
  const run = spawnSync(process.execPath, [path.join(f.directory, 'setup.mjs'), '--dry-run'], {
    env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(path.join(f.root, 'apps', 'cli', 'src', 'bin.ts')));
  assert.ok(run.stdout.includes(path.join(f.root, 'packages', 'experimental', 'pi-tui')));
  assert.equal(fs.existsSync(home), false);
});

test('setup reuses a running proxy and prints login instructions without opening a browser', async t => {
  const f = await fixture(t, { noToken: true });
  const home = path.join(f.root, 'fresh-home');
  fs.mkdirSync(path.join(home, 'profiles', 'tui'), { recursive: true });
  fs.writeFileSync(path.join(home, 'profiles', 'tui', 'package.json'), '{}');
  const run = spawnSync(process.execPath, [path.join(f.directory, 'setup.mjs'), '--no-browser'], {
    env: { ...process.env, DSH_HOME: home, USERPROFILE: f.root, HOME: f.root, ANTIGRAVITY_PORT: new URL(f.endpoint).port },
    encoding: 'utf8', windowsHide: true, timeout: 5000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(`proxy healthy at ${f.endpoint}`));
  assert.ok(run.stdout.includes(`sign-in URL: ${f.endpoint}/auth/login`));
  assert.equal(f.requests.length, 0);
});

test('an expired token refreshes once for concurrent requests and discovers its project', async t => {
  const f = await fixture(t);
  const health = await fetch(`${f.endpoint}/auth/status`).then(res => res.json());
  assert.equal(health.authenticated, true);
  const responses = await Promise.all([f.post(request), f.post(request), f.post(request)]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, 'สวัสดี');
    assert.deepEqual(body.usage, { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 });
  }
  assert.equal(f.refreshes(), 1);
  assert.equal(f.requests.filter(item => item.url === '/v1internal:loadCodeAssist').length, 1);
  const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).token;
  assert.equal(saved.refresh_token, 'fake-rotated-refresh');
  assert.equal(saved.project_id, 'mock-project');
  const generation = f.requests.find(item => item.url === '/v1internal:generateContent');
  assert.equal(generation.headers.authorization, 'Bearer fake-new-access');
  assert.equal(generation.headers['x-goog-api-key'], undefined);
});

test('a failed refresh can retry and an account without a project completes onboarding', async t => {
  const f = await fixture(t, { refreshFailOnce: true, onboard: true });
  const failed = await f.post(request);
  assert.equal(failed.status, 502);
  await failed.text();
  const ready = await f.post(request);
  assert.equal(ready.status, 200);
  await ready.text();
  assert.equal(f.refreshes(), 2);
  assert.equal(f.requests.filter(item => item.url === '/v1internal:onboardUser').length, 1);
});

test('SSE arrives before upstream closes and terminates with usage and DONE', async t => {
  const f = await fixture(t, { holdStream: true });
  const response = await f.post({ ...request, stream: true, stream_options: { include_usage: true } });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('สวัสดี')) {
    const read = await reader.read();
    assert.equal(read.done, false);
    text += decoder.decode(read.value, { stream: true });
  }
  assert.equal(text.includes('[DONE]'), false);
  f.release();
  for (;;) {
    const read = await reader.read();
    if (read.done) break;
    text += decoder.decode(read.value, { stream: true });
  }
  assert.match(text, /"completion_tokens":5/);
  assert.ok(text.endsWith('data: [DONE]\n\n'));
});

test('function declarations, calls, signatures and tool results survive a full round trip', async t => {
  const f = await fixture(t);
  const tools = [{ type: 'function', function: { name: 'read_file', description: 'Read a file',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
  const messages = [{ role: 'user', content: 'CALL_TOOL' }];
  const first = await f.post({ ...request, messages, tools, tool_choice: 'required', max_tokens: 123 });
  const assistant = (await first.json()).choices[0].message;
  assert.equal(assistant.tool_calls[0].function.name, 'read_file');
  assert.equal(assistant.reasoning_details[0].data, 'fake-signature');
  const second = await f.post({ ...request, tools, tool_choice: 'none', messages: [...messages, assistant,
    { role: 'tool', tool_call_id: assistant.tool_calls[0].id, content: '{"text":"file contents"}' }] });
  assert.equal(second.status, 200);
  await second.text();
  const generations = f.requests.filter(item => item.url === '/v1internal:generateContent');
  assert.equal(generations[0].body.request.tools[0].functionDeclarations[0].name, 'read_file');
  assert.equal(generations[0].body.request.generationConfig.maxOutputTokens, 123);
  assert.equal(generations[1].body.request.contents[1].parts[0].thoughtSignature, 'fake-signature');
  assert.deepEqual(generations[1].body.request.contents[2].parts[0].functionResponse,
    { name: 'read_file', response: { result: { text: 'file contents' } } });
  assert.equal(generations[1].body.request.tools, undefined);
});

test('streamed function calls carry OpenAI tool deltas and a tool_calls finish reason', async t => {
  const f = await fixture(t);
  const response = await f.post({ ...request, stream: true, messages: [{ role: 'user', content: 'CALL_TOOL' }] });
  const events = (await response.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  const call = events.flatMap(item => item.choices?.[0]?.delta?.tool_calls ?? []);
  assert.equal(call[0].index, 0);
  assert.equal(call[0].function.name, 'read_file');
  assert.equal(events.at(-1).choices[0].finish_reason, 'tool_calls');
});

for (const surface of ['tui', 'web']) test(`the installed pi-ai client replays signed tools using the ${surface} bundle`, async t => {
  const f = await fixture(t);
  const sdkPath = path.resolve(__dirname, '../../packages/llm/llm-pi-ai/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js');
  const { stream } = await import(pathToFileURL(sdkPath).href);
  const bundlePath = surface === 'tui' ? path.resolve(source, '../../cordis.patch.yml')
    : path.resolve(__dirname, '../../packages/bundle/web-app/cordis.patch.yml');
  const bundle = YAML.parse(fs.readFileSync(bundlePath, 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }],
  });
  const profile = (surface === 'tui' ? bundle.flatMap(patch => patch.insert ?? []) : bundle)
    .find(row => row.id === 'llm-pi-ai').config.providers.antigravity;
  const model = { id: request.model, name: request.model, provider: 'antigravity', api: 'openai-completions',
    baseUrl: `${f.endpoint}/v1`, reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const context = { messages: [{ role: 'user', content: 'CALL_TOOL', timestamp: 0 }],
    tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }] };
  const options = { headers: profile.headers };
  const first = await stream(model, context, options).result();
  assert.notEqual(first.stopReason, 'error', first.errorMessage);
  const call = first.content.find(part => part.type === 'toolCall');
  assert.equal(call?.name, 'read_file');
  context.messages.push(first, { role: 'toolResult', toolCallId: call.id, toolName: call.name,
    content: [{ type: 'text', text: 'file contents' }], isError: false, timestamp: 1 });
  const second = await stream(model, context, options).result();
  assert.notEqual(second.stopReason, 'error', second.errorMessage);
  assert.ok(second.content.some(part => part.type === 'text' && part.text === 'สวัสดี'));
  const replay = f.requests.filter(item => item.url.startsWith('/v1internal:streamGenerateContent')).at(-1).body.request;
  assert.equal(replay.contents[1].parts[0].thoughtSignature, 'fake-signature');
});

test('missing login remains a local 503 and malformed input never reaches Google', async t => {
  const f = await fixture(t, { noToken: true });
  const response = await f.post(request);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'PROXY_UNAUTHENTICATED');
  assert.equal(f.requests.length, 0);
  const models = await fetch(`${f.endpoint}/v1/models`).then(res => res.json());
  assert.ok(models.data.some(model => model.id === 'gemini-3-flash'));
});

test('OAuth callbacks reject forged state, escape error text and consume valid state once', async t => {
  const f = await fixture(t, { noToken: true });
  const login = await fetch(`${f.endpoint}/auth/login`, { redirect: 'manual' });
  const location = new URL(login.headers.get('location'));
  assert.equal(location.searchParams.get('redirect_uri'), `${f.endpoint}/oauth/callback`);
  const state = location.searchParams.get('state');
  const forged = await fetch(`${f.endpoint}/oauth/callback?code=fake-code&state=forged`);
  assert.match(await forged.text(), /invalid callback/);
  assert.equal(f.requests.length, 0);
  const valid = await fetch(`${f.endpoint}/oauth/callback?code=fake-code&state=${state}`);
  assert.match(await valid.text(), /authenticated/);
  const replay = await fetch(`${f.endpoint}/oauth/callback?code=fake-code&state=${state}`);
  assert.match(await replay.text(), /invalid callback/);
  assert.equal(f.requests.filter(item => item.url === '/token').length, 1);
  const failure = await fetch(`${f.endpoint}/oauth/callback?error=${encodeURIComponent('<script>bad()</script>')}`);
  assert.match(failure.headers.get('content-type'), /text\/plain/);
  await failure.text();
});

test('invalid request fields return 400 before refreshing or calling upstream', async t => {
  const f = await fixture(t);
  for (const body of [null, { ...request, messages: [] }, { ...request, tools: {} },
    { ...request, messages: [{ role: 'tool', tool_call_id: 'missing', content: 'x' }] }]) {
    const response = await f.post(body);
    assert.equal(response.status, 400);
    await response.text();
  }
  assert.equal(f.requests.length, 0);
});

test('upstream quota errors retain their HTTP status', async t => {
  const f = await fixture(t, { failGeneration: true });
  const response = await f.post(request);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.type, 'upstream_error');
});

test('an upstream timeout returns 504 and health stays responsive', async t => {
  const f = await fixture(t, { hang: true });
  const response = await f.post(request);
  assert.equal(response.status, 504);
  await response.text();
  assert.equal((await fetch(`${f.endpoint}/health`)).status, 200);
});

test('malformed upstream SSE reports an error without crashing or writing a second HTTP header', async t => {
  const f = await fixture(t, { badStream: true });
  const response = await f.post({ ...request, stream: true });
  const text = await response.text();
  assert.match(text, /"type":"proxy_error"/);
  assert.ok(text.endsWith('data: [DONE]\n\n'));
  assert.equal((await fetch(`${f.endpoint}/health`)).status, 200);
});
