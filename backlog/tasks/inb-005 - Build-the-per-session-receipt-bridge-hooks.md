---
id: INB-005
title: Build the per-session receipt bridge hooks
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
labels:
  - 'type:feature'
  - bridge
milestone: m-1
dependencies:
  - INB-002
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The bridge proves the right session got the right packet (docs/generic-agent-inbox-spec.md §9.2). It loads only for the launched session through --settings, never in the user's settings files, and keeps their hooks working.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the worker writes a per-attempt settings file holding SessionStart, UserPromptSubmit and Stop hooks in exec form, scoped by attempt id and capability
- [ ] #2 SessionStart binds session id, cwd, Claude config dir and auth-env names; a mismatch stops the session from receiving the packet
- [ ] #3 UserPromptSubmit blocks a protocol prompt that fails validation and lets ordinary prompts through untouched
- [ ] #4 Stop records a receipt candidate only from a valid INBOX_READY_V1 marker in the main session's last message
- [ ] #5 each hook finishes within a bounded time and never prints secrets
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Gates green: bun run typecheck and bun test pass on the committed revision
- [ ] #2 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #3 Evidence named in the final summary, with what remains unverified
<!-- DOD:END -->
