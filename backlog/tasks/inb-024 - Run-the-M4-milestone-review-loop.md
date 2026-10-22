---
id: INB-024
title: Run the M4 milestone review loop
status: To Do
assignee: []
created_date: '2026-10-22 07:14'
updated_date: '2026-10-22 14:09'
labels:
  - 'type:review'
milestone: m-3
dependencies:
  - INB-012
  - INB-013
  - INB-014
priority: high
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Closed review loop on the combined result of milestone M4 against its goal and exit condition (see the milestone file), per docs/practices/review.md. This task is the loop itself and gets no second per-task loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a fresh reviewer returns PASS on the milestone's final snapshot; every report is stored as docs/reviews/m-3-rN.md
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
From INB-012 round 2: R2-MIN-1 add an engine test pinning the row guard (old view's rows never drawn under a new view; see docs/reviews/INB-012-r2.md for the steps). Notes: R2-NOTE-1 MOD_ERROR catch has no generation check; R2-NOTE-2 lone skin tone under-counts, tag flags over-count, emoji width unverified live; R2-NOTE-3 a hot reload clears isBusy (development only).

From INB-013 round 2: F1 (Minor) 'Focus failed' should also require the receipt (bridge RECEIPT_INVALID in the focus phase after a manual /clear); N1 the Claude-closed hint suggests focusing a closed session; N2 the page-turn scroll is pinned only by the live check.
<!-- SECTION:NOTES:END -->
