import type { EngineInterface, Register } from 'claude-code'

import type { InboxAttempt, InboxDetails, InboxError, InboxFilters, InboxList, InboxView } from '../types'
import { type RawDetail, attemptLine, availabilityText, inertDeep, lineCount, oneLine, paginate, progress, rowLine, size, toAttempt, toDetail, toRow, when } from './text'

// The /inbox pane (spec §12.2). Everything it knows comes from the agent-inbox JSON CLI, called by
// argv; it keeps no database, makes no state transition and launches nothing of its own.

const PANE = 'inbox'
const REFRESH_MS = 2000
const CLI_TIMEOUT_MS = 15000
const PAGE = '200'

const VIEW = { plugin: 'agent-inbox', key: 'view' } as const
const FILTERS = { plugin: 'agent-inbox', key: 'filters' } as const
const LIST = { plugin: 'agent-inbox', key: 'list' } as const
const SELECTED = { plugin: 'agent-inbox', key: 'selected' } as const
const KNOWN = { plugin: 'agent-inbox', key: 'known' } as const
const OPEN = { plugin: 'agent-inbox', key: 'open' } as const
const DETAILS = { plugin: 'agent-inbox', key: 'details' } as const
const HANDOFF_PAGE = { plugin: 'agent-inbox', key: 'page' } as const

const NO_FILTERS: InboxFilters = { profile: 'all', producer: 'all', kind: 'all', unread: 'all' }
const EMPTY: InboxList = { asked: '', rows: [], hasMore: false, refreshedAt: 0, error: null }
const NO_DETAILS: InboxDetails = { asked: '', item: null, attempt: null, refreshedAt: 0, error: null }
const VIEWS: { id: InboxView; label: string; hotkey: string }[] = [
  { id: 'active', label: 'Active', hotkey: 'a' },
  { id: 'snoozed', label: 'Snoozed', hotkey: 's' },
  { id: 'history', label: 'History', hotkey: 'h' },
]
const TONE = { progress: 'suggestion', attention: 'warning', error: 'error', done: 'success' } as const

type Envelope = { ok: true; data: unknown } | { ok: false; error: InboxError }

// The CLI of this checkout, beside the mod folder. Its answer is made inert before anything
// else reads it: producer strings reach the pane only through here. Line breaks are kept (a
// handoff, a summary); fields drawn on one line drop them where they are drawn.
async function cli($: EngineInterface, args: string[]): Promise<Envelope> {
  const main = `${$.plugin.root}/../src/cli/main.ts`
  let ran
  try {
    ran = await $.process.run(['bun', main, ...args, '--json'], { timeoutMs: CLI_TIMEOUT_MS })
  } catch (err) {
    return { ok: false, error: { code: 'MOD_CLI_FAILED', message: `The agent-inbox CLI did not run: ${String((err as Error)?.message ?? err)}` } }
  }
  try {
    const parsed = inertDeep(JSON.parse(ran.stdout), { multiline: true }) as { ok: boolean; data?: unknown; error?: InboxError }
    if (parsed.ok) return { ok: true, data: parsed.data }
    return { ok: false, error: { code: String(parsed.error?.code ?? 'UNKNOWN'), message: oneLine(String(parsed.error?.message ?? '')) } }
  } catch {
    const first = inertDeep(ran.stderr.split('\n')[0] ?? '')
    return { ok: false, error: { code: 'MOD_CLI_FAILED', message: `The agent-inbox CLI answered no JSON (exit ${ran.exitCode}). ${first}`.trim() } }
  }
}

const askedKey = (view: InboxView, f: InboxFilters) => listArgs(view, f).join('\u0000')

function listArgs(view: InboxView, f: InboxFilters): string[] {
  const args = ['list', '--view', view, '--limit', PAGE]
  if (f.profile !== 'all') args.push('--profile', f.profile)
  if (f.producer !== 'all') args.push('--producer', f.producer)
  if (f.kind !== 'all') args.push('--kind', f.kind)
  if (f.unread === 'unread') args.push('--unread')
  return args
}

// One call at a time: a refresh asked while one runs is folded into one more run after it, and
// an answer for a view, filter or item the person has since left is dropped.
let isBusy = false
let isAsked = false
// What the person last chose (view, filters, the item whose details are open), and a count bumped
// by every change. Fetches cannot rely on re-reading `$.state`: every get of one dispatch reads the
// moment it began, so a change made meanwhile would not show. After a reload (module variables
// start over) state is read instead.
type Choice = { view: InboxView; filters: InboxFilters; open: string | null }
let choiceGen = 0
let chosen: Choice | null = null

