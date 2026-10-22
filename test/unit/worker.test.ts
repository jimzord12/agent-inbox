import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bridgeFiles } from "../../src/bridge/settings";
import { type AttemptRow, Attempts } from "../../src/core/attempts";
import { type InboxConfig } from "../../src/core/config";
import { InboxError } from "../../src/core/errors";
import { Inbox } from "../../src/core/inbox";
import { READY_MARKER } from "../../src/core/packet";
import { profilesPath } from "../../src/core/profiles";
import { sha256Hex } from "../../src/core/submission";
import { RECEIPT_PENDING_FILE } from "../../src/bridge/hooks";
import { focusItem } from "../../src/worker/focus";
import { reconcile } from "../../src/worker/reconcile";
import { STATE_FILE, Worker, agentAlias, needsWorker, tabLabel } from "../../src/worker/worker";
import { FakeHerdr, type FakeHooks, SOCKET } from "./fixtures/fake-herdr";
import { expectCode, type Fixture, fixture } from "../helpers";

let f: Fixture;
let at: Attempts;
let workDir: string;
const config: InboxConfig = { herdr: { socket_path: SOCKET, workspace_label: "Agent Inbox" } };
const timing = { pollMs: 1, bindTimeoutMs: 150, receiptTimeoutMs: 150, blockedWatchMs: 300 };

beforeEach(() => {
  f = fixture();
  workDir = join(f.dir, "claude-work");
  mkdirSync(workDir);
  writeFileSync(profilesPath(f.home), JSON.stringify({ profiles: { work: { label: "Work", agent: "claude-code", claude_config_dir: workDir } } }));
  at = new Attempts(f.inbox);
});
afterEach(() => f.cleanup());

function openAttempt(overrides: Record<string, unknown> = {}) {
  const { item } = f.inbox.submit(f.actionable(overrides));
  return at.open(item.id, 1).attempt;
}

// The receipt bridge as the real hooks play it inside Claude: SessionStart binds, the opening
// prompt is accepted, and the opening turn ends with a valid marker.
function marker(row: AttemptRow) {
  const body = { attempt_id: row.id, item_id: row.item_id, content_revision: row.content_revision, packet_sha256: row.packet_sha256, challenge: row.challenge };
  return `I have the packet: seven records were rejected. I will wait for you.\n\n${READY_MARKER} ${JSON.stringify(body)}`;
}

function bridge(o: { bind?: "ok" | "wrong-dir" | "none"; accept?: boolean; receipt?: boolean; settle?: boolean } = {}): FakeHooks {
  const { bind = "ok", accept = true, receipt = true, settle = true } = o;
  return {
    onStart: (agent) => {
      if (bind === "none") return;
      const row = at.row(currentId);
      at.bind(row.id, row.capability, { session_id: agent.session!, cwd: row.cwd, claude_config_dir: bind === "ok" ? workDir : "C:\\other", auth_env: [] });
    },
    onPrompt: (agent, text) => {
      const row = at.row(currentId);
      if (!accept) return;
      at.acceptPrompt(row.id, row.capability, agent.session!, row.cwd, text);
      if (receipt) at.captureReceipt(row.id, row.capability, agent.session!, marker(row));
      if (settle) {
        agent.agent_status = "idle";
        agent.state_change_seq += 2;
      } else {
        agent.agent_status = "working";
      }
    },
  };
}

let currentId = "";

async function runWorker(fake: FakeHerdr, attemptId: string, retry = false) {
  currentId = attemptId;
  return new Worker(attemptId, { inbox: f.inbox, herdr: fake.herdr(), config, owner: "w-test", timing, retry }).run();
}

describe("worker: the happy path", () => {
  test("walks every phase, then delivers only after receipt, a new settled state and focus", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge());
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "succeeded", phase: "focus", evidence: { bound: true, prompt_state: "accepted", receipt_candidate: true, delivered: true, focused: true } });
    expect(Object.fromEntries(view!.ops.map((o) => [o.op, o.state]))).toEqual({
      create_tab: "confirmed",
      start_agent: "confirmed",
      dispatch_prompt: "confirmed",
      focus: "confirmed",
    });
    expect(fake.verbs()).toEqual(["workspace create", "tab create", "agent start", "agent get", "agent prompt", "agent get", "agent focus"]);
    expect(f.inbox.get(attempt.item_id)).toMatchObject({ placement: "history", archive_reason: "delivered" });
  });

  test("launch: CLAUDE_CONFIG_DIR on the tab, --session-id and --settings, a unique alias", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge());
    await runWorker(fake, attempt.id);
    const row = at.row(attempt.id);
    expect(fake.tabs[0]!.env).toEqual({ CLAUDE_CONFIG_DIR: workDir });
    expect(fake.tabs[0]!.cwd).toBe(row.cwd);
    const start = fake.calls.find((c) => c[2] === "start")!;
    expect(start.slice(start.indexOf("--") + 1)).toEqual(["--session-id", row.session_uuid, "--settings", bridgeFiles(f.home, row.id).settingsPath]);
    expect(start[3]).toBe(agentAlias(row.id));
    expect(agentAlias(row.id)).toMatch(/^inbox-[0-9a-f]{12}$/);
    expect(row.agent_alias).toBe(agentAlias(row.id));
    expect(agentAlias("att_x_aaaaaaaaaaaa")).not.toBe(agentAlias("att_x_bbbbbbbbbbbb"));
  });

  test("the packet file holds the stored bytes, and the opening prompt names only path, hash and attempt", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge());
    await runWorker(fake, attempt.id);
    const row = at.row(attempt.id);
    expect(sha256Hex(new Uint8Array(readFileSync(row.packet_path!)))).toBe(row.packet_sha256);
    const prompt = fake.calls.find((c) => c[2] === "prompt")![4]!;
    expect(prompt).toContain(row.packet_path!);
    expect(prompt).not.toContain(row.challenge);
    expect(prompt).not.toContain("Seven records");
  });

  test("the inbox workspace is created once and reused by id while its label holds", async () => {
    const fake = new FakeHerdr(bridge());
    await runWorker(fake, openAttempt({ external_id: "a" }).id);
    const state = JSON.parse(readFileSync(join(f.home, STATE_FILE), "utf8"));
    expect(state).toEqual({ socket_path: SOCKET, workspace_id: "w1" });
    await runWorker(fake, openAttempt({ external_id: "b" }).id);
    expect(fake.verbs().filter((v) => v.startsWith("workspace"))).toEqual(["workspace create", "workspace get"]);
    expect(fake.tabs.map((t) => t.workspace_id)).toEqual(["w1", "w1"]);
  });

  test("tab labels are for people: profile, short clean title, short attempt id", () => {
    expect(tabLabel("work", "Review\u001b[31m the prepared findings for the nightly run", "att_1_abcdef123456")).toBe("work Review [31m the prepare… 123456");
  });
});

