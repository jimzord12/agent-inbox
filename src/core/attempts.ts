import { randomUUID } from "node:crypto";
import { newId, randomToken, toStored } from "./clock";
import { InboxError } from "./errors";
import type { Inbox, ItemRow } from "./inbox";
import { OPENING_PREFIX, READY_MARKER, buildOpeningPrompt, buildPacket } from "./packet";
import { type Profile, launchFingerprint, loadProfiles, normalizeDir } from "./profiles";
import { type Submission, sha256Hex } from "./submission";

export type AttemptStatus = "in_progress" | "blocked" | "uncertain" | "failed" | "succeeded";
export type Phase = "preflight" | "create_layout" | "start_agent" | "submit_context" | "await_receipt" | "focus";
export type Availability = "live" | "closed" | "unknown" | "unavailable";
export type OpState = "started" | "confirmed" | "failed" | "uncertain";
export type OpName = "create_tab" | "start_agent" | "dispatch_prompt" | "focus";

const BLOCKING: AttemptStatus[] = ["in_progress", "blocked", "uncertain"];

export interface AttemptRow {
  id: string;
  item_id: string;
  content_revision: number;
  status: AttemptStatus;
  phase: Phase;
  created_at: string;
  updated_at: string;
  profile_id: string;
  profile_override: number;
  fresh: number;
  launch_fingerprint: string;
  cwd: string;
  agent_kind: string;
  session_uuid: string;
  capability: string;
  challenge: string;
  packet_bytes: Uint8Array;
  packet_sha256: string;
  packet_path: string | null;
  error_code: string | null;
  error_message: string | null;
  revoked_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  fencing_generation: number;
  herdr_session: string | null;
  workspace_id: string | null;
  tab_id: string | null;
  pane_id: string | null;
  agent_alias: string | null;
  availability: Availability;
  binding_json: string | null;
  prompt_state: "none" | "started" | "accepted" | "rejected" | "uncertain";
  prompt_started_at: string | null;
  prompt_accepted_at: string | null;
  receipt_candidate_json: string | null;
  receipt_json: string | null;
  focus_json: string | null;
  last_rejection_json: string | null;
}

interface OpRow {
  attempt_id: string;
  op: OpName;
  state: OpState;
  generation: number;
  started_at: string;
  finished_at: string | null;
  detail_json: string | null;
}

// What clients see. Capability, challenge and packet bytes never leave the core.
export interface AttemptView {
  id: string;
  item_id: string;
  content_revision: number;
  status: AttemptStatus;
  phase: Phase;
  created_at: string;
  updated_at: string;
  profile_id: string;
  profile_override: boolean;
  fresh: boolean;
  cwd: string;
  session_uuid: string;
  packet_sha256: string;
  packet_path: string | null;
  error: { code: string; message: string } | null;
  revoked: boolean;
  herdr: { session: string | null; workspace_id: string | null; tab_id: string | null; pane_id: string | null; agent_alias: string | null };
  availability: Availability;
  evidence: {
    bound: boolean;
    prompt_state: AttemptRow["prompt_state"];
    receipt_candidate: boolean;
    delivered: boolean;
    focused: boolean;
    // Last bridge evidence that was refused, e.g. a malformed ready marker.
    last_rejection: { stage: string; reason: string; at: string } | null;
  };
  ops: { op: OpName; state: OpState; started_at: string; finished_at: string | null }[];
  next_actions: string[];
}

export type PromptRefusal =
  | "NOT_PROTOCOL"
  | "ATTEMPT_CLOSED"
  | "NOT_BOUND"
  | "WRONG_SESSION"
  | "WRONG_CWD"
  | "WRONG_ATTEMPT"
  | "PROMPT_MISMATCH"
  | "ALREADY_ACCEPTED"
  | "NO_DISPATCH"
  | "ATTEMPT_BLOCKED";

export type PromptResult = { ok: true; protocol: true } | { ok: false; protocol: boolean; code: PromptRefusal; reason: string };

export interface Layout {
  herdr_session: string;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  agent_alias: string;
}

// Startup facts the SessionStart hook observed inside the launched session.
export interface Binding {
  session_id: string;
  cwd: string;
  claude_config_dir: string;
  // Names (never values) of auth-affecting variables present in the session's env.
  auth_env: string[];
}

