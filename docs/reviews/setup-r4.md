# Setup review, round 4: agent-inbox, diff dc41e42..c869ac6 (main)

**Verdict: PASS.** All four round-3 items landed. The diff adds no Blocking, Material or Minor problem. One Note is below.

## Round-3 items

| id | status | evidence |
|---|---|---|
| S3-01 | landed | INB-007 has AC #6: a wrong attempt id or packet hash is sent into the live session, and the UserPromptSubmit hook blocks it (records preflight §7 point 2). The description now says it closes the open points of §7 "for the work profile", and that point 3 for the personal profile belongs to INB-018. Both match preflight §7.2 and §7.3 and the m-1 exit, which is scoped to the work profile. |
| S3-02 | landed | INB-027 has AC #3: if `mod/` or the CLI changed after INB-020, the installed mod is updated in both profiles and the command is recorded. The AC can be tested when INB-027 closes, because INB-027 depends on INB-026, which depends on INB-020. |
| S3-03 | landed | The S2-01 row now says the fix was pushed in dc41e42 and names the commit span 08aa4b7 to 81386ff. The S2-03 row now says the gate item is DoD #3, and INB-007 confirms the gate is DoD #3. `docs/decisions.md` "Open questions" now has the history-rewrite line, which requires the owner's explicit force-push approval. |
| S3-04 | landed | The INB-020 Implementation Notes say the ccp check is covered by the install approval. If the real inbox is empty, the agent submits one informational item from producer `agent-inbox-setup` and acknowledges it, so it moves to History. |

## New findings

| id | severity | where | expected vs actual | smallest fix |
|---|---|---|---|---|
| S4-01 | Note | `docs/decisions.md` Open questions, the history-rewrite line | Expected: the commit span is unambiguous. Actual: it is written as "commits 08aa4b7..81386ff". In git range syntax that span leaves out 08aa4b7, which carries the terms. The dispositions row correctly says "from 08aa4b7 up to 81386ff". | Write "08aa4b7 through 81386ff (inclusive)". |

No contradiction found with AGENTS.md, preflight §7 or the milestones. Every new AC can be tested when its task closes. Privacy check of the current tracked tree: none found. The `setup-r1.md:28` redaction is still in place.

**Gates:** all green on c869ac6.
- `bun run typecheck`: clean.
- `bun run test`: 81 of 81 pass.
- `backlog doctor`: no duplicate ids and no dependency cycles.
- HEAD equals `origin/main`, and the working tree is clean.
