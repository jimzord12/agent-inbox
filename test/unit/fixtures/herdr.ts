// Herdr 0.9.5 (protocol 22) answers, one JSON line each. "Recorded" lines were captured from
// the real CLI on 2026-10-22 in a throwaway workspace (only the cwd prefix was shortened);
// "schema" lines are built from `herdr api schema --json`. The agent answers at the end were
// recorded by INB-007 from real Claude launches in a throwaway workspace (paths shortened).

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




// Recorded.
export const serverNotRunning = JSON.stringify({
  id: "cli:workspace:list",
  error: { code: "server_not_running", message: "no herdr server is running at C:\\nope\\x.sock; run `herdr` to start or attach it" },
});

// Recorded (agent start in a trusted fixture folder, no extra args).
export const agentStart = JSON.stringify({"id": "cli:agent:start", "result": {"agent": {"agent": "claude", "agent_session": {"agent": "claude", "kind": "id", "source": "herdr:claude", "value": "6d4ac172-b7a7-443c-8520-a5ec79c5a38f"}, "agent_status": "idle", "cwd": "C:\\fixtures\\fixture dir é", "focused": false, "interactive_ready": true, "name": "inb007-rec-ok", "pane_id": "w9:p5", "revision": 3, "state_change_seq": 247, "tab_id": "w9:t5", "terminal_id": "term_65e6bcd3ce44a15", "terminal_title": "✳ Claude Code", "terminal_title_stripped": "Claude Code", "workspace_id": "w9"}, "argv": ["claude"], "type": "agent_started"}});

// Recorded (agent start in an untrusted folder: Claude waits on the trust dialog).
export const agentStartNotReady = JSON.stringify({"error": {"code": "agent_not_ready", "message": "agent inb007-rec-notready is blocked during startup and is not ready for prompts"}, "id": "cli:agent:start"});

// Recorded (agent prompt; that prompt was refused by the bridge hook, so the agent stayed idle).
export const agentPrompt = JSON.stringify({"id": "cli:agent:prompt", "result": {"agent": {"agent": "claude", "agent_session": {"agent": "claude", "kind": "id", "source": "herdr:claude", "value": "806360f1-0bd1-426e-9831-b6e51fbcc6fa"}, "agent_status": "idle", "completion_seq": 246, "cwd": "C:\\fixtures\\fixture dir é", "focused": true, "interactive_ready": true, "name": "inbox-b80d40295490", "pane_id": "w9:p4", "revision": 4, "state_change_seq": 246, "tab_id": "w9:t4", "terminal_id": "term_65e6bcb44d49814", "terminal_title": "✳ Agent-inbox handoff packet", "terminal_title_stripped": "Agent-inbox handoff packet", "workspace_id": "w9"}, "type": "agent_prompted"}});

// Recorded: focus answers the focused agent, not {type: ok}.
export const agentFocus = JSON.stringify({"id": "cli:agent:focus", "result": {"agent": {"agent": "claude", "agent_session": {"agent": "claude", "kind": "id", "source": "herdr:claude", "value": "806360f1-0bd1-426e-9831-b6e51fbcc6fa"}, "agent_status": "idle", "completion_seq": 246, "cwd": "C:\\fixtures\\fixture dir é", "focused": true, "interactive_ready": true, "name": "inbox-b80d40295490", "pane_id": "w9:p4", "revision": 4, "state_change_seq": 246, "tab_id": "w9:t4", "terminal_id": "term_65e6bcb44d49814", "terminal_title": "✳ Agent-inbox handoff packet", "terminal_title_stripped": "Agent-inbox handoff packet", "workspace_id": "w9"}, "type": "agent_info"}});

// Recorded (agent list, filtered to the test workspace).
export const agentList = JSON.stringify({"id": "cli:agent:list", "result": {"agents": [{"agent": "claude", "agent_session": {"agent": "claude", "kind": "id", "source": "herdr:claude", "value": "0460fef5-ce6b-46d1-80c4-295be96de9ff"}, "agent_status": "idle", "completion_seq": 242, "cwd": "C:\\fixtures\\fixture dir é", "focused": false, "interactive_ready": true, "name": "inbox-17abde601dae", "pane_id": "w9:p2", "revision": 4, "state_change_seq": 242, "tab_id": "w9:t2", "terminal_id": "term_65e6bc1c40eba12", "terminal_title": "✳ Agent-inbox handoff packet", "terminal_title_stripped": "Agent-inbox handoff packet", "workspace_id": "w9"}, {"agent": "claude", "agent_session": {"agent": "claude", "kind": "id", "source": "herdr:claude", "value": "806360f1-0bd1-426e-9831-b6e51fbcc6fa"}, "agent_status": "idle", "completion_seq": 246, "cwd": "C:\\fixtures\\fixture dir é", "focused": true, "interactive_ready": true, "name": "inbox-b80d40295490", "pane_id": "w9:p4", "revision": 4, "state_change_seq": 246, "tab_id": "w9:t4", "terminal_id": "term_65e6bcb44d49814", "terminal_title": "✳ Agent-inbox handoff packet", "terminal_title_stripped": "Agent-inbox handoff packet", "workspace_id": "w9"}], "type": "agent_list"}});
