// Stable error codes (spec §8). Producers and the UI branch on `code`, never on `message`.
export type ErrorCode =
  | "INVALID_ITEM"
  | "INVALID_ARGUMENT"
  | "UNSUPPORTED_API_VERSION"
  | "NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "REVISION_CONFLICT"
  | "STATE_CONFLICT"
  | "ITEM_IN_HISTORY"
  | "ATTEMPT_IN_PROGRESS"
  | "ALREADY_DELIVERED"
  | "PROFILE_NOT_CONFIGURED"
  | "PROFILE_LAUNCH_UNSUPPORTED"
  | "CWD_UNAVAILABLE"
  | "HERDR_UNAVAILABLE"
  | "AGENT_UNAVAILABLE"
  | "AGENT_BLOCKED"
  | "RECEIPT_INVALID"
  | "DELIVERY_UNCERTAIN"
  | "STORE_BUSY"
  | "STORE_INCOMPATIBLE"
  | "STORE_ERROR"
  // Added to the spec's list (docs/decisions.md): the handoff file exists but is locked for now.
  | "HANDOFF_UNAVAILABLE"
  | "NOT_IMPLEMENTED"
  | "INTERNAL";

// Codes caused by bad caller input; the CLI exits 2 for these, 1 for everything else.
const USAGE_CODES = new Set<ErrorCode>(["INVALID_ITEM", "INVALID_ARGUMENT", "UNSUPPORTED_API_VERSION"]);
const RETRYABLE_CODES = new Set<ErrorCode>(["STORE_BUSY", "HERDR_UNAVAILABLE", "HANDOFF_UNAVAILABLE"]);

export class InboxError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>, retryable?: boolean) {
    super(message);
    this.name = "InboxError";
    this.code = code;
    this.details = details;
    this.retryable = retryable ?? RETRYABLE_CODES.has(code);
  }

  get isUsage(): boolean {
    return USAGE_CODES.has(this.code);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

// Maps a raw SQLite failure to an inbox error; busy/locked become the retryable STORE_BUSY.
export function fromStoreError(err: unknown): InboxError {
  if (err instanceof InboxError) return err;
  const code = (err as { code?: string })?.code ?? "";
  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) {
    return new InboxError("STORE_BUSY", "The inbox store is busy; try again.");
  }
  if (code.startsWith("SQLITE_")) {
    return new InboxError("STORE_ERROR", `Store error (${code}).`);
  }
  return new InboxError("INTERNAL", err instanceof Error ? err.message : String(err));
}
