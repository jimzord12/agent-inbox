import { randomBytes } from "node:crypto";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

// Storage format: UTC ISO-8601 with milliseconds and `Z`. Fixed width, so string
// comparison in SQL orders correctly.
export function toStored(d: Date): string {
  return d.toISOString();
}

// The CLI only accepts offset-qualified timestamps (spec §12.1): `Z` or `±HH:MM`.
const OFFSET_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

// Rejects impossible fields (Feb 30, hour 24, offset +25:00) instead of letting Date roll them over.
export function parseOffsetTime(value: string): Date | null {
  const m = OFFSET_TIME.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi, s, oh, om] = m.slice(1).map((x) => Number(x ?? 0));
  const daysInMonth = new Date(Date.UTC(y!, mo!, 0)).getUTCDate();
  if (mo! < 1 || mo! > 12 || d! < 1 || d! > daysInMonth || h! > 23 || mi! > 59 || s! > 59 || oh! > 23 || om! > 59) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Opaque, time-ordered IDs, e.g. `itm_mhz3k2q1_9f2c4a7e1b3d`.
export function newId(prefix: string, clock: Clock = systemClock): string {
  return `${prefix}_${clock.now().getTime().toString(36)}_${randomBytes(6).toString("hex")}`;
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