describe("worker: preflight ends the attempt before any context is sent", () => {
  test("a missing cwd fails with CWD_UNAVAILABLE and never calls Herdr", async () => {
    const attempt = openAttempt({ launch: { agent: "claude-code", cwd: join(f.dir, "gone"), initial_instruction: "x" } });
    const fake = new FakeHerdr(bridge());
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "failed", phase: "preflight", error: { code: "CWD_UNAVAILABLE" } });
    expect(fake.calls).toHaveLength(0);
    expect(f.inbox.get(attempt.item_id).placement).toBe("active");
  });

  test("a profile removed since open fails with PROFILE_NOT_CONFIGURED", async () => {
    const attempt = openAttempt();
    writeFileSync(profilesPath(f.home), JSON.stringify({ profiles: { personal: { label: "P", agent: "claude-code", claude_config_dir: workDir } } }));
    const fake = new FakeHerdr(bridge());
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "failed", error: { code: "PROFILE_NOT_CONFIGURED" } });
    expect(fake.calls).toHaveLength(0);
  });

  test("a profile pointing elsewhere since open is refused; a missing config folder too", async () => {
    const a1 = openAttempt({ external_id: "a" });
    const other = join(f.dir, "other");
    mkdirSync(other);
    writeFileSync(profilesPath(f.home), JSON.stringify({ profiles: { work: { label: "W", agent: "claude-code", claude_config_dir: other } } }));
    expect(await runWorker(new FakeHerdr(), a1.id)).toMatchObject({ status: "failed", error: { code: "PROFILE_NOT_CONFIGURED" } });
    const a2 = openAttempt({ external_id: "b" });
    rmSync(other, { recursive: true });
    expect(await runWorker(new FakeHerdr(), a2.id)).toMatchObject({ status: "failed", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" } });
  });

  test("Herdr not running fails with HERDR_UNAVAILABLE; nothing is created or sent", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb.startsWith("workspace") ? { error: "server_not_running" } : undefined) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "failed", phase: "create_layout", error: { code: "HERDR_UNAVAILABLE" } });
    expect(fake.tabs).toHaveLength(0);
    expect(at.row(attempt.id).prompt_state).toBe("none");
  });
});

describe("worker: unclear outcomes are never repeated", () => {
  test("a lost tab-create answer leaves the attempt uncertain and starts nothing", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "tab create" ? { timeout: true } : undefined) });
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "uncertain", error: { code: "DELIVERY_UNCERTAIN" } });
    expect(view!.ops).toMatchObject([{ op: "create_tab", state: "uncertain" }]);
    expect(fake.verbs()).not.toContain("agent start");
  });

  test("a lost prompt answer is settled by the bridge's acceptance; the prompt is sent once", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onPrompt: (a, t) => (hooks.onPrompt!(a, t), { timeout: true }) });
    const view = await runWorker(fake, attempt.id);
    expect(view!.status).toBe("succeeded");
    expect(view!.ops.find((o) => o.op === "dispatch_prompt")!.state).toBe("confirmed");
    expect(fake.verbs().filter((v) => v === "agent prompt")).toHaveLength(1);
  });

  test("a lost prompt answer with no acceptance becomes uncertain, never resent and never blocked", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge({ accept: false }), onPrompt: () => ({ timeout: true }) });
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "uncertain", phase: "await_receipt", error: { code: "DELIVERY_UNCERTAIN" }, evidence: { prompt_state: "uncertain" } });
    expect(fake.verbs().filter((v) => v === "agent prompt")).toHaveLength(1);
    expect(fake.focused).toHaveLength(0);
  });

  test("a prompt sent but never accepted leaves the attempt uncertain, so a late prompt is not erased", async () => {
    const attempt = openAttempt();
    const view = await runWorker(new FakeHerdr(bridge({ accept: false })), attempt.id);
    expect(view).toMatchObject({ status: "uncertain", error: { code: "DELIVERY_UNCERTAIN" } });
  });

  test("a second worker cannot take an attempt whose lease is held", async () => {
    const attempt = openAttempt();
    at.claim(attempt.id, "someone-else", 60_000);
    const fake = new FakeHerdr(bridge());
    expect(await runWorker(fake, attempt.id)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  test("an abandon while the worker waits stops it without further side effects", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge({ receipt: false }), onGet: () => at.abandon(attempt.id) });
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "failed", revoked: true, error: { code: "ABANDONED" } });
    expect(fake.verbs()).not.toContain("agent prompt");
    expect(fake.focused).toHaveLength(0);
  });
});

describe("worker: identity and delivery evidence", () => {
  test("no delivery without a receipt: the attempt blocks, the item stays Active, nothing is focused", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge({ receipt: false }));
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "blocked", phase: "await_receipt", error: { code: "RECEIPT_INVALID" }, evidence: { prompt_state: "accepted", receipt_candidate: false } });
    expect(fake.focused).toHaveLength(0);
    expect(f.inbox.get(attempt.item_id).placement).toBe("active");
  });

  test("no delivery before a new settled state: the startup idle does not count", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge({ settle: false }));
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "blocked", error: { code: "RECEIPT_INVALID" }, evidence: { receipt_candidate: true, delivered: false } });
    expect(fake.focused).toHaveLength(0);
  });

  test("Herdr reporting another session under the alias blocks before any context is sent", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onStart: (a, args) => (hooks.onStart!(a, args), void (a.session = "00000000-0000-4000-8000-000000000000")) });
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "blocked", phase: "start_agent", error: { code: "AGENT_UNAVAILABLE" } });
    expect(fake.verbs()).not.toContain("agent prompt");
  });

  test("a session that loaded the wrong profile is blocked by the bridge; the worker stops", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge({ bind: "wrong-dir" }));
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "blocked", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" } });
    expect(fake.verbs()).not.toContain("agent prompt");
  });

  test("no startup report from the bridge blocks before dispatch", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge({ bind: "none" }));
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", phase: "start_agent", error: { code: "RECEIPT_INVALID" } });
    expect(fake.verbs()).not.toContain("agent prompt");
  });

  test("a startup held by a dialog blocks and focuses the pane, then continues the same attempt once answered", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    let gets = 0;
    const fake = new FakeHerdr({
      ...hooks,
      onStart: (a) => {
        a.agent_status = "blocked";
        a.interactive_ready = false;
        return { error: "agent_not_ready" };
      },
      onGet: (a) => {
        // The user answers the trust dialog on the third look; SessionStart then runs.
        if (++gets === 3) {
          a.agent_status = "idle";
          a.interactive_ready = true;
          hooks.onStart!(a, []);
        }
      },
    });
    const view = await runWorker(fake, attempt.id);
    expect(fake.focused[0]).toBe(agentAlias(attempt.id));
    expect(view).toMatchObject({ status: "succeeded" });
    expect(view!.ops.find((o) => o.op === "start_agent")!.state).toBe("confirmed");
    const log = readFileSync(join(bridgeFiles(f.home, attempt.id).dir, "worker.log"), "utf8");
    expect(log).toContain("block AGENT_BLOCKED");
    expect(log).toContain("dialog cleared");
  });

  test("a dialog nobody answers leaves the attempt blocked with AGENT_BLOCKED", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), onStart: (a) => ((a.agent_status = "blocked"), { error: "agent_not_ready" }) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", error: { code: "AGENT_BLOCKED" } });
    expect(fake.verbs()).not.toContain("agent prompt");
  });

  test("a failed focus keeps the receipt and blocks; delivery is never committed without it", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "agent focus" ? { error: "agent_not_found" } : undefined) });
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "blocked", phase: "focus", evidence: { receipt_candidate: true, delivered: false } });
    expect(f.inbox.get(attempt.item_id).placement).toBe("active");
  });

  test("the worker log names phases and codes, never the capability or challenge", async () => {
    const attempt = openAttempt();
    await runWorker(new FakeHerdr(bridge()), attempt.id);
    const row = at.row(attempt.id);
    const log = readFileSync(join(bridgeFiles(f.home, row.id).dir, "worker.log"), "utf8");
    expect(log).toContain("claimed generation");
    expect(log).toContain("delivered");
    expect(log).not.toContain(row.capability);
    expect(log).not.toContain(row.challenge);
  });
});

