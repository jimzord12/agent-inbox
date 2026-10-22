import { readFileSync, statSync } from "node:fs";
import { win32 } from "node:path";
import { InboxError } from "./errors";

// Producer submission, API version 1 (spec §5.1).
export interface ContextRef {
  uri: string;
  label?: string;
  sha256?: string;
}

export interface LaunchSpec {
  agent: "claude-code";
  cwd: string;
  initial_instruction: string;
}

export interface Submission {
  api_version: 1;
  producer_id: string;
  external_id: string;
  kind: "informational" | "actionable";
  title: string;
  summary: string;
  profile_id: string;
  correlation_key?: string;
  handoff_path?: string;
  context_refs: ContextRef[];
  launch?: LaunchSpec;
  source_session_ref?: string;
}

export interface Limits {
  titleChars: number;
  summaryBytes: number;
  instructionBytes: number;
  handoffBytes: number;
  refs: number;
}

export const DEFAULT_LIMITS: Limits = {
  titleChars: 200,
  summaryBytes: 4 * 1024,
  instructionBytes: 16 * 1024,
  handoffBytes: 256 * 1024,
  refs: 32,
};

// The retained copy of a handoff document, read once at submit/update.
export interface CapturedHandoff {
  bytes: Uint8Array;
  sha256: string;
  source: string;
}

const TOP_KEYS = new Set([
  "api_version", "producer_id", "external_id", "kind", "title", "summary", "profile_id",
  "correlation_key", "handoff_path", "context_refs", "launch", "source_session_ref",
]);
const LAUNCH_KEYS = new Set(["agent", "cwd", "initial_instruction"]);
const REF_KEYS = new Set(["uri", "label", "sha256"]);

const PRODUCER_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PROFILE_ID = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
// C0 controls except tab/LF/CR, plus DEL. Text containing these is rejected, not cleaned.
const CONTROL_MULTILINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const CONTROL_SINGLE_LINE = /[\u0000-\u001F\u007F]/;

const utf8 = new TextEncoder();

function invalid(message: string, field: string): never {
  throw new InboxError("INVALID_ITEM", message, { field });
}

function requireString(obj: Record<string, unknown>, key: string, field = key): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) invalid(`\`${field}\` must be a non-empty string.`, field);
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string, field = key): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length === 0) invalid(`\`${field}\` must be a non-empty string when present.`, field);
  return v;
}

function checkText(value: string, field: string, opts: { multiline: boolean; maxBytes?: number; maxChars?: number }) {
  const control = opts.multiline ? CONTROL_MULTILINE : CONTROL_SINGLE_LINE;
  if (control.test(value)) invalid(`\`${field}\` contains control characters.`, field);
  if (opts.maxChars !== undefined && [...value].length > opts.maxChars) {
    invalid(`\`${field}\` is longer than ${opts.maxChars} characters.`, field);
  }
  if (opts.maxBytes !== undefined && utf8.encode(value).length > opts.maxBytes) {
    invalid(`\`${field}\` is larger than ${opts.maxBytes} bytes.`, field);
  }
}

function checkKeys(obj: Record<string, unknown>, allowed: Set<string>, where: string) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) invalid(`Unknown field \`${where}${k}\`.`, `${where}${k}`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isAbsoluteWindowsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) && win32.isAbsolute(p);
}

