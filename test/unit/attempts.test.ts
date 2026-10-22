import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Attempts, type Binding, parseReadyMarker } from "../../src/core/attempts";
import { READY_MARKER, buildOpeningPrompt } from "../../src/core/packet";
import { profilesPath } from "../../src/core/profiles";
import { expectCode, type Fixture, fixture } from "../helpers";

const WORK_DIR = "C:\\Users\\me\\.claude-work";
const PERSONAL_DIR = "C:\\Users\\me\\.claude-personal";

let f: Fixture;
let at: Attempts;
beforeEach(() => {
  f = fixture();
  writeFileSync(
    profilesPath(f.home),
    JSON.stringify({
      profiles: {
        work: { label: "Work", agent: "claude-code", claude_config_dir: WORK_DIR },
        personal: { label: "Personal", agent: "claude-code", claude_config_dir: PERSONAL_DIR },
      },
    }),
  );
  at = new Attempts(f.inbox);
});
afterEach(() => f.cleanup());

function openItem() {
  const { item } = f.inbox.submit(f.actionable());
  const { attempt } = at.open(item.id, 1);
  return { item, attempt };
}

function binding(a: { session_uuid: string }, o: Partial<Binding> = {}): Binding {
  return { session_id: a.session_uuid, cwd: f.dir, claude_config_dir: WORK_DIR, auth_env: [], ...o };
}

function marker(row: ReturnType<Attempts["row"]>, o: Record<string, unknown> = {}) {
  const body = {
    attempt_id: row.id,
    item_id: row.item_id,
    content_revision: row.content_revision,
    packet_sha256: row.packet_sha256,
    challenge: row.challenge,
    ...o,
  };
  return `Orientation: seven rejected records; decision pending. I will wait.\n\n${READY_MARKER} ${JSON.stringify(body)}`;
}

// Drives an attempt to the point where only focus + commit remain.
function deliverableAttempt() {
  const { item, attempt } = openItem();
  const gen = at.claim(attempt.id, "w1", 60_000)!;
  at.setPacketPath(attempt.id, gen, "C:\\inbox\\packets\\p.md");
  const row = at.row(attempt.id);
  expect(at.bind(row.id, row.capability, binding(row))).toEqual({ ok: true });
  expect(at.beginOp(row.id, gen, "dispatch_prompt")).toBeNull();
  const prompt = buildOpeningPrompt(row.id, "C:\\inbox\\packets\\p.md", row.packet_sha256);
  expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, prompt)).toEqual({ ok: true, protocol: true });
  at.finishOp(row.id, gen, "dispatch_prompt", "confirmed");
  expect(at.captureReceipt(row.id, row.capability, row.session_uuid, marker(row))).toEqual({ ok: true });
  return { item, attempt, gen, row: at.row(attempt.id), prompt };
}

