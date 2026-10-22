---
id: INB-008
title: Add retry and abandon with reconcile-first behaviour
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 08:37'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-002 review N2: while an attempt is blocked for a replaced session, a later valid receipt from the original bound session id is still captured; resume then commit is allowed, because it proves the original conversation holds the handoff.
<!-- SECTION:NOTES:END -->
