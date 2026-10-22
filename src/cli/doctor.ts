import { configPath, isDir, loadConfig } from "../core/config";
import { dbPath, homeWarnings, resolveHome } from "../core/home";
import { Inbox } from "../core/inbox";
import { loadProfiles, profilesPath } from "../core/profiles";

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
  // Profiles and Herdr selection. Paths only: no env values, tokens or file contents.
  try {
    report.profiles = Object.values(loadProfiles(home)).map((p) => ({
      id: p.id,
      label: p.label,
      agent: p.agent,
      claude_config_dir: p.claude_config_dir,
      config_dir_exists: isDir(p.claude_config_dir),
    }));
  } catch (err) {
    report.profiles = { path: profilesPath(home), error: (err as Error).message };
  }
  try {
    const { herdr } = loadConfig(home);
    report.herdr = { config_path: configPath(home), socket_path: herdr.socket_path, workspace_label: herdr.workspace_label };
  } catch (err) {
    report.herdr = { config_path: configPath(home), error: (err as Error).message };
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
