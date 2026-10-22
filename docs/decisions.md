# Decisions, constraints and discoveries

Record of everything decided before the first line of code, that the code
itself will not show. The behavioural authority is
[`generic-agent-inbox-spec.md`](generic-agent-inbox-spec.md); the live test plan
is [`generic-agent-inbox-evaluation-plan.md`](generic-agent-inbox-evaluation-plan.md).
This file records the choices made on top of them.

Started 2026-10-22.

## Stack and home (user-confirmed 2026-10-22)

| Area | Decision |
|---|---|
| Runtime | Bun `1.4.3` (latest release at the time), TypeScript. |
| Database driver | Built-in `bun:sqlite`. Its bundled SQLite is `3.53.4`, newer than the WAL-reset fix the spec §7 requires (≥ 3.51.3), so WAL + `synchronous=FULL` is allowed. Re-check the linked engine version at runtime (`doctor`), not a separate `sqlite3.exe`. |
| Repository | `C:\Users\jimzord12\Documents\GitHub\agent-inbox`, personal GitHub account `jimzord12`. A personal project, not part of the user's work workspace; work-repo conventions do not apply. Public repo. |
| Remote | `github.com/jimzord12/agent-inbox`, **public** (user, 2026-10-22, "public for now"). Keep work-project names and private paths out of committed docs. |
| Executable name | `agent-inbox` for now (spec §8). A shorter name is an open question. |
| Platform | Native Windows only. No WSL. |

## Depth level: C (crash-safe) — user-confirmed 2026-10-22

Levels are cumulative. Level C means everything in A, B and C below. The
original handoff recommended B; the user chose C explicitly, accepting the
~20–26 h estimate (±50 %). The user may step down to B after the Phase 0
preflight if something turns out hard.

**A — Inbox + simple launch**
- SQLite store and migrations.
- JSON CLI: `submit`, `update`, `get`, `list`, `events`, `mark-read` / `mark-unread`, `acknowledge`, `snooze` / `unsnooze`, `archive`, `restore`, `status`, `doctor`.
- Idempotency on `(producer_id, external_id)`.
- Immutable revisions with the retained handoff bytes.
- Cursor-based event polling.
- Basic TUI: Active / Snoozed / History, details, actions.
- Open session: Herdr tab in the right cwd, Claude started with the profile env, prompt pointing at the packet file.
- Companion skill (for producer projects) + README.

**B — Verified handoff**
- Receipt bridge as Claude hooks (`SessionStart`, `UserPromptSubmit`, `Stop`), loaded per launched session only.
- Explicit `--session-id`.
- `INBOX_READY_V1` marker with a per-attempt challenge.
- Attempts table with `in_progress` / `blocked` / `failed` / `succeeded`.
- At most one blocking attempt per item, enforced by the database.
- `retry`, `abandon`, `focus`.
- Generic opening boundary (spec §9.3).
- Item becomes `delivered` only on valid receipt + settled agent + successful focus.
- Manual smoke runs E01, E04, E05 of the evaluation plan.

**C — Crash-safe**
- Detached per-attempt worker that survives the TUI closing.
- Leases + fencing generation.
- Intent persisted before each external side effect.
- `uncertain` state and reconciliation.
- Orphan-tab discovery.
- `ALREADY_DELIVERED` + `open --fresh`.
- **Open with profile…** override.
- DST-aware snooze.
- Pagination.
- Automated fault tests around each phase.
- Scripted single runs of E01–E11.

**Interface change (user, 2026-10-22): no standalone TUI.** The spec's
"terminal UI in a Herdr tab" was a misunderstanding from the design session.
The user's view of the inbox is a **Claude Code mod** (`/inbox`, list, details,
actions) inside the Claude terminal, calling the JSON CLI. So:
- The level A "basic TUI" is dropped; the mod takes its place and moves into scope.
- The CLI stays the one contract and the fallback interface (`list`, `get`, `open`, …).
- "Worker survives the TUI closing" now means it survives the mod's Claude session closing.
- The mod still never injects a handoff into the conversation hosting it (spec §12.2).
- The passive pending indicator stays out of scope.

