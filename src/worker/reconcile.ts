import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { RECEIPT_PENDING_FILE } from "../bridge/hooks";
import { bridgeFiles } from "../bridge/settings";
import { type AttemptRow, Attempts } from "../core/attempts";
import { InboxError } from "../core/errors";
import type { Inbox } from "../core/inbox";

// Reconcile on read (spec §7, §13): every CLI command that reads attempts first brings unfinished
// ones up to date from what is already on disk. It never calls Herdr and never launches, sends
// or focuses anything; continuing an attempt is `retry`.
//
//   receipt-pending.json   a receipt the bridge could not store (busy store at Stop) is replayed
//                          through the same checks as a live Stop, then the file is removed
//   lapsed worker          an attempt in progress whose lease expired:
//                            focus confirmed + accepted + receipt  -> delivery is committed (the
//                                                                     worker died between the two)
//                            any external step recorded            -> uncertain, for retry
//                            nothing external yet                  -> left for `open` to restart
//
// Blocked and uncertain attempts are only given their pending receipt: their state is the user's
// to resolve, and claiming them would fence out a worker still watching a dialog.

const OWNER = "reconcile";
const LEASE_MS = 30_000;

export interface ReconcileResult {
  receipts_replayed: number;
  delivered: string[];
  marked_uncertain: string[];
}

export function reconcile(inbox: Inbox): ReconcileResult {
  const at = new Attempts(inbox);
  const result: ReconcileResult = { receipts_replayed: 0, delivered: [], marked_uncertain: [] };
  for (const view of at.unfinished()) {
    try {
      if (replayPending(inbox, at, view.id)) result.receipts_replayed++;
      const a = inbox.read(() => at.row(view.id));
      if (a.status !== "in_progress" || a.revoked_at || leaseLive(inbox, a)) continue;
      const ops = at.ops(a.id);
      if (!ops.length && a.prompt_state === "none") continue;
      const gen = at.claim(a.id, OWNER, LEASE_MS);
      if (gen === null) continue;
      try {
        const fresh = inbox.read(() => at.row(a.id));
        if (fresh.status !== "in_progress") continue;
        const focus = at.ops(a.id).find((o) => o.op === "focus");
        if (focus?.state === "confirmed" && fresh.prompt_state === "accepted" && fresh.receipt_candidate_json) {
          at.commitDelivery(a.id, gen, focus.detail_json ? JSON.parse(focus.detail_json) : {});
          result.delivered.push(a.id);
        } else if (at.markUncertain(a.id, gen, "DELIVERY_UNCERTAIN", "The worker stopped before finishing; retry to reconcile and continue.")) {
          result.marked_uncertain.push(a.id);
        }
      } finally {
        at.release(a.id, gen);
      }
    } catch (err) {
      // Reconcile never breaks a read: a busy store or a moved attempt is looked at next time.
      if (!(err instanceof InboxError)) throw err;
    }
  }
  return result;
}

function leaseLive(inbox: Inbox, a: AttemptRow): boolean {
  return !!a.lease_owner && !!a.lease_expires_at && a.lease_expires_at > inbox.now();
}

// The pending file is bridge evidence like any other: replayed through captureReceipt, which
// checks capability, session, the accepted prompt and every receipt field. Removed once the
// store has answered, whatever the answer; kept when the store is busy.
function replayPending(inbox: Inbox, at: Attempts, attemptId: string): boolean {
  const path = join(bridgeFiles(inbox.home, attemptId).dir, RECEIPT_PENDING_FILE);
  if (!existsSync(path)) return false;
  let body: { attempt_id?: unknown; session_id?: unknown; last_assistant_message?: unknown };
  try {
    body = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    rmSync(path, { force: true });
    return false;
  }
  const a = inbox.read(() => at.row(attemptId));
  if (body.attempt_id !== a.id || typeof body.session_id !== "string" || typeof body.last_assistant_message !== "string") {
    rmSync(path, { force: true });
    return false;
  }
  let ok = false;
  try {
    ok = at.captureReceipt(a.id, a.capability, body.session_id, body.last_assistant_message).ok;
  } catch (err) {
    if (err instanceof InboxError && err.code === "STORE_BUSY") return false;
  }
  rmSync(path, { force: true });
  return ok;
}
