---
id: INB-015
title: Write the companion skill for producer agents
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 07:14'
labels:
  - 'type:docs'
  - skill
milestone: m-4
dependencies:
  - INB-006
priority: medium
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Producer projects install a skill so their agents know when and how to submit: durable revision-specific handoff files, stable external ids, informational vs actionable, polling events, never claiming delivery or completion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the skill teaches submit, update and events with a worked example of each
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
