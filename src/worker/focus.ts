import { type Availability, type AttemptView, Attempts } from "../core/attempts";
import { InboxError } from "../core/errors";
import type { Inbox } from "../core/inbox";
import { type Herdr, HerdrError } from "../herdr/adapter";

function herdrCode(err: unknown): string {
  return err instanceof HerdrError ? err.code : "error";
}

// `agent-inbox focus ITEM` (spec §8): verify the item's retained session and focus it. Never
// sends context. The session is the item's blocking attempt, else its latest delivered one.
// Each check records what it learned about that session (spec §13, the item stays in History):
//   verified under its alias           live
//   no agent has the alias any more    closed
//   the alias names another session    unknown (the conversation may live on elsewhere)
//   Herdr cannot be asked              unavailable
// Only a session verified by its own session id is ever focused; a pane id alone never is.
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
  const seen = (availability: Availability) => attempts.setAvailability(target.id, availability);
  const reference = { attempt_id: target.id, session_uuid: target.session_uuid };
  let info;
  try {
    info = await herdr.agent(alias);
  } catch (err) {
    seen("unavailable");
    throw new InboxError("HERDR_UNAVAILABLE", `Herdr could not be asked about the session: ${herdrCode(err)}.`, { ...reference, herdr_code: herdrCode(err) });
  }
  if (!info) {
    seen("closed");
    throw new InboxError("AGENT_UNAVAILABLE", "The session is no longer running in Herdr.", { ...reference, availability: "closed" });
  }
  if (info.agent_session?.value !== target.session_uuid || info.pane_id !== target.herdr.pane_id) {
    seen("unknown");
    throw new InboxError("AGENT_UNAVAILABLE", "Herdr reports a different session under this attempt's alias; not focusing it.", { ...reference, availability: "unknown" });
  }
  seen("live");
  try {
    await herdr.focus(alias);
  } catch (err) {
    throw new InboxError("HERDR_UNAVAILABLE", `Herdr could not focus the session: ${herdrCode(err)}.`, { ...reference, herdr_code: herdrCode(err) });
  }
  return { ...reference, focused: true, availability: "live" };
}
