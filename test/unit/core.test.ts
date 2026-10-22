import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { Inbox } from "../../src/core/inbox";
import { expectCode, type Fixture, fixture } from "../helpers";

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(() => f.cleanup());

describe("submit", () => {
  test("creates an unread active item with revision 1 and an event", () => {
    const { item, created } = f.inbox.submit(f.actionable());
    expect(created).toBe(true);
    expect(item).toMatchObject({ kind: "actionable", placement: "active", read: false, content_revision: 1, profile_id: "work" });
    const ev = f.inbox.events({});
    expect(ev.events.map((e) => e.type)).toEqual(["item.created"]);
  });

  test("identical resubmission deduplicates without touching state or emitting events", () => {
    const a = f.inbox.submit(f.actionable()).item;
    f.inbox.markRead(a.id, 1);
    const before = f.inbox.events({}).events.length;
    const again = f.inbox.submit(f.actionable());
    expect(again.created).toBe(false);
    expect(again.item.id).toBe(a.id);
    expect(again.item.read).toBe(true);
    expect(f.inbox.events({}).events.length).toBe(before);
  });

  test("same bytes at a different handoff path still deduplicate", () => {
    f.inbox.submit(f.actionable());
    const p2 = f.writeHandoff("handoff-copy.md", "# Handoff\n\nSeven records were rejected.\n");
    expect(f.inbox.submit(f.actionable({ handoff_path: p2 })).created).toBe(false);
  });

  test("same key with different content is an idempotency conflict", () => {
    f.inbox.submit(f.actionable());
    expectCode(() => f.inbox.submit(f.actionable({ title: "Changed" })), "IDEMPOTENCY_CONFLICT");
  });

  test("handoff bytes are retained and survive deletion of the original", () => {
    const { item } = f.inbox.submit(f.actionable());
    rmSync(f.actionable().handoff_path as string);
    const got = f.inbox.get(item.id, { includeContext: true });
    expect(got.revision.handoff_text).toBe("# Handoff\n\nSeven records were rejected.\n");
    expect(got.revision.handoff?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("context is only included on request", () => {
    const { item } = f.inbox.submit(f.actionable());
    expect(f.inbox.get(item.id).revision.handoff_text).toBeUndefined();
  });

  test.each([
    ["unsupported api version", { api_version: 2 }, "UNSUPPORTED_API_VERSION"],
    ["unknown field", { extra: 1 }, "INVALID_ITEM"],
    ["bad kind", { kind: "task" }, "INVALID_ITEM"],
    ["control chars in title", { title: "a\u001b[31mb" }, "INVALID_ITEM"],
    ["newline in title", { title: "a\nb" }, "INVALID_ITEM"],
    ["title too long", { title: "x".repeat(201) }, "INVALID_ITEM"],
    ["relative handoff path", { handoff_path: "handoff.md" }, "INVALID_ITEM"],
    ["missing handoff file", { handoff_path: "C:\\definitely\\missing\\handoff.md" }, "INVALID_ITEM"],
    ["actionable without launch", { launch: undefined }, "INVALID_ITEM"],
    ["relative cwd", { launch: { agent: "claude-code", cwd: "proj", initial_instruction: "x" } }, "INVALID_ITEM"],
    ["unknown agent", { launch: { agent: "codex", cwd: "C:\\x", initial_instruction: "x" } }, "INVALID_ITEM"],
    ["bad producer id", { producer_id: "Example Script" }, "INVALID_ITEM"],
    ["too many refs", { context_refs: Array.from({ length: 33 }, (_, i) => ({ uri: `file:///C:/r${i}` })) }, "INVALID_ITEM"],
  ])("rejects %s", (_name, override, code) => {
    expectCode(() => f.inbox.submit(f.actionable(override)), code);
  });

  test("rejects oversize, non-UTF-8 and NUL handoffs without truncating", () => {
    const big = f.writeHandoff("big.md", "x".repeat(256 * 1024 + 1));
    expectCode(() => f.inbox.submit(f.actionable({ handoff_path: big })), "INVALID_ITEM");
    const bin = f.dir + "\\bin.md";
    writeFileSync(bin, new Uint8Array([0xff, 0xfe, 0x00]));
    expectCode(() => f.inbox.submit(f.actionable({ handoff_path: bin })), "INVALID_ITEM");
    const nul = f.writeHandoff("nul.md", "a\u0000b");
    expectCode(() => f.inbox.submit(f.actionable({ handoff_path: nul })), "INVALID_ITEM");
  });

  test("informational items cannot carry a launch", () => {
    expectCode(
      () => f.inbox.submit(f.informational({ launch: { agent: "claude-code", cwd: "C:\\x", initial_instruction: "x" } })),
      "INVALID_ITEM",
    );
  });
});

describe("update", () => {
  test("creates a new unread revision, keeping snooze and placement", () => {
    const { item } = f.inbox.submit(f.actionable());
    f.inbox.markRead(item.id, 1);
    const snoozed = f.inbox.snooze(item.id, new Date("2026-10-23T09:00:00Z"), f.inbox.get(item.id).state_version);
    const r = f.inbox.update(item.id, 1, f.actionable({ summary: "Now eight records." }));
    expect(r.changed).toBe(true);
    expect(r.item).toMatchObject({ content_revision: 2, read: false, placement: "snoozed", snoozed_until: snoozed.snoozed_until });
    expect(f.inbox.get(item.id).revision.payload.summary).toBe("Now eight records.");
  });

  test("identical update is a no-op", () => {
    const { item } = f.inbox.submit(f.actionable());
    const r = f.inbox.update(item.id, 1, f.actionable());
    expect(r.changed).toBe(false);
    expect(r.item.content_revision).toBe(1);
  });

  test("stale revision is rejected", () => {
    const { item } = f.inbox.submit(f.actionable());
    f.inbox.update(item.id, 1, f.actionable({ summary: "v2" }));
    expectCode(() => f.inbox.update(item.id, 1, f.actionable({ summary: "v3" })), "REVISION_CONFLICT");
  });

  test("cannot change identity or kind", () => {
    const { item } = f.inbox.submit(f.actionable());
    expectCode(() => f.inbox.update(item.id, 1, f.actionable({ external_id: "other" })), "INVALID_ITEM");
    expectCode(() => f.inbox.update(item.id, 1, f.informational({ producer_id: "example.script", external_id: "run-1:notice-1" })), "INVALID_ITEM");
  });

  test("cannot update or reopen an item in history", () => {
    const { item } = f.inbox.submit(f.actionable());
    f.inbox.archive(item.id, item.state_version);
    expectCode(() => f.inbox.update(item.id, 1, f.actionable({ summary: "v2" })), "ITEM_IN_HISTORY");
    expect(f.inbox.get(item.id).placement).toBe("history");
  });
});

describe("attention and placement", () => {
  test("reading keeps an informational item active; acknowledge archives it", () => {
    const { item } = f.inbox.submit(f.informational());
    const read = f.inbox.markRead(item.id, 1);
    expect(read).toMatchObject({ read: true, placement: "active" });
    const ack = f.inbox.acknowledge(item.id, read.state_version, 1);
    expect(ack).toMatchObject({ placement: "history", archive_reason: "acknowledged", read: true });
  });

  test("acknowledge reads and archives in one step and emits both events", () => {
    const { item } = f.inbox.submit(f.informational());
    f.inbox.acknowledge(item.id, item.state_version, 1);
    expect(f.inbox.events({}).events.map((e) => e.type)).toEqual(["item.created", "item.read_changed", "item.archived"]);
  });

  test("actionable items cannot be acknowledged", () => {
    const { item } = f.inbox.submit(f.actionable());
    expectCode(() => f.inbox.acknowledge(item.id, item.state_version, 1), "STATE_CONFLICT");
  });

  test("mark-read refuses a revision the user has not seen", () => {
    const { item } = f.inbox.submit(f.actionable());
    f.inbox.update(item.id, 1, f.actionable({ summary: "v2" }));
    expectCode(() => f.inbox.markRead(item.id, 1), "REVISION_CONFLICT");
  });

  test("mark-unread changes attention only", () => {
    const { item } = f.inbox.submit(f.actionable());
    f.inbox.markRead(item.id, 1);
    const u = f.inbox.markUnread(item.id);
    expect(u).toMatchObject({ read: false, placement: "active", archived_at: null });
  });

  test("stale state version is rejected", () => {
    const { item } = f.inbox.submit(f.informational());
    f.inbox.markRead(item.id, 1);
    expectCode(() => f.inbox.archive(item.id, item.state_version), "STATE_CONFLICT");
  });

  test("snooze hides from active and expires without a scheduler", () => {
    const { item } = f.inbox.submit(f.actionable());
    f.inbox.snooze(item.id, new Date("2026-10-22T10:00:00Z"), item.state_version);
    expect(f.inbox.list({ view: "active" }).items).toHaveLength(0);
    expect(f.inbox.list({ view: "snoozed" }).items).toHaveLength(1);
    expect(f.inbox.status().next_snooze_deadline).toBe("2026-10-22T10:00:00.000Z");
    f.clock.advance(60 * 60 * 1000);
    expect(f.inbox.list({ view: "active" }).items).toHaveLength(1);
    expect(f.inbox.get(item.id).placement).toBe("active");
  });

  test("snooze in the past is rejected", () => {
    const { item } = f.inbox.submit(f.actionable());
    expectCode(() => f.inbox.snooze(item.id, new Date("2026-10-22T08:00:00Z"), item.state_version), "INVALID_ARGUMENT");
  });

  test("archive is dismissal, never delivery, and clears snooze", () => {
    const { item } = f.inbox.submit(f.actionable());
    const s = f.inbox.snooze(item.id, new Date("2026-10-23T00:00:00Z"), item.state_version);
    const a = f.inbox.archive(item.id, s.state_version);
    expect(a).toMatchObject({ archive_reason: "dismissed", snoozed_until: null, placement: "history" });
  });

  test("restore returns to active, unread, keeping earlier events", () => {
    const { item } = f.inbox.submit(f.informational());
    const ack = f.inbox.acknowledge(item.id, item.state_version, 1);
    const r = f.inbox.restore(item.id, ack.state_version);
    expect(r).toMatchObject({ placement: "active", read: false, archive_reason: null });
    expect(f.inbox.events({}).events.map((e) => e.type)).toContain("item.archived");
    expectCode(() => f.inbox.restore(item.id, r.state_version), "STATE_CONFLICT");
  });

  test("unknown ids are NOT_FOUND", () => {
    expectCode(() => f.inbox.get("itm_nope"), "NOT_FOUND");
  });
});

describe("list, events and status", () => {
  test("filters by profile, producer, kind and unread; oldest first", () => {
    const a = f.inbox.submit(f.actionable()).item;
    f.clock.advance(1000);
    const b = f.inbox.submit(f.informational()).item;
    f.inbox.markRead(b.id, 1);
    expect(f.inbox.list({ view: "active" }).items.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(f.inbox.list({ view: "active", profile: "personal" }).items.map((i) => i.id)).toEqual([b.id]);
    expect(f.inbox.list({ view: "active", producer: "example.script" }).items.map((i) => i.id)).toEqual([a.id]);
    expect(f.inbox.list({ view: "active", kind: "informational" }).items.map((i) => i.id)).toEqual([b.id]);
    expect(f.inbox.list({ view: "active", unread: true }).items.map((i) => i.id)).toEqual([a.id]);
  });

  test("cursor pagination walks every item exactly once", () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(f.inbox.submit(f.informational({ external_id: `r-${i}` })).item.id);
      if (i % 2) f.clock.advance(1); // some items share a created_at; the id breaks ties
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = f.inbox.list({ view: "active", limit: 3, cursor });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    expect(seen.sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(7);
  });

  test("event polling is ordered, filterable and returns a safe cursor when empty", () => {
    f.inbox.submit(f.actionable());
    f.inbox.submit(f.informational());
    const all = f.inbox.events({});
    expect(all.events.map((e) => Number(e.cursor))).toEqual([1, 2]);
    const mine = f.inbox.events({ producer: "example.script" });
    expect(mine.events).toHaveLength(1);
    expect(mine.next_cursor).toBe("2");
    const empty = f.inbox.events({ after: "2" });
    expect(empty).toMatchObject({ events: [], next_cursor: "2", has_more: false });
    const paged = f.inbox.events({ limit: 1 });
    expect(paged).toMatchObject({ next_cursor: "1", has_more: true });
  });

  test("events never carry handoff text", () => {
    f.inbox.submit(f.actionable());
    expect(JSON.stringify(f.inbox.events({}))).not.toContain("Seven records");
  });

  test("status counts by placement and profile", () => {
    f.inbox.submit(f.actionable());
    const b = f.inbox.submit(f.informational()).item;
    f.inbox.acknowledge(b.id, b.state_version, 1);
    const s = f.inbox.status();
    expect(s.counts).toMatchObject({ active: 1, active_unread: 1, active_actionable: 1, history: 1 });
    expect(s.by_profile.work).toMatchObject({ active: 1, history: 0 });
    expect(s.by_profile.personal).toMatchObject({ active: 0, history: 1 });
    expect(s.change_token).toBe("4");
  });
});

describe("store", () => {
  test("uses WAL with the reset fix and survives reopening", () => {
    expect(f.inbox.store).toMatchObject({ journalMode: "wal", walResetFix: true, schemaVersion: 1 });
    const { item } = f.inbox.submit(f.actionable());
    const again = new Inbox({ home: f.home });
    expect(again.get(item.id).id).toBe(item.id);
    again.close();
  });

  test("refuses a store with a newer schema", () => {
    f.inbox.db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (99, 'x')");
    expectCode(() => new Inbox({ home: f.home }), "STORE_INCOMPATIBLE");
  });
});
