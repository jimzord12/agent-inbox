#!/usr/bin/env bun
// A throwaway inbox for live /inbox mod runs, run by hand only: `bun test/e2e/mod-fixture.ts <run-dir>`.
// Seeds one item of each kind and placement through the real CLI: two Active (one actionable, one
// informational with a UTF-8 title), one Snoozed, one in History. The core refuses control
// characters in titles and summaries, so the escapes the mod must make inert are in the handoff.
// It launches nothing. Point a Claude session at it with AGENT_INBOX_HOME=<run-dir>/home and
// load the mod with `claude --plugin-dir mod`; live runs follow AGENTS.md (own Herdr workspace,
// work profile only).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: bun test/e2e/mod-fixture.ts <run-dir>");
  process.exit(2);
}
// Only a new or empty folder: a mistyped path must never get files written into it.
if (existsSync(runDir) && readdirSync(runDir).length) {
  console.error(`refusing: ${runDir} is not empty`);
  process.exit(2);
}
const MAIN = join(import.meta.dir, "..", "..", "src", "cli", "main.ts");
const home = join(runDir, "home");
const fixture = join(runDir, "fixture dir é");
const socket = process.env.HERDR_SOCKET_PATH ?? join(process.env.APPDATA ?? "", "herdr", "herdr.sock");
const workDir = join(process.env.USERPROFILE ?? "", ".claude-work");

mkdirSync(home, { recursive: true });
mkdirSync(fixture, { recursive: true });
writeFileSync(join(home, "config.json"), JSON.stringify({ herdr: { socket_path: socket, workspace_label: "inbox-e2e-mod" } }));
writeFileSync(join(home, "profiles.json"), JSON.stringify({ profiles: { work: { label: "Work", agent: "claude-code", claude_config_dir: workDir } } }));
writeFileSync(join(fixture, "README.md"), "# Throwaway fixture\n\nCreated by an agent-inbox mod live run. Safe to delete.\n");
const handoff = join(runDir, "handoff.md");
writeFileSync(
  handoff,
  "# Handoff (live test)\n\nA test handoff from an agent-inbox mod live run.\nThere is no real work here: orient in one sentence and wait.\n\n" +
    "Escapes the mod must make inert: \u001b[31mred\u001b[0m\u0007 bell ‮evil \u001b]8;;https://example.com\u0007link\u001b]8;;\u0007\n",
);

function cli(args: string[], input?: unknown) {
  const r = Bun.spawnSync([process.execPath, MAIN, ...args, "--json"], {
    env: { ...process.env, AGENT_INBOX_HOME: home },
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = JSON.parse(r.stdout.toString());
  if (!out.ok) throw new Error(`${args[0]}: ${JSON.stringify(out.error)}`);
  return out.data;
}

function submit(externalId: string, kind: "actionable" | "informational", title: string, producer = "e2e.mod") {
  const item = {
    api_version: 1,
    producer_id: producer,
    external_id: externalId,
    kind,
    title,
    summary: `A throwaway ${kind} item for a live /inbox run.`,
    profile_id: "work",
    ...(kind === "actionable"
      ? { handoff_path: handoff, launch: { agent: "claude-code", cwd: fixture, initial_instruction: "This is a mod test. Orient in one sentence, then wait." } }
      : {}),
  };
  return cli(["submit", "--input", "-"], item).item;
}

const open = submit("actionable-1", "actionable", "Review the throwaway plan");
const noisy = submit("informational-1", "informational", "Build done: Ελληνικά 日本 ✓", "e2e.other");
const later = submit("snoozed-1", "informational", "Look at this tomorrow");
cli(["snooze", later.id, "--until", new Date(Date.now() + 86400_000).toISOString(), "--if-state-version", String(later.state_version)]);
const done = submit("history-1", "informational", "Already handled");
cli(["archive", done.id, "--if-state-version", String(done.state_version)]);
console.log(JSON.stringify({ home, fixture, items: { active: [open.id, noisy.id], snoozed: later.id, history: done.id } }));
