// sb-transport.cjs — checkout-local OpenAI transport with the SB Proxy v6
// pipeline mounted on non-stream /v1/chat/completions requests. Everything
// else (health, CONNECT tunnel, streaming, non-chat endpoints) stays
// passthrough exactly as the original transport.
const http = require('node:http');
const net = require('node:net');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const SERVICE = 'dsh-sb-transport';
const home = path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
const port = Number(process.env.SB_PORT || 18899);
const timeout = Number(process.env.SB_TIMEOUT_MS || 120000);
let backend;
try { backend = new URL(process.env.SB_BACKEND || 'http://127.0.0.1:20128/v1'); }
catch { throw new Error('SB_BACKEND must be an absolute HTTP(S) base URL'); }
if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash) {
  throw new Error('SB_BACKEND must be an HTTP(S) base URL without credentials, query or fragment');
}
if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isFinite(timeout) || timeout <= 0) {
  throw new Error('Invalid SB_PORT or SB_TIMEOUT_MS');
}
backend.pathname = backend.pathname.replace(/\/+$/, '') || '/v1';
const stateFile = path.join(home, 'run', `sb-transport-${port}.json`);
const logFile = path.join(home, 'logs', `sb-transport-${port}.log`);

// SB Proxy v6 pipeline: processBody/processResponse over the same backend.
// The v6 module binds its own port only when run directly; required here it
// just exports the request/response transforms and server factory.
const v6Path = path.join(__dirname, 'sb-proxy-v6.cjs');
let v6 = null;
try { v6 = require(v6Path); } catch (error) {
  console.error('[sb-transport] v6 pipeline unavailable, passthrough only:', error.message);
}

async function health() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    const state = await response.json();
    return response.ok && state.service === SERVICE ? state : null;
  } catch { return null; }
}

