// Pure helpers of the /inbox mod: making producer text inert and laying out list rows. No engine
// calls here, so the repository's unit tests cover this file directly.

import type { InboxAttempt, InboxAttemptSummary, InboxDetail, InboxRow, InboxView } from "../types";

// Escape sequences first (CSI, OSC, the two-byte forms), then any control character left over.
// One string the engine cannot draw makes it refuse the whole pane (docs/decisions.md, mod spike).
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]?/g;
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const ESC = /\u001b[\s\S]?/g;
const C1_CSI = /\u009b[0-?]*[ -/]*[@-~]?/g;
// C0 but tab, LF and CR (handled below), DEL, C1, and the bidirectional overrides that would
// let a title draw in another order than it reads.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

// `multiline` keeps line breaks (a handoff preview); otherwise every break and tab is a space.
export function inert(text: string, opts: { multiline?: boolean } = {}): string {
  let s = text.replace(LONE_SURROGATE, "\ufffd").replace(OSC, "").replace(CSI, "").replace(C1_CSI, "").replace(ESC, "").replace(CONTROL, "");
  s = s.replace(/\r\n?/g, "\n");
  s = opts.multiline ? s.replace(/\t/g, "    ") : s.replace(/[\t\n]/g, " ");
  return s;
}

// Every string of a CLI answer, keys included, made inert before anything reaches the pane. The
// mod reads answers `multiline` (a handoff, a summary keep their lines); a field drawn on one line
// goes through `oneLine` where it is drawn.
export function inertDeep<T>(value: T, opts: { multiline?: boolean } = {}): T {
  if (typeof value === "string") return inert(value, opts) as T;
  if (Array.isArray(value)) return value.map((v) => inertDeep(v, opts)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    // Defined, not assigned: a `__proto__` key from JSON stays a plain key.
    for (const [k, v] of Object.entries(value)) {
      Object.defineProperty(out, inert(k), { value: inertDeep(v, opts), enumerable: true, writable: true, configurable: true });
    }
    return out as T;
  }
  return value;
}

export function oneLine(text: string): string {
  return text.replace(/\n/g, " ");
}

type View = InboxView;
type Row = InboxRow;

export function toRow(item: Row): Row {
  return {
    id: item.id,
    producer_id: item.producer_id,
    kind: item.kind,
    title: oneLine(item.title),
    profile_id: item.profile_id,
    created_at: item.created_at,
    read: item.read,
    snoozed_until: item.snoozed_until,
    archive_reason: item.archive_reason,
    latest_attempt: item.latest_attempt ?? null,
  };
}

export function age(fromIso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000));
  if (!Number.isFinite(s)) return "?";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// The launch or error status a row shows (spec §12.1). Empty when there is nothing to say.
export function rowStatus(row: Row, view: View): string {
  if (view === "history") return row.archive_reason ?? "";
  const a = row.latest_attempt;
  if (!a) return "";
  switch (a.status) {
    case "in_progress":
      return a.phase === "submit_context" || a.phase === "await_receipt" ? "awaiting ack" : a.phase === "focus" ? "focusing" : "starting";
    case "blocked":
      return a.error_code === "AGENT_BLOCKED" ? "needs you" : `blocked ${a.error_code ?? ""}`.trim();
    case "uncertain":
      return "uncertain";
    case "failed":
      return `failed ${a.error_code ?? ""}`.trim();
    case "succeeded":
      return "delivered";
  }
}

// Terminal cells a character takes: East Asian wide and fullwidth forms and emoji take two,
// combining marks none. Close enough for a list row; the row's Text also truncates as a backstop.
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693],
  [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f2ff],
  [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
];

const ZWJ = 0x200d;
const VS16 = 0xfe0f;

function isJoining(cp: number): boolean {
  return (cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) || cp === 0x20e3;
}

// What the terminal draws as one glyph: a character with its combining marks, variation
// selectors and skin tones, and anything a zero-width joiner glues on (👨‍👩‍👧).
function clusters(s: string): string[] {
  const out: string[] = [];
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    let c = chars[i]!;
    while (i + 1 < chars.length) {
      const next = chars[i + 1]!.codePointAt(0)!;
      if (isJoining(next)) c += chars[++i];
      else if (next === ZWJ && i + 2 < chars.length) c += chars[++i]! + chars[++i]!;
      else break;
    }
    out.push(c);
  }
  return out;
}

function cells(cluster: string): number {
  const cps = [...cluster].map((ch) => ch.codePointAt(0)!);
  const first = cps[0] ?? 0;
  if (isJoining(first) || (first >= 0x200b && first <= 0x200d)) return 0;
  // An emoji presentation selector or a joined sequence draws as an emoji: two cells.
  if (cps.includes(VS16) || cps.includes(ZWJ)) return 2;
  return WIDE.some(([lo, hi]) => first >= lo && first <= hi) ? 2 : 1;
}

export function width(s: string): number {
  let n = 0;
  for (const c of clusters(s)) n += cells(c);
  return n;
}

