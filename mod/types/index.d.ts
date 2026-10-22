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

// What the last list call answered, for the view and filters it was asked with.
export type InboxList = {
  rows: InboxRow[]
  hasMore: boolean
  refreshedAt: number
  error: InboxError | null
}

declare module 'claude-code' {
  interface PluginState {
    'agent-inbox': {
      view: InboxView
      filters: InboxFilters
      list: InboxList
      selected: string | null
      // Filter values seen so far, so a filter can be cycled through them.
      known: { profiles: string[]; producers: string[] }
    }
  }
}
