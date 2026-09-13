# Agent Note: Model routes can select an agent preset

Status: implemented

English | [中文](2026-09-11-model-preset-bindings.zh.md)

## Problem

Model choice and agent composition are independent, but users commonly choose them as one operating mode. Repeating both choices for every new session is unnecessary, while storing composition inside provider configuration would make model adapters own agent tools and prompts.

## Decision

The `agent-presets` settings namespace stores optional preset ids under `models.<provider>.<model>`. An exact model binding selects the preset for a new session and recomposes a blank session when that model is selected. An explicit `agentPreset` on session creation takes precedence, and an unbound route inherits the current default preset.

The binding selects composition only. Provider, model, and reasoning settings remain owned by model routing. A session that has started may change models, but `agent-preset/locked` leaves its composition unchanged so logged tool calls remain valid.

The Web settings section lists current model routes beside healthy presets and writes one binding path at a time. Removing a binding exposes the default immediately, and deleting a custom preset clears every binding that names it.

## Alternatives considered

**Store the preset in each provider's model configuration.** This would couple every model adapter schema and editor to agent composition, and provider removal could strand a preset preference. The preset domain owns one provider-neutral map instead.

**Recompose every running session when its binding changes.** A running transcript may contain tool calls that the replacement preset cannot execute or present. Bindings therefore affect future or blank-session composition only.

## Consequences

Users can change model bindings without restarting the Host or editing provider configuration. Exact provider and model keys prevent collisions between providers that use the same model id. Running sessions keep stable tools and prompts, so a changed binding may not become visible in the current conversation.
