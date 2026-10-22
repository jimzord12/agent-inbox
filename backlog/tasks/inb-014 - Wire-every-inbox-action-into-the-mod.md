---
id: INB-014
title: Wire every inbox action into the mod
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 07:20'
labels:
  - 'type:feature'
  - mod
  - live
milestone: m-3
dependencies:
  - INB-013
  - INB-008
priority: high
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Open session, Open with profile, Open fresh session (only as its own action), Acknowledge, Dismiss, Snooze/Unsnooze, Mark read/unread, Restore, Retry, Abandon, Focus (spec §12.1-12.2). Snooze takes a duration or local date/time and handles DST gaps and overlaps explicitly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 each action calls the matching CLI command and shows its error code and message on failure
- [ ] #2 Open session never injects anything into the conversation hosting the mod
- [ ] #3 a nonexistent or ambiguous local time (DST) is refused with a clear message
- [ ] #4 a live smoke through /inbox per evaluation plan section 10 is recorded: one informational acknowledge, one actionable open, one failed open then retry, and the same item opened at once from the mod and the CLI giving one attempt
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC #4 (live smoke): the agent drives the /inbox pane itself, in a Claude session it starts in its own Herdr evaluation workspace, using herdr pane send-keys and pane read. If the pane cannot be driven that way, the task goes Blocked with a short click-through checklist for the owner instead of improvising.
<!-- SECTION:NOTES:END -->
