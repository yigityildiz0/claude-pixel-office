// Claude Ofis: the values the pane draws from, held in $.state for the session.

/** What a worker is doing right now; picks its animation. */
export type Activity =
  | 'idle'
  | 'thinking'
  | 'answering'
  | 'reading'
  | 'writing'
  | 'running'
  | 'web'
  | 'planning'
  | 'delegating'
  | 'waiting'
  | 'compacting'
  | 'done'
  | 'failed'
  | 'leaving'

/** The shape of a thought, read off the thinking text. */
export type ThinkKind = 'plan' | 'debug' | 'research' | 'design' | 'decide' | 'code' | 'math' | 'general'

/** Which site a web step is on, for its badge. */
export type SiteKind =
  | 'youtube'
  | 'reddit'
  | 'x'
  | 'wiki'
  | 'github'
  | 'stack'
  | 'google'
  | 'docs'
  | 'paper'
  | 'claude'
  | 'web'

/** The boss (id 'boss') or one subagent at a desk. */
export type Worker = {
  id: string
  /** Hire order: picks the name and the color. */
  n: number
  name: string
  role: string
  task: string
  color: string
  seat: number
  activity: Activity
  think?: ThinkKind
  site?: SiteKind
  bubble: string
  detail: string
  tool?: string
  tools: number
  tokensOut: number
  since: number
  joinedAt: number
  endedAt?: number
  summary?: string
}

export type FeedKind =
  | 'prompt'
  | 'think'
  | 'read'
  | 'write'
  | 'run'
  | 'web'
  | 'plan'
  | 'hire'
  | 'done'
  | 'fail'
  | 'compact'
  | 'limit'
  | 'turn'
  | 'wait'

export type FeedItem = { t: number; who: string; color: string; kind: FeedKind; text: string }

export type LimitReading = { kind: string; pct: number; resetsAt?: string }

export type Usage = {
  ctxPct?: number
  ctxTokens?: number
  ctxWindow: number
  limits: LimitReading[]
  usd?: number
  at: number
  /** the context % at each change, the latest last, for the sparkline */
  history?: number[]
}

export type Turn = {
  active: boolean
  model?: string
  effort?: string
  startedAt?: number
  lastEndedAt?: number
  steps: number
  turns: number
  prompt?: string
}

export type BreakdownRow = { name: string; tokens: number; color: string; kind: string }
export type BreakdownItem = { name: string; tokens: number; note?: string }

export type Breakdown = {
  at: number
  total: number
  max: number
  pct: number
  model: string
  autocompact?: number
  categories: BreakdownRow[]
  memory: BreakdownItem[]
  mcp: BreakdownItem[]
  skills: BreakdownItem[]
  agents: BreakdownItem[]
}

export type Tab = 'ofis' | 'ekip' | 'akis' | 'baglam'

export type UiPrefs = { tab: Tab; motion: boolean; compact: boolean }

export type Stats = {
  tools: Record<string, number>
  hired: number
  outTokens: number
  inTokens: number
  cacheRead: number
  sessionStart: number
}

declare module 'claude-code' {
  interface PluginState {
    'piksel-ofis': {
      workers: Shaped<Worker[]>
      feed: Shaped<FeedItem[]>
      usage: Shaped<Usage>
      turn: Shaped<Turn>
      breakdown: Shaped<Breakdown | null>
      prefs: Shaped<UiPrefs>
      stats: Shaped<Stats>
      auto: Shaped<{ isOn: boolean; at: number }>
      theme: Shaped<'dark' | 'light'>
    }
  }
}
