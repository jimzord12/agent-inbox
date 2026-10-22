---
id: INB-002
title: 'Add handoff attempts with leases, fencing and receipt checks'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 07:05'
updated_date: '2026-10-22 08:42'
labels:
  - 'type:feature'
  - core
milestone: m-0
dependencies:
  - INB-001
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The database side of Open session (docs/generic-agent-inbox-spec.md §5.3, §6.2, §7, §9). Already built in commit 2bfa28c; this task carries it through review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 the database refuses a second in_progress/blocked/uncertain attempt for one item; a second open returns the existing attempt
- [x] #2 a worker write with a stale fencing generation is refused
- [x] #3 the startup binding is refused for a wrong session, cwd, Claude config dir or present auth env, and blocks the attempt
- [x] #4 the opening prompt is accepted once, only in the bound session and only after the dispatch intent is recorded
- [x] #5 a receipt with a wrong attempt, item, revision, packet hash or challenge is rejected; a revoked attempt's late receipt cannot count
- [x] #6 delivery commits receipt, success, archive(delivered) and events in one transaction; a restored delivered revision returns ALREADY_DELIVERED unless --fresh
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [x] #2 Evidence named in the final summary, with what remains unverified
- [x] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Code already built before the board existed. 2. Run the gate. 3. Carry it through the closed review loop in docs/practices/review.md, fix findings, re-review until PASS. 4. Check criteria on test evidence, final summary, Done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review round 1 (docs/reviews/INB-002-r1.md, FINDINGS) dispositions: F1 fixed (clearFailedOp refuses unless the prompt was definitively rejected; beginOp dispatch_prompt refuses unless prompt_state is none). F2 fixed (commitDelivery requires in_progress; a failed re-bind drops the receipt candidate so resume cannot deliver the old receipt). F3 fixed (fail refuses while an op is started or uncertain; abandon unrestricted). F4 fixed (acceptPrompt returns protocol and a stable code; closed attempts answer ATTEMPT_CLOSED instead of throwing; bad capability still throws). F5 fixed for live attempts (last_rejection on the attempt view, migration 3, reason and time only); revoked attempts still answer RECEIPT_INVALID and record nothing, since a revoked attempt has no view the owner is waiting on. F6 fixed (acceptPrompt checks cwd). F7 fixed (packet path fixed once dispatch began). F8 carried to INB-006 (the worker checks the Herdr target against agent_session before dispatch). F9 accepted: the ready marker deliberately checks only a non-empty orientation, not a waiting statement. Fixes went to a fresh round 2.

Review round 2 (docs/reviews/INB-002-r2.md, FINDINGS) dispositions: R2-F1 fixed (any [agent-inbox prompt is protocol; another attempt's prompt is refused WRONG_ATTEMPT, closed attempts answer ATTEMPT_CLOSED with protocol true). R2-F2 fixed (finishOp moves an op once from started or once from uncertain; an uncertain dispatch can never become failed; clearFailedOp needs a failed row; fail also refuses while prompt_state is started or uncertain). R2-F3 fixed (path literals doubled). N1 fixed (resume and delivery clear last_rejection). N2 accepted as the reviewer reasoned: a valid receipt from the bound session id with the right challenge proves that conversation holds the handoff; carried to INB-005 and INB-008. N3 handled in INB-005: the hook passes ordinary prompts when the attempt is unknown and blocks only inbox-prefixed ones.

Review round 3 (docs/reviews/INB-002-r3.md): PASS. R3-F1 and N3 carried to the M1 milestone loop INB-021; N1 to INB-006; N2 to INB-013.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Attempts layer (2bfa28c) plus fixes (60de7c2, 00acd22): one blocking attempt per item enforced by a partial unique index, lease and fencing generation on every worker write, an intent log that never repeats an ambiguous step, a startup binding that blocks on wrong session, cwd, config dir or auth env, a one-time opening-prompt guard that refuses foreign and duplicate protocol prompts, strict receipt validation, and an atomic delivery commit that needs an in-progress attempt. Evidence: test/unit/attempts.test.ts (40 tests, real SQLite), reviews INB-002-r1/r2 (FINDINGS, fixed) and r3 (PASS). Unverified: the worker and bridge callers (INB-005, INB-006), and fail after an accepted prompt is still allowed (carried to INB-021).
<!-- SECTION:FINAL_SUMMARY:END -->
