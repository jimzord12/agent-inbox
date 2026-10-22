#!/usr/bin/env bun
// agent-inbox JSON CLI (spec §8). stdout carries exactly one JSON envelope; diagnostics go to stderr.
// Exit 0 = command accepted, 1 = operational/domain error, 2 = invalid usage or input.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Attempts } from "../core/attempts";
import { parseOffsetTime } from "../core/clock";
import { defaultProfileDirs, writeProfiles } from "../core/config";
import { InboxError } from "../core/errors";
import { ensureHome, resolveHome } from "../core/home";
import { Inbox, type View } from "../core/inbox";
import { profilesPath } from "../core/profiles";
import { Herdr } from "../herdr/adapter";
import { focusItem } from "../worker/focus";
import { failBeforeStart, needsWorker } from "../worker/worker";
import { doctor } from "./doctor";

type Flags = Record<string, string | boolean | string[] | undefined>;

interface Command {
  options: Record<string, { type: "string" | "boolean"; multiple?: boolean }>;
  positionals: number;
  run(inbox: () => Inbox, args: string[], flags: Flags): unknown | Promise<unknown>;
}

const json = { json: { type: "boolean" as const } };

const COMMANDS: Record<string, Command> = {
  submit: {
    options: { ...json, input: { type: "string" } },
    positionals: 0,
    run: (inbox, _a, f) => {
      const { item, created } = inbox().submit(readInput(f));
      return { item, created, deduplicated: !created };
    },
  },
  update: {
    options: { ...json, input: { type: "string" }, "if-revision": { type: "string" } },
    positionals: 1,
    run: (inbox, [id], f) => inbox().update(id!, int(f, "if-revision"), readInput(f)),
  },
  get: {
    options: { ...json, "include-context": { type: "boolean" } },
    positionals: 1,
    run: (inbox, [id], f) => ({ item: inbox().get(id!, { includeContext: f["include-context"] === true }) }),
  },
  list: {
    options: {
      ...json,
      view: { type: "string" },
      profile: { type: "string" },
      producer: { type: "string" },
      kind: { type: "string" },
      unread: { type: "boolean" },
      limit: { type: "string" },
      cursor: { type: "string" },
    },
    positionals: 0,
    run: (inbox, _a, f) => {
      const view = (str(f, "view") ?? "active") as View;
      if (!["active", "snoozed", "history"].includes(view)) usage("`--view` must be active, snoozed or history.", "view");
      const kind = str(f, "kind");
      if (kind && kind !== "informational" && kind !== "actionable") usage("`--kind` must be informational or actionable.", "kind");
      return inbox().list({
        view,
        profile: str(f, "profile"),
        producer: str(f, "producer"),
        kind: kind as "informational" | "actionable" | undefined,
        unread: f.unread === true,
        limit: optInt(f, "limit"),
        cursor: str(f, "cursor"),
      });
    },
  },
  events: {
    options: { ...json, after: { type: "string" }, producer: { type: "string" }, item: { type: "string" }, limit: { type: "string" } },
    positionals: 0,
    run: (inbox, _a, f) =>
      inbox().events({ after: str(f, "after"), producer: str(f, "producer"), item: str(f, "item"), limit: optInt(f, "limit") }),
  },
  "mark-read": {
    options: { ...json, revision: { type: "string" } },
    positionals: 1,
    run: (inbox, [id], f) => ({ item: inbox().markRead(id!, int(f, "revision")) }),
  },
  "mark-unread": {
    options: json,
    positionals: 1,
    run: (inbox, [id]) => ({ item: inbox().markUnread(id!) }),
  },
  acknowledge: {
    options: { ...json, "if-state-version": { type: "string" }, revision: { type: "string" } },
    positionals: 1,
    run: (inbox, [id], f) => ({ item: inbox().acknowledge(id!, int(f, "if-state-version"), int(f, "revision")) }),
  },
  snooze: {
    options: { ...json, until: { type: "string" }, "if-state-version": { type: "string" } },
    positionals: 1,
    run: (inbox, [id], f) => {
      const raw = str(f, "until") ?? usage("`--until` is required.", "until");
      const until = parseOffsetTime(raw) ?? usage("`--until` must be an offset-qualified time, e.g. 2026-10-23T09:00:00+03:00.", "until");
      return { item: inbox().snooze(id!, until, int(f, "if-state-version")) };
    },
  },
  unsnooze: {
    options: { ...json, "if-state-version": { type: "string" } },
    positionals: 1,
    run: (inbox, [id], f) => ({ item: inbox().unsnooze(id!, int(f, "if-state-version")) }),
  },
  archive: {
    options: { ...json, "if-state-version": { type: "string" } },
    positionals: 1,
    run: (inbox, [id], f) => ({ item: inbox().archive(id!, int(f, "if-state-version")) }),
  },
  restore: {
    options: { ...json, "if-state-version": { type: "string" } },
    positionals: 1,
    run: (inbox, [id], f) => ({ item: inbox().restore(id!, int(f, "if-state-version")) }),
  },
  // User actions: reserve an attempt and start its detached worker; never waits for the handoff.
  open: {
    options: { ...json, "if-revision": { type: "string" }, profile: { type: "string" }, fresh: { type: "boolean" } },
    positionals: 1,
    run: (inbox, [id], f) => {
      const { attempt, reused } = new Attempts(inbox()).open(id!, int(f, "if-revision"), { profile: str(f, "profile"), fresh: f.fresh === true });
      // A reused attempt gets a worker only when none ever ran on it and nothing external was
      // recorded (e.g. the first worker died before its claim). Anything further is retry (INB-008).
      if (!reused || needsWorker(inbox(), attempt.id)) startWorker(inbox(), attempt.id);
      const now = new Attempts(inbox()).get(attempt.id);
      return { attempt_id: now.id, status: now.status, reused, attempt: now };
    },
  },
  attempt: {
    options: json,
    positionals: 2,
    run: (inbox, [sub, id]) => {
      if (sub !== "get") usage("Usage: agent-inbox attempt get ATTEMPT --json");
      return { attempt: new Attempts(inbox()).get(id!) };
    },
  },
  focus: {
    options: json,
    positionals: 1,
    run: (inbox, [id]) => focusItem(inbox(), (socketPath) => new Herdr({ socketPath }), id!),
  },
  status: {
    options: json,
    positionals: 0,
    run: (inbox) => inbox().status(),
  },
  doctor: {
    options: json,
    positionals: 0,
    run: () => doctor(),
  },
  // User setup, not a producer command: writes profiles.json in the inbox home.
  "setup-profiles": {
    options: {
      ...json,
      profile: { type: "string", multiple: true },
      label: { type: "string", multiple: true },
      force: { type: "boolean" },
    },
    positionals: 0,
    run: (_inbox, _a, f) => {
      const pairs = (name: string) => {
        const out: Record<string, string> = {};
        for (const v of (f[name] as string[] | undefined) ?? []) {
          const i = v.indexOf("=");
          if (i < 1) usage(`\`--${name}\` takes ID=VALUE, got "${v}".`, name);
          const id = v.slice(0, i);
          if (id in out) usage(`\`--${name}\` names "${id}" twice.`, name);
          out[id] = v.slice(i + 1);
        }
        return out;
      };
      const given = pairs("profile");
      const dirs = Object.keys(given).length ? given : defaultProfileDirs();
      const home = ensureHome(resolveHome());
      const profiles = writeProfiles(home, dirs, pairs("label"), f.force === true);
      return { path: profilesPath(home), profiles: Object.values(profiles) };
    },
  },
};

