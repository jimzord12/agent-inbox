// Append-only. Never edit a shipped migration; add a new one.
export const MIGRATIONS: string[] = [
  // 1: items, immutable revisions, events.
  `
  CREATE TABLE items (
    id               TEXT PRIMARY KEY,
    producer_id      TEXT NOT NULL,
    external_id      TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('informational', 'actionable')),
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    content_revision INTEGER NOT NULL,
    state_version    INTEGER NOT NULL,
    read_revision    INTEGER,
    snoozed_until    TEXT,
    archived_at      TEXT,
    archive_reason   TEXT CHECK (archive_reason IN ('acknowledged', 'dismissed', 'delivered')),
    -- Denormalised from the current revision, for listing and filtering.
    profile_id       TEXT NOT NULL,
    title            TEXT NOT NULL,
    UNIQUE (producer_id, external_id),
    CHECK ((archived_at IS NULL) = (archive_reason IS NULL))
  );
  CREATE INDEX items_order ON items (created_at, id);
  CREATE INDEX items_placement ON items (archived_at, snoozed_until);

  CREATE TABLE item_revisions (
    item_id           TEXT NOT NULL REFERENCES items (id),
    revision          INTEGER NOT NULL,
    payload_json      TEXT NOT NULL,
    content_sha256    TEXT NOT NULL,
    handoff_bytes     BLOB,
    handoff_source    TEXT,
    handoff_sha256    TEXT,
    received_at       TEXT NOT NULL,
    PRIMARY KEY (item_id, revision)
  );

  CREATE TABLE events (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    id           TEXT NOT NULL UNIQUE,
    at           TEXT NOT NULL,
    type         TEXT NOT NULL,
    actor        TEXT NOT NULL,
    item_id      TEXT NOT NULL REFERENCES items (id),
    producer_id  TEXT NOT NULL,
    revision     INTEGER,
    attempt_id   TEXT,
    meta_json    TEXT
  );
  CREATE INDEX events_producer ON events (producer_id, seq);
  CREATE INDEX events_item ON events (item_id, seq);
  `,
];
