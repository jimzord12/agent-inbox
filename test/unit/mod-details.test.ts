import { describe, expect, test } from "bun:test";
import { PAGE_CHARS, PAGE_LINES, attemptLine, lineCount, paginate, progress, unpaginate, when } from "../../mod/hooks/text";
import type { InboxAttempt } from "../../mod/types";

const KIB_256 = 256 * 1024;

function handoff(lineOf: (i: number) => string): string {
  let out = "";
  for (let i = 0; out.length < KIB_256; i++) out += `${lineOf(i)}\n`;
  return out;
}

describe("handoff paging", () => {
  const shapes: [string, string][] = [
    ["short lines", handoff((i) => `line ${i}: the plan, step by step`)],
    ["blank and long lines mixed", handoff((i) => (i % 7 === 0 ? "" : i % 11 === 0 ? "x".repeat(5000) : `- point ${i}`))],
    ["one line of 256 KiB", "y".repeat(KIB_256)],
    ["wide characters and emoji at piece edges", handoff(() => "日本🚀".repeat(900))],
    ["no trailing break", `${"z\n".repeat(1000)}end`],
  ];

  for (const [name, text] of shapes) {
    test(`${name}: every page is bounded and the pages join back to the exact text`, () => {
      const pages = paginate(text);
      expect(unpaginate(pages)).toBe(text);
      for (const page of pages) {
        // The empty piece after a final break may ride on a full last page.
        expect(page.filter((p, i) => !(i === PAGE_LINES && p.text === "")).length).toBeLessThanOrEqual(PAGE_LINES);
        expect(page.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(PAGE_CHARS);
      }
      // Lines are numbered in order with none skipped.
      const lines = [...new Set(pages.flat().map((p) => p.line))];
      expect(lines).toEqual(lines.map((_, i) => i + 1));
      expect(lines.length).toBe(text.split("\n").length);
    });
  }

  test("a handoff of whole pages ending in a line break has no empty last page", () => {
    for (const n of [1, 2, 3]) {
      const text = "x\n".repeat(PAGE_LINES * n);
      const pages = paginate(text);
      expect(pages.length).toBe(n);
      expect(unpaginate(pages)).toBe(text);
      expect(lineCount(pages)).toBe(PAGE_LINES * n);
    }
  });

  test("lines are counted as a person counts them", () => {
    expect(lineCount(paginate("a\nb\n"))).toBe(2);
    expect(lineCount(paginate("a\nb"))).toBe(2);
    expect(lineCount(paginate("a\n\n"))).toBe(2);
    expect(lineCount(paginate(""))).toBe(1);
  });

  test("an empty handoff is one empty page", () => {
    expect(paginate("")).toEqual([[{ text: "", line: 1, joined: false }]]);
  });

  test("a piece never splits a surrogate pair", () => {
    for (const p of paginate("🚀".repeat(5000)).flat()) expect(p.text).not.toMatch(/[\ud800-\udbff]$|^[\udc00-\udfff]/);
  });
});

function attempt(o: Partial<InboxAttempt> = {}): InboxAttempt {
  return {
    id: "att_1",
    status: "in_progress",
    phase: "start_agent",
    profile_id: "work",
    cwd: "C:\\work\\x",
    session_uuid: "11111111-1111-4111-8111-111111111111",
    error: null,
    availability: null,
    evidence: { bound: false, prompt_state: "none", receipt_candidate: false, delivered: false, focused: false },
    next_actions: [],
    ...o,
  };
}

describe("attempt progress", () => {
  test("distinguishes starting, waiting on the user, waiting for acknowledgment, focus failure and uncertain", () => {
    const labels = [
      progress(attempt({ phase: "create_layout" })),
      progress(attempt({ status: "blocked", phase: "start_agent", error: { code: "AGENT_BLOCKED", message: "A dialog holds the start." } })),
      progress(attempt({ phase: "await_receipt", evidence: { ...attempt().evidence, bound: true, prompt_state: "accepted" } })),
      progress(attempt({ status: "blocked", phase: "focus", error: { code: "AGENT_UNAVAILABLE", message: "focusing it failed" } })),
      progress(attempt({ status: "uncertain", phase: "submit_context" })),
    ].map((p) => p.label);
    expect(labels).toEqual(["Starting the session", "Waiting on you", "Waiting for the session to acknowledge the handoff", "Focus failed", "Outcome uncertain"]);
    expect(new Set(labels).size).toBe(5);
  });

  test("acknowledged then stopped short of focus is not a focus failure; neither offers a resend", () => {
    // The worker's four blocks after acknowledgment and before focus (src/worker/worker.ts awaitReceipt).
    for (const [code, message] of [
      ["AGENT_UNAVAILABLE", "Claude closed after acknowledging; the receipt is kept."],
      ["AGENT_UNAVAILABLE", "Herdr no longer reports the attempt's session in its pane."],
      ["RECEIPT_INVALID", "Claude has not settled after acknowledging."],
      ["RECEIPT_INVALID", "Claude acknowledged, but Herdr does not report its session id."],
    ] as const) {
      const p = progress(attempt({ status: "blocked", phase: "await_receipt", error: { code, message }, evidence: { ...attempt().evidence, receipt_candidate: true } }));
      expect(p.label).toBe("Acknowledged, then stopped");
      expect(p.hint).toStartWith(message);
      expect(p.hint).toContain("nothing is resent");
      expect(p.hint).not.toContain("could not be focused");
    }
    const focus = progress(attempt({ status: "blocked", phase: "focus", error: { code: "AGENT_UNAVAILABLE", message: "The session acknowledged, but focusing it failed: gone." }, evidence: { ...attempt().evidence, receipt_candidate: true } }));
    expect(focus.label).toBe("Focus failed");
    expect(focus.hint).toContain("nothing is resent");
  });

  test("sending the handoff comes before waiting for its acknowledgment", () => {
    expect(progress(attempt({ phase: "submit_context" })).label).toBe("Sending the handoff");
    expect(progress(attempt({ phase: "await_receipt" })).label).toBe("Waiting for the session to acknowledge the handoff");
  });

  test("uncertain reads as retryable, not as a failure", () => {
    const p = progress(attempt({ status: "uncertain" }));
    expect(p.tone).toBe("attention");
    expect(p.hint).toContain("Retry checks what happened first");
  });

  test("failure and delivery carry the error and the stored availability", () => {
    expect(progress(attempt({ status: "failed", phase: "preflight", error: { code: "CWD_UNAVAILABLE", message: "The folder is gone." } }))).toMatchObject({
      label: "Failed: CWD_UNAVAILABLE",
      hint: "The folder is gone.",
      tone: "error",
    });
    expect(progress(attempt({ status: "succeeded", phase: "focus", availability: "closed" })).hint).toContain("the session has closed");
    expect(progress(attempt({ status: "blocked", phase: "start_agent", error: { code: "HERDR_UNAVAILABLE", message: "down" } })).label).toBe("Blocked: HERDR_UNAVAILABLE");
  });

  test("a prior attempt reads on one line", () => {
    expect(
      attemptLine({
        attempt_id: "att_1",
        status: "succeeded",
        phase: "focus",
        error_code: null,
        profile_id: "work",
        session_uuid: "s",
        availability: "live",
        created_at: "2026-10-22T10:00:00.000Z",
        delivered_at: "2026-10-22T10:01:30.000Z",
      }),
    ).toBe("2026-10-22 10:00 UTC  work  delivered 2026-10-22 10:01 UTC · the session was open when last checked");
    expect(when(null)).toBe("");
  });
});
