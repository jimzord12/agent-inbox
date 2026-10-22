---
id: INB-012
title: Show the inbox list in a Claude Code mod
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 07:19'
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
- [ ] #1 /inbox opens a pane with Active/Snoozed/History, profile/producer/kind/unread filters and row status
- [ ] #2 refresh every 2 s while visible keeps the selection by item id and never overlaps calls
- [ ] #3 every producer string is stripped of control and escape characters before it reaches the pane
- [ ] #4 the installed mod validation and type-check pass
- [ ] #5 opening /inbox triggers the same reconciliation as the CLI and launches nothing
- [ ] #6 the mod preflight facts of spec section 14 step 7 (policy, generated types, validation tooling) are recorded in docs/preflight.md section 6
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->