export interface Receipt {
  attempt_id: string;
  item_id: string;
  content_revision: number;
  packet_sha256: string;
  challenge: string;
  orientation_chars: number;
}

export class Attempts {
  constructor(readonly inbox: Inbox) {}

  private get db() {
    return this.inbox.db;
  }

  // ---- user actions -----------------------------------------------------

  // Reserve one attempt, or return the existing blocking one (spec §8 `open`). Returns promptly;
  // the caller starts the worker.
  open(itemId: string, ifRevision: number, opts: { profile?: string; fresh?: boolean } = {}): { attempt: AttemptView; reused: boolean } {
    const profiles = loadProfiles(this.inbox.home);
    return this.inbox.write(() => {
      const item = this.inbox.itemRow(itemId);
      if (item.kind !== "actionable") {
        throw new InboxError("STATE_CONFLICT", "Only actionable items open a session.", { kind: item.kind });
      }
      const existing = this.blockingRow(item.id);
      if (existing) return { attempt: this.toView(existing), reused: true };
      if (item.archived_at) {
        throw new InboxError("ITEM_IN_HISTORY", "The item is in History; restore it first.", { archive_reason: item.archive_reason });
      }
      if (ifRevision !== item.content_revision) {
        throw new InboxError("REVISION_CONFLICT", "The item has a different content revision; refresh and try again.", {
          content_revision: item.content_revision,
        });
      }
      const delivered = this.db
        .query("SELECT * FROM attempts WHERE item_id = ? AND content_revision = ? AND status = 'succeeded' ORDER BY created_at DESC")
        .get(item.id, item.content_revision) as AttemptRow | null;
      if (delivered && !opts.fresh) {
        throw new InboxError("ALREADY_DELIVERED", "This revision was already delivered. Focus that session, or open a fresh one.", {
          attempt_id: delivered.id,
          session_uuid: delivered.session_uuid,
          availability: delivered.availability,
        });
      }

      const rev = this.inbox.revisionRow(item.id, item.content_revision);
      const payload = JSON.parse(rev.payload_json) as Submission;
      const profileId = opts.profile ?? payload.profile_id;
      const profile: Profile | undefined = profiles[profileId];
      if (!profile) {
        throw new InboxError("PROFILE_NOT_CONFIGURED", `Profile "${profileId}" is not configured.`, { profile_id: profileId });
      }
      const now = this.inbox.now();
      const id = newId("att", this.inbox.clock);
      const challenge = randomToken(16);
      const packet = new TextEncoder().encode(
        buildPacket({
          attemptId: id,
          itemId: item.id,
          contentRevision: item.content_revision,
          title: payload.title,
          producerId: item.producer_id,
          profileId,
          cwd: payload.launch!.cwd,
          instruction: payload.launch!.initial_instruction,
          handoffText: new TextDecoder("utf-8", { ignoreBOM: true }).decode(rev.handoff_bytes!),
          handoffSha256: rev.handoff_sha256!,
          capturedAt: rev.received_at,
          refs: payload.context_refs,
          challenge,
        }),
      );
      this.db
        .query(
          `INSERT INTO attempts (id, item_id, content_revision, status, phase, created_at, updated_at, profile_id,
             profile_override, fresh, launch_fingerprint, cwd, agent_kind, session_uuid, capability, challenge,
             packet_bytes, packet_sha256)
           VALUES (?, ?, ?, 'in_progress', 'preflight', ?, ?, ?, ?, ?, ?, ?, 'claude-code', ?, ?, ?, ?, ?)`,
        )
        .run(
          id, item.id, item.content_revision, now, now, profileId,
          opts.profile && opts.profile !== payload.profile_id ? 1 : 0, opts.fresh ? 1 : 0,
          launchFingerprint(profile.agent, profile.claude_config_dir), payload.launch!.cwd,
          randomUUID(), randomToken(24), challenge, packet, sha256Hex(packet),
        );
      this.inbox.emit("handoff.started", "user", item.id, item.producer_id, item.content_revision, id, {
        profile_id: profileId,
        profile_override: profileId !== payload.profile_id,
        fresh: !!opts.fresh,
      });
      return { attempt: this.toView(this.row(id)), reused: false };
    });
  }

