---
id: INB-007
title: Prove the first live launch on the work profile
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 11:15'
labels:
  - 'type:test'
  - live
  - worker
  - bridge
milestone: m-1
dependencies:
  - INB-006
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close the open points of docs/preflight.md section 7 for the work profile with a real Claude session opened through the inbox in a throwaway folder (path with a space and Unicode) inside a dedicated Herdr workspace. Uses the ccw (work) profile. Never touches the owner's own workspaces. The personal pane env (point 3) is recorded later by INB-018.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a real actionable item ends delivered, with binding, accepted prompt, receipt and focus recorded
- [x] #2 --settings hooks were added on top of the profile's own hooks (prod-guard and the Herdr hook still ran)
- [x] #3 the env seen by the session, Herdr's reported session id and the trust-dialog behaviour are recorded in docs/preflight.md
- [x] #4 every gap found is fixed in this task or filed as a task
- [x] #5 the worker survives the caller closing: agent-inbox open is run from a Claude session in a Herdr tab of the test workspace, that tab is closed, and the attempt still finishes (records preflight section 7 point 5; the mod is not needed)
- [x] #6 a protocol prompt with a wrong attempt id or packet hash is sent into the live session and the UserPromptSubmit hook blocks it before the model sees it (records preflight section 7 point 2)
- [x] #7 the real Herdr answers for agent start (incl. agent_not_ready), prompt, list and focus are recorded into test/unit/fixtures/herdr.ts and marked recorded
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [x] #2 Evidence named in the final summary, with what remains unverified
- [x] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From INB-003 review F2: during the first live launch, record the real Herdr answers for agent start (including agent_not_ready on a trust dialog), agent prompt, agent list, agent focus and workspace get, and swap them into test/unit/fixtures/herdr.ts, marked recorded.

From INB-006 round 1 N4: confirm on the real Herdr which counter marks the end of the opening turn: the worker uses state_change_seq above the pre-dispatch baseline plus idle/done; preflight names completion_seq.

From INB-006 round 3: N3, this task's review covers test/e2e/inb007-live.ts (committed with INB-006). N4, make the script refuse a non-empty run dir.

Live run 2026-10-22 10:59-11:03 UTC, workspace inbox-e2e-inb007 (closed afterwards; w4/w5 untouched). Attempt 1 delivered after the trust dialog (worker blocked AGENT_BLOCKED, focused, resumed); attempt 2 delivered with its caller tab closed 8 s after open. Results in docs/preflight.md 7.1. Recorded Herdr answers swapped into test/unit/fixtures/herdr.ts (agent start ok and agent_not_ready, prompt, focus, list); focus answers agent_info, not ok. Gaps: worker.log missed lines written before the attempt folder existed, and the dialog block was not logged (fixed, test). Trust-dialog keypress refused by the harness (filed on INB-017). Caller was a shell, not a Claude session (noted on INB-018). Not verified: the production guard firing (it leaves no trace when it allows; no guarded action was triggered on purpose). test/e2e/inb007-live.ts now refuses a non-empty run dir (INB-006 r3 N4).

Round 1 (docs/reviews/INB-007-r1.md): FINDINGS. F1 Material fixed: a third live run (11:10-11:12 UTC) with a Claude session as the caller in its own test workspace; the session ran open, its tab was closed 3 s after the worker's claim, and the attempt delivered (att_mvjfx83i_989b1c1dc48e). Both test workspaces closed; w4/w5 untouched. F2 fixed (preflight 7.1 row 2: the forged prompt was refused as ATTEMPT_CLOSED; the hash check was not reached live, unit tests cover it). F3 fixed (sentence about the input box dropped). F4 fixed (row 1 names the Herdr SessionStart hook; the production guard is marked inferred, not observed). N1 accepted (the list fixture is a cleaned copy; encoding repaired). N2 accepted (home-folder paths in preflight lines from the scaffold carry only the owner's own public handle, as the setup review accepted). N3 recorded in 7.1 (which runs were by hand). N4 fixed (dialog log lines asserted).

Round 2 (docs/reviews/INB-007-r2.md): PASS. F1 fixed (INB-018 note updated). F2 fixed (preflight 7.1 row 6 says which attempts have a saved Herdr answer). N1 and N2 carried to INB-017. N3 accepted. Evidence: preflight 7.1; run1 home and recordings under the temp e2e folder; fixtures in test/unit/fixtures/herdr.ts. Unverified: the production guard firing in a launched session.
<!-- SECTION:NOTES:END -->
