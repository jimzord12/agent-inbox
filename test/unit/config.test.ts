import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_WORKSPACE_LABEL, configPath, defaultProfileDirs, loadConfig, writeProfiles } from "../../src/core/config";
import { loadProfiles, profilesPath } from "../../src/core/profiles";
import { expectCode, type Fixture, fixture } from "../helpers";

const MAIN = join(import.meta.dir, "..", "..", "src", "cli", "main.ts");

let f: Fixture;
let work: string;
let personal: string;
beforeEach(() => {
  f = fixture();
  work = join(f.dir, "profile dirs", ".claude-wörk");
  personal = join(f.dir, "profile dirs", ".claude-personal");
  mkdirSync(work, { recursive: true });
  mkdirSync(personal, { recursive: true });
});
afterEach(() => f.cleanup());

function cli(args: string[], env: Record<string, string> = {}) {
  const r = Bun.spawnSync([process.execPath, MAIN, ...args], {
    env: { ...process.env, AGENT_INBOX_HOME: f.home, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: JSON.parse(r.stdout.toString()), stdout: r.stdout.toString() };
}

describe("config.json", () => {
  test("defaults: Herdr's own socket under APPDATA and the Agent Inbox label", () => {
    const c = loadConfig(f.home, { APPDATA: "C:\\Users\\me\\AppData\\Roaming" });
    expect(c.herdr).toEqual({ socket_path: "C:\\Users\\me\\AppData\\Roaming\\herdr\\herdr.sock", workspace_label: DEFAULT_WORKSPACE_LABEL });
  });

  test("values in config.json win; a BOM is accepted", () => {
    writeFileSync(configPath(f.home), `\uFEFF${JSON.stringify({ herdr: { socket_path: "D:\\herdr test\\x.sock", workspace_label: "Inbox Tabs" } })}`);
    expect(loadConfig(f.home, {}).herdr).toEqual({ socket_path: "D:\\herdr test\\x.sock", workspace_label: "Inbox Tabs" });
  });

  test("invalid values are refused, never guessed", () => {
    for (const bad of ["{", JSON.stringify({ herdr: { socket_path: "relative.sock" } }), JSON.stringify({ herdr: { workspace_label: " " } })]) {
      writeFileSync(configPath(f.home), bad);
      expectCode(() => loadConfig(f.home, { APPDATA: "C:\\x" }), "STORE_ERROR");
    }
  });

  test("no socket at all is HERDR_UNAVAILABLE", () => {
    expectCode(() => loadConfig(f.home, {}), "HERDR_UNAVAILABLE");
  });
});

describe("profiles.json", () => {
  test("writes the given profiles atomically and loadProfiles reads them back", () => {
    const written = writeProfiles(f.home, { work, personal }, { work: "Work (ccw)" });
    expect(written.work).toMatchObject({ label: "Work (ccw)", agent: "claude-code", claude_config_dir: work });
    expect(written.personal?.label).toBe("Personal");
    expect(loadProfiles(f.home)).toEqual(written);
  });

  test("refuses relative or missing dirs, bad ids and unknown labels", () => {
    expectCode(() => writeProfiles(f.home, { work: ".claude-work" }), "INVALID_ARGUMENT");
    expectCode(() => writeProfiles(f.home, { work: join(f.dir, "nope") }), "INVALID_ARGUMENT");
    expectCode(() => writeProfiles(f.home, { "Work Profile": work }), "INVALID_ARGUMENT");
    expectCode(() => writeProfiles(f.home, { work }, { personal: "P" }), "INVALID_ARGUMENT");
    expectCode(() => writeProfiles(f.home, {}), "INVALID_ARGUMENT");
  });

  test("never overwrites without force", () => {
    writeProfiles(f.home, { work });
    const before = readFileSync(profilesPath(f.home), "utf8");
    expectCode(() => writeProfiles(f.home, { personal }), "STATE_CONFLICT");
    expect(readFileSync(profilesPath(f.home), "utf8")).toBe(before);
    writeProfiles(f.home, { personal }, {}, true);
    expect(Object.keys(loadProfiles(f.home))).toEqual(["personal"]);
  });

  test("defaults map work and personal to the ccw/ccp folders in the user profile", () => {
    expect(defaultProfileDirs({ USERPROFILE: "C:\\Users\\me" })).toEqual({ work: "C:\\Users\\me\\.claude-work", personal: "C:\\Users\\me\\.claude-personal" });
  });
});

describe("setup-profiles and doctor through the CLI", () => {
  test("setup-profiles writes the given profiles and refuses a second run without --force", () => {
    const r = cli(["setup-profiles", "--profile", `work=${work}`, "--profile", `personal=${personal}`, "--label", "work=Work", "--json"]);
    expect(r.code).toBe(0);
    expect(r.out.data.profiles.map((p: { id: string }) => p.id)).toEqual(["work", "personal"]);
    const again = cli(["setup-profiles", "--profile", `work=${work}`]);
    expect(again).toMatchObject({ code: 1, out: { ok: false, error: { code: "STATE_CONFLICT" } } });
    expect(cli(["setup-profiles", "--profile", `work=${work}`, "--force"]).code).toBe(0);
  });

  test("setup-profiles without --profile uses the user-profile defaults", () => {
    const fakeUser = join(f.dir, "profile dirs");
    mkdirSync(join(fakeUser, ".claude-work"));
    const r = cli(["setup-profiles"], { USERPROFILE: fakeUser });
    expect(r.code).toBe(0);
    expect(r.out.data.profiles.map((p: { claude_config_dir: string }) => p.claude_config_dir)).toEqual([join(fakeUser, ".claude-work"), personal]);
  });

  test("bad pairs and missing dirs are usage errors (exit 2)", () => {
    expect(cli(["setup-profiles", "--profile", "work"]).code).toBe(2);
    expect(cli(["setup-profiles", "--profile", `work=${work}`, "--profile", `work=${personal}`]).code).toBe(2);
    expect(cli(["setup-profiles", "--profile", `work=${join(f.dir, "missing")}`]).out.error.code).toBe("INVALID_ARGUMENT");
  });

  test("doctor reports profiles and the Herdr config without secrets", () => {
    cli(["setup-profiles", "--profile", `work=${work}`, "--profile", `ghost=${personal}`]);
    // A profile whose folder later disappears is reported, not hidden.
    const p = JSON.parse(readFileSync(profilesPath(f.home), "utf8"));
    p.profiles.ghost.claude_config_dir = join(f.dir, "gone");
    writeFileSync(profilesPath(f.home), JSON.stringify(p));
    const secret = "sk-ant-test-0000-not-a-real-key";
    const r = cli(["doctor", "--json"], { APPDATA: "C:\\Users\\me\\AppData\\Roaming", ANTHROPIC_API_KEY: secret });
    expect(r.code).toBe(0);
    expect(r.out.data.profiles).toEqual([
      { id: "work", label: "Work", agent: "claude-code", claude_config_dir: work, config_dir_exists: true },
      { id: "ghost", label: "Ghost", agent: "claude-code", claude_config_dir: join(f.dir, "gone"), config_dir_exists: false },
    ]);
    expect(r.out.data.herdr).toMatchObject({ socket_path: "C:\\Users\\me\\AppData\\Roaming\\herdr\\herdr.sock", workspace_label: "Agent Inbox" });
    expect(r.stdout).not.toContain(secret);
  });

  test("doctor reports a broken config instead of failing", () => {
    writeFileSync(configPath(f.home), "{");
    writeFileSync(profilesPath(f.home), "{");
    const r = cli(["doctor"]);
    expect(r.code).toBe(0);
    expect(r.out.data.herdr.error).toContain("not valid JSON");
    expect(r.out.data.profiles.error).toContain("not valid JSON");
  });
});

describe("review round 1 fixes", () => {
  test("unknown or misplaced config keys are refused, never defaulted", () => {
    for (const bad of [{ herdr: { socketPath: "D:\\x.sock" } }, { herdr: null }, { herdr: [] }, { herdrr: {} }, []]) {
      writeFileSync(configPath(f.home), JSON.stringify(bad));
      expectCode(() => loadConfig(f.home, { APPDATA: "C:\\x" }), "STORE_ERROR");
    }
  });

  test("root-relative and drive-relative paths are not absolute", () => {
    expectCode(() => writeProfiles(f.home, { work: "\\Users" }), "INVALID_ARGUMENT");
    expectCode(() => writeProfiles(f.home, { work: "C:Users" }), "INVALID_ARGUMENT");
    writeFileSync(configPath(f.home), JSON.stringify({ herdr: { socket_path: "/x.sock" } }));
    expectCode(() => loadConfig(f.home, {}), "STORE_ERROR");
    writeFileSync(configPath(f.home), JSON.stringify({ herdr: { socket_path: "\\\\server\\pipe\\herdr.sock" } }));
    expect(loadConfig(f.home, {}).herdr.socket_path).toBe("\\\\server\\pipe\\herdr.sock");
  });

  test("a trailing separator is not stored", () => {
    const p = writeProfiles(f.home, { work: `${work}\\` });
    expect(p.work?.claude_config_dir).toBe(work);
  });

  test("empty labels are refused", () => {
    expectCode(() => writeProfiles(f.home, { work }, { work: "  " }), "INVALID_ARGUMENT");
  });

  test("bad input is reported before an existing file", () => {
    writeProfiles(f.home, { work });
    expectCode(() => writeProfiles(f.home, { work: "relative" }), "INVALID_ARGUMENT");
  });
});
