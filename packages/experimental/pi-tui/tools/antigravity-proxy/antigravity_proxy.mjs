#!/usr/bin/env -S bun --no-env-file
/**
 * Antigravity OpenAI-compatible proxy — Bun runtime for the vendored
 * Python proxy (tools/antigravity-proxy upstream). Zero dependencies.
 *
 * Exposes:
 *   GET  /health
 *   GET  /v1/models
 *   POST /v1/chat/completions   (streaming + non-streaming)
 *
 * Auth: the proxy owns its Google OAuth chain end to end. `GET /auth/login`
 * starts a loopback flow with the embedded Antigravity OAuth client,
 * and `GET /oauth/callback` exchanges the
 * code; rotated tokens persist only to the proxy's own state file
 * (~/.gemini/antigravity-proxy-token.json, override with ANTIGRAVITY_TOKEN_FILE).
 * No Antigravity CLI installation or seed file is involved.
 *
 * Endpoints: GET /health, /v1/models, POST /v1/chat/completions (JSON or SSE),
 * GET /auth/login, /auth/status,
 * GET /oauth/callback.
 *
 * Env: ANTIGRAVITY_PORT (18877), HOST (127.0.0.1), ANTIGRAVITY_TOKEN_FILE,
 *      ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET,
 *      ANTIGRAVITY_API_BASE, ANTIGRAVITY_OAUTH_TOKEN_URL, ANTIGRAVITY_TIMEOUT_MS.
 * Endpoint overrides are for trusted local simulations; they receive OAuth credentials.
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import { toCloudCodeRequest, replyCloudCode } from './protocol.mjs'

const PORT = Number(process.env.ANTIGRAVITY_PORT ?? 18877)
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('Invalid ANTIGRAVITY_PORT')
const HOST = process.env.HOST ?? '127.0.0.1'
const TOKEN_STATE_FILE = process.env.ANTIGRAVITY_TOKEN_FILE
  ?? join(homedir(), '.gemini', 'antigravity-proxy-token.json')
const OAUTH_TOKEN_URL = process.env.ANTIGRAVITY_OAUTH_TOKEN_URL ?? 'https://oauth2.googleapis.com/token'
// The Antigravity CLI's own embedded OAuth client (present in every agy
// binary, not a per-user credential); stored split-encoded to match how the
// upstream CLI and the opencode plugin both ship it.
const DEFAULT_CLIENT_ID = Buffer.from(
  'MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==',
  'base64',
).toString()
const DEFAULT_CLIENT_SECRET = ['GOCSPX-K58FWR486Ld', 'LJ1mLB8sXC4z6qDAf'].join('')
const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID ?? DEFAULT_CLIENT_ID
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET ?? DEFAULT_CLIENT_SECRET
const CCA_BASE = process.env.ANTIGRAVITY_API_BASE ?? 'https://daily-cloudcode-pa.googleapis.com'
const REQUEST_TIMEOUT_MS = Number(process.env.ANTIGRAVITY_TIMEOUT_MS ?? 60_000)
const REFRESH_SKEW_MS = 120_000

const log = (...parts) => console.log('[antigravity-proxy]', ...parts)

/** Parse the token file's expiry field: unix number or RFC3339 string. */
function expiryToMs(raw) {
  if (!raw) return 0
  if (typeof raw === 'number') return raw
  const ms = Date.parse(String(raw))
  return Number.isNaN(ms) ? 0 : ms
}

/** Token chain state: one file owned exclusively by this proxy. */
let tokenState
/** Live auth health for /auth/status and the request-time hint. */
const auth = { ok: false, error: undefined }

function initToken() {
  if (!existsSync(TOKEN_STATE_FILE)) return
  try {
    const raw = JSON.parse(readFileSync(TOKEN_STATE_FILE, 'utf8'))
    tokenState = raw.token ?? raw
    tokenState.expiry = expiryToMs(tokenState.expiry)
  } catch (error) {
    log(`ERROR: could not read state file ${TOKEN_STATE_FILE}:`, error.message)
    log(`Delete it and re-run; then open /auth/login to re-authenticate.`)
    process.exit(1)
  }
  if (!tokenState.refresh_token) {
    log(`ERROR: no refresh_token in ${TOKEN_STATE_FILE}. Delete it and re-run to re-authenticate.`)
    process.exit(1)
  }
  auth.ok = true
  log(`state file OK: ${TOKEN_STATE_FILE}`)
}