describe("open", () => {
  test("reserves one attempt with a fresh session UUID, packet and event", () => {
    const { item, attempt } = openItem();
    expect(attempt).toMatchObject({ status: "in_progress", phase: "preflight", profile_id: "work", item_id: item.id });
    expect(attempt.session_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.inbox.get(item.id).blocking_attempt_id).toBe(attempt.id);
    const packet = new TextDecoder().decode(at.row(attempt.id).packet_bytes);
    expect(packet).toContain("Seven records were rejected.");
    expect(packet).toContain(at.row(attempt.id).challenge);
    expect(JSON.stringify(attempt)).not.toContain(at.row(attempt.id).challenge);
    expect(f.inbox.events({}).events.map((e) => e.type)).toContain("handoff.started");
  });

  test("a second open returns the same attempt", () => {
    const { item, attempt } = openItem();
    const again = at.open(item.id, 1);
    expect(again).toMatchObject({ reused: true, attempt: { id: attempt.id } });
  });

  test("the database refuses a second blocking attempt", () => {
    const { attempt } = openItem();
    const row = at.row(attempt.id);
    expect(() =>
      f.inbox.db
        .query(
          `INSERT INTO attempts (id, item_id, content_revision, status, phase, created_at, updated_at, profile_id,
             launch_fingerprint, cwd, agent_kind, session_uuid, capability, challenge, packet_bytes, packet_sha256)
           VALUES ('att_x', ?, 1, 'blocked', 'preflight', 'x', 'x', 'work', 'x', 'x', 'claude-code', 'u2', 'c', 'c', x'00', 'h')`,
        )
        .run(row.item_id),
    ).toThrow();
  });

  test("blocking attempt freezes snooze, archive and producer updates; read stays allowed", () => {
    const { item } = openItem();
    const v = f.inbox.get(item.id).state_version;
    expectCode(() => f.inbox.archive(item.id, v), "ATTEMPT_IN_PROGRESS");
    expectCode(() => f.inbox.snooze(item.id, new Date("2030-01-01T00:00:00Z"), v), "ATTEMPT_IN_PROGRESS");
    expectCode(() => f.inbox.update(item.id, 1, f.actionable({ summary: "v2" })), "ATTEMPT_IN_PROGRESS");
    expect(f.inbox.markRead(item.id, 1).read).toBe(true);
  });

  test("unknown profile, informational item, stale revision and history are refused", () => {
    const { item } = f.inbox.submit(f.actionable({ profile_id: "ghost" }));
    expectCode(() => at.open(item.id, 1), "PROFILE_NOT_CONFIGURED");
    const info = f.inbox.submit(f.informational()).item;
    expectCode(() => at.open(info.id, 1), "STATE_CONFLICT");
    expectCode(() => at.open(item.id, 2), "REVISION_CONFLICT");
    f.inbox.archive(item.id, f.inbox.get(item.id).state_version);
    expectCode(() => at.open(item.id, 1), "ITEM_IN_HISTORY");
  });

  test("explicit profile override is recorded without rewriting the payload", () => {
    const { item } = f.inbox.submit(f.actionable());
    const { attempt } = at.open(item.id, 1, { profile: "personal" });
    expect(attempt).toMatchObject({ profile_id: "personal", profile_override: true });
    expect(f.inbox.get(item.id).revision.payload.profile_id).toBe("work");
  });
});

describe("lease and fencing", () => {
  test("a live lease excludes other workers; expiry lets a replacement in and fences the old one", () => {
    const { attempt } = openItem();
    const g1 = at.claim(attempt.id, "w1", 30_000)!;
    expect(at.claim(attempt.id, "w2", 30_000)).toBeNull();
    f.clock.advance(31_000);
    const g2 = at.claim(attempt.id, "w2", 30_000)!;
    expect(g2).toBeGreaterThan(g1);
    const e = expectCode(() => at.setPhase(attempt.id, g1, "create_layout"), "STATE_CONFLICT");
    expect(e.details?.fenced).toBe(true);
    at.setPhase(attempt.id, g2, "create_layout");
  });

  test("abandon revokes, fences the worker and releases the item", () => {
    const { item, attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 30_000)!;
    const ab = at.abandon(attempt.id);
    expect(ab).toMatchObject({ status: "failed", revoked: true, error: { code: "ABANDONED" } });
    expectCode(() => at.setPhase(attempt.id, g, "focus"), "STATE_CONFLICT");
    expect(f.inbox.get(item.id).blocking_attempt_id).toBeNull();
    const second = at.open(item.id, 1);
    expect(second.reused).toBe(false);
    expect(second.attempt.session_uuid).not.toBe(attempt.session_uuid);
  });

  test("an op already started is not started again", () => {
    const { attempt } = openItem();
    const g1 = at.claim(attempt.id, "w1", 1000)!;
    expect(at.beginOp(attempt.id, g1, "create_tab")).toBeNull();
    f.clock.advance(2000);
    const g2 = at.claim(attempt.id, "w2", 1000)!;
    expect(at.beginOp(attempt.id, g2, "create_tab")).toBe("started");
  });

  test("dispatch intent becomes uncertain when its result is lost", () => {
    const { attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 1000)!;
    at.beginOp(attempt.id, g, "dispatch_prompt");
    at.finishOp(attempt.id, g, "dispatch_prompt", "uncertain");
    at.markUncertain(attempt.id, g, "DELIVERY_UNCERTAIN", "Prompt response lost.");
    expect(at.get(attempt.id)).toMatchObject({ status: "uncertain", evidence: { prompt_state: "uncertain" } });
  });
});

