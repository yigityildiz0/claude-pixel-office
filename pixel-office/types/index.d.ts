// Claude Office: values held in session state and drawn by the pane.

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
  /** Writing SendMessage. */
  | 'messaging'

/** Which mascot sits at a desk: the model family's character ('evren': an EVREN worker, whatever its model). */
export type MascotKind = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'claude' | 'sol' | 'terra' | 'luna' | 'astra' | 'argon' | 'flash' | 'evren' | 'other' | 'boss'

/** What a worker does for the team, read off its behaviour. */
export type Duty = 'builder' | 'critic' | 'evaluator' | 'explorer' | 'planner' | 'general'

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

/** What a desk's monitor shows: the real work, never a raw command or a full path. */
export type ScreenKind = 'file-read' | 'file-write' | 'search' | 'cmd' | 'site' | 'think' | 'plan' | 'msg' | 'answer' | 'wait' | 'ext' | 'tool'

/** One monitor reading: `label` is a file name, a command kind ("npm test"), a site, a query or a recipient. */
export type Screen = { kind: ScreenKind; label: string; site?: SiteKind; think?: ThinkKind; at: number }

/** A plan's progress: TodoWrite items completed out of all. */
export type Progress = { done: number; total: number }

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
  /** Resolved model id: spawn result.model > e.model > e.parentModel, then the agent's own turn.step model; outside workers use -m/--model. Absent means unknown. Boss uses the main-loop turn.step. */
  model?: string
  /** Latest step effort: low, medium, high, xhigh, max or numeric text. */
  effort?: string
  /** agent by default; external for codex/gemini/agy CLIs run through Bash or PowerShell. */
  kind?: 'agent' | 'external'
  /** Starting loop: boss or agent id (spawn parentAgentId); outside workers use the caller loop. */
  parentId?: string
  /** SendMessage addresses: event name, result teammateId, AgentInfo name/teammateId; id always matches too. */
  addr?: string[]
  /** Duty inferred from behavior through dutyFor(). */
  duty?: Duty
  /** Edit/Write/MultiEdit/NotebookEdit call count. */
  writes?: number
  /** Bash result backgroundTaskId for an outside worker running in the background. */
  taskId?: string
  /** Since the teammate started waiting for a message (idle status or TeammateIdle), or the worker finished its task. */
  idleSince?: number
  /** Platform: agy for the Antigravity badge; evren for the EVREN character, independent of model. */
  via?: 'agy' | 'evren'
  /** Current real work shown by the monitor. */
  screen?: Screen
  /** This worker's TodoWrite plan. */
  plan?: Progress
  /** Model guess from parent or workflow used to choose a mascot while unknown; never displayed as a label. */
  guess?: string
  /** How the model was learned: spawn, step, result, workflow, cli or config, for the tooltip. */
  modelFrom?: string
  /** Spawn subagentType or AgentInfo.type, for the title. */
  agentType?: string
  /** Unnumbered desk-card title, such as Developer or Detective; name is its numbered form. */
  title?: string
  /** New title seen once; it becomes current on its second occurrence to avoid flicker. */
  titleNext?: string
  /** 0.9 activity animation: displayed main activity, pending candidate and event. */
  act?: ActState
  /** Recent-tool trail: at most eight derived markers, newest last. */
  trail?: ActMark[]
}

/** Recent-tool trail: derived markers only; NEVER raw commands, paths or text. */
export type ActMark = { t: number; id?: string; f?: 1; d?: 1; s?: 'audit' | 'security' | 'refactor' | 'debug' | 'video' | 'ok' | 'done' }

/** Worker activity state using manifest names. */
export type ActState = {
  /** Displayed main activity, including variants. */
  id?: string
  /** When id started; refreshed only when id changes. */
  at: number
  /** Latest tool time confirming id, for the 60-second hold. */
  seen: number
  /** Candidate seen once, under the two-hit rule. */
  next?: string
  /** When the candidate was seen, so a recognized but unconfirmed long command is not treated as compilation. */
  nextAt?: number
  /** One-shot event. */
  ev?: { id: string; at: number; until: number }
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
  | 'talk'
  | 'ext'

export type FeedItem = {
  t: number
  who: string
  color: string
  kind: FeedKind
  text: string
  /** Owning Worker id, for the HUD mini mascot. */
  whoId?: string
  /** Recipient name, color and id on a talk line. */
  to?: string
  toColor?: string
  toId?: string
}

export type TalkKind = 'order' | 'report' | 'message'

/** Office interaction: task assignment, report or message between agents. */
export type Talk = {
  /** 'msg:<tool_use_id|t>' | 'ord:<workerId>' | 'rep:<workerId>' */
  id: string
  t: number
  /** Sender Worker id, including boss; empty for messages from another session outside the office. */
  from: string
  /** Recipient Worker id; empty for a recipient in another session outside the office. */
  to: string
  kind: TalkKind
  /** talkText(): SendMessage summary or first line, at most 48 characters, never raw paths or commands. */
  text: string
  isDelivered: boolean
  /** Recipient session.receive time. */
  readAt?: number
}

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
  /** each limit's readings [time, %] in its current window, shared across chats (limit pace) */
  samples?: Record<string, Array<[number, number]>>
}

/** What today has cost across every chat this mod ran in (API-equivalent dollars). */
export type Daily = { day: string; usd: number; sessions: number; at: number }

export type Turn = {
  active: boolean
  model?: string
  effort?: string
  startedAt?: number
  lastEndedAt?: number
  steps: number
  turns: number
  prompt?: string
  /** Boss TodoWrite plan. */
  plan?: Progress
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

export type UiPrefs = { tab: Tab; motion: boolean; compact: boolean; hints?: boolean; settings?: boolean }

export type Stats = {
  tools: Record<string, number>
  hired: number
  outTokens: number
  inTokens: number
  cacheRead: number
  sessionStart: number
  /** Completed tasks, shown by coffee-corner cups. */
  done?: number
  /** Failed tasks. */
  failed?: number
  /** Reports returned to the boss or parent agent, in the printer tray. */
  reports?: number
  /** Messages between desks, shown on the meeting table. */
  messages?: number
  /** Messages from another session outside the office, shown in the mail slot. */
  inbound?: number
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-office': {
      workers: Shaped<Worker[]>
      feed: Shaped<FeedItem[]>
      usage: Shaped<Usage>
      turn: Shaped<Turn>
      breakdown: Shaped<Breakdown | null>
      prefs: Shaped<UiPrefs>
      stats: Shaped<Stats>
      auto: Shaped<{ isOn: boolean; at: number }>
      theme: Shaped<'dark' | 'light'>
      frame: Shaped<number>
      daily: Shaped<Daily>
      talks: Shaped<Talk[]>
    }
  }
}