async function currentChoice($: EngineInterface): Promise<Choice> {
  if (chosen) return chosen
  const { value: view = 'active' } = await $.state.get(VIEW)
  const { value: filters = NO_FILTERS } = await $.state.get(FILTERS)
  const { value: open = null } = await $.state.get(OPEN)
  return { view, filters, open }
}

async function choose($: EngineInterface, choice: Choice) {
  choiceGen++
  chosen = choice
  await $.state.set(VIEW, choice.view)
  await $.state.set(FILTERS, choice.filters)
  await $.state.set(OPEN, choice.open)
}

async function refresh($: EngineInterface) {
  if (isBusy) {
    isAsked = true
    return
  }
  isBusy = true
  try {
    do {
      isAsked = false
      const { open } = await currentChoice($)
      await (open ? fetchDetails($, open) : fetchList($))
    } while (isAsked)
  } finally {
    isBusy = false
  }
}

// Anything unexpected (an answer of another shape, a refused engine call) is shown in the pane
// like a CLI error, never left as a pane stuck on "Loading…".
function unexpected(err: unknown): InboxError {
  return { code: 'MOD_ERROR', message: oneLine(inertDeep(String((err as Error)?.message ?? err))) }
}

async function fetchList($: EngineInterface) {
  try {
    await fetchListOnce($)
  } catch (err) {
    const { view, filters } = await currentChoice($)
    const asked = askedKey(view, filters)
    const { value: prev = EMPTY } = await $.state.get(LIST)
    await $.state.set(LIST, prev.asked === asked ? { ...prev, error: unexpected(err) } : { ...EMPTY, asked, error: unexpected(err) })
  }
}

async function fetchListOnce($: EngineInterface) {
  const { view, filters } = await currentChoice($)
  const asked = askedKey(view, filters)
  const gen = choiceGen
  const res = await cli($, listArgs(view, filters))
  const now = await $.clock.now()
  // The person moved to another view or filter meanwhile: that call is already asked for.
  if (choiceGen !== gen) return
  const { value: prev = EMPTY } = await $.state.get(LIST)
  if (!res.ok) {
    // Last known rows stay only if they are this view's.
    await $.state.set(LIST, prev.asked === asked ? { ...prev, error: res.error } : { ...EMPTY, asked, error: res.error })
    return
  }
  const data = res.data as { items: Parameters<typeof toRow>[0][]; next_cursor: string | null }
  const rows = data.items.map(toRow)
  await $.state.set(LIST, { asked, rows, hasMore: data.next_cursor !== null, refreshedAt: now, error: null })
  const { value: known = { profiles: [], producers: [] } } = await $.state.get(KNOWN)
  const profiles = [...new Set([...known.profiles, ...rows.map(r => r.profile_id)])].sort()
  const producers = [...new Set([...known.producers, ...rows.map(r => r.producer_id)])].sort()
  if (profiles.length !== known.profiles.length || producers.length !== known.producers.length) {
    await $.state.set(KNOWN, { profiles, producers })
  }
}

// The open item's details, then its newest attempt in full for progress and evidence. Both are
// CLI reads, which reconcile unfinished attempts first and launch nothing.
async function fetchDetails($: EngineInterface, id: string) {
  try {
    await fetchDetailsOnce($, id)
  } catch (err) {
    const { value: prev = NO_DETAILS } = await $.state.get(DETAILS)
    await $.state.set(DETAILS, prev.asked === id ? { ...prev, error: unexpected(err) } : { ...NO_DETAILS, asked: id, error: unexpected(err) })
  }
}

async function fetchDetailsOnce($: EngineInterface, id: string) {
  const gen = choiceGen
  const got = await cli($, ['get', id, '--include-context'])
  let attempt: InboxAttempt | null = null
  let error: InboxError | null = got.ok ? null : got.error
  const item = got.ok ? toDetail((got.data as { item: RawDetail }).item) : null
  const newest = item?.attempts[0]
  if (newest) {
    const one = await cli($, ['attempt', 'get', newest.attempt_id])
    if (one.ok) attempt = toAttempt((one.data as { attempt: InboxAttempt }).attempt)
    else error = one.error
  }
  const now = await $.clock.now()
  if (choiceGen !== gen) return
  const { value: prev = NO_DETAILS } = await $.state.get(DETAILS)
  if (!item) {
    // A failed read keeps the last known details of this item, under the error.
    await $.state.set(DETAILS, prev.asked === id ? { ...prev, error } : { ...NO_DETAILS, asked: id, error })
    return
  }
  await $.state.set(DETAILS, { asked: id, item, attempt, refreshedAt: now, error })
}

