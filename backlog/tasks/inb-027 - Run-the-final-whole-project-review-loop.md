---
id: INB-027
title: Run the final whole-project review loop
status: To Do
assignee: []
created_date: '2026-10-22 07:14'
labels:
  - 'type:review'
milestone: m-5
dependencies:
  - INB-021
  - INB-022
  - INB-023
  - INB-024
  - INB-025
  - INB-026
priority: high
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The closing closed review loop on the whole project at its final snapshot: level C as recorded in docs/decisions.md, against spec section 15 as mapped in decisions.md, per docs/practices/review.md. This task is the loop itself and gets no second per-task loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a fresh reviewer returns PASS on the final snapshot; reports stored as docs/reviews/final-rN.md
- [ ] #2 every applicable spec section 15 line is shown met by named evidence or recorded as out of scope in decisions.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
