---
id: INB-022
title: Run the M2 milestone review loop
status: To Do
assignee: []
created_date: '2026-10-22 07:14'
updated_date: '2026-10-22 08:42'
labels:
  - 'type:review'
milestone: m-1
dependencies:
  - INB-003
  - INB-004
  - INB-005
  - INB-006
  - INB-007
  - INB-008
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Closed review loop on the combined result of milestone M2 against its goal and exit condition (see the milestone file), per docs/practices/review.md. This task is the loop itself and gets no second per-task loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a fresh reviewer returns PASS on the milestone's final snapshot; every report is stored as docs/reviews/m-1-rN.md
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
Carried from INB-004 round 2: R2-F1 (unit test that loadProfiles refuses a root-relative claude_config_dir), N1 (README: drive or UNC paths only; unknown config.json keys are refused), N3 (optionally canonicalise hand-written profile folders on load). Fix in the M2 milestone round.

Carried from INB-003 round 3: R3-F1 (on agent start, treat agent_not_found, workspace_not_found and tab_not_found as unknown, or make the pre-effect set per verb; add a test).
<!-- SECTION:NOTES:END -->
