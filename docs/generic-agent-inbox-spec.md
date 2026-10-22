# Generic Agent Inbox — Implementation Specification

Design date: 2026-10-22. Target: one user on native Windows, using Herdr and Claude Code.

This document is the implementation brief for a local coding agent. Inspect the existing workspace and installed tools before choosing files, language, packages, or exact launch commands. Follow existing conventions. This design session created this specification only; it did not inspect the user's Windows installation, implement the feature, or install anything.

## 1. Decision status

The following labels distinguish requirements from assumptions:

- **Confirmed:** explicitly supplied or selected by the user.
- **Default:** a concrete design recommendation made normative for this specification, subject to deliberate revision.
- **Verified documentation:** described by current official documentation, reviewed on the design date; not tested against the user's installation.
- **Preflight:** must be established locally. Do not guess or silently substitute a weaker behavior.

### Confirmed decisions

| Area | Decision |
| --- | --- |
| Architecture | Standalone, generic inbox with its own storage, interface, and integration API. |
| Environment | Herdr and Claude Code both run natively on Windows. WSL is outside the initial target. |
| Primary interface | Terminal interface in a dedicated Herdr tab. It also runs in an ordinary terminal. |
| Personal/work | One combined inbox, with conspicuous profile labels and profile filters. |
| Profile selection today | Named shell commands, aliases, or launcher scripts. Their implementation remains to be inspected. |
| Item kinds | Informational and actionable. |
| Informational handling | Reading does not remove an item. Explicit Acknowledge moves it to history. |
| Actionable handling | Open session creates a prepared Claude session. Only verified, successful handoff removes the item from the active inbox. |
| Opening turn | Read the supplied context, acknowledge receipt, give a brief orientation, then wait for the user. |
| Authorization | Opening a session does not authorize proposed changes or establish that the underlying work is complete. |
| Conversation continuity | The handoff must be self-contained. Start a fresh session by default. |
| Context retention | Retain an immutable copy of handoff text. Larger artifacts remain producer-owned references. |
| Interface phasing | Working terminal inbox first; embedded Claude mod with list, details, and actions second. |
| Integration boundary | Use supported Herdr CLI/API primitives. The standalone inbox must work without the Claude UI mod. |

### Defaults adopted by this specification

Local SQLite and a versioned JSON CLI; no permanent inbox daemon or HTTP server. One fresh tab with one pane per opening attempt. Independent read, snooze, archive, and handoff state. A small Claude receipt bridge, separate from the optional UI mod. Durable events that producers can poll; no executable callbacks. No automatic reopening of historical items.

## 2. Goals and non-goals

### Goals

1. Discover notifications and prepared work in one place across producers and profiles.
2. Enter the right working directory and profile with the handoff already available.
3. Distinguish attempted delivery, verified delivery, dismissal, and underlying work completion.
4. Preserve context and inbox history through UI exits, producer removal, and failed launches.
5. Support concurrent producers and interfaces without lost updates or duplicate launches.
6. Keep producer integration small enough for a skill, agent, or ordinary script to use.

### Non-goals

No producer analysis, domain approval rules, remediation execution, outcome tracking, task dependencies, assignees, project boards, scheduling of producer jobs, or orchestration framework. No cloud synchronization, remote-machine launching, multi-user authorization, web interface, arbitrary agent adapters, or general terminal automation in the MVP. Do not include logic specific to session improvement, cleanup, or any first producer.

The opening-turn instruction is a generic handoff boundary. It is not a sandbox or a domain-specific approval engine. Existing Claude permissions and user control continue to apply.

## 3. Ownership and components

| Component | Owns | Does not own |
| --- | --- | --- |
| Producer | Analysis; original handoff document; larger artifacts; domain history; proposed work; execution; outcomes; decision to send a follow-up. | Inbox read/snooze/archive state or verified-delivery assertions. |
| Inbox core | Validation; immutable received revisions; state transitions; concurrency; handoff attempts; session references; delivery receipts; event history. | Interpretation of producer findings or whether the work succeeded. |
| Producer CLI | Stable local submission, updates, queries, and event polling. | Producer business logic. |
| Terminal UI | Presentation and explicit user actions through the core. | Its own item database or separate lifecycle rules. |
| Handoff worker | One durable opening attempt, Herdr operations, receipt reconciliation, and recovery. | Arbitrary workflows or producer execution. |
| Herdr adapter | Explicit endpoint selection; layout; recognized-agent launching/prompting; focus; live target inspection. | Proof that Claude understood a document. |
| Claude receipt bridge | Session binding, recognition of the opening prompt, acknowledgment collection, generic opening-turn boundary. | UI rendering or domain analysis. |
| Optional Claude UI mod | Embedded list, details, filters, actions, and a lightweight count indicator. | Launching into the current conversation or owning durable inbox state. |

The core may be a library shared by the CLI and TUI. External clients, including the mod, use the CLI contract. Only the core performs application database writes. No component imports producer code. Removing every producer must leave listing, history, informational acknowledgment, and handoff of already-retained self-contained items operational.

## 4. User flows

### 4.1 Informational item

1. Producer submits the notification.
2. It appears unread in Active, with producer and profile labels.
3. Opening details marks only the displayed content revision read.
4. Acknowledge marks that revision read and archives with reason `acknowledged`, atomically.
5. The item and any retained context remain in History. No session launches.

### 4.2 Actionable item

1. User opens details and sees the producer, proposed profile, working directory, instruction, and handoff preview.
2. User chooses **Open session**. The item remains Active, displaying progress.
3. The core reserves one attempt and snapshots the exact item revision and resolved profile configuration.
4. The worker validates prerequisites and creates the tab/root pane using Herdr.
5. It launches a fresh Claude conversation, verifies session identity, profile configuration, directory, and readiness, then submits the opening instruction through Herdr's agent primitive.
6. Claude reads the retained packet, acknowledges that exact packet, gives a short orientation, and waits. No implementation, repository changes, background jobs, or producer execution occur as part of this opening turn.
7. The worker verifies the receipt, a settled live agent, and successful focus of the intended pane.
8. In one transaction, it records handoff success, archives with reason `delivered`, clears snooze, and emits the corresponding events.
9. History offers **Focus session** while the verified live target exists and always shows its saved session reference and context.

### 4.3 Other actions

