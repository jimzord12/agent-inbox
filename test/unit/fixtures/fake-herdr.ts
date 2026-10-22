import { Herdr, type Runner } from "../../../src/herdr/adapter";

// A stateful fake Herdr server for worker tests. It answers the argv calls the adapter makes
// with the envelopes the real CLI uses (success JSON on stdout, error JSON on stderr, exit 1),
// keeps workspaces, tabs and agents, and lets a test play the receipt bridge from inside
// `agent start` and `agent prompt`, the way the real hooks run inside Claude.

export const SOCKET = "C:\\Users\\someone\\AppData\\Roaming\\herdr\\herdr.sock";

export interface FakeAgent {
  name: string;
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  session: string | null;
  agent_status: "idle" | "working" | "blocked" | "done" | "unknown";
  interactive_ready: boolean;
  state_change_seq: number;
}

type Reply = { error: string; outcome?: "after" } | { timeout: true } | undefined;

export interface FakeHooks {
  // After `agent start` registered the agent: play SessionStart. Return a reply to fail the call.
  onStart?(agent: FakeAgent, args: string[]): Reply | void;
  // After `agent prompt` reached the agent: play UserPromptSubmit and Stop.
  onPrompt?(agent: FakeAgent, text: string): Reply | void;
  // Before any call: return a reply to fail it (e.g. `server_not_running`).
  before?(verb: string, args: string[]): Reply | void;
  // On each `agent get`: lets a test change the agent over time.
  onGet?(agent: FakeAgent): void;
}

export class FakeHerdr {
  calls: string[][] = [];
  workspaces = new Map<string, string>();
  tabs: { tab_id: string; workspace_id: string; label: string; env: Record<string, string>; cwd: string }[] = [];
  agents = new Map<string, FakeAgent>();
  focused: string[] = [];
  private n = 0;

  constructor(public hooks: FakeHooks = {}) {}

  verbs(): string[] {
    return this.calls.map((c) => `${c[1]} ${c[2]}`);
  }

  herdr(): Herdr {
    return new Herdr({ socketPath: SOCKET }, this.runner);
  }

  private ok(type: string, result: Record<string, unknown>) {
    return { code: 0, stdout: `${JSON.stringify({ id: `cli:${type}`, result: { type, ...result } })}\n`, stderr: "", timedOut: false };
  }

  private err(code: string) {
    return { code: 1, stdout: "", stderr: `${JSON.stringify({ id: "cli:x", error: { code, message: `fake ${code}` } })}\n`, timedOut: false };
  }

  private reply(r: Reply) {
    if (!r) return null;
    if ("timeout" in r) return { code: null, stdout: "", stderr: "", timedOut: true };
    return this.err(r.error);
  }

  private info(a: FakeAgent) {
    return {
      agent: "claude",
      agent_session: a.session ? { agent: "claude", kind: "id", source: "herdr:claude", value: a.session } : null,
      agent_status: a.agent_status,
      cwd: "C:\\x",
      focused: false,
      interactive_ready: a.interactive_ready,
      name: a.name,
      pane_id: a.pane_id,
      state_change_seq: a.state_change_seq,
      tab_id: a.tab_id,
      terminal_id: `term_${a.pane_id}`,
      workspace_id: a.workspace_id,
    };
  }

  private flag(args: string[], name: string): string {
    return args[args.indexOf(name) + 1] ?? "";
  }

  runner: Runner = async (argv) => {
    this.calls.push(argv);
    const [, noun, verb, ...rest] = argv;
    const key = `${noun} ${verb}`;
    const pre = this.reply(this.hooks.before?.(key, rest) ?? undefined);
    if (pre) return pre;
    switch (key) {
      case "workspace get": {
        const label = this.workspaces.get(rest[0]!);
        return label === undefined ? this.err("workspace_not_found") : this.ok("workspace_info", { workspace: { workspace_id: rest[0], label } });
      }
      case "workspace list":
        return this.ok("workspace_list", { workspaces: [...this.workspaces].map(([workspace_id, label]) => ({ workspace_id, label })) });
      case "workspace create": {
        const id = `w${++this.n}`;
        this.workspaces.set(id, this.flag(rest, "--label"));
        return this.ok("workspace_created", {
          workspace: { workspace_id: id, label: this.flag(rest, "--label") },
          tab: { tab_id: `${id}:t1`, workspace_id: id, label: "1", pane_count: 1 },
          root_pane: { pane_id: `${id}:p1`, tab_id: `${id}:t1`, workspace_id: id, terminal_id: "t", agent_status: "unknown" },
        });
      }
      case "tab create": {
        const ws = this.flag(rest, "--workspace");
        const id = `${ws}:t${++this.n}`;
        const env: Record<string, string> = {};
        rest.forEach((v, i) => {
          if (v === "--env") {
            const kv = rest[i + 1]!;
            env[kv.slice(0, kv.indexOf("="))] = kv.slice(kv.indexOf("=") + 1);
          }
        });
        this.tabs.push({ tab_id: id, workspace_id: ws, label: this.flag(rest, "--label"), env, cwd: this.flag(rest, "--cwd") });
        return this.ok("tab_created", {
          tab: { tab_id: id, workspace_id: ws, label: this.flag(rest, "--label"), pane_count: 1 },
          root_pane: { pane_id: `${id}:p`, tab_id: id, workspace_id: ws, terminal_id: "t", agent_status: "unknown" },
        });
      }
      case "agent start": {
        const name = rest[0]!;
        const pane = this.flag(rest, "--pane");
        const args = rest.slice(rest.indexOf("--") + 1);
        const tab = this.tabs.find((t) => pane.startsWith(t.tab_id))!;
        const a: FakeAgent = {
          name,
          pane_id: pane,
          tab_id: tab.tab_id,
          workspace_id: tab.workspace_id,
          session: args[args.indexOf("--session-id") + 1] ?? null,
          agent_status: "idle",
          interactive_ready: true,
          state_change_seq: 10,
        };
        this.agents.set(name, a);
        const r = this.reply(this.hooks.onStart?.(a, args) ?? undefined);
        return r ?? this.ok("agent_started", { agent: this.info(a), argv: ["claude", ...args] });
      }
      case "agent get": {
        const a = this.agents.get(rest[0]!);
        if (!a) return this.err("agent_not_found");
        this.hooks.onGet?.(a);
        return this.ok("agent_info", { agent: this.info(a) });
      }
      case "agent prompt": {
        const a = this.agents.get(rest[0]!);
        if (!a) return this.err("agent_not_found");
        const r = this.reply(this.hooks.onPrompt?.(a, rest[1]!) ?? undefined);
        return r ?? this.ok("agent_prompted", { agent: { ...this.info(a), agent_status: "working" } });
      }
      case "agent focus":
        if (!this.agents.has(rest[0]!)) return this.err("agent_not_found");
        this.focused.push(rest[0]!);
        return this.ok("ok", {});
      default:
        return this.err("invalid_request");
    }
  };
}
