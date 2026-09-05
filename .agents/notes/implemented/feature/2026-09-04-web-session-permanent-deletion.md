# Agent Note: Permanent Web Session deletion

Status: implemented

English | [中文](2026-09-04-web-session-permanent-deletion.zh.md)

## Problem

The Web Session menu could rename, fork, or archive a conversation but could not permanently remove its stored history. Archive intentionally keeps the log and Workspace accounting, while Workspace deletion removes only a project registration. Neither operation satisfies a user who wants one visible conversation removed without deleting project files.

A destructive path must also respect live Agent ownership. Closing an Agent owned by another carrier, deleting a subagent independently, removing the project `cwd`, or deleting a log while its writer is active would cross existing ownership boundaries or corrupt data.

## Decision

The visible Session-row menu offers **Delete session** in addition to Archive. It opens a confirmation that states the irreversible history removal, running-task stop, and project-file retention. Controls remain disabled while the request is pending; failure keeps the dialog open with the error.

`SessionPersistence.delete(id, options?)` is the canonical storage primitive. The JSONL backend takes the same single-writer claim used by write handles, rejects an active writer, removes only the encoded Session-owned directory below its configured root, returns `false` for an absent id, releases its claim on every exit, and permits later id reuse. It never removes the header's `cwd`.

`session.delete` serializes requests per id. A persisted log or a live Agent makes the identity eligible. `ApiSessionAgentController` disposes a live Agent only when it retained that exact `AgentHandle`; foreign owners and subagent identities return `session/agent-busy`. This also lets a Web-owned blank Session be deleted before its lazy log has materialized.

After Agent disposal, the Host first calls `WorkspaceRegistry.forgetSession(id)` to detach the id from every Workspace account and the global archive set, then deletes the persistent log. Cleanup-first means a failure cannot leave a deleted id attached to durable Workspace metadata; if log deletion fails, the history remains available for retry. Success emits `api-session/removed`, and the requesting Client applies the same removal immediately rather than waiting for its stream echo.

The deletion authority owns the canonical Session log and Workspace references only. Project files remain. Message-feedback sidecars and tool-output spill retention are separate backend policies, so this action is not advertised as secure erasure of every derived or auxiliary record; a reused id is protected from stale message feedback by header-identity matching.

## Alternatives considered

**Keep Archive as the only Session-removal gesture.** Rejected because Archive is reversible-by-design storage retention even though the current UI lacks an unarchive surface; it does not meet permanent history removal.

**Cascade from Workspace deletion.** Rejected because a Workspace registration does not own its Sessions or source directory. Workspace deletion continues to preserve histories under Ungrouped.

**Delete the log before Workspace cleanup.** Rejected because a cleanup failure would leave durable membership or archive state pointing at an absent id, and later id reuse could inherit it.

**Dispose any live Agent with the same id.** Rejected because ACP, SDK, or another carrier may own that handle. Only the Web controller that retained the exact handle may stop it.

**Introduce a general transactional cleanup-participant framework.** Rejected for this capability because the canonical log and Workspace metadata can be ordered safely without a new abstraction. Add a participant contract only when auxiliary stores require coordinated erasure rather than their existing retention and reconciliation policies.

## Consequences

Session deletion is irreversible at the product surface, but its filesystem boundary is narrow and project-safe. A failed request may leave the preserved Session ungrouped or unarchived before retry; it does not report success after a Workspace cleanup failure. Persistence contract tests pin idempotence, active-writer exclusion, cancellation, directory containment, and id reuse; controller, Client, Workspace, and UI tests pin ownership, blank-session deletion, commit order, projection removal, confirmation, and file retention.
