---
id: INB-007
title: Prove the first live launch on the work profile
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 07:26'
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
Close the open points of docs/preflight.md section 7 for the work profile with a real Claude session opened through the inbox in a throwaway folder (path with a space and Unicode) inside a dedicated Herdr workspace. Uses the ccw (work) profile. Never touches the owner's own workspaces. The personal pane env (point 3) is recorded later by INB-018.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a real actionable item ends delivered, with binding, accepted prompt, receipt and focus recorded
- [ ] #2 --settings hooks were added on top of the profile's own hooks (prod-guard and the Herdr hook still ran)
- [ ] #3 the env seen by the session, Herdr's reported session id and the trust-dialog behaviour are recorded in docs/preflight.md
- [ ] #4 every gap found is fixed in this task or filed as a task
- [ ] #5 the worker survives the caller closing: agent-inbox open is run from a Claude session in a Herdr tab of the test workspace, that tab is closed, and the attempt still finishes (records preflight section 7 point 5; the mod is not needed)
- [ ] #6 a protocol prompt with a wrong attempt id or packet hash is sent into the live session and the UserPromptSubmit hook blocks it before the model sees it (records preflight section 7 point 2)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->
