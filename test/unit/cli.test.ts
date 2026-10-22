import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    const p1 = cli(["list", "--limit", "2", "--kind", "informational", "--unread"]).out.data;
    expect(p1.items).toHaveLength(2);
    const p2 = cli(["list", "--limit", "2", "--cursor", p1.next_cursor]).out.data;
    expect(p2.items).toHaveLength(1);
    expect(cli(["list", "--profile", "nobody"]).out.data.items).toHaveLength(0);
    const all = cli(["events"]).out.data;
    const first = all.events[0].cursor;
    const rest = cli(["events", "--after", first, "--producer", "example.reporter"]).out.data;
    expect(rest.events.length).toBe(all.events.length - 1);
    expect(rest.next_cursor).toBe(all.next_cursor);
  });
});
