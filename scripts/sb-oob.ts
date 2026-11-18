#!/usr/bin/env bun
/**
 * OOB interaction collector for blind vuln classes (SSRF, blind XSS, deser,
 * log4j, DNS rebinding spillover). Two modes:
 *   local   — listener inside the VPN namespace; reachable from LAN/tailnet targets.
 *   webhook — webhook.site token; reachable from internet targets through Mullvad egress.
 *
 * Usage:
 *   oob new [--mode local|webhook] [--note text]     mint a token + URL
 *   oob hits <token>                                 print collected hits (JSONL)
 *   oob list                                         list tokens
 *   oob serve [--port 18898] [--host 0.0.0.0]        run the local listener
 *
 * Hits are appended to ~/.dsh/oob/<token>.jsonl (mode local) or fetched from
 * webhook.site on demand (mode webhook). Nothing here is VPN-specific.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const ROOT = join(homedir(), '.dsh', 'oob')
mkdirSync(ROOT, { recursive: true })

const DEFAULT_PORT = 18898

interface OobMeta { token: string; mode: string; note: string; url: string; uuid?: string; createdAt: string }
function metaPath(token: string) { return join(ROOT, `${token}.json`) }
function hitsPath(token: string) { return join(ROOT, `${token}.jsonl`) }

function readMeta(token: string): OobMeta | null {
  try { return JSON.parse(readFileSync(metaPath(token), 'utf8')) } catch { return null }
}

async function mintToken(mode: string, note: string) {
  const token = randomBytes(9).toString('hex')
  let url
  if (mode === 'webhook') {
    const res = await fetch('https://webhook.site/token', { method: 'POST' })
    if (!res.ok) throw new Error(`webhook.site token failed: ${res.status}`)
    const data = await res.json()
    url = `https://webhook.site/${data.uuid}`
    const meta = { token, mode, note: note ?? '', url, uuid: data.uuid, createdAt: new Date().toISOString() }
    writeFileSync(metaPath(token), JSON.stringify(meta, null, 2))
    console.log(JSON.stringify(meta, null, 2))
    return
  }
  const port = Number(process.env.OOB_PUBLIC_PORT || DEFAULT_PORT)
  const host = process.env.OOB_PUBLIC_HOST || '127.0.0.1'
  url = `http://${host}:${port}/${token}`
  const meta = { token, mode: 'local', note: note ?? '', url, createdAt: new Date().toISOString() }
  writeFileSync(metaPath(token), JSON.stringify(meta, null, 2))
  console.log(JSON.stringify(meta, null, 2))
}

function record(token: string, entry: Record<string, unknown>) {
  appendFileSync(hitsPath(token), JSON.stringify(entry) + '\n')
}

async function printHits(token: string) {
  const meta = readMeta(token)
  if (!meta) { console.error('unknown token'); process.exit(2) }
  if (meta.mode === 'webhook') {
    const res = await fetch(`https://webhook.site/token/${meta.uuid}/requests?sorting=newest`)
    if (!res.ok) throw new Error(`webhook.site hits failed: ${res.status}`)
    const data = await res.json()
    for (const hit of data.data ?? []) {
      console.log(JSON.stringify({
        at: hit.created_at, ip: hit.ip, method: hit.method, url: hit.url,
        ua: hit.user_agent, headers: hit.headers, body: hit.content,
      }))
    }
    if (!(data.data ?? []).length) console.log('(no hits)')
    return
  }
  if (!existsSync(hitsPath(token))) { console.log('(no hits)'); return }
  process.stdout.write(readFileSync(hitsPath(token), 'utf8'))
}

function listTokens() {
  for (const file of readdirSync(ROOT).filter(f => f.endsWith('.json'))) {
    const meta = JSON.parse(readFileSync(join(ROOT, file), 'utf8'))
    const count = existsSync(hitsPath(meta.token)) ? readFileSync(hitsPath(meta.token), 'utf8').trim().split('\n').length : 0
    console.log(`${meta.token}\t${meta.mode}\thits=${count}\t${meta.url}\t${meta.note}`)
  }
}

function serve(port: number, host: string) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://oob')
    const token = url.pathname.split('/').filter(Boolean)[0] ?? ''
    let body = ''
    req.on('data', (part) => { if (body.length < 8192) body += part.toString('utf8') })
    req.on('end', () => {
      if (token && readMeta(token)) {
        record(token, {
          at: new Date().toISOString(),
          ip: req.socket.remoteAddress,
          method: req.method,
          path: url.pathname + url.search,
          ua: req.headers['user-agent'] ?? '',
          headers: req.headers,
          body: body.slice(0, 4096),
        })
        console.log(`[oob] hit ${token} ${req.method} ${url.pathname}`)
      }
      res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
      res.end('ok')
    })
  })
  server.listen(port, host, () => console.log(`[oob] listening on ${host}:${port} (root=${ROOT})`))
}

const [command, argument] = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`)
  const value = process.argv[index + 1]
  return index > -1 && value ? value : fallback
}
try {
  switch (command) {
    case 'new': await mintToken(flag('mode', 'local'), flag('note', '')); break
    case 'hits': await printHits(argument ?? ''); break
    case 'list': listTokens(); break
    case 'serve': serve(Number(flag('port', String(DEFAULT_PORT))), flag('host', '0.0.0.0')); break
    default:
      console.error('usage: oob new [--mode local|webhook] [--note text] | oob hits <token> | oob list | oob serve [--port N] [--host H]')
      process.exit(2)
  }
} catch (error) {
  console.error('oob error:', (error as Error).message)
  process.exit(1)
}
