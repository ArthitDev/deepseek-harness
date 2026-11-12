---
description: "Additive VPN verification status in the Web frame."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-vpn-status

English | [中文](README.zh.md)

## Summary

The Web status row displays the [Host VPN sample](../../host/vpn-status/README.md), evidence and last-check time. It reads the cache every 15 seconds through the shared resource model and clears expired or failed verification. It contributes to the additive `shell.status` slot without replacing `shell.bottom`. Text wraps in narrow frames and uses the active theme.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Dev Note

Verification requires fresh egress evidence; this sample cannot establish routing for other processes or destinations.


## Model Experience

None, as this package only renders operator-visible status.

#### KV Cache effect

No model request or reusable prefix is changed.

## Known Limitations and Deferred Work

- The row can lag the Host cache by 15 seconds; expiry removes verification locally. The Host package owns sampling limitations and opt-in configuration.