- **Snooze:** hide from Active until a chosen time; retain in Snoozed. This changes no delivery facts.
- **Archive / Dismiss:** explicitly remove either kind without claiming delivery. Display reason `dismissed`.
- **Restore:** move a historical item back to Active without deleting its earlier archive/delivery events. Existing delivery remains a historical fact.
- **Mark unread:** changes attention state only. Reading again does not acknowledge, unsnooze, or restore.
- **Retry:** reconcile the existing attempt first. Continue only a step proven safe to continue; never blindly resend a possibly submitted prompt.

No successful handoff is undone merely because its session later closes. That event changes availability, not historical delivery.

## 5. Data model

Names below define semantics, not mandatory ORM/table names. Use UTC timestamps in storage and offset-qualified times in the API. Display local times in the UI. Use generated opaque IDs rather than paths or titles as identity.

### 5.1 Producer submission, version 1

| Field | Required | Contract |
| --- | --- | --- |
| `api_version` | Yes | Integer `1`. Reject unsupported versions. |
| `producer_id` | Yes | Stable namespaced identifier, e.g. `example.script`. No installed producer plugin is required. |
| `external_id` | Yes | Stable producer-assigned item identifier. `(producer_id, external_id)` is the idempotency/deduplication key. |
| `kind` | Yes | `informational` or `actionable`; immutable after creation. |
| `title` | Yes | Short plain text. |
| `summary` | Yes | Plain-text explanation sufficient to decide whether to inspect the item. |
| `profile_id` | Yes | Profile label/configuration reference, e.g. `personal` or `work`. Never credentials. Also labels informational items. |
| `correlation_key` | No | Opaque, non-unique producer grouping value. No implicit deduplication or workflow behavior. |
| `handoff_path` | Actionable | Absolute path to a producer-owned, durable UTF-8 handoff document. Optional for informational items. Read once at submission/update and retain its exact text bytes. |
| `context_refs` | No | Array of `{uri, label?, sha256?}` referencing larger producer-owned artifacts. Default `[]`. |
| `launch` | Actionable | `{agent, cwd, initial_instruction}`. Agent is `claude-code` in MVP; cwd is an absolute existing native Windows directory at launch time. |
| `source_session_ref` | No | Opaque reference to a previous producer conversation. For provenance/manual navigation only in MVP; not permission to inject into or resume it. |

Do not add a separate deduplication key: `external_id` already provides one. A producer can put multiple related notifications under a correlation key while assigning distinct external IDs.

Example input, with illustrative paths and IDs:

```json
{
  "api_version": 1,
  "producer_id": "example.script",
  "external_id": "run-2026-10-22:notice-1",
  "kind": "actionable",
  "title": "Review the prepared findings",
  "summary": "A new report is ready for discussion.",
  "profile_id": "work",
  "correlation_key": "run-2026-10-22",
  "handoff_path": "C:\\AgentData\\example\\run-2026-10-22\\handoff.md",
  "context_refs": [
    {
      "uri": "file:///C:/AgentData/example/run-2026-10-22/report.json",
      "label": "Supporting report"
    }
  ],
  "launch": {
    "agent": "claude-code",
    "cwd": "C:\\Projects\\Example",
    "initial_instruction": "Read the handoff, identify the decisions I need to make, give a brief orientation, then wait for my direction."
  }
}
```

Titles, summaries, paths, instructions, and references are data, never shell syntax. Reject NULs and inappropriate control characters; neutralize terminal escape/control sequences when rendering. Reject oversize payloads with explicit errors; do not truncate context. Default limits: title 200 characters, summary 4 KiB UTF-8, instruction 16 KiB, handoff 256 KiB, 32 references. Limits are configuration, not extra item fields.

The handoff must contain all essential opening context. A reference is not a claim that its contents were loaded. MVP supports local file references and displays other URIs as opaque links; it does not fetch arbitrary URLs. A producer must not require remote resolution merely to understand the opening handoff.

Producers must finish writing the handoff before submission, preferably by atomic rename to a revision-specific durable path. Do not mutate that file during snapshot capture. Once accepted, the inbox's retained bytes are authoritative for that received revision.

### 5.2 Inbox item and immutable revisions

An item has `id`, `producer_id`, `external_id`, `kind`, `created_at`, `updated_at`, `content_revision`, `state_version`, `read_revision`, `snoozed_until`, `archived_at`, `archive_reason`, and `blocking_attempt_id`.

- Each accepted content update creates an immutable revision containing the complete producer payload, retained handoff bytes, source path, computed SHA-256, and receipt timestamp.
- `content_revision` increases only for content changes. `state_version` increases for inbox-state mutations.
- An item is read exactly when `read_revision == content_revision`. Mark unread sets `read_revision` to null.
- Archive reasons are `acknowledged`, `dismissed`, or `delivered`. Reasons describe inbox handling, never domain completion.
- No `approved`, `implemented`, `resolved`, or domain-specific outcome field exists.
- Archive metadata describes current placement; the event log preserves every earlier archive/restore transition.

The delivery snapshot is an inbox-owned record of what was received. It does not transfer ownership of the producer's original document or supporting artifacts. Opening uses the stored snapshot, never a silently re-read mutable original. Display its captured time so the user can judge freshness.

### 5.3 Handoff attempt

Persist at least:

- Attempt ID, item ID and content revision; creation/update timestamps.
- Selected profile ID and a redacted resolved launch-configuration fingerprint; exact cwd; agent kind; expected native Claude session UUID.
- Status, phase, stable error code, short human-readable error, and timestamps for external-operation intents/results.
- Worker lease owner, expiry, and fencing generation; receipt challenge; immutable packet bytes/hash and materialized path.
- Explicit Herdr endpoint/session selector; returned workspace, tab, pane IDs; unique live agent alias when supported; any server-instance discriminator exposed by the installed API.
- Startup binding, opening-prompt acceptance, acknowledgment candidate, final delivery receipt, and focus result.
- Whether each potentially ambiguous operation was started, confirmed, or left uncertain.

Keep runtime availability separate: `live`, `closed`, `unknown`, or `unavailable`. Save the native Claude session ID even if the tab disappears. A pane ID alone is not a conversation identity.

### 5.4 Events

Append events in the same transaction as state changes. Each has a monotonic sequence cursor, event ID, timestamp, item/revision IDs, optional attempt ID, actor, event type, and bounded metadata. Do not copy full handoff text or credentials into events/errors.

Use a small vocabulary: `item.created`, `item.updated`, `item.read_changed`, `item.snoozed`, `item.unsnoozed`, `item.archived`, `item.restored`, `handoff.started`, `handoff.blocked`, `handoff.uncertain`, `handoff.failed`, `handoff.delivered`. Archive reason distinguishes acknowledgment/dismissal/delivery. Internal attempt-phase events may be added for diagnostics without becoming producer workflow signals.