describe("bridge validation", () => {
  test("binding rejects wrong session, cwd, profile config and auth env, and blocks the attempt", () => {
    const cases: [Partial<Binding>, string][] = [
      [{ session_id: "00000000-0000-0000-0000-000000000000" }, "RECEIPT_INVALID"],
      [{ cwd: "C:\\elsewhere" }, "RECEIPT_INVALID"],
      [{ claude_config_dir: PERSONAL_DIR }, "PROFILE_LAUNCH_UNSUPPORTED"],
      [{ auth_env: ["ANTHROPIC_API_KEY"] }, "PROFILE_LAUNCH_UNSUPPORTED"],
    ];
    for (const [o, code] of cases) {
      const { item, attempt } = openItem();
      const row = at.row(attempt.id);
      const r = at.bind(row.id, row.capability, binding(row, o));
      expect(r).toMatchObject({ ok: false, code });
      expect(at.get(attempt.id).status).toBe("blocked");
      at.abandon(attempt.id);
      f.inbox.db.run("DELETE FROM attempt_ops");
      f.inbox.db.run("DELETE FROM attempts");
      f.inbox.db.run("DELETE FROM events");
      f.inbox.db.query("DELETE FROM item_revisions WHERE item_id = ?").run(item.id);
      f.inbox.db.query("DELETE FROM items WHERE id = ?").run(item.id);
    }
  });

  test("config dir comparison ignores case and trailing slashes", () => {
    const { attempt } = openItem();
    const row = at.row(attempt.id);
    expect(at.bind(row.id, row.capability, binding(row, { claude_config_dir: WORK_DIR.toUpperCase() + "\\" }))).toEqual({ ok: true });
  });

  test("bad capability is refused outright", () => {
    const { attempt } = openItem();
    const row = at.row(attempt.id);
    expectCode(() => at.bind(row.id, "nope", binding(row)), "RECEIPT_INVALID");
  });

  test("prompt guard fails closed until dispatch is recorded, then accepts exactly once", () => {
    const { attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 60_000)!;
    at.setPacketPath(attempt.id, g, "C:\\p.md");
    const row = at.row(attempt.id);
    const prompt = buildOpeningPrompt(row.id, "C:\\p.md", row.packet_sha256);
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, prompt).ok).toBe(false); // not bound
    at.bind(row.id, row.capability, binding(row));
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, prompt).ok).toBe(false); // no dispatch intent
    at.beginOp(row.id, g, "dispatch_prompt");
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, "something else").ok).toBe(false);
    expect(at.acceptPrompt(row.id, row.capability, "other-session", f.dir, prompt).ok).toBe(false);
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, prompt)).toEqual({ ok: true, protocol: true });
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, prompt).ok).toBe(false); // duplicate
  });

  test.each([
    ["wrong attempt", { attempt_id: "att_other" }],
    ["wrong item", { item_id: "itm_other" }],
    ["wrong revision", { content_revision: 2 }],
    ["wrong packet", { packet_sha256: "0".repeat(64) }],
    ["wrong challenge", { challenge: "guess" }],
  ])("receipt with %s is rejected", (reason, o) => {
    const { row } = (() => {
      const { attempt } = openItem();
      const g = at.claim(attempt.id, "w1", 60_000)!;
      at.setPacketPath(attempt.id, g, "C:\\p.md");
      const r = at.row(attempt.id);
      at.bind(r.id, r.capability, binding(r));
      at.beginOp(r.id, g, "dispatch_prompt");
      at.acceptPrompt(r.id, r.capability, r.session_uuid, f.dir, buildOpeningPrompt(r.id, "C:\\p.md", r.packet_sha256));
      return { row: at.row(attempt.id) };
    })();
    expect(at.captureReceipt(row.id, row.capability, row.session_uuid, marker(row, o))).toEqual({ ok: false, reason });
    expect(at.get(row.id).evidence.receipt_candidate).toBe(false);
  });

  test("receipt from another session or before prompt acceptance is rejected", () => {
    const { attempt } = openItem();
    const row = at.row(attempt.id);
    expect(at.captureReceipt(row.id, row.capability, row.session_uuid, marker(row)).ok).toBe(false);
    const d = deliverableAttempt();
    expect(at.captureReceipt(d.row.id, d.row.capability, "someone-else", marker(d.row)).ok).toBe(false);
  });

  test("late receipt for an abandoned attempt cannot satisfy anything", () => {
    const { row } = deliverableAttempt();
    at.abandon(row.id);
    expectCode(() => at.captureReceipt(row.id, row.capability, row.session_uuid, marker(row)), "RECEIPT_INVALID");
  });

  test("marker parsing", () => {
    expect(parseReadyMarker("no marker").ok).toBe(false);
    expect(parseReadyMarker(`${READY_MARKER} {"a":1}`).ok).toBe(false);
    const good = `Hi.\n${READY_MARKER} {"attempt_id":"a","item_id":"i","content_revision":1,"packet_sha256":"p","challenge":"c"}\n`;
    expect(parseReadyMarker(good)).toMatchObject({ ok: true, receipt: { attempt_id: "a", orientation_chars: 3 } });
    expect(parseReadyMarker(good.replace("Hi.\n", "")).ok).toBe(false); // no orientation
    expect(parseReadyMarker(good + "trailing text").ok).toBe(false); // marker not last
  });
});

