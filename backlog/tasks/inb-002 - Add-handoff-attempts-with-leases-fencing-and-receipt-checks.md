---
id: INB-002
title: 'Add handoff attempts with leases, fencing and receipt checks'
status: To Do
assignee: []
created_date: '2026-10-22 07:05'
labels:
  - 'type:feature'
  - core
milestone: m-0
dependencies:
  - INB-001
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The database side of Open session (docs/generic-agent-inbox-spec.md §5.3, §6.2, §7, §9). Already built in commit 2bfa28c; this task carries it through review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the database refuses a second in_progress/blocked/uncertain attempt for one item; a second open returns the existing attempt
- [ ] #2 a worker write with a stale fencing generation is refused
- [ ] #3 the startup binding is refused for a wrong session, cwd, Claude config dir or present auth env, and blocks the attempt
- [ ] #4 the opening prompt is accepted once, only in the bound session and only after the dispatch intent is recorded
- [ ] #5 a receipt with a wrong attempt, item, revision, packet hash or challenge is rejected; a revoked attempt's late receipt cannot count
- [ ] #6 delivery commits receipt, success, archive(delivered) and events in one transaction; a restored delivered revision returns ALREADY_DELIVERED unless --fresh
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
