# Agent Note: Relational attack graph

Status: implemented

English | [中文](2026-09-14-relational-attack-graph.zh.md)

## Problem

The task tree recorded work, but fresh episodes had no canonical representation of relationships discovered between assets, services, endpoints, identities, credentials, findings, and evidence.

## Decision

Store typed graph nodes and directed edges in the existing `pentest_run` relational domain. Executor results use episode-local node references and cite evidence tool-call IDs. The manager validates the complete graph update before writes, assigns deterministic IDs, merges canonical evidence on repeated observations, and exposes a bounded graph projection to each fresh Supervisor.

## Alternatives considered

**Introduce a graph database now.** Rejected for v0.1: no measured path query needs it, and a second storage substrate would split canonical truth before the query load justifies it.

**Let each episode own a private graph merged at completion.** Rejected because cross-episode relationships are the point of the graph; episode-local refs are resolved to canonical identities inside one validated commit instead.

**Store edges with free-form endpoint labels.** Rejected because identity hashing on run, kind, and label is what makes repeated observations merge deterministically rather than duplicate.

## Consequences

Relationships survive Session loss and restart like every other canonical record, and repeated observations accumulate evidence IDs onto one node or edge instead of creating shadow copies. The projection stays bounded for the Supervisor, and unresolved edge endpoints reject before any episode child is written.

## Verification

Focused tests cover graph result schema, canonical commit, deterministic node and edge deduplication, evidence merging, SQLite restart, Supervisor visibility, and rejection of unresolved edges without partial episode writes.

## Deferred

No graph database is introduced. Add one only when measured path queries cannot be served by the bounded relational projection.
