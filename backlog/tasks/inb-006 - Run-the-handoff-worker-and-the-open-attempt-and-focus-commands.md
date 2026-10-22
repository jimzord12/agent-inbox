---
id: INB-006
title: 'Run the handoff worker and the open, attempt and focus commands'
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 10:30'
labels:
  - 'type:feature'
  - worker
  - cli
milestone: m-1
dependencies:
  - INB-003
  - INB-004
  - INB-005
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
agent-inbox open reserves an attempt and starts a detached worker with stdio ignored (mod spike rule, docs/decisions.md) that walks preflight, create_layout, start_agent, submit_context, await_receipt, focus (docs/generic-agent-inbox-spec.md §4.2, §10.2), recording intent before each side effect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 open returns attempt_id, status and reused within about a second; the worker keeps running after the caller exits
- [ ] #2 a missing cwd, unknown profile or unavailable Herdr ends the attempt before any context is sent, with the stable error code
- [ ] #3 the launch sets CLAUDE_CONFIG_DIR explicitly, passes --session-id and --settings, and uses a unique per-attempt agent alias
- [ ] #4 the item becomes delivered only after receipt candidate, a new settled state and a successful focus
- [ ] #5 attempt get shows phase, evidence and safe next actions; focus never sends context
- [ ] #6 open --profile P records an override on the attempt without changing the payload; open --fresh is required to reopen a delivered revision, and the CLI never adds it implicitly
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-002 review F8: the core binding has no Herdr target; the worker owns that check - before dispatch, agent get on the alias must show agent_session.value equal to the attempt session_uuid and the recorded pane.

From INB-003 review round 2 N1: a failed workspace get (any error) must never be read as the workspace being gone; only a null result is.

From INB-002 round 3 N1: commit delivery only after finishOp(focus, confirmed); the core trusts the caller's focus argument.

From INB-005 round 1 N1: writeBridgeSettings defaults the hook script to import.meta.dir/main.ts and Bun to process.execPath; pin stable paths (INB-020 for the installed build).

From M1 round 2 N3: once dispatch has started, a timeout or doubt makes the attempt uncertain, not blocked; a blocked attempt refuses (erases) a late opening prompt.
<!-- SECTION:NOTES:END -->
