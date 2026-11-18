---
description: "Cached verification of the Host HTTPS route for VPN status displays."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-vpn-status

English | [中文](README.zh.md)

## Summary

The Host checks its HTTPS egress on Windows and Linux and shares one cached result with Web and TUI. Readers never start a network request. No IP address or credential appears in the result or logs.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

Set the bundled `vpn-status` row's `enabled: true` to opt in. Each enabled check contacts `https://am.i.mullvad.net/json`; Mullvad observes the request's public egress IP. The first check runs at startup, then after each `intervalMs` (default 300000, minimum 60000). `timeoutMs` defaults to 10000. Checks never overlap, redirects are refused, and disposal cancels and awaits the request.

Mullvad's official `mullvad_exit_ip: true` verifies its exit. Other providers, including WireGuard and OpenVPN deployments, require operator-supplied VPN exit IPs/CIDRs in `expectedExitCidrs` (IPv4 or IPv6). Configure ranges known to belong to that VPN; a broad or shared range weakens that evidence. A changed public IP alone never verifies a VPN. Invalid CIDRs fail loading; universal /0 ranges are refused.

The `vpnStatus/read` Remote and in-process `ctx.vpnStatus.read()` return checking, verified, unverified, or unknown plus evidence, last-check time, and expiry. Unmatched responses are unverified; network, parsing and endpoint failures are unknown. Every new check clears the previous verification, and expired samples cannot remain verified. The Web row names Host HTTPS; TUI uses the same cache. Separate Host processes each own their own check cadence.

Verified Mullvad samples can also include optional `country`, an uppercase two-letter exit-country code extracted from `mullvad_exit_ip_hostname`. Missing or malformed relay names omit the code without changing verification. Checking, failed, unverified and expired samples carry no country. Other providers currently omit country metadata. Extraction uses the existing HTTPS response and adds no requests; the code describes the observed exit, not a configured target or multihop entry.

## Dev Note

### TUI control

`/vpn status` reads the local Mullvad tunnel and cached Host HTTPS evidence without an extra public request. `/vpn reconnect` reconnects Mullvad, invalidates the previous sample and performs a fresh HTTPS check. Completed control with unknown/unverified HTTPS does not confirm VPN egress. Concurrent reconnects are refused. These commands preserve VPN settings, firewall rules, proxy routing and kill-switch policy; reconnect affects every Web/TUI process sharing the tunnel. Other providers retain `expectedExitCidrs` verification; automatic reconnect currently supports Mullvad only.

Windows uses `%ProgramFiles%\Mullvad VPN\resources\mullvad.exe`; normal Linux uses `/usr/bin/mullvad`. Both execute fixed arguments without a shell, bounded by `controlTimeoutMs` (default 45000). Disabled monitoring refuses reconnect. A missing CLI or broker reports unavailable, without falling back to another network path.

### Isolated Linux Server setup

An isolated Host without the Mullvad management socket uses the restricted [control broker](../../../scripts/vpn-control-broker.mjs). It listens only on `/run/dsh-kali-broker/vpn.sock`, accepts bodyless `GET /status` and `POST /reconnect`, executes fixed Mullvad commands and strips IP/account data. It serializes reconnects across TUI processes. No control operation is exposed through the Web Remote API.

The Server's existing `/run/dsh-kali-broker` must be root-owned, mode `0750`, with the Harness group; workloads retain its read-only bind mount. Back up existing script/unit/config files, install root-owned copies and enable the [unit](../../../scripts/vpn-control-broker.service):

```sh
sudo install -o root -g root -m 0644 scripts/vpn-control-broker.mjs /usr/local/libexec/dsh-vpn-control-broker.mjs
sudo install -o root -g root -m 0644 scripts/vpn-control-broker.service /etc/systemd/system/dsh-vpn-control.service
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-vpn-control.service
```

The unit uses the root-owned Server launcher `/usr/local/libexec/dsh-vpn-node` and existing Mullvad/Kali broker services. Preserve the `vpn-status` row's other config and set `controlSocketPath: /run/dsh-kali-broker/vpn.sock`, then reopen TUI. Verify `/vpn status`, socket ownership/mode (`root`, Harness group, `0660`), unchanged firewall rules and fresh HTTPS evidence after reconnect. To roll back, stop and disable `dsh-vpn-control.service`, restore the backed-up files/config, run `systemctl daemon-reload` and reopen TUI; VPN/firewall services stay running.

Verification requires fresh egress evidence; this sample cannot establish routing for other processes or destinations.


## Model Experience

None, as this package contributes only operator-visible status and no model context.

#### KV Cache effect

No model request or reusable prefix is changed.

## Known Limitations and Deferred Work

- This is a periodic sample of one Host HTTPS destination, not continuous monitoring, a kill switch, or proof about all traffic. A route may change between checks. Split tunnels, IPv4/IPv6 differences, proxies, remote shells and Kali namespaces can use other routes. Verification for other providers depends on accurate expected exits and still uses Mullvad's public JSON service for observation. It cannot distinguish a VPN from another path sharing the same configured exit. Neither UI claims those other routes are protected.
