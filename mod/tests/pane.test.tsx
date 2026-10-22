import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'agent-inbox',
  component: 'Pane',
  requestId: 'inbox',
  props: {
    title: 'Inbox',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-10-22T10:05:00.000Z')
// The person typing /inbox at the prompt.
const INBOX = { command: 'inbox', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

function item(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    producer_id: 'example.script',
    external_id: id,
    kind: 'actionable',
    title,
    profile_id: 'work',
    created_at: '2026-10-22T10:00:00.000Z',
    updated_at: '2026-10-22T10:00:00.000Z',
    content_revision: 1,
    state_version: 1,
    read: false,
    read_revision: null,
    placement: 'active',
    snoozed_until: null,
    archived_at: null,
    archive_reason: null,
    blocking_attempt_id: null,
    latest_attempt: null,
    ...extra,
  }
}

// The engine beneath the mod: a CLI answering `list` from `items()` (and any other command from
// `answer`, by its arguments), a pane that is shown.
function engine(
  on: On,
  items: () => unknown[],
  opts: { shown?: () => boolean; slowMs?: number; clock?: ReturnType<typeof mock.clock>; answer?: (args: string[]) => unknown } = {},
) {
  const calls: string[][] = []
  let running = 0
  let most = 0
  on('command.register', () => ({ value: { command: 'inbox' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'inbox', title: 'Inbox', isShown: opts.shown?.() ?? true, isFocused: true, isPlaced: true }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', async (_, e) => {
    calls.push([...e.argv.slice(2)])
    running++
    most = Math.max(most, running)
    if (opts.slowMs && opts.clock) await opts.clock.sleep(opts.slowMs)
    running--
    const args = [...e.argv.slice(2)]
    const data = args[0] === 'list' ? { items: items(), next_cursor: null } : opts.answer?.(args)
    const stdout = JSON.stringify({ api_version: 1, ok: true, data })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { calls, most: () => most }
}

test('/inbox opens the pane through the CLI list alone and draws inert rows', async ($, on) => {
  mock.clock(on, { now: NOW })
  const cli = engine(on, () => [item('itm_1', 'Plan \u001b[31mred\u001b[0m\u0007 ready')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(INBOX)

  // The list call is the one that reconciles; nothing opens, retries or focuses.
  expect(cli.calls).toEqual([['list', '--view', 'active', '--limit', '200', '--json']])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const row = await ui.find({ key: 'row:itm_1' })
    expect(row?.text).toContain('Plan red ready')
    expect(row?.text).not.toMatch(/[\u0000-\u001f]/)
    await ui.unmount()
  }
})

test('views and filters go to the CLI as its own flags', async ($, on) => {
  mock.clock(on, { now: NOW })
  const cli = engine(on, () => [item('itm_1', 'One')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(INBOX)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  await ui.press({ key: 'filter:profile' })
  await ui.press({ key: 'filter:kind' })
  await ui.press({ key: 'filter:unread' })
  expect(cli.calls.at(-1)).toEqual(['list', '--view', 'history', '--limit', '200', '--profile', 'work', '--kind', 'actionable', '--unread', '--json'])
  expect((await ui.find({ key: 'filter:profile' }))?.text).toContain('profile: work')
  await ui.unmount()
})

test('a refresh every 2 s keeps the selection on the same item', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let items = [item('itm_1', 'One'), item('itm_2', 'Two')]
  const cli = engine(on, () => items)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(INBOX)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Enter on a row opens its details; Back returns to the list with that row selected.
  await ui.press({ key: 'row:itm_2' })
  await ui.press({ key: 'back' })
  const selected = async (id: string) => (await ui.find({ key: `row:${id}` }))?.text.startsWith('›')
  expect(await selected('itm_2')).toBe(true)

  // A new item arrives first in the list; the selection stays on itm_2.
  items = [item('itm_0', 'Zero'), ...items]
  const before = cli.calls.length
  await clock.advance(2000)
  expect(cli.calls.length).toBe(before + 1)
  expect(await ui.find({ key: 'row:itm_0' })).toBeDefined()
  expect(await selected('itm_2')).toBe(true)
  expect(await selected('itm_0')).toBe(false)
  await ui.unmount()
})

test('a slow CLI never gets a second call while one runs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const cli = engine(on, () => [item('itm_1', 'One')], { slowMs: 5000, clock })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  void $.command.run(INBOX)
  for (let i = 0; i < 6; i++) await clock.advance(2000)
  expect(cli.most()).toBe(1)
  // Ticks during a call fold into one more run after it, never a queue of them.
  expect(cli.calls.length).toBeLessThanOrEqual(4)
})

test('an answer for a view the person has left is dropped, and its rows never show under the new one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const cli = engine(on, () => [item('itm_1', 'Active one')], { slowMs: 1000, clock })
  // Every list the mod stores, by the call it answered.
  const asked: string[] = []
  on('state.set', (_, e, next) => {
    if (e.plugin === 'agent-inbox' && e.key === 'list') asked.push((e.value as { asked: string }).asked)
    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  void $.command.run(INBOX)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Mid-call, the person switches to History.
  void ui.press({ key: 'view:history' })
  await clock.settle()
  expect(await ui.find({ key: 'row:itm_1' })).toBeUndefined()
  await clock.advance(1000)
  // The Active answer landed but was dropped; the History call follows, and until it answers
  // the pane says it is loading rather than showing Active rows.
  expect(cli.calls.map(c => c[2])).toEqual(['active', 'history'])
  expect(asked.some(a => a.includes('active'))).toBe(false)
  expect(await ui.find({ key: 'row:itm_1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Loading/ })).toBeDefined()
  await clock.advance(1000)
  expect((await ui.find({ key: 'row:itm_1' }))?.text).toContain('Active one')
  await ui.unmount()
})

test('an answer of an unexpected shape is shown in the pane, not left loading', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'inbox' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify({ api_version: 1, ok: true, data: {} }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(INBOX)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /MOD_ERROR/ }))?.text).toContain('MOD_ERROR: ')
  await ui.unmount()
})

test('nothing is called while the pane is not on screen', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let shown = false
  const cli = engine(on, () => [], { shown: () => shown })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(6000)
  expect(cli.calls).toEqual([])
  shown = true
  await clock.advance(2000)
  expect(cli.calls.length).toBe(1)
})

test('a CLI error is shown with its code and message', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'inbox' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: {
      exitCode: 1,
      stdout: JSON.stringify({ api_version: 1, ok: false, error: { code: 'STORE_BUSY', message: 'The inbox is busy.\u001b[2J', retryable: true } }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(INBOX)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /STORE_BUSY/ }))?.text).toBe('STORE_BUSY: The inbox is busy.')
  await ui.unmount()
})

// --- Details (INB-013) ---

function detail(id: string, handoffText: string | null, attempts: unknown[] = []) {
  return {
    ...item(id, 'Review the plan'),
    revision: {
      number: 1,
      received_at: '2026-10-22T10:00:00.000Z',
      content_sha256: 'a'.repeat(64),
      payload: {
        summary: 'Two lines\nof summary.',
        context_refs: [{ uri: 'file:///C:/work/plan.md', label: 'Plan', sha256: 'b'.repeat(64) }],
        launch: { agent: 'claude-code', cwd: 'C:\\work\\fixture dir é', initial_instruction: 'Read the handoff, then wait.' },
      },
      handoff: handoffText === null ? null : { sha256: 'c'.repeat(64), bytes: handoffText.length, source: 'C:\\work\\handoff.md', captured_at: '2026-10-22T10:00:00.000Z' },
      handoff_text: handoffText ?? undefined,
    },
    attempts,
  }
}

const BLOCKED = {
  id: 'att_1',
  status: 'blocked',
  phase: 'start_agent',
  profile_id: 'work',
  cwd: 'C:\\work\\fixture dir é',
  session_uuid: '11111111-1111-4111-8111-111111111111',
  error: { code: 'AGENT_BLOCKED', message: 'A dialog holds the start.' },
  availability: null,
  evidence: { bound: false, prompt_state: 'none', receipt_candidate: false, delivered: false, focused: false, last_rejection: null },
  next_actions: ['view', 'focus', 'retry', 'abandon'],
}
const SUMMARY = { attempt_id: 'att_1', content_revision: 1, status: 'blocked', phase: 'start_agent', error_code: 'AGENT_BLOCKED', profile_id: 'work', session_uuid: BLOCKED.session_uuid, availability: null, created_at: '2026-10-22T10:01:00.000Z', delivered_at: null }

test('Enter on a row opens details through get and attempt get alone, with the attempt progress', async ($, on) => {
  mock.clock(on, { now: NOW })
  const cli = engine(on, () => [item('itm_1', 'Review the plan')], {
    answer: args => (args[0] === 'get' ? { item: detail('itm_1', '# Plan\nStep one.\n', [SUMMARY]) } : { attempt: BLOCKED }),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(INBOX)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row:itm_1' })
  // Reads only: nothing opens, retries or focuses a session.
  expect(cli.calls.slice(1)).toEqual([
    ['get', 'itm_1', '--include-context', '--json'],
    ['attempt', 'get', 'att_1', '--json'],
  ])
  for (const text of ['Review the plan', 'Folder: C:\\work\\fixture dir é', 'Instruction: Read the handoff, then wait.', 'Reference: Plan — file:///C:/work/plan.md', 'Opening: Waiting on you', 'Handoff snapshot: captured 2026-10-22 10:00 UTC']) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  expect((await ui.find({ key: 'handoff' }))?.text).toBe('# Plan\nStep one.\n')
  // The open item refreshes on the tick too, still by reads alone.
  await ui.unmount()
})

test('a 256 KiB handoff pages from start to end with no lost lines, escapes made inert', async ($, on) => {
  mock.clock(on, { now: NOW })
  let text = ''
  for (let i = 0; text.length < 256 * 1024; i++) text += i % 50 === 0 ? `${'w'.repeat(3000)} \u001b[31mred\u001b[0m\n` : `line ${i}: a step of the plan\n`
  engine(on, () => [item('itm_1', 'Big')], { answer: args => (args[0] === 'get' ? { item: detail('itm_1', text) } : undefined) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(INBOX)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row:itm_1' })
  const pages: string[] = []
  for (let guard = 0; guard < 2000; guard++) {
    pages.push((await ui.find({ key: 'handoff' }))!.text)
    const where = (await ui.find({ type: 'Text', text: /^Page \d+ of \d+/ }))!.text
    const [, at, of] = /^Page (\d+) of (\d+)/.exec(where)!
    if (at === of) break
    await ui.press({ key: 'page:next' })
  }
  // Pages join with a line break, except where a long line was cut into pieces across pages.
  const joined = pages.join('\n')
  const expected = text.replaceAll('\u001b[31m', '').replaceAll('\u001b[0m', '')
  expect(joined.replaceAll('\n', '')).toBe(expected.replaceAll('\n', ''))
  expect(joined.split('\n').filter(l => l.startsWith('line ')).length).toBe(expected.split('\n').filter(l => l.startsWith('line ')).length)
  expect(pages.length).toBeGreaterThan(50)
  // Back to the first page and no further.
  await ui.press({ key: 'page:prev' })
  expect((await ui.find({ type: 'Text', text: /^Page / }))?.text).toMatch(new RegExp(`^Page ${pages.length - 1} of ${pages.length}`))
  await ui.unmount()
})

test('Back returns to the list, and an item that cannot be read shows its error', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'inbox' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    const list = e.argv[2] === 'list'
    const body = list
      ? { api_version: 1, ok: true, data: { items: [item('itm_1', 'Gone soon')], next_cursor: null } }
      : { api_version: 1, ok: false, error: { code: 'NOT_FOUND', message: 'No such item.', retryable: false } }
    return { value: { exitCode: list ? 0 : 1, stdout: JSON.stringify(body), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(INBOX)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row:itm_1' })
  expect((await ui.find({ type: 'Text', text: /NOT_FOUND/ }))?.text).toBe('NOT_FOUND: No such item.')
  await ui.press({ key: 'back' })
  expect((await ui.find({ key: 'row:itm_1' }))?.text).toContain('Gone soon')
  await ui.unmount()
})
