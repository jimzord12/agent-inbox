---
id: INB-020
title: Set up the inbox for real use in both profiles
status: To Do
assignee: []
created_date: '2026-10-22 07:10'
updated_date: '2026-10-22 07:26'
labels:
  - 'type:chore'
  - mod
  - cli
  - live
milestone: m-5
dependencies:
  - INB-014
  - INB-016
  - INB-019
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner approved 2026-10-22 (docs/decisions.md): at the end of the build, write profiles.json in the real inbox home (work maps to the .claude-work folder in the user profile, personal to .claude-personal) and install the /inbox mod once in each profile, so the owner can type /inbox in a ccw or ccp session. This is the one sanctioned change to the profiles' plugin configuration; settings.json files and hooks stay untouched beyond what the plugin install itself writes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 profiles.json in the real inbox home maps work and personal to their config folders and doctor reports both as configured
- [ ] #2 a fresh ccw session and a fresh ccp session each show /inbox listing the same items
- [ ] #3 the exact install commands and what they changed are recorded in the final summary and in the README
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The fresh ccp session check of AC #2 is covered by the owner's install approval (decisions.md), not by the routing-only rule. If the real inbox is empty, submit one informational item from producer agent-inbox-setup, check it in both profiles, then acknowledge it so it moves to History.
<!-- SECTION:NOTES:END -->
