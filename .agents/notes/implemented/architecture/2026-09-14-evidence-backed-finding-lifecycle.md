# Agent Note: Evidence-backed finding lifecycle

Status: implemented

English | [中文](2026-09-14-evidence-backed-finding-lifecycle.zh.md)

## Problem

The canonical schema had a findings table but no validated write path. Executor output could not create, deduplicate, or advance a finding across fresh Sessions.

## Decision

Add typed finding updates to `pentest_submit_result`. Each update cites evidence tool-call IDs from the same result. New findings receive deterministic IDs from run, target, and normalized title. Existing findings follow checked lifecycle transitions. A task may carry basis finding IDs; leasing a suspected or inconclusive basis marks it validating before execution.

The manager validates all finding updates before it writes episode children. A verified finding must retain canonical evidence. The bounded Supervisor view includes recent finding records.

## Alternatives considered

**Let the model restate findings in prose and diff them on commit.** Rejected because free-form comparison makes deduplication probabilistic and lets a model claim regress or verify without pointing at observed evidence.

**Deduplicate with a vector-embedding similarity pass.** Rejected because canonical identity must stay deterministic and explainable; normalized run-target-title hashing is reproducible, and semantic similarity belongs to optional retrieval layers, not the state store.

**Give the Executor direct finding-table access.** Rejected because lifecycle transitions are workflow authority: the run manager must check every transition so a fresh episode cannot skip validating or resurrect a reported finding.

## Consequences

Findings survive Session loss with evidence-merged identities, and every verified claim traces to canonical evidence IDs. Invalid transitions and unbacked verifications reject before any episode child is written. A lease that ends without a commit now releases claimed basis findings back to suspected, so nothing stays validating on the strength of an attempt that never spoke.

## Verification

Focused tests cover typed tool output, controller commit, suspected-to-validating-to-verified transitions, evidence merging, deterministic deduplication, and rejection without partial episode or evidence writes.

## Deferred

Tool traces retain hashes and canonical references but not raw result bodies. Raw artifact retention needs a bounded host-owned facility.
