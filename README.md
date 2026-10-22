# agent-inbox

A local inbox for AI agents and scripts on native Windows.

- Agents and scripts **submit** notifications and prepared work through a JSON CLI.
- The user **sees** them in one place, across Claude profiles (personal and work).
- An actionable item **opens** a fresh Claude Code session in a new Herdr tab: right profile, right folder, handoff already read, agent waiting.
- An item counts as **delivered** only after the new session proves it received the exact handoff.

Status: under construction. The core and the JSON CLI run; opening sessions, the `/inbox` mod and the producer skill are being built (see `backlog task list --plain`).

## Docs

- [Implementation spec](docs/generic-agent-inbox-spec.md): the authority for behaviour.
- [Evaluation plan](docs/generic-agent-inbox-evaluation-plan.md): live scenarios E01–E12.
- [Decisions](docs/decisions.md): stack, scope and constraints chosen on top of the spec.
- [Preflight](docs/preflight.md): what the local Herdr, Claude and SQLite actually support.

## Layout

```text
src/core/     database, migrations, lifecycle rules, events (the only DB writer)
src/cli/      the agent-inbox command
src/worker/   per-attempt handoff worker
src/herdr/    Herdr adapter
src/bridge/   Claude receipt-bridge hooks
mod/          the /inbox Claude Code mod (the owner's inbox view)
skill/        companion skill for producer projects
test/         unit, concurrency and fault tests in test/unit (bun run test); test/e2e for live runs
```

## Configuration

Everything lives in the inbox home, `%LOCALAPPDATA%\agent-inbox` (`AGENT_INBOX_HOME` overrides).

`profiles.json` maps the profile id an item names to a Claude config folder. Write it with:

```sh
agent-inbox setup-profiles                      # work = %USERPROFILE%\.claude-work, personal = %USERPROFILE%\.claude-personal
agent-inbox setup-profiles --profile work=D:\claude\work --label work=Work --force
```

Folders must be absolute, with a drive letter (`C:\...`) or a UNC share (`\\server\share\...`), and exist;
`\Users\me` and `C:Users\me` are refused. An existing file is replaced only with `--force`.

`config.json` is optional; every key has a default:

```json
{ "herdr": { "socket_path": "C:\\Users\\you\\AppData\\Roaming\\herdr\\herdr.sock", "workspace_label": "Agent Inbox" } }
```

`socket_path` is the Herdr server every call names (default: Herdr's own socket under `%APPDATA%`); there is no
fallback to another server. `workspace_label` names the workspace the inbox creates for its launch
tabs. Unknown keys are refused, so a misspelt key never silently falls back to a default.
`agent-inbox doctor` shows the resolved profiles and Herdr settings.

## Development

Requires [Bun](https://bun.sh) 1.4.3 or newer.

```sh
bun install
bun run test          # unit tests only (test/unit); live runs have their own command
bun run typecheck
```

## License

MIT
