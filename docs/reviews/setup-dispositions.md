# Setup review — dispositions

The setup is not a board task, so its dispositions live here (reports stay verbatim).

## Round 1 (`setup-r1.md`, snapshot fe96d37) — fixed in 08aa4b7

| id | disposition |
|---|---|
| S1-01 | Fixed: goal and exit condition written into all six milestone files, mapped to spec §16 / eval plan. |
| S1-02 | Fixed: INB-015 AC #2 removed; the skill's live proof is now an AC of INB-018 (E01). |
| S1-03 | Fixed: INB-009 AC now "running any agent-inbox command that reads attempts reconciles…"; INB-012 gains "opening /inbox triggers the same reconciliation" and depends on INB-009. |
| S1-04 | Fixed: INB-006 gains the `open --profile` / `open --fresh` AC. |
| S1-05 | Fixed: INB-018 gains the E04 AC delivering one personal and one work item with fingerprints. |
| S1-06 | Fixed: INB-014 gains the live mod smoke AC (eval §10, concurrent mod+CLI open); INB-012 gains the mod preflight AC. |
| S1-07 | Fixed: ACs added to INB-018 (two unrelated producers), INB-010 (database full), INB-009 (restart/reconnect, reused pane id, replaced occupant). |
| S1-08 | Fixed: §15 TUI-criteria mapping added to decisions.md. |
| S1-09 | Fixed: preflight §2/§6/§7.5/§8, README status and layout, decisions commit format. |
| S1-10 | Fixed: CLAUDE.md points to the INB-020 approval. |
| S1-11 | Fixed: INB-020 moved to m-5 and depends on INB-019 (it runs last). |
| S1-12 | Fixed: the gate is `bun run test` (test/unit only) in AGENTS.md, config.yml DoD and review.md; AGENTS.md warns about e2e naming. |
| S1-13 | Fixed: zero-padded ids in review.md, backlog/README.md and docs/reviews/README.md; `setup-r<round>.md` listed. |
| S1-14 | Fixed: INB-021..INB-026 (one milestone loop each) and INB-027 (final loop), `type:review`; review.md explains they get no second loop. |
| S1-15 | Kept, reported to the owner: the Windows path matches the public GitHub handle; night-shift is the owner's own public repo; hook names reveal nothing sensitive. No work or client names present. |
| S1-16 | Not applied: INB-003/004/005 build on the attempt APIs that INB-002's review may still change, so they keep waiting for it. |
| S1-17 | Fixed: the workspace-instead-of-endpoint deviation is recorded in decisions.md. |
