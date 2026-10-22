import { Attempts } from "../core/attempts";
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
}

export interface HookOutcome {
  exitCode: 0 | 2;
  stdout?: string;
  stderr?: string;
}

const PASS: HookOutcome = { exitCode: 0 };

// Variables that change which account or endpoint Claude authenticates against. Only their
// names are recorded; a present one fails the binding (PROFILE_LAUNCH_UNSUPPORTED).
const AUTH_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
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
  const inbox = new Inbox({ home: ctx.home });
  try {
    const attempts = new Attempts(inbox);
    const sessionId = str(input, "session_id");
    const cwd = str(input, "cwd");
    if (event === "session-start") {
      // A mismatch blocks the attempt and leaves it unbound, so the worker never dispatches and
      // the prompt guard refuses the opening prompt: the session never receives the packet.
      attempts.bind(ctx.attemptId, ctx.capability, {
        session_id: sessionId,
        cwd,
        claude_config_dir: env.CLAUDE_CONFIG_DIR ?? "",
        auth_env: authEnvNames(env),
      });
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
    return failClosed(event, input, err);
  }
}

export function failClosed(event: HookEvent, input: Record<string, unknown>, err: unknown): HookOutcome {
  if (event === "prompt" && looksLikeProtocol(str(input, "prompt"))) {
    const code = err instanceof InboxError ? err.code : "INTERNAL";
    return { exitCode: 2, stderr: `agent-inbox: opening prompt refused (${code}).` };
  }
  return PASS;
}