// `s` padded or cut to exactly `w` cells, an ellipsis marking a cut.
function fit(s: string, w: number): string {
  if (w <= 0) return "";
  const have = width(s);
  if (have <= w) return s + " ".repeat(w - have);
  let out = "";
  let used = 0;
  for (const c of clusters(s)) {
    const n = cells(c);
    if (used + n > w - 1) break;
    out += c;
    used += n;
  }
  return `${out}…${" ".repeat(w - 1 - used)}`;
}

// One row as a single line of at most `columns` cells: selection mark, unread mark, kind, title,
// then profile, producer, age and status. The title gives way first on a narrow pane. Selection
// is a glyph, not an inverse, since the terminal inverts the row holding the keyboard focus.
export function rowLine(row: Row, view: View, nowMs: number, columns: number, selected = false): string {
  const pick = selected ? "›" : " ";
  const mark = row.read ? " " : "●";
  const kind = row.kind === "actionable" ? "A" : "i";
  const status = rowStatus(row, view);
  const tail = [row.profile_id, row.producer_id, age(row.created_at, nowMs), status].filter(Boolean).join("  ");
  const head = `${pick}${mark} ${kind} `;
  const room = columns - width(head);
  if (room <= 0) return fit(head, columns);
  const tailRoom = Math.min(width(tail), Math.max(0, room - 10 - 2));
  const titleRoom = room - (tailRoom ? tailRoom + 2 : 0);
  return `${head}${fit(row.title, titleRoom)}${tailRoom ? `  ${fit(tail, tailRoom)}` : ""}`.trimEnd();
}

// --- Details (spec §12.1) ---

// The fields of a `get --include-context` item the details view reads (src/core/inbox.ts ItemDetail).
export interface RawDetail {
  id: string;
  kind: InboxDetail["kind"];
  title: string;
  producer_id: string;
  profile_id: string;
  placement: InboxView;
  read: boolean;
  content_revision: number;
  state_version: number;
  snoozed_until: string | null;
  archive_reason: string | null;
  revision: {
    received_at: string;
    payload: { summary: string; launch?: { cwd: string; initial_instruction: string }; context_refs?: InboxDetail["context_refs"] };
    handoff: InboxDetail["handoff"];
    handoff_text?: string;
  };
  attempts?: InboxAttemptSummary[];
}

export function toDetail(item: RawDetail): InboxDetail {
  const r = item.revision;
  const launch = r.payload.launch;
  return {
    id: item.id,
    kind: item.kind,
    title: oneLine(item.title),
    producer_id: item.producer_id,
    profile_id: item.profile_id,
    placement: item.placement,
    read: item.read,
    content_revision: item.content_revision,
    state_version: item.state_version,
    snoozed_until: item.snoozed_until,
    archive_reason: item.archive_reason,
    summary: r.payload.summary,
    received_at: r.received_at,
    launch: launch ? { cwd: launch.cwd, initial_instruction: launch.initial_instruction } : null,
    context_refs: r.payload.context_refs ?? [],
    handoff: r.handoff,
    handoff_text: r.handoff_text ?? null,
    attempts: item.attempts ?? [],
  };
}

export function toAttempt(a: InboxAttempt): InboxAttempt {
  return {
    id: a.id,
    status: a.status,
    phase: a.phase,
    profile_id: a.profile_id,
    cwd: a.cwd,
    session_uuid: a.session_uuid,
    error: a.error,
    availability: a.availability,
    evidence: {
      bound: a.evidence.bound,
      prompt_state: a.evidence.prompt_state,
      receipt_candidate: a.evidence.receipt_candidate,
      delivered: a.evidence.delivered,
      focused: a.evidence.focused,
    },
    next_actions: a.next_actions,
  };
}

// An ISO time as the person reads it. UTC, said so: the mod has no time zone database of its own.
export function when(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "";
}

// `s` cut to `n` characters (by code point), an ellipsis marking the cut. Used for fields drawn
// beside the handoff page, so the page itself always fits the engine's per-tree limit.
export function clip(s: string, n: number): string {
  const chars = [...s];
  return chars.length <= n ? s : `${chars.slice(0, n - 1).join("")}…`;
}

// What the details view draws of a reference: at most 32 refs at REF_LABEL + REF_URI characters each
// leave room for the summary (4 KiB), instruction (16 KiB) and a handoff page under 100,000.
export const REF_LABEL = 80;
export const REF_URI = 300;

export function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

// The handoff in pages. A page holds at most PAGE_LINES pieces and about PAGE_CHARS characters, so
// a 256 KiB handoff never meets the engine's 100,000-character limit on one tree. A line longer
// than PIECE_CHARS is cut into pieces; `joined` marks a piece that continues the line before it.
export const PAGE_LINES = 40;
export const PAGE_CHARS = 6000;
export const PIECE_CHARS = 2000;

export interface Piece {
  text: string;
  line: number;
  joined: boolean;
}

