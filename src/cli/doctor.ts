import { dbPath, homeWarnings, resolveHome } from "../core/home";
import { Inbox } from "../core/inbox";

// Redacted capability report. Reads only; installs, restarts and submits nothing (spec §8).
export function doctor() {
  const home = resolveHome();
  const report: Record<string, unknown> = {
    home,
    home_source: process.env.AGENT_INBOX_HOME?.trim() ? "AGENT_INBOX_HOME" : "LOCALAPPDATA",
    home_warnings: homeWarnings(home),
    bun: Bun.version,
    platform: process.platform,
  };
  try {
    const inbox = new Inbox({ home });
    report.store = {
      path: dbPath(home),
      sqlite_version: inbox.store.sqliteVersion,
      wal_reset_fix: inbox.store.walResetFix,
      journal_mode: inbox.store.journalMode,
      schema_version: inbox.store.schemaVersion,
    };
    inbox.close();
  } catch (err) {
    report.store = { path: dbPath(home), error: (err as Error).message };
  }
  report.tools = {
    herdr: probe("herdr", ["--version"]),
    claude: probe("claude", ["--version"]),
  };
  return report;
}

function probe(cmd: string, args: string[]) {
  const path = Bun.which(cmd);
  if (!path) return { found: false };
  try {
    const r = Bun.spawnSync([path, ...args], { stdout: "pipe", stderr: "ignore", timeout: 5000 });
    return { found: true, path, version: r.stdout.toString().trim().split("\n")[0] ?? null };
  } catch {
    return { found: true, path, version: null };
  }
}
