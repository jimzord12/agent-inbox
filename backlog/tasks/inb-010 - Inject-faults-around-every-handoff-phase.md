---
id: INB-010
title: Inject faults around every handoff phase
status: In Review
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 12:23'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Crash simulation: one store write trips, no write after it lands. 2. A crash at each phase boundary, then reconcile and retry. 3. Lost prompt and repeated opens. 4. Busy store, backup and restore, full store. 5. The carried bridge faults.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-005 round 3 N2: test that a busy Stop whose reply is not a valid receipt writes no receipt-pending.json.

From INB-008: inject a crash between finishOp(focus, confirmed) and commitDelivery, then check that retry commits without focusing again.

From INB-009 round 3: F1, stamp receipt-pending.json's written_at when the Stop hook starts (not when it writes), and test a busy Stop that writes after a refused bind (/clear); the candidate must not come back. N1, a SessionStart that meets a busy store records nothing: inject it and decide whether the worker's bind timeout is enough.

Built test/unit/faults.test.ts (14 tests). A crash is simulated by spying on every Attempts write: the tripping write and all later ones throw, so the store holds exactly what a dead worker left; its lease then lapses. Cases: after the tab, after the start, after the prompt, after the receipt, after the focus before the commit (reconcile commits it, calling nothing; retry also commits without a second focus), and before the tab answer was recorded (stays uncertain, no second tab). Each checks: reconcile makes no Herdr call; delivery only with full evidence; one tab, one start, one prompt. Lost prompt: uncertain; three more opens reuse the attempt and start no worker. Storage: busy store refuses with STORE_BUSY and changes nothing; VACUUM INTO backup restores items, revisions, attempts, ops and events exactly; a full store (max_page_count) refuses submit and open with STORE_ERROR {reason: full} and a clear message, nothing half-written. Code changes: SQLITE_FULL maps to that clear message; the bridge stamps receipt-pending.json with the hook's start time (INB-009 r3 F1, test); a SessionStart that meets a busy store is tried once more (INB-009 r3 N1, test); a busy Stop with no receipt saves nothing (INB-005 r3 N2, test). Not done: a real disk-full (ENOSPC) or OS-level crash; the page limit stands in for both.
<!-- SECTION:NOTES:END -->
