---
id: INB-013
title: Show item details with paged handoff and attempt progress
status: Done
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 14:09'
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
- [x] #1 a 256 KiB handoff pages from start to end with no lost lines
- [x] #2 attempt progress distinguishes starting, waiting on the user, waiting for acknowledgment, focus failure and uncertain
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
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

Round 2 (docs/reviews/INB-013-r2.md, PASS) dispositions:
- R2 F1 (Minor) carried to INB-024: require the receipt for 'Focus failed' (a bridge RECEIPT_INVALID block in the focus phase, e.g. after a manual /clear, is not a focus failure); add the unit case.
- R2 N1, N2 carried to INB-024 as notes (Claude-closed hint suggests focusing a closed session; scroll on page turn pinned only live).
- R2 N3 carried to INB-014: see the progress labels on a live attempt in its smoke.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Enter on a list row opens the item's details in the /inbox pane, read-only through get --include-context and attempt get: summary, profile, folder, instruction, clipped references, handoff snapshot time/size/hash/source, the retained handoff paged 40 lines at a time (long lines cut into pieces; pages join back exactly; no empty last page), the newest attempt's progress in plain words (starting, sending, waiting on you, waiting for acknowledgment, acknowledged then stopped, focus failed, uncertain and retryable, failed, delivered) with prompt state and stored availability, and every prior attempt. Page turns are compare-and-set and scroll to the page header; Back keeps the selection. Checks: gate, mod tests 14/14, tsc -p mod, validate; live, a 256 KiB handoff paged to its last line 5,062 and 20 fast presses landed on page 22. Review: r1 FINDINGS (F1 mislabelled focus failures, fixed with five other items), r2 PASS (one minor and notes carried to INB-024/INB-014).
<!-- SECTION:FINAL_SUMMARY:END -->