describe("delivery", () => {
  test("commit archives as delivered atomically with events", () => {
    const { item, attempt, gen } = deliverableAttempt();
    const done = at.commitDelivery(attempt.id, gen, { focused: true });
    expect(done).toMatchObject({ status: "succeeded", availability: "live", evidence: { delivered: true, focused: true } });
    expect(f.inbox.get(item.id)).toMatchObject({ placement: "history", archive_reason: "delivered", blocking_attempt_id: null });
    const types = f.inbox.events({}).events.map((e) => e.type);
    expect(types.slice(-2)).toEqual(["handoff.delivered", "item.archived"]);
  });

  test("no commit without binding, accepted prompt and receipt", () => {
    const { attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 60_000)!;
    expectCode(() => at.commitDelivery(attempt.id, g, {}), "RECEIPT_INVALID");
    expect(at.get(attempt.id).status).toBe("in_progress");
  });

  test("a stale worker cannot commit after a replacement took over", () => {
    const { attempt, gen } = deliverableAttempt();
    f.clock.advance(61_000);
    const g2 = at.claim(attempt.id, "w2", 60_000)!;
    expectCode(() => at.commitDelivery(attempt.id, gen, {}), "STATE_CONFLICT");
    expect(at.commitDelivery(attempt.id, g2, {}).status).toBe("succeeded");
  });

  test("restored delivered revision returns ALREADY_DELIVERED unless --fresh", () => {
    const { item, attempt, gen } = deliverableAttempt();
    at.commitDelivery(attempt.id, gen, {});
    const restored = f.inbox.restore(item.id, f.inbox.get(item.id).state_version);
    const e = expectCode(() => at.open(item.id, 1), "ALREADY_DELIVERED");
    expect(e.details?.attempt_id).toBe(attempt.id);
    const fresh = at.open(item.id, restored.content_revision, { fresh: true });
    expect(fresh.attempt).toMatchObject({ fresh: true, status: "in_progress" });
    expect(at.get(attempt.id).status).toBe("succeeded");
  });
});

