---
id: INB-013
title: Show item details with paged handoff and attempt progress
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
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
- [ ] #1 a 256 KiB handoff pages from start to end with no lost lines
- [ ] #2 attempt progress distinguishes starting, waiting on the user, waiting for acknowledgment, focus failure and uncertain
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
