---
id: INB-017
title: Build the live evaluation harness
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 11:05'
labels:
  - 'type:feature'
  - eval
milestone: m-5
dependencies:
  - INB-007
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
docs/generic-agent-inbox-evaluation-plan.md §4 and §7: an isolated inbox home, synthetic fixtures with spaces and Unicode, a dedicated Herdr workspace, evidence capture and a per-run JSON plus Markdown report. Live runs are an explicit command, never part of bun test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a run asserts it uses the evaluation inbox home before any write
- [ ] #2 cleanup closes only tabs the run created
- [ ] #3 each run writes a report with critical gates as pass/fail/unverified
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-007: the agent's keypress to confirm Claude's folder-trust dialog was refused by the harness's safety check, so unattended live runs need a fixture folder the owner trusted once (reuse it per run, with fresh subfolders for the inbox home only), or the owner at the keyboard. Record trust as an explicit precondition in the run report.
<!-- SECTION:NOTES:END -->
