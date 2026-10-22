// Herdr 0.9.5 (protocol 22) answers, one JSON line each. "Recorded" lines were captured from
// the real CLI on 2026-10-22 in a throwaway workspace (only the cwd prefix was shortened);
// "schema" lines are built from `herdr api schema --json` plus a recorded `agent get`, because
// recording them needs a live Claude launch (INB-007 records the real ones).

const CWD = "C:\\fixtures\\fixture dir é\\";

// Recorded.
export const workspaceCreate = JSON.stringify({
  id: "cli:workspace:create",
  result: {
    root_pane: { agent_status: "unknown", cwd: CWD, focused: false, pane_id: "w7:p1", revision: 0, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 63 }, tab_id: "w7:t1", terminal_id: "term_65e6981a8a816c", workspace_id: "w7" },
    tab: { agent_status: "unknown", focused: false, label: "1", number: 1, pane_count: 1, tab_id: "w7:t1", workspace_id: "w7" },
    type: "workspace_created",
    workspace: { active_tab_id: "w7:t1", agent_status: "unknown", focused: false, label: "inbox-adapter-fixture", number: 3, pane_count: 1, tab_count: 1, workspace_id: "w7" },
  },
});

// Recorded (a second throwaway workspace, w8, renamed to w7 to match the others).
export const workspaceGet = JSON.stringify({
  id: "cli:workspace:get",
  result: { type: "workspace_info", workspace: { active_tab_id: "w7:t1", agent_status: "unknown", focused: false, label: "inbox-adapter-fixture", number: 3, pane_count: 1, tab_count: 1, workspace_id: "w7" } },
});

// Recorded.
export const workspaceNotFound = JSON.stringify({ error: { code: "workspace_not_found", message: "workspace w7 not found" }, id: "cli:workspace:get" });

// Recorded.
export const tabCreate = JSON.stringify({
  id: "cli:tab:create",
  result: {
    root_pane: { agent_status: "unknown", cwd: CWD, focused: false, pane_id: "w7:p2", revision: 0, scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 63 }, tab_id: "w7:t2", terminal_id: "term_65e6981ab2cacd", workspace_id: "w7" },
    tab: { agent_status: "unknown", focused: false, label: "t probe", number: 2, pane_count: 1, tab_id: "w7:t2", workspace_id: "w7" },
    type: "tab_created",
  },
});

// Recorded.
export const tabGet = JSON.stringify({
  id: "cli:tab:get",
  result: { tab: { agent_status: "unknown", focused: false, label: "t probe", number: 2, pane_count: 1, tab_id: "w7:t2", workspace_id: "w7" }, type: "tab_info" },
});

// Recorded.
export const tabNotFound = JSON.stringify({ error: { code: "tab_not_found", message: "tab w7:nosuch not found" }, id: "cli:tab:get" });

// Recorded shape (agent get on a live Claude pane), values replaced.
const agentInfo = {
  agent: "claude",
  agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: "6f1c2a7e-0d7b-4c35-9a52-1f0e8d3b9c41" },
  agent_status: "idle",
  cwd: CWD,
  focused: false,
  interactive_ready: true,
  name: "inbox-a1b2c3",
  pane_id: "w7:p2",
  revision: 4,
  state_change_seq: 153,
  tab_id: "w7:t2",
  terminal_id: "term_65e6981ab2cacd",
  terminal_title: "Claude Code",
  terminal_title_stripped: "Claude Code",
  workspace_id: "w7",
};

export const agentGet = JSON.stringify({ id: "cli:agent:get", result: { agent: agentInfo, type: "agent_info" } });

// Recorded.
export const agentNotFound = JSON.stringify({ error: { code: "agent_not_found", message: "agent target inbox-zzz not found" }, id: "cli:agent:get" });

// Schema.
export const agentList = JSON.stringify({ id: "cli:agent:list", result: { agents: [agentInfo], type: "agent_list" } });

// Schema: agent_started = {agent, argv}.
export const agentStart = JSON.stringify({
  id: "cli:agent:start",
  result: { agent: agentInfo, argv: ["claude", "--session-id", "6f1c2a7e-0d7b-4c35-9a52-1f0e8d3b9c41", "--settings", "C:\\inbox home\\bridge.json"], type: "agent_started" },
});

// Schema.
export const agentPrompt = JSON.stringify({ id: "cli:agent:prompt", result: { agent: { ...agentInfo, agent_status: "working" }, type: "agent_prompted" } });

// Schema: focus answers {type:"ok"} like the recorded workspace close.
export const ok = (verb: string) => JSON.stringify({ id: `cli:${verb}`, result: { type: "ok" } });

// Recorded.
export const serverNotRunning = JSON.stringify({
  id: "cli:workspace:list",
  error: { code: "server_not_running", message: "no herdr server is running at C:\\nope\\x.sock; run `herdr` to start or attach it" },
});
