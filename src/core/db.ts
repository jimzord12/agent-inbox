import { Database } from "bun:sqlite";
import { InboxError, fromStoreError } from "./errors";
import { MIGRATIONS } from "./migrations";

export const BUSY_TIMEOUT_MS = 5000;

// SQLite builds with the WAL-reset fix (spec §7, [R8]): 3.51.3+, or backports 3.44.6 / 3.50.7.
export function hasWalResetFix(version: string): boolean {
  const [maj = 0, min = 0, pat = 0] = version.split(".").map(Number);
  if (maj !== 3) return maj > 3;
  if (min > 51 || (min === 51 && pat >= 3)) return true;
  if (min === 50) return pat >= 7;
  if (min === 44) return pat >= 6;
  return false;
}

export interface StoreInfo {
  sqliteVersion: string;
  journalMode: string;
  walResetFix: boolean;
  schemaVersion: number;
}

export interface OpenOptions {
  // How long one statement waits for another process's lock before STORE_BUSY.
  busyTimeoutMs?: number;
  // Open an existing store only; a missing file is STORE_ERROR instead of a new empty store.
  existingOnly?: boolean;
}

export function openStore(path: string, opts: OpenOptions = {}): { db: Database; info: StoreInfo } {
  let db: Database;
  try {
    db = opts.existingOnly ? new Database(path, { readwrite: true, create: false, strict: true }) : new Database(path, { create: true, strict: true });
  } catch (err) {
    if ((err as { code?: string })?.code === "SQLITE_CANTOPEN") throw new InboxError("STORE_ERROR", "The inbox store does not exist.");
    throw fromStoreError(err);
  }
  try {
    db.run(`PRAGMA busy_timeout = ${opts.busyTimeoutMs ?? BUSY_TIMEOUT_MS}`);
    db.run("PRAGMA foreign_keys = ON");
    const sqliteVersion = (db.query("SELECT sqlite_version() AS v").get() as { v: string }).v;
    const walResetFix = hasWalResetFix(sqliteVersion);
    // Never enable WAL on an engine with the known reset bug; fall back to rollback journal.
    const wanted = walResetFix ? "WAL" : "DELETE";
    const journalMode = (db.query(`PRAGMA journal_mode = ${wanted}`).get() as { journal_mode: string }).journal_mode;
    db.run("PRAGMA synchronous = FULL");
    const schemaVersion = migrate(db);
    return { db, info: { sqliteVersion, journalMode, walResetFix, schemaVersion } };
  } catch (err) {
    db.close();
    throw fromStoreError(err);
  }
}

// Applies pending migrations inside one IMMEDIATE transaction, so two processes
// never migrate at once. Refuses a schema newer than this build knows.
function migrate(db: Database): number {
  const latest = MIGRATIONS.length;
  const run = db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);
    const row = db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
    const current = row.v ?? 0;
    if (current > latest) {
      throw new InboxError(
        "STORE_INCOMPATIBLE",
        `The inbox store has schema ${current}, newer than this agent-inbox build supports (${latest}). Update agent-inbox.`,
        { store_schema: current, supported_schema: latest },
      );
    }
    for (let v = current + 1; v <= latest; v++) {
      db.run(MIGRATIONS[v - 1]!);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v, new Date().toISOString());
    }
    return latest;
  });
  return run.immediate();
}
