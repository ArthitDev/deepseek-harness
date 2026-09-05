# Agent Note: Host settings on one Tailnet origin

Status: implemented

English | [中文](2026-09-05-tailnet-host-settings.zh.md)

## Problem

An authenticated browser opened through Tailscale uses a non-loopback hostname. The Client therefore selected memory-only settings, so the provider directory could not load even though browser authentication and the Host/Origin trust checks succeeded.

## Decision

This local build allows Host-backed settings from the exact HTTPS origin `msi-cyborg-15-nb.tailaa5429.ts.net`. The exception lives only in `ui-settings`; it does not classify the browser as loopback and does not enable native file opening or other loopback-only UI. The Host still requires the configured `trustedHosts` match and a valid authority-bound browser cookie before any API dispatch.

## Alternatives considered

Classifying the Tailnet page as loopback would also expose native-only UI. Accepting every HTTPS host would weaken the origin restriction. Keeping remote browsers on memory-only settings leaves provider configuration unavailable.

## Verification

A focused test accepts loopback and the exact HTTPS hostname, while rejecting plaintext HTTP and another Tailnet hostname. The settings and provider-directory unit suites pass, as do their package bundles.

## Consequences

An authenticated browser at this exact Tailnet origin can read and write the settings namespaces exposed by the existing wire API. If the machine's MagicDNS name changes, this allowlist must change with it. Other remote origins stay in memory-only mode.