  // Revoke the attempt and release the item. Does not close or interrupt any session.
  abandon(attemptId: string): AttemptView {
    return this.inbox.write(() => {
      const a = this.row(attemptId);
      if (!BLOCKING.includes(a.status)) {
        throw new InboxError("STATE_CONFLICT", `The attempt is already ${a.status}.`, { status: a.status });
      }
      this.db
        .query(
          `UPDATE attempts SET status = 'failed', revoked_at = ?, error_code = 'ABANDONED',
             error_message = 'Abandoned by the user.', lease_owner = NULL, lease_expires_at = NULL,
             fencing_generation = fencing_generation + 1, updated_at = ? WHERE id = ?`,
        )
        .run(this.inbox.now(), this.inbox.now(), a.id);
      this.emitFor(a, "handoff.failed", "user", { abandoned: true, phase: a.phase });
      return this.toView(this.row(a.id));
    });
  }

  get(attemptId: string): AttemptView {
    return this.inbox.read(() => this.toView(this.row(attemptId)));
  }

  forItem(itemId: string): AttemptView[] {
    return this.inbox.read(() =>
      (this.db.query("SELECT * FROM attempts WHERE item_id = ? ORDER BY created_at, id").all(itemId) as AttemptRow[]).map((r) =>
        this.toView(r),
      ),
    );
  }

  // Blocking attempts that may need a worker (UI startup / retry reconciliation).
  unfinished(): AttemptView[] {
    return this.inbox.read(() =>
      (this.db.query("SELECT * FROM attempts WHERE status IN ('in_progress', 'blocked', 'uncertain') ORDER BY created_at").all() as AttemptRow[]).map(
        (r) => this.toView(r),
      ),
    );
  }

  // ---- worker: lease and fencing ----------------------------------------

  /** @internal Full row including secrets, for the worker and bridge only. */
  row(attemptId: string): AttemptRow {
    const r = this.db.query("SELECT * FROM attempts WHERE id = ?").get(attemptId) as AttemptRow | null;
    if (!r) throw new InboxError("NOT_FOUND", `No attempt with id ${attemptId}.`, { attempt_id: attemptId });
    return r;
  }

  // Take the lease if it is free or expired. Returns the new fencing generation, or null when
  // another live worker holds it. Every later worker write must present this generation.
  claim(attemptId: string, owner: string, ttlMs: number): number | null {
    return this.inbox.write(() => {
      const a = this.row(attemptId);
      if (!BLOCKING.includes(a.status) || a.revoked_at) return null;
      const now = this.inbox.now();
      if (a.lease_owner && a.lease_owner !== owner && a.lease_expires_at && a.lease_expires_at > now) return null;
      const gen = a.fencing_generation + 1;
      this.db
        .query("UPDATE attempts SET lease_owner = ?, lease_expires_at = ?, fencing_generation = ?, updated_at = ? WHERE id = ?")
        .run(owner, this.expiry(ttlMs), gen, now, a.id);
      return gen;
    });
  }

  renew(attemptId: string, gen: number, ttlMs: number) {
    this.fencedWrite(attemptId, gen, (a) => {
      this.db.query("UPDATE attempts SET lease_expires_at = ? WHERE id = ?").run(this.expiry(ttlMs), a.id);
    });
  }

  release(attemptId: string, gen: number) {
    this.inbox.write(() => {
      this.db
        .query("UPDATE attempts SET lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND fencing_generation = ?")
        .run(attemptId, gen);
    });
  }

  setPhase(attemptId: string, gen: number, phase: Phase) {
    this.fencedWrite(attemptId, gen, (a) => this.patch(a.id, { phase }));
  }

  // The opening prompt names this path, so it is fixed once dispatch has begun.
  setPacketPath(attemptId: string, gen: number, path: string) {
    this.fencedWrite(attemptId, gen, (a) => {
      if (a.packet_path === path) return;
      if (a.prompt_state !== "none") throw new InboxError("STATE_CONFLICT", "The packet path cannot change after dispatch began.");
      this.patch(a.id, { packet_path: path });
    });
  }

  recordLayout(attemptId: string, gen: number, layout: Partial<Layout>) {
    this.fencedWrite(attemptId, gen, (a) => this.patch(a.id, { ...layout }));
  }

  // Availability describes a delivered session (spec §13), so only a succeeded attempt records
  // it; the check is in the same statement, so a late answer cannot land on the wrong state.
  setAvailability(attemptId: string, availability: Availability): boolean {
    return this.inbox.write(
      () =>
        this.db
          .query("UPDATE attempts SET availability = ?, updated_at = ? WHERE id = ? AND status = 'succeeded'")
          .run(availability, this.inbox.now(), attemptId).changes > 0,
    );
  }

