---
id: INB-010
title: Inject faults around every handoff phase
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 12:37'
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
- [x] #1 faults after layout creation, agent start, prompt dispatch, receipt capture, focus and before the final commit are each tested
- [x] #2 a lost prompt response leaves the attempt uncertain; repeated opens create no second session
- [x] #3 a busy store and a backup/restore keep committed snapshots, attempts and events
- [x] #4 a full disk or database-full error during a write leaves no partial item, attempt or event and returns a clear error
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [x] #2 Evidence named in the final summary, with what remains unverified
- [x] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
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

Round 1 (docs/reviews/INB-010-r1.md): PASS. F1 fixed after the PASS with a test only (a plain worker on a crashed attempt finds start_agent recorded, ends uncertain, starts nothing and sends nothing); no code changed, so no new round. F2 fixed (decisions.md Build decisions: the busy SessionStart retry and its bound). N1, N3-N5 accepted as described. N2 noted: a full disk that SQLite reports as SQLITE_IOERR gets the generic store message. Evidence: test/unit/faults.test.ts (15), 17 deletion probes by the reviewer. Unverified: a real ENOSPC and a real OS process kill.
<!-- SECTION:NOTES:END -->
