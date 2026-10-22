---
id: INB-010
title: Inject faults around every handoff phase
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
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
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
