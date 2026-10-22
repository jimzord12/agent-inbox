# Phase 0 preflight result (spec §14)

Run 2026-10-22, read-only, from a work-profile Claude session inside Herdr.
No tool installed, no setting edited, no existing Herdr session prompted or
attached. The only things executed were help/status/list/get reads, an
in-memory and a scratch-folder SQLite probe, and a detached-child probe in the
session scratchpad.

## 1. Workspace

- New repo, nothing to follow. Stack choices are recorded in [decisions.md](decisions.md).
- Chosen layout and libraries (agent decisions, revisable):

```text
src/core/      store, migrations, lifecycle, attempts, events (only DB writer)
src/cli/       JSON CLI (`agent-inbox <command> --json`)
mod/           Claude Code mod: the user's inbox view (replaces the spec's TUI, see decisions.md)
src/worker/    detached per-attempt handoff worker
src/herdr/     Herdr adapter (spawns the `herdr` CLI, parses JSON)
src/bridge/    Claude receipt-bridge hook commands + per-session settings file
skill/         companion skill producers install
test/          `bun test` unit, concurrency and fault tests; test/e2e for live runs
```

- Test runner: `bun test` (built in, no extra dependency).
- No standalone TUI (user decision, see decisions.md). The view is a Claude Code mod.

## 2. Native Windows

- Shells: PowerShell 7 (`pwsh`), Git Bash. Herdr panes start the user's default shell.
- The app will spawn `herdr` and `claude` by argv (`Bun.spawn`), never through a shell string.
- Data home: `%LOCALAPPDATA%\agent-inbox` = `C:\Users\jimzord12\AppData\Local\agent-inbox`. `AGENT_INBOX_HOME` is unset today.
- **Detached worker works.** A `Bun.spawn(..., {detached: true})` child outlived its parent and wrote its file 3 s later. Still to verify in implementation: the spike (docs/decisions.md) saw a detached worker outlive the CLI, the Claude session and its Herdr workspace; re-check with the real worker in INB-006.

## 3. Herdr 0.9.5 (read-only)

- Client and server both `0.9.5`, protocol 22, compatible. One named session, `default`, socket `C:\Users\jimzord12\AppData\Roaming\herdr\herdr.sock`.
- Two user workspaces are live (w4, w5). No inbox workspace exists yet; the inbox will create its own (`Agent Inbox`) on first open and never use the user's workspaces.
- API schema saved by `herdr api schema --json` (272 KB). Primitives the design needs, all present:

| Need | Primitive | Notes |
|---|---|---|
| Layout | `tab.create {workspace_id, cwd, env, label, focus}` | Returns IDs. `env` **adds/overrides only**; it cannot unset a variable. |
| Canonical launch | `agent.start {name, kind:"claude", pane_id, args[], timeout_ms}` | Extra Claude args pass through `args` (`--session-id`, `--settings`). Waits for interactive readiness. No env field; env comes from the tab. |
| Wrapper launch | `layout.apply` pane node `{command: argv[], cwd, env}` | Fallback route; not needed (see §4). |
| Prompt | `agent.prompt {target, text, wait}` | Rejects if agent is `blocked`. Wait is not a turn receipt (confirmed in help text). |
| Identity | `agent.get` → `agent_session {source:"herdr:claude", kind:"id", value:<uuid>}`, `pane_id`, `tab_id`, `cwd`, `agent_status`, `completion_seq`, `state_change_seq` | Herdr reports the native Claude session UUID. Checked on this session: value matches `CLAUDE_CODE_SESSION_ID`. |
| Settle | `agent.wait --until idle/done` + `completion_seq` | `completion_seq` lets the worker require a *new* idle transition, not the startup one. |
| Focus | `agent.focus <target>` | |
| Alias | `agent start <NAME>` / `agent.rename` | Unique per-attempt alias, e.g. `inbox-<attemptShort>`. |
| Events | `events.subscribe` / `events.wait` | Optional; polling `agent.get` is enough. |

- **Gap: no compare-and-send.** `agent.prompt` targets a name; there is no "only if occupant/session is X" guard. So check-then-send is not atomic. Covered as the spec expects: the bridge's `UserPromptSubmit` hook checks session UUID + attempt + packet hash inside the target session and blocks the prompt on mismatch.
- Herdr's own Claude integration is installed in **both** profiles (`hooks/herdr-agent-state.ps1`, `SessionStart` only). That is what feeds `agent_session`. Working/idle status comes from Herdr's own detection.

