---
id: INB-012
title: Show the inbox list in a Claude Code mod
status: Done
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 13:46'
labels:
  - 'type:feature'
  - mod
milestone: m-3
dependencies:
  - INB-006
  - INB-009
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The user's inbox view is a Claude Code mod (/inbox), proven sufficient by the 2026-10-22 spike (docs/decisions.md). It only calls the JSON CLI by argv. Loaded with claude --plugin-dir during development.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /inbox opens a pane with Active/Snoozed/History, profile/producer/kind/unread filters and row status
- [x] #2 refresh every 2 s while visible keeps the selection by item id and never overlaps calls
- [x] #3 every producer string is stripped of control and escape characters before it reaches the pane
- [x] #4 the installed mod validation and type-check pass
- [x] #5 opening /inbox triggers the same reconciliation as the CLI and launches nothing
- [x] #6 the mod preflight facts of spec section 14 step 7 (policy, generated types, validation tooling) are recorded in docs/preflight.md section 6
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Round 1 (docs/reviews/INB-012-r1.md, PASS) dispositions:
- R1-MIN-1 fixed: width counts emoji (EAW W points, emoji blocks), selector/joiner/skin-tone clusters as one 2-cell glyph; unit test added.
- R1-MIN-2 fixed: LIST records the call it answered (asked); rows are drawn only for the view and filters on screen, else Loading; an error for another view clears the old rows.
- R1-MIN-3 fixed in docs: the install-path claim is marked to verify in INB-020 (decisions.md, preflight §7 item 7, note on INB-020).
- R1-MIN-4 fixed: fetchList catches anything unexpected and shows MOD_ERROR in the pane; the tick has a .catch; engine test added.
- R1-MIN-5 fixed, and it exposed a real bug: $.state gets within one dispatch read the moment it began, so the stale-answer drop never fired. The drop now uses a module counter bumped by every view/filter choice (module choice, state as fallback after a reload); engine test records state writes and fails without the drop.
- R1-MIN-6 fixed: selection is a leading › glyph, not inverse; checked live (focused row inverse, selected row ›).
- R1-NOTE-3 fixed: inertDeep defines keys, so __proto__ stays a plain key; unit test added.
- R1-NOTE-1, R1-NOTE-2 not done: filter seeding and showing snoozed_until belong with INB-014 (snooze, local time).

Round 2 (docs/reviews/INB-012-r2.md, PASS) dispositions:
- R2-MIN-1 carried to the M4 milestone loop (INB-024): add the engine test pinning the row guard (Active rows on screen, press h mid-call, rows gone).
- R2-NOTE-4 done: the frozen-state-per-dispatch fact is in preflight §6.
- R2-NOTE-1, R2-NOTE-2, R2-NOTE-3 carried to INB-024 as notes (MOD_ERROR catch without generation check; lone skin-tone and tag-flag widths, emoji width unverified live; hot reload clears isBusy, development only).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The /inbox mod (mod/) opens a docked pane listing the inbox through the JSON CLI: Active/Snoozed/History, cycling profile/producer/kind/unread filters, rows with read mark, kind, title, profile, producer, age and launch/error status (core list items now carry latest_attempt). Refreshes every 2 s while shown, one call at a time, drops answers for a view left meanwhile, keeps the selection by id (a › glyph, distinct from focus), and makes every CLI string inert. Checks: gate, claude plugin validate/test, tsc -p mod; two live runs on the work profile. Review: r1 PASS (6 minors fixed, one exposing the frozen-state-per-dispatch bug), r2 PASS (one minor and notes carried to INB-024). Install-time CLI path to verify in INB-020.
<!-- SECTION:FINAL_SUMMARY:END -->
