import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RECEIPT_PENDING_FILE, safeHandle } from "../../src/bridge/hooks";
import { writeBridgeSettings } from "../../src/bridge/settings";
import { type AttemptRow, Attempts } from "../../src/core/attempts";
import type { InboxConfig } from "../../src/core/config";
import { InboxError } from "../../src/core/errors";
import { Inbox } from "../../src/core/inbox";
import { READY_MARKER } from "../../src/core/packet";
import { profilesPath } from "../../src/core/profiles";
import { reconcile } from "../../src/worker/reconcile";
import { Worker, needsWorker } from "../../src/worker/worker";
import { FakeHerdr, type FakeHooks, SOCKET } from "./fixtures/fake-herdr";
import { expectCode, type Fixture, fixture } from "../helpers";

// Fault injection (spec §15 "Crash and storage recovery"). A crash is a worker process that
// dies at a phase boundary: the effect it just caused has happened, and from that moment none of
// its writes reach the store. Recovery is then reconcile (on every read) and an explicit retry.

let f: Fixture;
let at: Attempts;
let workDir: string;
const config: InboxConfig = { herdr: { socket_path: SOCKET, workspace_label: "Agent Inbox" } };
const timing = { pollMs: 1, bindTimeoutMs: 150, receiptTimeoutMs: 150, blockedWatchMs: 300 };

beforeEach(() => {
  f = fixture();
  workDir = join(f.dir, "claude-work");
  mkdirSync(workDir);
  writeFileSync(profilesPath(f.home), JSON.stringify({ profiles: { work: { label: "Work", agent: "claude-code", claude_config_dir: workDir } } }));
  at = new Attempts(f.inbox);
});
afterEach(() => f.cleanup());

function openAttempt(overrides: Record<string, unknown> = {}) {
  const { item } = f.inbox.submit(f.actionable(overrides));
  return at.open(item.id, 1).attempt;
}

function marker(row: AttemptRow) {
  const body = { attempt_id: row.id, item_id: row.item_id, content_revision: row.content_revision, packet_sha256: row.packet_sha256, challenge: row.challenge };
  return `Oriented: seven records were rejected. I will wait.\n\n${READY_MARKER} ${JSON.stringify(body)}`;
}

// The receipt bridge as the real hooks play it inside Claude.
function bridge(attemptId: string): FakeHooks {
  return {
    onStart: (agent) => {
      const row = at.row(attemptId);
      at.bind(row.id, row.capability, { session_id: agent.session!, cwd: row.cwd, claude_config_dir: workDir, auth_env: [] });
    },
    onPrompt: (agent, text) => {
      const row = at.row(attemptId);
      at.acceptPrompt(row.id, row.capability, agent.session!, row.cwd, text);
      at.captureReceipt(row.id, row.capability, agent.session!, marker(row));
      agent.agent_status = "idle";
      agent.state_change_seq += 2;
    },
  };
}

function worker(fake: FakeHerdr, attemptId: string, retry = false) {
  return new Worker(attemptId, { inbox: f.inbox, herdr: fake.herdr(), config, owner: retry ? "w-retry" : "w-first", timing, retry });
}

class Crash extends Error {}

const WRITES = ["setPhase", "setPacketPath", "recordLayout", "beginOp", "finishOp", "clearFailedOp", "block", "markUncertain", "fail", "resume", "commitDelivery", "renew", "release"] as const;

// Runs the first worker until `trip` matches a store write, which then never happens; neither
// does any write after it (the process is gone, its lease simply lapses).
async function runUntilCrash(fake: FakeHerdr, attemptId: string, trip: (method: string, args: unknown[]) => boolean) {
  let dead = false;
  const spies: Mock<(...a: unknown[]) => unknown>[] = [];
  for (const m of WRITES) {
    const original = Attempts.prototype[m] as (...a: unknown[]) => unknown;
    spies.push(
      spyOn(Attempts.prototype, m).mockImplementation(function (this: Attempts, ...args: unknown[]) {
        if (dead || trip(m, args)) {
          dead = true;
          throw new Crash(`crashed at ${m}`);
        }
        return original.apply(this, args);
      }) as unknown as Mock<(...a: unknown[]) => unknown>,
    );
  }
  try {
    await worker(fake, attemptId).run();
  } finally {
    for (const s of spies) s.mockRestore();
  }
  expect(dead).toBe(true);
  // The dead worker's lease lapses.
  f.clock.advance(61_000);
}

