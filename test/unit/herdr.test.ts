import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Herdr, HerdrError, type Runner } from "../../src/herdr/adapter";
import * as rec from "./fixtures/herdr";

const SOCKET = "C:\\Users\\someone\\AppData\\Roaming\\herdr\\herdr.sock";

interface Call {
  argv: string[];
  env: Record<string, string>;
  timeoutMs: number;
}

// A fake herdr: answers each call with the next queued reply, the way the real CLI does
// (success JSON on stdout with exit 0, error JSON on stderr with exit 1).
function fake(...replies: Array<string | { stdout?: string; stderr?: string; code?: number | null; timedOut?: boolean }>) {
  const calls: Call[] = [];
  const runner: Runner = async (argv, env, timeoutMs) => {
    calls.push({ argv, env, timeoutMs });
    const r = replies.shift();
    if (r === undefined) throw new Error("unexpected herdr call");
    if (typeof r === "string") {
      const isError = "error" in JSON.parse(r);
      return isError ? { code: 1, stdout: "", stderr: `${r}\n`, timedOut: false } : { code: 0, stdout: `${r}\n`, stderr: "", timedOut: false };
    }
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: r.timedOut ?? false };
  };
  return { herdr: new Herdr({ socketPath: SOCKET }, runner), calls };
}

async function failure(p: Promise<unknown>): Promise<HerdrError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HerdrError) return err;
    throw err;
  }
  throw new Error("expected a HerdrError");
}