**Mod spike result (2026-10-22): the mod is enough; no TUI.** Tested live on Claude
Code 2.1.308 in both profiles, loaded session-only with `claude --plugin-dir`. All ten
required capabilities worked (persistent `/inbox` pane, keyboard list with views and
filters, details, argv CLI calls without freezing, 2 s refresh keeping selection,
snooze field and profile picker, no chat turns created, detached worker outliving the
session). Rules that follow from it:
- The mod strips control/escape characters from all producer text itself; one bad
  string makes the engine refuse the whole pane.
- The mod pages long handoff previews itself (engine limit: 100,000 characters per tree).
- `agent-inbox open` starts its worker detached with stdio `ignore`; an inherited pipe
  makes the mod's process call hang until timeout.
- Permanent use needs a one-time install per profile (local folder marketplace). Approved by
  the owner on 2026-10-22 for the end of the build (INB-020).

**Spec §15 criteria that name the TUI, mapped to this design:**
- "The TUI works outside Herdr and while Herdr/Claude are unavailable" → the **CLI** (list, get,
  read, acknowledge, snooze, archive, restore, status) works without Herdr; the mod needs Claude
  by nature and is not held to this line.
- "Removing all producer code leaves the TUI … functional" → leaves the **CLI and the mod** functional.
- "Removing the mod changes none of [the commands, records, errors, lifecycle]" → holds as written:
  the CLI is the only contract.

**Herdr endpoint for evaluation (deviation from evaluation plan §4):** live runs use a dedicated
**workspace** on the owner's default Herdr server, not a separate named Herdr session/endpoint. Reason:
one server is what the owner runs; a workspace keeps runs apart without starting another server.
Every run still pins the socket explicitly and never touches the owner's workspaces.

**Out of scope (level D, not being built):** the passive pending indicator; the evaluation harness with fault
barriers for E09/E10; the skill A/B experiment (E12); a calibrated LLM judge;
×3 repetitions per profile; the optional Mastra adapter.

## Claude profile findings (`ccw` / `ccp`)

Source: `C:\Users\jimzord12\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`, lines 116–146 (read-only).

- `ccw` and `ccp` are PowerShell functions wrapping `Invoke-ClaudeProfile`.
- Each sets `CLAUDE_CONFIG_DIR` to `%USERPROFILE%\.claude-work` (work) or `%USERPROFILE%\.claude-personal` (personal), runs `claude @args`, then restores the previous env.
- So each profile is canonical `claude` + one env var. That makes them reducible to `herdr agent start` with an env addition, no wrapper needed (spec §10.2). To be confirmed in preflight.
- The launching agent itself runs under one of these profiles, so `CLAUDE_CONFIG_DIR` **will** be inherited. Set it explicitly on every launch, and clear inherited `ANTHROPIC_*` values inside the launch boundary.
- Never depend on the interactive PowerShell profile having loaded.

## Machine facts (2026-10-22)

| Tool | Version / location |
|---|---|
| Herdr | `0.9.5` standalone, `~/.herdr/packages/standalone/releases/0.9.5-x86_64-pc-windows-msvc/`. Running; the user works inside it (`HERDR_ENV=1` sessions exist). |
| Claude Code | `2.1.308` |
| Bun | `1.4.3` |
| Node | `24.18` (installed, unused by this project) |

Shell quirks on this machine:
- Git Bash: `cd x && y` can silently skip `y`; use `cd x; y`.
- Heredocs above ~6 KB break; write files with a file tool.

## Do-not-do list

- No WSL.
- Never fall back to bare `claude` or to the other profile when a profile launch fails. Block with `PROFILE_LAUNCH_UNSUPPORTED`.
- Never edit the user's existing Claude `settings*.json`, hooks or PowerShell profile without the user's explicit word on that exact change. The receipt bridge loads additively per launched session (`--settings` / plugin dir), never globally.
- The inbox DB lives in `%LOCALAPPDATA%\agent-inbox` (override: `AGENT_INBOX_HOME`). Never inside a repo, OneDrive or a temp folder.
- No production anything. The machine-wide production guard applies.
- Preflight and tests must not prompt, attach to, or restart existing Herdr sessions. Use a dedicated inbox workspace and a disposable fixture directory for launch tests.

## Owner permissions for the build (2026-10-22)

- **Push**: straight to `main` of `jimzord12/agent-inbox`, this repository only.
- **Live runs**: real Claude sessions through Herdr under the **work** profile (`ccw`), so agents can
  use peer messaging. A short personal-profile session only where a test is about profile routing
  (a "personal" item must open with `.claude-personal`).
