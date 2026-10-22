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
  // 2: handoff attempts and their external-operation intent log.
  `
  CREATE TABLE attempts (
    id                  TEXT PRIMARY KEY,
    item_id             TEXT NOT NULL REFERENCES items (id),
    content_revision    INTEGER NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('in_progress', 'blocked', 'uncertain', 'failed', 'succeeded')),
    phase               TEXT NOT NULL CHECK (phase IN ('preflight', 'create_layout', 'start_agent', 'submit_context', 'await_receipt', 'focus')),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    -- What is launched.
    profile_id          TEXT NOT NULL,
    profile_override    INTEGER NOT NULL DEFAULT 0,
    fresh               INTEGER NOT NULL DEFAULT 0,
    launch_fingerprint  TEXT NOT NULL,
    cwd                 TEXT NOT NULL,
    agent_kind          TEXT NOT NULL,
    session_uuid        TEXT NOT NULL UNIQUE,
    -- Per-attempt secrets for the receipt bridge; never shown in events.
    capability          TEXT NOT NULL,
    challenge           TEXT NOT NULL,
    packet_bytes        BLOB NOT NULL,
    packet_sha256       TEXT NOT NULL,
    packet_path         TEXT,
    -- Outcome.
    error_code          TEXT,
    error_message       TEXT,
    revoked_at          TEXT,
    -- Worker lease and fencing.
    lease_owner         TEXT,
    lease_expires_at    TEXT,
    fencing_generation  INTEGER NOT NULL DEFAULT 0,
    -- Herdr target.
    herdr_session       TEXT,
    workspace_id        TEXT,
    tab_id              TEXT,
    pane_id             TEXT,
    agent_alias         TEXT,
    availability        TEXT NOT NULL DEFAULT 'unknown' CHECK (availability IN ('live', 'closed', 'unknown', 'unavailable')),
    -- Evidence.
    binding_json        TEXT,
    prompt_state        TEXT NOT NULL DEFAULT 'none' CHECK (prompt_state IN ('none', 'started', 'accepted', 'rejected', 'uncertain')),
    prompt_started_at   TEXT,
    prompt_accepted_at  TEXT,
    receipt_candidate_json TEXT,
    receipt_json        TEXT,
    focus_json          TEXT
  );
  CREATE INDEX attempts_item ON attempts (item_id, created_at);
  -- At most one blocking attempt per item, enforced by the database (spec §6.2).
  CREATE UNIQUE INDEX attempts_one_blocking ON attempts (item_id) WHERE status IN ('in_progress', 'blocked', 'uncertain');

  CREATE TABLE attempt_ops (
    attempt_id   TEXT NOT NULL REFERENCES attempts (id),
    op           TEXT NOT NULL,
    state        TEXT NOT NULL CHECK (state IN ('started', 'confirmed', 'failed', 'uncertain')),
    generation   INTEGER NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    detail_json  TEXT,
    PRIMARY KEY (attempt_id, op)
  );
  `,
  // 3: last rejected bridge evidence (reason and time only), shown without log inspection.
  `
  ALTER TABLE attempts ADD COLUMN last_rejection_json TEXT;
  `,
];
