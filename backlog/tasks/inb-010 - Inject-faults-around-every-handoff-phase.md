---
id: INB-010
title: Inject faults around every handoff phase
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 11:20'
labels:
  - 'type:test'
  - worker
milestone: m-2
dependencies:
  - INB-009
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Acceptance list 'Crash and storage recovery' in docs/generic-agent-inbox-spec.md §15: a fault at each phase boundary must not produce a false delivery or a blind replay.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 faults after layout creation, agent start, prompt dispatch, receipt capture, focus and before the final commit are each tested
- [ ] #2 a lost prompt response leaves the attempt uncertain; repeated opens create no second session
- [ ] #3 a busy store and a backup/restore keep committed snapshots, attempts and events
- [ ] #4 a full disk or database-full error during a write leaves no partial item, attempt or event and returns a clear error
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-005 round 3 N2: test that a busy Stop whose reply is not a valid receipt writes no receipt-pending.json.

From INB-008: inject a crash between finishOp(focus, confirmed) and commitDelivery, then check that retry commits without focusing again.
<!-- SECTION:NOTES:END -->
