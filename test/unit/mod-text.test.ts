import { describe, expect, test } from "bun:test";
import { age, inert, inertDeep, rowLine, rowStatus, width } from "../../mod/hooks/text";
import type { InboxRow } from "../../mod/types";

const ROW: InboxRow = {
  id: "itm_1",
  producer_id: "example.script",
  kind: "actionable",
  title: "Review the plan",
  profile_id: "work",
  created_at: "2026-10-22T10:00:00.000Z",
  read: false,
  snoozed_until: null,
  archive_reason: null,
  latest_attempt: null,
};
const NOW = Date.parse("2026-10-22T10:05:00.000Z");

describe("mod text is inert", () => {
  test("escape sequences, controls and bidi overrides are stripped", () => {
    expect(inert("\u001b[31mred\u001b[0m")).toBe("red");
    expect(inert("a\u001b]8;;https://x\u0007link\u001b]8;;\u001b\\b")).toBe("alinkb");
    expect(inert("bell\u0007 nul\u0000 del\u007f c1\u0085 csi\u009b2J")).toBe("bell nul del c1 csi");
    expect(inert("\u202eevil\u202c \u2066x\u2069")).toBe("evil x");
    expect(inert("ESC alone\u001b")).toBe("ESC alone");
  });

  test("line breaks become spaces unless multiline; tabs too", () => {
    expect(inert("a\r\nb\nc\td")).toBe("a b c d");
    expect(inert("a\r\nb\rc\td", { multiline: true })).toBe("a\nb\nc    d");
  });

  test("UTF-8 text and Windows paths stay; a lone surrogate is replaced", () => {
    expect(inert("Ελληνικά 日本 C:\\Users\\me\\x")).toBe("Ελληνικά 日本 C:\\Users\\me\\x");
    expect(inert("ok \ud83d")).toBe("ok \ufffd");
    expect(inert("😀")).toBe("😀");
  });

  test("every string of an answer is made inert, keys included", () => {
    expect(inertDeep<unknown>({ items: [{ title: "x\u001b[2J", n: 1, ok: true, none: null }], "k\u0007": "v" })).toEqual({
      items: [{ title: "x", n: 1, ok: true, none: null }],
      k: "v",
    });
  });
});

describe("mod rows", () => {
  test("status names starting, waiting on the user, waiting for ack, failure and uncertain", () => {
    const at = (status: NonNullable<InboxRow["latest_attempt"]>["status"], phase: string, error_code: string | null = null) =>
      rowStatus({ ...ROW, latest_attempt: { attempt_id: "att_1", status, phase, error_code } }, "active");
    expect(at("in_progress", "start_agent")).toBe("starting");
    expect(at("in_progress", "await_receipt")).toBe("awaiting ack");
    expect(at("blocked", "start_agent", "AGENT_BLOCKED")).toBe("needs you");
    expect(at("blocked", "focus", "FOCUS_FAILED")).toBe("blocked FOCUS_FAILED");
    expect(at("uncertain", "submit_context")).toBe("uncertain");
    expect(at("failed", "preflight", "CWD_INVALID")).toBe("failed CWD_INVALID");
    expect(rowStatus({ ...ROW, archive_reason: "acknowledged" }, "history")).toBe("acknowledged");
    expect(rowStatus(ROW, "active")).toBe("");
  });

  test("a row fits its width; the title gives way first", () => {
    const wide = rowLine(ROW, "active", NOW, 80);
    expect(wide).toBe("● A Review the plan" + " ".repeat(80 - 4 - 15 - 2 - "work  example.script  5m".length) + "  work  example.script  5m");
    expect([...wide].length).toBe(80);
    for (const cols of [20, 30, 44]) expect([...rowLine({ ...ROW, title: "A very long title ".repeat(5) }, "active", NOW, cols)].length).toBeLessThanOrEqual(cols);
    expect(rowLine({ ...ROW, read: true, kind: "informational" }, "active", NOW, 40).startsWith("  i Review")).toBe(true);
  });

  test("wide characters count two cells, so a CJK title never wraps the row", () => {
    expect(width("日本")).toBe(4);
    expect(width("Ελληνικά ✓")).toBe(10);
    expect(width("é")).toBe(1);
    const row = { ...ROW, title: "Build done: Ελληνικά 日本 ✓ " + "日本".repeat(30) };
    for (const cols of [24, 40, 71, 80]) {
      const line = rowLine(row, "active", NOW, cols);
      expect(width(line)).toBeLessThanOrEqual(cols);
      // Under ~40 cells the tail is cut too, the title keeping its 10.
      if (cols >= 40) expect(line.endsWith("5m")).toBe(true);
    }
    expect(width(rowLine({ ...ROW, title: "日本" }, "active", NOW, 80))).toBe(80);
  });

  test("age reads in the largest whole unit", () => {
    expect(age("2026-10-22T10:04:30.000Z", NOW)).toBe("30s");
    expect(age("2026-10-22T07:00:00.000Z", NOW)).toBe("3h");
    expect(age("2026-10-19T10:00:00.000Z", NOW)).toBe("3d");
  });
});
