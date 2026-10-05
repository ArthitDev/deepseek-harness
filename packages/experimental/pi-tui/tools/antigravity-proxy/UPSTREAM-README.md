<div align="center">

# Antigravity Proxy

**Free Gemini 3.5 Flash, Claude Sonnet 4.6 & more — through a local OpenAI-compatible proxy**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-green.svg)](#requirements)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Features](#features) · [Quick Start](#quick-start) · [Models](#available-models) · [Configuration](#configuration) · [Docs](#how-it-works)

</div>

---

## What is this?

A lightweight **OpenAI-compatible proxy** that bridges any AI tool to **Google Antigravity's** internal Cloud Code Assist API. Authenticate once with the [Antigravity CLI](https://antigravity.google/), then use **Gemini** and **Claude** models from any OpenAI-compatible client — **no API key, no billing, no credit card**.

```
Your Tool (OpenAI format)  →  Antigravity Proxy (localhost:8877)  →  Gemini / Claude models
```

### Why use this?

- **Free** — uses the OAuth token from the Antigravity CLI, no paid API key
- **Universal** — works with any OpenAI-compatible tool (Aider, Continue, Hermes, Claude Code, OpenAI SDK, LangChain, etc.)
- **No dependencies** — pure Python stdlib, no `pip install` needed
- **Two endpoints** — OpenAI chat completions + native Gemini passthrough (for images & structured output)
- **Tool/function calling** — full support, including round-trip through conversation history
- **Streaming** — SSE streaming support for real-time token generation

---

## Features

- **OpenAI-compatible** `POST /v1/chat/completions` — streaming + non-streaming
- **Native Gemini passthrough** `POST /v1beta/models/{model}:generateContent` — images, structured JSON output
- **Tool/function calling** — OpenAI tools format → Gemini functionDeclarations, with round-trip encoding
- **Model auto-mapping** — use friendly names (`gemini-3.5-flash`), the proxy translates to backend names automatically
- **OAuth token auto-refresh** — token refreshed automatically when expired, no manual intervention
- **Zero pip dependencies** — Python 3.10+ standard library only
- **systemd service** included — run as a background service on Linux

---

## Available Models

| Friendly Name         | Backend Model              | Thinking       | Type    |
|-----------------------|----------------------------|----------------|---------|
| `gemini-3.1-pro`      | `gemini-3.1-pro-low`       | Low            | Gemini  |
| `gemini-3.1-pro-high` | `gemini-3.1-pro-low`       | High           | Gemini  |
| `gemini-3-flash`      | `gemini-3-flash`           | —              | Gemini  |
| `gemini-3.5-flash`    | `gemini-3.5-flash-low`     | —              | Gemini  |
| `gemini-2.5-pro`      | `gemini-2.5-pro`           | —              | Gemini  |
| `gemini-2.5-flash`    | `gemini-2.5-flash`         | —              | Gemini  |
| `claude-sonnet-4.6`   | `claude-sonnet-4-6`        | —              | Claude  |
| `claude-opus-4.6`     | `claude-opus-4-6-thinking` | Enabled        | Claude  |

You always use the **friendly name** in your client. The proxy handles translation.

---

## Quick Start

### Prerequisites

1. **Python 3.10+** — check with `python3 --version`
2. **Antigravity CLI** — install and authenticate (one-time):

```bash
# Install agy (macOS/Linux)
curl -fsSL https://storage.googleapis.com/antigravity-releases/install.sh | bash

# Authenticate (opens browser, sign in with Google)
agy
```

> Windows: download from [antigravity.google](https://antigravity.google/)

### Install & Run

```bash
git clone https://github.com/usamashehab/antigravity-proxy.git
cd antigravity-proxy

# Start the proxy
python3 antigravity_proxy.py

# Verify it's running
curl http://127.0.0.1:8877/health
# → {"status": "ok", "service": "antigravity-proxy"}
```

That's it. The proxy is now listening on `http://127.0.0.1:8877`.

### Connect Your Tool

Any OpenAI-compatible client works. Set base URL to `http://127.0.0.1:8877/v1` and use any model from the table above. The API key can be any string (the proxy doesn't check it).

<details>
<summary><b>OpenAI Python SDK</b></summary>

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8877/v1",
    api_key="antigravity",
)

response = client.chat.completions.create(
    model="gemini-3.5-flash",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```
</details>

<details>
<summary><b>curl</b></summary>

```bash
curl http://127.0.0.1:8877/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```
</details>

<details>
<summary><b>Aider</b></summary>

```bash
export OPENAI_API_BASE=http://127.0.0.1:8877/v1
export OPENAI_API_KEY=antigravity
aider --model gemini-3.5-flash
```
</details>

<details>
<summary><b>Continue.dev (VS Code)</b></summary>

In `~/.continue/config.json`:
```json
{
  "models": [{
    "title": "Antigravity",
    "provider": "openai",
    "model": "gemini-3.5-flash",
    "apiBase": "http://127.0.0.1:8877/v1",
    "apiKey": "antigravity"
  }]
}
```
</details>

<details>
<summary><b>Hermes Agent</b></summary>

```bash
hermes config set model.provider custom
hermes config set model.base_url http://127.0.0.1:8877/v1
hermes config set model.api_key antigravity
hermes config set model.default gemini-3.5-flash
```
</details>

<details>
<summary><b>Claude Code</b></summary>

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8877/v1
claude  # uses claude-sonnet-4.6 through the proxy
```
</details>

<details>
<summary><b>LangChain</b></summary>

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://127.0.0.1:8877/v1",
    api_key="antigravity",
    model="gemini-3.5-flash",
)
```
</details>

---

## AI-Assisted Setup 🤖

**Using an AI assistant (Claude, GPT, Gemini, etc.) to set this up?**

This repo includes [`AGENTS.md`](AGENTS.md) — a complete instruction file for AI agents. Just tell your AI assistant:

> "Help me install and configure the antigravity-proxy from https://github.com/usamashehab/antigravity-proxy"

The AI will read `AGENTS.md` and guide you through every step: prerequisites check, installation, tool configuration, and troubleshooting.

---

## Configuration

### CLI Arguments

```
python3 antigravity_proxy.py [--port PORT] [--host HOST]

  --port PORT    Port to listen on (default: 8877)
  --host HOST    Host to bind to (default: 127.0.0.1)
```

### Run as a systemd Service (Linux)

```bash
# Clone to permanent location
git clone https://github.com/usamashehab/antigravity-proxy.git ~/antigravity-proxy

# Install service
mkdir -p ~/.config/systemd/user
cp ~/antigravity-proxy/antigravity-proxy.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable antigravity-proxy
systemctl --user start antigravity-proxy

# Check status
systemctl --user status antigravity-proxy
```

### Environment Variables

| Variable                     | Default | Description                        |
|------------------------------|---------|------------------------------------|
| `ANTIGRAVITY_CLIENT_ID`      | built-in| Override OAuth client ID           |
| `ANTIGRAVITY_CLIENT_SECRET`  | built-in| Override OAuth client secret       |

The default client credentials are the same values embedded in every Antigravity CLI binary — you only need these env vars if you're using a custom build.

---

## Two API Endpoints

### 1. OpenAI Chat Completions

```
POST /v1/chat/completions
```

Standard OpenAI format with messages, tools, and streaming. Use this for any OpenAI-compatible client.

### 2. Native Gemini Passthrough

```
POST /v1beta/models/{model}:generateContent
```

Accepts the exact same format as Google's Generative Language API. Use this for:

- **Image inputs** (`inline_data` with base64-encoded images)
- **Structured output** (`responseSchema` for enforced JSON schema)
- **Thinking control** (`thinkingConfig`)

<details>
<summary><b>Structured output example</b></summary>

```bash
curl http://127.0.0.1:8877/v1beta/models/gemini-3.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "Extract: Ahmed is 30 years old"}]}],
    "generationConfig": {
      "temperature": 0,
      "responseMimeType": "application/json",
      "responseSchema": {
        "type": "OBJECT",
        "properties": {
          "name": {"type": "STRING"},
          "age": {"type": "NUMBER"}
        },
        "required": ["name", "age"]
      }
    }
  }'
```
</details>

<details>
<summary><b>Image input example</b></summary>

```bash
# Base64-encode an image and send it
B64=$(base64 -w0 photo.jpg)

curl http://127.0.0.1:8877/v1beta/models/gemini-3.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -d "{
    \"contents\": [{
      \"parts\": [
        {\"text\": \"What is in this image?\"},
        {\"inline_data\": {\"mime_type\": \"image/jpeg\", \"data\": \"$B64\"}}
      ]
    }]
  }"
```
</details>

---

## Management

```bash
# Health check
curl http://127.0.0.1:8877/health

# List models
curl http://127.0.0.1:8877/v1/models

# View logs (systemd)
journalctl --user -u antigravity-proxy -f

# Restart / stop
systemctl --user restart antigravity-proxy
systemctl --user stop antigravity-proxy

# Re-authenticate when token expires
agy && systemctl --user restart antigravity-proxy
```

---

## How It Works

```
Your Client (OpenAI format)
    │
    ▼
Antigravity Proxy (localhost:8877)
    │  ┌─ Translates OpenAI messages → Gemini contents
    │  ├─ Converts OpenAI tools → Gemini functionDeclarations
    │  ├─ Manages OAuth token (auto-refresh)
    │  ├─ Maps friendly model names → backend model names
    │  └─ Wraps in Antigravity envelope {project, model, request}
    │
    ▼
cloudcode-pa.googleapis.com
    │
    ▼
Gemini / Claude models → Response unwrapped → OpenAI format → Your client
```

<details>
<summary><b>Technical details</b></summary>

1. Reads OAuth token from `~/.gemini/antigravity-cli/antigravity-oauth-token`
2. Refreshes expired access tokens via `oauth2.googleapis.com/token`
3. Discovers Cloud Code Assist project ID via `v1internal:loadCodeAssist`
4. Wraps each request in the Antigravity envelope: `{project, model, request, requestType, userAgent, requestId}`
5. Forwards to `v1internal:generateContent` or `v1internal:streamGenerateContent?alt=sse`
6. Unwraps the `{response: {...}}` envelope
7. Converts Gemini response → OpenAI format (choices, message, usage)
8. For tool calls, encodes Gemini's `functionCall.id` + `thoughtSignature` into OpenAI `tool_call.id` for round-tripping
</details>

---

## Adding or Updating Models

Edit `MODEL_MAP` at the top of `antigravity_proxy.py`:

```python
MODEL_MAP = {
    "gemini-3.5-flash": ("gemini-3.5-flash-low", None),
    # "friendly-name": ("backend-name", thinking_level),
    # thinking_level: "low", "high", or None
}
```

Restart the proxy after editing.

---

## Requirements

- Python 3.10+
- Antigravity CLI (`agy`) installed and authenticated
- No pip dependencies

---

## FAQ

<details>
<summary><b>Is this legal to use?</b></summary>

The proxy uses the same OAuth token and API endpoints that the Antigravity CLI itself uses. It does not bypass authentication — you need a valid Google account with Antigravity access. Multiple similar projects exist publicly on GitHub. However, Google's terms of service may restrict programmatic API access. Use at your own discretion.
</details>

<details>
<summary><b>Does it support streaming?</b></summary>

Yes. SSE streaming (`"stream": true`) on the OpenAI endpoint, and the native Gemini stream endpoint.
</details>

<details>
<summary><b>Can I send images?</b></summary>

Yes, through the native Gemini passthrough endpoint (`/v1beta/models/{model}:generateContent`). Send `inline_data` with base64-encoded images, exactly like Google's API.
</details>

<details>
<summary><b>Is there a rate limit?</b></summary>

Rate limits are determined by Google's Antigravity quota, not the proxy. The proxy itself is multithreaded with no concurrency limit.
</details>

<details>
<summary><b>Does the token expire?</b></summary>

The OAuth access token expires (~1 hour). The proxy auto-refreshes it. The refresh token can expire if unused for extended periods — re-run `agy` if that happens.
</details>

<details>
<summary><b>Can I bind to 0.0.0.0?</b></summary>

Yes, but **the proxy has no authentication layer**. Anyone who can reach it can use your Antigravity quota. Only bind to a non-localhost address if you understand the risk.
</details>

---

## License

[MIT](LICENSE)
