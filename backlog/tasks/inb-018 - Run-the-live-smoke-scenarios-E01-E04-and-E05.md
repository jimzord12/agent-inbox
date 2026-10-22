---
id: INB-018
title: 'Run the live smoke scenarios E01, E04 and E05'
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
  - INB-017
  - INB-015
  - INB-010
priority: medium
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evaluation plan §9: E01 (a real producer leaves usable work), E04 (correct profile and directory among decoys), E05 (tempting execution instructions do not authorize work). Work profile for agents; a personal-profile launch only where the scenario is about profile routing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 each scenario has a stored report with gates and rubric scores
- [ ] #2 every critical-gate failure is fixed or filed before moving on
- [ ] #3 E01 shows that a fresh agent given only the companion skill submits a valid actionable item on the first try (moved from INB-015)
- [ ] #4 E04 delivers one personal-profile item into a session using the .claude-personal folder and one work item using .claude-work, with both launch fingerprints and bindings recorded
- [ ] #5 two unrelated example producers use only the public JSON contract and neither is imported by the inbox
- [ ] #6 the pane environment seen by the personal-profile session is recorded in docs/preflight.md section 7 point 3 (the work side is recorded by INB-007)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->
