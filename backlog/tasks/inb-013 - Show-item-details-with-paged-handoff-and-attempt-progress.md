---
id: INB-013
title: Show item details with paged handoff and attempt progress
status: In Progress
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 14:05'
labels:
  - 'type:feature'
  - mod
milestone: m-3
dependencies:
  - INB-012
priority: high
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Details show summary, profile, cwd, instruction, retained handoff, references, snapshot time, prior attempts and availability (spec §12.1). Long handoffs are paged by the mod (engine limit ~100,000 characters).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a 256 KiB handoff pages from start to end with no lost lines
- [ ] #2 attempt progress distinguishes starting, waiting on the user, waiting for acknowledgment, focus failure and uncertain
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-002 round 3 N2: show prompt_state as the dispatch evidence; a reconciled dispatch op can stay uncertain on a delivered attempt.

From INB-009 round 1 N4: after a machine sleep, reconcile on the mod's list can find a live worker's lease lapsed and mark the attempt uncertain; show it as retryable, not as a failure.

From INB-011 round 2 F1: show the attempt's stored availability, not the focus error's details; focus on a blocking attempt whose agent is not registered yet reports 'no longer running' though the session may still be starting.

From the M2 milestone review N2: focus on a dialog-held start returns focused: true, starting: true with the stored availability (often unknown); key on starting.

Round 1 (docs/reviews/INB-013-r1.md, FINDINGS) dispositions:
- F1 fixed: 'Focus failed' only for the focus phase; acknowledged-then-stopped short of focus (Claude closed, never settled, session moved, no session id) is 'Acknowledged, then stopped' with the stored message first; unit test covers the worker's four await_receipt blocks.
- F2 fixed: the empty piece after a final line break stays on the last page; unit test for whole pages.
- F3 fixed: reference label and URI are clipped where drawn (80/300); engine test with every field at its core limit draws the whole page and fails without the clips.
- N1 fixed: page turns use update() (compare-and-set); engine test (two quick presses turn two pages); live, 20 fast presses landed on page 22.
- N2 fixed: submit_context reads 'Sending the handoff'; await_receipt keeps 'Waiting for the session to acknowledge'.
- N5 fixed: engine test switches items mid-read and records stored details; fails without the drop.
- N6 handled: a page turn scrolls the pane to the page header (best effort); live the new page shows its header and first line.
- N3 (UTC) and N4 (safe next action buttons) go to INB-014 with snooze and the actions.
<!-- SECTION:NOTES:END -->