const count = (fake: FakeHerdr, verb: string) => fake.verbs().filter((v) => v === verb).length;
const finishing = (op: string) => (m: string, a: unknown[]) => m === "finishOp" && a[2] === op && a[3] === "confirmed";

describe("a crash at each phase boundary: no false delivery, no blind replay", () => {
  const cases: { name: string; trip: (m: string, a: unknown[]) => boolean; reconciled: "uncertain" | "succeeded" | "in_progress" }[] = [
    { name: "after the tab was created", trip: finishing("create_tab"), reconciled: "uncertain" },
    { name: "after Claude was started", trip: finishing("start_agent"), reconciled: "uncertain" },
    { name: "after the opening prompt was sent", trip: finishing("dispatch_prompt"), reconciled: "uncertain" },
    { name: "after the receipt was captured", trip: (m, a) => m === "setPhase" && a[2] === "focus", reconciled: "uncertain" },
    { name: "after the focus, before the final commit", trip: (m) => m === "commitDelivery", reconciled: "succeeded" },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const attempt = openAttempt();
      const fake = new FakeHerdr(bridge(attempt.id));
      await runUntilCrash(fake, attempt.id, c.trip);
      expect(at.get(attempt.id).evidence.delivered).toBe(false);
      // Reconcile on the next read: it calls nothing and delivers only on full evidence.
      const calls = fake.calls.length;
      reconcile(f.inbox);
      expect(fake.calls.length).toBe(calls);
      const after = at.get(attempt.id);
      expect(after.status).toBe(c.reconciled);
      if (after.status === "succeeded") {
        expect(after.evidence).toMatchObject({ bound: true, prompt_state: "accepted", receipt_candidate: true, focused: true });
      } else {
        // An explicit retry finishes it, repeating no step that may have happened.
        expect(await worker(fake, attempt.id, true).run()).toMatchObject({ status: "succeeded" });
      }
      expect(count(fake, "tab create")).toBe(1);
      expect(count(fake, "agent start")).toBe(1);
      expect(count(fake, "agent prompt")).toBe(1);
      expect(f.inbox.get(attempt.item_id)).toMatchObject({ placement: "history", archive_reason: "delivered" });
    });
  }

  test("after the focus, before the commit: retry commits without focusing again", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge(attempt.id));
    await runUntilCrash(fake, attempt.id, (m) => m === "commitDelivery");
    expect(await worker(fake, attempt.id, true).run()).toMatchObject({ status: "succeeded" });
    expect(count(fake, "agent focus")).toBe(1);
  });

  test("a crash before the tab answer was recorded: no second tab, ever", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge(attempt.id));
    // Dies the moment it tries to record the new tab's ids.
    await runUntilCrash(fake, attempt.id, (m, a) => m === "recordLayout" && typeof (a[2] as { tab_id?: string }).tab_id === "string");
    reconcile(f.inbox);
    expect(at.get(attempt.id).status).toBe("uncertain");
    expect(await worker(fake, attempt.id, true).run()).toMatchObject({ status: "uncertain", error: { code: "DELIVERY_UNCERTAIN" } });
    expect(count(fake, "tab create")).toBe(1);
    expect(count(fake, "agent start")).toBe(0);
  });
});

