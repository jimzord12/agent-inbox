---
id: INB-006
title: 'Run the handoff worker and the open, attempt and focus commands'
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
labels:
  - 'type:feature'
  - worker
  - cli
milestone: m-1
dependencies:
  - INB-003
  - INB-004
  - INB-005
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
agent-inbox open reserves an attempt and starts a detached worker with stdio ignored (mod spike rule, docs/decisions.md) that walks preflight, create_layout, start_agent, submit_context, await_receipt, focus (docs/generic-agent-inbox-spec.md §4.2, §10.2), recording intent before each side effect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 open returns attempt_id, status and reused within about a second; the worker keeps running after the caller exits
- [ ] #2 a missing cwd, unknown profile or unavailable Herdr ends the attempt before any context is sent, with the stable error code
- [ ] #3 the launch sets CLAUDE_CONFIG_DIR explicitly, passes --session-id and --settings, and uses a unique per-attempt agent alias
- [ ] #4 the item becomes delivered only after receipt candidate, a new settled state and a successful focus
- [ ] #5 attempt get shows phase, evidence and safe next actions; focus never sends context
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