  // Intent log: persist `started` before an external side effect. If the op is already
  // recorded, nothing new is written and its previous state is returned, so the caller
  // reconciles instead of repeating it.
  beginOp(attemptId: string, gen: number, op: OpName, detail?: Record<string, unknown>): OpState | null {
    return this.fencedWrite(attemptId, gen, (a) => {
      const prev = this.db.query("SELECT state FROM attempt_ops WHERE attempt_id = ? AND op = ?").get(a.id, op) as
        | { state: OpState }
        | null;
      if (prev) return prev.state;
      this.db
        .query("INSERT INTO attempt_ops (attempt_id, op, state, generation, started_at, detail_json) VALUES (?, ?, 'started', ?, ?, ?)")
        .run(a.id, op, gen, this.inbox.now(), detail ? JSON.stringify(detail) : null);
      if (op === "dispatch_prompt") {
        // Only a definitive rejection (cleared back to none) allows a second dispatch.
        if (a.prompt_state !== "none") throw new InboxError("STATE_CONFLICT", `The opening prompt is already ${a.prompt_state}.`);
        this.patch(a.id, { prompt_state: "started", prompt_started_at: this.inbox.now() });
      }
      return null;
    });
  }

  finishOp(attemptId: string, gen: number, op: OpName, state: Exclude<OpState, "started">, detail?: Record<string, unknown>) {
    this.fencedWrite(attemptId, gen, (a) => {
      // An op is finished once from `started`, or resolved once from `uncertain`. An uncertain
      // dispatch is never declared failed: only bridge evidence or abandon resolves it.
      const prev = this.db.query("SELECT state FROM attempt_ops WHERE attempt_id = ? AND op = ?").get(a.id, op) as { state: OpState } | null;
      const allowed = prev?.state === "started" || (prev?.state === "uncertain" && !(op === "dispatch_prompt" && state === "failed"));
      if (!allowed) throw new InboxError("STATE_CONFLICT", `Op ${op} is ${prev?.state ?? "not started"}; it cannot become ${state}.`);
      // The finishing detail is merged into the one recorded at the start (e.g. the dispatch's
      // settle baseline), never replacing it.
      const merged = detail ? JSON.stringify({ ...(prevDetail(this.db, a.id, op) ?? {}), ...detail }) : null;
      this.db
        .query("UPDATE attempt_ops SET state = ?, finished_at = ?, detail_json = COALESCE(?, detail_json) WHERE attempt_id = ? AND op = ?")
        .run(state, this.inbox.now(), merged, a.id, op);
      if (op === "dispatch_prompt" && a.prompt_state === "started") {
        if (state === "uncertain") this.patch(a.id, { prompt_state: "uncertain" });
        // A definitive rejection proves the prompt was not delivered.
        if (state === "failed") this.patch(a.id, { prompt_state: "rejected" });
      }
    });
  }

  /** @internal Forget a failed op so a retry may perform it again. Refuses anything else. */
  clearFailedOp(attemptId: string, gen: number, op: OpName) {
    this.fencedWrite(attemptId, gen, (a) => {
      // A failed dispatch whose prompt the bridge accepted anyway was delivered: keep that evidence.
      if (op === "dispatch_prompt" && a.prompt_state !== "rejected") {
        throw new InboxError("STATE_CONFLICT", `The opening prompt is ${a.prompt_state}; it cannot be sent again.`);
      }
      const removed = this.db.query("DELETE FROM attempt_ops WHERE attempt_id = ? AND op = ? AND state = 'failed'").run(a.id, op).changes;
      if (!removed) throw new InboxError("STATE_CONFLICT", `Op ${op} has not failed.`);
      if (op === "dispatch_prompt") this.patch(a.id, { prompt_state: "none" });
    });
  }

  ops(attemptId: string): OpRow[] {
    return this.db.query("SELECT * FROM attempt_ops WHERE attempt_id = ? ORDER BY started_at, rowid").all(attemptId) as OpRow[];
  }

  // Block and uncertainty apply only to an attempt in progress. Once someone else (usually the
  // bridge) recorded a verdict, it is kept and false is returned.
  block(attemptId: string, gen: number, code: string, message: string): boolean {
    return this.transition(attemptId, gen, "blocked", "handoff.blocked", code, message);
  }