describe("a lost prompt answer", () => {
  test("leaves the attempt uncertain, and opening the item again creates no second session", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(attempt.id), onPrompt: () => ({ timeout: true }) });
    expect(await worker(fake, attempt.id).run()).toMatchObject({ status: "uncertain", evidence: { prompt_state: "uncertain" } });
    for (let i = 0; i < 3; i++) {
      const again = at.open(attempt.item_id, 1);
      expect(again).toMatchObject({ reused: true, attempt: { id: attempt.id } });
      // `open` starts a worker only for an attempt with nothing external recorded.
      expect(needsWorker(f.inbox, attempt.id)).toBe(false);
    }
    expect(count(fake, "agent start")).toBe(1);
    expect(count(fake, "agent prompt")).toBe(1);
  });
});

describe("storage faults", () => {
  function snapshot(inbox: Inbox) {
    return {
      items: inbox.db.query("SELECT * FROM items ORDER BY id").all(),
      revisions: inbox.db.query("SELECT item_id, revision, payload_json, received_at FROM item_revisions ORDER BY item_id, revision").all(),
      attempts: inbox.db.query("SELECT id, status, phase, packet_sha256, session_uuid FROM attempts ORDER BY id").all(),
      ops: inbox.db.query("SELECT * FROM attempt_ops ORDER BY attempt_id, op").all(),
      events: inbox.db.query("SELECT * FROM events ORDER BY seq").all(),
    };
  }

  function someHistory() {
    const { item } = f.inbox.submit(f.actionable());
    f.inbox.update(item.id, 1, f.actionable({ summary: "Now eight records." }));
    f.inbox.submit(f.informational());
    const { attempt } = at.open(item.id, 2);
    const g = at.claim(attempt.id, "w", 60_000)!;
    at.beginOp(attempt.id, g, "create_tab", { workspace_id: "w1" });
  }

  test("a busy store refuses writes with STORE_BUSY and keeps every committed row", () => {
    someHistory();
    const before = snapshot(f.inbox);
    const other = new Inbox({ home: f.home, store: { busyTimeoutMs: 100 } });
    f.inbox.db.run("BEGIN IMMEDIATE");
    try {
      expectCode(() => other.submit(f.actionable({ external_id: "while-busy" })), "STORE_BUSY");
      const id = (before.items[0] as { id: string }).id;
      expectCode(() => new Attempts(other).abandon((before.attempts[0] as { id: string }).id), "STORE_BUSY");
      expect(() => other.markUnread(id)).toThrow();
    } finally {
      f.inbox.db.run("ROLLBACK");
    }
    expect(snapshot(other)).toEqual(before);
    other.close();
  });

  test("a backup and restore keeps items, revisions, attempts, ops and events", () => {
    someHistory();
    const before = snapshot(f.inbox);
    const restoredHome = join(f.dir, "restored");
    mkdirSync(restoredHome);
    f.inbox.db.run(`VACUUM INTO '${join(restoredHome, "inbox.db").replace(/'/g, "''")}'`);
    const restored = new Inbox({ home: restoredHome });
    expect(snapshot(restored)).toEqual(before);
    const itemId = (before.items[0] as { id: string }).id;
    expect(restored.get(itemId, { includeContext: true }).revision.handoff_text).toBe(f.inbox.get(itemId, { includeContext: true }).revision.handoff_text);
    restored.close();
  });

  test("a full store leaves no partial item, attempt or event and says so clearly", () => {
    someHistory();
    const { item: waiting } = f.inbox.submit(f.actionable({ external_id: "waiting" }));
    const pages = (f.inbox.db.query("PRAGMA page_count").get() as { page_count: number }).page_count;
    f.inbox.db.run(`PRAGMA max_page_count = ${pages}`);
    const before = snapshot(f.inbox);
    const big = f.writeHandoff("big.md", `# Big\n\n${"x".repeat(200 * 1024)}\n`);
    const e = expectCode(() => f.inbox.submit(f.actionable({ external_id: "big", handoff_path: big })), "STORE_ERROR") as InboxError;
    expect(e.message).toContain("full");
    expect(e.details).toEqual({ reason: "full" });
    expect(e.retryable).toBe(false);
    // Opening a session needs room for its packet: refused the same way, nothing half-written.
    expectCode(() => at.open(waiting.id, 1), "STORE_ERROR");
    expect(snapshot(f.inbox)).toEqual(before);
    // With room again, the same submission goes through.
    f.inbox.db.run("PRAGMA max_page_count = 1073741823");
    expect(f.inbox.submit(f.actionable({ external_id: "big", handoff_path: big })).created).toBe(true);
  });
});

