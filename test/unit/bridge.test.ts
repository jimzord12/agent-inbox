import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Attempts } from "../../src/core/attempts";
import { READY_MARKER, buildOpeningPrompt } from "../../src/core/packet";
import { profilesPath } from "../../src/core/profiles";
import { RECEIPT_PENDING_FILE, authEnvNames, looksLikeProtocol } from "../../src/bridge/hooks";
import { HOOK_TIMEOUT_SECONDS, bridgeFiles, writeBridgeSettings } from "../../src/bridge/settings";
import { type Fixture, fixture } from "../helpers";

const HOOK = join(import.meta.dir, "..", "..", "src", "bridge", "main.ts");
const WORK_DIR = "C:\\Users\\me\\.claude-work";

let f: Fixture;
let at: Attempts;
beforeEach(() => {
  f = fixture();
  writeFileSync(
    profilesPath(f.home),
    JSON.stringify({ profiles: { work: { label: "Work", agent: "claude-code", claude_config_dir: WORK_DIR } } }),
  );
  at = new Attempts(f.inbox);
});
afterEach(() => f.cleanup());

// A clean env for the hook process: the test runner may itself run inside a Claude session.
function hookEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !authEnvNames({ [k]: v }).length && k.toUpperCase() !== "CLAUDE_CONFIG_DIR") env[k] = v;
  }
  return { ...env, CLAUDE_CONFIG_DIR: WORK_DIR, ...extra };
}

