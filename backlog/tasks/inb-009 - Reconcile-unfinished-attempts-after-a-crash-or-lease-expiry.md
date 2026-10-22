---
id: INB-009
title: Reconcile unfinished attempts after a crash or lease expiry
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 10:30'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-005 round 1 F2: when the store is busy at Stop, the bridge writes <home>\attempts\<attempt id>\receipt-pending.json ({attempt_id, session_id, last_assistant_message: the INBOX_READY_V1 lines, written_at}). Reconcile must replay it through captureReceipt (the session id and capability checks still apply), then delete it.

From INB-005 round 2: the pending file now holds the whole reply; one file per attempt, last write wins, may be stale, so validate it like any bridge evidence.
<!-- SECTION:NOTES:END -->
