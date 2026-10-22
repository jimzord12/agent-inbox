import { type AttemptView, Attempts } from "../core/attempts";
import { InboxError } from "../core/errors";
import type { Inbox } from "../core/inbox";
import { type Herdr, HerdrError } from "../herdr/adapter";

// `agent-inbox focus ITEM` (spec §8): verify the item's retained session and focus it. Never
// sends context. The session is the item's blocking attempt, else its latest delivered one.
export async function focusItem(inbox: Inbox, herdrFor: (socketPath: string) => Herdr, itemId: string) {
  const attempts = new Attempts(inbox);
  inbox.read(() => inbox.itemRow(itemId));
  const all = attempts.forItem(itemId);
  const target: AttemptView | undefined =
    all.find((a) => ["in_progress", "blocked", "uncertain"].includes(a.status)) ??
    all.filter((a) => a.status === "succeeded").pop();
  if (!target || !target.herdr.agent_alias || !target.herdr.session) {
    throw new InboxError("STATE_CONFLICT", "This item has no session to focus yet.", { item_id: itemId });
  }
  const alias = target.herdr.agent_alias;
  // The Herdr server the attempt launched on; never another one.
  const herdr = herdrFor(target.herdr.session);
  try {
    const info = await herdr.agent(alias);
    if (!info) throw new InboxError("AGENT_UNAVAILABLE", "The session is no longer running in Herdr.", { attempt_id: target.id });
    if (info.agent_session?.value !== target.session_uuid || info.pane_id !== target.herdr.pane_id) {
      throw new InboxError("AGENT_UNAVAILABLE", "Herdr reports a different session under this attempt's alias; not focusing it.", { attempt_id: target.id });
    }
    await herdr.focus(alias);
  } catch (err) {
    if (err instanceof HerdrError) {
      throw new InboxError("HERDR_UNAVAILABLE", `Herdr could not focus the session: ${err.code}.`, { attempt_id: target.id, herdr_code: err.code });
    }
    throw err;
  }
  return { attempt_id: target.id, session_uuid: target.session_uuid, focused: true };
}
