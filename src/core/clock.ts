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
const OFFSET_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseOffsetTime(value: string): Date | null {
  if (!OFFSET_TIME.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Opaque, time-ordered IDs, e.g. `itm_mhz3k2q1_9f2c4a7e1b3d`.
export function newId(prefix: string, clock: Clock = systemClock): string {
  return `${prefix}_${clock.now().getTime().toString(36)}_${randomBytes(6).toString("hex")}`;
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
