import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { InboxError } from "./errors";
import { type Profile, profilesPath } from "./profiles";

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
    const herdr = (raw as { herdr?: Record<string, unknown> })?.herdr ?? {};
    if (typeof herdr !== "object") throw new InboxError("STORE_ERROR", `${path}: "herdr" must be an object.`);
    if (herdr.socket_path !== undefined) {
      if (typeof herdr.socket_path !== "string" || !win32.isAbsolute(herdr.socket_path)) {
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
  if (existsSync(path) && !force) {
    throw new InboxError("STATE_CONFLICT", `${path} already exists; pass --force to replace it.`, { path });
  }
  if (Object.keys(dirs).length === 0) throw new InboxError("INVALID_ARGUMENT", "At least one profile is required.");
  for (const id of Object.keys(labels)) {
    if (!(id in dirs)) throw new InboxError("INVALID_ARGUMENT", `--label names unknown profile "${id}".`, { field: "label" });
  }
  const profiles: Record<string, Profile> = {};
  for (const [id, dir] of Object.entries(dirs)) {
    if (!PROFILE_ID.test(id)) {
      throw new InboxError("INVALID_ARGUMENT", `Profile id "${id}" must be lowercase letters, digits, - or _.`, { field: "profile" });
    }
    if (!win32.isAbsolute(dir)) {
      throw new InboxError("INVALID_ARGUMENT", `Config dir for "${id}" must be absolute: ${dir}`, { field: "profile", profile_id: id });
    }
    if (!isDir(dir)) {
      throw new InboxError("INVALID_ARGUMENT", `Config dir for "${id}" does not exist: ${dir}`, { field: "profile", profile_id: id });
    }
    const label = labels[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
    profiles[id] = { id, label, agent: "claude-code", claude_config_dir: win32.normalize(dir) };
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

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
