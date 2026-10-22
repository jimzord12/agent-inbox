import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Per-attempt receipt-bridge settings, loaded only by the launched session through
// `claude --settings <file>` (spec §9.2 step 3). Claude adds these hooks to the user's own;
// nothing is written to any settings file of the user's profiles.
//
// Hooks use exec form (`command` + `args`): Claude spawns Bun directly, with no shell, so paths
// with spaces need no quoting. Every hook names the attempt's bridge file, which holds the
// inbox home, the attempt id and its capability.
//
//   <home>\attempts\<attempt id>\bridge.json     { home, attempt_id, capability }
//   <home>\attempts\<attempt id>\settings.json   the --settings file

export const HOOK_TIMEOUT_SECONDS = 15;

export interface BridgeFiles {
  dir: string;
  bridgePath: string;
  settingsPath: string;
}

export interface BridgeSettingsInput {
  home: string;
  attemptId: string;
  capability: string;
  // The Bun executable and the hook entry point; default to this process and src/bridge/main.ts.
  bunPath?: string;
  hookScript?: string;
}

export function bridgeFiles(home: string, attemptId: string): BridgeFiles {
  const dir = join(home, "attempts", attemptId);
  return { dir, bridgePath: join(dir, "bridge.json"), settingsPath: join(dir, "settings.json") };
}

export function buildBridgeSettings(o: BridgeSettingsInput & { bridgePath: string }) {
  const bun = o.bunPath ?? process.execPath;
  const script = o.hookScript ?? join(import.meta.dir, "main.ts");
  const hook = (event: string) => [
    { hooks: [{ type: "command", command: bun, args: [script, event, "--bridge", o.bridgePath], timeout: HOOK_TIMEOUT_SECONDS }] },
  ];
  // No matcher on SessionStart: startup, resume, clear and compact all re-check the binding, so a
  // replaced session (e.g. /clear) is caught.
  return {
    hooks: {
      SessionStart: hook("session-start"),
      UserPromptSubmit: hook("prompt"),
      Stop: hook("stop"),
    },
  };
}

// Writes both files atomically and returns their paths. Idempotent for one attempt.
export function writeBridgeSettings(o: BridgeSettingsInput): BridgeFiles {
  const files = bridgeFiles(o.home, o.attemptId);
  mkdirSync(files.dir, { recursive: true });
  atomicWrite(files.bridgePath, { home: o.home, attempt_id: o.attemptId, capability: o.capability });
  atomicWrite(files.settingsPath, buildBridgeSettings({ ...o, bridgePath: files.bridgePath }));
  return files;
}

function atomicWrite(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}
