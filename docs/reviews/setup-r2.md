# Setup review, round 2 — agent-inbox @ 81386ff (main)

**Verdict: FINDINGS.** There are 2 Material findings and no Blocking one.

Every round-1 fix landed, except S1-12, which landed only partly. The board now has 27 tasks: milestone goals, the moved acceptance criteria (ACs), the `--profile`/`--fresh` AC, the personal-route AC, the live mod smoke test, and the review tasks INB-021 to INB-027 are all present.

The gates are green on 81386ff:
- `bun run typecheck`: clean.
- `bun run test`: 81 of 81 pass.
- `backlog doctor`: no duplicate ids and no dependency cycles.

The two Material findings:
1. **S2-01:** the round-1 report, stored verbatim and already pushed to the public `origin/main`, lists the owner's work search terms.
2. **S2-02:** the M6 milestone review (INB-026) has to show an exit condition that includes "the final review loop passes". The final loop (INB-027) depends on INB-026, so neither can finish.

## Round-1 findings

| id | status | note |
|---|---|---|
| S1-01 | landed | All six milestone files carry a goal and an exit condition. |
| S1-02 | landed | INB-015 has one AC; INB-018 AC #3 holds the skill's live proof. |
| S1-03 | landed | INB-009 AC #4 is CLI-wide; INB-012 AC #5 adds the mod reconcile, and INB-012 depends on INB-009. |
| S1-04 | landed | INB-006 AC #6. |
| S1-05 | landed | INB-018 AC #4 (E04: personal and work, fingerprints and bindings). |
| S1-06 | landed | INB-014 AC #4 (live smoke per eval §10); INB-012 AC #6 (mod preflight). |
| S1-07 | landed | INB-018 AC #5, INB-010 AC #4, INB-009 AC #5. |
| S1-08 | landed | The §15 TUI → CLI/mod mapping is in decisions.md. |
| S1-09 | landed | Small leftover in preflight §9.3, see S2-04. |
| S1-10 | landed | CLAUDE.md points to the INB-020 approval. AGENTS.md still says "never … plugin installs" with no exception, see S2-04. |
| S1-11 | landed | INB-020 is in m-5 and depends on INB-019. |
| S1-12 | landed partly | AGENTS.md, config.yml and review.md were fixed. All 27 task files still say `bun test` in DoD #1, and so do README and preflight, see S2-03. |
| S1-13 | landed | Leftover: AGENTS.md still writes `(INB-<n>)`, see S2-04. |
| S1-14 | landed | INB-021 to INB-027 exist, but the change introduced S2-02. |
| S1-15 | kept, acceptable | Owner's own handle and repo, owner's own public project, generic hook names. Commit authorship uses a personal address only. A new leak arrived through the stored report itself, see S2-01. |
| S1-16 | declined, acceptable | The reason holds: INB-003/004/005 consume the attempt APIs, and INB-002's review may still change them. The cost is a little serialisation. |
| S1-17 | landed | The workspace-instead-of-endpoint deviation is in decisions.md. |

## New findings

