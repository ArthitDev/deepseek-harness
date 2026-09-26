# Agent Note: Recon Full Deep pipeline, budgets, and coverage

Status: implemented

English | [中文](2026-09-22-recon-full-deep-pipeline.zh.md)

## Problem

The deterministic recon engine fingerprinted only the entry page. It never crawled, so routes announced by sitemap, robots, archives, or subpage markup stayed invisible; route-specific JavaScript chunks beyond the entry page were never downloaded; specification probes trusted a 200 status, so catch-all HTML routes read as exposed OpenAPI files; the API budget reused the JavaScript budget; probing was unbounded GET without request, wall-clock, or concurrency caps; technologies carried no storage layer or confidence, so a proxy-hidden backend surfaced as an unexplained empty list; and runs exposed no phase progress, coverage, or warnings, while cache entries survived scanner logic changes forever.

## Decision

**One profile.** Every operator-initiated scan (`recon_scan` tool, Remote `scan`, and the tab) runs the same Full Deep pipeline: DNS with certificate transparency, entry-page probe with headers/cookies/CORS/exposure/TRACE, content-validated public-metadata discovery, a bounded same-origin breadth-first crawl, JavaScript and source-map mining, OpenAPI 3.x/Swagger 2.0 parsing with safe probing, controlled service probes with read-only banners, and CT/SAN/link host expansion. `quick` and `standard` keep their narrower category sets for existing callers, but no surface offers a profile choice. Limits are config (`maxPages`, `maxDepth`, `crawlConcurrency`, `maxSourceMaps`, `maxApiEndpoints`, `maxHosts`, `maxTotalRequests`, `maxRunDurationMs`), validated loud at load against hard caps.

**Budgets truncate, never abort.** The web pipeline is sequential (entry → discovery → crawl → JavaScript → API) because each stage feeds the next; DNS, TLS, and services run in parallel with it, and external OSINT (Wayback, NVD) shares one bounded timeout slice inside the entry phase — its failure becomes a soft warning, never a degraded http section. Crawl and JavaScript mining yield the tail of the budget: they stop at a wall-clock share and a reserved request slice so endpoint probing always runs with real headroom. Every phase records duration and a `status.json` checkpoint, so a reloaded operator surface shows live progress and a completed run carries its phase history. When the request budget, deadline, or per-module cap hits, the module stops, records a `truncated` coverage entry with the reason, and the report lands as `partial` — never silently short. A cooperative `AbortSignal` (registry keyed by host, aborted through the new `cancel` Remote verb) turns an interrupted run into status `cancelled` with its partial report persisted.

**Observations over conclusions.** Every HTTP probe runs with certificate verification disabled — the TLS module's stance applied to the whole pipeline — so a self-signed or internal-CA origin scans fully instead of dying on its first fetch. DNS record lookups fan out concurrently under a one-second resolver timeout. Specification and OIDC documents validate by content (version key plus `paths`; issuer plus endpoints), so HTML catch-alls record a warning instead of a false specification. Endpoints are deduplicated by method plus normalized path, ordered auth/config/health first, and probed GET-only with OPTIONS capturing `Allow` on 405; template paths are inventoried but never fired; redirects stop at the origin edge; response samples are capped and credential-shaped values are redacted before storage. Technologies come from a versioned signature data file matched by evidence kind — including crawl URL paths, the body of a dedicated not-found probe (default 404 pages like `Cannot GET /` or `Apache Tomcat/10`), bounded product-path probes (Tomcat Manager, Solr, Grafana, phpMyAdmin, Kibana, MinIO, Nacos, Jellyfin, RabbitMQ, Portainer), and the favicon mmh3 hash reported in `favicon_hash` for Shodan-style cross-reference — and carry `layer` (`frontend | backend | edge | infrastructure | auth | data_store`), `confidence`, and `signals`; a run with no identifiable backend reports `backend_status: not_observable` plus the reason. Cache entries record the `scanner_version`; entries from another version never read as fresh. Operators extend the signature table through the `fingerprintOverlay` config — a JSON file of extra entries validated loudly at scan time. Legacy summaries migrate to the current schema on the read path only — stored bytes are never rewritten — and the operator surface badges them as legacy.

## Alternatives considered

**A profile selector with `quick` on the fast path.** Rejected — two renderings of every result (and every downstream interpretation of coverage) cost more than the bounded pipeline costs on small targets; coverage, not speed, decides completeness.

**Post-scanning entry-page scripts only, with the crawler deferred.** Rejected — route chunks are where SPA endpoints live; mining JavaScript before API inventory is what makes endpoint probing reach beyond the homepage.

**Resuming interrupted scans by replaying checkpoints.** Deferred — per-category cache reuse already skips fresh phases on the next run, and true mid-phase resume needs process identity this engine does not own; the checkpoints exist so the harness layer can add it without new evidence shapes.

## Consequences

Deep scans cost up to `maxTotalRequests` (default 300) HTTP requests and `maxRunDurationMs` (default 3 minutes) per host, and API probing now reaches every concrete endpoint discovered anywhere on the origin, so authorized-lab reports are noticeably larger. Reports missing `backend_technologies` are now explained rather than empty, and `warnings`/`coverage` are contractual fields every consumer can rely on. Stored v1 reports open with filled defaults plus a legacy warning; rescan is recommended but never forced.

## Verification

Local-fixture suites cover catch-all HTML rejection with its warning, OpenAPI 2.0/3.0 parsing with `$ref` chains (circular and external), crawl normalization/dedup/budget truncation, safe-method-only probing (fixture asserts no POST/PUT/PATCH/DELETE ever arrives), 401/403 auth-scheme capture, OPTIONS `Allow` hints, source-map candidate mining, redaction, JSON shape summaries, coverage and phase recording, scanner-version cache invalidation, read-path legacy migration, cancel-to-partial-report, and the operator surface's legacy badge, coverage, warnings, phases, backend-not-observable explanation, and scan-cancel button.
