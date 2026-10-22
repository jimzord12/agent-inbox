---
id: INB-006
title: 'Run the handoff worker and the open, attempt and focus commands'
status: In Review
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 10:44'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Worker (src/worker/worker.ts) with lease, phases and the op log. 2. Detached entry (src/worker/main.ts). 3. CLI open / attempt get / focus. 4. Fake Herdr server plus simulated bridge for unit tests. 5. Review loop.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-002 review F8: the core binding has no Herdr target; the worker owns that check - before dispatch, agent get on the alias must show agent_session.value equal to the attempt session_uuid and the recorded pane.

From INB-003 review round 2 N1: a failed workspace get (any error) must never be read as the workspace being gone; only a null result is.

From INB-002 round 3 N1: commit delivery only after finishOp(focus, confirmed); the core trusts the caller's focus argument.

From INB-005 round 1 N1: writeBridgeSettings defaults the hook script to import.meta.dir/main.ts and Bun to process.execPath; pin stable paths (INB-020 for the installed build).

From M1 round 2 N3: once dispatch has started, a timeout or doubt makes the attempt uncertain, not blocked; a blocked attempt refuses (erases) a late opening prompt.

Built in f548845. Design choices for review: a failed workspace create/ensure fails the attempt with HERDR_UNAVAILABLE (no op exists for it; at worst an empty inbox workspace is left). After dispatch began, doubt means uncertain, never blocked (M1 N3). A failed agent read is never 'gone'. The dialog-blocked start is focused without an op (focus is idempotent and carries no context). The workspace id is remembered per socket in <home>\herdr-state.json. open starts a worker only for a new attempt; picking up a reused one is retry (INB-008). Evidence: test/unit/worker.test.ts (27), CLI open tests (detached worker ends the attempt after the CLI exited). Unverified until INB-007: real Herdr answers for agent start/prompt/focus, state_change_seq behaviour, and that the worker survives its caller's tab closing.

Round 1 (docs/reviews/INB-006-r1.md): FINDINGS. F1 fixed: Attempts.resume(id, gen, onlyCode) lifts only the worker's own AGENT_BLOCKED in the same transaction, so a bridge verdict landing during the dialog wait is kept (test). F2 fixed: two tests, idle without a moved state and a moved state while working. F3 fixed: tests for the pane check before dispatch, session and pane re-checks after the receipt, the alias gone, abandon during the dialog wait, and the pane check in focus. F4 fixed: crashed() keeps an existing block or uncertainty, and fails with INTERNAL when nothing external happened (tests). F5 fixed: a missing session id after the receipt is looked at again (test). F6 fixed: open starts a worker for a reused attempt that no worker owns and that has nothing external recorded (needsWorker; tests); the async spawn-error handler stays empty because the CLI exits first, and this covers it. N1 accepted (two first-ever opens may create two inbox workspaces; the last one is remembered). N2 fixed (a failed state-file write is logged, not reported as Herdr down). N3 to INB-008 (the dispatch baseline is in the dispatch_prompt op detail; a retry worker reads it from there). N4 to INB-007 (check whether state_change_seq or completion_seq marks the opening turn's end on the real Herdr). N5 to INB-008 (retry action). N6 accepted: a reused attempt keeps its profile; to change it, abandon first. N7 fixed (label cuts by character). N8 fixed. N9 accepted (the dialog focus carries no context).
<!-- SECTION:NOTES:END -->