## 6. Lifecycle and concurrency rules

### 6.1 Independent state

| Dimension | Representation | Effect |
| --- | --- | --- |
| Attention | Read revision | Whether the latest content has been read. |
| Visibility | Snoozed-until | When an unarchived item returns to Active. |
| Placement | Archived timestamp/reason | Active/Snoozed versus History. |
| Delivery | Attempt records and receipt | Whether a particular revision reached a particular prepared session. |

Active query: `archived_at IS NULL` and snooze absent or due. Snoozed query: unarchived and snooze in the future. History query: archived. Read items remain in Active until explicitly handled. An in-progress launch remains visible with its action disabled or changed to **View attempt**.

Snooze expiration is derived from time at query time; no scheduler is required. It does not manufacture a new unread revision. Archiving clears snooze. Restore clears snooze and makes the item unread. Default ordering is oldest-created first, with a stable ID tie-breaker. Provide an unread filter without making it the only active view.

### 6.2 Attempt states

| State | Meaning | Allowed next step |
| --- | --- | --- |
| `in_progress` | A worker owns the next verified step. | Progress, block, become uncertain, fail, or succeed. |
| `blocked` | A known condition needs attention, e.g. trust dialog, missing receipt, or focus failure. | Focus/inspect and explicitly continue a safe step, reconcile, or abandon. |
| `uncertain` | An external side effect may have happened and its outcome is not established. | Reconcile; do not automatically launch or resend. |
| `failed` | Attempt ended without delivery and no unresolved side effect remains, or the user explicitly abandoned it. | A new attempt may be created. |
| `succeeded` | Verified delivery and archive transaction completed. | Focus the verified session; never resend automatically. |

Phase is one of `preflight`, `create_layout`, `start_agent`, `submit_context`, `await_receipt`, or `focus`. Retain phase when an error occurs.

Enforce at most one blocking attempt per item, covering `in_progress`, `blocked`, and `uncertain`. Duplicate clicks from either interface return the existing attempt. Use an atomic transaction/conditional update or equivalent database constraint; a UI disabled button is insufficient.

Read/unread changes remain allowed during a handoff. Snooze, archive, restore, profile switching, and producer content updates return `ATTEMPT_IN_PROGRESS` until the blocking attempt is resolved or explicitly abandoned. This avoids archiving a newer revision based on an older receipt.

### 6.3 Updates and deduplication

- Repeating `submit` with the same producer/external ID and identical canonical content returns the existing item without changing read/snooze/history state or emitting another creation event.
- The same key with different content returns `IDEMPOTENCY_CONFLICT`; use explicit update.
- Update requires the expected content revision and a complete replacement producer payload. Reject stale revision, changed immutable identity/kind, blocking attempt, or historical placement.
- An actual update creates a revision and makes the latest content unread. Preserve snooze and active placement. An identical update is a no-op.
- A producer cannot overwrite user state, declare delivery, archive, or silently reopen history. For new attention after historical handling, submit a new external ID, optionally with the same correlation key.
- User restore is explicit and retains delivery history. If restored content was already delivered, show that fact and offer **Focus existing session** before a distinct **Open fresh session** action. No automatic duplicate work.

## 7. Storage and process model

**Default:** a local SQLite database under an application-specific directory in `%LOCALAPPDATA%`, configurable with `AGENT_INBOX_HOME`. Do not place it inside a project, a producer's directory, OneDrive, a network share, or a temporary folder. Personal and work profiles resolve to the same absolute inbox home.

Use tables equivalent to items, immutable item revisions/snapshots, attempts, events, and schema migrations. Store the essential handoff and attempt packet bytes transactionally in SQLite; file copies for Claude are materializations, not the sole durable copy. This avoids a database row pointing to a snapshot that was never successfully written.

- Enable foreign keys on each connection. Use short transactions and bounded busy handling, default 5 seconds. Return `STORE_BUSY` rather than hanging indefinitely.
- Prefer WAL and `synchronous=FULL` for this small local store, using an engine with the WAL-reset fix. Official SQLite documentation identifies fixes in 3.51.3 and later and backports 3.44.6/3.50.7. Check the actual library linked by the application, not only a separate `sqlite3.exe`. If a fixed engine is unavailable, document and use rollback-journal mode until corrected; never enable known-affected WAL silently. See [R8].
- No transaction may span a Herdr operation, agent turn, subprocess wait, or interactive prompt.
- Serialize migrations and reject a newer unsupported schema. Do not let two process versions migrate concurrently.
- Use the SQLite backup API/equivalent consistent backup facility. Copying only the main live database file is not a valid WAL backup.
- Default retention is indefinite, with no automatic deletion. Do not build retention scheduling or producer cleanup into MVP.

The TUI starts a finite per-attempt worker that survives the TUI closing, using the appropriate native Windows process mechanism. The worker exits on success, failure, block, uncertainty, or deadline. No service installation or periodic background analysis is needed. The next explicit open/retry or UI startup reconciles unfinished attempts. Small bridge invocations can record receipts while the TUI is closed.

Workers renew a bounded lease; every step/result write checks the fencing generation. Persist intent before an external side effect. Lease expiry does not authorize repeating that side effect. A replacement worker reconciles and marks ambiguity `uncertain`. OS PID existence alone is not proof of worker or agent identity.

Use current-user filesystem permissions for the database, packets, and config. This is a same-user trust model, not security isolation between personal/work accounts or hostile local processes. Profile filters are presentation, not access controls.

## 8. Producer and client API

`agent-inbox` is a proposed executable name; adapt it to workspace conventions while preserving the contract. JSON input uses a file or stdin. Never require a producer to construct a shell command containing its handoff text.