  markUncertain(attemptId: string, gen: number, code: string, message: string): boolean {
    return this.transition(attemptId, gen, "uncertain", "handoff.uncertain", code, message);
  }

  fail(attemptId: string, gen: number, code: string, message: string) {
    this.transition(attemptId, gen, "failed", "handoff.failed", code, message);
  }

  // Back to in_progress for an explicit retry, keeping phase, ops and evidence. With `onlyCode`,
  // only a block or uncertainty carrying that code is lifted, in the same transaction, so a
  // verdict someone else recorded meanwhile (e.g. the bridge) is never overwritten. Returns
  // whether the attempt is now in progress.
  resume(attemptId: string, gen: number, onlyCode?: string): boolean {
    return this.fencedWrite(attemptId, gen, (a) => {
      if (a.status === "in_progress") return true;
      if (onlyCode !== undefined && a.error_code !== onlyCode) return false;
      this.patch(a.id, { status: "in_progress", error_code: null, error_message: null, last_rejection_json: null });
      return true;
    });
  }

  // Final transaction (spec §9.1 step 7): receipt, success, archive(delivered) and events together.
  commitDelivery(attemptId: string, gen: number, focus: Record<string, unknown>): AttemptView {
    return this.fencedWrite(attemptId, gen, (a) => {
      // A block or uncertainty (e.g. the bridge saw the session replaced) needs an explicit resume first.
      if (a.status !== "in_progress") throw new InboxError("STATE_CONFLICT", `The attempt is ${a.status}; resolve it before delivery.`, { status: a.status });
      if (!a.binding_json) throw new InboxError("RECEIPT_INVALID", "No startup binding was recorded.");
      if (a.prompt_state !== "accepted") throw new InboxError("RECEIPT_INVALID", "The opening prompt was not accepted in the bound session.");
      if (!a.receipt_candidate_json) throw new InboxError("RECEIPT_INVALID", "No valid acknowledgment was captured.");
      const item = this.inbox.itemRow(a.item_id);
      if (item.archived_at || item.content_revision !== a.content_revision) {
        throw new InboxError("STATE_CONFLICT", "The item moved on since this attempt started.", {
          content_revision: item.content_revision,
          archived: !!item.archived_at,
        });
      }
      const now = this.inbox.now();
      this.patch(a.id, {
        status: "succeeded",
        receipt_json: a.receipt_candidate_json,
        focus_json: JSON.stringify(focus),
        availability: "live",
        lease_owner: null,
        lease_expires_at: null,
        error_code: null,
        error_message: null,
        last_rejection_json: null,
      });
      this.db
        .query(
          `UPDATE items SET archived_at = ?, archive_reason = 'delivered', snoozed_until = NULL,
             state_version = state_version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(now, now, item.id);
      this.emitFor(a, "handoff.delivered", "worker", { session_uuid: a.session_uuid, packet_sha256: a.packet_sha256 });
      this.emitFor(a, "item.archived", "worker", { reason: "delivered" });
      return this.toView(this.row(a.id));
    });
  }

  // ---- bridge (authenticated by the attempt capability, not the lease) ----

  // SessionStart: bind the real session to the attempt and check the effective profile.
  bind(attemptId: string, capability: string, b: Binding): { ok: true } | { ok: false; code: string; reason: string } {
    return this.inbox.write(() => {
      const a = this.bridgeRow(attemptId, capability);
      const problem =
        b.session_id !== a.session_uuid
          ? "session id does not match the attempt"
          : normalizeDir(b.cwd) !== normalizeDir(a.cwd)
            ? "working directory does not match"
            : launchFingerprint(a.agent_kind, b.claude_config_dir) !== a.launch_fingerprint
              ? "the session loaded a different Claude configuration than the selected profile"
              : b.auth_env.length
                ? `auth-affecting environment variables are set (${b.auth_env.join(", ")})`
                : null;
      if (problem) {
        const found = problem.startsWith("session id") || problem.startsWith("working") ? "RECEIPT_INVALID" : "PROFILE_LAUNCH_UNSUPPORTED";
        // A wrong-profile verdict outranks any later startup mismatch: it is never replaced.
        const keep = a.status === "blocked" && a.error_code === "PROFILE_LAUNCH_UNSUPPORTED";
        const code = keep ? "PROFILE_LAUNCH_UNSUPPORTED" : found;
        // A different session after binding means the bound conversation may be gone: drop the
        // receipt it produced so only a new, valid acknowledgment can deliver.
        this.patch(a.id, {
          status: "blocked",
          error_code: code,
          error_message: keep ? a.error_message : `Startup check failed: ${problem}.`,
          receipt_candidate_json: null,
          last_rejection_json: this.rejection("bind", problem),
        });
        this.emitFor(a, "handoff.blocked", "bridge", { code, phase: a.phase });
        return { ok: false, code, reason: problem };
      }
      if (!a.binding_json) this.patch(a.id, { binding_json: JSON.stringify(b) });
      return { ok: true };
    });
  }

  // UserPromptSubmit: accept the protocol prompt once, in the bound session, after the worker
  // recorded its dispatch intent. Anything else fails closed.
  // `protocol` says whether the prompt claims to be an inbox opening prompt (any attempt's):
  // the hook blocks a protocol prompt that is not accepted and lets ordinary prompts through.
  // A closed (terminal or revoked) attempt answers instead of throwing, so later prompts in a
  // delivered session keep working.
  acceptPrompt(attemptId: string, capability: string, sessionId: string, cwd: string, prompt: string): PromptResult {
    return this.inbox.write(() => {
      const a = this.row(attemptId);
      if (a.capability !== capability) throw new InboxError("RECEIPT_INVALID", "Bad attempt capability.");
      const protocol = prompt.trimStart().startsWith(OPENING_PREFIX);
      const refuse = (code: PromptRefusal, reason: string): PromptResult => {
        if (protocol && !this.closed(a)) this.patch(a.id, { last_rejection_json: this.rejection("prompt", reason) });
        return { ok: false, protocol, code, reason };
      };
      if (this.closed(a)) return refuse("ATTEMPT_CLOSED", `the attempt is ${a.revoked_at ? "revoked" : a.status}`);
      if (!protocol) return { ok: false, protocol, code: "NOT_PROTOCOL", reason: "not an opening prompt" };
      // Another attempt's opening prompt in this session: its worker targeted the wrong pane.
      if (!prompt.trimStart().startsWith(`${OPENING_PREFIX}${a.id}]`)) return refuse("WRONG_ATTEMPT", "opening prompt of another attempt");
      // A blocked attempt waits for the owner. An uncertain one still accepts: its dispatch may
      // land late, and acceptance is the evidence that settles it.
      if (a.status === "blocked") return refuse("ATTEMPT_BLOCKED", "the attempt is blocked");
      const expected = a.packet_path ? buildOpeningPrompt(a.id, a.packet_path, a.packet_sha256) : null;
      if (!a.binding_json) return refuse("NOT_BOUND", "session is not bound");
      if (sessionId !== a.session_uuid) return refuse("WRONG_SESSION", "wrong session");
      if (normalizeDir(cwd) !== normalizeDir(a.cwd)) return refuse("WRONG_CWD", "working directory does not match");
      if (prompt.trim() !== expected) return refuse("PROMPT_MISMATCH", "not the expected opening prompt");
      if (a.prompt_state === "accepted") return refuse("ALREADY_ACCEPTED", "opening prompt already accepted");
      if (a.prompt_state !== "started" && a.prompt_state !== "uncertain") return refuse("NO_DISPATCH", "no dispatch was recorded for this attempt");
      this.patch(a.id, { prompt_state: "accepted", prompt_accepted_at: this.inbox.now() });
      return { ok: true, protocol: true };
    });
  }

  // Stop: validate the INBOX_READY_V1 marker in the completed main-session reply.
  // Identical repeats are harmless; an invalid reply records nothing.
  captureReceipt(attemptId: string, capability: string, sessionId: string, lastMessage: string): { ok: true } | { ok: false; reason: string } {
    return this.inbox.write(() => {
      const a = this.bridgeRow(attemptId, capability);
      if (sessionId !== a.session_uuid) return { ok: false, reason: "wrong session" };
      if (a.prompt_state !== "accepted") return { ok: false, reason: "opening prompt was not accepted" };
      const parsed = parseReadyMarker(lastMessage);
      if (!parsed.ok) {
        // A reply without any marker is an ordinary turn; a broken marker is worth showing.
        if (lastMessage.includes(READY_MARKER)) this.patch(a.id, { last_rejection_json: this.rejection("receipt", parsed.reason) });
        return parsed;
      }
      const r = parsed.receipt;
      const reason =
        r.attempt_id !== a.id
          ? "wrong attempt"
          : r.item_id !== a.item_id
            ? "wrong item"
            : r.content_revision !== a.content_revision
              ? "wrong revision"
              : r.packet_sha256 !== a.packet_sha256
                ? "wrong packet"
                : r.challenge !== a.challenge
                  ? "wrong challenge"
                  : null;
      if (reason) {
        this.patch(a.id, { last_rejection_json: this.rejection("receipt", reason) });
        return { ok: false, reason };
      }
      if (!a.receipt_candidate_json) this.patch(a.id, { receipt_candidate_json: JSON.stringify(r) });
      return { ok: true };
    });
  }

  // ---- internals --------------------------------------------------------

  private bridgeRow(attemptId: string, capability: string): AttemptRow {
    const a = this.row(attemptId);
    if (a.capability !== capability) throw new InboxError("RECEIPT_INVALID", "Bad attempt capability.");
    if (a.revoked_at || !BLOCKING.includes(a.status)) {
      throw new InboxError("RECEIPT_INVALID", `The attempt is ${a.revoked_at ? "revoked" : a.status}.`, { status: a.status });
    }
    return a;
  }

  private blockingRow(itemId: string): AttemptRow | null {
    return this.db
      .query("SELECT * FROM attempts WHERE item_id = ? AND status IN ('in_progress', 'blocked', 'uncertain')")
      .get(itemId) as AttemptRow | null;
  }

  // Runs `fn` in a write transaction only if `gen` still owns a live, unrevoked attempt.
  private fencedWrite<T>(attemptId: string, gen: number, fn: (a: AttemptRow) => T): T {
    return this.inbox.write(() => {
      const a = this.row(attemptId);
      if (a.fencing_generation !== gen || a.revoked_at || !BLOCKING.includes(a.status)) {
        throw new InboxError("STATE_CONFLICT", "This worker no longer owns the attempt.", {
          fenced: true,
          status: a.status,
          generation: a.fencing_generation,
        });
      }
      return fn(a);
    });
  }

  private closed(a: AttemptRow): boolean {
    return !!a.revoked_at || !BLOCKING.includes(a.status);
  }

  // Bounded diagnostic of the last rejected bridge evidence: reason and time, never message text.
  private rejection(stage: "bind" | "prompt" | "receipt", reason: string): string {
    return JSON.stringify({ stage, reason: reason.slice(0, 200), at: this.inbox.now() });
  }

  private transition(attemptId: string, gen: number, status: AttemptStatus, event: string, code: string, message: string): boolean {
    return this.fencedWrite(attemptId, gen, (a) => {
      const terminal = status === "failed";
      if (!terminal && a.status !== "in_progress") return false;
      // `failed` means no side effect is left unresolved (spec §6.2); otherwise the user abandons.
      // An accepted prompt means the session already holds the handoff: never "not delivered".
      if (terminal && a.prompt_state === "accepted") {
        throw new InboxError("STATE_CONFLICT", "The session received the handoff; await the receipt, block, or abandon.");
      }
      if (terminal) {
        const open = this.db
          .query("SELECT op FROM attempt_ops WHERE attempt_id = ? AND state IN ('started', 'uncertain')")
          .all(a.id) as { op: string }[];
        if (open.length || a.prompt_state === "started" || a.prompt_state === "uncertain") {
          const steps = [...open.map((o) => o.op), ...(open.length ? [] : [`prompt ${a.prompt_state}`])];
          throw new InboxError("STATE_CONFLICT", `Unresolved external steps: ${steps.join(", ")}. Reconcile or abandon.`);
        }
      }
      this.patch(a.id, {
        status,
        error_code: code,
        error_message: message,
        ...(terminal ? { lease_owner: null, lease_expires_at: null, revoked_at: this.inbox.now() } : {}),
      });
      this.emitFor(a, event, "worker", { code, phase: a.phase });
      return true;
    });
  }

  private patch(attemptId: string, fields: Record<string, string | number | null>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.db
      .query(`UPDATE attempts SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]!), this.inbox.now(), attemptId);
  }

  private emitFor(a: AttemptRow, type: string, actor: "user" | "worker" | "bridge", meta: Record<string, unknown>) {
    const item = this.inbox.itemRow(a.item_id) as ItemRow;
    this.inbox.emit(type, actor, a.item_id, item.producer_id, a.content_revision, a.id, meta);
  }

  private expiry(ttlMs: number): string {
    return toStored(new Date(this.inbox.clock.now().getTime() + ttlMs));
  }

  private toView(a: AttemptRow): AttemptView {
    const ops = this.ops(a.id);
    const blocking = BLOCKING.includes(a.status);
    const next: string[] = [];
    if (blocking) {
      next.push("view");
      if (a.pane_id) next.push("focus");
      if (a.status !== "in_progress") next.push("retry");
      next.push("abandon");
    } else if (a.status === "succeeded") {
      // Focus is offered while the verified session may still be there (spec §4.2 step 9): not
      // when it is gone or another session holds its alias. Its reference always is.
      if (a.availability !== "closed" && a.availability !== "unknown") next.push("focus");
      next.push("copy_session_reference");
    }
    return {
      id: a.id,
      item_id: a.item_id,
      content_revision: a.content_revision,
      status: a.status,
      phase: a.phase,
      created_at: a.created_at,
      updated_at: a.updated_at,
      profile_id: a.profile_id,
      profile_override: !!a.profile_override,
      fresh: !!a.fresh,
      cwd: a.cwd,
      session_uuid: a.session_uuid,
      packet_sha256: a.packet_sha256,
      packet_path: a.packet_path,
      error: a.error_code ? { code: a.error_code, message: a.error_message ?? "" } : null,
      revoked: !!a.revoked_at,
      herdr: { session: a.herdr_session, workspace_id: a.workspace_id, tab_id: a.tab_id, pane_id: a.pane_id, agent_alias: a.agent_alias },
      availability: a.availability,
      evidence: {
        bound: !!a.binding_json,
        prompt_state: a.prompt_state,
        receipt_candidate: !!a.receipt_candidate_json,
        delivered: a.status === "succeeded",
        focused: !!a.focus_json,
        last_rejection: a.last_rejection_json ? JSON.parse(a.last_rejection_json) : null,
      },
      ops: ops.map((o) => ({ op: o.op, state: o.state, started_at: o.started_at, finished_at: o.finished_at })),
      next_actions: next,
    };
  }
}