function persistToken() {
  const wrapped = { token: tokenState, auth_method: 'oauth' }
  try {
    mkdirSync(dirname(TOKEN_STATE_FILE), { recursive: true })
    const tmp = `${TOKEN_STATE_FILE}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(wrapped), { flag: 'wx', mode: 0o600 })
    renameSync(tmp, TOKEN_STATE_FILE)
    try { chmodSync(TOKEN_STATE_FILE, 0o600) } catch { /* best effort on Windows */ }
  } catch (error) {
    log('WARNING: could not persist token:', error.message)
  }
}

// One loopback login at a time; the state parameter rejects forged callbacks.
let pendingAuth
const callbackUrl = () => `http://127.0.0.1:${server.address().port}/oauth/callback`

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

async function exchangeAuthCode(code) {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: callbackUrl(),
      grant_type: 'authorization_code',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(`authorization exchange failed (HTTP ${response.status}): ${payload.error ?? 'no token payload'}`)
  }
  tokenState = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expiry: Date.now() + (payload.expires_in ?? 3600) * 1000,
  }
  persistToken()
  auth.ok = true
  auth.error = undefined
  log('authenticated; token chain saved to', TOKEN_STATE_FILE)
}

let refreshInFlight
async function ensureAccessToken() {
  if (!tokenState?.refresh_token) throw Object.assign(new Error('not authenticated; open /auth/login'), { statusCode: 503 })
  const expires = expiryToMs(tokenState.expiry)
  if (tokenState.access_token && Date.now() < expires - REFRESH_SKEW_MS) {
    return tokenState.access_token
  }
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    log('refreshing access token …')
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokenState.refresh_token,
      grant_type: 'refresh_token',
    })
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) {
      auth.ok = false
      auth.error = `OAuth refresh failed (HTTP ${response.status}) — open http://127.0.0.1:${PORT}/auth/login to re-authenticate`
      await response.body?.cancel()
      log('ERROR:', auth.error)
      throw new Error(auth.error)
    }
    const payload = await response.json()
    if (typeof payload.access_token !== 'string' || !payload.access_token) throw new Error('OAuth refresh returned no access token')
    tokenState.access_token = payload.access_token
    if (payload.refresh_token !== undefined) tokenState.refresh_token = payload.refresh_token
    tokenState.expiry = Date.now() + (payload.expires_in ?? 3600) * 1000
    persistToken()
    auth.ok = true
    auth.error = undefined
    return tokenState.access_token
  })()
  try { return await refreshInFlight } finally { refreshInFlight = undefined }
}

