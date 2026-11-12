# Bundled ZCode proxy

## Summary

The harness includes the ZCode proxy source and dependency lockfile. Moving this harness checkout does not require the original proxy repository. The direct route is Harness → bundled ZCode proxy on port 18080 → ZCode Starter Free. The optional router route inserts system 9router on port 20128 before ZCode.

## Set up another machine

Install Bun and the harness prerequisites, then run this command from the harness root:

```sh
bun --no-env-file scripts/sb-auto-start.cjs setup-zcode
```

Setup installs production dependencies from `bun.lock` with dependency lifecycle scripts disabled, builds the CAPTCHA worker, and creates an ignored `config.yaml` for Starter Free with a newly generated proxy API key and a loopback listener. An existing config is preserved. It also stores this machine's proxy key under `ZCODE_DIRECT_API_KEY` in `$DSH_HOME/.credentials.yaml`, defaulting to `~/.dsh`, using the harness's locked atomic writer. Other credentials, OAuth records and comments are preserved. Setup does not start either proxy or log in to an account.

ZCode authentication is a manual step on each new machine. The upstream CLI command is shown below; the interactive login requires the account owner and is not covered by the keyless tests:

```sh
bun --cwd third-party/zcode-api run src/index.ts auth login zai
```

TUI and Web ship a `ZCode Direct` provider named `zcode-direct` in the shared `llm-pi-ai` adapter. Select `/model zcode-direct/glm-5.3-flash` or `/model zcode-direct/glm-5.3` in TUI. Both advertise a 1,000,000-token context and 128,000 output tokens; Flash accepts image input. Requests use raw model ids, with no `zcode/` router prefix. This route uses `http://127.0.0.1:18080/v1` and the `ZCODE_DIRECT_API_KEY` credential reference, so it needs neither 9router nor SB. When a home patch overrides `llm-pi-ai.providers`, setup adds the missing direct route there while preserving other providers and existing direct-route overrides. An inherited `ZCODE_DIRECT_API_KEY` environment value takes precedence over the managed credential store.

For the router route, configure the system 9router ZCode connection with `http://127.0.0.1:18080/v1` and the `auth.proxyApiKey` from this machine's ignored `config.yaml`. Configure harness models `zcode/glm-5.3` and `zcode/glm-5.3-flash` through `http://127.0.0.1:20128/v1`, using that machine's 9router key. Neither 9router nor account credentials are bundled here.

The direct preset defaults to `reasoning: low`. The live Flash endpoint rejects disabled thinking with HTTP 400 and code 1210. A home patch that replaces the provider roster must retain this setting; an existing profile or session effort can override the provider default.

`pnpm zcode:start` starts only ZCode and exits after checking readiness. The launcher reuses an already responsive proxy at the configured port; copying the source does not replace an existing process.

## Startup and recovery

An interactive TUI starts SB transport on every launch. TUI and Web start ZCode only before the first actual `zcode-direct` or `zcode/glm-5.3[-flash]` request. Concurrent requests share one startup attempt per host; cancelling a request ends only its wait. Failed startup displays one TUI notice or one Web server warning and still delegates the request to its configured endpoint; other providers remain usable. After a failed attempt, fix setup and restart the host or start the proxy manually. Help and non-interactive invocations skip startup. Closing either host cancels and awaits pending helpers; a running shared proxy remains available to the other host and 9router.

To start only ZCode without starting SB or system 9router, run `node scripts/sb-auto-start.cjs start-zcode` from the harness root. This helper exits after checking readiness; the proxy continues running independently.

The [launcher](../../scripts/sb-auto-start.cjs) selects this directory by default. `ZCODE_DIR` remains an explicit override; there is no automatic lookup of machine-specific drives. Before spawning a proxy, the launcher installs missing dependencies and prepares the worker. An unchanged worker is reused only when its source, builder, lockfiles, direct dependency versions, Bun revision, platform and output hash match the ignored `.cache/captcha-worker-build.json` record. Missing or damaged output rebuilds; a failed build prevents startup. It passes an absolute worker path and `ZCODE_CAPTCHA_REQUIRE_WORKER=1` to the child, so a missing or unloadable worker cannot fall back to solving on the main thread. `ZCODE_PORT` defaults to 18080 and controls both the launcher and the shipped direct provider. Set it before starting the harness; update the 9router connection separately if using that route. `ZCODE_PROXY_API_KEY` overrides the proxy config key and is also honored by credential setup.

The CAPTCHA solver enforces one process-wide concurrency limit, including prefill, background refill and empty-pool races. The default is three active solves, controlled by the existing `CAPTCHA_SOLVE_CONCURRENCY` setting. Excess work waits in FIFO order for at most `CAPTCHA_SOLVE_TIMEOUT_MS` (default 20000); shutdown rejects queued work. Per-solve worker exit completes before its slot is reused. Existing token-pool sizing, retry policy and idle decay remain enabled. A burst may wait longer instead of spawning more workers; this limit does not establish a memory ceiling for an individual solve.

## Resource diagnostics

Run `pnpm zcode:metrics` from the harness root to read an updated running proxy's numeric memory, CPU, solver and pool counts. The command reads the selected ignored config or `ZCODE_PROXY_API_KEY` internally and prints no credential values. `ZCODE_DIR` and `ZCODE_PORT` follow launcher settings. An older running proxy returns a restart notice instead of metrics.

`GET /v1/diagnostics` requires the configured proxy API key, refuses keyless deployments, and sends `Cache-Control: no-store`. It returns process RSS/heap/external memory in bytes, process-lifetime peak RSS, cumulative CPU microseconds, active/queued/peak solve counts, completion/failure totals, and pool counts. Pool reads do not mutate or refill tokens. No account data, request content, challenge parameters or token contents are returned. Diagnostics makes no upstream request and creates no periodic monitor. Existing request logs report TTFB separately; these resource samples do not measure inference latency.

Keep `config.yaml`, `.env*`, logs, and `node_modules` out of Git. Generated worker bundles are rebuilt rather than committed. The account store defaults to `~/.zcode-proxy` and remains outside the checkout. A copied config can contain private keys and is only for that local machine.

## Source and verification

Runtime setup installs production dependencies only. Before running source tests or the Harness root lint, install the locked development dependencies from this directory with `bun --no-env-file install --frozen-lockfile --ignore-scripts`. Use a development environment (`NODE_ENV` unset or `development`); it installs `@types/bun` and its `bun-types` dependency. This command does not configure an account or start the proxy.

[UPSTREAM.json](UPSTREAM.json) pins the upstream version and revision and records local changes. This snapshot includes the server source, tests, dependency manifest, lockfile, worker build script, and upstream config example. Android packaging files are not included.

```sh
bun test --cwd third-party/zcode-api
```

The launcher tests use temporary directories, a local HTTP fixture, and a real Bun worker. They cover relocation, config preservation, strict worker settings, and failed builds without accessing the account store or model API. They do not establish long-term CAPTCHA reliability.

The proxy retains upstream's [CC-BY-NC-SA-4.0 license](LICENSE), separately from the harness MIT license. Dependency licenses remain with their packages.
