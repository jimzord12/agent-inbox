import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AttemptRow, type AttemptView, Attempts, type OpName } from "../core/attempts";
import { bridgeFiles, writeBridgeSettings } from "../bridge/settings";
import type { InboxConfig } from "../core/config";
import { InboxError } from "../core/errors";
import type { Inbox } from "../core/inbox";
import { buildOpeningPrompt } from "../core/packet";
import { launchFingerprint, loadProfiles } from "../core/profiles";
import { sha256Hex } from "../core/submission";
import { type AgentInfo, type Herdr, HerdrError } from "../herdr/adapter";

// The per-attempt handoff worker (spec §4.2, §9.1, §10.2). One process per attempt, started
// detached by `agent-inbox open`. It owns the attempt through a lease and walks the phases:
//
//   preflight      cwd, profile and Herdr checked; packet.md and the bridge settings written
//   create_layout  inbox workspace ensured; tab created with CLAUDE_CONFIG_DIR       [op create_tab]
//   start_agent    Claude started with --session-id and --settings under a unique alias [op start_agent]
//                  then Herdr's session id and pane checked, and the bridge binding awaited
//   submit_context the short opening prompt sent through Herdr                     [op dispatch_prompt]
//   await_receipt  bridge acceptance, a receipt candidate, then a new settled Herdr state
//   focus          the verified pane focused, then delivery committed               [op focus]
//
// Every external side effect is recorded as an op before it happens. An op that is already
// recorded is never performed again by this worker; an unclear outcome leaves the attempt
// uncertain or blocked for the user (retry and reconcile are INB-008 / INB-009).

export interface WorkerTiming {
  leaseMs: number;
  pollMs: number;
  // Herdr's own wait for Claude's interactive readiness in `agent start`.
  startTimeoutMs: number;
  // How long a dialog-blocked startup is watched before the worker leaves it to the user.
  blockedWatchMs: number;
  // SessionStart binding and Herdr's session id after a confirmed start.
  bindTimeoutMs: number;
  // Acceptance, acknowledgment and a new settled state after dispatch.
  receiptTimeoutMs: number;
}

export const DEFAULT_TIMING: WorkerTiming = {
  leaseMs: 60_000,
  pollMs: 1_000,
  startTimeoutMs: 60_000,
  blockedWatchMs: 10 * 60_000,
  bindTimeoutMs: 30_000,
  receiptTimeoutMs: 10 * 60_000,
};

export interface WorkerDeps {
  inbox: Inbox;
  herdr: Herdr;
  config: InboxConfig;
  owner: string;
  timing?: Partial<WorkerTiming>;
  sleep?: (ms: number) => Promise<void>;
  // The bridge hook's Bun and script; default to this process and src/bridge/main.ts.
  bunPath?: string;
  hookScript?: string;
}

// Raised inside the worker to stop the walk once the attempt has been moved to its next state.
class Stop extends Error {}

export const STATE_FILE = "herdr-state.json";

// The inbox-owned workspace id, remembered per Herdr socket in `<home>\herdr-state.json`.
function readWorkspaceId(home: string, socketPath: string): string | null {
  try {
    const s = JSON.parse(readFileSync(join(home, STATE_FILE), "utf8")) as { socket_path?: string; workspace_id?: string };
    return s.socket_path === socketPath && typeof s.workspace_id === "string" ? s.workspace_id : null;
  } catch {
    return null;
  }
}