let projectInFlight
async function ensureProject(accessToken, signal) {
  if (tokenState.project_id) return tokenState.project_id
  if (projectInFlight) return projectInFlight
  projectInFlight = (async () => {
    const post = async (operation, body) => {
      const response = await fetch(`${CCA_BASE}/v1internal:${operation}`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Cloud Code ${operation} failed (HTTP ${response.status})`)
      }
      return response.json()
    }
    const projectFrom = result => {
      const value = result.cloudaicompanionProject ?? result.projectId ?? result.project
      return typeof value === 'string' ? value : value?.id
    }
    const loaded = await post('loadCodeAssist', { metadata: { ideType: 'ANTIGRAVITY' } })
    let project = projectFrom(loaded)
    if (!project) {
      const tier = loaded.allowedTiers?.find(item => item.isDefault)?.id ?? loaded.currentTier?.id ?? 'free-tier'
      for (let attempt = 0; attempt < 5 && !project; attempt++) {
        if (attempt) await sleep(1000, undefined, { signal })
        const onboarded = await post('onboardUser', { tier_id: tier, metadata: { ide_type: 'ANTIGRAVITY' } })
        project = projectFrom(onboarded.response ?? onboarded)
      }
    }
    if (typeof project !== 'string' || !project.trim()) throw new Error('Cloud Code did not return a project; complete Antigravity account setup and retry')
    tokenState.project_id = project
    persistToken()
    return project
  })()
  try { return await projectInFlight } finally { projectInFlight = undefined }
}

/** POST Cloud Code Assist with OAuth; caller keys are never forwarded to Google. */
async function callCloudCode(body, translated, signal) {
  const accessToken = await ensureAccessToken()
  const project = await ensureProject(accessToken, signal)
  const payload = {
    model: body.model, project, requestId: `agent-${randomBytes(16).toString('hex')}`,
    request: translated,
  }
  return fetch(`${CCA_BASE}/v1internal:${body.stream === true ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
    method: 'POST', signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })
}

const KNOWN_MODELS = [
  { id: 'gemini-3.1-pro', owned_by: 'google' },
  { id: 'gemini-3-flash', owned_by: 'google' },
  { id: 'gemini-3.5-flash', owned_by: 'google' },
  { id: 'gemini-2.5-pro', owned_by: 'google' },
  { id: 'gemini-2.5-flash', owned_by: 'google' },
]

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', service: 'antigravity-proxy', authenticated: auth.ok }))
      return
    }
    if (url.pathname === '/auth/login') {
      pendingAuth = { state: randomBytes(16).toString('hex'), expires: Date.now() + 300_000 }
      response.writeHead(302, { Location: buildAuthUrl(pendingAuth.state) })
      response.end()
      return
    }
    if (url.pathname === '/oauth/callback') {
      const problem = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const page = (title, body) => {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(`${title}\n\n${body}`)
      }
      if (problem) {
        pendingAuth = undefined
        page('Antigravity proxy — sign-in failed', `Google returned: ${problem}. Close this tab and try again.`)
        return
      }
      if (!code || !pendingAuth || state !== pendingAuth.state || Date.now() > pendingAuth.expires) {
        page('Antigravity proxy — invalid callback', 'Missing or mismatched OAuth state. Start again from /auth/login.')
        return
      }
      pendingAuth = undefined
      try {
        await exchangeAuthCode(code)
        pendingAuth = undefined
        page('Antigravity proxy — authenticated', 'Token chain saved. You can close this tab and use the proxy.')
      } catch (error) {
        pendingAuth = undefined
        page('Antigravity proxy — exchange failed', String(error.message ?? error))
      }
      return
    }
    if (url.pathname === '/auth/status') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        authenticated: auth.ok,
        ...(auth.error !== undefined ? { error: auth.error } : {}),
        loginUrl: `http://127.0.0.1:${PORT}/auth/login`,
      }))
      return
    }
    if (url.pathname === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: KNOWN_MODELS.map(m => ({ ...m, object: 'model', created: 0 })) }))
      return
    }
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
      if (!tokenState?.refresh_token) {
        response.writeHead(503, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          error: {
            message: `not authenticated — open http://127.0.0.1:${PORT}/auth/login once in a browser`,
            type: 'proxy_error',
            code: 'PROXY_UNAUTHENTICATED',
          },
        }))
        return
      }
      let body = ''
      let bytes = 0
      const decoder = new TextDecoder()
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 32 * 1024 * 1024) throw Object.assign(new Error('request body exceeds 32 MiB'), { statusCode: 413 })
        body += decoder.decode(chunk, { stream: true })
      }
      body += decoder.decode()
      let parsed
      try { parsed = JSON.parse(body) } catch { throw Object.assign(new Error('invalid request JSON'), { statusCode: 400 }) }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('request must be an object'), { statusCode: 400 })
      const translated = toCloudCodeRequest(parsed)
      const disconnected = new AbortController()
      response.once('close', () => disconnected.abort())
      const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      const upstream = await callCloudCode(parsed, translated, signal)
      if (!upstream.ok) {
        await upstream.body?.cancel()
        response.writeHead(upstream.status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: `Cloud Code request failed (HTTP ${upstream.status})`, type: 'upstream_error', code: upstream.status } }))
        return
      }
      await replyCloudCode(upstream, response, parsed)
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: `unknown path ${url.pathname}` } }))
  } catch (error) {
    log('request failed:', error.message)
    if (response.destroyed) return
    const payload = { error: { message: String(error.message ?? error), type: 'proxy_error' } }
    if (response.headersSent) response.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`)
    else {
      response.writeHead(error.statusCode ?? (error.name === 'TimeoutError' ? 504 : 502), { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(payload))
    }
  }
})

initToken()
server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${server.address().port}`)
  log(`token state: ${TOKEN_STATE_FILE}`)
  if (!auth.ok) log(`not authenticated yet — open http://127.0.0.1:${PORT}/auth/login in a browser once`)
})
