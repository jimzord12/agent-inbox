import type { Database } from "bun:sqlite";
import { type Clock, newId, systemClock, toStored } from "./clock";
import { openStore, type StoreInfo } from "./db";
import { InboxError, fromStoreError } from "./errors";
import { dbPath, ensureHome } from "./home";
import {
  type CapturedHandoff,
  type Limits,
  type Submission,
  DEFAULT_LIMITS,
  captureHandoff,
  contentHash,
  parseSubmission,
} from "./submission";

export type View = "active" | "snoozed" | "history";
export type Placement = View;
export type ArchiveReason = "acknowledged" | "dismissed" | "delivered";
export type Actor = "producer" | "user" | "worker" | "bridge";

export interface ItemRow {
  id: string;
  producer_id: string;
  external_id: string;
  kind: "informational" | "actionable";
  created_at: string;
  updated_at: string;
  content_revision: number;
  state_version: number;
  read_revision: number | null;
  snoozed_until: string | null;
  archived_at: string | null;
  archive_reason: ArchiveReason | null;
  profile_id: string;
  title: string;
}

export interface RevisionRow {
  item_id: string;
  revision: number;
  payload_json: string;
  content_sha256: string;
  handoff_bytes: Uint8Array | null;
  handoff_source: string | null;
  handoff_sha256: string | null;
  received_at: string;
}

interface EventRow {
  seq: number;
  id: string;
  at: string;
  type: string;
  actor: Actor;
  item_id: string;
  producer_id: string;
  revision: number | null;
  attempt_id: string | null;
  meta_json: string | null;
}

// The item as clients see it. Times are UTC ISO-8601 (`Z`), i.e. offset-qualified.
export interface ItemView {
  id: string;
  producer_id: string;
  external_id: string;
  kind: "informational" | "actionable";
  title: string;
  profile_id: string;
  created_at: string;
  updated_at: string;
  content_revision: number;
  state_version: number;
  read: boolean;
  read_revision: number | null;
  placement: Placement;
  snoozed_until: string | null;
  archived_at: string | null;
  archive_reason: ArchiveReason | null;
  blocking_attempt_id: string | null;
}

export interface ItemDetail extends ItemView {
  revision: {
    number: number;
    received_at: string;
    content_sha256: string;
    payload: Submission;
    handoff: { sha256: string; bytes: number; source: string; captured_at: string } | null;
    handoff_text?: string;
  };
}

export interface EventView {
  cursor: string;
  id: string;
  at: string;
  type: string;
  actor: Actor;
  item_id: string;
  producer_id: string;
  revision: number | null;
  attempt_id: string | null;
  meta: Record<string, unknown>;
}

export interface ListOptions {
  view: View;
  profile?: string;
  producer?: string;
  kind?: "informational" | "actionable";
  unread?: boolean;
  limit?: number;
  cursor?: string;
}

export interface InboxOptions {
  home: string;
  clock?: Clock;
  limits?: Limits;
}

const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;
const utf8Decoder = new TextDecoder();

export class Inbox {
  readonly db: Database;
  readonly store: StoreInfo;
  readonly home: string;
  readonly clock: Clock;
  private readonly limits: Limits;

  constructor(opts: InboxOptions) {
    this.home = ensureHome(opts.home);
    this.clock = opts.clock ?? systemClock;
    this.limits = opts.limits ?? DEFAULT_LIMITS;
    const { db, info } = openStore(dbPath(this.home));
    this.db = db;
    this.store = info;
  }

  close() {
    this.db.close();
  }

  /** @internal */
  now(): string {
    return toStored(this.clock.now());
  }

  // Short IMMEDIATE write transaction; SQLite failures become stable inbox errors.
  /** @internal */
  write<T>(fn: () => T): T {
    try {
      return this.db.transaction(fn).immediate();
    } catch (err) {
      throw fromStoreError(err);
    }
  }

