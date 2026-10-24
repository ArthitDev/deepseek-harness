# Run the offensive toolchain in Kali WSL

English | [中文](kali-wsl.zh.md)

These two **default-off reference configurations** split the agent's execution worlds: the Windows host shell keeps handling node, pnpm, and git in the checkout, while the `kali-linux` WSL distro carries the Linux offensive toolchain (nmap, sqlmap, hydra, john, hashcat, impacket, and the rest of the Kali package set). The first overlay wires interactive shells; the second adds reverse-engineering MCP bridges.

## What DSH does

The `kali-wsl` overlay registers a second local PTY backend that spawns `wsl.exe -d kali-linux` and exposes it to the TUI's `/shell kali` command and to the Web terminal selector. A shared shell is one owner-scoped session (`shared-kali`): the operator types into the overlay or browser panel while the model's `terminal_open`/`terminal_send`/`terminal_read`/`terminal_list` tools address the same session, so state, working directory, and environment stay common to both. DSH does not install the distro, its packages, or `wsl.exe`; it does not translate commands — the model is responsible for routing through WSL, assisted by a deployment policy (below).

## Prerequisites

| Component | Requirement |
|---|---|
| WSL distro | Installed and booted `kali-linux` (any distro name works — adapt the rows) |
| Kali packages | The tool set your tasks need; `wsl -d kali-linux -- bash -lc 'apt update && apt install -y …'` installs on demand |
| Python in Kali | `python3-requests` for skill scripts that fetch (`apt install -y python3-requests`) |
| Web terminal | `terminal-controller` (already in the web bundle) reads the extra candidate from the overlay |

## Enable

```sh
dsh web --patch "$PWD/apps/cli/config/examples/kali-wsl/cordis.patch.yml"
dsh tui --patch "$PWD/apps/cli/config/examples/kali-wsl/cordis.patch.yml"
```

To keep the selection across runs, merge the rows into `$DSH_HOME/cordis.patch.yml` (every profile) or the profile's own patch. The `terminal-controller` entry replaces that row's whole `shellCandidates` list — restate the defaults you want to keep.

## Route model commands through Kali

Without a policy the model guesses where the toolchain lives. A small home plugin injects one durable policy message each turn:

1. Save the following as `$DSH_HOME/kali-exec.mjs` (adapt the distro name and workspace mounts to your machine):

```javascript
import { createUserMessage } from 'file:///<absolute-path-to-this-checkout>/packages/llm/llm/lib/index.js'

export const name = 'kali-exec-policy'
export const inject = ['agents']
export const policyName = 'kali-exec-policy'

const policyText = `Kali Linux execution policy.

The offensive-security toolchain lives in the kali-linux WSL distro, NOT in the
Windows shell. Run it through:

  wsl -d kali-linux -- bash -lc '<command>'

Single-quote the whole Kali command; use double quotes inside. The Kali shell
runs as root already. Windows drives mount under /mnt (E:\\x -> /mnt/e/x). Keep
pure Windows work in the normal shell. A missing tool is installed inside Kali
with apt, not substituted from Windows.`

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const message = createUserMessage({
      content: [{ type: 'text', text: 'Deployment execution policy.\n\n' + policyText }],
      source: { kind: 'skill-invocation', name: policyName, form: 'instructions' },
    })
    return { ...decision, messages: [...decision.messages, message] }
  })
}
export default { name, inject, apply }
```

2. Register it once in `$DSH_HOME/cordis.patch.yml`:

```yaml
- insert:
    - id: kali-exec-policy
      name: 'file:///C:/Users/<you>/.dsh/kali-exec.mjs'
```

The `file://` import must point at this checkout's built `packages/llm/llm/lib/index.js`; rebuild the checkout after moving it. The minimal version above re-sends the policy each turn; the deployment this example was extracted from additionally deduplicates identical consecutive copies and honours prompt-suppression.

## Verify

```sh
dsh tui --dump-config
```

The output must contain the `terminal-kali` row and, for Web, the `kali` shell candidate. In the TUI, `/shell kali` opens the distro shell and `/exec` lists executed commands tagged `KALI` or `WIN`. In Web, the new-terminal selector lists `kali`.

## Reverse-engineering MCP bridges

[`reverse-mcp/cordis.patch.yml`](../../../apps/cli/config/examples/reverse-mcp/cordis.patch.yml) adds IDA Pro (Streamable HTTP on `127.0.0.1:13337`, hosted by the `ida-pro-mcp` plugin while IDA runs) and x64dbg (a FastMCP stdio bridge proxying the plugin's HTTP server on port 8888). Each bridge is offline until its host application runs; `failOnStartupError: false` keeps profiles booting without them, and tools fail per call. These third-party configurations are provided as interoperability examples only; their inclusion does not imply endorsement or ongoing support.
