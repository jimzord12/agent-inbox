export type InboxView = 'active' | 'snoozed' | 'history'

export type InboxAttemptStatus = 'in_progress' | 'blocked' | 'uncertain' | 'failed' | 'succeeded'

export type InboxLatestAttempt = {
  attempt_id: string
  status: InboxAttemptStatus
  phase: string
  error_code: string | null
}

// The fields of a CLI item view a list row needs.
export type InboxRow = {
  id: string
  producer_id: string
  kind: 'informational' | 'actionable'
  title: string
  profile_id: string
  created_at: string
  read: boolean
  snoozed_until: string | null
  archive_reason: string | null
  latest_attempt: InboxLatestAttempt | null
}

// Each filter holds a value, or 'all'.
export type InboxFilters = {
  profile: string
  producer: string
  kind: 'all' | 'actionable' | 'informational'
  unread: 'all' | 'unread'
}

export type InboxError = { code: string; message: string }

// What the last list call answered, and the call it answered (its CLI arguments joined): rows are
// drawn only while that matches the view and filters on screen.
export type InboxList = {
  asked: string
  rows: InboxRow[]
  hasMore: boolean
  refreshedAt: number
  error: InboxError | null
}

export type InboxAvailability = 'live' | 'closed' | 'unknown' | 'unavailable' | null

// One prior attempt, as `get` summarises it (spec §8 attempt summary).
export type InboxAttemptSummary = {
  attempt_id: string
  status: InboxAttemptStatus
  phase: string
  error_code: string | null
  profile_id: string
  session_uuid: string
  availability: InboxAvailability
  created_at: string
  delivered_at: string | null
}

// The newest attempt in full (`attempt get`): its progress and evidence.
export type InboxAttempt = {
  id: string
  status: InboxAttemptStatus
  phase: string
  profile_id: string
  cwd: string
  session_uuid: string
  error: InboxError | null
  availability: InboxAvailability
  evidence: { bound: boolean; prompt_state: string; receipt_candidate: boolean; delivered: boolean; focused: boolean }
  next_actions: string[]
}

export type InboxContextRef = { uri: string; label?: string; sha256?: string }

// An item's details (`get --include-context`); the handoff text keeps its line breaks.
export type InboxDetail = {
  id: string
  kind: 'informational' | 'actionable'
  title: string
  producer_id: string
  profile_id: string
  placement: InboxView
  read: boolean
  content_revision: number
  state_version: number
  snoozed_until: string | null
  archive_reason: string | null
  summary: string
  received_at: string
  launch: { cwd: string; initial_instruction: string } | null
  context_refs: InboxContextRef[]
  handoff: { sha256: string; bytes: number; source: string; captured_at: string } | null
  handoff_text: string | null
  attempts: InboxAttemptSummary[]
}

// What the last details call answered, for the item it was asked about.
export type InboxDetails = {
  asked: string
  item: InboxDetail | null
  attempt: InboxAttempt | null
  refreshedAt: number
  error: InboxError | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-inbox': {
      view: InboxView
      filters: InboxFilters
      list: InboxList
      // The item whose details are shown, or null for the list; and the handoff page shown.
      open: string | null
      details: InboxDetails
      page: number
      selected: string | null
      // Filter values seen so far, so a filter can be cycled through them.
      known: { profiles: string[]; producers: string[] }
    }
  }
}
