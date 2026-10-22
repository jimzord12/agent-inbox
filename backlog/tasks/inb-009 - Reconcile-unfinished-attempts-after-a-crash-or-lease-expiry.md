---
id: INB-009
title: Reconcile unfinished attempts after a crash or lease expiry
status: In Review
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 11:50'
labels:
  - 'type:feature'
  - worker
milestone: m-2
dependencies:
  - INB-008
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A replacement worker reads the intent log and live Herdr state; ambiguous steps become uncertain, never repeated (docs/generic-agent-inbox-spec.md §7, §13). Includes discovering an orphan tab when tab creation's answer was lost.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 an expired lease lets a new worker in and fences the old one out of every write
- [ ] #2 a started tab creation with no recorded result is matched to a tab only by attempt provenance plus session binding, otherwise left uncertain
- [ ] #3 a late valid receipt is reconciled without resubmitting the prompt
- [ ] #4 running any agent-inbox command that reads attempts reconciles unfinished ones without launching anything new
- [ ] #5 after a Herdr server restart or reconnect, a reused pane id or a replaced occupant is never treated as the old session; context is not sent until the session binding is re-established
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reconcile on read (src/worker/reconcile.ts) in every attempt-reading CLI command: pending receipts replayed; a lapsed in-progress attempt committed (focus confirmed) or made uncertain. 2. Retry finds orphan tab candidates by provenance and stays uncertain. 3. Tests for lease takeover and Herdr restart.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-005 round 1 F2: when the store is busy at Stop, the bridge writes <home>\attempts\<attempt id>\receipt-pending.json ({attempt_id, session_id, last_assistant_message: the whole reply, written_at}). Reconcile must replay it through captureReceipt (the session id and capability checks still apply), then delete it.

From INB-005 round 2: the pending file now holds the whole reply; one file per attempt, last write wins, may be stale, so validate it like any bridge evidence.

From INB-006 round 3 N2: claiming a blocked row bumps the fencing generation; a dialog-watching worker whose lease lapsed (machine sleep) is then fenced out. Reconcile must leave such an attempt recoverable.

Built: src/worker/reconcile.ts, called by get, list, status, open, attempt, retry and focus before they read; it never calls Herdr. AC1: test where a stalled worker's lease lapses, another owner claims, and the old worker stops without any further write or focus. AC2: a tab created but its answer lost; retry lists the workspace's tabs, records candidates whose label ends with the attempt's short id (op detail candidate_tabs), names them in the message, and starts nothing (a label is never identity and no session can be bound yet). AC3: receipt-pending.json replayed by reconcile through captureReceipt (forged, stale and broken files removed without effect); retry then delivers with one prompt. AC4: reconcile on read (CLI test). AC5: after a Herdr restart, a new occupant or a missing alias never counts as the session (three cases). Design choices: reconcile never claims blocked or uncertain attempts (INB-006 r3 N2) and never restarts an attempt with nothing external recorded (open does that).
<!-- SECTION:NOTES:END -->