function writeWorkspaceId(home: string, socketPath: string, workspaceId: string) {
  const path = join(home, STATE_FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ socket_path: socketPath, workspace_id: workspaceId })}\n`);
  renameSync(tmp, path);
}

export function agentAlias(attemptId: string): string {
  return `inbox-${attemptId.slice(attemptId.lastIndexOf("_") + 1)}`;
}

// Tab label for people: profile, short title, short attempt id. Never used for identity.
export function tabLabel(profileId: string, title: string, attemptId: string): string {
  const clean = title.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  const short = chars.length > 24 ? `${chars.slice(0, 23).join("")}…` : clean;
  return `${profileId} ${short} ${attemptId.slice(-6)}`;
}

export class Worker {
  private readonly at: Attempts;
  private readonly t: WorkerTiming;
  private readonly sleep: (ms: number) => Promise<void>;
  private gen = 0;
  private lost = false;

  constructor(
    private readonly attemptId: string,
    private readonly d: WorkerDeps,
  ) {
    this.at = new Attempts(d.inbox);
    this.t = { ...DEFAULT_TIMING, ...d.timing };
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private get row(): AttemptRow {
    return this.d.inbox.read(() => this.at.row(this.attemptId));
  }

  // Runs the attempt as far as it can go. Returns the attempt as left, or null when another
  // worker holds the lease.
  async run(): Promise<AttemptView | null> {
    const gen = this.at.claim(this.attemptId, this.d.owner, this.t.leaseMs);
    if (gen === null) return null;
    this.gen = gen;
    this.log(`claimed generation ${gen}`);
    const renew = setInterval(() => this.renew(), Math.max(10, Math.floor(this.t.leaseMs / 3)));
    try {
      await this.walk();
    } catch (err) {
      if (!(err instanceof Stop)) await this.crashed(err);
    } finally {
      clearInterval(renew);
      try {
        this.at.release(this.attemptId, this.gen);
      } catch {
        // The lease expires on its own.
      }
    }
    const view = this.at.get(this.attemptId);
    this.log(`left the attempt ${view.status} in ${view.phase}${view.error ? ` (${view.error.code})` : ""}`);
    return view;
  }

  private renew() {
    if (this.lost) return;
    try {
      this.at.renew(this.attemptId, this.gen, this.t.leaseMs);
    } catch (err) {
      if (fenced(err)) this.lost = true;
    }
  }

  // Stops quietly once the attempt was abandoned or taken over.
  private check() {
    if (this.lost) throw new Stop();
  }

  private async walk() {
    const profile = this.preflight();
    if (!profile) return;
    const layout = await this.createLayout(profile.dir);
    if (!layout) return;
    const agent = await this.startAgent(layout.paneId);
    if (!agent) return;
    if (!(await this.submit(agent))) return;
    if (!(await this.awaitReceipt(agent))) return;
    await this.focusAndCommit();
  }

  // ---- preflight ----------------------------------------------------------

  private preflight(): { dir: string } | null {
    this.at.setPhase(this.attemptId, this.gen, "preflight");
    const a = this.row;
    let cwdOk = false;
    try {
      cwdOk = statSync(a.cwd).isDirectory();
    } catch {
      cwdOk = false;
    }
    if (!cwdOk) return this.end("fail", "CWD_UNAVAILABLE", `The working directory does not exist: ${a.cwd}`);
    let profile;
    try {
      profile = loadProfiles(this.d.inbox.home)[a.profile_id];
    } catch (err) {
      return this.end("fail", "PROFILE_NOT_CONFIGURED", `profiles.json cannot be read: ${(err as Error).message}`);
    }
    if (!profile) return this.end("fail", "PROFILE_NOT_CONFIGURED", `Profile "${a.profile_id}" is not configured.`);
    if (launchFingerprint(profile.agent, profile.claude_config_dir) !== a.launch_fingerprint) {
      return this.end("fail", "PROFILE_NOT_CONFIGURED", `Profile "${a.profile_id}" changed since the attempt started; open it again.`);
    }
    if (!existsSync(profile.claude_config_dir)) {
      return this.end("fail", "PROFILE_LAUNCH_UNSUPPORTED", `The Claude config folder of profile "${a.profile_id}" does not exist.`);
    }
    // The packet the opening prompt names: the stored bytes, exactly.
    const files = bridgeFiles(this.d.inbox.home, a.id);
    writeBridgeSettings({ home: this.d.inbox.home, attemptId: a.id, capability: a.capability, bunPath: this.d.bunPath, hookScript: this.d.hookScript });
    const packetPath = a.packet_path ?? join(files.dir, "packet.md");
    if (!existsSync(packetPath) || sha256Hex(new Uint8Array(readFileSync(packetPath))) !== a.packet_sha256) {
      const tmp = `${packetPath}.${process.pid}.tmp`;
      writeFileSync(tmp, a.packet_bytes);
      renameSync(tmp, packetPath);
    }
    this.at.setPacketPath(a.id, this.gen, packetPath);
    return { dir: profile.claude_config_dir };
  }

  // ---- create_layout --------------------------------------------------------

  private async createLayout(configDir: string): Promise<{ paneId: string } | null> {
    this.check();
    this.at.setPhase(this.attemptId, this.gen, "create_layout");
    const a = this.row;
    if (a.pane_id) return { paneId: a.pane_id };
    const socket = this.d.config.herdr.socket_path;
    let workspaceId: string;
    try {
      const ws = await this.d.herdr.ensureWorkspace({ workspaceId: readWorkspaceId(this.d.inbox.home, socket), label: this.d.config.herdr.workspace_label, cwd: a.cwd });
      workspaceId = ws.workspace.workspace_id;
    } catch (err) {
      // No context exists anywhere yet; at worst an empty inbox workspace was left behind.
      return this.end("fail", "HERDR_UNAVAILABLE", `Herdr is not reachable: ${describe(err)}`);
    }
    try {
      if (readWorkspaceId(this.d.inbox.home, socket) !== workspaceId) writeWorkspaceId(this.d.inbox.home, socket, workspaceId);
    } catch (err) {
      // Only costs a new workspace next time.
      this.log(`could not remember the inbox workspace: ${describe(err)}`);
    }
    if (!this.begin("create_tab", { workspace_id: workspaceId })) return null;
    this.at.recordLayout(a.id, this.gen, { herdr_session: socket, workspace_id: workspaceId });
    const item = this.d.inbox.read(() => this.d.inbox.itemRow(a.item_id));
    try {
      const { tab, root_pane } = await this.d.herdr.createTab({
        workspaceId,
        cwd: a.cwd,
        label: tabLabel(a.profile_id, item.title, a.id),
        env: { CLAUDE_CONFIG_DIR: configDir },
      });
      this.at.recordLayout(a.id, this.gen, { tab_id: tab.tab_id, pane_id: root_pane.pane_id });
      this.at.finishOp(a.id, this.gen, "create_tab", "confirmed", { tab_id: tab.tab_id, pane_id: root_pane.pane_id });
      return { paneId: root_pane.pane_id };
    } catch (err) {
      if (isRejected(err)) {
        this.at.finishOp(a.id, this.gen, "create_tab", "failed", { code: herdrCode(err) });
        return this.end("fail", "HERDR_UNAVAILABLE", `Herdr refused to create the tab: ${describe(err)}`);
      }
      this.at.finishOp(a.id, this.gen, "create_tab", "uncertain", { code: herdrCode(err) });
      return this.end("uncertain", "DELIVERY_UNCERTAIN", `Tab creation may have happened: ${describe(err)}`);
    }
  }

  // ---- start_agent ----------------------------------------------------------

  private async startAgent(paneId: string): Promise<AgentInfo | null> {
    this.check();
    this.at.setPhase(this.attemptId, this.gen, "start_agent");
    const a = this.row;
    const alias = agentAlias(a.id);
    const files = bridgeFiles(this.d.inbox.home, a.id);
    if (!this.begin("start_agent", { alias })) return null;
    this.at.recordLayout(a.id, this.gen, { agent_alias: alias });
    try {
      await this.d.herdr.startAgent({
        name: alias,
        paneId,
        args: ["--session-id", a.session_uuid, "--settings", files.settingsPath],
        timeoutMs: this.t.startTimeoutMs,
      });
      this.at.finishOp(a.id, this.gen, "start_agent", "confirmed");
    } catch (err) {
      if (isRejected(err)) {
        this.at.finishOp(a.id, this.gen, "start_agent", "failed", { code: herdrCode(err) });
        return this.end("fail", "AGENT_UNAVAILABLE", `Herdr refused to start Claude: ${describe(err)}`);
      }
      this.at.finishOp(a.id, this.gen, "start_agent", "uncertain", { code: herdrCode(err) });
      if (herdrCode(err) !== "agent_not_ready") {
        return this.end("uncertain", "AGENT_UNAVAILABLE", `Claude may have started; its readiness is unknown: ${describe(err)}`);
      }
      // Claude is up but waiting on a dialog (trust, login). The user handles it in the pane.
      if (!(await this.watchBlockedStart(alias))) return null;
    }
    return this.verifyTarget(alias);
  }

  private async watchBlockedStart(alias: string): Promise<boolean> {
    this.at.block(this.attemptId, this.gen, "AGENT_BLOCKED", "Claude is waiting on a dialog in its tab; answer it there.");
    try {
      await this.d.herdr.focus(alias);
    } catch {
      // Focus only helps the user find the dialog.
    }
    const until = Date.now() + this.t.blockedWatchMs;
    while (Date.now() < until) {
      await this.sleep(this.t.pollMs);
      this.check();
      // Only the worker's own dialog block is lifted here. Anything else (the bridge refusing the
      // profile or session, an abandon) is a verdict to keep, not to overwrite.
      const now = this.row;
      if (now.status !== "blocked" || now.error_code !== "AGENT_BLOCKED") throw new Stop();
      const info = await this.readAgent(alias);
      if (info && info.interactive_ready !== false && info.agent_status !== "blocked" && info.agent_session?.value) {
        if (!this.at.resume(this.attemptId, this.gen, "AGENT_BLOCKED")) throw new Stop();
        this.at.finishOp(this.attemptId, this.gen, "start_agent", "confirmed", { after: "dialog" });
        return true;
      }
    }
    this.log("left the dialog-blocked start to the user");
    return false;
  }

  // Herdr must report the attempt's own session in the recorded pane, and the bridge must have
  // bound it, before any context is sent (spec §10.3).
  private async verifyTarget(alias: string): Promise<AgentInfo | null> {
    const until = Date.now() + this.t.bindTimeoutMs;
    for (;;) {
      this.check();
      const a = this.row;
      if (a.status !== "in_progress") throw new Stop(); // the bridge blocked it (wrong profile or session)
      const info = await this.readAgent(alias);
      if (info === null) return this.end("block", "AGENT_UNAVAILABLE", "Claude is no longer running under the attempt's alias.");
      const session = info?.agent_session?.value;
      if (session && session !== a.session_uuid) return this.end("block", "AGENT_UNAVAILABLE", "Herdr reports a different Claude session under the attempt's alias.");
      if (info && info.pane_id !== a.pane_id) return this.end("block", "AGENT_UNAVAILABLE", "Herdr reports the attempt's alias in a different pane.");
      if (info && session && a.binding_json) return info;
      if (Date.now() >= until) {
        return this.end("block", "RECEIPT_INVALID", a.binding_json ? "Herdr does not report the session id yet." : "The session never reported its startup to the inbox bridge.");
      }
      await this.sleep(this.t.pollMs);
    }
  }

  // ---- submit_context -------------------------------------------------------

  private async submit(agent: AgentInfo): Promise<boolean | null> {
    this.check();
    this.at.setPhase(this.attemptId, this.gen, "submit_context");
    const a = this.row;
    const alias = a.agent_alias!;
    // The settled state that counts must come after this point, not the startup idle.
    if (!this.begin("dispatch_prompt", { baseline_state_seq: agent.state_change_seq ?? null })) return false;
    try {
      await this.d.herdr.prompt(alias, buildOpeningPrompt(a.id, a.packet_path!, a.packet_sha256));
      this.at.finishOp(a.id, this.gen, "dispatch_prompt", "confirmed");
    } catch (err) {
      if (isRejected(err)) {
        // Definitive: nothing was typed. The prompt may be sent again by an explicit retry.
        this.at.finishOp(a.id, this.gen, "dispatch_prompt", "failed", { code: herdrCode(err) });
        if (herdrCode(err) === "agent_blocked") return this.end("block", "AGENT_BLOCKED", "Claude is waiting on a dialog; answer it, then retry.");
        return this.end("block", "AGENT_UNAVAILABLE", `Herdr refused the opening prompt: ${describe(err)}`);
      }
      // It may have been typed: never resend. The bridge's acceptance settles it.
      this.at.finishOp(a.id, this.gen, "dispatch_prompt", "uncertain", { code: herdrCode(err) });
      this.log(`opening prompt outcome unknown (${herdrCode(err)}); watching for acceptance`);
    }
    return true;
  }

  // ---- await_receipt --------------------------------------------------------

  private async awaitReceipt(agent: AgentInfo): Promise<boolean | null> {
    this.check();
    this.at.setPhase(this.attemptId, this.gen, "await_receipt");
    const baseline = agent.state_change_seq ?? -1;
    const until = Date.now() + this.t.receiptTimeoutMs;
    for (;;) {
      this.check();
      const a = this.row;
      if (a.status !== "in_progress") throw new Stop();
      if (a.prompt_state === "accepted" && this.opState("dispatch_prompt") === "uncertain") {
        this.at.finishOp(a.id, this.gen, "dispatch_prompt", "confirmed", { by: "bridge acceptance" });
      }
      if (a.prompt_state === "accepted" && a.receipt_candidate_json) {
        const info = await this.readAgent(a.agent_alias!);
        if (info === null) return this.end("block", "AGENT_UNAVAILABLE", "Claude closed after acknowledging; the receipt is kept.");
        // A missing session id is looked at again, as in verifyTarget; only a different one blocks.
        const session = info?.agent_session?.value;
        if (info && ((session && session !== a.session_uuid) || info.pane_id !== a.pane_id)) {
          return this.end("block", "AGENT_UNAVAILABLE", "Herdr no longer reports the attempt's session in its pane.");
        }
        if (info && !session) {
          await this.sleep(this.t.pollMs);
          continue;
        }
        if (info && (info.state_change_seq ?? -1) > baseline && (info.agent_status === "idle" || info.agent_status === "done")) return true;
      }
      if (Date.now() >= until) {
        // Not accepted yet: the prompt may still arrive. A blocked attempt would refuse (erase) it,
        // so the attempt becomes uncertain instead.
        if (a.prompt_state !== "accepted") return this.end("uncertain", "DELIVERY_UNCERTAIN", "The session has not accepted the opening prompt; nothing was resent.");
        return this.end("block", "RECEIPT_INVALID", a.receipt_candidate_json ? "Claude has not settled after acknowledging." : "No valid acknowledgment yet; open the session to see why.");
      }
      await this.sleep(this.t.pollMs);
    }
  }

  // ---- focus ----------------------------------------------------------------

  private async focusAndCommit() {
    this.check();
    this.at.setPhase(this.attemptId, this.gen, "focus");
    const a = this.row;
    if (!this.begin("focus")) return;
    try {
      await this.d.herdr.focus(a.agent_alias!);
    } catch (err) {
      this.at.finishOp(a.id, this.gen, "focus", isRejected(err) ? "failed" : "uncertain", { code: herdrCode(err) });
      this.end("block", "AGENT_UNAVAILABLE", `The session acknowledged, but focusing it failed: ${describe(err)}`);
      return;
    }
    const focus = { workspace_id: a.workspace_id, tab_id: a.tab_id, pane_id: a.pane_id, agent_alias: a.agent_alias, focused_at: this.d.inbox.now() };
    this.at.finishOp(a.id, this.gen, "focus", "confirmed", focus);
    this.at.commitDelivery(a.id, this.gen, focus);
    this.log("delivered");
  }

  // ---- helpers --------------------------------------------------------------

  // Records the op's intent. False (after leaving the attempt uncertain) when it was already
  // recorded: this worker never repeats a side effect it cannot see the outcome of.
  private begin(op: OpName, detail?: Record<string, unknown>): boolean {
    const prev = this.at.beginOp(this.attemptId, this.gen, op, detail);
    if (prev === null) return true;
    this.end("uncertain", "DELIVERY_UNCERTAIN", `Step ${op} was already ${prev}; reconcile before continuing.`);
    return false;
  }

  private opState(op: OpName) {
    return this.at.ops(this.attemptId).find((o) => o.op === op)?.state;
  }

  // null: no agent has the alias. undefined: the read failed, which never means "gone"
  // (INB-003 N1); callers look again.
  private async readAgent(alias: string): Promise<AgentInfo | null | undefined> {
    try {
      return await this.d.herdr.agent(alias);
    } catch (err) {
      this.log(`agent get failed (${herdrCode(err)}); will look again`);
      return undefined;
    }
  }

  private end(how: "fail" | "block" | "uncertain", code: string, message: string): null {
    this.check();
    if (how === "fail") this.at.fail(this.attemptId, this.gen, code, message);
    else if (how === "block") this.at.block(this.attemptId, this.gen, code, message);
    else this.at.markUncertain(this.attemptId, this.gen, code, message);
    this.log(`${how} ${code}: ${message}`);
    return null;
  }

  private async crashed(err: unknown) {
    this.log(`stopped on an unexpected error: ${describe(err)}`);
    if (fenced(err)) return;
    try {
      const a = this.row;
      // A block or uncertainty already recorded (often by the bridge) says more; keep it.
      if (a.status !== "in_progress") return;
      const message = `The worker stopped unexpectedly: ${describe(err).slice(0, 200)}`;
      // Nothing external has happened yet: an honest failure. Otherwise leave it for the user.
      if (!this.at.ops(a.id).length && a.prompt_state === "none") this.at.fail(a.id, this.gen, "INTERNAL", message);
      else this.at.markUncertain(a.id, this.gen, "DELIVERY_UNCERTAIN", message);
    } catch {
      // The lease expires and reconcile (INB-009) takes over.
    }
  }

  // A short diagnostic log beside the bridge files. Never the packet, capability or challenge.
  private log(line: string) {
    try {
      appendFileSync(join(bridgeFiles(this.d.inbox.home, this.attemptId).dir, "worker.log"), `${new Date().toISOString()} ${line}\n`);
    } catch {
      // Diagnostics only.
    }
  }
}

function fenced(err: unknown): boolean {
  return err instanceof InboxError && err.code === "STATE_CONFLICT" && !!(err.details as { fenced?: boolean } | undefined)?.fenced;
}

function isRejected(err: unknown): boolean {
  return err instanceof HerdrError && err.outcome === "rejected";
}

function herdrCode(err: unknown): string {
  return err instanceof HerdrError ? err.code : "error";
}

function describe(err: unknown): string {
  if (err instanceof HerdrError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

// Ends an attempt that no worker could start on (no Herdr config, spawn failure). Nothing
// external has happened yet, so `failed` is honest.
export function failBeforeStart(inbox: Inbox, attemptId: string, owner: string, code: string, message: string) {
  const at = new Attempts(inbox);
  const gen = at.claim(attemptId, owner, 60_000);
  if (gen !== null) at.fail(attemptId, gen, code, message);
}

// An unfinished attempt no worker is running: never claimed, or its lease lapsed, with no
// external step recorded. Starting a worker for it repeats nothing.
export function needsWorker(inbox: Inbox, attemptId: string): boolean {
  const at = new Attempts(inbox);
  return inbox.read(() => {
    const a = at.row(attemptId);
    const leaseLive = !!a.lease_owner && !!a.lease_expires_at && a.lease_expires_at > inbox.now();
    return a.status === "in_progress" && !a.revoked_at && !leaseLive && a.prompt_state === "none" && at.ops(a.id).length === 0;
  });
}
