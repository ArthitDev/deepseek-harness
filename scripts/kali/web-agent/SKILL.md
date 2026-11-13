---
name: web-agent-scanning
description: Run ZAP Automation Framework and Nuclei through Harness Terminal for scoped web/API assessments, and read their JSON evidence alongside existing browser tools.
---

# Web agent scanning

Use the existing Terminal with Kali: Windows uses `wsl.exe -d kali-linux -u root --exec /bin/bash <script>`; Linux uses `"$DSH_HOME/kali-shell" -c 'bash <script>'`. Paths in commands and plans must be visible inside Kali. Keep the deployment's VPN-only egress controls; Windows VPN configuration is separate from tool installation. If VPN egress cannot be verified, use local fixtures only.

Use the existing configured browser for login, navigation and business logic. Browser login does not authenticate ZAP or Nuclei: configure and verify their session separately. Never change browser routing or install another browser just to run a scan.

## ZAP

Create a local YAML Automation Framework plan with an explicit context, allowed URLs and exclusions. Start with spider, passiveScan-wait and a `report` job using `traditional-json`. Add `activeScan` only within the user's assessment scope, with time and thread limits. Authentication and OpenAPI/GraphQL imports belong in the plan when needed; check the authenticated state before scanning. Plans can send requests and execute scripts, so inspect imported plans before running them.

Run inside Kali, replacing the paths with the actual plan and a unique writable home directory:

```bash
timeout --kill-after=10s 15m zaproxy -cmd -silent -notel -host 127.0.0.1 -port 0 -dir /tmp/zap-unique-run -autorun /workspace/plan.yaml
```

`-silent` suppresses unsolicited update requests; the proxy binds to loopback and exits with the plan. Use a new `-dir` for each run. Retain the plan, log and JSON report in the task's evidence directory. Exit 124 means timeout; a missing report, plan error or incomplete passive queue is not a clean scan. Review alert evidence, affected URL, risk and confidence before claiming a vulnerability.

## Nuclei

Use a selected local template or reviewed subset. The installed official template catalog is `/opt/dsh-nuclei-templates`; updating it is a separate dependency maintenance operation (`nuclei -ut -ud /opt/dsh-nuclei-templates </dev/null`). Verify actual YAML files and validate the selected template after updating; exit 0 with an empty catalog is not readiness. Close stdin for a single-target scan so a subprocess pipe cannot leave Nuclei waiting for target input. Avoid automatic update checks and OAST traffic during ordinary scans:

```bash
nuclei -u https://target.example -t /opt/dsh-nuclei-templates/http/misconfiguration/ -severity medium,high,critical -jsonl -o /workspace/nuclei.jsonl -duc -ni -rl 5 -c 2 -timeout 10 -retries 1 </dev/null
```

Choose the target and subset for the actual assessment. `-ni` disables Interactsh, so OAST coverage is absent; code and headless templates need separate deliberate selection. Do not upload results to a cloud dashboard by default. Parse each JSONL record; preserve template ID, severity, matcher, matched URL and evidence. Zero records without successful template loading and target requests does not establish a clean result.

## Local verification

`node scripts/kali/web-agent/smoke.mjs` runs inside Kali. It creates a loopback-only fixture, a ZAP plan and a custom Nuclei template, asserts both JSON outputs and checks invalid-plan failure. It retains artifacts in the printed temporary directory. It does not validate authentication, active scanning or real targets.

References: [ZAP automation](https://www.zaproxy.org/docs/automate/automation-framework/), [ZAP reports](https://www.zaproxy.org/docs/desktop/addons/report-generation/automation/), [Nuclei](https://github.com/projectdiscovery/nuclei).
