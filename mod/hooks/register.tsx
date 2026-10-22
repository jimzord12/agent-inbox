import type { EngineInterface, Register } from 'claude-code'

import type { InboxError, InboxFilters, InboxList, InboxView } from '../types'
import { inertDeep, rowLine, toRow } from './text'

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

const NO_FILTERS: InboxFilters = { profile: 'all', producer: 'all', kind: 'all', unread: 'all' }
const EMPTY: InboxList = { asked: '', rows: [], hasMore: false, refreshedAt: 0, error: null }
const VIEWS: { id: InboxView; label: string; hotkey: string }[] = [
  { id: 'active', label: 'Active', hotkey: 'a' },
  { id: 'snoozed', label: 'Snoozed', hotkey: 's' },
  { id: 'history', label: 'History', hotkey: 'h' },
]

type Envelope = { ok: true; data: unknown } | { ok: false; error: InboxError }

// The CLI of this checkout, beside the mod folder. Its answer is made inert before anything
// else reads it: producer strings reach the pane only through here.
async function cli($: EngineInterface, args: string[]): Promise<Envelope> {
  const main = `${$.plugin.root}/../src/cli/main.ts`
  let ran
  try {
    ran = await $.process.run(['bun', main, ...args, '--json'], { timeoutMs: CLI_TIMEOUT_MS })
  } catch (err) {
    return { ok: false, error: { code: 'MOD_CLI_FAILED', message: `The agent-inbox CLI did not run: ${String((err as Error)?.message ?? err)}` } }
  }
  try {
    const parsed = inertDeep(JSON.parse(ran.stdout)) as { ok: boolean; data?: unknown; error?: InboxError }
    if (parsed.ok) return { ok: true, data: parsed.data }
    return { ok: false, error: { code: String(parsed.error?.code ?? 'UNKNOWN'), message: String(parsed.error?.message ?? '') } }
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
// an answer for a view or filter the person has since left is dropped.
let isBusy = false
let isAsked = false
// The view and filters last chosen, and a count bumped by every change. Fetches cannot rely on
// re-reading `$.state`: every get of one dispatch reads the moment it began, so a change made
// meanwhile would not show. After a reload (module variables start over) state is read instead.
let choiceGen = 0
let chosen: { view: InboxView; filters: InboxFilters } | null = null

async function currentChoice($: EngineInterface) {
  if (chosen) return chosen
  const { value: view = 'active' } = await $.state.get(VIEW)
  const { value: filters = NO_FILTERS } = await $.state.get(FILTERS)
  return { view, filters }
}

async function choose($: EngineInterface, choice: { view: InboxView; filters: InboxFilters }) {
  choiceGen++
  chosen = choice
  await $.state.set(VIEW, choice.view)
  await $.state.set(FILTERS, choice.filters)
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
      await fetchList($)
    } while (isAsked)
  } finally {
    isBusy = false
  }
}

// Anything unexpected (an answer of another shape, a refused engine call) is shown in the pane
// like a CLI error, never left as a pane stuck on "Loading…".
async function fetchList($: EngineInterface) {
  try {
    await fetchListOnce($)
  } catch (err) {
    const error = { code: 'MOD_ERROR', message: inertDeep(String((err as Error)?.message ?? err)) }
    const { view, filters } = await currentChoice($)
    const asked = askedKey(view, filters)
    const { value: prev = EMPTY } = await $.state.get(LIST)
    await $.state.set(LIST, prev.asked === asked ? { ...prev, error } : { ...EMPTY, asked, error })
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
    // Refreshes only while the pane is on screen; the CLI call is the cheap list query.
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
          <Button key={`row:${row.id}`} plain onPress={() => void $.state.set(SELECTED, row.id)}>
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
