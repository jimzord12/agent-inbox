---
id: INB-019
title: 'Run the remaining scenarios E02, E03 and E06-E11 once each'
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 07:20'
labels:
  - 'type:test'
  - eval
  - live
milestone: m-5
dependencies:
  - INB-018
  - INB-011
priority: medium
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evaluation plan §6 and §9. E12 (skill A/B) and repetitions are out of scope (level D). E09/E10 run only if a reliable barrier exists; otherwise they are reported as pending, never faked.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 each scenario has a stored report, or an explicit reason it could not run
- [ ] #2 the summary counts planned, attempted, completed, blocked and scored runs
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->
