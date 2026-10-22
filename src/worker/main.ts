#!/usr/bin/env bun
// Handoff worker process: `bun main.ts <attempt id> [--retry]`. Started detached by `agent-inbox open`
// with stdio ignored (docs/decisions.md, mod spike); diagnostics go to
// <home>\attempts\<attempt id>\worker.log. The inbox home comes from the environment.
import { hostname } from "node:os";
import { loadConfig } from "../core/config";
import { InboxError } from "../core/errors";
import { resolveHome } from "../core/home";
import { Inbox } from "../core/inbox";
import { Herdr } from "../herdr/adapter";
import { Worker, failBeforeStart } from "./worker";

export async function run(attemptId: string, retry = false) {
  const inbox = new Inbox({ home: resolveHome() });
  const owner = `worker:${process.pid}@${hostname()}`;
  try {
    let config;
    try {
      config = loadConfig(inbox.home);
    } catch (err) {
      const e = err instanceof InboxError ? err : new InboxError("INTERNAL", String(err));
      failBeforeStart(inbox, attemptId, owner, "HERDR_UNAVAILABLE", e.message);
      return;
    }
    const herdr = new Herdr({ socketPath: config.herdr.socket_path });
    await new Worker(attemptId, { inbox, herdr, config, owner, retry }).run();
  } finally {
    inbox.close();
  }
}

if (import.meta.main) {
  const [attemptId, ...flags] = process.argv.slice(2);
  if (!attemptId) process.exit(2);
  await run(attemptId, flags.includes("--retry"));
  process.exit(0);
}
