---
id: INB-011
title: Track session availability after delivery
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
labels:
  - 'type:feature'
  - worker
  - herdr
milestone: m-2
dependencies:
  - INB-009
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A delivered item stays in History; when its session closes only its availability changes (docs/generic-agent-inbox-spec.md §4.2 step 9, §13). Focus works while the verified session lives; the session reference is always shown.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 focus of a delivered item checks the live agent's session id before focusing
- [ ] #2 a closed or replaced session is shown as closed/unknown, never focused by pane id alone
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