describe("focus", () => {
  test("verifies the retained session and focuses it, never prompting", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge());
    await runWorker(fake, attempt.id);
    const before = fake.calls.length;
    const r = await focusItem(f.inbox, () => fake.herdr(), attempt.item_id);
    expect(r).toMatchObject({ attempt_id: attempt.id, focused: true });
    expect(fake.verbs().slice(before)).toEqual(["agent get", "agent focus"]);
  });

  test("refuses when Herdr reports another session, or none, under the alias", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge());
    await runWorker(fake, attempt.id);
    fake.agents.get(agentAlias(attempt.id))!.session = "00000000-0000-4000-8000-000000000000";
    const focusedBefore = fake.focused.length;
    await expect(focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
    fake.agents.clear();
    await expect(focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
    expect(fake.focused.length).toBe(focusedBefore);
  });

  test("an item without a launched session has nothing to focus", async () => {
    const attempt = openAttempt();
    await expect(focusItem(f.inbox, () => new FakeHerdr().herdr(), attempt.item_id)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    expectCode(() => f.inbox.get("itm_nope"), "NOT_FOUND");
    expect(existsSync(f.home)).toBe(true);
  });
});

describe("review round 1: each guard has a test that fails without it", () => {
  test("a dialog wait never lifts a block the bridge set: its code and reason stay", async () => {
    const attempt = openAttempt();
    const hooks = bridge({ bind: "wrong-dir" });
    let gets = 0;
    const fake = new FakeHerdr({
      ...hooks,
      onStart: (a) => ((a.agent_status = "blocked"), (a.interactive_ready = false), { error: "agent_not_ready" }),
      onGet: (a) => {
        if (++gets === 2) {
          a.agent_status = "idle";
          a.interactive_ready = true;
          hooks.onStart!(a, []);
        }
      },
    });
    const view = await runWorker(fake, attempt.id);
    expect(view).toMatchObject({ status: "blocked", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" } });
    expect(view!.evidence.last_rejection).toMatchObject({ stage: "bind" });
    expect(fake.verbs()).not.toContain("agent prompt");
  });

  test("an abandon during the dialog wait stops the worker", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({
      ...bridge(),
      onStart: (a) => ((a.agent_status = "blocked"), { error: "agent_not_ready" }),
      onGet: () => at.abandon(attempt.id),
    });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "failed", error: { code: "ABANDONED" } });
    expect(fake.verbs()).not.toContain("agent prompt");
  });

  test("settled means a new state: an idle agent whose state did not move is not settled", async () => {
    const attempt = openAttempt();
    const hooks = bridge({ settle: false });
    const fake = new FakeHerdr({ ...hooks, onPrompt: (a, t) => void (hooks.onPrompt!(a, t), (a.agent_status = "idle")) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", evidence: { receipt_candidate: true, delivered: false } });
    expect(fake.focused).toHaveLength(0);
  });

  test("settled means idle or done: a moved state while still working is not settled", async () => {
    const attempt = openAttempt();
    const hooks = bridge({ settle: false });
    const fake = new FakeHerdr({ ...hooks, onPrompt: (a, t) => void (hooks.onPrompt!(a, t), (a.state_change_seq += 5)) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", evidence: { delivered: false } });
    expect(fake.focused).toHaveLength(0);
  });

  test("the alias in another pane blocks before dispatch", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onStart: (a, args) => void (hooks.onStart!(a, args), (a.pane_id = "w9:p9")) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", phase: "start_agent", error: { code: "AGENT_UNAVAILABLE" } });
    expect(fake.verbs()).not.toContain("agent prompt");
  });

  test("a different session or pane after the receipt blocks without focus", async () => {
    for (const change of ["session", "pane"] as const) {
      const attempt = openAttempt({ external_id: change });
      const hooks = bridge();
      const fake = new FakeHerdr({
        ...hooks,
        onPrompt: (a, t) => {
          hooks.onPrompt!(a, t);
          if (change === "session") a.session = "00000000-0000-4000-8000-000000000000";
          else a.pane_id = "w9:p9";
        },
      });
      expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", phase: "await_receipt", error: { code: "AGENT_UNAVAILABLE" } });
      expect(fake.focused).toHaveLength(0);
    }
  });

  test("the alias gone after the receipt blocks without focus; the receipt is kept", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onPrompt: (a, t) => void (hooks.onPrompt!(a, t), fake.agents.delete(a.name)) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", error: { code: "AGENT_UNAVAILABLE" }, evidence: { receipt_candidate: true } });
    expect(fake.focused).toHaveLength(0);
  });

  test("a session id briefly missing after the receipt is looked at again, not blocked", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    let hidden = 0;
    const fake = new FakeHerdr({ ...hooks });
    fake.hooks.onPrompt = (a, t) => {
      hooks.onPrompt!(a, t);
      const session = a.session;
      a.session = null;
      fake.hooks.onGet = (g) => {
        if (++hidden === 2) g.session = session;
      };
    };
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "succeeded" });
  });

  test("focus refuses the alias in another pane", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge());
    await runWorker(fake, attempt.id);
    fake.agents.get(agentAlias(attempt.id))!.pane_id = "w9:p9";
    const before = fake.focused.length;
    await expect(focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
    expect(fake.focused.length).toBe(before);
  });

  test("an unexpected error keeps a block the bridge already set", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({
      ...bridge(),
      // The bridge blocks the attempt while Herdr's answer to the focus is on its way, then the
      // worker's own write fails because it no longer may deliver.
      before: (verb) => {
        if (verb === "agent focus") {
          const row = at.row(attempt.id);
          at.bind(row.id, row.capability, { session_id: "00000000-0000-4000-8000-000000000000", cwd: row.cwd, claude_config_dir: workDir, auth_env: [] });
        }
      },
    });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", error: { code: "RECEIPT_INVALID" } });
  });

  test("an unexpected error before any external step fails honestly instead of uncertain", async () => {
    const attempt = openAttempt();
    // The packet path is a directory, so writing the packet throws inside preflight.
    mkdirSync(join(bridgeFiles(f.home, attempt.id).dir, "packet.md"), { recursive: true });
    expect(await runWorker(new FakeHerdr(), attempt.id)).toMatchObject({ status: "failed", error: { code: "INTERNAL" } });
  });

  test("needsWorker: only an unowned in-progress attempt with nothing external recorded", () => {
    const attempt = openAttempt();
    expect(needsWorker(f.inbox, attempt.id)).toBe(true);
    const gen = at.claim(attempt.id, "w", 60_000)!;
    expect(needsWorker(f.inbox, attempt.id)).toBe(false);
    at.release(attempt.id, gen);
    expect(needsWorker(f.inbox, attempt.id)).toBe(true);
    const g2 = at.claim(attempt.id, "w", 60_000)!;
    at.beginOp(attempt.id, g2, "create_tab");
    at.release(attempt.id, g2);
    expect(needsWorker(f.inbox, attempt.id)).toBe(false);
  });

  test("tab labels never split a character", () => {
    const label = tabLabel("work", `${"x".repeat(22)}😀😀😀`, "att_1_abcdef123456");
    expect(label).toBe(`work ${"x".repeat(22)}😀… 123456`);
  });
});