// Validates and normalises a raw JSON submission. Pure: touches no files.
export function parseSubmission(raw: unknown, limits: Limits = DEFAULT_LIMITS): Submission {
  if (!isObject(raw)) invalid("Submission must be a JSON object.", "");
  if (raw.api_version !== 1) {
    throw new InboxError("UNSUPPORTED_API_VERSION", "Only api_version 1 is supported.", { field: "api_version" });
  }
  checkKeys(raw, TOP_KEYS, "");

  const producer_id = requireString(raw, "producer_id");
  if (producer_id.length > 128 || !PRODUCER_ID.test(producer_id)) {
    invalid("`producer_id` must be lowercase letters/digits separated by `.`, `_` or `-` (e.g. `example.script`).", "producer_id");
  }
  const external_id = requireString(raw, "external_id");
  checkText(external_id, "external_id", { multiline: false, maxChars: 256 });

  const kind = raw.kind;
  if (kind !== "informational" && kind !== "actionable") invalid("`kind` must be `informational` or `actionable`.", "kind");

  const title = requireString(raw, "title");
  checkText(title, "title", { multiline: false, maxChars: limits.titleChars });
  const summary = requireString(raw, "summary");
  checkText(summary, "summary", { multiline: true, maxBytes: limits.summaryBytes });

  const profile_id = requireString(raw, "profile_id");
  if (profile_id.length > 64 || !PROFILE_ID.test(profile_id)) {
    invalid("`profile_id` must be lowercase letters/digits separated by `_` or `-` (e.g. `work`).", "profile_id");
  }

  const correlation_key = optionalString(raw, "correlation_key");
  if (correlation_key !== undefined) checkText(correlation_key, "correlation_key", { multiline: false, maxChars: 256 });
  const source_session_ref = optionalString(raw, "source_session_ref");
  if (source_session_ref !== undefined) checkText(source_session_ref, "source_session_ref", { multiline: false, maxChars: 512 });

  const handoff_path = optionalString(raw, "handoff_path");
  if (handoff_path !== undefined) {
    checkText(handoff_path, "handoff_path", { multiline: false, maxChars: 1024 });
    if (!isAbsoluteWindowsPath(handoff_path)) invalid("`handoff_path` must be an absolute Windows path.", "handoff_path");
  }

  let context_refs: ContextRef[] = [];
  if (raw.context_refs !== undefined) {
    if (!Array.isArray(raw.context_refs)) invalid("`context_refs` must be an array.", "context_refs");
    if (raw.context_refs.length > limits.refs) invalid(`At most ${limits.refs} context references are allowed.`, "context_refs");
    context_refs = raw.context_refs.map((r, i) => {
      const field = `context_refs[${i}]`;
      if (!isObject(r)) invalid(`\`${field}\` must be an object.`, field);
      checkKeys(r, REF_KEYS, `${field}.`);
      const uri = requireString(r, "uri", `${field}.uri`);
      checkText(uri, `${field}.uri`, { multiline: false, maxChars: 2048 });
      const ref: ContextRef = { uri };
      const label = optionalString(r, "label", `${field}.label`);
      if (label !== undefined) {
        checkText(label, `${field}.label`, { multiline: false, maxChars: 200 });
        ref.label = label;
      }
      const sha = optionalString(r, "sha256", `${field}.sha256`);
      if (sha !== undefined) {
        if (!SHA256.test(sha)) invalid(`\`${field}.sha256\` must be 64 lowercase hex characters.`, `${field}.sha256`);
        ref.sha256 = sha;
      }
      return ref;
    });
  }

  let launch: LaunchSpec | undefined;
  if (raw.launch !== undefined && raw.launch !== null) {
    if (!isObject(raw.launch)) invalid("`launch` must be an object.", "launch");
    checkKeys(raw.launch, LAUNCH_KEYS, "launch.");
    if (raw.launch.agent !== "claude-code") invalid("`launch.agent` must be `claude-code`.", "launch.agent");
    const cwd = requireString(raw.launch, "cwd", "launch.cwd");
    checkText(cwd, "launch.cwd", { multiline: false, maxChars: 1024 });
    if (!isAbsoluteWindowsPath(cwd)) invalid("`launch.cwd` must be an absolute Windows path.", "launch.cwd");
    const initial_instruction = requireString(raw.launch, "initial_instruction", "launch.initial_instruction");
    checkText(initial_instruction, "launch.initial_instruction", { multiline: true, maxBytes: limits.instructionBytes });
    launch = { agent: "claude-code", cwd, initial_instruction };
  }

  if (kind === "actionable") {
    if (!handoff_path) invalid("Actionable items need `handoff_path`.", "handoff_path");
    if (!launch) invalid("Actionable items need `launch`.", "launch");
  } else if (launch) {
    invalid("Informational items cannot have `launch`.", "launch");
  }

  const sub: Submission = { api_version: 1, producer_id, external_id, kind, title, summary, profile_id, context_refs };
  if (correlation_key !== undefined) sub.correlation_key = correlation_key;
  if (handoff_path !== undefined) sub.handoff_path = handoff_path;
  if (launch) sub.launch = launch;
  if (source_session_ref !== undefined) sub.source_session_ref = source_session_ref;
  return sub;
}

// Reads the handoff once and keeps its exact bytes. Must be valid UTF-8 without NULs.
export function captureHandoff(path: string, limits: Limits = DEFAULT_LIMITS): CapturedHandoff {
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) invalid("`handoff_path` is not a file.", "handoff_path");
    size = st.size;
  } catch (err) {
    if (err instanceof InboxError) throw err;
    invalid(`Cannot read \`handoff_path\`: ${(err as NodeJS.ErrnoException).code ?? "error"}.`, "handoff_path");
  }
  if (size > limits.handoffBytes) invalid(`The handoff is larger than ${limits.handoffBytes} bytes.`, "handoff_path");
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length > limits.handoffBytes) invalid(`The handoff is larger than ${limits.handoffBytes} bytes.`, "handoff_path");
  if (bytes.length === 0) invalid("The handoff is empty.", "handoff_path");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("The handoff is not valid UTF-8.", "handoff_path");
  }
  if (text.includes("\u0000")) invalid("The handoff contains NUL characters.", "handoff_path");
  return { bytes, sha256: sha256Hex(bytes), source: path };
}

export function sha256Hex(data: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

// Canonical JSON: sorted keys, no whitespace. Equal content gives equal bytes.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Content identity of a revision: the normalised payload plus the retained handoff bytes.
// The handoff *path* is left out, so a retry that wrote the same bytes to a fresh
// revision-specific path still deduplicates.
export function contentHash(sub: Submission, handoff: CapturedHandoff | null): string {
  const { handoff_path: _path, ...payload } = sub;
  return sha256Hex(canonicalJson({ payload, handoff_sha256: handoff?.sha256 ?? null }));
}
