# Backlog: how agent-inbox tracks its work

Backlog.md (CLI **1.52.0**, installed globally) is the single tracker. Adapted from the owner's
Backlog protocol (milestones are phases, dependencies are the DAG).

## Rules

- **CLI only** (`backlog task create|edit|list|view`, `--plain` to read). Never hand-edit task files;
  `backlog/config.yml` and the milestone descriptions (`backlog/milestones/*.md`, below the
  `## Description` heading; the 1.52.0 CLI cannot edit them) are the only files edited directly. Never `backlog browser` or the MCP server.
- Check `backlog --version` before the first write in a session.
- **A task is a work order for a fresh agent with no memory**: the description is the why, acceptance
  criteria are the what (one testable behaviour each). No plan at creation; the plan is written when
  the task is taken.
- One deliverable reviewable in one sitting, its tests and docs included. Every task has a milestone,
  a priority and labels from the set below.
- Sub-tasks (`-p INB-<nnn>`) only when one goal needs slices that each stand alone.
- Work found outside a task's criteria becomes a new task, not silent scope growth.
- Windows note: `backlog` is a `.cmd` shim, so argument text must avoid `" % ^ & | < >`.

## Flow

```sh
backlog task list --ready --plain                     # earliest milestone first
backlog task edit INB-007 -s "In Progress" -a @claude   # claim, then read back
backlog task edit INB-007 --plan "1. … 2. …"            # after researching the code
backlog task edit INB-007 -s "In Review"                # review loop: docs/practices/review.md
backlog task edit INB-007 --check-ac 1 --check-dod 1 --final-summary "What changed; checks; what is unverified."
backlog task edit INB-007 -s Done
```

A criterion is checked only on evidence (a test that ran, an observed live run). Task changes are
committed with the work they describe; commit subjects end with the id: `Core: Add X (INB-007)`. Ids are always zero-padded as on the board.

## Statuses

| Status | Meaning |
|---|---|
| `To Do` | Not taken. |
| `In Progress` | Claimed; the plan is in the task. |
| `Blocked` | Cannot continue; the notes say on what (a decision, a review loop at its cap). |
| `In Review` | Built; its review loop is running. |
| `Done` | Every criterion and Definition of Done item checked on evidence; final summary written. |

A milestone is complete when all its tasks are Done **and** its own review loop passed.

## Labels and priority

| Label | Marks a task that… |
|---|---|
| `type:feature`, `type:fix`, `type:test`, `type:docs`, `type:chore`, `type:review` | the kind of work (one per task) |
| `core` | changes the store, lifecycle or attempts (`src/core/`) |
| `cli` | changes the `agent-inbox` command |
| `herdr` | changes the Herdr adapter |
| `bridge` | changes the Claude receipt-bridge hooks |
| `worker` | changes the handoff worker |
| `mod` | changes the `/inbox` Claude Code mod |
| `skill` | changes the companion producer skill |
| `eval` | changes the live evaluation harness |
| `live` | runs real Claude sessions through Herdr (spends Claude usage on the work profile) |

Priority: `high` for correctness of handoff and the path to a usable inbox; `medium` for evaluation
and docs; `low` for polish and ideas.