describe("review round 2", () => {
  test("a session id Herdr never reports after the receipt ends blocked at the deadline, without focus", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onPrompt: (a, t) => void (hooks.onPrompt!(a, t), (a.session = null)) });
    const started = Date.now();
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", phase: "await_receipt", error: { code: "RECEIPT_INVALID" }, evidence: { delivered: false } });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(fake.focused).toHaveLength(0);
  });

  test("the alias gone before dispatch blocks with AGENT_UNAVAILABLE at once", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onStart: (a, args) => void (hooks.onStart!(a, args), queueMicrotask(() => fake.agents.delete(a.name))) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", phase: "start_agent", error: { code: "AGENT_UNAVAILABLE" } });
    expect(fake.verbs()).not.toContain("agent prompt");
  });

  test("a worker that claims an attempt another worker already blocked leaves it untouched", async () => {
    const attempt = openAttempt();
    const gen = at.claim(attempt.id, "first", 60_000)!;
    at.block(attempt.id, gen, "AGENT_BLOCKED", "dialog");
    at.release(attempt.id, gen);
    const fake = new FakeHerdr(bridge());
    expect(await runWorker(fake, attempt.id)).toBeNull();
    expect(at.get(attempt.id)).toMatchObject({ status: "blocked", error: { code: "AGENT_BLOCKED" } });
    expect(at.row(attempt.id).lease_owner).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
});

describe("retry (INB-008): observe first, repeat only what provably did not happen", () => {
  const count = (fake: FakeHerdr, verb: string) => fake.verbs().filter((v) => v === verb).length;

  test("a receipt with a failed focus: retry only reads, refocuses and commits", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "agent focus" ? { error: "agent_not_found" } : undefined) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", phase: "focus" });
    fake.hooks.before = undefined;
    const before = fake.calls.length;
    const view = await runWorker(fake, attempt.id, true);
    expect(view).toMatchObject({ status: "succeeded", evidence: { delivered: true } });
    expect(new Set(fake.verbs().slice(before))).toEqual(new Set(["agent get", "agent focus"]));
    expect(count(fake, "agent prompt")).toBe(1);
    expect(count(fake, "agent start")).toBe(1);
  });

  test("after a recorded dispatch the prompt is never sent again; a late acceptance and receipt deliver", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    let held: [import("./fixtures/fake-herdr").FakeAgent, string] | null = null;
    // The prompt lands, but the answer is lost and the bridge has not reported yet.
    const fake = new FakeHerdr({ ...hooks, onPrompt: (a, t) => ((held = [a, t]), { timeout: true }) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "uncertain", evidence: { prompt_state: "uncertain" } });
    hooks.onPrompt!(...held!);
    const view = await runWorker(fake, attempt.id, true);
    expect(view).toMatchObject({ status: "succeeded" });
    expect(count(fake, "agent prompt")).toBe(1);
  });

  test("after a recorded dispatch with still no acceptance, retry stays uncertain and sends nothing", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge({ accept: false }), onPrompt: () => ({ timeout: true }) });
    await runWorker(fake, attempt.id);
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "uncertain", error: { code: "DELIVERY_UNCERTAIN" } });
    expect(count(fake, "agent prompt")).toBe(1);
  });

  test("a prompt Herdr definitively refused is sent again by retry, once", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    let refuse = true;
    const fake = new FakeHerdr({ ...hooks, onPrompt: (a, t) => (refuse ? { error: "agent_blocked" } : hooks.onPrompt!(a, t)) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", error: { code: "AGENT_BLOCKED" }, evidence: { prompt_state: "rejected" } });
    refuse = false;
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "succeeded" });
    expect(count(fake, "agent prompt")).toBe(2);
  });

  test("a tab creation with no recorded result stays uncertain; no second tab", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "tab create" ? { timeout: true } : undefined) });
    await runWorker(fake, attempt.id);
    fake.hooks.before = undefined;
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "uncertain", error: { code: "DELIVERY_UNCERTAIN" } });
    expect(count(fake, "tab create")).toBe(1);
  });

  test("a lost start answer continues only when Herdr shows the attempt's own session; Claude is never started twice", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onStart: (a, args) => (hooks.onStart!(a, args), { timeout: true }) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "uncertain", phase: "start_agent" });
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "succeeded" });
    expect(count(fake, "agent start")).toBe(1);
  });

  test("a lost start answer with no session in Herdr stays uncertain", async () => {
    const attempt = openAttempt();
    const fake: FakeHerdr = new FakeHerdr({ ...bridge(), onStart: (a): { timeout: true } => (fake.agents.delete(a.name), { timeout: true }) });
    await runWorker(fake, attempt.id);
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "uncertain", error: { code: "AGENT_UNAVAILABLE" } });
    expect(count(fake, "agent start")).toBe(1);
  });

  test("a retry worker settles against the baseline recorded with the dispatch", async () => {
    const attempt = openAttempt();
    // Receipt arrives, but Herdr never shows a new settled state: blocked.
    const fake = new FakeHerdr(bridge({ settle: false }));
    await runWorker(fake, attempt.id);
    const agent = fake.agents.get(agentAlias(attempt.id))!;
    // The session settles later. Its state counter is above the recorded baseline, though the
    // retry worker's own first read already sees that value.
    agent.agent_status = "idle";
    agent.state_change_seq += 1;
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "succeeded" });
  });

  test("the settle timeout says when Herdr does not report the session id", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onPrompt: (a, t) => void (hooks.onPrompt!(a, t), (a.session = null)) });
    const view = await runWorker(fake, attempt.id);
    expect(view!.error!.message).toContain("does not report its session id");
  });

  test("without retry, a worker never lifts a block", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "agent focus" ? { error: "agent_not_found" } : undefined) });
    await runWorker(fake, attempt.id);
    fake.hooks.before = undefined;
    expect(await runWorker(fake, attempt.id)).toBeNull();
    expect(at.get(attempt.id).status).toBe("blocked");
  });
});