function headers(source) {
  const copy = { ...source };
  const connection = String(copy.connection || '').split(',').map(name => name.trim().toLowerCase());
  for (const name of [...connection, 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade']) delete copy[name];
  return copy;
}

function serve() {
  const tokenFile = path.join(home, 'run', 'sb-connect.key');
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const token = fs.readFileSync(tokenFile, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid SB CONNECT credential file; repair the runtime-owned key');
  const authorization = Buffer.from(`Basic ${Buffer.from(`dsh:${token}`).toString('base64')}`);
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: SERVICE, mode: v6 ? 'v6-pipeline' : 'passthrough', supportsConnect: true, pid: process.pid,
        backend: backend.href, port: server.address().port }));
      return;
    }
    if (!/^\/v1(?:\/|\?|$)/.test(req.url)) { res.writeHead(404); res.end(); return; }
    let size = 0;
    const chunks = [];
    req.on('error', () => res.destroy());
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) {
        if (!res.writableEnded) { res.writeHead(413, { Connection: 'close' }); res.end(); }
        chunks.length = 0;
      } else if (!res.writableEnded) chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.destroyed || res.writableEnded) return;
      const started = performance.now();
      const rawBody = Buffer.concat(chunks);
      const isChat = req.method === 'POST' && req.url.includes('chat/completions');
      const isStream = isChat && /"stream"\s*:\s*true/.test(rawBody.toString('utf8'));
      // v6 pipeline enriches every chat request body (operator frame, skill,
      // wiki, recon) before dispatch. Stream requests forward the enriched
      // body and pipe the upstream SSE back untouched; only non-stream
      // responses go through processResponse (execution chain, retry).
      if (v6 && isChat) {
        (async () => {
          try {
            const processedBody = await v6.processBody(rawBody.toString('utf8'));
            // processBody returns either a processed request string (LLM path)
            // or { __directResponse } when a Kali direct tool answered without
            // an LLM round-trip.
            if (processedBody && typeof processedBody === 'object' && processedBody.__directResponse) {
              if (isStream) {
                const d = processedBody.__directResponse;
                const content = d.choices?.[0]?.message?.content ?? '';
                const first = { id: d.id, object: 'chat.completion.chunk', created: d.created, model: d.model, sb_intent: d.sb_intent, sb_target: d.sb_target, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] };
                const last = { id: d.id, object: 'chat.completion.chunk', created: d.created, model: d.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
                  'server-timing': `sb-upstream;dur=${(performance.now() - started).toFixed(1)}` });
                res.end(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`);
                return;
              }
              const buf = Buffer.from(JSON.stringify(processedBody.__directResponse), 'utf8');
              res.writeHead(200, { 'Content-Type': 'application/json', 'content-length': buf.length,
                'server-timing': `sb-upstream;dur=${(performance.now() - started).toFixed(1)}` });
              res.end(buf);
              return;
            }
            const requestBody = typeof processedBody === 'string' ? processedBody : rawBody.toString('utf8');
            const outgoing = headers(req.headers);
            outgoing.host = backend.host;
            outgoing['content-length'] = Buffer.byteLength(requestBody);
            if (process.env.SB_BACKEND_KEY) outgoing.authorization = `Bearer ${process.env.SB_BACKEND_KEY}`;
            const upstream = (backend.protocol === 'https:' ? https : http).request({
              hostname: backend.hostname, port: backend.port || undefined, method: req.method,
              path: backend.pathname.replace(/\/$/, '') + req.url.replace(/^\/v1/, ''), headers: outgoing,
            }, response => {
              clearTimeout(deadline);
              response.on('error', () => res.destroy());
              if (isStream) {
                // Stream refusal guard: buffer the SSE body, check the final
                // content for refusal-shaped replies, hard-retry once, then
                // re-emit as proper chat.completion.chunk SSE. Falls back to
                // the buffered original on any error.
                let sse = '';
                response.on('data', c => { sse += c; });
                response.on('end', async () => {
                  try {
                    let content = '';
                    let meta = null;
                    let retryTried = false;
                    if (v6?.collectSseContent && v6?.REFUSAL_RE) {
                      const collected = v6.collectSseContent(sse);
                      if (collected && collected.content) {
                        meta = collected;
                        if (v6.REFUSAL_RE.test(collected.content.slice(0, 300))) {
                          console.log('[sb-transport] stream refusal detected — hard retry');
                          retryTried = true;
                          let reqData = null;
                          try { reqData = JSON.parse(requestBody); } catch { }
                          const retried = await v6.refusalHardRetry(reqData?.messages, collected.model || reqData?.model, { stream: true });
                          if (retried) content = retried;
                        } else {
                          content = collected.content;
                        }
                      }
                    }
                    if (!content) {
                      // passthrough the buffered SSE unchanged
                      res.writeHead(response.statusCode, headers(response.headers));
                      res.end(sse);
                      return;
                    }
                    const id = meta?.id || 'sb-stream-guard';
                    const created = meta?.created || Math.floor(Date.now() / 1000);
                    const model = meta?.model || 'unknown';
                    const parts = [];
                    parts.push({ id, object: 'chat.completion.chunk', created, model, sb_refusal_retry: retryTried, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
                    for (let i = 0; i < content.length; i += 512) {
                      parts.push({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: content.slice(i, i + 512) }, finish_reason: null }] });
                    }
                    parts.push({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
                    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
                    const out = parts.map(p => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';
                    res.end(out);
                  } catch (guardError) {
                    console.error('[sb-transport] stream guard error:', guardError.message);
                    try {
                      res.writeHead(response.statusCode, headers(response.headers));
                      res.end(sse);
                    } catch { }
                  }
                });
                return;
              }
              let respBody = '';
              response.on('data', c => { respBody += c; });
              response.on('end', async () => {
                try {
                  const processed = await v6.processResponse(respBody, requestBody);
                  let clean = processed;
                  const objStart = processed.indexOf('{');
                  if (objStart !== -1) {
                    let depth = 0, inStr = false, esc = false, objEnd = -1;
                    for (let i = objStart; i < processed.length; i++) {
                      const ch = processed[i];
                      if (esc) { esc = false; continue; }
                      if (ch === '\\') { esc = true; continue; }
                      if (ch === '"') { inStr = !inStr; continue; }
                      if (inStr) continue;
                      if (ch === '{') depth++;
                      else if (ch === '}') { depth--; if (depth === 0) { objEnd = i + 1; break; } }
                    }
                    if (objEnd !== -1) {
                      try { clean = JSON.stringify(JSON.parse(processed.slice(objStart, objEnd))); }
                      catch { /* keep raw body when the object does not parse */ }
                    }
                  }
                  const buf = Buffer.from(clean, 'utf8');
                  const { 'content-encoding': _enc, 'content-length': _len, ...respHeaders } = headers(response.headers);
                  res.writeHead(response.statusCode, { ...respHeaders,
                    'content-length': buf.length,
                    'server-timing': `sb-upstream;dur=${(performance.now() - started).toFixed(1)}` });
                  res.end(buf);
                } catch (error) {
                  console.error('[sb-transport] v6 response error, raw passthrough:', error.message);
                  res.writeHead(response.statusCode, headers(response.headers));
                  res.end(respBody);
                }
              });
            });
            let timedOut = false;
            const expire = () => { timedOut = true; upstream.destroy(new Error('Upstream timeout')); };
            const deadline = setTimeout(expire, timeout);
            upstream.once('close', () => clearTimeout(deadline));
            upstream.setTimeout(timeout, expire);
            upstream.on('error', () => {
              if (res.destroyed) return;
              if (res.headersSent) { res.destroy(); return; }
              res.writeHead(timedOut ? 504 : 502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: timedOut ? 'Upstream idle timeout' : 'Upstream unavailable' } }));
            });
            upstream.end(requestBody);
          } catch (error) {
            console.error('[sb-transport] v6 request error, raw passthrough:', error.message);
            // Fall through to a plain passthrough with the original body.
            passthrough(req, res, rawBody, started);
          }
        })();
        return;
      }
      passthrough(req, res, rawBody, started);
    });
    function passthrough(req, res, rawBody, started) {
      const outgoing = headers(req.headers);
      outgoing.host = backend.host;
      outgoing['content-length'] = rawBody.length;
      // The caller supplies its router credential; an explicit deployment key may override it.
      if (process.env.SB_BACKEND_KEY) outgoing.authorization = `Bearer ${process.env.SB_BACKEND_KEY}`;
      const upstream = (backend.protocol === 'https:' ? https : http).request({
        hostname: backend.hostname, port: backend.port || undefined, method: req.method,
        path: backend.pathname.replace(/\/$/, '') + req.url.replace(/^\/v1/, ''), headers: outgoing,
      }, response => {
        clearTimeout(deadline);
        response.on('error', () => res.destroy());
        res.writeHead(response.statusCode, { ...headers(response.headers),
          'server-timing': `sb-upstream;dur=${(performance.now() - started).toFixed(1)}` });
        response.pipe(res);
      });
      res.once('close', () => upstream.destroy());
      let timedOut = false;
      const expire = () => { timedOut = true; upstream.destroy(new Error('Upstream timeout')); };
      const deadline = setTimeout(expire, timeout);
      upstream.once('close', () => clearTimeout(deadline));
      upstream.setTimeout(timeout, expire);
      upstream.on('error', () => {
        if (res.destroyed) return;
        if (res.headersSent) { res.destroy(); return; }
        res.writeHead(timedOut ? 504 : 502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: timedOut ? 'Upstream idle timeout' : 'Upstream unavailable' } }));
      });
      upstream.end(rawBody);
    }
  });
  server.on('connect', (req, client, head) => {
    const supplied = Buffer.from(req.headers['proxy-authorization'] || '');
    if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="dsh-sb-transport"\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!/^(?:\[[0-9a-fA-F:]+\]|[^\s/:?#@]+):\d+$/.test(req.url)) {
      client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    let target;
    try { target = new URL(`http://${req.url}`); }
    catch { client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    const targetPort = Number(req.url.match(/:(\d+)$/)[1]);
    if (targetPort < 1 || targetPort > 65535) {
      client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = net.connect({ host: target.hostname.replace(/^\[|\]$/g, ''), port: targetPort });
    let connected = false;
    upstream.once('connect', () => {
      connected = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.setTimeout(timeout, () => upstream.destroy(new Error('Tunnel idle timeout')));
    upstream.once('error', () => {
      if (connected) client.destroy();
      else client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    client.once('error', () => upstream.destroy());
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => { if (connected && !upstream.readableEnded) client.destroy(); });
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`SB transport listening on http://127.0.0.1:${server.address().port} (mode: ${v6 ? 'v6-pipeline' : 'passthrough'})`));
}

async function start() {
  if (port === 0) throw new Error('Use a fixed SB_PORT for managed startup');
  const existing = await health();
  if (existing) {
    if (existing.backend !== backend.href) throw new Error('SB transport already uses a different SB_BACKEND');
    console.log(`SB transport ready on :${port}`);
    return;
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, 'a', 0o600);
  let child;
  try {
    child = spawn('bun', ['--no-env-file', __filename, 'serve'], {
      cwd: __dirname, env: process.env, detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
    });
  } finally { fs.closeSync(fd); }
  let spawnError;
  child.on('error', error => { spawnError = error; });
  // Graceful helper shutdown cleans up incomplete startup where the OS delivers signals.
  const cancel = () => { child.kill(); process.exit(1); };
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (spawnError) throw spawnError;
      const ready = await health();
      if (ready && ready.backend === backend.href) {
        if (ready.pid === child.pid) {
          fs.mkdirSync(path.dirname(stateFile), { recursive: true });
          fs.writeFileSync(stateFile, JSON.stringify({ pid: child.pid }), { mode: 0o600 });
        } else child.kill();
        child.unref();
        console.log(`SB transport ready on :${port}`);
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`SB transport could not bind :${port}; check port ownership and ${logFile}`);
  } catch (error) { child.kill(); throw error; }
  finally { process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel); }
}

async function stop() {
  const current = await health();
  let saved;
  try { saved = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current && current.pid !== saved?.pid) throw new Error('SB listener is not owned by this runtime; left running');
  if (current) {
    process.kill(current.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!await health()) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (await health()) throw new Error('SB transport did not stop');
  }
  fs.rmSync(stateFile, { force: true });
}

async function main() {
  switch (process.argv[2] || 'status') {
    case 'serve': serve(); break;
    case 'start': await start(); break;
    case 'stop': await stop(); break;
    case 'restart': await stop(); await start(); break;
    case 'status': {
      const state = await health();
      console.log(state ? `SB transport ready on :${port} (mode ${state.mode})` : `SB transport unavailable on :${port}`);
      if (!state) process.exitCode = 1;
      break;
    }
    default: throw new Error('Usage: sb-transport.cjs start|stop|restart|status|serve');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
