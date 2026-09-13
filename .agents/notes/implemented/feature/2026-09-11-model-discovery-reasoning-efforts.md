# Agent Note: Model discovery carries reasoning efforts

Status: implemented

English | [中文](2026-09-11-model-discovery-reasoning-efforts.zh.md)

## Problem

Custom OpenAI-compatible providers could list model ids and capacities, but the discovery path discarded reasoning capability metadata. A fetched model therefore had no Effort menu even when its endpoint described the supported levels.

## Decision

`LlmDiscoveredModel` carries an optional map from Harness effort ids to endpoint-facing values. The pi-ai discovery parser reads OpenRouter's `reasoning.supported_efforts` and the `supported_reasoning_efforts` arrays exposed by LiteLLM and Codex. It accepts strings and object entries, maps `none` to `off`, ignores unknown levels, and publishes no reasoning capability unless at least one thinking level is valid.

The LLM service preserves the map across its Remote boundary. The Models page stores it as the selected model's existing `reasoningEfforts` profile field when the user adopts a discovery result. A configured model with newly disclosed reasoning metadata starts selected; adoption fills fields that were absent while every stored field wins over the endpoint's value. Hand-entered models and endpoints that omit the metadata keep the provider-default behavior and expose no Effort menu.

## Alternatives considered

**Hardcode known custom providers.** Rejected because every new gateway or model alias would require a Harness release, and provider ids belong to deployments rather than the product.

**Infer reasoning from model names or a generic `reasoning_effort` parameter flag.** Rejected because support for the parameter does not identify the valid levels or the spelling that disables reasoning.

**Add reasoning controls to every model row.** Rejected because discovery can fill the existing profile field without expanding the common form. Manual `settings.yaml` configuration remains available when an endpoint reports no capability.

## Consequences

Providers that publish supported effort levels can populate the Harness picker without built-in catalog entries. Providers that omit them remain unchanged. Discovery trusts only known Harness level ids, so a provider-specific vocabulary still requires an explicit `reasoningEfforts` profile map.

The focused discovery, LLM service, and Models-page tests pin parsing, Remote preservation, and adoption.