describe("INB-008 review round 1", () => {
  const count = (fake: FakeHerdr, verb: string) => fake.verbs().filter((v) => v === verb).length;

  test("retry never lifts a wrong-profile refusal, before or after binding; its reason stays", async () => {
    const a1 = openAttempt({ external_id: "first-start" });
    const fake = new FakeHerdr(bridge({ bind: "wrong-dir" }));
    await runWorker(fake, a1.id);
    expect(await runWorker(fake, a1.id, true)).toBeNull();
    expect(at.get(a1.id)).toMatchObject({ status: "blocked", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" }, evidence: { last_rejection: { stage: "bind" } } });
    // Bound correctly first, then a SessionStart reports the wrong profile (e.g. a resumed session).
    const a2 = openAttempt({ external_id: "after-bind" });
    const hooks = bridge({ receipt: false });
    const fake2 = new FakeHerdr({
      ...hooks,
      onPrompt: (a, t) => {
        hooks.onPrompt!(a, t);
        const row = at.row(a2.id);
        at.bind(row.id, row.capability, { session_id: a.session!, cwd: row.cwd, claude_config_dir: "C:\other", auth_env: [] });
        at.captureReceipt(row.id, row.capability, a.session!, marker(row));
      },
    });
    await runWorker(fake2, a2.id);
    expect(at.get(a2.id)).toMatchObject({ status: "blocked", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" } });
    expect(await runWorker(fake2, a2.id, true)).toBeNull();
    expect(at.get(a2.id).evidence.delivered).toBe(false);
  });

  test("a replaced-session block, then a late valid receipt from the original session: retry delivers with one prompt", async () => {
    const attempt = openAttempt();
    const hooks = bridge({ receipt: false });
    const fake = new FakeHerdr({
      ...hooks,
      onPrompt: (a, t) => {
        hooks.onPrompt!(a, t);
        // A /clear in that pane reports a new session to the bridge.
        const row = at.row(attempt.id);
        at.bind(row.id, row.capability, { session_id: "00000000-0000-4000-8000-000000000000", cwd: row.cwd, claude_config_dir: workDir, auth_env: [] });
      },
    });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", error: { code: "RECEIPT_INVALID" } });
    const row = at.row(attempt.id);
    expect(at.captureReceipt(row.id, row.capability, row.session_uuid, marker(row))).toEqual({ ok: true });
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "succeeded" });
    expect(count(fake, "agent prompt")).toBe(1);
  });

  test("a focus whose answer was lost is done again by retry", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "agent focus" ? { timeout: true } : undefined) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", phase: "focus" });
    expect(at.get(attempt.id).ops.find((o) => o.op === "focus")!.state).toBe("uncertain");
    fake.hooks.before = undefined;
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "succeeded" });
  });

  test("a lost start answer with another session in the pane stays uncertain and sends nothing", async () => {
    const attempt = openAttempt();
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onStart: (a, args) => (hooks.onStart!(a, args), (a.session = "00000000-0000-4000-8000-000000000000"), { timeout: true }) });
    await runWorker(fake, attempt.id);
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "uncertain", error: { code: "AGENT_UNAVAILABLE" } });
    expect(count(fake, "agent prompt")).toBe(0);
  });

  test("a retry past layout skips preflight: a cwd gone since the launch does not fail a live session", async () => {
    const proj = join(f.dir, "proj");
    mkdirSync(proj);
    const attempt = openAttempt({ launch: { agent: "claude-code", cwd: proj, initial_instruction: "x" } });
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "agent focus" ? { error: "agent_not_found" } : undefined) });
    await runWorker(fake, attempt.id);
    rmSync(proj, { recursive: true });
    fake.hooks.before = undefined;
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "succeeded" });
  });

  test("acceptance confirms a dispatch left started by a crash", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "agent focus" ? { error: "agent_not_found" } : undefined) });
    await runWorker(fake, attempt.id);
    // As if the worker had died after the prompt was sent and before it recorded the answer.
    f.inbox.db.run("UPDATE attempt_ops SET state = 'started', finished_at = NULL WHERE attempt_id = ? AND op = 'dispatch_prompt'", [attempt.id]);
    fake.hooks.before = undefined;
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "succeeded" });
    expect(at.get(attempt.id).ops.find((o) => o.op === "dispatch_prompt")!.state).toBe("confirmed");
    expect(count(fake, "agent prompt")).toBe(1);
  });
});

describe("INB-008 review round 2", () => {
  test("a wrong-profile verdict recorded during a dialog start is kept; the worker does not overwrite it", async () => {
    const attempt = openAttempt();
    const hooks = bridge({ bind: "wrong-dir" });
    const fake = new FakeHerdr({ ...hooks, onStart: (a, args) => (hooks.onStart!(a, args), { error: "agent_not_ready" }) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" } });
  });

  test("a later refused startup never replaces a wrong-profile verdict", () => {
    const attempt = openAttempt();
    const g = at.claim(attempt.id, "w", 60_000)!;
    at.setPacketPath(attempt.id, g, join(f.dir, "p.md"));
    const row = at.row(attempt.id);
    at.bind(row.id, row.capability, { session_id: row.session_uuid, cwd: row.cwd, claude_config_dir: "C:\other", auth_env: [] });
    at.bind(row.id, row.capability, { session_id: "00000000-0000-4000-8000-000000000000", cwd: row.cwd, claude_config_dir: workDir, auth_env: [] });
    expect(at.get(row.id)).toMatchObject({ status: "blocked", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" } });
    expect(at.block(row.id, g, "AGENT_UNAVAILABLE", "x")).toBe(false);
    expect(at.markUncertain(row.id, g, "DELIVERY_UNCERTAIN", "x")).toBe(false);
    expect(at.get(row.id).error!.code).toBe("PROFILE_LAUNCH_UNSUPPORTED");
  });

  test("a retry lifts only the block it read: a verdict landing before the resume is kept", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), before: (verb) => (verb === "agent focus" ? { error: "agent_not_found" } : undefined) });
    await runWorker(fake, attempt.id);
    fake.hooks.before = undefined;
    const original = Attempts.prototype.resume;
    const spy = spyOn(Attempts.prototype, "resume").mockImplementationOnce(function (this: Attempts, ...args: Parameters<Attempts["resume"]>) {
      // The bridge blocks the attempt for the wrong profile between the worker's read and its resume.
      f.inbox.db.run("UPDATE attempts SET error_code = 'PROFILE_LAUNCH_UNSUPPORTED' WHERE id = ?", [attempt.id]);
      return original.apply(this, args);
    });
    try {
      expect(await runWorker(fake, attempt.id, true)).toBeNull();
    } finally {
      spy.mockRestore();
    }
    expect(at.get(attempt.id)).toMatchObject({ status: "blocked", error: { code: "PROFILE_LAUNCH_UNSUPPORTED" } });
    expect(fake.focused).toHaveLength(0);
  });

  test("the settle message follows the last read: a session id seen earlier, then lost", async () => {
    const attempt = openAttempt();
    const hooks = bridge({ settle: false });
    let reads = 0;
    const fake = new FakeHerdr({
      ...hooks,
      onGet: (a) => {
        if (at.row(attempt.id).receipt_candidate_json && ++reads === 2) a.session = null;
      },
    });
    const view = await runWorker(fake, attempt.id);
    expect(view!.error!.message).toContain("does not report its session id");
  });
});