async function isVisible($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isShown && p.isPlaced)
}

function next<T extends string>(values: readonly T[], current: T): T {
  const i = values.indexOf(current)
  return values[(i + 1) % values.length] ?? values[0]!
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'inbox', description: 'Show the agent inbox in a pane' })
    // Refreshes only while the pane is on screen; the CLI call is the cheap list (or one item) query.
    $.clock.every(REFRESH_MS, () => {
      void isVisible($)
        .then(shown => (shown ? refresh($) : undefined))
        .catch(err => $.ui.log(`agent-inbox: refresh failed: ${String((err as Error)?.message ?? err)}`, { to: 'debug' }))
    })

    return next(e)
  })

  on('command.run', { command: 'inbox' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Inbox', focus: true })
    // The list call reconciles unfinished attempts as every CLI read does; it launches nothing.
    await refresh($)

    return { text: 'Inbox opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { value: view = 'active' } = await $.state.get(VIEW)
    const { value: filters = NO_FILTERS } = await $.state.get(FILTERS)
    const { value: open = null } = await $.state.get(OPEN)

    // Details (spec §12.1): Enter on a row opens them; they never open a session.
    if (open) {
      const { value: details = NO_DETAILS } = await $.state.get(DETAILS)
      const { value: pageAt = 0 } = await $.state.get(HANDOFF_PAGE)
      const back = async () => {
        const now = await currentChoice($)
        await choose($, { ...now, open: null })
        await refresh($)
      }
      const isCurrent = details.asked === open
      const item = isCurrent ? details.item : null
      const pages = item?.handoff_text != null ? paginate(item.handoff_text) : []
      const page = Math.min(Math.max(0, pageAt), Math.max(0, pages.length - 1))
      const shown = pages[page] ?? []
      const turn = (to: number) => () => void $.state.set(HANDOFF_PAGE, Math.min(Math.max(0, to), Math.max(0, pages.length - 1)))
      const attempt = isCurrent ? details.attempt : null
      const p = attempt ? progress(attempt) : null

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="back" label="Back" hotkey="b" onPress={back} />
            {pages.length > 1 && <Button key="page:prev" label="Prev page" hotkey="k" onPress={turn(page - 1)} />}
            {pages.length > 1 && <Button key="page:next" label="Next page" hotkey="j" onPress={turn(page + 1)} />}
          </Box>
          {isCurrent && details.error && (
            <Text color="error">
              {details.error.code}: {details.error.message}
            </Text>
          )}
          {!item && !(isCurrent && details.error) && <Text dimColor>Loading…</Text>}
          {item && (
            <Box flexDirection="column">
              <Text bold>{item.title}</Text>
              <Text dimColor>
                {item.kind} · {item.profile_id} · {oneLine(item.producer_id)} · {item.placement}
                {item.archive_reason ? ` (${item.archive_reason})` : ''}
                {item.snoozed_until ? ` until ${when(item.snoozed_until)}` : ''} · revision {item.content_revision} received {when(item.received_at)}
              </Text>
              <Text>{item.summary}</Text>
              {item.launch && <Text>Folder: {oneLine(item.launch.cwd)}</Text>}
              {item.launch && <Text>Instruction: {item.launch.initial_instruction}</Text>}
              {item.context_refs.map((r, i) => (
                <Text key={`ref:${i}`}>
                  Reference: {r.label ? `${oneLine(r.label)} — ` : ''}
                  {oneLine(r.uri)}
                  {r.sha256 ? ` (sha256 ${r.sha256.slice(0, 12)}…)` : ''}
                </Text>
              ))}
              {attempt && p && (
                <Box flexDirection="column">
                  <Text bold color={TONE[p.tone]}>
                    Opening: {p.label}
                  </Text>
                  {p.hint && <Text dimColor>{p.hint}</Text>}
                  <Text dimColor>
                    Handoff prompt: {attempt.evidence.prompt_state} · session {availabilityText(attempt.availability)} · profile {attempt.profile_id}
                  </Text>
                </Box>
              )}
              {item.attempts.length > 0 && <Text dimColor>Attempts, newest first:</Text>}
              {item.attempts.map(a => (
                <Text key={`attempt:${a.attempt_id}`} dimColor>
                  {'  '}
                  {attemptLine(a)}
                </Text>
              ))}
              {item.handoff ? (
                <Text dimColor>
                  Handoff snapshot: captured {when(item.handoff.captured_at)} · {size(item.handoff.bytes)} · sha256 {item.handoff.sha256.slice(0, 12)}… · from {oneLine(item.handoff.source)}
                </Text>
              ) : (
                <Text dimColor>No handoff document.</Text>
              )}
              {pages.length > 0 && (
                <Text dimColor>
                  Page {page + 1} of {pages.length} · lines {Math.min(shown[0]?.line ?? 0, lineCount(pages))}–{Math.min(shown.at(-1)?.line ?? 0, lineCount(pages))} of {lineCount(pages)}
                </Text>
              )}
              {shown.length > 0 && (
                <Box key="handoff">
                  <Text>{shown.map((s, i) => (i === 0 || s.joined ? s.text : `\n${s.text}`)).join('')}</Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )
    }

    const { value: list = EMPTY } = await $.state.get(LIST)
    const { value: selected = null } = await $.state.get(SELECTED)
    const { value: known = { profiles: [], producers: [] } } = await $.state.get(KNOWN)
    const columns = Math.max(20, e.props.bodyColumns)
    const nowMs = list.refreshedAt || (await $.clock.now())
    // Rows answered for another view or filter are never drawn under this one.
    const isCurrent = list.asked === askedKey(view, filters)
    const rows = isCurrent ? list.rows : []

    const setView = (id: InboxView) => async () => {
      const now = await currentChoice($)
      await choose($, { ...now, view: id })
      await refresh($)
    }
    const setFilter = (patch: Partial<InboxFilters>) => async () => {
      const now = await currentChoice($)
      await choose($, { ...now, filters: { ...now.filters, ...patch } })
      await refresh($)
    }
    const openRow = (id: string) => async () => {
      await $.state.set(SELECTED, id)
      await $.state.set(HANDOFF_PAGE, 0)
      const now = await currentChoice($)
      await choose($, { ...now, open: id })
      await refresh($)
    }
    const profiles = ['all', ...known.profiles.filter(p => p !== 'all')]
    if (!profiles.includes(filters.profile)) profiles.push(filters.profile)
    const producers = ['all', ...known.producers.filter(p => p !== 'all')]
    if (!producers.includes(filters.producer)) producers.push(filters.producer)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {VIEWS.map(v => (
            <Button key={`view:${v.id}`} label={v.label} hotkey={v.hotkey} variant={v.id === view ? 'primary' : undefined} onPress={setView(v.id)} />
          ))}
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refresh($)} />
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="filter:profile" label={`profile: ${filters.profile}`} hotkey="p" onPress={setFilter({ profile: next(profiles, filters.profile) })} />
          <Button key="filter:producer" label={`producer: ${filters.producer}`} hotkey="o" onPress={setFilter({ producer: next(producers, filters.producer) })} />
          <Button key="filter:kind" label={`kind: ${filters.kind}`} hotkey="k" onPress={setFilter({ kind: next(['all', 'actionable', 'informational'] as const, filters.kind) })} />
          <Button key="filter:unread" label={`unread: ${filters.unread === 'unread' ? 'only' : 'all'}`} hotkey="u" onPress={setFilter({ unread: filters.unread === 'all' ? 'unread' : 'all' })} />
        </Box>
        {isCurrent && list.error && (
          <Text color="error">
            {list.error.code}: {list.error.message}
          </Text>
        )}
        {!isCurrent && <Text dimColor>Loading…</Text>}
        {isCurrent && list.refreshedAt > 0 && list.rows.length === 0 && <Text dimColor>Nothing in {view}.</Text>}
        {rows.map(row => (
          <Button key={`row:${row.id}`} plain onPress={openRow(row.id)}>
            <Text bold={!row.read} wrap="truncate-end">
              {rowLine(row, view, nowMs, columns, row.id === selected)}
            </Text>
          </Button>
        ))}
        {isCurrent && list.hasMore && <Text dimColor>Only the first {PAGE} are shown; narrow the filters to see the rest.</Text>}
      </Box>
    )
  })
}
