import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bridgeFiles } from "../../src/bridge/settings";
import { type AttemptRow, Attempts } from "../../src/core/attempts";
import { type InboxConfig } from "../../src/core/config";
import { READY_MARKER } from "../../src/core/packet";
import { profilesPath } from "../../src/core/profiles";
import { sha256Hex } from "../../src/core/submission";
import { focusItem } from "../../src/worker/focus";
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

async function runWorker(fake: FakeHerdr, attemptId: string) {
  currentId = attemptId;
  return new Worker(attemptId, { inbox: f.inbox, herdr: fake.herdr(), config, owner: "w-test", timing }).run();
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
