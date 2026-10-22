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

// The engine beneath the mod: a CLI answering `list` from `items()`, a pane that is shown.
function engine(on: On, items: () => unknown[], opts: { shown?: () => boolean; slowMs?: number; clock?: ReturnType<typeof mock.clock> } = {}) {
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
    const stdout = JSON.stringify({ api_version: 1, ok: true, data: { items: items(), next_cursor: null } })
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
  await ui.press({ key: 'row:itm_2' })
  const selected = async (id: string) => (await ui.find({ key: `row:${id}` }))?.children.some(c => (c as { props?: { inverse?: boolean } }).props?.inverse === true)
  expect(await selected('itm_2')).toBe(true)

  // A new item arrives first in the list; the selection stays on itm_2.
  items = [item('itm_0', 'Zero'), ...items]
  await clock.advance(2000)
  expect(cli.calls.length).toBe(2)
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