## 4. Claude profiles

| | Work (`ccw`) | Personal (`ccp`) |
|---|---|---|
| Mechanism | `CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-work` + `claude @args` | `CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-personal` + `claude @args` |
| Executable | `C:\Users\jimzord12\.local\bin\claude.exe`, `2.1.308` (same binary both) | same |
| `settings.json` env block | none | none |
| `apiKeyHelper` | none | none |
| Existing hooks | prod-guard (`PreToolUse`), claude-notify (`UserPromptSubmit`, `Stop`, `StopFailure`, `SessionEnd`), herdr (`SessionStart`) | prod-guard (`PreToolUse`), herdr (`SessionStart`) |

- **Launch adapter chosen: canonical route.** `tab create --env CLAUDE_CONFIG_DIR=<profile dir>` + `agent start --kind claude -- --session-id <uuid> --settings <bridge.json>`. No wrapper needed.
- **Inherited env is a real risk.** This agent's own env carries `CLAUDE_CONFIG_DIR`, `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_MESSAGING_SOCKET/TOKEN`, `CLAUDE_CODE_ENTRYPOINT`. Pane shells inherit the **Herdr server's** env, not the caller's, but that env is unknown and cannot be unset through `tab.create`. Mitigation:
  1. Always set `CLAUDE_CONFIG_DIR` explicitly.
  2. Bridge `SessionStart` hook records a redacted env fingerprint (config dir, which `ANTHROPIC_*` / `CLAUDE_CODE_*` names are present, never values) and **fails closed** with `PROFILE_LAUNCH_UNSUPPORTED` if the config dir is wrong or an auth-affecting `ANTHROPIC_*` variable is present.
- Account identity: no non-mutating per-config account check found yet; the receipt will claim "selected config", not "authenticated account" (spec §11).
- Claude CLI supports `--session-id <uuid>`, `--settings <file-or-json>` ("additional settings"), `--plugin-dir` (session only). Bridge plan: one `--settings` JSON file per attempt, hooks only, exec form.

## 5. SQLite through Bun

- `bun:sqlite` links SQLite **3.53.4** (≥ 3.51.3 WAL-reset fix). `journal_mode=WAL` and `synchronous=FULL` (2) both take effect on a file DB.
- Consistent backup: `VACUUM INTO` works; `serialize()` also available.
- `THREADSAFE=1`, FTS5 available (unused).

## 6. Mod support

**In scope; spike done** (docs/decisions.md, 2026-10-22): the mod works on 2.1.308 in both profiles via `claude --plugin-dir`. The full mod preflight facts (spec §14 step 7: policy, generated types, validation tooling) are recorded here by INB-012.

## 7. Still unverified — needs a real launch (implementation validation)

Each is checked in a disposable fixture dir in the `Agent Inbox` workspace, never in w4/w5:

1. `--settings` hooks **add to** the profile's hooks instead of replacing them (docs say additive; prod-guard and herdr hook must still fire).
2. Hook input fields on 2.1.308: `session_id`, `cwd` (SessionStart), `prompt` (UserPromptSubmit), `last_assistant_message` (Stop), and that a `UserPromptSubmit` block really stops the prompt.
3. What env the pane shell actually has (Herdr server env), per profile.
4. Workspace trust dialog in a new fixture dir: expected to put the attempt in `blocked` on first run; the user accepts it once per fixture.
5. Detached worker survives the mod's Claude session and its tab closing (seen in the spike; re-check with the real worker).
6. `agent_session.value` equals the `--session-id` we passed.

## 8. Unresolved user decisions

None. GitHub is decided (public, remote set up). The executable name stays `agent-inbox` unless the owner says otherwise.

## 9. End-to-end validation plan

1. Phase 1 core with `bun test`: lifecycle, idempotency, revision checks, one-blocking-attempt under concurrent processes, events cursor, leases/fencing, fault injection at every attempt phase.
2. First live launch (work profile, fixture dir with a space and Unicode in the path) to close the §7 list; adapt before going further.
3. Manual smoke E01 (personal), E04 (work, with decoy), E05 (tempting instructions).
4. Scripted single runs of E01–E11 with an evaluation-only `AGENT_INBOX_HOME`.
5. Fresh-reviewer pass before calling level C done.
