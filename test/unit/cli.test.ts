import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Attempts } from "../../src/core/attempts";
import { Inbox } from "../../src/core/inbox";
import { READY_MARKER, buildOpeningPrompt } from "../../src/core/packet";
import { profilesPath } from "../../src/core/profiles";
import { type Fixture, fixture } from "../helpers";

const MAIN = join(import.meta.dir, "..", "..", "src", "cli", "main.ts");

let f: Fixture;
beforeEach(() => {
  f = fixture();
});
afterEach(() => f.cleanup());

interface Run {
  code: number;
  out: { api_version: number; ok: boolean; data?: any; error?: { code: string; retryable: boolean } };
  stdout: string;
}

function cli(args: string[], stdin?: string): Run {
  const r = Bun.spawnSync([process.execPath, MAIN, ...args], {
    env: { ...process.env, AGENT_INBOX_HOME: f.home },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = r.stdout.toString();
  return { code: r.exitCode ?? -1, out: JSON.parse(stdout), stdout };
}

async function cliAsync(args: string[]): Promise<Run> {
  const p = Bun.spawn([process.execPath, MAIN, ...args], {
    env: { ...process.env, AGENT_INBOX_HOME: f.home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(p.stdout).text();
  const code = await p.exited;
  return { code, out: JSON.parse(stdout), stdout };
}

function inputFile(payload: unknown, name = "item.json"): string {
  const p = join(f.dir, name);
  writeFileSync(p, JSON.stringify(payload));
  return p;
}

describe("envelope and exit codes", () => {
  test("success is ok:true on one stdout line, exit 0", () => {
    const r = cli(["submit", "--input", inputFile(f.actionable()), "--json"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ api_version: 1, ok: true, data: { created: true, deduplicated: false } });
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
  });

  test("stdin input works and deduplicates", () => {
    cli(["submit", "--input", inputFile(f.actionable())]);
    const r = cli(["submit", "--input", "-"], JSON.stringify(f.actionable()));
    expect(r.out.data).toMatchObject({ created: false, deduplicated: true });
  });

  test("a UTF-8 BOM in the input file is accepted", () => {
    const p = join(f.dir, "bom.json");
    writeFileSync(p, "﻿" + JSON.stringify(f.informational()));
    expect(cli(["submit", "--input", p]).code).toBe(0);
  });

  test("invalid input exits 2", () => {
    const r = cli(["submit", "--input", inputFile({ api_version: 1 })]);
    expect(r.code).toBe(2);
    expect(r.out).toMatchObject({ ok: false, error: { code: "INVALID_ITEM", retryable: false } });
  });

  test("unknown command and missing flags exit 2", () => {
    expect(cli(["frobnicate"]).code).toBe(2);
    expect(cli(["archive", "itm_x"]).out.error?.code).toBe("INVALID_ARGUMENT");
    expect(cli(["list", "--bogus"]).code).toBe(2);
  });

  test("domain errors exit 1", () => {
    const r = cli(["get", "itm_missing"]);
    expect(r.code).toBe(1);
    expect(r.out.error?.code).toBe("NOT_FOUND");
  });

  test("snooze requires an offset-qualified time", () => {
    const id = cli(["submit", "--input", inputFile(f.actionable())]).out.data.item.id;
    expect(cli(["snooze", id, "--until", "2030-01-01T09:00", "--if-state-version", "1"]).code).toBe(2);
    const ok = cli(["snooze", id, "--until", "2030-01-01T09:00:00+02:00", "--if-state-version", "1"]);
    expect(ok.out.data.item.snoozed_until).toBe("2030-01-01T07:00:00.000Z");
  });

  test("informational round trip through the CLI", () => {
    const id = cli(["submit", "--input", inputFile(f.informational())]).out.data.item.id;
    const read = cli(["mark-read", id, "--revision", "1"]).out.data.item;
    const ack = cli(["acknowledge", id, "--if-state-version", String(read.state_version), "--revision", "1"]);
    expect(ack.out.data.item).toMatchObject({ placement: "history", archive_reason: "acknowledged" });
    expect(cli(["list", "--view", "history"]).out.data.items).toHaveLength(1);
    expect(cli(["status"]).out.data.counts.history).toBe(1);
  });
});

describe("concurrency across processes", () => {
  test("parallel identical submissions create exactly one item", async () => {
    const p = inputFile(f.actionable());
    const runs = await Promise.all(Array.from({ length: 8 }, () => cliAsync(["submit", "--input", p])));
    expect(runs.every((r) => r.code === 0)).toBe(true);
    expect(new Set(runs.map((r) => r.out.data.item.id)).size).toBe(1);
    expect(runs.filter((r) => r.out.data.created)).toHaveLength(1);
    expect(f.inbox.events({}).events.filter((e) => e.type === "item.created")).toHaveLength(1);
  });

  test("parallel state changes on one version: exactly one wins", async () => {
    const { item } = f.inbox.submit(f.informational());
    const v = String(item.state_version);
    const runs = await Promise.all([
      cliAsync(["archive", item.id, "--if-state-version", v]),
      cliAsync(["acknowledge", item.id, "--if-state-version", v, "--revision", "1"]),
      cliAsync(["snooze", item.id, "--until", "2030-01-01T00:00:00Z", "--if-state-version", v]),
      cliAsync(["archive", item.id, "--if-state-version", v]),
    ]);
    expect(runs.filter((r) => r.out.ok)).toHaveLength(1);
    for (const r of runs.filter((r) => !r.out.ok)) expect(["STATE_CONFLICT", "ITEM_IN_HISTORY"]).toContain(r.out.error!.code);
  });

  test("parallel updates from the same revision: one new revision, others conflict", async () => {
    const { item } = f.inbox.submit(f.actionable());
    const files = Array.from({ length: 4 }, (_, i) => inputFile(f.actionable({ summary: `v2-${i}` }), `u${i}.json`));
    const runs = await Promise.all(files.map((p) => cliAsync(["update", item.id, "--if-revision", "1", "--input", p])));
    expect(runs.filter((r) => r.out.ok)).toHaveLength(1);
    expect(runs.filter((r) => r.out.error?.code === "REVISION_CONFLICT")).toHaveLength(3);
    expect(f.inbox.get(item.id).content_revision).toBe(2);
  });
});

describe("flag wiring", () => {
  test("get --include-context returns the retained handoff after the original is deleted", () => {
    const id = cli(["submit", "--input", inputFile(f.actionable())]).out.data.item.id;
    rmSync(join(f.dir, "handoff.md"));
    const r = cli(["get", id, "--include-context", "--json"]);
    expect(r.out.data.item.revision.handoff_text).toContain("Seven records were rejected.");
    expect(cli(["get", id]).out.data.item.revision.handoff_text).toBeUndefined();
  });

  test("list --cursor and filters, events --after round trip", () => {
    for (let i = 0; i < 3; i++) cli(["submit", "--input", inputFile(f.informational({ external_id: `n-${i}` }), `n${i}.json`)]);
    // A different producer and kind, so each filter is shown to exclude something.
    const other = cli(["submit", "--input", inputFile(f.actionable(), "a.json")]).out.data.item;
    const ids = (args: string[]) => cli(["list", ...args]).out.data.items.map((i: { id: string }) => i.id);
    expect(ids(["--kind", "informational"])).not.toContain(other.id);
    expect(ids(["--kind", "actionable"])).toEqual([other.id]);
    expect(ids(["--producer", "example.script"])).toEqual([other.id]);
    cli(["mark-read", other.id, "--revision", "1"]);
    expect(ids(["--unread"])).not.toContain(other.id);
    expect(ids([])).toContain(other.id);
    const p1 = cli(["list", "--limit", "2", "--kind", "informational", "--unread"]).out.data;
    expect(p1.items).toHaveLength(2);
    const p2 = cli(["list", "--limit", "2", "--kind", "informational", "--cursor", p1.next_cursor]).out.data;
    expect(p2.items).toHaveLength(1);
    expect(cli(["list", "--profile", "nobody"]).out.data.items).toHaveLength(0);
    const all = cli(["events"]).out.data;
    const first = all.events[0].cursor;
    const rest = cli(["events", "--after", first, "--producer", "example.reporter"]).out.data;
    const reporterEvents = all.events.filter((e: { producer_id: string }) => e.producer_id === "example.reporter");
    expect(rest.events.length).toBe(reporterEvents.length - 1);
    expect(rest.events.every((e: { producer_id: string }) => e.producer_id === "example.reporter")).toBe(true);
    expect(rest.next_cursor).toBe(all.next_cursor);
  });
});

describe("open, attempt get", () => {
  // Every launch here fails in preflight (missing cwd), so no worker ever reaches Herdr; the
  // config also names a socket nothing listens on.
  function setup() {
    const work = join(f.dir, "claude-work");
    mkdirSync(work);
    writeFileSync(profilesPath(f.home), JSON.stringify({ profiles: { work: { label: "Work", agent: "claude-code", claude_config_dir: work }, personal: { label: "P", agent: "claude-code", claude_config_dir: work } } }));
    writeFileSync(join(f.home, "config.json"), JSON.stringify({ herdr: { socket_path: join(f.dir, "no-herdr.sock") } }));
    const proj = join(f.dir, "proj");
    mkdirSync(proj);
    const item = cli(["submit", "--input", inputFile(f.actionable({ launch: { agent: "claude-code", cwd: proj, initial_instruction: "x" } }))]).out.data.item;
    rmSync(proj, { recursive: true });
    return item;
  }

  async function settled(attemptId: string) {
    const at = new Attempts(f.inbox);
    for (let i = 0; i < 100; i++) {
      const a = at.get(attemptId);
      if (a.status !== "in_progress") return a;
      await Bun.sleep(100);
    }
    throw new Error("the worker never finished");
  }

  test("open returns attempt_id, status and reused promptly; the detached worker carries on alone", async () => {
    const item = setup();
    const started = Date.now();
    const r = cli(["open", item.id, "--if-revision", "1", "--json"]);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(r.code).toBe(0);
    expect(r.out.data).toMatchObject({ status: "in_progress", reused: false });
    expect(r.out.data.attempt_id).toMatch(/^att_/);
    // The CLI has exited; the worker still ends the attempt, before any context is sent.
    const a = await settled(r.out.data.attempt_id);
    expect(a).toMatchObject({ status: "failed", phase: "preflight", error: { code: "CWD_UNAVAILABLE" } });
    const got = cli(["attempt", "get", a.id, "--json"]).out.data.attempt;
    expect(got).toMatchObject({ id: a.id, phase: "preflight", evidence: { prompt_state: "none", delivered: false } });
    expect(got.next_actions).toEqual([]);
    expect(JSON.stringify(got)).not.toMatch(/capability|challenge/);
  });

  test("a second open reuses the unfinished attempt, and starts a worker only if none ever ran", async () => {
    const item = setup();
    const at = new Attempts(f.inbox);
    // Reserved, but its worker never claimed it (e.g. it died at start-up).
    const first = at.open(item.id, 1).attempt;
    const r = cli(["open", item.id, "--if-revision", "1"]);
    expect(r.out.data).toMatchObject({ attempt_id: first.id, reused: true });
    expect(await settled(first.id)).toMatchObject({ status: "failed", error: { code: "CWD_UNAVAILABLE" } });
  });

  test("--profile records an override without changing the payload", async () => {
    const item = setup();
    const r = cli(["open", item.id, "--if-revision", "1", "--profile", "personal"]);
    expect(r.out.data.attempt).toMatchObject({ profile_id: "personal", profile_override: true });
    expect(f.inbox.get(item.id).revision.payload.profile_id).toBe("work");
    await settled(r.out.data.attempt_id);
  });

  test("a delivered revision needs --fresh; the CLI never adds it", async () => {
    const item = setup();
    const at = new Attempts(f.inbox);
    const { attempt } = at.open(item.id, 1);
    const gen = at.claim(attempt.id, "w", 60_000)!;
    at.setPacketPath(attempt.id, gen, join(f.dir, "p.md"));
    const row = at.row(attempt.id);
    at.bind(row.id, row.capability, { session_id: row.session_uuid, cwd: row.cwd, claude_config_dir: join(f.dir, "claude-work"), auth_env: [] });
    at.beginOp(row.id, gen, "dispatch_prompt");
    at.acceptPrompt(row.id, row.capability, row.session_uuid, row.cwd, buildOpeningPrompt(row.id, join(f.dir, "p.md"), row.packet_sha256));
    const body = { attempt_id: row.id, item_id: row.item_id, content_revision: 1, packet_sha256: row.packet_sha256, challenge: row.challenge };
    at.captureReceipt(row.id, row.capability, row.session_uuid, `Oriented.\n${READY_MARKER} ${JSON.stringify(body)}`);
    at.commitDelivery(row.id, gen, {});
    const state = f.inbox.get(item.id).state_version;
    cli(["restore", item.id, "--if-state-version", String(state)]);
    const plain = cli(["open", item.id, "--if-revision", "1"]);
    expect({ code: plain.code, err: plain.out.error?.code }).toEqual({ code: 1, err: "ALREADY_DELIVERED" });
    const fresh = cli(["open", item.id, "--if-revision", "1", "--fresh"]);
    expect({ fresh: fresh.out.data.attempt.fresh, reused: fresh.out.data.reused }).toEqual({ fresh: true, reused: false });
    expect(fresh.out.data.attempt_id).not.toBe(row.id);
    await settled(fresh.out.data.attempt_id);
  });

  test("retry picks up a blocked attempt in a new worker; a live worker is left alone; a closed one refuses", async () => {
    const item = setup();
    // The real clock, as the CLI uses: the fixture's fixed clock would make any lease look expired.
    const live = new Inbox({ home: f.home });
    const at = new Attempts(live);
    const { attempt } = at.open(item.id, 1);
    const g = at.claim(attempt.id, "someone", 60_000)!;
    // Held by a live worker: nothing new starts.
    expect(cli(["retry", attempt.id]).out.data).toMatchObject({ attempt_id: attempt.id, status: "in_progress", started: false });
    at.block(attempt.id, g, "AGENT_BLOCKED", "dialog");
    at.release(attempt.id, g);
    const r = cli(["retry", attempt.id]);
    expect(r.out.data).toMatchObject({ status: "blocked", started: true });
    // The retry worker lifts the block and runs preflight, which finds the cwd gone.
    let done = at.get(attempt.id);
    for (let i = 0; i < 100 && done.status !== "failed"; i++) {
      await Bun.sleep(100);
      done = at.get(attempt.id);
    }
    expect(done).toMatchObject({ status: "failed", error: { code: "CWD_UNAVAILABLE" } });
    const again = cli(["retry", attempt.id]);
    expect({ code: again.code, err: again.out.error?.code }).toEqual({ code: 1, err: "STATE_CONFLICT" });
    live.close();
  });

  test("retry refuses a wrong-profile block and starts nothing", () => {
    const item = setup();
    const at = new Attempts(f.inbox);
    const { attempt } = at.open(item.id, 1);
    const g = at.claim(attempt.id, "w", 60_000)!;
    at.block(attempt.id, g, "PROFILE_LAUNCH_UNSUPPORTED", "wrong profile");
    at.release(attempt.id, g);
    const r = cli(["retry", attempt.id]);
    expect({ code: r.code, err: r.out.error?.code }).toEqual({ code: 1, err: "PROFILE_LAUNCH_UNSUPPORTED" });
    expect(at.row(attempt.id).lease_owner).toBeNull();
  });

  test("abandon releases the item, keeps the session reference and revokes the capability", async () => {
    const item = setup();
    const at = new Attempts(f.inbox);
    const { attempt } = at.open(item.id, 1);
    const row = at.row(attempt.id);
    const r = cli(["abandon", attempt.id]);
    expect(r.out.data.attempt).toMatchObject({ status: "failed", revoked: true, session_uuid: row.session_uuid, error: { code: "ABANDONED" } });
    expect(f.inbox.get(item.id).blocking_attempt_id ?? null).toBeNull();
    expect(() => at.captureReceipt(row.id, row.capability, row.session_uuid, "x")).toThrow();
    expect(at.acceptPrompt(row.id, row.capability, row.session_uuid, row.cwd, `[agent-inbox ${row.id}] x`)).toMatchObject({ ok: false, code: "ATTEMPT_CLOSED" });
    const reopened = cli(["open", item.id, "--if-revision", "1"]);
    expect(reopened.out.data).toMatchObject({ reused: false });
    expect(reopened.out.data.attempt_id).not.toBe(row.id);
    await settled(reopened.out.data.attempt_id);
  });

  test("usage: attempt needs `get`; open needs --if-revision", () => {
    expect(cli(["attempt", "list", "att_x"]).code).toBe(2);
    expect(cli(["open", "itm_x"]).code).toBe(2);
  });
});
