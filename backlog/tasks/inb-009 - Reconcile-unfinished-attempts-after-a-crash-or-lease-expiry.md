---
id: INB-009
title: Reconcile unfinished attempts after a crash or lease expiry
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
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
- [ ] #4 running the CLI or opening the mod reconciles unfinished attempts without launching anything new
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
