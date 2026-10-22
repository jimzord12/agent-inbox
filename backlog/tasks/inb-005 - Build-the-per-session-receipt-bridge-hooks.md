---
id: INB-005
title: Build the per-session receipt bridge hooks
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 10:33'
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
- [x] #1 the worker writes a per-attempt settings file holding SessionStart, UserPromptSubmit and Stop hooks in exec form, scoped by attempt id and capability
- [x] #2 SessionStart binds session id, cwd, Claude config dir and auth-env names; a mismatch stops the session from receiving the packet
- [x] #3 UserPromptSubmit blocks a protocol prompt that fails validation and lets ordinary prompts through untouched
- [x] #4 Stop records a receipt candidate only from a valid INBOX_READY_V1 marker in the main session's last message
- [x] #5 each hook finishes within a bounded time and never prints secrets
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [x] #2 Evidence named in the final summary, with what remains unverified
- [x] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/bridge/settings.ts: per-attempt bridge.json (home, attempt id, capability) and settings.json with SessionStart, UserPromptSubmit and Stop in exec form (command = bun, args = hook script, event, --bridge file), timeout 15 s, no matcher so clear and resume re-bind. writeBridgeSettings is what the worker (INB-006) calls. 2. src/bridge/hooks.ts: SessionStart binds session id, cwd, CLAUDE_CONFIG_DIR and auth-env names; UserPromptSubmit blocks (exit 2) any inbox-prefixed prompt that is not accepted and prints nothing for ordinary prompts; Stop captures a receipt candidate, never blocks. 3. src/bridge/main.ts: stdin read, 10 s own deadline, fail closed for protocol prompts, no secrets in output. 4. Tests run the real hook process. 5. Review loop.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Facts used (Claude Code hooks docs, via a guide agent; to confirm live in INB-007): exec form is command plus args with no shell; timeout in seconds; UserPromptSubmit exit 2 blocks and erases the prompt, exit 0 with stdout adds context (so the pass path prints nothing); SessionStart cannot block, so a mismatch blocks the attempt instead and the prompt guard refuses the packet; Stop input has last_assistant_message and no agent_id (subagents use SubagentStop); --settings hooks are added to the user's hooks. Unverified until a live launch: that 2.1.308 accepts args (exec form) in --settings hooks.

Round 1 (docs/reviews/INB-005-r1.md): PASS. Dispositions: F1 fixed (hooks open the store with a 2 s busy timeout, HOOK_BUSY_TIMEOUT_MS; worst case about 6 s plus start-up inside the 15 s settings timeout; main.ts comment names the real bounds, including the unbounded bridge-file read on a hung disk). F2 fixed (Stop retries once on STORE_BUSY, then writes the marker lines to receipt-pending.json beside bridge.json for INB-009 to reconcile; test holds the write lock). F3 fixed (bridge opens an existing store only: Inbox store.existingOnly, a missing store is STORE_ERROR, no home or db created; test). N1 routed to INB-006/INB-020 (pin a stable hook script path). N2 fixed, narrowed: a blocked attempt refuses its opening prompt (ATTEMPT_BLOCKED); an uncertain one still accepts, because a late dispatch landing is the evidence that settles it. N3 fixed (ANTHROPIC_CUSTOM_HEADERS added); widening to all ANTHROPIC_*/CLAUDE_CODE_* names stays with the INB-007 environment check. N4 accepted as designed. N5: SessionEnd/StopFailure left to INB-011 and INB-007. Round 2 next.

Round 2 (docs/reviews/INB-005-r2.md): FINDINGS. F1 Material fixed: receipt-pending.json keeps the whole last_assistant_message (only when it parses as a receipt), and the test replays it through captureReceipt into a valid candidate. F2 fixed (comment says about 8 s: the busy retry reopens the store). N1 noted (rollback-journal stores only, not this machine). N2 routed to INB-009 (validate whatever pending file it finds; last write wins). N3 resolved by F1. Round 3 next.

Round 3 (docs/reviews/INB-005-r3.md): PASS, Notes only. N1 fixed (INB-009 note now says the pending file holds the whole reply). N2 carried to INB-010 (fault injection): a busy Stop whose reply is not a receipt writes no pending file; not added here so the passed snapshot stays the reviewed one. Evidence: bridge tests (19, real hook processes), r1 probes (busy store, missing home), r2/r3 replay check. Unverified until INB-007: --settings hooks additive, live hook input fields, real session cwd form.
<!-- SECTION:NOTES:END -->
