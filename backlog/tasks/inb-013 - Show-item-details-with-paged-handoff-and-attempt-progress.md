---
id: INB-013
title: Show item details with paged handoff and attempt progress
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 13:16'
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
<!-- SECTION:NOTES:END -->
