---
id: INB-008
title: Add retry and abandon with reconcile-first behaviour
status: In Review
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 11:31'
labels:
  - 'type:feature'
  - worker
  - cli
milestone: m-1
dependencies:
  - INB-006
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retry first observes; it continues only a step proven not to have happened and never resends a prompt once its dispatch was recorded (docs/generic-agent-inbox-spec.md §4.3, §13). Abandon revokes the attempt without closing its session.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 retry of a blocked attempt with a receipt but failed focus only refocuses and commits
- [ ] #2 retry after a recorded dispatch never sends the prompt again
- [ ] #3 abandon releases the item, keeps the old session reference and revokes its receipt capability
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Worker retry mode: lift the block, reconcile each recorded op (confirmed skip, failed redo, started/uncertain observe). 2. Settle baseline from the dispatch op detail. 3. CLI retry and abandon. 4. Tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-002 review N2: while an attempt is blocked for a replaced session, a later valid receipt from the original bound session id is still captured; resume then commit is allowed, because it proves the original conversation holds the handoff.

From INB-006 round 1: N3, a retry worker reads the settle baseline from the dispatch_prompt op detail (baseline_state_seq), not memory. N5, attempt next_actions already offers retry; this task makes it real. Attempts.resume(id, gen, onlyCode) lifts a specific block only.

From INB-006 round 3 N1: when Herdr never reported the session id, the settle-timeout block message should say so (today: 'has not settled after acknowledging').

Built: Worker retry mode (src/worker/worker.ts), worker main --retry, CLI retry ATTEMPT (starts a retry worker unless a live lease holds the attempt) and abandon ATTEMPT. Bug found by the tests and fixed in core: finishOp replaced the detail recorded at beginOp, losing the dispatch's settle baseline; details now merge (test). A failed focus is redone by retry (focus carries no context); a confirmed focus with no commit is committed without focusing again (no test yet: needs a crash between the two writes; carried to INB-010). A blocked attempt the bridge refused (wrong profile or replaced session) can be retried, but nothing is sent: the walk stops at the binding or identity check. INB-006 r3 N1 fixed: the settle timeout says when Herdr never reported the session id.

Round 1 (docs/reviews/INB-008-r1.md): FINDINGS. F1 Material fixed: retry never lifts PROFILE_LAUNCH_UNSUPPORTED (the CLI refuses it with that code; a retry worker releases and leaves it), and resume is passed the observed error code, so a verdict landing between the read and the resume is kept (also F7). Tests for the first-start and after-bind cases, plus the CLI refusal. F2 fixed: a retry whose worker cannot be spawned reports INTERNAL and leaves the attempt as it was. F3 fixed: bridge acceptance confirms a dispatch left started by a crash (test). F4 fixed: tests for the uncertain-focus redo, the own-session check in observeStart, the preflight skip, and the carried N2 case (late valid receipt from the original session after a replaced-session block delivers with one prompt). F5 accepted (stays uncertain until reconcile or abandon, per spec; INB-009 scope). F6 fixed: the message follows the last read, not any earlier one.
<!-- SECTION:NOTES:END -->
