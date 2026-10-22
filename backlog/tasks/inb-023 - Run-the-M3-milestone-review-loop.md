---
id: INB-023
title: Run the M3 milestone review loop
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-22 07:14'
updated_date: '2026-10-22 13:03'
labels:
  - 'type:review'
milestone: m-2
dependencies:
  - INB-009
  - INB-010
  - INB-011
priority: high
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Closed review loop on the combined result of milestone M3 against its goal and exit condition (see the milestone file), per docs/practices/review.md. This task is the loop itself and gets no second per-task loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a fresh reviewer returns PASS on the milestone's final snapshot; every report is stored as docs/reviews/m-2-rN.md
- [ ] #2 the milestone's exit condition is shown met by named evidence
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Round 1 (docs/reviews/m-2-r1.md): PASS with Minors, fixed anyway. F1 fixed: a store error inside a Herdr step's try is rethrown and stops the worker as a crash, instead of being read as an unclear Herdr answer (test). F2 fixed: the waiting worker replays receipt-pending.json on each poll, so a busy Stop needs no CLI read (test; decisions.md). N1-N4, N6 noted; N5 routed to INB-014 (re-check worker survival with the mod as caller). Unverified live: a real Herdr restart, ENOSPC, an OS process kill.
<!-- SECTION:NOTES:END -->
