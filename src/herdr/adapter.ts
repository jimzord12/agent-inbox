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
// `rejected` = Herdr answered with an error (nothing done), `unknown` = no usable answer.
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
  const p = Bun.spawn(argv, { env, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: timeoutMs, killSignal: "SIGKILL" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr, timedOut: p.signalCode === "SIGKILL" };
};

// Herdr variables inherited from a pane the caller happens to run in. Dropped so nothing
// implicitly targets "the current pane/tab/workspace".
const INHERITED_HERDR = ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_ENV"];

export class Herdr {
  constructor(
    readonly target: HerdrTarget,
    private readonly runner: Runner = defaultRunner,
  ) {}

  private env(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !INHERITED_HERDR.includes(k)) env[k] = v;
    env.HERDR_SOCKET_PATH = this.target.socketPath;
    return env;
  }

  async call<T>(args: string[], timeoutMs = 15_000): Promise<T> {
    const bin = this.target.bin ?? "herdr";
    let r: Awaited<ReturnType<Runner>>;
    try {
      r = await this.runner([bin, ...args], this.env(), timeoutMs);
    } catch (err) {
      throw new HerdrError("herdr_unavailable", `Cannot run herdr: ${(err as Error).message}`, "rejected");
    }
    if (r.timedOut) throw new HerdrError("timeout", `herdr ${args[0]} ${args[1] ?? ""} timed out`, "unknown");
    let body: { result?: T; error?: { code: string; message: string } } | undefined;
    try {
      body = JSON.parse(r.stdout.trim().split("\n").pop() ?? "");
    } catch {
      const outcome = r.code === 0 ? "unknown" : "rejected";
      throw new HerdrError("bad_response", `herdr gave no JSON (exit ${r.code}): ${r.stderr.trim().slice(0, 300)}`, outcome);
    }
    if (body?.error) throw new HerdrError(body.error.code, body.error.message, "rejected");
    if (!body || body.result === undefined) throw new HerdrError("bad_response", "herdr response had no result", "unknown");
    return body.result;
  }

  async workspaces(): Promise<WorkspaceInfo[]> {
    return (await this.call<{ workspaces: WorkspaceInfo[] }>(["workspace", "list"])).workspaces;
  }

  async createWorkspace(label: string, cwd: string): Promise<{ workspace: WorkspaceInfo; tab: TabInfo; root_pane: PaneInfo }> {
    return this.call(["workspace", "create", "--label", label, "--cwd", cwd, "--no-focus"]);
  }

  async tabs(workspaceId: string): Promise<TabInfo[]> {
    return (await this.call<{ tabs: TabInfo[] }>(["tab", "list", "--workspace", workspaceId])).tabs;
  }

  async createTab(o: { workspaceId: string; cwd: string; label: string; env: Record<string, string> }): Promise<{ tab: TabInfo; root_pane: PaneInfo }> {
    const args = ["tab", "create", "--workspace", o.workspaceId, "--cwd", o.cwd, "--label", o.label, "--no-focus"];
    for (const [k, v] of Object.entries(o.env)) args.push("--env", `${k}=${v}`);
    return this.call(args);
  }

  async tab(tabId: string): Promise<TabInfo | null> {
    try {
      return (await this.call<{ tab: TabInfo }>(["tab", "get", tabId])).tab;
    } catch (err) {
      if (err instanceof HerdrError && /not_found/.test(err.code)) return null;
      throw err;
    }
  }

  async startAgent(o: { name: string; paneId: string; args: string[]; timeoutMs: number }): Promise<{ agent: AgentInfo; argv: string[] }> {
    return this.call(
      ["agent", "start", o.name, "--kind", "claude", "--pane", o.paneId, "--timeout", String(o.timeoutMs), "--", ...o.args],
      o.timeoutMs + 10_000,
    );
  }

  async agent(target: string): Promise<AgentInfo | null> {
    try {
      return (await this.call<{ agent: AgentInfo }>(["agent", "get", target])).agent;
    } catch (err) {
      if (err instanceof HerdrError && /not_found/.test(err.code)) return null;
      throw err;
    }
  }

  async agents(): Promise<AgentInfo[]> {
    return (await this.call<{ agents: AgentInfo[] }>(["agent", "list"])).agents;
  }

  // Submits without --wait: acceptance is proven by the bridge, not by Herdr's wait (spec §10.1).
  async prompt(target: string, text: string): Promise<AgentInfo> {
    return (await this.call<{ agent: AgentInfo }>(["agent", "prompt", target, text], 20_000)).agent;
  }

  async focus(target: string): Promise<void> {
    await this.call(["agent", "focus", target]);
  }
}
