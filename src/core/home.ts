import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { InboxError } from "./errors";

// One absolute inbox home shared by every profile (spec §7):
// `AGENT_INBOX_HOME`, else `%LOCALAPPDATA%\agent-inbox`.
export function resolveHome(env: Record<string, string | undefined> = process.env): string {
  const override = env.AGENT_INBOX_HOME?.trim();
  if (override) return resolve(override);
  const localAppData = env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    throw new InboxError("STORE_ERROR", "Cannot locate the inbox home: set AGENT_INBOX_HOME or LOCALAPPDATA.");
  }
  return join(localAppData, "agent-inbox");
}

export function ensureHome(home: string): string {
  mkdirSync(home, { recursive: true });
  return home;
}

export function dbPath(home: string): string {
  return join(home, "inbox.db");
}

// Locations the spec forbids for the store. Reported by `doctor`, not enforced, so
// tests and evaluations can use a scratch home.
export function homeWarnings(home: string, env: Record<string, string | undefined> = process.env): string[] {
  const warnings: string[] = [];
  const lower = home.toLowerCase();
  if (lower.includes("onedrive")) warnings.push("Inbox home is inside OneDrive.");
  const temp = (env.TEMP ?? env.TMP ?? "").toLowerCase();
  if (temp && lower.startsWith(temp)) warnings.push("Inbox home is inside the temp folder.");
  if (lower.startsWith("\\\\")) warnings.push("Inbox home is on a network share.");
  return warnings;
}