  /** @internal */
  read<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw fromStoreError(err);
    }
  }

  // ---- producer surface -------------------------------------------------

  // Validate, capture the handoff bytes, then create or deduplicate atomically (spec §6.3).
  submit(raw: unknown): { item: ItemView; created: boolean } {
    const sub = parseSubmission(raw, this.limits);
    const handoff = sub.handoff_path ? captureHandoff(sub.handoff_path, this.limits) : null;
    const hash = contentHash(sub, handoff);
    return this.write(() => {
      const existing = this.db
        .query("SELECT * FROM items WHERE producer_id = ? AND external_id = ?")
        .get(sub.producer_id, sub.external_id) as ItemRow | null;
      if (existing) {
        const rev = this.revisionRow(existing.id, existing.content_revision);
        if (rev.content_sha256 !== hash) {
          throw new InboxError(
            "IDEMPOTENCY_CONFLICT",
            "An item with this producer_id and external_id already exists with different content; use `update`.",
            { item_id: existing.id, content_revision: existing.content_revision },
          );
        }
        return { item: this.toView(existing), created: false };
      }
      const now = this.now();
      const id = newId("itm", this.clock);
      this.db
        .query(
          `INSERT INTO items (id, producer_id, external_id, kind, created_at, updated_at, content_revision,
             state_version, read_revision, snoozed_until, archived_at, archive_reason, profile_id, title)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run(id, sub.producer_id, sub.external_id, sub.kind, now, now, sub.profile_id, sub.title);
      this.insertRevision(id, 1, sub, hash, handoff, now);
      this.emit("item.created", "producer", id, sub.producer_id, 1, null, { kind: sub.kind, profile_id: sub.profile_id });
      return { item: this.toView(this.itemRow(id)), created: true };
    });
  }

  // Complete content replacement guarded by the expected revision (spec §6.3).
  update(itemId: string, ifRevision: number, raw: unknown): { item: ItemView; changed: boolean } {
    const sub = parseSubmission(raw, this.limits);
    const handoff = sub.handoff_path ? captureHandoff(sub.handoff_path, this.limits) : null;
    const hash = contentHash(sub, handoff);
    return this.write(() => {
      const item = this.itemRow(itemId);
      if (sub.producer_id !== item.producer_id || sub.external_id !== item.external_id) {
        throw new InboxError("INVALID_ITEM", "`producer_id` and `external_id` cannot change in an update.", {
          field: sub.producer_id !== item.producer_id ? "producer_id" : "external_id",
        });
      }
      if (sub.kind !== item.kind) {
        throw new InboxError("INVALID_ITEM", "`kind` cannot change after creation.", { field: "kind" });
      }
      if (item.archived_at) throw historyError(item);
      this.assertNoBlockingAttempt(item);
      if (ifRevision !== item.content_revision) throw revisionConflict(item);
      const current = this.revisionRow(item.id, item.content_revision);
      if (current.content_sha256 === hash) return { item: this.toView(item), changed: false };

      const now = this.now();
      const next = item.content_revision + 1;
      this.insertRevision(item.id, next, sub, hash, handoff, now);
      this.db
        .query(
          `UPDATE items SET content_revision = ?, state_version = state_version + 1, updated_at = ?,
             profile_id = ?, title = ? WHERE id = ?`,
        )
        .run(next, now, sub.profile_id, sub.title, item.id);
      this.emit("item.updated", "producer", item.id, item.producer_id, next, null, { previous_revision: item.content_revision });
      return { item: this.toView(this.itemRow(item.id)), changed: true };
    });
  }

  get(itemId: string, opts: { includeContext?: boolean } = {}): ItemDetail {
    return this.read(() => {
      const item = this.itemRow(itemId);
      const rev = this.revisionRow(item.id, item.content_revision);
      const detail: ItemDetail = {
        ...this.toView(item),
        revision: {
          number: rev.revision,
          received_at: rev.received_at,
          content_sha256: rev.content_sha256,
          payload: JSON.parse(rev.payload_json) as Submission,
          handoff: rev.handoff_bytes
            ? {
                sha256: rev.handoff_sha256!,
                bytes: rev.handoff_bytes.length,
                source: rev.handoff_source!,
                captured_at: rev.received_at,
              }
            : null,
        },
      };
      if (opts.includeContext && rev.handoff_bytes) detail.revision.handoff_text = utf8Decoder.decode(rev.handoff_bytes);
      return detail;
    });
  }

  // Exact retained bytes of a revision's handoff; used to build attempt packets.
  handoffBytes(itemId: string, revision: number): Uint8Array | null {
    return this.read(() => this.revisionRow(itemId, revision).handoff_bytes);
  }

  list(opts: ListOptions): { items: ItemView[]; next_cursor: string | null } {
    const limit = clampLimit(opts.limit);
    const now = this.now();
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.view === "active") {
      where.push("archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?)");
      params.push(now);
    } else if (opts.view === "snoozed") {
      where.push("archived_at IS NULL AND snoozed_until > ?");
      params.push(now);
    } else {
      where.push("archived_at IS NOT NULL");
    }
    if (opts.profile) (where.push("profile_id = ?"), params.push(opts.profile));
    if (opts.producer) (where.push("producer_id = ?"), params.push(opts.producer));
    if (opts.kind) (where.push("kind = ?"), params.push(opts.kind));
    if (opts.unread) where.push("(read_revision IS NULL OR read_revision <> content_revision)");
    if (opts.cursor) {
      const [createdAt, id] = decodeCursor(opts.cursor);
      where.push("(created_at > ? OR (created_at = ? AND id > ?))");
      params.push(createdAt, createdAt, id);
    }
    return this.read(() => {
      const rows = this.db
        .query(`SELECT * FROM items WHERE ${where.join(" AND ")} ORDER BY created_at, id LIMIT ?`)
        .all(...params, limit + 1) as ItemRow[];
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => this.toView(r, now)),
        next_cursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
      };
    });
  }

  // Ordered, replayable polling. An empty page returns the latest safe cursor (spec §8).
  events(opts: { after?: string; producer?: string; item?: string; limit?: number }) {
    const limit = clampLimit(opts.limit);
    const after = opts.after === undefined ? 0 : parseEventCursor(opts.after);
    const where = ["seq > ?"];
    const params: (string | number)[] = [after];
    if (opts.producer) (where.push("producer_id = ?"), params.push(opts.producer));
    if (opts.item) (where.push("item_id = ?"), params.push(opts.item));
    return this.read(() =>
      // One read transaction, so the "latest" cursor matches the snapshot the page came from.
      this.db.transaction(() => {
        const rows = this.db
          .query(`SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY seq LIMIT ?`)
          .all(...params, limit + 1) as EventRow[];
        const page = rows.slice(0, limit);
        const hasMore = rows.length > limit;
        let next: number;
        if (hasMore) next = page[page.length - 1]!.seq;
        else next = Math.max(after, this.latestSeq());
        return { events: page.map(toEventView), next_cursor: String(next), has_more: hasMore };
      }).deferred(),
    );
  }

  // ---- user surface -----------------------------------------------------

  // Marks the revision actually displayed; never a later one the user has not seen.
  markRead(itemId: string, revision: number): ItemView {
    return this.write(() => {
      const item = this.itemRow(itemId);
      if (revision !== item.content_revision) throw revisionConflict(item);
      if (item.read_revision === revision) return this.toView(item);
      this.bumpState(item.id, "read_revision = ?", [revision]);
      this.emit("item.read_changed", "user", item.id, item.producer_id, revision, null, { read: true });
      return this.toView(this.itemRow(item.id));
    });
  }

  markUnread(itemId: string): ItemView {
    return this.write(() => {
      const item = this.itemRow(itemId);
      if (item.read_revision === null) return this.toView(item);
      this.bumpState(item.id, "read_revision = NULL", []);
      this.emit("item.read_changed", "user", item.id, item.producer_id, item.content_revision, null, { read: false });
      return this.toView(this.itemRow(item.id));
    });
  }

  // Informational only: read + archive(acknowledged) in one transaction.
  acknowledge(itemId: string, ifStateVersion: number, revision: number): ItemView {
    return this.write(() => {
      const item = this.itemRow(itemId);
      if (item.kind !== "informational") {
        throw new InboxError("STATE_CONFLICT", "Only informational items can be acknowledged; dismiss or open actionable items.", {
          kind: item.kind,
        });
      }
      this.assertStateVersion(item, ifStateVersion);
      if (item.archived_at) throw historyError(item);
      if (revision !== item.content_revision) throw revisionConflict(item);
      const now = this.now();
      this.bumpState(item.id, "read_revision = ?, archived_at = ?, archive_reason = 'acknowledged', snoozed_until = NULL", [
        revision,
        now,
      ]);
      if (item.read_revision !== revision) {
        this.emit("item.read_changed", "user", item.id, item.producer_id, revision, null, { read: true });
      }
      this.emit("item.archived", "user", item.id, item.producer_id, revision, null, { reason: "acknowledged" });
      return this.toView(this.itemRow(item.id));
    });
  }

  snooze(itemId: string, until: Date, ifStateVersion: number): ItemView {
    const untilStored = toStored(until);
    if (untilStored <= this.now()) {
      throw new InboxError("INVALID_ARGUMENT", "`--until` must be in the future.", { field: "until" });
    }
    return this.write(() => {
      const item = this.itemRow(itemId);
      this.assertStateVersion(item, ifStateVersion);
      if (item.archived_at) throw historyError(item);
      this.assertNoBlockingAttempt(item);
      this.bumpState(item.id, "snoozed_until = ?", [untilStored]);
      this.emit("item.snoozed", "user", item.id, item.producer_id, item.content_revision, null, { until: untilStored });
      return this.toView(this.itemRow(item.id));
    });
  }

  unsnooze(itemId: string, ifStateVersion: number): ItemView {
    return this.write(() => {
      const item = this.itemRow(itemId);
      this.assertStateVersion(item, ifStateVersion);
      if (item.archived_at) throw historyError(item);
      this.assertNoBlockingAttempt(item);
      if (item.snoozed_until === null) return this.toView(item);
      this.bumpState(item.id, "snoozed_until = NULL", []);
      this.emit("item.unsnoozed", "user", item.id, item.producer_id, item.content_revision, null, {});
      return this.toView(this.itemRow(item.id));
    });
  }

  // Explicit dismissal of either kind. Never claims delivery.
  archive(itemId: string, ifStateVersion: number): ItemView {
    return this.write(() => {
      const item = this.itemRow(itemId);
      this.assertStateVersion(item, ifStateVersion);
      if (item.archived_at) throw historyError(item);
      this.assertNoBlockingAttempt(item);
      this.bumpState(item.id, "archived_at = ?, archive_reason = 'dismissed', snoozed_until = NULL", [this.now()]);
      this.emit("item.archived", "user", item.id, item.producer_id, item.content_revision, null, { reason: "dismissed" });
      return this.toView(this.itemRow(item.id));
    });
  }

  // Back to Active, unread, unsnoozed. Earlier archive/delivery events stay in the log.
  restore(itemId: string, ifStateVersion: number): ItemView {
    return this.write(() => {
      const item = this.itemRow(itemId);
      this.assertStateVersion(item, ifStateVersion);
      if (!item.archived_at) {
        throw new InboxError("STATE_CONFLICT", "The item is not in History.", { placement: placementOf(item, this.now()) });
      }
      this.assertNoBlockingAttempt(item);
      this.bumpState(item.id, "archived_at = NULL, archive_reason = NULL, snoozed_until = NULL, read_revision = NULL", []);
      this.emit("item.restored", "user", item.id, item.producer_id, item.content_revision, null, {
        previous_reason: item.archive_reason,
      });
      return this.toView(this.itemRow(item.id));
    });
  }

  // Cheap counts for indicators and refresh checks; reads no handoff bytes.
  status() {
    const now = this.now();
    return this.read(() =>
      this.db.transaction(() => {
        const rows = this.db
          .query(
            `SELECT profile_id, kind,
               CASE WHEN archived_at IS NOT NULL THEN 'history'
                    WHEN snoozed_until IS NOT NULL AND snoozed_until > ? THEN 'snoozed'
                    ELSE 'active' END AS placement,
               (read_revision IS NULL OR read_revision <> content_revision) AS unread,
               COUNT(*) AS n
             FROM items GROUP BY 1, 2, 3, 4`,
          )
          .all(now) as { profile_id: string; kind: string; placement: Placement; unread: number; n: number }[];
        const zero = () => ({ active: 0, active_unread: 0, active_actionable: 0, active_informational: 0, snoozed: 0, history: 0 });
        const counts = zero();
        const byProfile: Record<string, ReturnType<typeof zero>> = {};
        for (const r of rows) {
          const p = (byProfile[r.profile_id] ??= zero());
          for (const target of [counts, p]) {
            target[r.placement] += r.n;
            if (r.placement === "active") {
              if (r.unread) target.active_unread += r.n;
              if (r.kind === "actionable") target.active_actionable += r.n;
              else target.active_informational += r.n;
            }
          }
        }
        const next = this.db
          .query("SELECT MIN(snoozed_until) AS t FROM items WHERE archived_at IS NULL AND snoozed_until > ?")
          .get(now) as { t: string | null };
        return {
          counts,
          by_profile: byProfile,
          change_token: String(this.latestSeq()),
          next_snooze_deadline: next.t,
          now,
        };
      }).deferred(),
    );
  }

  // ---- internals --------------------------------------------------------

  /** @internal */
  itemRow(id: string): ItemRow {
    const row = this.db.query("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | null;
    if (!row) throw new InboxError("NOT_FOUND", `No item with id ${id}.`, { item_id: id });
    return row;
  }

  /** @internal */
  revisionRow(itemId: string, revision: number): RevisionRow {
    const row = this.db
      .query("SELECT * FROM item_revisions WHERE item_id = ? AND revision = ?")
      .get(itemId, revision) as RevisionRow | null;
    if (!row) throw new InboxError("NOT_FOUND", `No revision ${revision} for item ${itemId}.`, { item_id: itemId, revision });
    return row;
  }

  private insertRevision(id: string, revision: number, sub: Submission, hash: string, handoff: CapturedHandoff | null, now: string) {
    this.db
      .query(
        `INSERT INTO item_revisions (item_id, revision, payload_json, content_sha256, handoff_bytes, handoff_source,
           handoff_sha256, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, revision, JSON.stringify(sub), hash, handoff?.bytes ?? null, handoff?.source ?? null, handoff?.sha256 ?? null, now);
  }

  private bumpState(id: string, set: string, params: (string | number | null)[]) {
    this.db
      .query(`UPDATE items SET ${set}, state_version = state_version + 1, updated_at = ? WHERE id = ?`)
      .run(...params, this.now(), id);
  }

  /** @internal */
  emit(
    type: string,
    actor: Actor,
    itemId: string,
    producerId: string,
    revision: number | null,
    attemptId: string | null,
    meta: Record<string, unknown>,
  ) {
    this.db
      .query(
        `INSERT INTO events (id, at, type, actor, item_id, producer_id, revision, attempt_id, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId("evt", this.clock), this.now(), type, actor, itemId, producerId, revision, attemptId, JSON.stringify(meta));
  }

  private latestSeq(): number {
    return (this.db.query("SELECT COALESCE(MAX(seq), 0) AS s FROM events").get() as { s: number }).s;
  }

  private assertStateVersion(item: ItemRow, expected: number) {
    if (expected !== item.state_version) {
      throw new InboxError("STATE_CONFLICT", "The item changed since you read it; refresh and try again.", {
        state_version: item.state_version,
      });
    }
  }

  /** @internal The item's in_progress / blocked / uncertain attempt, if any. */
  blockingAttemptId(itemId: string): string | null {
    const row = this.db
      .query("SELECT id FROM attempts WHERE item_id = ? AND status IN ('in_progress', 'blocked', 'uncertain')")
      .get(itemId) as { id: string } | null;
    return row?.id ?? null;
  }

  private assertNoBlockingAttempt(item: ItemRow) {
    const attemptId = this.blockingAttemptId(item.id);
    if (attemptId) {
      throw new InboxError("ATTEMPT_IN_PROGRESS", "An opening attempt is in progress for this item.", { attempt_id: attemptId });
    }
  }

  private toView(r: ItemRow, now = this.now()): ItemView {
    return {
      id: r.id,
      producer_id: r.producer_id,
      external_id: r.external_id,
      kind: r.kind,
      title: r.title,
      profile_id: r.profile_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      content_revision: r.content_revision,
      state_version: r.state_version,
      read: r.read_revision === r.content_revision,
      read_revision: r.read_revision,
      placement: placementOf(r, now),
      snoozed_until: r.snoozed_until,
      archived_at: r.archived_at,
      archive_reason: r.archive_reason,
      blocking_attempt_id: this.blockingAttemptId(r.id),
    };
  }
}

function placementOf(r: Pick<ItemRow, "archived_at" | "snoozed_until">, now: string): Placement {
  if (r.archived_at) return "history";
  if (r.snoozed_until && r.snoozed_until > now) return "snoozed";
  return "active";
}

function historyError(item: ItemRow): InboxError {
  return new InboxError("ITEM_IN_HISTORY", "The item is in History; restore it first.", {
    archive_reason: item.archive_reason,
  });
}

function revisionConflict(item: ItemRow): InboxError {
  return new InboxError("REVISION_CONFLICT", "The item has a different content revision; refresh and try again.", {
    content_revision: item.content_revision,
  });
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new InboxError("INVALID_ARGUMENT", "`--limit` must be a positive integer.", { field: "limit" });
  }
  return Math.min(limit, MAX_PAGE);
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string") return [v[0], v[1]];
  } catch {}
  throw new InboxError("INVALID_ARGUMENT", "Invalid `--cursor`.", { field: "cursor" });
}

function parseEventCursor(cursor: string): number {
  if (!/^\d+$/.test(cursor)) throw new InboxError("INVALID_ARGUMENT", "Invalid `--after` cursor.", { field: "after" });
  return Number(cursor);
}

function toEventView(r: EventRow): EventView {
  return {
    cursor: String(r.seq),
    id: r.id,
    at: r.at,
    type: r.type,
    actor: r.actor,
    item_id: r.item_id,
    producer_id: r.producer_id,
    revision: r.revision,
    attempt_id: r.attempt_id,
    meta: r.meta_json ? (JSON.parse(r.meta_json) as Record<string, unknown>) : {},
  };
}
