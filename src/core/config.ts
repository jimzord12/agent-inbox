import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { InboxError } from "./errors";
import { type Profile, isFullyQualified, profilesPath } from "./profiles";

// Inbox configuration, in `<home>\config.json`. Every key is optional; a missing file or key
// takes the default below.
//
//   { "herdr": { "socket_path": "C:\\Users\\me\\AppData\\Roaming\\herdr\\herdr.sock",
//                "workspace_label": "Agent Inbox" } }
//
// socket_path      the Herdr server every call names (spec §10.2); default is Herdr's own
//                  default socket, `%APPDATA%\herdr\herdr.sock`. No fallback to another server.
// workspace_label  label of the inbox-owned workspace the inbox creates for launch tabs.
export interface InboxConfig {
  herdr: { socket_path: string; workspace_label: string };
}

export const DEFAULT_WORKSPACE_LABEL = "Agent Inbox";

export function configPath(home: string): string {
  return join(home, "config.json");
}

export function defaultConfig(env: Record<string, string | undefined> = process.env): InboxConfig {
  const appData = env.APPDATA?.trim();
  return {
    herdr: {
      socket_path: appData ? join(appData, "herdr", "herdr.sock") : "",
      workspace_label: DEFAULT_WORKSPACE_LABEL,
    },
  };
}

export function loadConfig(home: string, env: Record<string, string | undefined> = process.env): InboxConfig {
  const config = defaultConfig(env);
  const path = configPath(home);
  if (existsSync(path)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      throw new InboxError("STORE_ERROR", `${path} is not valid JSON.`);
    }
    // Unknown keys are refused: a misspelt socket key must not silently select the default server.
    if (!isPlainObject(raw)) throw new InboxError("STORE_ERROR", `${path} must hold a JSON object.`);
    refuseUnknown(path, raw, ["herdr"], "");
    const herdr = raw.herdr === undefined ? {} : raw.herdr;
    if (!isPlainObject(herdr)) throw new InboxError("STORE_ERROR", `${path}: "herdr" must be an object.`);
    refuseUnknown(path, herdr, ["socket_path", "workspace_label"], "herdr.");
    if (herdr.socket_path !== undefined) {
      if (typeof herdr.socket_path !== "string" || !isFullyQualified(herdr.socket_path)) {
        throw new InboxError("STORE_ERROR", `${path}: herdr.socket_path must be an absolute path.`);
      }
      config.herdr.socket_path = herdr.socket_path;
    }
    if (herdr.workspace_label !== undefined) {
      if (typeof herdr.workspace_label !== "string" || !herdr.workspace_label.trim()) {
        throw new InboxError("STORE_ERROR", `${path}: herdr.workspace_label must be a non-empty string.`);
      }
      config.herdr.workspace_label = herdr.workspace_label;
    }
  }
  if (!config.herdr.socket_path) {
    throw new InboxError("HERDR_UNAVAILABLE", `No Herdr socket: set herdr.socket_path in ${path} or APPDATA.`, undefined, false);
  }
  return config;
}

// The ccw/ccp mapping (docs/decisions.md): work and personal Claude config folders in the
// user profile. Used when `setup-profiles` is given no `--profile`.
export function defaultProfileDirs(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const userProfile = env.USERPROFILE?.trim();
  if (!userProfile) throw new InboxError("INVALID_ARGUMENT", "USERPROFILE is not set; pass --profile id=DIR explicitly.");
  return { work: join(userProfile, ".claude-work"), personal: join(userProfile, ".claude-personal") };
}

const PROFILE_ID = /^[a-z][a-z0-9_-]{0,31}$/;

// Writes `<home>\profiles.json`. Refuses ids that are not simple names, config dirs that are
// relative or missing, and an existing file unless `force`. The write is atomic.
export function writeProfiles(
  home: string,
  dirs: Record<string, string>,
  labels: Record<string, string> = {},
  force = false,
): Record<string, Profile> {
  const path = profilesPath(home);
  if (Object.keys(dirs).length === 0) throw new InboxError("INVALID_ARGUMENT", "At least one profile is required.");
  for (const [id, label] of Object.entries(labels)) {
    if (!(id in dirs)) throw new InboxError("INVALID_ARGUMENT", `--label names unknown profile "${id}".`, { field: "label" });
    if (!label.trim()) throw new InboxError("INVALID_ARGUMENT", `The label for "${id}" is empty.`, { field: "label" });
  }
  const profiles: Record<string, Profile> = {};
  for (const [id, dir] of Object.entries(dirs)) {
    if (!PROFILE_ID.test(id)) {
      throw new InboxError("INVALID_ARGUMENT", `Profile id "${id}" must be lowercase letters, digits, - or _.`, { field: "profile" });
    }
    if (!isFullyQualified(dir)) {
      throw new InboxError("INVALID_ARGUMENT", `Config dir for "${id}" must be absolute (drive or UNC): ${dir}`, { field: "profile", profile_id: id });
    }
    if (!isDir(dir)) {
      throw new InboxError("INVALID_ARGUMENT", `Config dir for "${id}" does not exist: ${dir}`, { field: "profile", profile_id: id });
    }
    const label = labels[id]?.trim() ?? id.charAt(0).toUpperCase() + id.slice(1);
    profiles[id] = { id, label, agent: "claude-code", claude_config_dir: canonicalDir(dir) };
  }
  // Checked after the input, so a bad argument is reported as such even when the file exists.
  if (existsSync(path) && !force) {
    throw new InboxError("STATE_CONFLICT", `${path} already exists; pass --force to replace it.`, { path });
  }
  const body = {
    profiles: Object.fromEntries(
      Object.values(profiles).map((p) => [p.id, { label: p.label, agent: p.agent, claude_config_dir: p.claude_config_dir }]),
    ),
  };
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  renameSync(tmp, path);
  return profiles;
}

// Normalised, without trailing separators (a bare drive root keeps its one).
export function canonicalDir(p: string): string {
  const n = win32.normalize(p);
  return /^[A-Za-z]:\\$/.test(n) ? n : n.replace(/[\\/]+$/, "");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function refuseUnknown(path: string, obj: Record<string, unknown>, known: string[], prefix: string) {
  const unknown = Object.keys(obj).filter((k) => !known.includes(k));
  if (unknown.length) throw new InboxError("STORE_ERROR", `${path}: unknown key ${unknown.map((k) => `"${prefix}${k}"`).join(", ")}.`);
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
