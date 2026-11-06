# Agent Note: Deterministic recon engine

Status: implemented

English | [中文](2026-09-21-deterministic-recon-engine.zh.md)

## Problem

Initial reconnaissance ran as repeated model-driven tool calls (curl, DNS lookups, header reads), spending inference rounds and input tokens on fixed procedure and pulling raw tool output into context. Results had no stable schema, no raw-evidence trail, and nothing stopped the model from repeating the same checks next round.

## Decision

Reconnaissance procedure is code. The engine exposes two tools and no model-facing knob for scope: `recon_scan(target, profile, force)` and `recon_get_evidence(ref)`. Profiles map to check categories — `quick` (DNS core, HTTP, TLS), `standard` (plus full DNS OSINT, public metadata, HTML surfaces, JS inventory, fingerprints), `deep` (plus JS-body mining, a controlled connect probe over config-provisioned ports, and a certificate-transparency subdomain lookup). Independent probes fan out in parallel; each module stores its raw output under `<evidenceDir>/<runId>/` and the model receives one compact deterministic report whose every finding carries an evidence ref. A per-host freshness index with per-category TTLs returns the cached summary on repeat scans unless `force` is set.

Three boundaries are load-bearing. First, scope authorization reuses the pentest-run normalized-target vocabulary, so the scope that gates exploitation gates reconnaissance with identical semantics, and the model cannot widen it — the tool layer has no target parameter beyond the target itself. Second, evidence refs are path-contained at read time; `recon://` is a capability token for one file, not a directory listing. Third, the render path emits a bounded line format, never raw bodies — HTML and JS content reach the model only through explicit `recon_get_evidence` calls, which are themselves size-capped.

## Alternatives considered

**An agent-facing skill with the recon methodology.** Rejected as the starting point — policy text is paid on every conversation and enforces nothing; the engine makes repetition structurally impossible via cache/dedup, and the thin prompt section covers ordering.

**Shelling out to nmap/curl.** Rejected for the MVP — external binaries break the deterministic-fixture test story and vary per host; Node's own DNS, fetch, TLS, and net cover the initial phase. Wrapping external scanners stays open for a later profile.

**Storing recon results in the pentest-run domain.** Rejected for now — recon is read-only observation with its own lifecycle and cache; promoting interesting targets into canonical tasks is the harness layer's job and stays deferred until the attack-loop integration lands.

## Consequences

Initial reconnaissance costs one tool call and one compact report; raw data never enters context by default. The certificate-transparency lookup is the single external OSINT dependency and fails soft. Tests inject DNS, CT, and (when needed) TLS surfaces, so the suite stays offline and deterministic except for one local real-TLS handshake over a committed self-signed fixture.

## Verification

Deterministic tests cover target/scope rejection, a standard-profile end-to-end run over a local HTTP fixture (discovery, fingerprints, emails, API candidates, findings), cache hit and force behavior, real-TLS certificate facts over a local https fixture, the controlled port probe, evidence read-back with path-containment rejection, and every rule/helper in isolation.

## Deferred

Passive-DNS, wayback, and search-engine pivots; external scanner profiles; feeding `interesting_targets` into pentest-run task creation; cost benchmarking against the pre-engine baseline.
