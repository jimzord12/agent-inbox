---
id: INB-022
title: Run the M2 milestone review loop
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 07:14'
updated_date: '2026-10-22 13:16'
labels:
  - 'type:review'
milestone: m-1
dependencies:
  - INB-003
  - INB-004
  - INB-005
  - INB-006
  - INB-007
  - INB-008
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Closed review loop on the combined result of milestone M2 against its goal and exit condition (see the milestone file), per docs/practices/review.md. This task is the loop itself and gets no second per-task loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a fresh reviewer returns PASS on the milestone's final snapshot; every report is stored as docs/reviews/m-1-rN.md
- [x] #2 the milestone's exit condition is shown met by named evidence
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [x] #2 Evidence named in the final summary, with what remains unverified
- [x] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Fix the carried items (INB-004 R2-F1, N1; INB-003 R3-F1). 2. Gate. 3. Fresh milestone reviewer on M2 against its goal and exit condition; store m-1-rN.md; loop to PASS.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carried from INB-004 round 2: R2-F1 (unit test that loadProfiles refuses a root-relative claude_config_dir), N1 (README: drive or UNC paths only; unknown config.json keys are refused), N3 (optionally canonicalise hand-written profile folders on load). Fix in the M2 milestone round.

Carried from INB-003 round 3: R3-F1 (on agent start, treat agent_not_found, workspace_not_found and tab_not_found as unknown, or make the pre-effect set per verb; add a test).

Carried items done before round 1: INB-004 R2-F1 (test: loadProfiles refuses root-relative, drive-relative and relative folders in a hand-written profiles.json); N1 (README: drive or UNC paths only, unknown config keys refused); N3 not done (optional canonicalisation on load; folders are compared through normalizeDir already); INB-003 R3-F1 (agent start turns not-found answers into unknown outcomes, since they can follow the launch; test). M1 N2 (get attempt summary) was answered by INB-011.

Round 1 (docs/reviews/m-1-r1.md): FINDINGS. F1 Material fixed: focus brings forward an unfinished attempt's own alias in its own pane while Herdr has no session id yet (a dialog-held start), so the user can answer the dialog; another session under the alias is still refused; the fake Herdr now hides the session id until the dialog is answered, as real Herdr does (test). F2 fixed: retry on a failed attempt says failed (code), not abandoned (CLI test). F3 fixed: decisions.md records that the receipt does not check the waiting wording, and why. F4 fixed (README status). N4 fixed (comment moved). N1 carried to INB-018 (re-prove the flow live on current code). N2, N3, N5 (fixed with F1), N6 noted.

Round 2 (docs/reviews/m-1-r2.md): PASS. F1 fixed after the PASS with tests only (the dialog-focus exception refuses a delivered attempt and an alias in another pane); no code changed, so no new round. N1 accepted (the exception covers any unfinished attempt with no session id). N2 routed to INB-013 (the mod keys on starting, not availability, for a dialog-held focus). N3, N4 noted. Exit condition: live delivery on the work profile (INB-007, preflight 7.1, run1 store), retry and abandon per spec 4.3 (INB-008 tests, probe P3 in round 2), preflight section 7 closed for the work profile. Unverified: the flow live on the current code (INB-018).
<!-- SECTION:NOTES:END -->