| Operation | Proposed CLI | Semantics |
| --- | --- | --- |
| Submit | `agent-inbox submit --input item.json --json` | Validate, capture document bytes, atomically create or deduplicate. `--input -` accepts stdin. |
| Update | `agent-inbox update ITEM --if-revision N --input item.json --json` | Complete producer-content replacement with revision check. |
| Get | `agent-inbox get ITEM --json` | Current revision, inbox state, and attempt summary; `--include-context` explicitly includes retained context. |
| List | `agent-inbox list --view active --profile work --json` | Views: active, snoozed, history. Filters for profile, producer, kind, unread, bounded cursor pagination. |
| Events | `agent-inbox events --producer example.script --after CURSOR --limit N --json` | Durable ordered polling with a next cursor. |
| Read | `agent-inbox mark-read ITEM --revision N --json` | Mark the revision actually displayed, never an unseen later revision. |
| Unread | `agent-inbox mark-unread ITEM --json` | Attention state only. |
| Acknowledge | `agent-inbox acknowledge ITEM --if-state-version N --revision R --json` | Informational only; read plus archive in one transaction. |
| Snooze | `agent-inbox snooze ITEM --until OFFSET_TIME --if-state-version N --json` | Inbox visibility only. Separate `unsnooze` removes the timestamp. |
| Archive | `agent-inbox archive ITEM --if-state-version N --json` | Explicit dismissal, never delivered. |
| Restore | `agent-inbox restore ITEM --if-state-version N --json` | Explicit user restoration. |
| Open | `agent-inbox open ITEM --if-revision N --json` | Reserve or return the existing attempt; start the worker; return promptly. User-only `--profile PROFILE` records an explicit override. |
| Attempt | `agent-inbox attempt get ATTEMPT --json` | Progress, retained evidence, error, safe next actions. |
| Retry | `agent-inbox retry ATTEMPT --json` | Reconcile before continuing; no blind repetition. |
| Abandon | `agent-inbox abandon ATTEMPT --json` | Revoke the attempt and release its reservation. Does not kill or close a session. |
| Focus | `agent-inbox focus ITEM --json` | Verify and focus the retained live session; never submit context. |
| Status | `agent-inbox status --json` | Cheap counts by view/profile, store change token, and next snooze deadline. No artifacts read. |
| Diagnose | `agent-inbox doctor --json` | Redacted configuration/capability report. No installation, restart, account switch, or context submission. |
| TUI | `agent-inbox tui` | Standalone interface. |

Separate internal bridge/worker commands from the supported producer surface. There is no public `set-delivered` command.

All JSON commands return `{api_version:1, ok:true, data:{...}}` or `{api_version:1, ok:false, error:{code,message,retryable,details?}}`. Reserve stdout for JSON; use stderr for diagnostics. Exit 0 means command success/acceptance, not completed handoff; exit 1 is an operational/domain error and exit 2 is invalid usage/input. For `open`, return `attempt_id`, current status, and whether an existing reservation was reused.

If the current revision was already delivered and then restored, ordinary `open` returns `ALREADY_DELIVERED` with focus/reference options. The distinct user action **Open fresh session** sends `open --fresh`; it creates another attempt without altering the earlier receipt. The mod and TUI must never add this flag implicitly.

