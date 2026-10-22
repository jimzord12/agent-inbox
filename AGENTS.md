# AGENTS.md — agent-inbox

A local inbox on native Windows: agents and scripts submit notifications and prepared work through
a JSON CLI; the owner sees them in a Claude Code mod (`/inbox`); an actionable item opens a fresh,
prepared Claude Code session in a new Herdr tab, and counts as delivered only after that session
proves it received the exact handoff. Public repository, personal project of the owner.

## A fresh session

Orient read-only, in this order:

1. This file, then `docs/decisions.md` (why things are as they are; do not re-argue without new facts).
2. `docs/generic-agent-inbox-spec.md` — the authority for behaviour. `docs/preflight.md` — what the
   installed Herdr, Claude and SQLite actually support.
3. The work: `backlog/README.md`, then `backlog task list --plain` and `backlog milestone list --plain`.
4. `git log --oneline -15`.

## Read when

| When | Read |
|---|---|
| Creating, taking or closing a task | `backlog/README.md` |
| Before calling a task, milestone or the project done | `docs/practices/review.md` (closed review loop) |
| Changing launch, Herdr or hook behaviour | `docs/preflight.md`, spec §9–§11 |
| Planning live evaluation runs | `docs/generic-agent-inbox-evaluation-plan.md` |
| Making a design decision | `docs/decisions.md` (append) |

## Commands

```sh
bun install
bun run typecheck && bun run test      # the gate for every commit (unit tests only; live runs never)
bun src/cli/main.ts <command> --json   # the CLI from the checkout
backlog task list --plain              # the work (Backlog.md 1.52.0)
```

## Working agreement

- **Closed review loops**: every task, every milestone, and the whole project once at the end
  (`docs/practices/review.md`). Cap 5 rounds attended, 10 unattended.
- **Commits and pushes**: commit subjects `<Scope>: <Description> (INB-<n>)`. Push to `main` of
  `github.com/jimzord12/agent-inbox` after each passed task (owner's standing permission, this repo
  only, 2026-10-22). No other repository is pushed to.
- **The repository is public**: before every push, search the diff for names of the owner's work
  projects, clients, people and private paths. Machine facts about Herdr and Claude are fine.
- **Live runs** (owner's standing permission, 2026-10-22): real Claude sessions run under the **work**
  profile (`CLAUDE_CONFIG_DIR` = the `.claude-work` folder), so agents can use peer messaging. A
  personal-profile launch only where a scenario is about profile routing. Every live run uses its own
  Herdr workspace and a throwaway fixture folder; never prompt, attach to or close the owner's own
  workspaces or sessions. Accept a folder-trust dialog only for a throwaway fixture folder; any login
  or account prompt stops the run.
- **Never** edit the owner's Claude `settings*.json`, hooks, plugin installs or PowerShell profile.
  The receipt bridge loads per session through `--settings`.
- **Never** fall back to bare `claude` or the other profile when a launch fails
  (`PROFILE_LAUNCH_UNSUPPORTED`).
- The inbox store lives in `%LOCALAPPDATA%\agent-inbox` (`AGENT_INBOX_HOME` overrides). Tests and
  evaluations always use their own home.
- No production anything; the machine-wide production guard applies.
- Native Windows only, no WSL. Git Bash: `cd x; y`, never `cd x && y`; write files over ~6 KB with
  a file tool, not a heredoc.
- Live/e2e code lives under `test/e2e/` and runs only through its own explicit command; the gate
  (`bun run test`) runs `test/unit/` only. Never name a live-run file `*.test.ts` outside `test/unit/`
  thinking it is safe: bare `bun test` would pick it up.
- English in the repository; LF line endings.
