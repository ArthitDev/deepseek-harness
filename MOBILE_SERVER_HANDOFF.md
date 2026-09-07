# Mobile server handoff

Paused on 2026-09-07. Do not store the browser connection token in this file.

## Current state

- SSH alias: `kali-phone`
- Tailnet address: `100.123.30.41`
- SSH port: `2222`
- Web port: `3080`
- Remote repository: `/root/deepseek-harness`
- Branch: `shield-break-agent`
- Server process: tmux session `shield-break-agent`, launched with `/usr/local/bin/dsh-server`
- Remote commit before the pending deployment: `f6b7038184bd778adf9967da19e4855b6ed63224`
- Latest pushed commit: `05437afb6ce4667667826c4464f8faf98de7e0ee`

Commit `05437af` fixes the Models page error `settings are unavailable in this browser` for the exact authenticated origin `http://100.123.30.41`. The fix and its focused test passed locally, but the Kali server was offline during deployment. Both `100.123.30.41:2222` and `100.123.30.41:3080` timed out.

## Resume

Run these commands from the Windows workspace after the Kali device is awake and reachable:

```powershell
rtk proxy ssh kali-phone "cd /root/deepseek-harness && git status --short --branch && git rev-parse HEAD"
rtk proxy ssh kali-phone "cd /root/deepseek-harness && git pull --ff-only origin shield-break-agent"
```

Build the changed client and Web UI on Kali. The reliable full client command is recorded because the phone build previously needed the explicit `tsx` config loader:

```powershell
rtk proxy ssh kali-phone "cd /root/deepseek-harness && node ./node_modules/typescript/bin/tsc -b tsconfig.client.json && pnpm exec tsdown --config-loader tsx --env.DSH_BUILD_FACE client && pnpm run build:web"
```

Regenerate the client build record if the server reports stale client artifacts. Restart only after the build succeeds:

```powershell
rtk proxy ssh kali-phone "tmux kill-session -t shield-break-agent; tmux new-session -d -s shield-break-agent /usr/local/bin/dsh-server"
rtk proxy ssh kali-phone "tmux capture-pane -pt shield-break-agent"
```

Use the newly printed token URL. Then verify that an unauthenticated request still returns `401` and open Models from a fresh or hard-refreshed mobile tab.