describe("review round 1 guards", () => {
  test("a failed dispatch the bridge accepted anyway can never be sent again", () => {
    const { attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 60_000)!;
    at.setPacketPath(attempt.id, g, "C:\p.md");
    const row = at.row(attempt.id);
    at.bind(row.id, row.capability, binding(row));
    const prompt = buildOpeningPrompt(row.id, "C:\p.md", row.packet_sha256);
    at.beginOp(row.id, g, "dispatch_prompt");
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, prompt).ok).toBe(true);
    at.finishOp(row.id, g, "dispatch_prompt", "failed"); // Herdr answered an error after the prompt landed
    expect(at.get(row.id).evidence.prompt_state).toBe("accepted");
    expectCode(() => at.clearFailedOp(row.id, g, "dispatch_prompt"), "STATE_CONFLICT");
    expect(at.beginOp(row.id, g, "dispatch_prompt")).toBe("failed"); // op kept, nothing restarted
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, prompt)).toMatchObject({ ok: false, code: "ALREADY_ACCEPTED" });
  });

  test("a definitive rejection allows exactly one more dispatch", () => {
    const { attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 60_000)!;
    at.setPacketPath(attempt.id, g, "C:\p.md");
    at.beginOp(attempt.id, g, "dispatch_prompt");
    at.finishOp(attempt.id, g, "dispatch_prompt", "failed");
    expect(at.get(attempt.id).evidence.prompt_state).toBe("rejected");
    at.clearFailedOp(attempt.id, g, "dispatch_prompt");
    expect(at.beginOp(attempt.id, g, "dispatch_prompt")).toBeNull();
    expect(at.get(attempt.id).evidence.prompt_state).toBe("started");
  });

  test("no delivery after the bridge saw the session replaced, even after resume", () => {
    const { attempt, gen, row } = deliverableAttempt();
    const r = at.bind(row.id, row.capability, binding(row, { session_id: "replaced-by-clear" }));
    expect(r).toMatchObject({ ok: false, code: "RECEIPT_INVALID" });
    expectCode(() => at.commitDelivery(attempt.id, gen, {}), "STATE_CONFLICT");
    expect(at.get(attempt.id)).toMatchObject({ status: "blocked", evidence: { receipt_candidate: false, last_rejection: { stage: "bind" } } });
    at.resume(attempt.id, gen);
    expectCode(() => at.commitDelivery(attempt.id, gen, {}), "RECEIPT_INVALID"); // the old receipt is gone
    expect(f.inbox.get(row.item_id).placement).toBe("active");
  });

  test("uncertain attempts cannot commit either", () => {
    const { attempt, gen } = deliverableAttempt();
    at.markUncertain(attempt.id, gen, "DELIVERY_UNCERTAIN", "Focus result lost.");
    expectCode(() => at.commitDelivery(attempt.id, gen, {}), "STATE_CONFLICT");
  });

  test("fail is refused while an external step is unresolved; abandon still works", () => {
    const { item, attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 60_000)!;
    at.beginOp(attempt.id, g, "dispatch_prompt");
    at.finishOp(attempt.id, g, "dispatch_prompt", "uncertain");
    expectCode(() => at.fail(attempt.id, g, "X", "x"), "STATE_CONFLICT");
    expect(f.inbox.get(item.id).blocking_attempt_id).toBe(attempt.id);
    at.beginOp(attempt.id, g, "create_tab"); // started, never finished
    expect(at.abandon(attempt.id).status).toBe("failed");
  });

  test("prompt results say whether the prompt was a protocol prompt, with a stable code", () => {
    const { row, prompt } = deliverableAttempt();
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, "fix the login bug")).toMatchObject({ ok: false, protocol: false, code: "NOT_PROTOCOL" });
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, `${prompt} extra`)).toMatchObject({ ok: false, protocol: true, code: "PROMPT_MISMATCH" });
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, "C:\elsewhere", prompt)).toMatchObject({ ok: false, protocol: true, code: "WRONG_CWD" });
    expect(at.get(row.id).evidence.last_rejection).toMatchObject({ stage: "prompt", reason: "working directory does not match" });
  });

  test("after delivery or abandon, later prompts get an answer instead of an error", () => {
    const { attempt, gen, row, prompt } = deliverableAttempt();
    at.commitDelivery(attempt.id, gen, {});
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, "next question")).toMatchObject({ ok: false, protocol: false, code: "ATTEMPT_CLOSED" });
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, f.dir, prompt)).toMatchObject({ ok: false, protocol: true, code: "ATTEMPT_CLOSED" });
    expectCode(() => at.acceptPrompt(row.id, "bad-capability", row.session_uuid, f.dir, prompt), "RECEIPT_INVALID");
  });

  test("a malformed or mismatched ready marker leaves a diagnostic; an ordinary reply does not", () => {
    const { attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 60_000)!;
    at.setPacketPath(attempt.id, g, "C:\p.md");
    const r = at.row(attempt.id);
    at.bind(r.id, r.capability, binding(r));
    at.beginOp(r.id, g, "dispatch_prompt");
    at.acceptPrompt(r.id, r.capability, r.session_uuid, f.dir, buildOpeningPrompt(r.id, "C:\p.md", r.packet_sha256));
    at.captureReceipt(r.id, r.capability, r.session_uuid, "Still reading.");
    expect(at.get(r.id).evidence.last_rejection).toBeNull();
    at.captureReceipt(r.id, r.capability, r.session_uuid, marker(r, { challenge: "guess" }));
    expect(at.get(r.id).evidence.last_rejection).toMatchObject({ stage: "receipt", reason: "wrong challenge" });
    const view = JSON.stringify(at.get(r.id));
    expect(view).not.toContain("Orientation: seven");
  });

  test("the packet path is fixed once dispatch began", () => {
    const { attempt } = openItem();
    const g = at.claim(attempt.id, "w1", 60_000)!;
    at.setPacketPath(attempt.id, g, "C:\p.md");
    at.beginOp(attempt.id, g, "dispatch_prompt");
    at.setPacketPath(attempt.id, g, "C:\p.md"); // same path is a no-op
    expectCode(() => at.setPacketPath(attempt.id, g, "C:\q.md"), "STATE_CONFLICT");
  });
});
