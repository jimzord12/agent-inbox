#!/usr/bin/env bun
// INB-007 live launch, run by hand only: `bun test/e2e/inb007-live.ts <run-dir>`.
// Sets up a throwaway inbox home and fixture folder (path with a space and Unicode), submits
// one actionable item, opens it through the real CLI on the work profile, and prints every
// attempt change until it settles. It never answers a dialog itself: a blocked attempt is
// printed with its alias so the operator inspects the pane first.
//
// Live runs follow AGENTS.md: own Herdr workspace (its label below), work profile only, never
// the owner's workspaces.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: bun test/e2e/inb007-live.ts <run-dir>");
  process.exit(2);
}
const MAIN = join(import.meta.dir, "..", "..", "src", "cli", "main.ts");
const home = join(runDir, "home");
const fixture = join(runDir, "fixture dir é");
const socket = process.env.HERDR_SOCKET_PATH ?? join(process.env.APPDATA ?? "", "herdr", "herdr.sock");
const workDir = join(process.env.USERPROFILE ?? "", ".claude-work");

mkdirSync(home, { recursive: true });
mkdirSync(fixture, { recursive: true });
writeFileSync(join(home, "config.json"), JSON.stringify({ herdr: { socket_path: socket, workspace_label: "inbox-e2e-inb007" } }));
writeFileSync(join(home, "profiles.json"), JSON.stringify({ profiles: { work: { label: "Work", agent: "claude-code", claude_config_dir: workDir } } }));
writeFileSync(join(fixture, "README.md"), "# Throwaway fixture\n\nCreated by the agent-inbox INB-007 live run. Safe to delete.\n");
const handoff = join(runDir, "handoff.md");
writeFileSync(handoff, "# Handoff (live test)\n\nThis is a test handoff from the agent-inbox INB-007 live run.\nThere is no real work here: orient in one sentence and wait.\n");

function cli(args: string[], input?: string) {
  const r = Bun.spawnSync([process.execPath, MAIN, ...args, "--json"], {
    env: { ...process.env, AGENT_INBOX_HOME: home },
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return JSON.parse(r.stdout.toString());
}

const submitted = cli(["submit", "--input", "-"], JSON.stringify({
  api_version: 1,
  producer_id: "e2e.inb007",
  external_id: `live-${Date.now()}`,
  kind: "actionable",
  title: "INB-007 live launch test",
  summary: "A throwaway item proving the first real launch.",
  profile_id: "work",
  handoff_path: handoff,
  launch: { agent: "claude-code", cwd: fixture, initial_instruction: "This is a launch test. Orient in one sentence, then wait." },
}));
const item = submitted.data.item;
console.log(`home ${home}\nitem ${item.id}`);
const t0 = Date.now();
const opened = cli(["open", item.id, "--if-revision", "1"]);
console.log(`open answered in ${Date.now() - t0} ms: ${JSON.stringify({ attempt_id: opened.data?.attempt_id, status: opened.data?.status, reused: opened.data?.reused, error: opened.error })}`);
const id = opened.data?.attempt_id;
if (!id) process.exit(1);

let last = "";
const deadline = Date.now() + 15 * 60_000;
while (Date.now() < deadline) {
  const a = cli(["attempt", "get", id]).data.attempt;
  const line = `${a.status} ${a.phase} ${a.error ? `${a.error.code}: ${a.error.message}` : ""} | bound=${a.evidence.bound} prompt=${a.evidence.prompt_state} receipt=${a.evidence.receipt_candidate} focused=${a.evidence.focused} alias=${a.herdr.agent_alias ?? "-"}`;
  if (line !== last) {
    console.log(`${new Date().toISOString()} ${line}`);
    last = line;
  }
  if (["succeeded", "failed", "uncertain"].includes(a.status)) break;
  if (a.status === "blocked" && a.error?.code !== "AGENT_BLOCKED") break;
  await Bun.sleep(1000);
}
