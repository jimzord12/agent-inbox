---
id: INB-015
title: Write the companion skill for producer agents
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 10:30'
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
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-001 review N1: the companion skill must name the producer surface - submit, update, get, list, events, status - and say the other commands belong to the user.

From the M1 loop: tell producers to cap retries on HANDOFF_UNAVAILABLE (an ACL can deny reading forever), and that update's changed:false means the item now holds their content (also after A-B-A edits).
<!-- SECTION:NOTES:END -->