Use stable codes including `INVALID_ITEM`, `UNSUPPORTED_API_VERSION`, `NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `REVISION_CONFLICT`, `STATE_CONFLICT`, `ITEM_IN_HISTORY`, `ATTEMPT_IN_PROGRESS`, `PROFILE_NOT_CONFIGURED`, `PROFILE_LAUNCH_UNSUPPORTED`, `CWD_UNAVAILABLE`, `HERDR_UNAVAILABLE`, `AGENT_UNAVAILABLE`, `AGENT_BLOCKED`, `RECEIPT_INVALID`, `DELIVERY_UNCERTAIN`, and `STORE_BUSY`.

Producer IDs label logical ownership; they are not authenticated principals in a same-user CLI. Enforce update ownership in the application contract, but do not claim malicious-process isolation.

### Producer notifications

Producers may poll the generic event stream and retain their own cursor. Delivery means the specific item revision was handed off; it must never mean approved or completed. Use ordered at-least-once consumption semantics: consumers deduplicate by event ID and advance cursors only after processing. Empty polls return the latest safe cursor. No webhook, shell callback, plugin invocation, or producer execution is triggered by the inbox in MVP.

## 9. Handoff and verified-delivery contract

### 9.1 Evidence required

Archive as delivered only after all of the following:

1. The attempt still owns the item's reservation and pins its current content revision.
2. A startup bridge report binds the expected native Claude session UUID, intended profile launch fingerprint, canonical cwd, attempt capability, and Herdr target.
3. The opening prompt is accepted in that bound main session.
4. Claude returns an explicit acknowledgment of the immutable packet in its completed opening response, together with a nonempty brief orientation and a statement that it is waiting.
5. A trusted bridge captures that acknowledgment from the main session's completed response, rather than scraping terminal screen text.
6. Herdr subsequently reports the same occupant settled (`idle` or `done`) and the adapter successfully focuses its verified pane. Merely observing an earlier startup idle state is insufficient.
7. The core atomically commits the receipt, successful attempt, archive, and events.

This verifies context transport and the session's explicit acknowledgment. It cannot prove comprehension, correctness of producer claims, or future compliance by an LLM. Do not describe it as such. Supporting references remain references unless the session explicitly reads them; the receipt must not claim all linked artifacts were loaded.

### 9.2 Proposed bridge protocol

This protocol is inbox behavior to implement; it is not a built-in Herdr delivery receipt.

1. Generate a fresh native Claude session UUID, attempt capability, and random acknowledgment challenge. They belong to the attempt, never a producer item or profile credential store.
2. Build immutable UTF-8 packet bytes containing the attempt/item/revision IDs, generic opening-turn boundary, producer instruction, retained handoff text, context references, and the random acknowledgment challenge. Store the bytes and SHA-256 before materializing the file. Do not put the challenge in the opening prompt or pane label.
3. Start Claude without a task prompt, with the explicit session UUID and a small scoped bridge configuration. The bridge has `SessionStart`, `UserPromptSubmit`, `Stop`, and failure/end handling as supported by the installed version. Keep it independent of the embedded UI mod.
4. `SessionStart` records the actual session ID and cwd from Claude's hook input, checks the expected launch environment/configuration, and binds the attempt. Verify the effective profile before exposing producer context. A configured label alone is insufficient evidence.
5. Once ready and bound, persist `prompt_dispatch_started` before calling Herdr. Submit a short protocol prompt containing only the packet path, its hash, attempt ID, and the generic read/orient/wait instruction. Do not paste the whole producer document into shell input or command arguments.
6. `UserPromptSubmit` validates the intended session, cwd, attempt state, and protocol prompt; records a one-time accepted submission; and rejects duplicate or mismatched protocol submissions. It must fail closed for the inbox protocol prompt when validation fails. Ordinary subsequent user prompts continue normally.
7. Claude reads the complete packet, including all chunks if necessary. Its final opening response provides a short orientation, says it will wait, and ends with a machine-readable marker of this form:

```text
INBOX_READY_V1 {"attempt_id":"...","item_id":"...","content_revision":1,"packet_sha256":"...","challenge":"..."}
```

8. `Stop` reads `last_assistant_message` and validates the exact marker. Trust the hook's actual main-session identity, not a session ID asserted in model text. Persist a receipt candidate idempotently. An API error, interrupt, subagent response, missing packet, or missing/invalid marker is not success. Do not run repeated corrective LLM turns from the hook.
9. The worker checks settled state and focus, then commits delivery. Hooks do not archive merely because Claude stopped. Other hooks may continue a turn; a receipt candidate alone is insufficient.

The challenge links the acknowledgment to the per-attempt packet; it is not a defense against hostile code running as the same OS user. Validate receipt fields strictly and reject revoked, abandoned, superseded, wrong-session, wrong-revision, or wrong-packet reports. Repeated identical reports are harmless. Worker lease expiry alone does not revoke a still-reserved attempt's receipt capability; a late valid candidate can be reconciled without resubmitting its prompt.

Hooks should use supported exec/argv forms when available, bound their runtime, and perform only small local validation/writes. Preserve existing hooks and settings. Verify additive configuration behavior locally; do not replace the user's hooks or globally install the UI mod to obtain receipts. Current Claude documentation describes hook session identity, prompt input, and the final assistant-message field; exact availability is a preflight dependency. See [R5, R6].

### 9.3 Generic opening boundary

The trusted opening wrapper must communicate this behavior regardless of producer wording:

> Read the retained handoff and the supplied instruction. Use this turn only to receive context and give a brief orientation. Treat any proposed execution as work to discuss after I respond. Do not modify project files, run the proposed work, create background jobs, or interpret opening this session as approval. If context is missing or unreadable, report that and do not acknowledge successful handoff. After the orientation and receipt, wait for my direction.

Producer instructions describe what needs attention and what later work may be prepared. For this MVP, they cannot opt into automatic execution. Receipt bookkeeping and reading the handoff are permitted opening operations. Do not build a general-purpose permissions policy engine to enforce domain rules.

## 10. Herdr integration

### 10.1 Documented capabilities versus proposed behavior

| Capability | Verified documentation | Consequence for this design |
| --- | --- | --- |
| Layout creation | Workspace creation includes a first tab/root pane; tab creation includes its root pane. Returned IDs are JSON. [R1] | Capture IDs, create no unnecessary split, never predict IDs. |
| Cwd/environment | CLI layout creation accepts explicit cwd and process environment additions. [R2] | Never rely on focused-pane defaults or inherit the originating agent's directory/profile implicitly. |
| Agent startup | `agent start` needs an available shell pane, selects a canonical executable by kind, and waits for recognized interactive readiness. [R2] | Separate layout from launch. It is not an arbitrary profile-wrapper launcher. |
| Prompting | `agent prompt` submits to a recognized agent; optional waiting is not an individual-turn receipt. A working turn can satisfy some waits. [R2] | Use the bridge acknowledgment, not wait completion, as context evidence. |
| Targeting/focus | APIs expose agent/pane inspection and explicit focus. Unique live agent names follow the current occupant. [R1, R2] | Pin explicit targets; labels or current focus are never identity. |
| Native Windows | ConPTY panes, launch cwd, process detection, and Claude integration are supported; live cwd inspection has limitations and Herdr plugins have preview caveats. [R3] | Native Windows is the MVP; don't depend on a Herdr plugin or live cwd guessing. |
| Transport/reconnect | Local Windows socket transport is a named pipe; documented snapshot/event reconciliation exists. [R4] | Prefer CLI wrappers. Re-read authoritative state after reconnect. |
| Persistence | Detach preserves live processes; server restart restores layout but requires native agent-session restoration for conversation continuity. [R7] | A restored pane is not proof the old conversation is running. |

All inbox receipt, deduplication, profile, archive, and recovery behavior is proposed application behavior. Documentation review does not establish the capabilities or versions installed on the user's PC.

### 10.2 Launch sequence and layout policy

- Configure the local Herdr endpoint/named session explicitly. Capture that selection per attempt. Never fall back to another server/session if the configured one is unavailable.
- Use an explicitly configured inbox-owned Herdr workspace for launch tabs, separate from the dedicated inbox tab. Create the workspace explicitly if absent; do not borrow the currently focused project workspace. No Git worktrees are created.
- Normally use `tab create` with explicit workspace, cwd, environment, and no focus; keep the returned root pane. Label the tab with profile, short title, and a short attempt ID. Labels help people, not identity checks.
- For profiles reducible to a canonical Claude executable plus a deterministic environment, use `agent start` in that pane with the required session/bridge arguments.
- If the existing profile requires a wrapper, use a supported argv process launch such as a single-pane `layout.apply` command, if supported by the installed schema. Then wait for Herdr recognition of the launched Claude process and bind a unique live alias. Do not force a shell alias into `--kind` or use simulated keystrokes.
- If neither supported route preserves the profile correctly, block with `PROFILE_LAUNCH_UNSUPPORTED`. Ask for a deliberate local launcher adaptation; never silently use bare `claude`.
- Focus only an explicit verified target. A blocked startup may be focused so the user can handle its trust/login dialog. After resolution, continue the same attempt if identity remains valid.
- The inbox TUI remains usable when Herdr is unavailable. Submission, listing, reading, acknowledgment, snooze, and history do not depend on a running Herdr server.

### 10.3 Preventing wrong-session delivery

Use a unique random live agent alias for each attempt where supported. Never reassign it to a different conversation. Before submission, verify the alias/occupant, startup binding, native session UUID, cwd, and selected Herdr endpoint. Use the agent primitive, not raw pane text, for context delivery.

The adapter must verify the installed API's occupant-pinning behavior rather than assuming a check followed by a send is atomic. The scoped prompt guard adds a second identity check inside the intended Claude session. Session replacement, `/resume`, `/clear`, pane movement, process exit, or reconnect requires revalidation. If the adapter cannot establish safe targeting, stop with uncertainty. Never target the focused pane, a title match, a directory match, or a reused numerical pane ID alone.

Discover moved targets by authoritative reads and a matching native session/attempt binding; update stored live locations only after validation. On reconnect, discard cached readiness. Event subscriptions are optional for the MVP; bounded polling can reconcile through authoritative CLI reads.

## 11. Profile handling

Profile configuration is user-owned, local, and separate from producer records. Each profile resolves to:

- Stable profile ID and display label.
- Agent kind and a trusted executable/wrapper launch plan expressed as argv, cwd policy, and explicit environment handling.
- Existing configuration/credential location references, not stored credential values.
- Supported forwarding of the session-ID and bridge arguments.
- A deterministic method to verify effective configuration, and, where supported, expected account identity through a non-mutating status command.

The local agent must inspect the existing aliases/functions/scripts and their shell initialization dependencies. Determine whether each uses `CLAUDE_CONFIG_DIR`, other environment changes, a wrapper executable, or account switching. Official Claude documentation supports separate configuration directories, but do not assume the user's aliases use them. See [R9].

Normalize a profile to canonical argv/environment only when equivalent. Otherwise preserve its trusted wrapper. Do not evaluate producer-supplied executable names, shell fragments, startup scripts, or arbitrary environment variables. Do not require a PowerShell interactive profile to have happened to load.

Prevent accidental credential crossover from the inbox process or Herdr server environment. Inspect authentication-affecting variables, configuration overrides, and wrapper behavior; clear conflicting inherited values inside the trusted launch boundary when needed. Do not log their values. Check wrapper forwarding and paths containing spaces. A launch-profile fingerprint demonstrates selected configuration, not immutable ownership of whatever account is currently logged into that configuration.

Unknown profile IDs may be received and displayed as configuration errors, but cannot launch. Unknown agent kinds return an unsupported-agent error. No automatic profile inference from cwd, producer, current terminal, last-used account, or open Claude session.

MVP opens using the item's declared profile. Changing it requires an explicit user **Open with profile…** selection before reservation; display the choice and record it in the attempt without rewriting the producer payload. Disable producer-triggered overrides. Do not switch profiles automatically on failure.

The receipt bridge is required per launched session. The embedded UI mod is optional and may need separate enabling under personal/work configurations. Both must use the same absolute inbox home.

## 12. Interfaces

### 12.1 Terminal MVP

Provide Active, Snoozed, and History views; profile/producer/kind/unread filters; stable selection during refresh; and a details view. List rows show read state, kind, title, profile, producer, age, and launch/error status. Details show the summary, exact cwd/profile, initial instruction, retained handoff, references, snapshot timestamp, prior attempts, and session availability.

Enter opens details, not a session. Label the primary action **Open session**. Provide informational **Acknowledge**, explicit dismissal, snooze/unsnooze, read/unread, restore, progress inspection, safe retry, abandon, and focus actions. Avoid bulk launch/acknowledgment in MVP.

Opening progress must distinguish starting, waiting on user input, waiting for context acknowledgment, focus failure, and uncertain outcome. Show the error and the safe next action without requiring log inspection. A repeated open returns/view-focuses the existing attempt. The interface must not silently replace a useful live session or close tabs on its own.

Refresh cheaply, default every two seconds while visible. Use core queries only, never producer analysis. Preserve selection by item ID. Support UTF-8 titles, small terminals, keyboard-only interaction, and Windows paths. Render arbitrary producer text as inert content; strip terminal control sequences and avoid automatic link execution.

Snooze accepts a duration or an explicit local date/time in the UI; the CLI requires an offset-qualified timestamp. Use the user's configured local timezone and handle ambiguous/nonexistent DST times explicitly. No recurring reminders or notification scheduler is included.

### 12.2 Embedded Claude mod — second release

Add an explicit `/inbox` command opening a real embedded list/details view with the same view/filter defaults and basic actions. Use supported mod UI APIs and invoke the JSON CLI through supported process argv calls. No duplicate database, producer discovery, state transitions, or launch implementation lives in the mod.

**Open session** calls the same command and creates/focuses the separate prepared Herdr session. It must never inject the handoff into the Claude conversation hosting the mod, even if its cwd/profile seems to match.

The mod should expose list, details, read/unread, informational acknowledgment, snooze, dismissal, open, retry/progress, history, and focus. Shared CLI errors must produce the same behavior as the TUI. If an advanced control cannot be rendered, expose **Open terminal inbox** without silently changing its semantics.

Current official docs describe mod UI surfaces, direct commands, and argv process calls. Obtain declarations for the installed Claude version and validate against them, rather than assuming today's web examples match the installation. See [R10, R11].

### 12.3 Optional pending indicator

Show a passive count/shortcut at session start or above the prompt. Prefer the mod's UI surface; use a supported status-line/hook presentation only after checking its actual behavior locally. Do not assume `SessionStart` stdout is a user-visible banner.

The indicator calls only `status`, with a short time budget, default 200 ms, and cached last-known counts if available. It does not read handoff files, call a model, run producers, launch sessions, submit a chat turn, or demand acknowledgment. No repeated modal/toast interruption. Default count is actionable plus informational Active items, with unread count shown separately and profile breakdown available. Failure omits or marks the indicator unavailable and never blocks ordinary Claude startup.

## 13. Failure recovery and resumption

| Situation | Required behavior |
| --- | --- |
| Herdr not installed/running or endpoint inaccessible | Keep Active; show diagnostic. Do not start another endpoint, install Herdr, elevate, or change configuration automatically. |
| Claude/profile unavailable | Keep Active; show which configured launcher failed. Never substitute another account or executable. |
| Cwd missing/invalid | Fail before context submission. Never fall back to home/current directory. |
| Original handoff removed | Use the retained received snapshot. The producer's absence is irrelevant. |
| Supporting artifact missing/changed | Show the reference and any known hash mismatch. Essential context should already be in the snapshot. If the instruction requires unavailable material before acknowledgment, the session reports failure and the item stays Active. Never replace referenced bytes silently. |
| Login/trust/permission/question dialog | Mark blocked and focus the exact pane. User handles it. Do not auto-accept dialogs or weaken permissions. |
| Agent readiness timeout | Inspect the recorded launch. If it may still be starting, mark uncertain/blocked and reconcile; never assume nothing launched. |
| Prompt send response lost | Submission is uncertain. Check accepted-prompt/receipt evidence. Do not resend automatically. |
| Claude stopped without receipt, or user interrupted | Keep Active, show the still-associated session, and offer focus/inspection. Do not generate repeated repair prompts automatically. |
| Receipt captured but focus failed | Preserve receipt candidate; keep the attempt blocked and item Active. Retry only revalidates/focuses/finishes the commit, without resending context. |
| TUI closes | Worker/bridge evidence survives. Reopening reconciles. |
| Worker crashes or lease expires | Fence the old worker. Reconcile persisted intent/results and live evidence. Ambiguous steps become uncertain. |
| Tab creation response lost | Possible orphan tab. Find candidates by recorded attempt provenance, but do not send context based on labels alone. Leave uncertain until resolved or abandoned. |
| Target closes before successful handoff | Keep Active. Fail only when closure is established; revoke that attempt's receipt capability before a fresh attempt. |
| Target closes after delivery | Keep in History with `closed` availability. Preserve receipt and native session ID. |
| Herdr reconnect/restart | Re-read live state. A restored layout/pane ID is not the same process or proof of session continuation. No input until identity is rebound. |
| Invalid/late receipt | Reject and record bounded diagnostics. It cannot archive another revision or a replacement attempt. |
| Store busy/full/write failure | No successful mutation response before commit. If an external launch occurred, surface/reconcile the recorded attempt instead of reporting delivered. |

Exactly-once terminal side effects cannot be guaranteed across arbitrary crashes and lost external responses. The contract is one blocking attempt per item, no blind replay of ambiguous operations, at-most-one automatic prompt submission per attempt, and atomic/idempotent inbox transitions. Be explicit about this limit.

**Retry** first resumes observation of an existing live attempt. It may continue an operation known not to have happened, such as focus after a valid receipt. Once `prompt_dispatch_started` is durable, the prompt is never automatically resubmitted unless a definitive rejection proves it was not delivered. A user who wants a new session can explicitly abandon the old attempt; show that its old session might still exist, revoke the old capability, retain its reference, and create a new distinct session UUID. Abandon does not close or interrupt that session.

**Session reuse/resumption policy:** MVP reuses only the verified live session belonging to the same attempt, to focus or finish handoff. It does not reuse arbitrary project tabs and does not automatically resume a source conversation. Native Claude exact-ID resumption is documented, but restored hooks/profile behavior must be checked; do not use `--continue`, a name search, or a latest-session heuristic. See [R6, R7].

History always provides **Copy session reference**. A later explicitly requested **Resume exact session** feature may use the recorded profile, cwd, and exact native UUID after local validation, without resending the original instruction or treating resume as new delivery. It is outside the first two releases.

## 14. Local coding-agent preflight

Perform these steps before implementation choices. They are instructions for the future local implementation session, not actions already performed during this design session.

1. **Inspect the workspace.** Read applicable `AGENTS.md` and project guidance; inspect repository layout, language/runtime, packaging, CLI/TUI conventions, tests, logging, and configuration patterns. Use existing choices where suitable. Do not create a second application framework merely because this document uses generic component names.
2. **Confirm native Windows execution.** Identify PowerShell/cmd/Git Bash boundaries, executable resolution, paths with spaces/Unicode, process-launch semantics, and current-user data paths. Do not move the design to WSL as a shortcut.
3. **Inspect Herdr, read-only.** Record executable and running-server versions/compatibility, `herdr --help`, relevant command help, `herdr api schema --json` when available, configured endpoint/named sessions, and authoritative list/get/snapshot responses. Inspect required create/start/prompt/wait/focus/layout command schemas. Do not print secrets, attach to unrelated work, restart the server, install integrations, or prompt an existing session as a preflight probe.
4. **Verify Herdr behavior required for safe launch.** Establish available JSON response fields, explicit cwd/env support, Windows wrapper launching, recognized-agent targeting and occupant pinning, native session reporting, unique alias behavior, focus semantics, bounded timeouts, and restart/reconnect identity. Record any missing primitive as a launch blocker or deliberate design change, not a silent raw-input fallback.
5. **Resolve both Claude profiles.** Inspect the actual named commands/aliases/functions/scripts using the relevant shell's read-only discovery. Determine effective executable, configuration directory, auth-affecting environment, wrapper forwarding, shell startup dependencies, and supported non-mutating account/configuration inspection. Redact secrets. Verify launching from another agent's environment cannot inherit the wrong account.
6. **Inspect Claude versions and capabilities per profile.** Record version/help; exact `--session-id`, additive settings/plugin loading, hook input/output, exec-form hooks, and interrupt/failure behavior. Verify that the small receipt bridge can coexist with existing Herdr and user hooks. If versions differ, satisfy the compatible common subset or report the blocker.
7. **Inspect mod support separately.** Check policy restrictions and installed APIs. During the mod implementation phase, obtain its generated local type declarations and run the installed validation tooling. A missing mod capability must not block the terminal release.
8. **Inspect SQLite through the chosen runtime.** Record actual engine version/fixes, journal-mode availability, Windows locking, bindings, and migration/backup conventions. Use a WAL-fixed build or the documented rollback-journal fallback.
9. **Choose a launch adapter explicitly.** Document whether profiles use canonical `agent start` plus environment or a supported argv wrapper launch. Confirm all mandatory identity/receipt requirements can be satisfied before implementing automatic handoff.
10. **Write a short preflight result.** List established facts, chosen implementation locations, compatibility issues, any unresolved user decision, and the end-to-end validation plan. Ask only for information that cannot be established locally and materially changes behavior. Do not request permission again for routine implementation already authorized in that future session.

Preflight is read-only. Real session-launch tests belong to implementation validation and must use a dedicated disposable test directory/profile setup, never an existing user conversation. Do not install/update tools, switch accounts, or overwrite existing shell/Claude settings as an incidental probe.

## 15. Acceptance criteria

### Core and producer boundary

- [ ] Two unrelated example producers use only the public JSON contract; neither is imported by the inbox.
- [ ] Removing all producer code leaves the TUI, retained items/history, and self-contained handoffs functional.
- [ ] Repeated identical submissions create one item; conflicting content requires explicit revision-checked update.
- [ ] Concurrent updates cannot overwrite unseen revisions or user state.
- [ ] Producer updates cannot archive, declare delivery, modify user attention state, or reopen history.
- [ ] Missing originals do not destroy retained handoff context; supporting artifacts remain references.

### Lifecycle and interfaces

- [ ] Reading an informational item keeps it Active; Acknowledge archives it with the correct reason.
- [ ] Reading an actionable item does not launch or archive it. Dismissal is recorded separately from delivery.
- [ ] Read/unread, snooze, placement, and delivery remain independent. Snooze expires without a background scheduler.
- [ ] The TUI works outside Herdr and while Herdr/Claude are unavailable.
- [ ] Both profiles appear in one view with correct labels/filters; all clients use one store.
- [ ] UI refresh preserves selection and never performs producer analysis.
- [ ] Embedded actions use the same commands, records, errors, and lifecycle. Removing the mod changes none of them.
- [ ] A count indicator cannot start a model turn, launch work, repeatedly interrupt, or noticeably delay startup.

### Handoff correctness

- [ ] Concurrent open actions from multiple processes create one blocking attempt and at most one automatic launch/submission path.
- [ ] A real native Windows smoke test launches the selected personal/work configuration in the exact requested directory, including paths with spaces and Unicode.
- [ ] Herdr successful startup, successful prompt submission, or idle status alone never archives an item.
- [ ] A valid bound opening acknowledgment plus settled state and focus archives atomically, preserving packet/revision/session references.
- [ ] The opening turn gives orientation and waits; it does not execute producer proposals.
- [ ] Wrong-attempt, wrong-session, wrong-profile/configuration, wrong-directory, wrong-packet, wrong-revision, subagent, and late receipts cannot produce delivery.
- [ ] Replacing the target occupant or switching its native conversation between inspection and submission cannot inject producer context into an unrelated session. Validate both the Herdr target mechanism and the in-session guard.
- [ ] A context-read failure, API error, interrupt, missing acknowledgment, trust dialog, focus failure, or unavailable executable leaves the item available for recovery.
- [ ] Retrying a valid receipt with failed focus does not resend the instruction.
- [ ] Closing a delivered session changes availability only; it does not resurrect the item.

### Crash and storage recovery

- [ ] Fault injection around layout creation, agent start, prompt dispatch, receipt persistence, focus, and final commit produces no false delivery or blind replay.
- [ ] A lost prompt response becomes uncertain; duplicate clicks do not create another session.
- [ ] Expired worker leases cannot allow a stale worker to commit against a replacement attempt.
- [ ] TUI exit, worker crash, endpoint reconnect, server restart, and reused pane IDs reconcile without assuming old identity.
- [ ] Database busy/full and backup/restore scenarios preserve committed snapshots, attempts, and events.
- [ ] Event polling is cursor-based, ordered, replayable, and contains no domain-completion implication.

Use focused automated tests for state/concurrency, adapter fixtures, receipt parsing/identity, and fault boundaries. Add real native Windows end-to-end tests for the supported launch routes and both profiles; mocks alone cannot establish Herdr/Claude interoperability. Record tested versions. Do not add broad domain-producer tests to the generic inbox.

## 16. Phased implementation

| Phase | Deliverable | Exit condition |
| --- | --- | --- |
| 0 — Preflight | Workspace/version/profile findings and chosen native launch strategy. | Required capability gaps explicit; no guessed profile/target behavior. |
| 1 — Core foundation | SQLite migrations, snapshots, versioned CLI, lifecycle, idempotency, event polling, diagnostics. | Core/concurrency tests pass; informational workflow usable from CLI. |
| 2 — First usable release | Terminal UI, finite handoff worker, Herdr adapter, small Claude receipt bridge, safe recovery and focus. | End-to-end fresh-session handoff passes on native Windows for both configured profiles. This is the terminal MVP. |
| 3 — Embedded release | Claude UI mod with embedded list/details/actions and optional passive indicator. | Same contract tests and cross-interface concurrency behavior; standalone remains independent. |

Do not make a domain producer part of core acceptance. An initial producer can be integrated separately using only the submission/events contract. Exact session resumption, additional agents, remote execution, webhooks, permanent services, cloud sync, and richer prioritization are deferred until an observed need justifies them.

## 17. Remaining questions and implementation gates

No further product choice is required to start the preflight. These details remain unverified:

| Open detail | Resolution owner | Gate/fallback |
| --- | --- | --- |
| Existing repository, implementation language, packaging, TUI library | Local agent inspection | Follow existing conventions; avoid installing a parallel stack without reason. |
| Actual profile aliases/wrappers and whether they support explicit session/bridge arguments | Local agent inspection; user only if behavior cannot be determined | Block that profile until adapted; never use another account. |
| Installed Herdr CLI/server schema and safe target behavior | Local preflight and dedicated validation | Launching stays disabled if identity-safe supported primitives are unavailable. |
| Exact per-session bridge mechanism and additive hook loading | Local Claude version inspection | Keep the small bridge separate from the optional UI mod; missing required receipt behavior blocks automatic delivery. |
| Windows paths, inbox data directory, Herdr endpoint/workspace labels | Local configuration | Defaults above; record explicit resolved values. |
| Expected account verification supported by current launchers | Local inspection; optional user-supplied account label | Distinguish selected config from authenticated account identity; report what was actually verified. |
| SQLite engine/fix level | Chosen runtime inspection | Fixed WAL or documented rollback journal; no unsafe silent default. |
| Installed mod API/policy | Phase 3 local inspection | Terminal MVP remains usable; report unavailable embedded features explicitly. |

Future exact-session resumption and retention management are deferred features, not unspecified MVP behavior. If a mandatory capability cannot be met, report the precise limitation rather than weakening the definition of delivered.

## 18. Official references

Reviewed 2026-10-22. These are capability references, not guarantees about installed versions. The local agent should consult the installed CLI schema/help and generated mod declarations when they differ.

- **[R1]** Herdr agent automation: <https://herdr.dev/docs/agent-automation/>
- **[R2]** Herdr CLI reference: <https://herdr.dev/docs/cli-reference/>
- **[R3]** Herdr native Windows support: <https://herdr.dev/docs/windows-beta/>
- **[R4]** Herdr socket API, schema, named-pipe transport, snapshots, and events: <https://herdr.dev/docs/socket-api/>
- **[R5]** Claude Code hooks reference: <https://code.claude.com/docs/en/hooks>
- **[R6]** Claude Code CLI reference: <https://code.claude.com/docs/en/cli-reference>
- **[R7]** Herdr session state and restore: <https://herdr.dev/docs/session-state/>
- **[R8]** SQLite WAL/concurrency and WAL-reset fix: <https://www.sqlite.org/wal.html>; busy handling and other pragmas: <https://www.sqlite.org/pragma.html>
- **[R9]** Claude Code environment variables, including `CLAUDE_CONFIG_DIR`: <https://code.claude.com/docs/en/env-vars>
- **[R10]** Claude Code mods overview and process/UI API: <https://code.claude.com/docs/en/plugins/mods>; <https://code.claude.com/docs/en/plugins/mods/api>
- **[R11]** Claude Code mod reference and installed-version declarations: <https://code.claude.com/docs/en/plugins/mods/reference>; <https://code.claude.com/docs/en/plugins/mods/create>
