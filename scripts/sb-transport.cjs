#!/usr/bin/env node
// Checkout-local OpenAI transport. It never imports the legacy prompt or execution pipeline.
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

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
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: SERVICE, mode: 'passthrough', pid: process.pid,
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
      const outgoing = headers(req.headers);
      outgoing.host = backend.host;
      outgoing['content-length'] = size;
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
      upstream.end(Buffer.concat(chunks));
    });
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`SB transport listening on http://127.0.0.1:${server.address().port}`));
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
    child = spawn(process.execPath, [__filename, 'serve'], {
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
      console.log(state ? `SB transport ready on :${port}` : `SB transport unavailable on :${port}`);
      if (!state) process.exitCode = 1;
      break;
    }
    default: throw new Error('Usage: sb-transport.cjs start|stop|restart|status|serve');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
