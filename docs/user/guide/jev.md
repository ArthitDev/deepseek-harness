# Use Jev to review evidence

English | [中文](jev.zh.md)

## Summary

Jev can classify and rank recon observations, check claims against evidence, and review proposed changes through the existing [MCP client](../../../packages/mcp/mcp-client/README.md). It is an optional third-party service: the shipped Harness profiles do not install or enable it. Calls send the supplied text to the configured provider and consume that account's quota.

## Table of Contents

- [Configure a Linux host](#configure-a-linux-host)
- [Choose when to call Jev](#choose-when-to-call-jev)
- [Verify and recover](#verify-and-recover)

<a id="configure-a-linux-host"></a>
## Configure a Linux host

The Linux reference deployment uses `@jkudish/jev-mcp@0.14.7`, installed once under `/opt/dsh-jev/0.14.7` with npm lifecycle scripts disabled. The external package requires Node 22 or newer; the tested Harness deployment uses Node 26.13.0. Its [upstream documentation](https://github.com/jkudish/jev-mcp) owns provider configuration and tool schemas. Installation does not imply endorsement or ongoing support by DeepSeek.

1. Install the pinned package before enabling the MCP entry. Keep the runtime and launcher owned by the administrator and readable by the Harness service account. Do not download packages during each startup.
2. Provision the existing TypeSafe credential as `$HOME/.config/typesafe/key` for each account that runs Harness. Use the service's actual `HOME`, which can differ from the terminal user's home. Restrict the credential directory to mode `0700` and the key to `0600`, owned by that account. Keep credentials out of Git, YAML, command arguments and logs.
3. Save the following launcher as `/opt/dsh-jev/launcher.mjs`. It loads the credential after the MCP bridge removes credential-shaped ambient environment variables. A missing, empty or whitespace-containing key stops the child with a fixed diagnostic.

```js
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

try {
  const key = readFileSync(path.join(homedir(), '.config/typesafe/key'), 'utf8').trim()
  if (!key || /\s/.test(key)) throw new Error('invalid credential')
  process.env.TYPESAFE_API_KEY = key
  process.env.JEV_PROVIDER = 'typesafe'
  process.env.JEV_FILE_ROOTS = 'off'
  process.env.JEV_MCP_TRANSPORT = 'stdio'
} catch {
  console.error('[jev-mcp] missing or invalid TypeSafe credential in service home')
  process.exit(1)
}

await import('file:///opt/dsh-jev/0.14.7/node_modules/@jkudish/jev-mcp/dist/index.js')
```

4. Back up the existing configuration, then merge this entry into `$DSH_HOME/cordis.patch.yml` to share it across Web, TUI and headless profiles. Replace an existing `mcp-jev` row rather than adding a duplicate; remove any Windows-only `disabled` expression and Windows executable paths from that row. Preserve other patches.

```yaml
- insert:
    - id: mcp-jev
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: jev
        transport: stdio
        command: !!js process.execPath
        args:
          - /opt/dsh-jev/launcher.mjs
        startupTimeoutMs: 15000
        toolCallTimeoutMs: 60000
        closeTimeoutMs: 5000
        failOnStartupError: false
```

The bridge starts a local stdio child; this configuration adds no HTTP listener. A Web service and an interactive TUI using different homes each need their own configuration and credential. Reload the configuration or restart Harness after active turns and jobs finish. Keep the backup until verification succeeds; restore it and reload if activation fails.

<a id="choose-when-to-call-jev"></a>
## Choose when to call Jev

The pinned server exposes twelve semantic tools under `mcp__jev__jev_*`. Use the advertised schema for arguments; these tools judge supplied text and do not execute scans or control a browser.

| Task | Tools |
|---|---|
| Group and prioritize recon observations | `jev_classify`, `jev_rerank`, `jev_find` |
| Check findings against evidence and compare passages | `jev_verify`, `jev_compare` |
| Screen untrusted text and validate extracted fields | `jev_screen`, `jev_extract`, `jev_audit` |
| Judge a bounded proposition or evidence-based choice | `jev_noul`, `jev_decide` |
| Review a patch and its completion claims | `jev_review`, `jev_gate` |

Use this sequence: deterministic recon, batch classification or ranking, direct investigation, then evidence-backed verification before reporting. Preserve source identifiers and send only the necessary authorized excerpts. Unsupported, contradictory, malformed or low-confidence judgments need further checks. A semantic judgment does not establish exploitability or prove that a command ran.

Put this usage guidance in the deployment's model instructions if automatic tool selection is desired. The reference deployment injects its private `ACTION-POLICY.md` through its existing logged hook; those files are not shipped in this repository. Installing the MCP server alone does not install that hook or force the model to call a tool. Batch calls at investigation and reporting points rather than on each request or polling tick. Keep scope, authorization and VPN traffic checks deterministic. Treat an explicit request to stop using Jev as applying to its MCP tools too; model instructions are guidance, not an enforced tool-access switch.

Jev semantic tools are separate from Jev browser/native automation routing. This Linux setup does not install a Windows desktop bridge. Continue using the deployment's installed headless browser executors.

<a id="verify-and-recover"></a>
## Verify and recover

Check discovery and an actual result separately. In a fresh Web or TUI session, ask the agent to call `mcp__jev__jev_verify` once using the following synthetic input and report the actual verdicts:

```json
{
  "claims": ["TCP port 443 is open.", "TCP port 22 is open."],
  "evidence": "Synthetic test scan: TCP port 443 is open; TCP port 22 is closed."
}
```

Inspect the recorded tool call and result: the expected verdicts are `verified` and `contradicted`. A successful model reply or a list of twelve names alone does not verify inference. The Linux reference deployment passed real calls for all twelve tools through the Harness bridge, plus a normal Web chat call and a TUI-profile check; an interactive TUI screen and server reboot were not exercised.

If startup reports a missing credential, check the service account's home and permissions without printing the key. Provider authentication, quota and network errors require their corresponding repair. With `failOnStartupError: false`, Harness can remain available while Jev is unavailable; inspect the MCP diagnostics and [connection recovery behavior](../../../packages/mcp/mcp-client/README.md). Do not claim a completed verification after a failed call. Record returned usage when available; token counts alone do not establish a monetary cost.

## Dev Note

None.
