// Herdr adapter: argv calls to the `herdr` CLI against one explicitly selected server
// (spec §10). Never targets the focused pane, a title or a label; only returned IDs and
// the attempt's own agent alias.

export interface AgentInfo {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_id: string;
  name?: string | null;
  agent?: string | null;
  agent_status: "idle" | "working" | "blocked" | "done" | "unknown";
  agent_session?: { source: string; agent: string; kind: string; value: string } | null;
  cwd?: string | null;
  focused: boolean;
  interactive_ready?: boolean;
  completion_seq?: number | null;
  state_change_seq?: number;
}

export interface PaneInfo {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_id: string;
  cwd?: string | null;
  agent?: string | null;
  agent_status: AgentInfo["agent_status"];
  agent_session?: AgentInfo["agent_session"];
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  label: string;
  pane_count: number;
}

export interface WorkspaceInfo {
  workspace_id: string;
  label: string;
}

// Failure of a Herdr call. `outcome` says whether the side effect may have happened:
// `rejected` = nothing was done (a read failed, or Herdr refused before acting);
// `unknown` = it may have happened (timeout, no usable answer, or an error after acting).
// `code` keeps Herdr's own code, e.g. `agent_not_ready` for a startup blocked on a dialog.
export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: "rejected" | "unknown",
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

export interface HerdrTarget {
  // Socket of the configured server/session. Passed explicitly on every call.
  socketPath: string;
  bin?: string;
}

