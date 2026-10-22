---
id: INB-004
title: Add inbox configuration and a profiles setup command
status: To Do
assignee: []
created_date: '2026-10-22 07:06'
updated_date: '2026-10-22 07:19'
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
- [ ] #1 config.json in the inbox home holds the Herdr socket path and inbox workspace label, with documented defaults
- [ ] #2 a CLI command writes profiles.json for given profile ids and config dirs, refusing relative or missing dirs and never overwriting without --force
- [ ] #3 doctor reports configured profiles (id, label, config dir exists) and the Herdr config without printing secrets
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Review loop PASS (docs/practices/review.md), report stored under docs/reviews/
- [ ] #2 Evidence named in the final summary, with what remains unverified
- [ ] #3 Gates green: bun run typecheck and bun run test pass on the committed revision
<!-- DOD:END -->