- **Real-use setup at the end** (INB-020): write `profiles.json` in the real inbox home and install
  the `/inbox` mod once in each profile. One inbox; `work` / `personal` are item labels, and the label
  picks the Claude profile its session opens with.
- **Process**: Backlog.md is the tracker; a closed review loop per task, per milestone and once for
  the whole project (`docs/practices/review.md`).

## Open questions

- Executable name: keep `agent-inbox`, or something shorter. Default: keep it.

## Resolved

- Public history rewritten 2026-10-22, owner approved: the private search terms one review
  report listed (old commits 08aa4b7 through 81386ff) are gone from every commit; the redacted
  file replaced the leaked one, so the final tree is unchanged and every commit id from there
  on changed. GitHub may still serve the old commits by id until its caches expire. The
  approval covered that one rewrite; agents still never force-push without a new one.

## Conventions

- Commit subjects: `<Scope>: <Description> (INB-<nnn>)`, the task id zero-padded as on the board.
- All repo content in English. Talk to the user in Greek.

## Build decisions (agent, 2026-10-22, from review loops)

- **The receipt does not check the "I am waiting" wording** (M2 review): spec §9.1 step 4 asks the
  reply to say it is waiting. The check requires the exact marker on the last line and a non-empty
  orientation before it, but not a phrase: wording varies, a phrase match would be easy to satisfy
  by accident and refuse a good reply by chance, and the packet's opening-turn instructions already
  ask Claude to wait. What the receipt proves is unchanged: this session received this packet.
- **The live worker replays a receipt saved aside** (M3 review): while it waits for the receipt it
  also replays `receipt-pending.json`, so a busy Stop never needs a CLI read to count.
- **Session availability is refreshed only by `focus`** (INB-011): reads never call Herdr, so
  `get` and the attempt view show the last value `focus` recorded (live, closed, unknown,
  unavailable), and only for a delivered attempt. Focus is offered unless the session is closed or
  another session holds its alias.
- **A busy store at SessionStart is tried once more** (INB-010): Claude runs SessionStart only
  once, so a startup lost to a busy store would leave the session unbound and the attempt blocked.
  Worst case about 8 s, inside the 15 s hook timeout; still busy, the hook passes silently and the
  worker blocks at its bind timeout. A busy Stop gets the same retry, then saves the reply aside.
- **An update whose content is already current is a no-op**, checked before the revision guard
  (M1 review): a producer retrying after a lost response gets `changed:false`, not
  `REVISION_CONFLICT`. `changed:false` means "the item now holds your content", even if someone
  else edited in between and back (A-B-A).
- **Extra error code `HANDOFF_UNAVAILABLE`** (retryable, exit 1): the handoff file exists but is
  locked right now (EBUSY, or EPERM/EACCES from a sharing violation). Spec section 8 has no code for a
  transient input problem; `INVALID_ITEM` would tell producers not to retry.
- **Events cursor ahead of the store is refused** (`INVALID_ARGUMENT`, `details.latest_cursor`), so a
  consumer after a backup restore resets on purpose instead of silently skipping events.
- **Herdr outcomes**: reads report errors as `rejected`; mutating calls report every error as `unknown`
  unless Herdr raises it before acting (a fixed list checked against the 0.9.5 binary). Only a
  `rejected` may lead to a retry of the same step.
- **Receipt bridge**: Claude's SessionStart cannot block, so a failed startup check blocks the attempt
  and leaves it unbound; the prompt guard then refuses the packet. Any prompt starting with
  `[agent-inbox ` is a protocol prompt; one the guard cannot validate (including when the store or its
  own input is unavailable) is blocked, and ordinary prompts always pass.
- **Minors found in a task's last review round** are carried to its milestone loop instead of reopening
  the task loop; the milestone review re-reviews that code anyway.
- **List items carry `latest_attempt`** (`attempt_id`, `status`, `phase`, `error_code`, or null), so
  the mod's list rows show launch and error status from one `list` call (spec §12.1) instead of one
  `attempt get` per row every 2 s.
- **The mod runs the checkout's CLI** (`bun <mod>/../src/cli/main.ts`), found from the mod's own
  folder; there is no `agent-inbox` on PATH. INB-020 installs from a folder marketplace whose entry is
  a relative path, which Claude reads in place, so the same path holds after install.