export type Runner = (argv: string[], env: Record<string, string>, timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

const defaultRunner: Runner = async (argv, env, timeoutMs) => {
  const p = Bun.spawn(argv, { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    p.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
};

// Error codes Herdr raises before a mutating call has any effect. Every other error answer to
// a mutating call is `unknown`: `agent start` can answer `agent_not_ready` (Claude is up but
// blocked, e.g. on a trust dialog), `agent_kind_mismatch` or `timeout` after launching, and a
// prompt can fail after input was typed. Read calls have no effect, so their errors are rejected.
// `server_unavailable` is not here: the server sends it while shutting down or when a dispatched
// command lost its reply. `agent_name_not_found` is not here either: on `agent start` it means
// the new name was bound and then lost its terminal. Both may follow an effect.
const PRE_EFFECT_CODES = new Set([
  "server_not_running",
  "workspace_not_found",
  "tab_not_found",
  "pane_not_found",
  "agent_pane_not_found",
  "target_pane_not_found",
  "agent_not_found",
  "agent_blocked",
  "agent_name_taken",
  "agent_pane_unavailable",
  "agent_target_ambiguous",
]);

const START_AFTER_EFFECT = new Set(["agent_not_found", "workspace_not_found", "tab_not_found", "pane_not_found", "agent_pane_not_found", "target_pane_not_found"]);

function preEffect(code: string): boolean {
  return PRE_EFFECT_CODES.has(code) || code.startsWith("invalid_");
}

// Herdr 0.9.5 writes a success envelope to stdout and an error envelope to stderr, each one
// JSON object on the last line. Undefined when neither stream holds one.
function parseEnvelope<T>(stdout: string, stderr: string): { result?: T; error?: { code: string; message: string } } | undefined {
  for (const text of [stdout, stderr]) {
    const line = text.trim().split("\n").pop()?.trim();
    if (!line) continue;
    try {
      const body = JSON.parse(line);
      if (body && typeof body === "object" && ("result" in body || "error" in body)) return body;
    } catch {
      // not JSON; try the other stream
    }
  }
  return undefined;
}

// Herdr variables inherited from a pane the caller happens to run in. Dropped so nothing
// implicitly targets "the current pane/tab/workspace".
// HERDR_SESSION and HERDR_CLIENT_SOCKET_PATH are dropped too, so the socket is the only selector.
const INHERITED_HERDR = ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_ENV", "HERDR_SESSION", "HERDR_CLIENT_SOCKET_PATH"];

export class Herdr {
  constructor(
    readonly target: HerdrTarget,
    private readonly runner: Runner = defaultRunner,
  ) {}

  private env(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !INHERITED_HERDR.includes(k) && !k.startsWith("HERDR_ACTIVE_")) env[k] = v;
    }
    env.HERDR_SOCKET_PATH = this.target.socketPath;
    return env;
  }

  // `mutating` marks calls with a side effect; see PRE_EFFECT_CODES for how their errors are read.
  async call<T>(args: string[], timeoutMs = 15_000, mutating = false): Promise<T> {
    const bin = this.target.bin ?? "herdr";
    let r: Awaited<ReturnType<Runner>>;
    try {
      r = await this.runner([bin, ...args], this.env(), timeoutMs);
    } catch (err) {
      throw new HerdrError("herdr_unavailable", `Cannot run herdr: ${(err as Error).message}`, "rejected");
    }
    if (r.timedOut) throw new HerdrError("timeout", `herdr ${args[0]} ${args[1] ?? ""} timed out`, "unknown");
    const body = parseEnvelope<T>(r.stdout, r.stderr);
    if (body?.error) {
      const code = String(body.error.code);
      throw new HerdrError(code, String(body.error.message), !mutating || preEffect(code) ? "rejected" : "unknown");
    }
    if (!body || body.result === undefined) {
      throw new HerdrError("bad_response", `herdr gave no usable answer (exit ${r.code}): ${r.stderr.trim().slice(0, 300)}`, "unknown");
    }
    return body.result;
  }

  async workspace(workspaceId: string): Promise<WorkspaceInfo | null> {
    try {
      return (await this.call<{ workspace: WorkspaceInfo }>(["workspace", "get", workspaceId])).workspace;
    } catch (err) {
      if (err instanceof HerdrError && /not_found/.test(err.code)) return null;
      throw err;
    }
  }

  // The inbox-owned workspace (spec §10.2): reuse the configured id while it exists and still
  // carries the inbox label, otherwise create a fresh one. A label never selects a workspace;
  // a different label only proves the id now belongs to someone else's workspace.
  async ensureWorkspace(o: {
    workspaceId?: string | null;
    label: string;
    cwd: string;
  }): Promise<{ workspace: WorkspaceInfo; created: boolean; replaced: string | null }> {
    let replaced: string | null = null;
    if (o.workspaceId) {
      const existing = await this.workspace(o.workspaceId);
      if (existing && existing.label === o.label) return { workspace: existing, created: false, replaced };
      if (existing) replaced = o.workspaceId;
    }
    return { workspace: (await this.createWorkspace(o.label, o.cwd)).workspace, created: true, replaced };
  }

  async workspaces(): Promise<WorkspaceInfo[]> {
    return (await this.call<{ workspaces: WorkspaceInfo[] }>(["workspace", "list"])).workspaces;
  }

  async createWorkspace(label: string, cwd: string): Promise<{ workspace: WorkspaceInfo; tab: TabInfo; root_pane: PaneInfo }> {
    return this.call(["workspace", "create", "--label", label, "--cwd", cwd, "--no-focus"], undefined, true);
  }

  async tabs(workspaceId: string): Promise<TabInfo[]> {
    return (await this.call<{ tabs: TabInfo[] }>(["tab", "list", "--workspace", workspaceId])).tabs;
  }

  async createTab(o: { workspaceId: string; cwd: string; label: string; env: Record<string, string> }): Promise<{ tab: TabInfo; root_pane: PaneInfo }> {
    const args = ["tab", "create", "--workspace", o.workspaceId, "--cwd", o.cwd, "--label", o.label, "--no-focus"];
    for (const [k, v] of Object.entries(o.env)) args.push("--env", `${k}=${v}`);
    return this.call(args, undefined, true);
  }

  async tab(tabId: string): Promise<TabInfo | null> {
    try {
      return (await this.call<{ tab: TabInfo }>(["tab", "get", tabId])).tab;
    } catch (err) {
      if (err instanceof HerdrError && /not_found/.test(err.code)) return null;
      throw err;
    }
  }

  // On `agent start`, a pane, tab, workspace or agent that is "not found" may have gone away
  // after Claude was launched in it, so those answers are unknown, not refusals.
  async startAgent(o: { name: string; paneId: string; args: string[]; timeoutMs: number }): Promise<{ agent: AgentInfo; argv: string[] }> {
    try {
      return await this.call(
        ["agent", "start", o.name, "--kind", "claude", "--pane", o.paneId, "--timeout", String(o.timeoutMs), "--", ...o.args],
        o.timeoutMs + 10_000,
        true,
      );
    } catch (err) {
      if (err instanceof HerdrError && err.outcome === "rejected" && START_AFTER_EFFECT.has(err.code)) {
        throw new HerdrError(err.code, err.message, "unknown");
      }
      throw err;
    }
  }

  // Null only when no agent has the name. `agent_name_not_found` (the name no longer owns its
  // terminal: the occupant changed) is thrown, since it does not prove the session closed.
  async agent(target: string): Promise<AgentInfo | null> {
    try {
      return (await this.call<{ agent: AgentInfo }>(["agent", "get", target])).agent;
    } catch (err) {
      if (err instanceof HerdrError && err.code === "agent_not_found") return null;
      throw err;
    }
  }

  async agents(): Promise<AgentInfo[]> {
    return (await this.call<{ agents: AgentInfo[] }>(["agent", "list"])).agents;
  }

  // Submits without --wait (so `agent_prompt_stalled` cannot occur): acceptance is proven by
  // the bridge, not by Herdr's wait (spec §10.1).
  async prompt(target: string, text: string): Promise<AgentInfo> {
    return (await this.call<{ agent: AgentInfo }>(["agent", "prompt", target, text], 20_000, true)).agent;
  }

  async focus(target: string): Promise<void> {
    await this.call(["agent", "focus", target], undefined, true);
  }
}
