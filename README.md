# Shield Break Harness

English | [中文](README.zh.md)

Shield Break Harness is a security-testing-focused fork of the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — an everything-is-a-plugin agent harness built on [Cordis](https://github.com/cordiverse/cordis).

**Important:** this checkout is the custom `shield-break-agent-v2` branch. Read the [Shield Break Agent modification and responsible-use guide](README.SHIELD-BREAK.md) before running Recon or pentest workflows, and the [safety notice](SAFETY.md) before running the project.

<a id="run"></a>
## Run

| Surface | Command | Notes |
|---|---|---|
| **Web GUI** | `pnpm dsh web` | `http://127.0.0.1:3080`, full dashboards (Runs, Recon, Settings, Presets) |
| **TUI** | `pnpm dsh tui` | full-screen terminal agent — commands below |
| **Desktop** | `pnpm dev:desktop` | Electron shell over the same Web UI |
| **Headless** | `pnpm dsh --profile headless "task"` | one-shot task, no UI |

<a id="run-from-source"></a>
## Build

```sh
pnpm install            # node ^22.19 || >=24
pnpm run build          # dev profile: lib + web bundles (292 artifacts)
pnpm run build:official # release profile
pnpm run typecheck      # host + client faces
pnpm run test           # unit tests
pnpm run dev:web        # web shell + client-bundle watcher
```

Both profiles rebuild every package lib; `dsh` launches from source through tsx.

## Web

```sh
pnpm dsh web --no-open --trusted-host <host>.ts.net
```

- The server binds `127.0.0.1:3080`; remote access goes through Tailscale: `tailscale serve --bg http://127.0.0.1:3080` plus the `--trusted-host` flag naming your `*.ts.net` host. The printed URL carries a one-time token gate.
- `~/.dsh/cordis.patch.yml` is the **home patch**: rows there apply to every profile (web/tui/headless) — shared LLM providers, sandbox posture, and other deployment-wide overrides live here.

## TUI

```sh
dsh tui                       # default preset
dsh tui --preset              # pick from the roster
dsh tui --machine kali        # run the session on a saved SSH machine
dsh tui --resume              # reopen a persisted session
```

Commands: `/new` `/fork` `/resume` `/rename` `/export` `/tree` `/agents` `/jobs` `/sessions` `/model` `/preset` `/thinking` `/providers` `/key` `/provider` `/memory` `/queue` `/rewind` (or **Esc Esc**) `/clear` `/runs` `/recon` `/machines` `/skills` `/copy` `/retry` `/expand-all` `/hotkeys` — plus the official dsh commands (`/compact`, `/goal`, `/plan`, `/feedback`).

Paste works via bracketed paste (right-click in Windows Terminal / conhost, or Ctrl+V). `Esc Esc` on an empty editor rewinds to an earlier prompt.

## Mapping providers, models, and machines

**Providers and models** resolve from one shared document — the `llm-pi-ai.providers` section of the home patch (`~/.dsh/cordis.patch.yml`). Every profile and both surfaces read the same routes and credential references:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      my-provider:
        displayName: My Provider
        apiKeyEnv: MY_PROVIDER_API_KEY   # credential reference, resolved per request
        api: openai-completions          # or openai-responses / anthropic-messages
        baseURL: https://host/v1
        models:
          - id: model-id
            name: Display Name
            contextWindow: 1000000
            maxTokens: 65536
```

Keys themselves live in `~/.dsh/.credentials.yaml` (`/key <REF>` from the TUI, or the web Models page) and resolve per request — never stored in the profile.

**Presets** are directories under `~/.dsh/.agent-presets/` (`preset.yml` names them). The TUI hides the shipped upstream roster (`includeShippedRoot: false` in its patch) and defaults to `shield-break-agent`; the web picker keeps the full roster.

**Machines** are saved SSH profiles (web → Remote machines settings, stored in the shared settings document). `/machines list|probe|open` in the TUI, or `--machine <id>` at boot, place the session's working directory in `/__dsh_ssh__/<machine>/…` so shell and file tools run on that machine.

**Antigravity** (Google account Gemini models) connects through the bundled in-repo proxy — see [Connect Antigravity](packages/experimental/pi-tui/README.md#connect-antigravity) in the TUI package README. A fresh clone needs no other download and no Antigravity CLI: run `node packages/experimental/pi-tui/tools/antigravity-proxy/setup.mjs`, approve the Google sign-in it opens, and the provider is already registered in the TUI with logon autostart.

## Pentest surface

The Runs dashboard (web) and `/runs` `/recon` (TUI) drive one bounded Supervisor/Executor control plane: deterministic recon tools, task leases with attempt budgets, and N-loop ledgers. Scope, authorization, and responsible-use rules are covered in [README.SHIELD-BREAK.md](README.SHIELD-BREAK.md).

## Community and development

- Upstream documentation: <https://deepseek-harness.github.io/deepseek-harness/>
- Development guide: [docs/development.md](docs/development.md), architecture: [docs/architecture.md](docs/architecture.md), agent rules: [AGENTS.md](AGENTS.md)
- `pnpm run doc-sync` gates documentation; `pnpm run test:docs` runs the quick checks.

## License

[MIT](LICENSE) — third-party notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