| id | severity | where | scenario | expected vs actual | impact | smallest fix |
|---|---|---|---|---|---|---|
| S2-01 | Material | `docs/reviews/setup-r1.md:28` (row S1-15, the parenthesis after "No work-project, client or employer names were found"); pushed in 81386ff, which `origin/main` contains | The round-1 reviewer listed the exact private terms it had searched for. The report was then stored verbatim in the public repo. | Expected (AGENTS.md "The repository is public", decisions.md Remote): no names of the owner's work projects, employer domain or work email in committed files. Actual: that parenthesis names the employer, its mail domain, a work product, the work mailbox prefix and parts of the work stack. They are in the public history now. | The leak the setup set out to prevent. Every future review that copies this pattern repeats it. | 1. Remove the parenthesis from setup-r1.md and note the redaction in setup-dispositions.md. Privacy overrides "verbatim". 2. Add one line to review.md: "reports never list the private terms that were searched; say only 'none found'". 3. Ask the owner whether to rewrite the history. A force push is outside the standing permission. |
| S2-02 | Material | `backlog/milestones/m-5 - m6-live-evaluation.md` exit condition; INB-026 AC #2; INB-027 dependencies | The agent reaches INB-026 (M6 milestone loop). AC #2 says "the milestone's exit condition is shown met by named evidence". The exit condition ends with "the final review loop passes". INB-027 (the final loop) depends on INB-026. | Expected: every AC can be met when its task closes (the same class as S1-02). Actual: a circular wait. INB-026 cannot show the final loop passed, and INB-027 cannot start until INB-026 is Done. | An unattended agent stalls at the end of the project, or ticks AC #2 without evidence. | Drop "the final review loop passes" from the m-5 exit condition. INB-027 owns that by its own AC. |
| S2-03 | Minor | DoD #1 of INB-001 to INB-027; README.md "Development" section; preflight.md §1 and §9.1 | The config.yml DoD changed only for tasks created later. Every existing task still reads "bun run typecheck and bun test pass", and README tells the user to run `bun test`. | Expected: one gate, `bun run test` (test/unit only). Actual: the literal DoD the agent ticks is bare `bun test`. Once INB-017 adds `test/e2e`, that runs live files if they are misnamed. AGENTS.md's naming rule mitigates this. | A gate run could spend Claude usage and open Herdr tabs. The docs also contradict each other. | For each task: `backlog task edit INB-0xx --remove-dod 1 --dod "Gates green: bun run typecheck and bun run test pass on the committed revision"`. Change README and preflight to `bun run test`. |
| S2-04 | Minor | AGENTS.md "Commits and pushes" and "Never edit"; preflight.md §7.4 and §9.3 | Four leftover contradictions after round 1. | 1. AGENTS.md uses `(INB-<n>)`; decisions.md and backlog/README require zero-padded `INB-<nnn>`. 2. AGENTS.md says "Never edit … plugin installs" with no INB-020 exception (only CLAUDE.md has one). 3. preflight §7.4 says "the user accepts [the trust dialog] once per fixture"; AGENTS.md lets the agent accept it for throwaway fixtures. 4. preflight §9.3 says "E01 (personal), E04 (work, with decoy)"; INB-018 and AGENTS.md say agents run on the work profile and E04 covers both profiles. | An agent reading only AGENTS.md (or preflight) blocks on INB-020, waits for the owner on a trust dialog, or launches the personal profile outside routing. | Four one-line edits so each file matches decisions.md and INB-018. |
| S2-05 | Minor | m-1 exit ("the six open points of preflight §7 are closed"); INB-007; preflight §7.3 and §7.5 | INB-007 runs in M2, on the work profile only, before the mod exists. §7.3 asks for the pane env "per profile". §7.5 asks for worker survival when "the mod's Claude session" closes. | Expected: M2's exit can be met inside M2. Actual: §7.3-personal needs a personal launch, which AGENTS.md allows only for routing scenarios (M6). §7.5 names a mod that M4 builds. | INB-022 either stalls or closes the points loosely. | Reword: INB-007 closes §7.3 for work, and INB-018 AC #4 records the personal pane env. §7.5 is tested by running `agent-inbox open` from a Claude session in a Herdr tab and closing that tab; no mod is needed. |
| S2-06 | Note | INB-014 AC #4; INB-020 AC #2; labels | Both launch real Claude sessions but have no `live` label. INB-014 AC #4 does not say how an unattended agent drives the `/inbox` pane. Eval §10 calls these manual checks and says UI automation must not become a dependency. | | The agent may stall on INB-014 or improvise. | Add `live`. State that the agent drives the pane through Herdr pane input in its evaluation workspace, or that the task goes Blocked with a checklist for the owner. |
| S2-07 | Note | INB-019 dependencies | E10 ("target closes and an old acknowledgment arrives late") needs availability tracking (INB-011). INB-019 does not depend on INB-011; only milestone ordering keeps them in sequence. | | Small risk of running E10 too early. | Add INB-011 to INB-019's dependencies. |
| S2-08 | Note | INB-001 ACs vs spec §15 "Core and producer boundary" | Two §15 lines have no AC, though both are already built: "missing originals do not destroy retained handoff" (`test/unit/core.test.ts:43` tests it) and "producer updates cannot archive, declare delivery or change attention state". | | INB-001's review loop might not check them. | Add two ACs to INB-001. |

## Lenses

1. **Product fit / coverage (lead):** Level A+B+C (TUI replaced by the mod) and every applicable spec §15 line now map to a task AC. The order of the dependencies makes sense, and the review tasks gate their milestones correctly, except the M6/final circle (S2-02). Smaller gaps are in S2-05 to S2-08.
2. **Correctness of stated facts:** The README status line, the preflight §2/§6/§8 updates and the INB-003 adapter note match the repo. `package.json` `test` = `bun test test/unit`. Gates are green, 81 of 81.
3. **Data integrity:** Not applicable to the setup. The DoD and the loops govern it per task.
4. **Contracts / privacy:** The CLI contract in the ACs (`open --profile`/`--fresh`, envelope, exit codes) is consistent with spec §8. Privacy: S2-01 (Material). Commit identities are personal only.
5. **Tests / evidence:** ACs are checked only on evidence, and live work is split from the unit gate. The literal DoD text is still wrong (S2-03).
6. **Failure handling:** The cap (5 attended, 10 unattended, then Blocked), `PROFILE_LAUNCH_UNSUPPORTED` and the login-prompt stop rule are all consistent. E09/E10 are "pending, never faked".
7. **Simplicity / scope:** Level D items are consistently excluded. The seven review tasks are lightweight and well-scoped. No unrequested scope.
8. **Repository / docs coherence (lead):** Statuses, labels, report naming (`m-<n>-rN`, zero-padded `INB-nnn`) and milestone ids agree across review.md, backlog/README and the tasks. Leftover drift is in S2-03 (`bun test`) and S2-04 (commit format, install exception, trust-dialog owner, E01 profile).
