---
id: INB-001
title: 'Build the SQLite store, item lifecycle and JSON CLI'
status: In Review
assignee:
  - '@claude'
created_date: '2026-10-22 07:05'
updated_date: '2026-10-22 08:26'
labels:
  - 'type:feature'
  - core
  - cli
milestone: m-0
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Phase 1 of the spec (docs/generic-agent-inbox-spec.md §5-§8, §16). Producers and the mod need one local store and one JSON contract. Already built in commit 8957d5c before the board existed; this task carries it through its review loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 submit is idempotent on (producer_id, external_id); different content returns IDEMPOTENCY_CONFLICT
- [ ] #2 update needs the expected content revision and creates an unread revision; history items and stale revisions are refused
- [ ] #3 read/unread, snooze, archive, restore and acknowledge are independent; snooze, unsnooze, archive, restore and acknowledge are guarded by state_version, mark-read by the displayed revision
- [ ] #4 list pages with a stable cursor over Active/Snoozed/History with profile/producer/kind/unread filters
- [ ] #5 events are ordered, replayable and an empty poll returns the latest safe cursor
- [ ] #6 the CLI prints one JSON envelope; exit 0 success, 1 domain error, 2 bad input
- [ ] #7 concurrent submits/updates/state changes from separate processes keep exactly one winner (tested)
- [ ] #8 deleting the producer's original handoff file leaves the retained handoff readable through get --include-context
- [ ] #9 no producer-facing command can archive an item, declare delivery or change read or snooze state
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Code already built before the board existed. 2. Run the gate. 3. Carry it through the closed review loop in docs/practices/review.md, fix findings, re-review until PASS. 4. Check criteria on test evidence, final summary, Done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review round 1 (docs/reviews/INB-001-r1.md, PASS with minors) dispositions: F1 fixed (mark-unread no-op when already unread). F2 fixed (events refuses a cursor ahead of the store with INVALID_ARGUMENT and details.latest_cursor). F3 fixed (impossible dates, hour 24 and offsets over 23:59 refused). F4 fixed (BOM kept; text re-encodes to the retained bytes; also in attempts.ts packet build). F5 fixed (CLI tests for get --include-context after deletion, list --cursor and filters, events --after). F6 fixed (criterion 3 reworded to match spec 8). F7 fixed (C1 controls rejected). F8 fixed (locked handoff file gives a retryable INVALID_ITEM; read moved inside the try). N1 carried to INB-015 (name the producer surface). N2 accepted: writes re-check under their own transaction; views may mix moments, nothing is corrupted. N3, N4 accepted (attempt summary arrives with the attempt command, INB-006). Fixes went to a fresh round 2.
<!-- SECTION:NOTES:END -->
