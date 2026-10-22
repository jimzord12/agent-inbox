---
id: INB-003
title: Wrap the Herdr CLI in a tested adapter with explicit server selection
status: In Review
assignee:
  - '@claude'
created_date: '2026-10-22 07:05'
updated_date: '2026-10-22 08:20'
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
- [ ] #1 every call passes the configured HERDR_SOCKET_PATH and drops inherited HERDR_PANE_ID/TAB_ID/WORKSPACE_ID
- [ ] #2 an error answer from Herdr is reported as rejected; a timeout or unreadable answer as unknown (so the worker can mark the step uncertain)
- [ ] #3 workspace ensure/create, tab create with cwd+env, agent start with extra args, agent get/list, prompt and focus are covered by tests with recorded Herdr JSON
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify the draft adapter against the real herdr 0.9.5 CLI (read-only calls plus one throwaway workspace, closed after). 2. Fix what differs: error envelopes arrive on stderr; unreadable answers are unknown; Herdr timeout and agent_prompt_stalled answers are unknown; own kill timer. 3. Add ensureWorkspace by configured id, never by label. 4. Unit tests with recorded JSON (test/unit/fixtures/herdr.ts) and a fake runner, plus real-process tests of the runner. 5. Review loop.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
A draft adapter exists at src/herdr/adapter.ts (committed with the board setup, typechecks, no tests yet). Response shapes come from herdr api schema --json (protocol 22): tab create returns {tab, root_pane}; agent start returns {agent, argv}; errors are {error:{code,message}} with exit 1; not-found codes end in _not_found.

Discovery: Herdr reports a pane cwd with a trailing backslash (C:\...\fixture dir\). Any cwd comparison (bridge binding, INB-005) must normalise trailing separators. Error envelopes go to stderr with exit 1.
<!-- SECTION:NOTES:END -->
