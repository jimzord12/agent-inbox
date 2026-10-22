# Setup review, round 3: agent-inbox @ dc41e42 (main)

**Verdict: PASS.** There is no open Blocking or Material finding. I found two Minor findings and two Notes.

All eight round-2 fixes are in the tree. The gates are green on dc41e42:
- `bun run typecheck`: clean.
- `bun run test`: 81 of 81 pass.
- `backlog doctor`: no duplicate ids and no dependency cycles.
- `main` equals `origin/main`.

Privacy check of the current tracked tree and commit identities: none found. The searched terms are still present in public history, in commits 08aa4b7 and 81386ff. Rewriting that history is left to the owner, as the brief says; see S3-03.

## Round-2 findings

| id | status | note |
|---|---|---|
| S2-01 | landed | `setup-r1.md:28` is redacted and the redaction is marked in place. The privacy paragraph is in `review.md`. The current tree is clean. History is left to the owner: the disposition is honest, but it names only 08aa4b7, and 81386ff also carries the terms (S3-03). |
| S2-02 | landed | The m-5 exit condition no longer requires the final loop; it says INB-027 runs after it. INB-026's dependencies are INB-017 to INB-020, so there is no cycle. |
| S2-03 | landed | All 27 tasks carry "bun run typecheck and bun run test pass" (checked by grep across every task file). README and preflight §1 and §9.1 say `bun run test`. The only `bun test` left in current docs is AGENTS.md:63's warning and INB-017's "never part of bun test", both correct. The gate item is now DoD #3, not #1 (S3-03). |
| S2-04 | landed | AGENTS.md uses `INB-<nnn>` and names the INB-020 install exception. Preflight §7.4 lets the agent accept the trust dialog for throwaway fixtures. Preflight §9.3 matches INB-018. |
| S2-05 | landed | The m-1 exit is scoped to the work profile. Preflight §7.3 and §7.5 are reworded. INB-007 has AC #5 (the caller closes). INB-018 has AC #6 (personal pane env). The INB-007 description still says "close the six open points" (S3-01). |
| S2-06 | landed | `live` label on INB-014 and INB-020. The INB-014 notes say how the agent drives the pane, or that the task goes Blocked with a checklist for the owner. |
| S2-07 | landed | INB-019 depends on INB-018 and INB-011. |
| S2-08 | landed | INB-001 has AC #8 (missing originals) and AC #9 (producer commands cannot archive or change attention state). |

## New findings

| id | severity | where | scenario | expected vs actual | impact | smallest fix |
|---|---|---|---|---|---|---|
| S3-01 | Minor | INB-007 ACs; `docs/preflight.md` §7 point 2; spec §15 "Handoff correctness" ("Validate both the Herdr target mechanism and the in-session guard") | The agent closes INB-007 on its five ACs. A happy-path delivery proves the hook input fields. It never shows that a failing `UserPromptSubmit` validation really stops a prompt in a live session. That guard is the only cover for the missing compare-and-send in Herdr (preflight §3). | Expected: the live proof of the in-session guard has an AC (m-1 exit: the §7 points are closed for work). Actual: point 2's "block really stops the prompt" is in no AC of INB-007 or any other task. Elsewhere it is unit-tested only (INB-005 #3). | INB-007 can close without proving the guard. INB-022 then fails the M2 exit late, or nobody notices it. Spec §15 says mocks alone cannot establish this. | Add to INB-007: "a protocol prompt with a wrong attempt or hash is sent into the live session and the UserPromptSubmit hook blocks it (records preflight §7 point 2)". Also change the description to "close the open points of preflight §7 for the work profile". |
| S3-02 | Minor | INB-020 position: m-5, before INB-026 and INB-027 | INB-020 installs the mod into both real profiles. After that, the M6 loop and the final loop may still change `mod/` or the CLI. A plugin installed from a local marketplace is normally a copy, not a live link. | Expected (decisions.md: install "at the end of the build"): the owner's installed `/inbox` matches the final snapshot. Actual: two review loops can change code after the install, and no task re-syncs it. | The owner's own final check, using the product, may run a stale mod. | Add an AC to INB-027: "if mod/ changed after INB-020, the installed mod is updated in both profiles and the command recorded". |
| S3-03 | Note | `docs/reviews/setup-dispositions.md`, S2-01 and S2-03 rows; `docs/decisions.md` "Open questions" | 1. The S2-01 row says "Fixed in the working tree" (it is now committed and pushed) and names only commit 08aa4b7; 81386ff also has the terms. 2. The question to the owner about rewriting history is tracked nowhere a fresh agent reads. 3. The S2-03 row says "DoD #1", but the gate item is now DoD #3. | | A future agent will not know a history decision is pending. | Correct the S2-01 row and add one line to the decisions.md "Open questions": "Rewrite public history to drop the redacted round-1 terms (needs the owner's force-push approval)". |
| S3-04 | Note | INB-020 AC #2; AGENTS.md "Live runs"; AGENTS.md "Tests and evaluations always use their own home" | 1. AC #2 needs a fresh ccp (personal) session. AGENTS.md allows personal launches "only where a scenario is about profile routing". 2. "listing the same items" in the real home is trivially true if that home is empty. If it is not empty, the agent may submit test items into the owner's real inbox. | | A strict agent hesitates. Otherwise it may leave test items in the owner's real history. | In INB-020's notes: "the ccp check is covered by the owner's install approval; if the real inbox is empty, submit one informational item from producer `agent-inbox-setup` and acknowledge it afterwards". |

## Lenses

1. **Product fit / coverage (lead):** Every level-C item maps to a task AC. The level A and B lists (with the mod in place of the TUI) map too, including the boundary (already in `src/core/packet.ts`), orphan tabs, `--fresh`/`--profile`, DST snooze, faults and E01–E11. Each applicable spec §15 line has a home or a decisions.md mapping. The one exception is the live in-session guard (S3-01). Every AC can be met when its task closes. The dependency order holds: INB-021 to INB-026 each depend on their milestone's tasks, INB-027 depends on all six, and there is no cycle. The install happens before the last two loops (S3-02).
2. **Correctness of stated facts:** The README status line and layout, `package.json` (`test` = `bun test test/unit`), the INB-003 adapter note and the INB-001/002 "already built" notes match the repo. The gates are green, 81 of 81.
3. **Data integrity:** Not applicable to the setup. The per-task DoD and the review loops govern it.
4. **Contracts / privacy:** The CLI contract in the ACs matches spec §8. In the current tracked tree, private terms: none found. Commit identities are personal only. The history question stays open with the owner (S3-03).
5. **Tests / evidence:** One gate, test/unit only. ACs are checked only on evidence. Live work carries the `live` label. The live guard check is the gap (S3-01).
6. **Failure handling:** The review cap (5 rounds attended, 10 unattended, then Blocked), `PROFILE_LAUNCH_UNSUPPORTED`, the stop on login prompts, "E09/E10 pending, never faked" and INB-014's Blocked-with-checklist path are consistent everywhere.
7. **Simplicity / scope:** Level D stays excluded consistently. The review tasks are lightweight. No unrequested scope.
8. **Repository / docs coherence (lead):** AGENTS.md, CLAUDE.md, decisions.md, preflight, review.md, backlog/README, config.yml, the milestones and the 27 tasks agree on these points:
   - the gate;
   - the commit format;
   - the install exception;
   - the trust dialog;
   - the profile rules;
   - report naming (`m-<n>-rN`, where board id m-0 is titled M1; each review task spells out its exact path).

   Small leftovers are in S3-03 and S3-04.
