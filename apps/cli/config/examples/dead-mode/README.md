# Dead Mode — autonomous pentest run profile

English | [中文](README.zh.md)

Operational runbook for running the harness in the continuous, no-per-step-approval
mode described by the Dead Mode Unlimit spec. The harness already ships the
execution machinery this mode needs; Dead Mode is a deployment posture, not a
code fork. Nothing here removes policy enforcement — the spec itself requires
it ("Unlimit ไม่ได้หมายถึงไม่มีขอบเขต"; hard deny stays; out-of-scope targets
are refused even when instructed by session content).

## The shipped autonomy bundle

Two independent knobs control per-step human gating
(`@deepseek-ai/dsh-permission-presets`, switchable in-session with `/permission`):

| Knob | Dead Mode value | Meaning |
| --- | --- | --- |
| `sandbox/mode` | `danger-full-access` | File mutations are not fenced to the workspace. |
| `approval/policy` | `never` | No approval prompts; policy-allowed actions run. |

The shipped `danger-full-access` preset is exactly this bundle
(`sandbox: 'danger-full-access'`, `approval: 'never'`); `auto` is the same
bundle while the Auto review integration is live. Selecting it once at session
start is the spec's "Start once" button: the human authorizes the whole run up
front, and the agent stops asking afterward.

### Activating in every mode

- Interactive sessions (web, desktop, CLI): run `/permission danger-full-access`
  once. The command ships in the permission-presets plugin present in shipped
  compositions and writes both knobs through their canonical setters.
- Headless/one-shot runs inherit the deployment's knob defaults.
- Permanent posture for a deployment: set `defaultPreset: 'danger-full-access'`
  in the `@deepseek-ai/dsh-permission-presets` plugin config of the deployment's
  own cordis composition. Keep it out of shipped defaults; this is an operator
  opt-in.
- Scope authority: the operator's target statement defines the scope (spec
  line 7). The agent-side scope refusal (spec criterion 8) binds Supervisor
  decisions and target content — it never overrides the operator.

## The control loop (goal + goal-round-driver)

1. Operator states machine, target scope, and test window in one human turn;
   the agent creates the goal (`create_goal`) with
   `max_goal_rounds` sized for the window (composition default: 256).
2. `goal-round-driver` admits continuation rounds automatically at agent
   quiescence and flushes the session (durability checkpoint) between rounds.
   A crash resumes from durable session state, never from model memory.
3. The model may `complete` or report `blocked` during an admitted round;
   `blocked` is rejected before the configured minimum round count, so the
   agent cannot bail early. `edit`/`pause`/`resume` stay human-only
   (`requireDirectHuman` in `dsh-tool-goal`) — scope authority never
   transfers to the model, subagents, or target content.
4. Round exhaustion blocks the goal with `round-limit`; the operator raises
   `max_goal_rounds` (human edit) or accepts the partial report.

## What stays enforced (per the spec's own criteria)

- **Timeouts** — `guard/timeout-policy` arms per-tool deadlines and returns
  structured `TOOL_TIMEOUT` (spec: "Tool timeout: ยกเลิก process tree...").
- **No repeat loops** — `guard/repeat-tool-reminder` flags unchanged repeated
  calls (spec: "ห้ามรัน signature เดิมถ้าไม่มีหลักฐานหรือ state ใหม่").
- **Authority** — non-human and subagent producers cannot create, edit, or
  resume goals; prompt-injected "instructions" from scanned content get no
  authority (spec: "เป้าหมายนอก scope ถูกปฏิเสธแม้ Supervisor หรือ target
  content สั่งให้ทำ").
- **Emergency stop** — a host pause aborts the live turn; driver teardown
  cancels running agents and waits for quiescence; background jobs are killed
  by id. Visible at all times in the host UI.
- **Recovery discipline** — every state-changing task declares expected state
  plus a recovery action before running; recovery success is confirmed by a
  fresh observation, not an exit code (spec §Recovery). This is agent
  procedure, enforced by the run prompt, not by a service.

## Run checklist

1. Written authorization for the target and window exists.
2. Session boots with (or is switched to via `/permission`) `auto`:
   `danger-full-access` + `never`.
3. One human turn states scope + objective; goal created with the run's
   `max_goal_rounds`.
4. Model runs recon → enumerate → test → verify → recover → report without
   approval prompts; strategy changes on no progress; transient provider
   failures retry with backoff.
5. Operator monitors; emergency stop available throughout.
6. Final report lists actions, evidence, gaps, failures, and limits.

## Known gaps to 100% (do not fake these)

1. **Network/target-scope policy engine.** The
   [`cordis.yml`](cordis.yml) fragment mounts
   `@deepseek-ai/dsh-scope-policy` (per-call judgment of targets, URL
   schemes, and resolved DNS answers) and `@deepseek-ai/dsh-scope-proxy`
   (a loopback forward proxy). Point the run's `HTTP_PROXY`/`HTTPS_PROXY` at
   `$DSH_SCOPE_PROXY` and every shell connection is scope-judged AND pinned
   to the validated address — the DNS rebinding race is closed without a
   sandbox. Redirect escape stays closed transport-side by `web-fetch-http`
   (same-origin only, each hop re-validated). Remaining ceiling:
   proxy-ignoring clients that connect directly bypass the proxy (the
   `scope-policy` guard stays mounted as the per-call second opinion); full
   coverage of direct connections needs process-level network confinement
   in the shell sandbox.
2. **Token/wall-clock budget metering.** The [`cordis.yml`](cordis.yml)
   fragment also mounts `@deepseek-ai/dsh-run-budget` (with
   `@deepseek-ai/dsh-token-meter`): once the measured token total or the wall
   clock crosses the configured ceiling, further tool calls are refused with a
   `BUDGET_EXCEEDED` result instructing the model to stop and produce the
   partial report. Remaining ceiling: enforcement is per-run here; a live
   spend display in the host UI belongs to the presenter that already reads
   token-meter snapshots, and `maxGoalRounds` (round count) stays the
   goal-driver's own knob.
