---
id: INB-003
title: Wrap the Herdr CLI in a tested adapter with explicit server selection
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 07:05'
updated_date: '2026-10-22 08:42'
labels:
  - 'type:feature'
  - herdr
milestone: m-1
dependencies:
  - INB-002
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The worker talks to Herdr 0.9.5 only through argv calls to the herdr CLI (docs/preflight.md §3, docs/generic-agent-inbox-spec.md §10). Every call names the configured socket; nothing targets the focused pane, a label or a title.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 every call passes the configured HERDR_SOCKET_PATH and drops inherited HERDR_PANE_ID/TAB_ID/WORKSPACE_ID
- [x] #2 an error answer from Herdr is reported as rejected; a timeout or unreadable answer as unknown (so the worker can mark the step uncertain)
- [x] #3 workspace ensure/create, tab create with cwd+env, agent start with extra args, agent get/list, prompt and focus are covered by tests with recorded Herdr JSON
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [x] #2 Evidence named in the final summary, with what remains unverified
- [x] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify the draft adapter against the real herdr 0.9.5 CLI (read-only calls plus one throwaway workspace, closed after). 2. Fix what differs: error envelopes arrive on stderr; unreadable answers are unknown; Herdr timeout and agent_prompt_stalled answers are unknown; own kill timer. 3. Add ensureWorkspace by configured id, never by label. 4. Unit tests with recorded JSON (test/unit/fixtures/herdr.ts) and a fake runner, plus real-process tests of the runner. 5. Review loop.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
A draft adapter exists at src/herdr/adapter.ts (committed with the board setup, typechecks, no tests yet). Response shapes come from herdr api schema --json (protocol 22): tab create returns {tab, root_pane}; agent start returns {agent, argv}; errors are {error:{code,message}} with exit 1; not-found codes end in _not_found.

Discovery: Herdr reports a pane cwd with a trailing backslash (C:\...\fixture dir\). Any cwd comparison (bridge binding, INB-005) must normalise trailing separators. Error envelopes go to stderr with exit 1.

Review round 1 (docs/reviews/INB-003-r1.md, FINDINGS) dispositions: F1 fixed (mutating calls - workspace create, tab create, agent start, prompt, focus - report every error as unknown except codes Herdr raises before acting: not_found, invalid_, server_not_running, server_unavailable, agent_blocked, agent_name_taken, agent_pane_unavailable, agent_target_ambiguous; reads stay rejected; agent_not_ready keeps its code so the worker can focus the blocked pane). F2 accepted and tracked: agent start, prompt, list, focus and workspace get answers are schema-built, not recorded; INB-007 records them. F3 fixed (ensureWorkspace creates a new workspace when the stored id carries another label, and reports replaced). N1 comment added. N2 fixed (only agent_not_found gives null; agent_name_not_found is thrown). N3 fixed (HERDR_SESSION, HERDR_CLIENT_SOCKET_PATH and HERDR_ACTIVE_ variables dropped). N4 accepted (conservative by design; INB-007 checks the real output). Fixes went to a fresh round 2.

Review round 2 (docs/reviews/INB-003-r2.md, FINDINGS) dispositions: R2-F1 fixed (server_unavailable removed from the pre-effect list; the not_found wildcard replaced by explicit target codes, so agent_name_not_found and unknown not_found codes on mutating calls are unknown). R2-F2: workspace get recorded now (second throwaway workspace, closed after); agent start, prompt, list and focus stay schema-built until INB-007, now an acceptance criterion there. N1 noted for INB-006: a failed workspace get must never read as workspace gone.

Review round 3 (docs/reviews/INB-003-r3.md): PASS. R3-F1 carried to the M2 milestone loop INB-022. N2 (unstable full run) was the uncommitted bridge work in progress; bridge tests are 15 of 15 in three runs at a9174ae.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Herdr adapter (675e7c2, ee19f47, 8630728): every call names the configured socket and drops inherited pane, tab, workspace and selection variables; error envelopes are read from stderr; reads report errors as rejected; mutating calls report errors as unknown unless Herdr raises them before acting; timeouts and unreadable answers are unknown; ensureWorkspace reuses a configured id only while it carries the inbox label. Evidence: test/unit/herdr.test.ts (27 tests, fake runner plus real-process runner tests), reviews INB-003-r1/r2 (FINDINGS, fixed) and r3 (PASS). AC3 partly unverified: agent start, prompt, list and focus answers are schema-built, to be recorded by INB-007 criterion 7.
<!-- SECTION:FINAL_SUMMARY:END -->
