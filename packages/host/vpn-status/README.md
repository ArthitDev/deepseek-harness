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

## Dev Note

Verification requires fresh egress evidence; this sample cannot establish routing for other processes or destinations.


## Model Experience

None, as this package contributes only operator-visible status and no model context.

#### KV Cache effect

No model request or reusable prefix is changed.

## Known Limitations and Deferred Work

- This is a periodic sample of one Host HTTPS destination, not continuous monitoring, a kill switch, or proof about all traffic. A route may change between checks. Split tunnels, IPv4/IPv6 differences, proxies, remote shells and Kali namespaces can use other routes. Verification for other providers depends on accurate expected exits and still uses Mullvad's public JSON service for observation. It cannot distinguish a VPN from another path sharing the same configured exit. Neither UI claims those other routes are protected.