interface HookRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runHook(event: string, bridgePath: string, input: unknown, env = hookEnv()): HookRun {
  const r = Bun.spawnSync([process.execPath, HOOK, event, "--bridge", bridgePath], {
    env,
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

// An open attempt with its bridge files written and its packet path set.
function prepared() {
  const { item } = f.inbox.submit(f.actionable());
  const { attempt } = at.open(item.id, 1);
  const gen = at.claim(attempt.id, "w1", 60_000)!;
  const packetPath = join(f.home, "attempts", attempt.id, "packet.md");
  at.setPacketPath(attempt.id, gen, packetPath);
  const row = at.row(attempt.id);
  const files = writeBridgeSettings({ home: f.home, attemptId: row.id, capability: row.capability });
  const prompt = buildOpeningPrompt(row.id, packetPath, row.packet_sha256);
  const base = { session_id: row.session_uuid, cwd: f.dir, hook_event_name: "x", transcript_path: "C:\\t.jsonl" };
  return { row, gen, files, prompt, base };
}

function marker(row: ReturnType<Attempts["row"]>, o: Record<string, unknown> = {}) {
  const body = { attempt_id: row.id, item_id: row.item_id, content_revision: row.content_revision, packet_sha256: row.packet_sha256, challenge: row.challenge, ...o };
  return `Seven records were rejected; nothing done yet. I will wait for your direction.\n\n${READY_MARKER} ${JSON.stringify(body)}`;
}

function noSecrets(r: HookRun, row: ReturnType<Attempts["row"]>) {
  for (const s of [row.capability, row.challenge]) {
    expect(r.stdout).not.toContain(s);
    expect(r.stderr).not.toContain(s);
  }
}

describe("settings file", () => {
  test("three hooks in exec form, scoped by the attempt's bridge file, with a bounded timeout", () => {
    const { row, files } = prepared();
    expect(files).toEqual(bridgeFiles(f.home, row.id));
    const s = JSON.parse(readFileSync(files.settingsPath, "utf8"));
    expect(Object.keys(s)).toEqual(["hooks"]);
    expect(Object.keys(s.hooks)).toEqual(["SessionStart", "UserPromptSubmit", "Stop"]);
    for (const [event, name] of [["SessionStart", "session-start"], ["UserPromptSubmit", "prompt"], ["Stop", "stop"]] as const) {
      const [group] = s.hooks[event];
      expect(group.matcher).toBeUndefined();
      expect(group.hooks).toEqual([{ type: "command", command: process.execPath, args: [HOOK, name, "--bridge", files.bridgePath], timeout: HOOK_TIMEOUT_SECONDS }]);
    }
    expect(JSON.parse(readFileSync(files.bridgePath, "utf8"))).toEqual({ home: f.home, attempt_id: row.id, capability: row.capability });
    // The capability lives only in the bridge file, never in the settings file Claude shows in /hooks.
    expect(readFileSync(files.settingsPath, "utf8")).not.toContain(row.capability);
  });
});

describe("SessionStart", () => {
  test("binds the real session, cwd and config dir, silently", () => {
    const { row, files, base } = prepared();
    const r = runHook("session-start", files.bridgePath, { ...base, source: "startup" });
    expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(at.get(row.id).evidence.bound).toBe(true);
  });

  test("a wrong config dir or an auth variable blocks the attempt, and the packet is never accepted", () => {
    for (const env of [hookEnv({ CLAUDE_CONFIG_DIR: "C:\\Users\\me\\.claude-personal" }), hookEnv({ ANTHROPIC_API_KEY: "sk-test-not-real" })]) {
      const { row, files, base, prompt, gen } = prepared();
      const r = runHook("session-start", files.bridgePath, { ...base, source: "startup" }, env);
      expect(r.code).toBe(0);
      expect(r.stdout + r.stderr).not.toContain("sk-test-not-real");
      expect(at.get(row.id)).toMatchObject({ status: "blocked", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" }, evidence: { bound: false } });
      at.resume(row.id, gen);
      at.beginOp(row.id, gen, "dispatch_prompt");
      expect(runHook("prompt", files.bridgePath, { ...base, prompt }).code).toBe(2);
      f.inbox.close();
      f = fixture();
      writeFileSync(profilesPath(f.home), JSON.stringify({ profiles: { work: { label: "Work", agent: "claude-code", claude_config_dir: WORK_DIR } } }));
      at = new Attempts(f.inbox);
    }
  });

  test("a different session id (e.g. after /clear) blocks the attempt", () => {
    const { row, files, base } = prepared();
    runHook("session-start", files.bridgePath, { ...base, source: "startup" });
    runHook("session-start", files.bridgePath, { ...base, session_id: "0d9f0000-0000-4000-8000-000000000000", source: "clear" });
    expect(at.get(row.id)).toMatchObject({ status: "blocked", error: { code: "RECEIPT_INVALID" } });
  });
});

describe("UserPromptSubmit", () => {
  test("accepts the opening prompt once, silently; blocks a duplicate", () => {
    const { row, files, base, prompt, gen } = prepared();
    runHook("session-start", files.bridgePath, { ...base, source: "startup" });
    at.beginOp(row.id, gen, "dispatch_prompt");
    expect(runHook("prompt", files.bridgePath, { ...base, prompt })).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(at.get(row.id).evidence.prompt_state).toBe("accepted");
    const dup = runHook("prompt", files.bridgePath, { ...base, prompt });
    expect(dup.code).toBe(2);
    expect(dup.stderr).toContain("ALREADY_ACCEPTED");
    noSecrets(dup, row);
  });

  test("ordinary prompts pass untouched, before and after delivery", () => {
    const { row, files, base } = prepared();
    expect(runHook("prompt", files.bridgePath, { ...base, prompt: "what changed in the login flow?" })).toEqual({ code: 0, stdout: "", stderr: "" });
    at.abandon(row.id);
    expect(runHook("prompt", files.bridgePath, { ...base, prompt: "and now?" })).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("a protocol prompt that fails validation is blocked: no dispatch, wrong attempt, closed attempt", () => {
    const { row, files, base, prompt } = prepared();
    runHook("session-start", files.bridgePath, { ...base, source: "startup" });
    const noDispatch = runHook("prompt", files.bridgePath, { ...base, prompt });
    expect(noDispatch.code).toBe(2);
    const foreign = runHook("prompt", files.bridgePath, { ...base, prompt: prompt.replace(row.id, "att_other") });
    expect(foreign).toMatchObject({ code: 2 });
    expect(foreign.stderr).toContain("WRONG_ATTEMPT");
    at.abandon(row.id);
    expect(runHook("prompt", files.bridgePath, { ...base, prompt }).code).toBe(2);
    noSecrets(noDispatch, row);
  });

  test("when the store or bridge file is unusable, protocol prompts are blocked and others pass", () => {
    const { files, base, prompt } = prepared();
    writeFileSync(files.bridgePath, "{ broken");
    expect(runHook("prompt", files.bridgePath, { ...base, prompt }).code).toBe(2);
    expect(runHook("prompt", files.bridgePath, { ...base, prompt: "hello" })).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(runHook("prompt", join(f.dir, "missing.json"), { ...base, prompt }).code).toBe(2);
  });

  test("a home that no longer exists is left alone: no store is created", () => {
    const { files, base, prompt, row } = prepared();
    const gone = join(f.dir, "gone-home");
    writeFileSync(files.bridgePath, JSON.stringify({ home: gone, attempt_id: row.id, capability: row.capability }));
    expect(runHook("prompt", files.bridgePath, { ...base, prompt: "hello" })).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(runHook("stop", files.bridgePath, { ...base, last_assistant_message: marker(row) }).code).toBe(0);
    const blocked = runHook("prompt", files.bridgePath, { ...base, prompt });
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain("STORE_ERROR");
    expect(existsSync(gone)).toBe(false);
  });

  test("a blocked attempt refuses its opening prompt", () => {
    const { row, gen, files, base, prompt } = prepared();
    runHook("session-start", files.bridgePath, { ...base, source: "startup" });
    at.beginOp(row.id, gen, "dispatch_prompt");
    at.block(row.id, gen, "AGENT_BLOCKED", "waiting for the owner");
    const r = runHook("prompt", files.bridgePath, { ...base, prompt });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("ATTEMPT_BLOCKED");
    expect(at.get(row.id).evidence.prompt_state).not.toBe("accepted");
  });

  test("an unknown attempt id blocks only protocol prompts", () => {
    const { files, base, prompt, row } = prepared();
    writeFileSync(files.bridgePath, JSON.stringify({ home: f.home, attempt_id: "att_gone", capability: row.capability }));
    expect(runHook("prompt", files.bridgePath, { ...base, prompt: "hello" }).code).toBe(0);
    expect(runHook("prompt", files.bridgePath, { ...base, prompt }).code).toBe(2);
  });

  test("a prompt hook that cannot read its input in time blocks it rather than guess", async () => {
    const { files, prompt } = prepared();
    for (const p of [prompt, "hello"]) {
      const proc = Bun.spawn([process.execPath, HOOK, "prompt", "--bridge", files.bridgePath], {
        env: hookEnv({ AGENT_INBOX_HOOK_DEADLINE_MS: "300" }),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      // A partial input with stdin never closed: reading never finishes.
      proc.stdin.write(JSON.stringify({ prompt: p }).slice(0, -1));
      proc.stdin.flush();
      const started = Date.now();
      const killer = setTimeout(() => proc.kill(), 8000);
      const exitCode = await proc.exited;
      clearTimeout(killer);
      expect(Date.now() - started).toBeLessThan(8000);
      expect(exitCode).toBe(2);
      expect(await new Response(proc.stderr).text()).toContain("timed out");
    }
  });

  test("a stalled Stop or SessionStart hook exits 0 at the deadline", async () => {
    const { files } = prepared();
    for (const event of ["stop", "session-start"]) {
      const proc = Bun.spawn([process.execPath, HOOK, event, "--bridge", files.bridgePath], {
        env: hookEnv({ AGENT_INBOX_HOOK_DEADLINE_MS: "300" }),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write("{");
      proc.stdin.flush();
      const killer = setTimeout(() => proc.kill(), 8000);
      expect(await proc.exited).toBe(0);
      clearTimeout(killer);
    }
  });
});

describe("Stop", () => {
  function accepted() {
    const p = prepared();
    runHook("session-start", p.files.bridgePath, { ...p.base, source: "startup" });
    at.beginOp(p.row.id, p.gen, "dispatch_prompt");
    runHook("prompt", p.files.bridgePath, { ...p.base, prompt: p.prompt });
    return p;
  }

  test("a valid INBOX_READY_V1 marker in the main session's last message records a candidate, silently", () => {
    const { row, files, base } = accepted();
    const r = runHook("stop", files.bridgePath, { ...base, stop_hook_active: false, last_assistant_message: marker(row) });
    expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(at.get(row.id).evidence.receipt_candidate).toBe(true);
  });

  test("a wrong challenge, another session or no marker records nothing and never blocks Stop", () => {
    const { row, files, base } = accepted();
    for (const input of [
      { ...base, last_assistant_message: marker(row, { challenge: "guess" }) },
      { ...base, session_id: "0d9f0000-0000-4000-8000-000000000000", last_assistant_message: marker(row) },
      { ...base, last_assistant_message: "Still reading the packet." },
      { ...base },
    ]) {
      const r = runHook("stop", files.bridgePath, input);
      expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
    }
    expect(at.get(row.id).evidence.receipt_candidate).toBe(false);
  });

  test("a busy store blocks the opening prompt quickly and keeps a Stop marker for reconcile", () => {
    const { row, files, base, prompt } = accepted();
    const pending = join(files.dir, RECEIPT_PENDING_FILE);
    f.inbox.db.run("BEGIN IMMEDIATE");
    let busyPrompt: HookRun;
    let stop: HookRun;
    const started = Date.now();
    try {
      busyPrompt = runHook("prompt", files.bridgePath, { ...base, prompt });
      stop = runHook("stop", files.bridgePath, { ...base, last_assistant_message: marker(row) });
    } finally {
      f.inbox.db.run("ROLLBACK");
    }
    expect(Date.now() - started).toBeLessThan(14_000);
    expect(busyPrompt.code).toBe(2);
    expect(busyPrompt.stderr).toContain("STORE_BUSY");
    expect(stop).toEqual({ code: 0, stdout: "", stderr: "" });
    const saved = JSON.parse(readFileSync(pending, "utf8"));
    expect(saved).toMatchObject({ attempt_id: row.id, session_id: row.session_uuid });
    expect(JSON.stringify(saved)).not.toContain(row.capability);
    expect(at.get(row.id).evidence.receipt_candidate).toBe(false);
    // What reconcile will do with it: the saved reply replays into a valid candidate.
    expect(at.captureReceipt(row.id, row.capability, saved.session_id, saved.last_assistant_message)).toEqual({ ok: true });
    expect(at.get(row.id).evidence.receipt_candidate).toBe(true);
  }, 30_000);
});

describe("helpers", () => {
  test("auth env names: names only, case-insensitive, empty values ignored", () => {
    expect(authEnvNames({ ANTHROPIC_API_KEY: "x", anthropic_base_url: "y", ANTHROPIC_MODEL: "z", CLAUDE_CODE_OAUTH_TOKEN: "" })).toEqual(["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]);
    expect(authEnvNames({ ANTHROPIC_CUSTOM_HEADERS: "x-api-key: k" })).toEqual(["ANTHROPIC_CUSTOM_HEADERS"]);
  });

  test("protocol detection is by prefix only", () => {
    expect(looksLikeProtocol("  [agent-inbox att_x] Read")).toBe(true);
    expect(looksLikeProtocol("please read [agent-inbox att_x]")).toBe(false);
  });
});
