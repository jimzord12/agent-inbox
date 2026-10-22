import { existsSync, readFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { InboxError } from "./errors";
import { canonicalJson, sha256Hex } from "./submission";

// User-owned launch profiles (spec §11), in `<home>\profiles.json`. Producers only name a
// profile id; they never supply executables, env or config paths.
//
//   { "profiles": { "work": { "label": "Work", "agent": "claude-code",
//                             "claude_config_dir": "C:\\Users\\me\\.claude-work" } } }
export interface Profile {
  id: string;
  label: string;
  agent: "claude-code";
  claude_config_dir: string;
}

export function profilesPath(home: string): string {
  return join(home, "profiles.json");
}

export function loadProfiles(home: string): Record<string, Profile> {
  const path = profilesPath(home);
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new InboxError("PROFILE_NOT_CONFIGURED", `${path} is not valid JSON.`);
  }
  const entries = (raw as { profiles?: Record<string, unknown> })?.profiles;
  if (!entries || typeof entries !== "object") {
    throw new InboxError("PROFILE_NOT_CONFIGURED", `${path} needs a top-level "profiles" object.`);
  }
  const out: Record<string, Profile> = {};
  for (const [id, v] of Object.entries(entries)) {
    const p = v as Partial<Profile>;
    if (p?.agent !== "claude-code" || typeof p.claude_config_dir !== "string" || !win32.isAbsolute(p.claude_config_dir)) {
      throw new InboxError(
        "PROFILE_NOT_CONFIGURED",
        `Profile "${id}" in ${path} needs agent "claude-code" and an absolute claude_config_dir.`,
        { profile_id: id },
      );
    }
    out[id] = { id, label: typeof p.label === "string" ? p.label : id, agent: "claude-code", claude_config_dir: p.claude_config_dir };
  }
  return out;
}

export function resolveProfile(home: string, id: string): Profile {
  const profile = loadProfiles(home)[id];
  if (!profile) {
    throw new InboxError("PROFILE_NOT_CONFIGURED", `Profile "${id}" is not configured in ${profilesPath(home)}.`, { profile_id: id });
  }
  return profile;
}

// Redacted identity of the resolved launch configuration. The bridge recomputes it from
// what the launched session actually sees and must get the same value.
export function launchFingerprint(agent: string, claudeConfigDir: string): string {
  return sha256Hex(canonicalJson({ agent, claude_config_dir: normalizeDir(claudeConfigDir) }));
}

export function normalizeDir(p: string): string {
  return win32.normalize(p).replace(/[\\/]+$/, "").toLowerCase();
}
