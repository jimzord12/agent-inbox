---
id: INB-001
title: 'Build the SQLite store, item lifecycle and JSON CLI'
status: To Do
assignee: []
created_date: '2026-10-22 07:05'
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
- [ ] #3 read/unread, snooze, archive, restore and acknowledge are independent and guarded by state_version
- [ ] #4 list pages with a stable cursor over Active/Snoozed/History with profile/producer/kind/unread filters
- [ ] #5 events are ordered, replayable and an empty poll returns the latest safe cursor
- [ ] #6 the CLI prints one JSON envelope; exit 0 success, 1 domain error, 2 bad input
- [ ] #7 concurrent submits/updates/state changes from separate processes keep exactly one winner (tested)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
