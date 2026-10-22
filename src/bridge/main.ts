#!/usr/bin/env bun
// Receipt-bridge hook process: `bun main.ts <session-start|prompt|stop> --bridge <bridge.json>`.
// Claude passes the hook input as JSON on stdin. See hooks.ts for what each event does.
import { readFileSync } from "node:fs";
import { type HookContext, type HookEvent, type HookOutcome, failClosed, safeHandle } from "./hooks";

const EVENTS: HookEvent[] = ["session-start", "prompt", "stop"];
// Below the settings timeout (15 s), so the hook always answers itself instead of being killed.
// AGENT_INBOX_HOOK_DEADLINE_MS lowers it for tests only.
const DEADLINE_MS = Math.min(10_000, Number(process.env.AGENT_INBOX_HOOK_DEADLINE_MS) || 10_000);
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function finish(o: HookOutcome): never {
  if (o.stdout) process.stdout.write(o.stdout);
  if (o.stderr) process.stderr.write(`${o.stderr}\n`);
  process.exit(o.exitCode);
}

async function readInput(): Promise<Record<string, unknown>> {
  const text = await Bun.stdin.text();
  if (text.length > MAX_INPUT_BYTES) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function readContext(path: string): HookContext {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { home?: unknown; attempt_id?: unknown; capability?: unknown };
  if (typeof raw.home !== "string" || typeof raw.attempt_id !== "string" || typeof raw.capability !== "string") {
    throw new Error("bridge file is incomplete");
  }
  return { home: raw.home, attemptId: raw.attempt_id, capability: raw.capability };
}

export async function run(argv: string[]): Promise<never> {
  const event = argv[0] as HookEvent;
  if (!EVENTS.includes(event)) finish({ exitCode: 0 });
  let input: Record<string, unknown> | null = null;
  // A hung store or disk never holds the session: at the deadline a protocol prompt is blocked
  // and everything else passes. A prompt whose input could not even be read is blocked too,
  // since it may be the opening prompt; the user can send an ordinary prompt again.
  const timer = setTimeout(() => {
    if (input === null && event === "prompt") finish({ exitCode: 2, stderr: "agent-inbox: hook timed out; send the prompt again." });
    finish(failClosed(event, input ?? {}, new Error("deadline")));
  }, DEADLINE_MS);
  try {
    input = await readInput();
    const i = argv.indexOf("--bridge");
    const ctx = readContext(i >= 0 ? (argv[i + 1] ?? "") : "");
    const outcome = safeHandle(event, ctx, input, process.env);
    clearTimeout(timer);
    finish(outcome);
  } catch (err) {
    clearTimeout(timer);
    finish(failClosed(event, input ?? {}, err));
  }
}

if (import.meta.main) await run(process.argv.slice(2));