describe("reconcile (INB-009)", () => {
  const count = (fake: FakeHerdr, verb: string) => fake.verbs().filter((v) => v === verb).length;
  const pendingPath = (id: string) => join(bridgeFiles(f.home, id).dir, RECEIPT_PENDING_FILE);

  test("an expired lease lets another owner in and fences the old worker out of every write", async () => {
    const attempt = openAttempt();
    let taken = false;
    const fake = new FakeHerdr({
      ...bridge({ settle: false }),
      onGet: () => {
        if (taken || !at.row(attempt.id).receipt_candidate_json) return;
        // The worker stalls (e.g. the machine slept); its lease lapses and someone else claims.
        f.clock.advance(5_000);
        expect(at.claim(attempt.id, "other", 60_000)).not.toBeNull();
        taken = true;
      },
    });
    currentId = attempt.id;
    const view = await new Worker(attempt.id, { inbox: f.inbox, herdr: fake.herdr(), config, owner: "w-old", timing: { ...timing, leaseMs: 30 } }).run();
    expect(taken).toBe(true);
    // The old worker stopped without blocking, failing or focusing anything.
    expect(view).toMatchObject({ status: "in_progress", error: null });
    expect(at.row(attempt.id).lease_owner).toBe("other");
    expect(fake.focused).toHaveLength(0);
  });

  test("a lost tab-create answer: retry records orphan candidates by provenance and still starts nothing", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), onTabCreate: () => ({ timeout: true }) });
    await runWorker(fake, attempt.id);
    const view = await runWorker(fake, attempt.id, true);
    const tab = fake.tabs[0]!.tab_id;
    expect(view).toMatchObject({ status: "uncertain", error: { code: "DELIVERY_UNCERTAIN" } });
    expect(view!.error!.message).toContain(tab);
    expect(JSON.parse(at.ops(attempt.id).find((o) => o.op === "create_tab")!.detail_json!).candidate_tabs).toEqual([tab]);
    expect(at.row(attempt.id).pane_id).toBeNull();
    expect(count(fake, "agent start")).toBe(0);
    expect(count(fake, "tab create")).toBe(1);
  });

  test("a receipt the bridge could not store is replayed by reconcile, then retry delivers without a second prompt", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge({ receipt: false }));
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", error: { code: "RECEIPT_INVALID" } });
    const row = at.row(attempt.id);
    writeFileSync(pendingPath(row.id), JSON.stringify({ attempt_id: row.id, session_id: row.session_uuid, last_assistant_message: marker(row), written_at: "x" }));
    expect(reconcile(f.inbox).receipts_replayed).toBe(1);
    expect(existsSync(pendingPath(row.id))).toBe(false);
    expect(at.get(row.id).evidence.receipt_candidate).toBe(true);
    expect(await runWorker(fake, attempt.id, true)).toMatchObject({ status: "succeeded" });
    expect(count(fake, "agent prompt")).toBe(1);
  });

  test("a stale or forged pending receipt is checked like any bridge evidence and removed", async () => {
    const attempt = openAttempt();
    await runWorker(new FakeHerdr(bridge({ receipt: false })), attempt.id);
    const row = at.row(attempt.id);
    const bodies: unknown[] = [
      { attempt_id: row.id, session_id: "00000000-0000-4000-8000-000000000000", last_assistant_message: marker(row) },
      { attempt_id: "att_other", session_id: row.session_uuid, last_assistant_message: marker(row) },
      "{ broken",
    ];
    for (const body of bodies) {
      writeFileSync(pendingPath(row.id), typeof body === "string" ? body : JSON.stringify(body));
      expect(reconcile(f.inbox).receipts_replayed).toBe(0);
      expect(existsSync(pendingPath(row.id))).toBe(false);
    }
    expect(at.get(row.id).evidence.receipt_candidate).toBe(false);
  });

  test("a worker that died between focus and commit: reconcile commits, calling nothing", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge());
    await runWorker(fake, attempt.id);
    // Rewind to the moment after the confirmed focus, before the commit.
    f.inbox.db.run("UPDATE attempts SET status = 'in_progress', receipt_json = NULL, focus_json = NULL, lease_owner = NULL, lease_expires_at = NULL WHERE id = ?", [attempt.id]);
    f.inbox.db.run("UPDATE items SET archived_at = NULL, archive_reason = NULL WHERE id = ?", [attempt.item_id]);
    const calls = fake.calls.length;
    expect(reconcile(f.inbox).delivered).toEqual([attempt.id]);
    expect(at.get(attempt.id)).toMatchObject({ status: "succeeded", evidence: { delivered: true, focused: true } });
    expect(fake.calls.length).toBe(calls);
  });

  test("a worker that died mid-way becomes uncertain; one that did nothing external, or still holds its lease, is left alone", () => {
    const died = openAttempt({ external_id: "died" });
    const g = at.claim(died.id, "w", 60_000)!;
    at.beginOp(died.id, g, "create_tab", { workspace_id: "w1" });
    f.clock.advance(61_000);
    const fresh = openAttempt({ external_id: "fresh" });
    const held = openAttempt({ external_id: "held" });
    const g2 = at.claim(held.id, "w2", 60_000)!;
    at.beginOp(held.id, g2, "create_tab");
    const r = reconcile(f.inbox);
    expect(r.marked_uncertain).toEqual([died.id]);
    expect(at.get(died.id)).toMatchObject({ status: "uncertain", error: { code: "DELIVERY_UNCERTAIN" } });
    // Its claim is released, so a retry can start a worker at once.
    expect(at.row(died.id).lease_owner).toBeNull();
    expect(at.get(fresh.id).status).toBe("in_progress");
    expect(at.get(held.id).status).toBe("in_progress");
    expect(at.row(held.id).lease_owner).toBe("w2");
  });

  test("reconcile leaves blocked and uncertain attempts to the user and never claims them", async () => {
    const attempt = openAttempt();
    await runWorker(new FakeHerdr(bridge({ receipt: false })), attempt.id);
    const before = at.row(attempt.id);
    reconcile(f.inbox);
    const after = at.row(attempt.id);
    expect({ status: after.status, gen: after.fencing_generation }).toEqual({ status: before.status, gen: before.fencing_generation });
  });

  test("after a Herdr restart, a new occupant of the old pane is never taken for the session", async () => {
    // Before dispatch: the start ended unclear, then Herdr restarted with another Claude in the pane.
    const a1 = openAttempt({ external_id: "a1" });
    const hooks = bridge();
    const fake = new FakeHerdr({ ...hooks, onStart: (a, args) => (hooks.onStart!(a, args), { timeout: true }) });
    await runWorker(fake, a1.id);
    fake.agents.get(agentAlias(a1.id))!.session = "11111111-1111-4111-8111-111111111111";
    expect(await runWorker(fake, a1.id, true)).toMatchObject({ status: "uncertain" });
    expect(count(fake, "agent prompt")).toBe(0);
    // Started and bound, but no receipt; after the restart the alias names another session.
    const a2 = openAttempt({ external_id: "a2" });
    const fake2 = new FakeHerdr(bridge({ receipt: false }));
    await runWorker(fake2, a2.id);
    fake2.agents.get(agentAlias(a2.id))!.session = "22222222-2222-4222-8222-222222222222";
    expect(await runWorker(fake2, a2.id, true)).toMatchObject({ status: "blocked", error: { code: "AGENT_UNAVAILABLE" } });
    expect(fake2.focused).toHaveLength(0);
    // After the restart the alias is gone altogether.
    const a3 = openAttempt({ external_id: "a3" });
    const fake3 = new FakeHerdr(bridge({ receipt: false }));
    await runWorker(fake3, a3.id);
    fake3.agents.clear();
    expect(await runWorker(fake3, a3.id, true)).toMatchObject({ status: "blocked", error: { code: "AGENT_UNAVAILABLE" } });
  });
});