describe("bridge faults carried from earlier reviews", () => {
  function prepared() {
    const attempt = openAttempt();
    const g = at.claim(attempt.id, "w", 60_000)!;
    at.setPacketPath(attempt.id, g, join(f.dir, "p.md"));
    const row = at.row(attempt.id);
    const files = writeBridgeSettings({ home: f.home, attemptId: row.id, capability: row.capability });
    const ctx = { home: f.home, attemptId: row.id, capability: row.capability, bridgePath: files.bridgePath };
    const env = { CLAUDE_CONFIG_DIR: workDir };
    return { row, g, files, ctx, env, pending: join(files.dir, RECEIPT_PENDING_FILE) };
  }

  const busy = () => new InboxError("STORE_BUSY", "busy");

  test("a busy Stop whose reply is no receipt saves nothing aside", () => {
    const { row, ctx, env, pending } = prepared();
    const spy = spyOn(Attempts.prototype, "captureReceipt").mockImplementation(() => {
      throw busy();
    });
    try {
      expect(safeHandle("stop", ctx, { session_id: row.session_uuid, last_assistant_message: "Still reading." }, env)).toEqual({ exitCode: 0 });
      expect(safeHandle("stop", ctx, { session_id: row.session_uuid, last_assistant_message: `${READY_MARKER} {"broken"` }, env)).toEqual({ exitCode: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(existsSync(pending)).toBe(false);
  });

  test("a busy Stop that began before a refused startup (/clear) cannot bring its receipt back", () => {
    const { row, ctx, env, pending } = prepared();
    at.bind(row.id, row.capability, { session_id: row.session_uuid, cwd: row.cwd, claude_config_dir: workDir, auth_env: [] });
    // The Stop starts, finds the store busy...
    const startedAt = new Date(f.clock.now().getTime() - 1000).toISOString();
    // ...meanwhile /clear replaces the session and the bridge refuses it...
    at.bind(row.id, row.capability, { session_id: "00000000-0000-4000-8000-000000000000", cwd: row.cwd, claude_config_dir: workDir, auth_env: [] });
    // ...then the Stop writes its receipt aside, stamped with its own start.
    const spy = spyOn(Attempts.prototype, "captureReceipt").mockImplementation(() => {
      throw busy();
    });
    try {
      safeHandle("stop", { ...ctx, startedAt }, { session_id: row.session_uuid, last_assistant_message: marker(row) }, env);
    } finally {
      spy.mockRestore();
    }
    expect(JSON.parse(readFileSync(pending, "utf8")).written_at).toBe(startedAt);
    expect(reconcile(f.inbox).receipts_replayed).toBe(0);
    expect(at.get(row.id).evidence.receipt_candidate).toBe(false);
  });

  test("a SessionStart that meets a busy store is tried once more and binds", () => {
    const { row, ctx, env } = prepared();
    const original = Attempts.prototype.bind;
    let calls = 0;
    const spy = spyOn(Attempts.prototype, "bind").mockImplementation(function (this: Attempts, ...args: Parameters<Attempts["bind"]>) {
      if (++calls === 1) throw busy();
      return original.apply(this, args);
    });
    try {
      expect(safeHandle("session-start", ctx, { session_id: row.session_uuid, cwd: row.cwd }, env)).toEqual({ exitCode: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(2);
    expect(at.get(row.id).evidence.bound).toBe(true);
  });
});
