---
id: INB-011
title: Track session availability after delivery
status: In Review
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 12:44'
labels:
  - 'type:feature'
  - worker
  - herdr
milestone: m-2
dependencies:
  - INB-009
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A delivered item stays in History; when its session closes only its availability changes (docs/generic-agent-inbox-spec.md §4.2 step 9, §13). Focus works while the verified session lives; the session reference is always shown.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 focus of a delivered item checks the live agent's session id before focusing
- [ ] #2 a closed or replaced session is shown as closed/unknown, never focused by pane id alone
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. focus records availability from what Herdr reports. 2. get lists attempts with session reference and availability. 3. No focus action for a closed session. 4. Tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in ec9580f. focus (src/worker/focus.ts) maps what it learns: verified under its alias = live; no agent with the alias = closed; the alias names another session or pane = unknown (the conversation may live elsewhere); Herdr cannot be asked = unavailable. Only a session verified by its own id is focused. get (core) now carries attempts: newest first, each with session_uuid, availability and delivered_at (from the handoff.delivered event); this also answers M1 N2 (get had no attempt summary). A succeeded attempt with availability closed no longer offers focus in next_actions; copy_session_reference always stays. Availability is refreshed only by focus (no Herdr call happens on read); the mod (INB-013) can call focus or show the stored value.

Round 1 (docs/reviews/INB-011-r1.md): PASS with Minors, fixed anyway. F1 fixed (the stored live value is asserted after recovery). F2 fixed: get always lists delivered and unfinished attempts, plus the newest 20 others (test with 21 abandoned attempts; also asserts newest first, N2). F3 fixed: setAvailability writes only a succeeded attempt, checked in the same UPDATE, so a focus on an attempt still starting or a late answer cannot mislabel it (test). F4 fixed: focus is not offered while availability is unknown. N1 fixed (summary typed with the core types). N3 fixed (only Herdr errors become HERDR_UNAVAILABLE). N4: decision recorded in decisions.md; the delivered_at subquery index is left (attempts per item are few). Round 2 next.
<!-- SECTION:NOTES:END -->
