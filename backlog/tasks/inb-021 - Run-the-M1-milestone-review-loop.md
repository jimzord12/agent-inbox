---
id: INB-021
title: Run the M1 milestone review loop
status: To Do
assignee: []
created_date: '2026-10-22 07:14'
updated_date: '2026-10-22 08:33'
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
- [ ] #1 a fresh reviewer returns PASS on the milestone's final snapshot; every report is stored as docs/reviews/m-0-rN.md
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
Carried from INB-001 round 2: R2-F1 (CLI filter test must discriminate --kind, --unread and --producer with a second producer and kind) and R2-F2 (a locked handoff file gives a retryable INVALID_ITEM with exit 2; decide a non-usage code such as HANDOFF_UNAVAILABLE with exit 1, plus a test). Fix both in the milestone round so the M1 review covers them.
<!-- SECTION:NOTES:END -->
