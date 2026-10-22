---
id: INB-004
title: Add inbox configuration and a profiles setup command
status: Done
assignee:
  - '@claude'
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 08:40'
labels:
  - 'type:feature'
  - core
  - cli
milestone: m-1
dependencies:
  - INB-002
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Profiles are user-owned config (spec §11): work maps to the .claude-work folder in the user profile, personal to .claude-personal (the ccw/ccp mapping, docs/decisions.md). The worker also needs the Herdr socket and the inbox workspace label. One inbox serves both profiles; the profile id on an item decides which config dir its session opens with.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 config.json in the inbox home holds the Herdr socket path and inbox workspace label, with documented defaults
- [x] #2 a CLI command writes profiles.json for given profile ids and config dirs, refusing relative or missing dirs and never overwriting without --force
- [x] #3 doctor reports configured profiles (id, label, config dir exists) and the Herdr config without printing secrets
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [x] #2 Evidence named in the final summary, with what remains unverified
- [x] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/core/config.ts: config.json with herdr.socket_path (default APPDATA herdr socket) and herdr.workspace_label (default Agent Inbox), validated, no fallback. 2. writeProfiles: simple ids, absolute existing dirs, atomic write, refuse overwrite without force; defaults = the ccw/ccp folders. 3. CLI setup-profiles with repeatable --profile id=DIR and --label id=TEXT, --force. 4. doctor reports profiles with dir existence and the Herdr config, paths only. 5. README configuration section. 6. Tests, review loop.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Review round 1 (docs/reviews/INB-004-r1.md, PASS with minors) dispositions: F1 fixed (unknown keys and non-object herdr refused as STORE_ERROR). F2 fixed (isFullyQualified: drive or UNC only, used for profile dirs in setup and load, and for the socket path). F3 fixed (trailing separators stripped before storing). F4 fixed (empty labels refused, labels trimmed). N1 fixed (input validated before the existing-file check). N2 accepted (one-time user command; 18 parallel runs showed one winner). Fixes went to a fresh round 2.

Review round 2 (docs/reviews/INB-004-r2.md): PASS. R2-F1, N1 and N3 carried to the M2 milestone loop INB-022; N2 accepted (loud, fixed by setup-profiles --force).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
config.json (Herdr socket, inbox workspace label; defaults documented in README and config.ts; unknown keys refused), setup-profiles (repeatable --profile id=DIR and --label, drive or UNC folders that exist, canonical form, atomic, --force to replace; defaults are the ccw/ccp folders), doctor shows profiles with folder existence and the Herdr selection, paths only. Evidence: test/unit/config.test.ts (real CLI processes; secret env not echoed), reviews INB-004-r1.md (PASS, minors fixed) and r2.md (PASS); gate green at be3e047. Unverified: real UNC profile folders (probe only), and the loader's stricter check has no test yet (carried to INB-022).
<!-- SECTION:FINAL_SUMMARY:END -->