export function paginate(text: string): Piece[][] {
  const pieces: Piece[] = [];
  text.split("\n").forEach((line, i) => {
    const chars = [...line];
    if (chars.length <= PIECE_CHARS) {
      pieces.push({ text: line, line: i + 1, joined: false });
      return;
    }
    for (let at = 0; at < chars.length; at += PIECE_CHARS) {
      pieces.push({ text: chars.slice(at, at + PIECE_CHARS).join(""), line: i + 1, joined: at > 0 });
    }
  });
  const pages: Piece[][] = [];
  let page: Piece[] = [];
  let chars = 0;
  for (const [i, p] of pieces.entries()) {
    // The empty piece after a final line break stays on the last page rather than opening one.
    const isTrailingBreak = i === pieces.length - 1 && i > 0 && p.text === "" && !p.joined;
    if (page.length && !isTrailingBreak && (page.length >= PAGE_LINES || chars + p.text.length > PAGE_CHARS)) {
      pages.push(page);
      page = [];
      chars = 0;
    }
    page.push(p);
    chars += p.text.length;
  }
  pages.push(page);
  return pages;
}

// Lines as a person counts them: a final line break ends the last line, it does not start one.
export function lineCount(pages: Piece[][]): number {
  const last = pages.at(-1)?.at(-1);
  if (!last) return 0;
  return last.text === "" && !last.joined && last.line > 1 ? last.line - 1 : last.line;
}

// The pages joined back: exactly the text paginated (the check that no line is lost).
export function unpaginate(pages: Piece[][]): string {
  let out = "";
  pages.flat().forEach((p, i) => {
    out += i === 0 || p.joined ? p.text : `\n${p.text}`;
  });
  return out;
}

export interface Progress {
  label: string;
  hint: string;
  tone: "progress" | "attention" | "error" | "done";
}

const AVAILABILITY: Record<string, string> = {
  live: "the session was open when last checked",
  closed: "the session has closed",
  unknown: "another session holds its tab now; this one may live on elsewhere",
  unavailable: "Herdr could not be asked when last checked",
};

export function availabilityText(a: InboxAttempt["availability"]): string {
  return a ? (AVAILABILITY[a] ?? a) : "not checked yet";
}

// What an attempt is doing, in the person's words (spec §12.1): starting, waiting on the user,
// waiting for acknowledgment, focus failure, uncertain, and the final outcomes.
export function progress(a: InboxAttempt): Progress {
  const code = a.error?.code ?? null;
  const message = a.error?.message ?? "";
  switch (a.status) {
    case "in_progress":
      if (a.phase === "submit_context") return { label: "Sending the handoff", hint: "The opening prompt is going to the new session.", tone: "progress" };
      if (a.phase === "await_receipt") {
        return { label: "Waiting for the session to acknowledge the handoff", hint: "The session has the handoff and is reading it.", tone: "progress" };
      }
      if (a.phase === "focus") return { label: "Focusing the session", hint: "The handoff was acknowledged; its tab is being brought forward.", tone: "progress" };
      return { label: "Starting the session", hint: "A fresh Claude session is starting in its own Herdr tab.", tone: "progress" };
    case "blocked":
      if (code === "AGENT_BLOCKED") {
        return { label: "Waiting on you", hint: "The session's tab shows a dialog (trust, login or a question). Focus it and answer it there.", tone: "attention" };
      }
      // Only a focus that was tried failed (the worker's focus phase). Acknowledged and then stopped
      // short of focus (Claude closed, never settled, its session moved) is told as such.
      if (a.phase === "focus") {
        return { label: "Focus failed", hint: `The session acknowledged the handoff, but its tab could not be focused. Retry only focuses it again; nothing is resent. ${message}`.trim(), tone: "attention" };
      }
      if (a.evidence.receipt_candidate) {
        return { label: "Acknowledged, then stopped", hint: `${message} The acknowledgment is kept and nothing is resent; focus the session to look at it.`.trim(), tone: "attention" };
      }
      return { label: `Blocked: ${code ?? "unknown"}`, hint: message, tone: "attention" };
    case "uncertain":
      return {
        label: "Outcome uncertain",
        hint: "A step may or may not have happened (for example the PC slept mid-launch). Retry checks what happened first and never sends the handoff twice.",
        tone: "attention",
      };
    case "failed":
      return { label: `Failed: ${code ?? "unknown"}`, hint: message, tone: "error" };
    case "succeeded":
      return { label: "Delivered", hint: `The session acknowledged the exact handoff; ${availabilityText(a.availability)}.`, tone: "done" };
  }
}

// One prior attempt on one line: when, how it ended, and whether its session is known to live.
export function attemptLine(s: InboxAttemptSummary): string {
  const end = s.status === "succeeded" ? `delivered ${when(s.delivered_at)}` : `${s.status.replace("_", " ")}${s.error_code ? ` ${s.error_code}` : ""}`;
  const seen = s.status === "succeeded" ? ` · ${availabilityText(s.availability)}` : "";
  return `${when(s.created_at)}  ${s.profile_id}  ${end}${seen}`;
}