describe("INB-009 review round 1", () => {
  const pendingPath = (id: string) => join(bridgeFiles(f.home, id).dir, RECEIPT_PENDING_FILE);
  const stop = (row: AttemptRow, written_at: string) =>
    JSON.stringify({ attempt_id: row.id, session_id: row.session_uuid, last_assistant_message: marker(row), written_at });

  test("a pending receipt older than a refused startup stays dropped; one written after it counts", async () => {
    const attempt = openAttempt();
    await runWorker(new FakeHerdr(bridge({ receipt: false })), attempt.id);
    const row = at.row(attempt.id);
    // The receipt was saved aside, then /clear replaced the session and the bridge refused it.
    writeFileSync(pendingPath(row.id), stop(row, "2026-10-22T08:59:59.000Z"));
    at.bind(row.id, row.capability, { session_id: "00000000-0000-4000-8000-000000000000", cwd: row.cwd, claude_config_dir: workDir, auth_env: [] });
    expect(reconcile(f.inbox).receipts_replayed).toBe(0);
    expect(existsSync(pendingPath(row.id))).toBe(false);
    expect(at.get(row.id).evidence.receipt_candidate).toBe(false);
    // The original session's own later Stop (INB-002 N2) still counts.
    writeFileSync(pendingPath(row.id), stop(row, "2026-10-22T09:00:01.000Z"));
    expect(reconcile(f.inbox).receipts_replayed).toBe(1);
    expect(at.get(row.id).evidence.receipt_candidate).toBe(true);
  });

  test("the commit shortcut needs a confirmed focus: a started or uncertain one becomes uncertain", async () => {
    for (const state of ["started", "uncertain"]) {
      const attempt = openAttempt({ external_id: `focus-${state}` });
      await runWorker(new FakeHerdr(bridge()), attempt.id);
      f.inbox.db.run("UPDATE attempts SET status = 'in_progress', receipt_json = NULL, focus_json = NULL, lease_owner = NULL, lease_expires_at = NULL WHERE id = ?", [attempt.id]);
      f.inbox.db.run("UPDATE items SET archived_at = NULL, archive_reason = NULL WHERE id = ?", [attempt.item_id]);
      f.inbox.db.run("UPDATE attempt_ops SET state = ?, finished_at = NULL WHERE attempt_id = ? AND op = 'focus'", [state, attempt.id]);
      const r = reconcile(f.inbox);
      expect(r.delivered).toEqual([]);
      expect(at.get(attempt.id)).toMatchObject({ status: "uncertain", evidence: { delivered: false } });
      expect(at.row(attempt.id).lease_owner).toBeNull();
    }
  });

  test("a busy store keeps the pending receipt for the next pass", async () => {
    const attempt = openAttempt();
    await runWorker(new FakeHerdr(bridge({ receipt: false })), attempt.id);
    const row = at.row(attempt.id);
    writeFileSync(pendingPath(row.id), stop(row, "2026-10-22T09:00:01.000Z"));
    const quick = new Inbox({ home: f.home, store: { busyTimeoutMs: 100 } });
    f.inbox.db.run("BEGIN IMMEDIATE");
    let r;
    try {
      r = reconcile(quick);
    } finally {
      f.inbox.db.run("ROLLBACK");
    }
    expect(r.receipts_replayed).toBe(0);
    expect(existsSync(pendingPath(row.id))).toBe(true);
    expect(reconcile(quick).receipts_replayed).toBe(1);
    quick.close();
  });

  test("an unexpected error on one attempt never breaks the read", async () => {
    const attempt = openAttempt();
    await runWorker(new FakeHerdr(bridge({ receipt: false })), attempt.id);
    // A directory where the pending file should be: reading it fails with EISDIR.
    mkdirSync(pendingPath(attempt.id), { recursive: true });
    expect(() => reconcile(f.inbox)).not.toThrow();
  });

  test("orphan candidates are only tabs carrying this attempt's id", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), onTabCreate: () => ({ timeout: true }) });
    await runWorker(fake, attempt.id);
    fake.tabs.push({ tab_id: `${fake.tabs[0]!.workspace_id}:t99`, workspace_id: fake.tabs[0]!.workspace_id, label: "work Someone else's tab 999999", env: {}, cwd: "C:\\x" });
    await runWorker(fake, attempt.id, true);
    expect(JSON.parse(at.ops(attempt.id).find((o) => o.op === "create_tab")!.detail_json!).candidate_tabs).toEqual([fake.tabs[0]!.tab_id]);
  });
});

describe("INB-009 review round 2", () => {
  test("orphan tabs are looked for only on the attempt's own Herdr server", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), onTabCreate: () => ({ timeout: true }) });
    await runWorker(fake, attempt.id);
    f.inbox.db.run("UPDATE attempts SET herdr_session = ? WHERE id = ?", ["C:\\Users\\someone\\other.sock", attempt.id]);
    const view = await runWorker(fake, attempt.id, true);
    expect(JSON.parse(at.ops(attempt.id).find((o) => o.op === "create_tab")!.detail_json!).candidate_tabs).toEqual([]);
    expect(view!.error!.message).toContain("no tab with this attempt's id was found");
    expect(fake.verbs()).not.toContain("tab list");
  });

  test("a pending file that keeps failing never stops the dead-worker check", () => {
    const attempt = openAttempt();
    const g = at.claim(attempt.id, "w", 60_000)!;
    at.beginOp(attempt.id, g, "create_tab", { workspace_id: "w1" });
    f.clock.advance(61_000);
    mkdirSync(join(bridgeFiles(f.home, attempt.id).dir, RECEIPT_PENDING_FILE), { recursive: true });
    expect(reconcile(f.inbox).marked_uncertain).toEqual([attempt.id]);
  });
});

