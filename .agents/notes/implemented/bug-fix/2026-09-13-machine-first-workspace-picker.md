# Agent Note: Select a machine before a Workspace in the empty Session

Status: implemented

English | [中文](2026-09-13-machine-first-workspace-picker.zh.md)

## Problem

The empty-Session Workspace picker flattened local and remote Workspaces into one list and labeled the local group with generic copy. After deleting the selected Session, the picker therefore skipped the execution-machine choice and could show `This computer` instead of the Host hostname.

Both new-Session actions also reached `ctx.layout` without declaring the `layout` service in the ui-workspace plugin's inject list. Cordis rejected that access before `sessions.create`, so clicking either action sent no request.

## Decision

The empty-Session picker presents the local Host and every saved remote machine as parent menu rows. Opening one parent reveals only that machine's Workspaces; the local parent also contains the composed add-Workspace action. The local row uses the Host hostname when available, while the sidebar's existing grouped browser remains unchanged.

New Session and each Workspace `+` action call `sessions.create({ workspaceId })` directly, so every gesture mints a fresh Session even when that Workspace already has a reusable blank. Ordinary Workspace selection retains the reusable-blank behavior. Navigation cancellation prevents a slower earlier creation from opening over a later selection.

The ui-workspace plugin now declares `layout` as a runtime dependency. Its apply test invokes the shared New Session action through a real Cordis plugin context, so removing the declaration fails at the same boundary as the browser bug.

## Alternatives considered

**Keep the flattened list and add headings.** Rejected because headings do not make the execution-machine choice explicit and omit saved machines that have no Workspace.

**Create another machine selector beside the Workspace selector.** Rejected because two controls can represent conflicting targets and duplicate the hierarchy already supported by the shared Menu primitive.

## Consequences

Starting from an empty Session requires one machine-selection step before choosing a Workspace. Saved machines without Workspaces remain visible but disabled, and creating a remote Workspace continues through the remote-machine connection control that owns SSH trust and authentication. Repeated New Session gestures create repeated blank Sessions by design; only the latest unsuperseded result opens.
