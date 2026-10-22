import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock } from "../src/core/clock";
import { Inbox } from "../src/core/inbox";

export class FakeClock implements Clock {
  t: number;
  constructor(iso = "2026-10-22T09:00:00.000Z") {
    this.t = Date.parse(iso);
  }
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export interface Fixture {
  dir: string;
  home: string;
  clock: FakeClock;
  inbox: Inbox;
  writeHandoff(name: string, text: string): string;
  actionable(overrides?: Record<string, unknown>): Record<string, unknown>;
  informational(overrides?: Record<string, unknown>): Record<string, unknown>;
  cleanup(): void;
}

export function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "agent-inbox-test-"));
  const home = join(dir, "home");
  const clock = new FakeClock();
  const inbox = new Inbox({ home, clock });
  const writeHandoff = (name: string, text: string) => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  };
  const defaultHandoff = writeHandoff("handoff.md", "# Handoff\n\nSeven records were rejected.\n");
  return {
    dir,
    home,
    clock,
    inbox,
    writeHandoff,
    actionable: (o = {}) => ({
      api_version: 1,
      producer_id: "example.script",
      external_id: "run-1:notice-1",
      kind: "actionable",
      title: "Review the prepared findings",
      summary: "A new report is ready for discussion.",
      profile_id: "work",
      handoff_path: defaultHandoff,
      launch: { agent: "claude-code", cwd: dir, initial_instruction: "Read the handoff, orient me, then wait." },
      ...o,
    }),
    informational: (o = {}) => ({
      api_version: 1,
      producer_id: "example.reporter",
      external_id: "report-1",
      kind: "informational",
      title: "Nightly report generated",
      summary: "Nothing to do now.",
      profile_id: "personal",
      ...o,
    }),
    cleanup: () => {
      inbox.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    const actual = (err as { code?: string }).code;
    if (actual !== code) throw new Error(`expected ${code}, got ${actual}: ${(err as Error).message}`);
    return err as { code: string; details?: Record<string, unknown> };
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
}