function prevDetail(db: Inbox["db"], attemptId: string, op: OpName): Record<string, unknown> | null {
  const r = db.query("SELECT detail_json FROM attempt_ops WHERE attempt_id = ? AND op = ?").get(attemptId, op) as { detail_json: string | null } | null;
  return r?.detail_json ? (JSON.parse(r.detail_json) as Record<string, unknown>) : null;
}

const RECEIPT_KEYS = ["attempt_id", "item_id", "content_revision", "packet_sha256", "challenge"].sort().join(",");

// The marker must be the last non-empty line, with a non-empty orientation before it.
export function parseReadyMarker(message: string): { ok: true; receipt: Receipt } | { ok: false; reason: string } {
  const lines = message.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (!last.startsWith(`${READY_MARKER} `)) return { ok: false, reason: "no ready marker on the last line" };
  let body: unknown;
  try {
    body = JSON.parse(last.slice(READY_MARKER.length + 1));
  } catch {
    return { ok: false, reason: "ready marker is not valid JSON" };
  }
  const o = body as Record<string, unknown>;
  if (!o || typeof o !== "object" || Object.keys(o).sort().join(",") !== RECEIPT_KEYS) {
    return { ok: false, reason: "ready marker has the wrong fields" };
  }
  if (typeof o.attempt_id !== "string" || typeof o.item_id !== "string" || typeof o.content_revision !== "number" ||
      typeof o.packet_sha256 !== "string" || typeof o.challenge !== "string") {
    return { ok: false, reason: "ready marker has the wrong field types" };
  }
  const orientation = lines.slice(0, -1).join("\n").trim();
  if (!orientation) return { ok: false, reason: "no orientation before the marker" };
  return {
    ok: true,
    receipt: {
      attempt_id: o.attempt_id,
      item_id: o.item_id,
      content_revision: o.content_revision,
      packet_sha256: o.packet_sha256,
      challenge: o.challenge,
      orientation_chars: orientation.length,
    },
  };
}