const WORKER = join(import.meta.dir, "..", "worker", "main.ts");

// Detached with stdio ignored: an inherited pipe would hold the caller (the mod) until timeout.
function startWorker(inbox: Inbox, attemptId: string) {
  try {
    const child = spawn(process.execPath, [WORKER, attemptId], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, AGENT_INBOX_HOME: inbox.home },
    });
    child.on("error", () => {});
    child.unref();
  } catch (err) {
    failBeforeStart(inbox, attemptId, `cli:${process.pid}`, "INTERNAL", `The worker could not be started: ${(err as Error).message}`);
  }
}

function usage(message: string, field?: string): never {
  throw new InboxError("INVALID_ARGUMENT", message, field ? { field } : undefined);
}

function str(f: Flags, name: string): string | undefined {
  const v = f[name];
  return typeof v === "string" ? v : undefined;
}

function optInt(f: Flags, name: string): number | undefined {
  const v = str(f, name);
  if (v === undefined) return undefined;
  if (!/^-?\d+$/.test(v)) usage(`\`--${name}\` must be an integer.`, name);
  return Number(v);
}

function int(f: Flags, name: string): number {
  return optInt(f, name) ?? usage(`\`--${name}\` is required.`, name);
}

// JSON input comes from a file or stdin (`--input -`); never from a shell argument.
function readInput(f: Flags): unknown {
  const src = str(f, "input") ?? usage("`--input FILE` (or `--input -` for stdin) is required.", "input");
  let text: string;
  try {
    text = src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8");
  } catch (err) {
    usage(`Cannot read input: ${(err as NodeJS.ErrnoException).code ?? "error"}.`, "input");
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new InboxError("INVALID_ITEM", "Input is not valid JSON.", { field: "" });
  }
}

function emit(envelope: unknown, code: number): never {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exit(code);
}

export async function main(argv: string[]) {
  const [name, ...rest] = argv;
  let inbox: Inbox | undefined;
  try {
    const cmd = name ? COMMANDS[name] : undefined;
    if (!cmd) usage(name ? `Unknown command \`${name}\`.` : `Usage: agent-inbox <${Object.keys(COMMANDS).join("|")}> [options] --json`);
    let parsed: { values: Flags; positionals: string[] };
    try {
      parsed = parseArgs({ args: rest, options: cmd.options, allowPositionals: true, strict: true }) as typeof parsed;
    } catch (err) {
      usage((err as Error).message);
    }
    if (parsed.positionals.length !== cmd.positionals) {
      usage(cmd.positionals ? `\`${name}\` takes ${cmd.positionals} argument(s), e.g. an item id.` : `\`${name}\` takes no arguments.`);
    }
    const lazyInbox = () => (inbox ??= new Inbox({ home: resolveHome() }));
    const data = await cmd.run(lazyInbox, parsed.positionals, parsed.values);
    inbox?.close();
    emit({ api_version: 1, ok: true, data }, 0);
  } catch (err) {
    inbox?.close();
    const e = err instanceof InboxError ? err : new InboxError("INTERNAL", err instanceof Error ? err.message : String(err));
    if (e.code === "INTERNAL") console.error(err);
    emit({ api_version: 1, ok: false, error: e.toJSON() }, e.isUsage ? 2 : 1);
  }
}

if (import.meta.main) await main(process.argv.slice(2));
