---
id: INB-007
title: Prove the first live launch on the work profile
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
labels:
  - 'type:test'
  - live
  - worker
  - bridge
milestone: m-1
dependencies:
  - INB-006
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close the six open points in docs/preflight.md §7 with a real Claude session opened through the inbox in a throwaway folder (path with a space and Unicode) inside a dedicated Herdr workspace. Uses the ccw (work) profile. Never touches the user's own workspaces.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a real actionable item ends delivered, with binding, accepted prompt, receipt and focus recorded
- [ ] #2 --settings hooks were added on top of the profile's own hooks (prod-guard and the Herdr hook still ran)
- [ ] #3 the env seen by the session, Herdr's reported session id and the trust-dialog behaviour are recorded in docs/preflight.md
- [ ] #4 every gap found is fixed in this task or filed as a task
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