describe("availability after delivery (INB-011)", () => {
  async function delivered() {
    const attempt = openAttempt();
    const fake = new FakeHerdr(bridge());
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "succeeded" });
    return { attempt, fake, alias: agentAlias(attempt.id) };
  }

  test("focus checks the live session id first, then focuses and records it live", async () => {
    const { attempt, fake } = await delivered();
    const before = fake.calls.length;
    expect(await focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).toMatchObject({ focused: true, availability: "live" });
    expect(fake.verbs().slice(before)).toEqual(["agent get", "agent focus"]);
    expect(at.get(attempt.id).availability).toBe("live");
  });

  test("a closed session stays in History as closed; focus is no longer offered, its reference is", async () => {
    const { attempt, fake } = await delivered();
    fake.agents.clear();
    const focused = fake.focused.length;
    await expect(focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE", details: { availability: "closed" } });
    expect(fake.focused.length).toBe(focused);
    const view = at.get(attempt.id);
    expect(view).toMatchObject({ status: "succeeded", availability: "closed" });
    expect(view.next_actions).toEqual(["copy_session_reference"]);
    const item = f.inbox.get(attempt.item_id);
    expect(item).toMatchObject({ placement: "history", archive_reason: "delivered" });
    expect(item.attempts[0]).toMatchObject({ attempt_id: attempt.id, status: "succeeded", session_uuid: at.row(attempt.id).session_uuid, availability: "closed" });
    expect(item.attempts[0]!.delivered_at).toMatch(/^\d{4}-/);
  });

  test("a replaced session is unknown and never focused by its pane id", async () => {
    const { attempt, fake, alias } = await delivered();
    // The same pane, the same alias, another conversation.
    fake.agents.get(alias)!.session = "33333333-3333-4333-8333-333333333333";
    const focused = fake.focused.length;
    await expect(focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE", details: { availability: "unknown" } });
    expect(fake.focused.length).toBe(focused);
    expect(at.get(attempt.id).availability).toBe("unknown");
    // Focus would keep failing until that exact session is back: it is not offered.
    expect(at.get(attempt.id).next_actions).toEqual(["copy_session_reference"]);
  });

  test("Herdr not answering marks the session unavailable and changes nothing else", async () => {
    const { attempt, fake } = await delivered();
    fake.hooks.before = () => ({ error: "server_not_running" });
    await expect(focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).rejects.toMatchObject({ code: "HERDR_UNAVAILABLE" });
    expect(at.get(attempt.id)).toMatchObject({ status: "succeeded", availability: "unavailable" });
    // Once Herdr is back and the session lives, focus works again.
    fake.hooks.before = undefined;
    expect(await focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).toMatchObject({ availability: "live" });
    expect(at.get(attempt.id).availability).toBe("live");
  });

  test("get lists every attempt of the item, newest first, with its session reference", async () => {
    const { attempt } = await delivered();
    const state = f.inbox.get(attempt.item_id).state_version;
    f.inbox.restore(attempt.item_id, state);
    const fresh = at.open(attempt.item_id, 1, { fresh: true }).attempt;
    const list = f.inbox.get(attempt.item_id).attempts;
    expect(list.map((a) => a.attempt_id).sort()).toEqual([attempt.id, fresh.id].sort());
    expect(list.find((a) => a.attempt_id === fresh.id)).toMatchObject({ status: "in_progress", delivered_at: null });
    expect(list.find((a) => a.attempt_id === attempt.id)!.delivered_at).not.toBeNull();
  });
});

describe("INB-011 review round 1", () => {
  test("availability is recorded only for a delivered session, never for one still starting", async () => {
    const attempt = openAttempt();
    // The alias is saved before Claude starts; a focus at that moment finds no agent yet.
    const fake: FakeHerdr = new FakeHerdr({ ...bridge(), onStart: (a): { timeout: true } => (fake.agents.delete(a.name), { timeout: true }) });
    await runWorker(fake, attempt.id);
    const before = at.get(attempt.id).availability;
    await expect(focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
    expect(at.get(attempt.id).availability).toBe(before);
    expect(at.setAvailability(attempt.id, "closed")).toBe(false);
  });

  test("get always lists the delivered attempt, however many abandoned ones follow it", async () => {
    const attempt = openAttempt();
    await runWorker(new FakeHerdr(bridge()), attempt.id);
    f.inbox.restore(attempt.item_id, f.inbox.get(attempt.item_id).state_version);
    for (let i = 0; i < 21; i++) {
      f.clock.advance(1000);
      at.abandon(at.open(attempt.item_id, 1, { fresh: true }).attempt.id);
    }
    const list = f.inbox.get(attempt.item_id).attempts;
    expect(list.some((a) => a.attempt_id === attempt.id && a.status === "succeeded")).toBe(true);
    expect(list.filter((a) => a.status === "failed")).toHaveLength(20);
    // Newest first.
    expect([...list].sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).map((a) => a.attempt_id)).toEqual(list.map((a) => a.attempt_id));
  });
});

describe("M2 and M3 milestone reviews, round 1", () => {
  test("a start held by a dialog can be focused so the user can answer it; nothing is sent", async () => {
    const attempt = openAttempt();
    const fake = new FakeHerdr({ ...bridge(), onStart: (a) => ((a.agent_status = "blocked"), (a.interactive_ready = false), { error: "agent_not_ready" }) });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "blocked", error: { code: "AGENT_BLOCKED" } });
    const before = fake.focused.length;
    expect(await focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).toMatchObject({ focused: true, starting: true });
    expect(fake.focused.length).toBe(before + 1);
    expect(fake.verbs()).not.toContain("agent prompt");
    // Another session already holding that alias is never focused, dialog or not.
    fake.agents.get(agentAlias(attempt.id))!.interactive_ready = true;
    fake.agents.get(agentAlias(attempt.id))!.session = "44444444-4444-4444-8444-444444444444";
    await expect(focusItem(f.inbox, () => fake.herdr(), attempt.item_id)).rejects.toMatchObject({ code: "AGENT_UNAVAILABLE" });
  });

  test("a store error inside a Herdr step stops the worker as a crash, not as an unclear Herdr answer", async () => {
    const attempt = openAttempt();
    const original = Attempts.prototype.finishOp;
    const spy = spyOn(Attempts.prototype, "finishOp").mockImplementation(function (this: Attempts, ...args: Parameters<Attempts["finishOp"]>) {
      if (args[2] === "start_agent" && args[3] === "confirmed") throw new InboxError("STORE_BUSY", "busy");
      return original.apply(this, args);
    });
    let view;
    try {
      view = await runWorker(new FakeHerdr(bridge()), attempt.id);
    } finally {
      spy.mockRestore();
    }
    expect(view!.error!.message).toContain("stopped unexpectedly");
    expect(view!.ops.find((o) => o.op === "start_agent")!.state).toBe("started");
  });

  test("the waiting worker replays a receipt the bridge saved aside, without any CLI read", async () => {
    const attempt = openAttempt();
    const hooks = bridge({ receipt: false });
    const fake = new FakeHerdr({
      ...hooks,
      onPrompt: (a, t) => {
        hooks.onPrompt!(a, t);
        a.agent_status = "idle";
        a.state_change_seq += 2;
        // The Stop met a busy store and saved the reply aside.
        const row = at.row(attempt.id);
        writeFileSync(join(bridgeFiles(f.home, row.id).dir, RECEIPT_PENDING_FILE), JSON.stringify({ attempt_id: row.id, session_id: row.session_uuid, last_assistant_message: marker(row), written_at: new Date().toISOString() }));
      },
    });
    expect(await runWorker(fake, attempt.id)).toMatchObject({ status: "succeeded" });
  });
});
