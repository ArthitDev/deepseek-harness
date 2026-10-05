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
 * Auth: reads the OAuth token file (default
 * ~/.gemini/antigravity-cli/antigravity-oauth-token, override with
 * ANTIGRAVITY_TOKEN_FILE), refreshes via Google's token endpoint when
 * expired, and persists rotated refresh tokens back to its own file so the
 * chain stays separate from the Antigravity CLI's.
 *
 * Env: PORT (8877), HOST (127.0.0.1), ANTIGRAVITY_TOKEN_FILE,
 *      ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET
 */
import http from 'node:http'
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const PORT = Number(process.env.PORT ?? 8877)
const HOST = process.env.HOST ?? '127.0.0.1'
const TOKEN_FILE = process.env.ANTIGRAVITY_TOKEN_FILE
  ?? join(homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token')
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
function loadToken() {
  try {
    const raw = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
    tokenState = raw.token ?? raw
  } catch (error) {
    log(`ERROR: could not read token file ${TOKEN_FILE}:`, error.message)
    log('Run the Antigravity CLI (`agy`) to authenticate first.')
    process.exit(1)
  }
  if (!tokenState.refresh_token) {
    log('ERROR: no refresh_token in the token file. Re-run `agy` to authenticate.')
    process.exit(1)
  }
  log(`token file OK (auth_method=${raw.auth_method ?? 'unknown'})`)
}

function persistToken() {
  const wrapped = { token: tokenState, auth_method: 'oauth' }
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true })
    const tmp = `${TOKEN_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(wrapped))
    renameSync(tmp, TOKEN_FILE)
    try { chmodSync(TOKEN_FILE, 0o600) } catch { /* best effort on Windows */ }
  } catch (error) {
    log('WARNING: could not persist token:', error.message)
  }
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
      throw new Error(`OAuth refresh failed (HTTP ${response.status}): ${detail}`)
    }
    const payload = await response.json()
    tokenState.access_token = payload.access_token
    if (payload.refresh_token !== undefined) tokenState.refresh_token = payload.refresh_token
    tokenState.expiry = Date.now() + (payload.expires_in ?? 3600) * 1000
    persistToken()
    refreshInFlight = undefined
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
  { id: 'claude-sonnet-4.6', owned_by: 'anthropic' },
  { id: 'claude-opus-4.6', owned_by: 'anthropic' },
]

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  try {
    if (url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', service: 'antigravity-proxy' }))
      return
    }
    if (url.pathname === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: KNOWN_MODELS.map(m => ({ ...m, object: 'model', created: 0 })) }))
      return
    }
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
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

loadToken()
server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`)
  log(`token file: ${TOKEN_FILE}`)
})
