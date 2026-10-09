#!/usr/bin/env node
/**
 * Antigravity OpenAI-compatible proxy — Node rewrite of the vendored
 * Python proxy (tools/antigravity-proxy upstream). Zero dependencies.
 *
 * Exposes:
 *   GET  /health
 *   GET  /v1/models
 *   POST /v1/chat/completions   (streaming + non-streaming)
 *
 * Auth: the proxy owns its Google OAuth chain end to end. `GET /auth/login`
 * starts a loopback flow with the public Gemini CLI client (the same client
 * the open-source gemini-cli embeds) and `GET /oauth/callback` exchanges the
 * code; rotated tokens persist only to the proxy's own state file
 * (~/.gemini/antigravity-proxy-token.json, override with ANTIGRAVITY_TOKEN_FILE).
 * No Antigravity CLI installation or seed file is involved.
 *
 * Endpoints: GET /health, /v1/models, POST /v1/chat/completions (streaming
 * accepted, folded to one JSON response), GET /auth/login, /auth/status,
 * GET /oauth/callback.
 *
 * Env: PORT (8877), HOST (127.0.0.1), ANTIGRAVITY_TOKEN_FILE,
 *      ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const PORT = Number(process.env.PORT ?? 8877)
const HOST = process.env.HOST ?? '127.0.0.1'
const TOKEN_STATE_FILE = process.env.ANTIGRAVITY_TOKEN_FILE
  ?? join(homedir(), '.gemini', 'antigravity-proxy-token.json')
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
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
const CCA_BASE = 'https://daily-cloudcode-pa.googleapis.com'
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
  auth.ok = Boolean(tokenState.access_token) && Date.now() < tokenState.expiry - REFRESH_SKEW_MS
  log(`state file OK: ${TOKEN_STATE_FILE}${auth.ok ? '' : ' (access expired — it refreshes on the next request)'}`)
}

function persistToken() {
  const wrapped = { token: tokenState, auth_method: 'oauth' }
  try {
    mkdirSync(dirname(TOKEN_STATE_FILE), { recursive: true })
    const tmp = `${TOKEN_STATE_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(wrapped))
    renameSync(tmp, TOKEN_STATE_FILE)
    try { chmodSync(TOKEN_STATE_FILE, 0o600) } catch { /* best effort on Windows */ }
  } catch (error) {
    log('WARNING: could not persist token:', error.message)
  }
}

// One loopback login at a time; the state parameter rejects forged callbacks.
let pendingAuth

function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `http://127.0.0.1:${PORT}/oauth/callback`,
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: `http://127.0.0.1:${PORT}/oauth/callback`,
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
  const expires = expiryToMs(tokenState.expiry)
  if (tokenState.access_token && Date.now() < expires - REFRESH_SKEW_MS) {
    return tokenState.access_token
  }
  refreshInFlight ??= (async () => {
    log('refreshing access token …')
    const body = JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokenState.refresh_token,
      grant_type: 'refresh_token',
    })
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      refreshInFlight = undefined
      auth.ok = false
      auth.error = `OAuth refresh failed (HTTP ${response.status}) — open http://127.0.0.1:${PORT}/auth/login to re-authenticate`
      log('ERROR:', auth.error, detail.slice(0, 200))
      throw new Error(auth.error)
    }
    const payload = await response.json()
    tokenState.access_token = payload.access_token
    if (payload.refresh_token !== undefined) tokenState.refresh_token = payload.refresh_token
    tokenState.expiry = Date.now() + (payload.expires_in ?? 3600) * 1000
    persistToken()
    refreshInFlight = undefined
    auth.ok = true
    auth.error = undefined
    return tokenState.access_token
  })()
  return refreshInFlight
}

/** POST one Cloud Code Assist call and return its raw JSON/SSE body text. */
async function callCloudCode(model, apiKey, messages, stream) {
  const accessToken = await ensureAccessToken()
  const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }))
  const payload = {
    model,
    project: tokenState.project_id ?? undefined,
    request: {
      contents,
      ...(systemText !== '' ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      generationConfig: { maxOutputTokens: 8192 },
    },
  }
  const response = await fetch(`${CCA_BASE}/v1internal:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Goog-Api-Key': apiKey,
      ...(tokenState.project_id !== undefined ? { 'x-tenant-id': tokenState.project_id } : {}),
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  return { status: response.status, text, stream }
}

/** Fold Cloud Code Assist SSE/JSON into one OpenAI chat-completions response. */
function toOpenAiResponse(bodyText, model) {
  let text = ''
  const chunks = []
  for (const raw of bodyText.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    try { chunks.push(JSON.parse(payload)) } catch { /* skip malformed SSE frames */ }
  }
  const root = chunks.length === 1 ? chunks[0] : { responses: chunks }
  const sources = chunks.length > 0 ? chunks : [JSON.parse(bodyText)]
  for (const source of sources) {
    for (const candidate of source.response?.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (typeof part.text === 'string') text += part.text
      }
    }
  }
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
    usage: root.response?.usageMetadata ?? undefined,
  }
}

const KNOWN_MODELS = [
  { id: 'gemini-3.1-pro', owned_by: 'google' },
  { id: 'gemini-3-flash', owned_by: 'google' },
  { id: 'gemini-3.5-flash', owned_by: 'google' },
  { id: 'gemini-2.5-pro', owned_by: 'google' },
  { id: 'gemini-2.5-flash', owned_by: 'google' },
]

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  try {
    if (url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', service: 'antigravity-proxy', authenticated: auth.ok }))
      return
    }
    if (url.pathname === '/auth/login') {
      pendingAuth = { state: randomBytes(16).toString('hex') }
      response.writeHead(302, { Location: buildAuthUrl(pendingAuth.state) })
      response.end()
      return
    }
    if (url.pathname === '/oauth/callback') {
      const problem = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const page = (title, body) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:sans-serif;background:#111;color:#eee;text-align:center;padding-top:15vh"><h1>${title}</h1><p>${body}</p></body>`)
      }
      if (problem) {
        pendingAuth = undefined
        page('Antigravity proxy — sign-in failed', `Google returned: ${problem}. Close this tab and try again.`)
        return
      }
      if (!code || !pendingAuth || state !== pendingAuth.state) {
        page('Antigravity proxy — invalid callback', 'Missing or mismatched OAuth state. Start again from /auth/login.')
        return
      }
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
      if (!auth.ok || !tokenState) {
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
      for await (const chunk of request) body += chunk
      const { model = 'gemini-3-flash', messages = [], stream = false } = JSON.parse(body)
      const apiKey = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? 'antigravity'
      const { status, text } = await callCloudCode(model, apiKey, messages, stream === true)
      if (status >= 400) {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: text.slice(0, 400), type: 'upstream_error', code: status } }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(toOpenAiResponse(text, model)))
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: `unknown path ${url.pathname}` } }))
  } catch (error) {
    log('request failed:', error.message)
    response.writeHead(502, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: String(error.message ?? error), type: 'proxy_error' } }))
  }
})

initToken()
server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`)
  log(`token state: ${TOKEN_STATE_FILE}`)
  if (!auth.ok) log(`not authenticated yet — open http://127.0.0.1:${PORT}/auth/login in a browser once`)
})