describe("server selection and inherited environment", () => {
  const saved: Record<string, string | undefined> = {};
  const inherited = {
    HERDR_PANE_ID: "w4:p5",
    HERDR_TAB_ID: "w4:t4",
    HERDR_WORKSPACE_ID: "w4",
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: "C:\\other.sock",
    HERDR_SESSION: "other",
    HERDR_CLIENT_SOCKET_PATH: "C:\\client.sock",
    HERDR_ACTIVE_PANE_ID: "w4:p1",
  };
  beforeEach(() => {
    for (const [k, v] of Object.entries(inherited)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterEach(() => {
    for (const k of Object.keys(inherited)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("every call names the configured socket and drops the caller's pane, tab and workspace", async () => {
    const { herdr, calls } = fake(rec.agentGet, rec.tabGet, rec.ok("agent:focus"));
    await herdr.agent("inbox-a1b2c3");
    await herdr.tab("w7:t2");
    await herdr.focus("inbox-a1b2c3");
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.env.HERDR_SOCKET_PATH).toBe(SOCKET);
      for (const k of ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_ENV", "HERDR_SESSION", "HERDR_CLIENT_SOCKET_PATH", "HERDR_ACTIVE_PANE_ID"]) {
        expect(c.env[k]).toBeUndefined();
      }
      expect(c.env.PATH ?? c.env.Path).toBeDefined();
    }
  });
});

describe("outcomes", () => {
  test("an error answer on stderr is rejected and keeps Herdr's code", async () => {
    const { herdr } = fake(rec.serverNotRunning);
    const e = await failure(herdr.workspaces());
    expect(e).toMatchObject({ code: "server_not_running", outcome: "rejected" });
  });

  test("a timeout is unknown", async () => {
    const { herdr } = fake({ code: null, timedOut: true });
    expect(await failure(herdr.prompt("inbox-a1b2c3", "hi"))).toMatchObject({ code: "timeout", outcome: "unknown" });
  });

  test("Herdr's own timeout or stalled-prompt answer is unknown, not rejected", async () => {
    const timeout = JSON.stringify({ id: "cli:agent:start", error: { code: "timeout", message: "agent not ready" } });
    const stalled = JSON.stringify({ id: "cli:agent:prompt", error: { code: "agent_prompt_stalled", message: "no working state" } });
    const { herdr } = fake(timeout, stalled);
    expect((await failure(herdr.startAgent({ name: "inbox-a1b2c3", paneId: "w7:p2", args: [], timeoutMs: 1000 }))).outcome).toBe("unknown");
    expect((await failure(herdr.prompt("inbox-a1b2c3", "hi"))).outcome).toBe("unknown");
  });

  test("unreadable answers are unknown whatever the exit code", async () => {
    const { herdr } = fake({ stdout: "panic: oops", code: 0 }, { stderr: "thread main panicked", code: 101 }, { stdout: '{"id":"x"}', code: 0 }, { code: 1 });
    for (let i = 0; i < 4; i++) expect(await failure(herdr.agents())).toMatchObject({ code: "bad_response", outcome: "unknown" });
  });

  test("not-found answers become null for reads", async () => {
    const { herdr } = fake(rec.agentNotFound, rec.tabNotFound, rec.workspaceNotFound);
    expect(await herdr.agent("inbox-zzz")).toBeNull();
    expect(await herdr.tab("w7:nosuch")).toBeNull();
    expect(await herdr.workspace("w7")).toBeNull();
  });

  test("other errors on reads still throw", async () => {
    const { herdr } = fake(rec.serverNotRunning);
    expect((await failure(herdr.agent("inbox-a1b2c3"))).code).toBe("server_not_running");
  });
});

describe("calls and recorded answers", () => {
  test("ensureWorkspace reuses the configured workspace", async () => {
    const { herdr, calls } = fake(rec.workspaceGet);
    const r = await herdr.ensureWorkspace({ workspaceId: "w7", label: "inbox-adapter-fixture", cwd: "C:\\x" });
    expect(r).toMatchObject({ created: false, workspace: { workspace_id: "w7" } });
    expect(calls[0]?.argv.slice(1)).toEqual(["workspace", "get", "w7"]);
  });

  test("ensureWorkspace creates one when the configured id is gone or unset, never by label", async () => {
    const { herdr, calls } = fake(rec.workspaceNotFound, rec.workspaceCreate, rec.workspaceCreate);
    expect(await herdr.ensureWorkspace({ workspaceId: "w3", label: "Agent Inbox", cwd: "C:\\inbox home" })).toMatchObject({ created: true, workspace: { workspace_id: "w7" } });
    expect(await herdr.ensureWorkspace({ label: "Agent Inbox", cwd: "C:\\inbox home" })).toMatchObject({ created: true });
    expect(calls.map((c) => c.argv.slice(1, 3))).toEqual([["workspace", "get"], ["workspace", "create"], ["workspace", "create"]]);
    expect(calls[1]?.argv.slice(1)).toEqual(["workspace", "create", "--label", "Agent Inbox", "--cwd", "C:\\inbox home", "--no-focus"]);
  });

  test("tab create passes workspace, cwd, label, env pairs and no focus; returns the root pane", async () => {
    const { herdr, calls } = fake(rec.tabCreate);
    const r = await herdr.createTab({ workspaceId: "w7", cwd: "C:\\fixtures\\fixture dir é", label: "work · Fix login · a1b2", env: { CLAUDE_CONFIG_DIR: "C:\\Users\\someone\\.claude work", AGENT_INBOX_HOME: "C:\\inbox" } });
    expect(calls[0]?.argv.slice(1)).toEqual([
      "tab", "create", "--workspace", "w7", "--cwd", "C:\\fixtures\\fixture dir é", "--label", "work · Fix login · a1b2", "--no-focus",
      "--env", "CLAUDE_CONFIG_DIR=C:\\Users\\someone\\.claude work", "--env", "AGENT_INBOX_HOME=C:\\inbox",
    ]);
    expect(r.tab.tab_id).toBe("w7:t2");
    expect(r.root_pane).toMatchObject({ pane_id: "w7:p2", tab_id: "w7:t2", workspace_id: "w7" });
  });

  test("tab get and list", async () => {
    const tabList = JSON.stringify({ id: "cli:tab:list", result: { tabs: [JSON.parse(rec.tabGet).result.tab], type: "tab_list" } });
    const { herdr, calls } = fake(rec.tabGet, tabList);
    expect((await herdr.tab("w7:t2"))?.label).toBe("t probe");
    expect((await herdr.tabs("w7")).map((t) => t.tab_id)).toEqual(["w7:t2"]);
    expect(calls.map((c) => c.argv.slice(1))).toEqual([["tab", "get", "w7:t2"], ["tab", "list", "--workspace", "w7"]]);
  });

  test("agent start names the alias and pane, passes extra args after --, waits longer than Herdr", async () => {
    const { herdr, calls } = fake(rec.agentStart);
    const args = ["--session-id", "6f1c2a7e-0d7b-4c35-9a52-1f0e8d3b9c41", "--settings", "C:\\inbox home\\bridge.json"];
    const r = await herdr.startAgent({ name: "inbox-a1b2c3", paneId: "w7:p2", args, timeoutMs: 60_000 });
    expect(calls[0]?.argv.slice(1)).toEqual(["agent", "start", "inbox-a1b2c3", "--kind", "claude", "--pane", "w7:p2", "--timeout", "60000", "--", ...args]);
    expect(calls[0]?.timeoutMs).toBeGreaterThan(60_000);
    expect(r.agent.agent_session?.value).toBe("6f1c2a7e-0d7b-4c35-9a52-1f0e8d3b9c41");
    expect(r.argv).toContain("--settings");
  });

  test("agent get and list return the native session identity", async () => {
    const { herdr, calls } = fake(rec.agentGet, rec.agentList);
    const a = await herdr.agent("inbox-a1b2c3");
    expect(a).toMatchObject({ name: "inbox-a1b2c3", pane_id: "w7:p2", agent_status: "idle", agent_session: { source: "herdr:claude", kind: "id" } });
    expect((await herdr.agents()).map((x) => x.name)).toEqual(["inbox-a1b2c3"]);
    expect(calls.map((c) => c.argv.slice(1))).toEqual([["agent", "get", "inbox-a1b2c3"], ["agent", "list"]]);
  });

  test("prompt targets the alias with the text as one argument and does not wait", async () => {
    const { herdr, calls } = fake(rec.agentPrompt);
    const text = 'Read the handoff "C:\\inbox home\\a b.md" & begin | 100% <now>';
    const r = await herdr.prompt("inbox-a1b2c3", text);
    expect(calls[0]?.argv.slice(1)).toEqual(["agent", "prompt", "inbox-a1b2c3", text]);
    expect(calls[0]?.argv).not.toContain("--wait");
    expect(r.agent_status).toBe("working");
  });

  test("focus targets the given alias only", async () => {
    const { herdr, calls } = fake(rec.ok("agent:focus"));
    await herdr.focus("inbox-a1b2c3");
    expect(calls[0]?.argv.slice(1)).toEqual(["agent", "focus", "inbox-a1b2c3"]);
  });
});

describe("the real process runner", () => {
  // Uses the Bun executable as a stand-in for herdr, so no Herdr server is involved.
  const bun = new Herdr({ socketPath: SOCKET, bin: process.execPath });

  test("a hung process is killed and reported unknown", async () => {
    const started = Date.now();
    const e = await failure(bun.call(["-e", "setTimeout(() => {}, 20000)"], 400));
    expect(e).toMatchObject({ code: "timeout", outcome: "unknown" });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("an error envelope on stderr is read from the real process", async () => {
    const script = `process.stderr.write(${JSON.stringify(rec.tabNotFound + "\n")}); process.exit(1)`;
    expect(await failure(bun.call(["-e", script]))).toMatchObject({ code: "tab_not_found", outcome: "rejected" });
  });

  test("a success envelope on stdout is returned, and the socket reaches the child", async () => {
    const script = `console.log(JSON.stringify({ id: "x", result: { socket: process.env.HERDR_SOCKET_PATH, pane: process.env.HERDR_PANE_ID ?? null } }))`;
    process.env.HERDR_PANE_ID = "w4:p5";
    try {
      expect(await bun.call<{ socket: string; pane: string | null }>(["-e", script])).toEqual({ socket: SOCKET, pane: null });
    } finally {
      delete process.env.HERDR_PANE_ID;
    }
  });

  test("a missing executable is rejected as unavailable", async () => {
    const h = new Herdr({ socketPath: SOCKET, bin: "C:\\nowhere\\herdr-missing.exe" });
    expect(await failure(h.workspaces())).toMatchObject({ code: "herdr_unavailable", outcome: "rejected" });
  });
});

describe("review round 1: errors after a side effect", () => {
  const err = (verb: string, code: string) => JSON.stringify({ id: `cli:${verb}`, error: { code, message: code } });

  test("agent_not_ready after launch is unknown and keeps its code, so the worker can focus the pane", async () => {
    const { herdr } = fake(err("agent:start", "agent_not_ready"));
    const e = await failure(herdr.startAgent({ name: "inbox-a1b2c3", paneId: "w7:p2", args: [], timeoutMs: 1000 }));
    expect(e).toMatchObject({ code: "agent_not_ready", outcome: "unknown" });
  });

  test("an unlisted error on any mutating call is unknown", async () => {
    const tab = { workspaceId: "w7", cwd: "C:\\x", label: "x", env: {} };
    const { herdr } = fake(err("tab:create", "pty_spawn_failed"), err("agent:prompt", "agent_prompt_failed"), err("agent:focus", "x"), err("workspace:create", "y"));
    expect((await failure(herdr.createTab(tab))).outcome).toBe("unknown");
    expect((await failure(herdr.prompt("inbox-a1b2c3", "hi"))).outcome).toBe("unknown");
    expect((await failure(herdr.focus("inbox-a1b2c3"))).outcome).toBe("unknown");
    expect((await failure(herdr.createWorkspace("Agent Inbox", "C:\\x"))).outcome).toBe("unknown");
  });

  test("codes Herdr raises before acting are rejected on mutating calls", async () => {
    const codes = ["agent_blocked", "agent_name_taken", "agent_pane_unavailable", "agent_target_ambiguous", "pane_not_found", "invalid_env", "server_not_running"];
    const { herdr } = fake(...codes.map((c) => err("agent:prompt", c)));
    for (const c of codes) expect(await failure(herdr.prompt("inbox-a1b2c3", "hi"))).toMatchObject({ code: c, outcome: "rejected" });
  });

  test("a name that no longer owns its terminal is not reported as gone", async () => {
    const { herdr } = fake(err("agent:get", "agent_name_not_found"));
    expect((await failure(herdr.agent("inbox-a1b2c3"))).code).toBe("agent_name_not_found");
  });

  test("ensureWorkspace does not reuse an id that now carries another label", async () => {
    const other = JSON.stringify({ id: "cli:workspace:get", result: { type: "workspace_info", workspace: { workspace_id: "w7", label: "my project" } } });
    const { herdr, calls } = fake(other, rec.workspaceCreate);
    const r = await herdr.ensureWorkspace({ workspaceId: "w7", label: "inbox-adapter-fixture", cwd: "C:\\x" });
    expect(r).toMatchObject({ created: true, replaced: "w7" });
    expect(calls[1]?.argv.slice(1, 3)).toEqual(["workspace", "create"]);
  });
});

describe("review round 2: codes that may follow an effect", () => {
  const err = (verb: string, code: string) => JSON.stringify({ id: `cli:${verb}`, error: { code, message: code } });

  test("server_unavailable on a mutating call is unknown; on a read it is rejected", async () => {
    const { herdr } = fake(err("agent:prompt", "server_unavailable"), err("agent:get", "server_unavailable"));
    expect((await failure(herdr.prompt("inbox-a1b2c3", "hi"))).outcome).toBe("unknown");
    expect((await failure(herdr.agent("inbox-a1b2c3"))).outcome).toBe("rejected");
  });

  test("agent_name_not_found on agent start is unknown", async () => {
    const { herdr } = fake(err("agent:start", "agent_name_not_found"));
    const e = await failure(herdr.startAgent({ name: "inbox-a1b2c3", paneId: "w7:p2", args: [], timeoutMs: 1000 }));
    expect(e).toMatchObject({ code: "agent_name_not_found", outcome: "unknown" });
  });

  test("an unknown *_not_found code on a mutating call is unknown", async () => {
    const { herdr } = fake(err("tab:create", "session_not_found"));
    expect((await failure(herdr.createTab({ workspaceId: "w7", cwd: "C:\\x", label: "x", env: {} }))).outcome).toBe("unknown");
  });
});
