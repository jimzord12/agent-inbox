import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Attempts, parseReadyMarker } from "../core/attempts";
import { InboxError } from "../core/errors";
import { Inbox } from "../core/inbox";
import { OPENING_PREFIX } from "../core/packet";

// Receipt-bridge hook logic (spec §9.2 steps 4, 6, 8). One process per hook call, started by
// Claude through the per-attempt settings file (see settings.ts). Each handler returns what the
// process must do; `main.ts` turns that into exit code and output.
//
//   exit 0, no output   -> Claude carries on untouched (ordinary prompts, every Stop)
//   exit 2, stderr text -> UserPromptSubmit: the prompt is blocked and erased
//
// Output never contains the capability, challenge, packet text or env values.

export type HookEvent = "session-start" | "prompt" | "stop";

export interface HookContext {
  home: string;
  attemptId: string;
  capability: string;
  // The bridge file this hook was started with; receipt-pending.json is written beside it.
  bridgePath?: string;
  // When the hook process started. A receipt saved aside carries this time, so one whose Stop
  // began before a refused startup can be told apart from a later one (reconcile).
  startedAt?: string;
}

export interface HookOutcome {
  exitCode: 0 | 2;
  stdout?: string;
  stderr?: string;
}

const PASS: HookOutcome = { exitCode: 0 };

// One statement waits at most this long for another process's lock. A hook opens the store
// (one wait) and writes once (one wait); a busy Stop runs once more, reopening the store. Worst
// case about 8 s plus Bun start-up, inside the 15 s settings timeout.
export const HOOK_BUSY_TIMEOUT_MS = 2000;
export const RECEIPT_PENDING_FILE = "receipt-pending.json";

// Variables that change which account or endpoint Claude authenticates against. Only their
// names are recorded; a present one fails the binding (PROFILE_LAUNCH_UNSUPPORTED).
const AUTH_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

export function authEnvNames(env: Record<string, string | undefined>): string[] {
  return Object.keys(env)
    .filter((k) => env[k] !== undefined && env[k] !== "" && AUTH_ENV.includes(k.toUpperCase()))
    .map((k) => k.toUpperCase())
    .sort();
}

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === "string" ? v : "";
}

// Does this prompt claim to be an inbox opening prompt? Checked without the store, so a
// broken store still fails closed for protocol prompts and stays out of the way otherwise.
export function looksLikeProtocol(prompt: string): boolean {
  return prompt.trimStart().startsWith(OPENING_PREFIX);
}

export function handle(
  event: HookEvent,
  ctx: HookContext,
  input: Record<string, unknown>,
  env: Record<string, string | undefined>,
): HookOutcome {
  // An existing store only: a session that outlived its inbox home leaves the disk alone.
  const inbox = new Inbox({ home: ctx.home, store: { existingOnly: true, busyTimeoutMs: HOOK_BUSY_TIMEOUT_MS } });
  try {
    const attempts = new Attempts(inbox);
    const sessionId = str(input, "session_id");
    const cwd = str(input, "cwd");
    if (event === "session-start") {
      // A mismatch blocks the attempt and leaves it unbound, so the worker never dispatches and
      // the prompt guard refuses the opening prompt: the session never receives the packet.
      const bound = attempts.bind(ctx.attemptId, ctx.capability, {
        session_id: sessionId,
        cwd,
        claude_config_dir: env.CLAUDE_CONFIG_DIR ?? "",
        auth_env: authEnvNames(env),
      });
      // A refused startup drops the receipt candidate on purpose; a receipt saved aside earlier
      // (busy store at Stop) goes with it, so reconcile can never bring it back.
      if (!bound.ok && ctx.bridgePath) rmSync(join(dirname(ctx.bridgePath), RECEIPT_PENDING_FILE), { force: true });
      return PASS;
    }
    if (event === "prompt") {
      const r = attempts.acceptPrompt(ctx.attemptId, ctx.capability, sessionId, cwd, str(input, "prompt"));
      if (r.ok || !r.protocol) return PASS;
      return { exitCode: 2, stderr: `agent-inbox: opening prompt refused (${r.code}).` };
    }
    // Stop: only the main session reaches this hook (SubagentStop is a separate event).
    attempts.captureReceipt(ctx.attemptId, ctx.capability, sessionId, str(input, "last_assistant_message"));
    return PASS;
  } finally {
    inbox.close();
  }
}

// Wraps `handle` so no failure escapes: a protocol prompt is blocked, everything else passes.
export function safeHandle(
  event: HookEvent,
  ctx: HookContext,
  input: Record<string, unknown>,
  env: Record<string, string | undefined>,
): HookOutcome {
  try {
    return handle(event, ctx, input, env);
  } catch (err) {
    if (event === "stop" && isBusy(err)) return stopWhileBusy(ctx, input, env);
    // Claude runs SessionStart once: a startup lost to a busy store is tried once more, or the
    // session stays unbound and the worker blocks at its bind timeout.
    if (event === "session-start" && isBusy(err)) {
      try {
        return handle(event, ctx, input, env);
      } catch {
        return PASS;
      }
    }
    return failClosed(event, input, err);
  }
}

function isBusy(err: unknown): boolean {
  return err instanceof InboxError && err.code === "STORE_BUSY";
}

// Claude never runs Stop again for this turn, so a marker lost to a busy store is lost for good.
// Retry once; still busy, keep the reply beside the bridge file for reconcile (INB-009).
function stopWhileBusy(ctx: HookContext, input: Record<string, unknown>, env: Record<string, string | undefined>): HookOutcome {
  try {
    return handle("stop", ctx, input, env);
  } catch (err) {
    if (!isBusy(err) || !ctx.bridgePath) return PASS;
    // The whole message is kept: the receipt check needs the orientation before the marker.
    // Only a reply that parses as a receipt is worth keeping; the store still checks its fields.
    const message = str(input, "last_assistant_message");
    if (!parseReadyMarker(message).ok) return PASS;
    try {
      writePending(join(dirname(ctx.bridgePath), RECEIPT_PENDING_FILE), {
        attempt_id: ctx.attemptId,
        session_id: str(input, "session_id"),
        last_assistant_message: message,
        written_at: ctx.startedAt ?? new Date().toISOString(),
      });
    } catch {
      // Nothing else to try; the attempt stays recoverable by abandoning it.
    }
    return PASS;
  }
}

function writePending(path: string, body: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body)}\n`);
  renameSync(tmp, path);
}

export function failClosed(event: HookEvent, input: Record<string, unknown>, err: unknown): HookOutcome {
  if (event === "prompt" && looksLikeProtocol(str(input, "prompt"))) {
    const code = err instanceof InboxError ? err.code : "INTERNAL";
    return { exitCode: 2, stderr: `agent-inbox: opening prompt refused (${code}).` };
  }
  return PASS;
}
