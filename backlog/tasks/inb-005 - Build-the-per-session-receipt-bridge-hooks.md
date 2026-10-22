---
id: INB-005
title: Build the per-session receipt bridge hooks
status: In Review
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 08:41'
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
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/bridge/settings.ts: per-attempt bridge.json (home, attempt id, capability) and settings.json with SessionStart, UserPromptSubmit and Stop in exec form (command = bun, args = hook script, event, --bridge file), timeout 15 s, no matcher so clear and resume re-bind. writeBridgeSettings is what the worker (INB-006) calls. 2. src/bridge/hooks.ts: SessionStart binds session id, cwd, CLAUDE_CONFIG_DIR and auth-env names; UserPromptSubmit blocks (exit 2) any inbox-prefixed prompt that is not accepted and prints nothing for ordinary prompts; Stop captures a receipt candidate, never blocks. 3. src/bridge/main.ts: stdin read, 10 s own deadline, fail closed for protocol prompts, no secrets in output. 4. Tests run the real hook process. 5. Review loop.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Facts used (Claude Code hooks docs, via a guide agent; to confirm live in INB-007): exec form is command plus args with no shell; timeout in seconds; UserPromptSubmit exit 2 blocks and erases the prompt, exit 0 with stdout adds context (so the pass path prints nothing); SessionStart cannot block, so a mismatch blocks the attempt instead and the prompt guard refuses the packet; Stop input has last_assistant_message and no agent_id (subagents use SubagentStop); --settings hooks are added to the user's hooks. Unverified until a live launch: that 2.1.308 accepts args (exec form) in --settings hooks.
<!-- SECTION:NOTES:END -->
