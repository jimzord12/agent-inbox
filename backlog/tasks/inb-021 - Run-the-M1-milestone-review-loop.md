---
id: INB-021
title: Run the M1 milestone review loop
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 07:14'
updated_date: '2026-10-22 10:30'
labels:
  - 'type:review'
milestone: m-0
dependencies:
  - INB-001
  - INB-002
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Closed review loop on the combined result of milestone M1 against its goal and exit condition (see the milestone file), per docs/practices/review.md. This task is the loop itself and gets no second per-task loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a fresh reviewer returns PASS on the milestone's final snapshot; every report is stored as docs/reviews/m-0-rN.md
- [x] #2 the milestone's exit condition is shown met by named evidence
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [x] #2 Evidence named in the final summary, with what remains unverified
- [x] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Fix the carried minors: CLI filter test discriminates kind, producer and unread; HANDOFF_UNAVAILABLE for a locked handoff file; fail refused after an accepted prompt; delivery clears a rejection (test). 2. Record build decisions in docs/decisions.md. 3. Gate. 4. Fresh milestone reviewer on M1 (goal and exit condition), store m-0-rN.md, loop to PASS.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carried from INB-001 round 2: R2-F1 (CLI filter test must discriminate --kind, --unread and --producer with a second producer and kind) and R2-F2 (a locked handoff file gives a retryable INVALID_ITEM with exit 2; decide a non-usage code such as HANDOFF_UNAVAILABLE with exit 1, plus a test). Fix both in the milestone round so the M1 review covers them.

Carried from INB-002 round 3: R3-F1 (fail must also refuse when prompt_state is accepted; only abandon or established closure may end such an attempt; add a test), N3 (rename or extend the last-rejection test to cover delivery). N1 (commit only after a confirmed focus op) belongs to INB-006; N2 (show prompt_state, not the raw op state) to INB-013.

Round 1 (docs/reviews/m-0-r1.md): PASS. Dispositions: M0-R1-F1 fixed (update compares the content hash before the revision check, so a retry after a lost response is changed:false; test added). M0-R1-F2 fixed (spyOn readFileSync throws EBUSY once; submit returns HANDOFF_UNAVAILABLE, retryable, no item stored). N1 routed to INB-013 (poll attempt get, not change_token). N2 routed to INB-006 and the M2 loop (INB-022). N3 routed to INB-015 (producers cap retries). N4 no action. N5 fixed (docs/reviews/README.md example is m-0-r1.md). Fixes changed reviewed code, so round 2 reviews the final snapshot.

Round 2 (docs/reviews/m-0-r2.md): PASS, Notes only. N1 routed to INB-015 (changed:false means the item holds your content). N2 no action. N3 routed to INB-006 (after dispatch started the worker marks uncertain, never blocked, so a late opening prompt is not erased). N4 fixed (hash-first rule in decisions.md Build decisions). Exit-condition evidence: m-0-r1.md and m-0-r2.md, real CLI runs on throwaway homes; gate 170 pass.
<!-- SECTION:NOTES:END -->
