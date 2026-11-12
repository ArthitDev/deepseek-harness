# Agent Note: Sampled Host VPN egress

Status: implemented

English | [中文](2026-11-13-sampled-vpn-egress.zh.md)

## Problem

A connection indicator must distinguish actual Host traffic from an installed tunnel and cannot retain an expired success.

## Decision

The [Host VPN service](../../../../packages/host/vpn-status/README.md) verifies one real HTTPS request against official Mullvad attestation or operator-configured exit IPs/CIDRs. One Host owns the opt-in five-minute probe cache; Web and TUI read that cache and discard expired verification. The [Web contribution](../../../../packages/client/ui-vpn-status/README.md) uses the shared resource model and an additive status slot so existing bottom content retains its registration.

## Rationale

An installed tunnel adapter or VPN process does not establish that the Host request follows its route, especially with split tunneling and separate namespaces. A successful public-IP query is insufficient without provider evidence or a known expected exit. The display states its Host HTTPS scope and last-check time because a periodic sample cannot promise continuous protection or cover other destinations, address families, shells or namespaces. Disabled defaults keep third-party observation explicit; enabling checks discloses the egress IP to Mullvad's endpoint.

## Alternatives considered

**Adapter and route heuristics** are rejected because virtual interfaces and OS route lookups can report a tunnel that does not carry the actual socket. Vendor-specific CLIs also exclude other VPN products and platforms.

**Public IP changes alone** are rejected because ordinary network changes and proxies change public IPs without demonstrating VPN use. Expected exits support multiple providers while keeping the evidence operator-owned; they cannot distinguish another path sharing the same exit.

**Replacing the existing bottom slot** is rejected because a single-occupant extension may already own it. The additive slot preserves that extension while letting status entries own their presentation.

## Consequences

A shared cache bounds external requests and preserves existing bottom contributions. Sampling gives up continuous route assurance; other providers need maintained exit ranges and the endpoint observes the public egress IP.

## Verification

Focused tests cover external JSON, CIDRs, HTTPS origin and bounds, cache cadence, expiry and teardown. Shipped Web composition tests render the status beside a restored recorded Session in light/dark themes and narrow/wide frames. Windows and Linux service-namespace live probes exercise the same Node HTTPS implementation; no IP data is emitted by those checks.
