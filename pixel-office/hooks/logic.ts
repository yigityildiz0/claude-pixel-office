// Pure rules: what a tool call, a thought or a site means for the office.
import type { Activity, FeedKind, SiteKind, ThinkKind } from '../types'

export const TEAM_COLORS = [
  // mid tones that read on graphite and on ivory alike: clay, sky, heather, rose,
  // sage, teal, ochre, rust (Claude's warm palette, widened for a team)
  '#D97757',
  '#5B8FC7',
  '#9883C4',
  '#C9638A',
  '#7E9F4F',
  '#3E9AA8',
  '#C99234',
  '#B4694A',
]

const NAMES = [
  'Ada', 'Max', 'Eve', 'Leo', 'Nia', 'Zoe', 'Kai', 'Elif', 'Ari', 'Nil',
  'Emma', 'Sam', 'Noah', 'Iris', 'Finn', 'Ivy', 'Theo', 'Lara', 'Owen', 'Mira',
]

export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pick<T>(list: readonly T[], seed: string): T {
  return list[hash(seed) % list.length] as T
}

export function nameFor(index: number): string {
  const base = NAMES[index % NAMES.length] as string
  const round = Math.floor(index / NAMES.length)
  return round === 0 ? base : `${base} ${round + 1}`
}

export function roleFor(type: string, isFork = false, isWorkflow = false): string {
  if (isFork) return 'Fork'
  if (isWorkflow) return 'Workflow'
  const known: Record<string, string> = {
    'general-purpose': 'General',
    Explore: 'Explorer',
    Plan: 'Planner',
    yigit_quick: 'Quick',
    yigit_balanced: 'Balanced',
    yigit_deep: 'Deep',
    'claude-code-guide': 'Guide',
    'web-search-agent': 'Researcher',
    claude: 'General',
  }
  if (known[type]) return known[type] as string
  const tail = type.split(':').pop() ?? type

  return tail.length > 16 ? tail.slice(0, 15) + '…' : tail
}

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? one.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : one
}

export function baseName(path: unknown): string {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.split(/[\\/]/).filter(Boolean)

  return parts[parts.length - 1] ?? path
}

export function siteOf(text: string): SiteKind {
  const t = text.toLowerCase()
  if (/youtube\.com|youtu\.be|\byoutube\b/.test(t)) return 'youtube'
  if (/reddit\.com|\breddit\b/.test(t)) return 'reddit'
  if (/(^|[/.\s])(x\.com|twitter\.com)|\btwitter\b|\btweet/.test(t)) return 'x'
  if (/wikipedia\.org|\bwiki/.test(t)) return 'wiki'
  if (/github\.com|\bgithub\b|gitlab/.test(t)) return 'github'
  if (/stackoverflow|stackexchange/.test(t)) return 'stack'
  if (/arxiv|pubmed|ncbi|doi\.org|scholar|semantic ?scholar|\.edu\b/.test(t)) return 'paper'
  if (/anthropic\.com|claude\.ai|claude\.com/.test(t)) return 'claude'
  if (/docs?\.|developer\.|\/docs\/|readthedocs|mdn|learn\.microsoft/.test(t)) return 'docs'
  if (/google\./.test(t)) return 'google'

  return 'web'
}

export const SITE_LABEL: Record<SiteKind, string> = {
  youtube: 'YouTube',
  reddit: 'Reddit',
  x: 'X',
  wiki: 'Wikipedia',
  github: 'GitHub',
  stack: 'Stack Overflow',
  google: 'Google',
  docs: 'Docs',
  paper: 'Paper',
  claude: 'Anthropic',
  web: 'Web',
}

export type ToolReading = {
  activity: Activity
  feed: FeedKind
  bubble: string
  detail: string
  site?: SiteKind
  label: string
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Reads one tool call as a Turkish desk activity. `detail` is the plain line the
 * feed shows: a verb and at most a file name, never a raw command or a path.
 */
export function readTool(tool: string, input: Record<string, unknown>): ToolReading {
  const path = str(input.file_path) || str(input.notebook_path) || str(input.path)
  const file = clip(baseName(path), 28)
  const url = str(input.url)
  const short = tool.startsWith('mcp__') ? tool.split('__').slice(-1)[0] ?? tool : tool
  const said = (verb: string, what = '') => (what ? `${verb} · ${what}` : verb)

  switch (tool) {
    case 'Read':
      return { activity: 'reading', feed: 'read', label: 'Reading', bubble: `Reading: ${file}`, detail: said('read', file) }
    case 'Grep':
      return { activity: 'reading', feed: 'read', label: 'Search', bubble: 'Searching the files', detail: 'searched the files' }
    case 'Glob':
      return { activity: 'reading', feed: 'read', label: 'Find files', bubble: 'Looking for files', detail: 'looked for files' }
    case 'Edit':
    case 'MultiEdit':
      return { activity: 'writing', feed: 'write', label: 'Edit', bubble: `Editing: ${file}`, detail: said('edited', file) }
    case 'Write':
      return { activity: 'writing', feed: 'write', label: 'Write', bubble: `Writing: ${file}`, detail: said('wrote', file) }
    case 'NotebookEdit':
      return { activity: 'writing', feed: 'write', label: 'Notebook', bubble: `Notebook: ${file}`, detail: said('edited the notebook', file) }
    case 'Bash':
    case 'PowerShell': {
      // the call's own one-line description reads as a sentence; the command itself never shows
      const what = clip(str(input.description), 34)

      return { activity: 'running', feed: 'run', label: 'Command', bubble: what ? `Command: ${clip(what, 26)}` : 'Running a command', detail: said('ran a command', what) }
    }
    case 'Monitor':
      return { activity: 'running', feed: 'run', label: 'Watch', bubble: 'Watching a process', detail: 'watching a process' }
    case 'WebSearch': {
      const query = str(input.query)
      const site = siteOf(`${query} ${(input.allowed_domains as string[] | undefined)?.join(' ') ?? ''}`)

      return { activity: 'web', feed: 'web', site: site === 'web' ? 'google' : site, label: 'Web search', bubble: `Searching: ${clip(query, 26)}`, detail: said('searched the web', clip(query, 30)) }
    }
    case 'WebFetch':
      return { activity: 'web', feed: 'web', site: siteOf(url), label: 'Read a page', bubble: `Reading ${SITE_LABEL[siteOf(url)]}`, detail: `read a ${SITE_LABEL[siteOf(url)]} page` }
    case 'Agent':
    case 'Task':
      return { activity: 'delegating', feed: 'hire', label: 'Delegate', bubble: `Handing out: ${clip(str(input.description), 24)}`, detail: said('handed out a task', clip(str(input.description), 32)) }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'EnterPlanMode':
    case 'ExitPlanMode':
    case 'mcp__ccd_turn__update_plan':
      return { activity: 'planning', feed: 'plan', label: 'Plan', bubble: 'Writing the plan on the board', detail: 'updated the plan' }
    case 'AskUserQuestion':
      return { activity: 'waiting', feed: 'wait', label: 'Question', bubble: 'I have a question for you!', detail: 'asked you a question' }
    case 'Skill':
      return { activity: 'reading', feed: 'read', label: 'Skill', bubble: `Skill: ${clip(str(input.skill), 22)}`, detail: said('loaded a skill', clip(str(input.skill), 26)) }
    case 'ToolSearch':
      return { activity: 'reading', feed: 'read', label: 'Toolbox', bubble: 'Rummaging in the toolbox', detail: 'looked in the toolbox' }
    case 'Artifact':
      return { activity: 'writing', feed: 'write', label: 'Artifact', bubble: 'Publishing the artifact', detail: 'published an artifact' }
  }

  if (/browser|chrome|playwright|navigate|computer/i.test(tool)) {
    const site = siteOf(url || str(input.text) || str(input.query))

    return { activity: 'web', feed: 'web', site, label: 'Browser', bubble: url ? `Opening ${SITE_LABEL[site]}` : 'Using the browser', detail: url ? `opened ${SITE_LABEL[site]}` : 'used the browser' }
  }

  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1] ?? 'mcp'
    const name = server.length > 20 || /^[0-9a-f-]{20,}$/i.test(server) ? short : server
    const isWeb = /search|fetch|scrape|research|consensus|pubmed|context7|docs/i.test(tool)

    return { activity: isWeb ? 'web' : 'running', feed: isWeb ? 'web' : 'run', site: isWeb ? siteOf(tool) : undefined, label: 'Connector', bubble: `Using ${clip(name, 16)}`, detail: `used ${clip(name, 22)}` }
  }

  return { activity: 'running', feed: 'run', label: 'Tool', bubble: `Using ${clip(tool, 20)}`, detail: `used ${clip(tool, 24)}` }
}

const THINK_RULES: Array<[ThinkKind, RegExp]> = [
  ['debug', /\b(error|bug|fail|failing|broken|crash|exception|fix|wrong|hata|bozuk|çalışmıyor|düzelt|neden olmuyor)\b/i],
  ['plan', /\b(plan|steps?|first|then|next|approach|strategy|outline|önce|sonra|adım|yaklaşım|strateji)\b/i],
  ['research', /\b(search|research|source|docs?|documentation|look up|find out|araştır|kaynak|doküman|bul)\w*/i],
  ['design', /\b(design|layout|ui|ux|color|colour|palette|font|style|tasarım|renk|yerleşim|görünüm)\b/i],
  ['decide', /\b(should i|whether|alternatively|instead|trade-?off|option|decide|karar|belki|yoksa|seçenek)\b/i],
  ['math', /\b(calculate|compute|sum|percent|estimate|tokens?|\d+\s*[x*×/+-]\s*\d+|hesapla|yüzde)\b/i],
  ['code', /\b(function|implement|code|class|type|module|hook|refactor|kod|fonksiyon|yaz)\w*/i],
]

/** The kind of thought the latest thinking text shows: most clues, the newest breaking a tie. */
export function thinkKind(text: string): ThinkKind {
  const tail = text.slice(-600)
  const scores: Array<[ThinkKind, number, number]> = []
  let lastAt = -1
  for (const [kind, rule] of THINK_RULES) {
    const global = new RegExp(rule.source, 'gi')
    let match: RegExpExecArray | null
    let count = 0
    let last = -1
    while ((match = global.exec(tail)) !== null) {
      count++
      last = match.index
    }
    if (count > 0) scores.push([kind, count, last])
    lastAt = Math.max(lastAt, last)
  }
  let best: ThinkKind = 'general'
  let bestScore = 0
  for (const [kind, count, last] of scores) {
    const score = count + (last === lastAt ? 0.5 : 0)
    if (score > bestScore) {
      bestScore = score
      best = kind
    }
  }

  return best
}

export const THINK_LABEL: Record<ThinkKind, string> = {
  plan: 'Planning',
  debug: 'Bug hunting',
  research: 'Planning research',
  design: 'Designing',
  decide: 'Karar veriyor',
  code: 'Kodu kurguluyor',
  math: 'Calculating',
  general: 'Thinking',
}

/** The last whole sentence of a thinking text, short enough for a bubble. */
export function thoughtGist(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  const sentences = flat.split(/(?<=[.!?:])\s+/).filter(s => s.length > 8)
  const last = sentences.length > 1 ? sentences[sentences.length - 2] ?? '' : sentences[0] ?? flat

  return clip(last, max)
}

export const QUIPS = {
  hello: [
    'Hello boss! Starting right away.',
    'Got my coffee, getting to work.',
    'I have it, no worries.',
    'Desk ready, starting!',
    'First day, so excited!',
  ],
  done: ['Report on your desk!', 'Done and delivered!', 'All done, boss.', 'Everything is ready!', 'Task complete ✓'],
  fail: ['Something went wrong…', 'I am stuck, boss.', 'That did not work…'],
  idle: ['Coffee break.', 'Waiting for the next job.', 'The office is quiet.', 'Ready, what is next?'],
  compact: ['Tidying the desk…', 'Filing the papers.', 'Compacting the context.'],
  turn: ['New job in!', 'Looking at it now.', 'Got it, starting.'],
}

export function limitLabel(kind: string): string {
  const known: Record<string, string> = {
    five_hour: '5 hour',
    seven_day: 'Weekly',
    seven_day_opus: 'Weekly Opus',
    seven_day_sonnet: 'Weekly Sonnet',
    spend_limit: 'Spend',
  }

  return known[kind] ?? kind.replace(/_/g, ' ')
}

export function fmtTokens(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n >= 100_000 ? 0 : 1) + 'k'

  return String(Math.round(n))
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`

  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** Istanbul wall time (UTC+3 all year) for a clock-reading `now`. */
export function istanbul(now: number): { h: number; m: number; s: number; text: string } {
  const d = new Date(now)
  const h = d.getHours()
  const m = d.getMinutes()
  const s = d.getSeconds()
  const pad = (n: number) => String(n).padStart(2, '0')

  return { h, m, s, text: `${pad(h)}:${pad(m)}:${pad(s)}` }
}

export function resetIn(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''

  return fmtDuration(at - now).replace(/ \d+s$/, '')
}

// —— limit forecast ——————————————————————————————————————————

/** A limit reading at a moment: [time ms, percent used]. */
export type Sample = [number, number]

export type Forecast = {
  /** percent per hour, at the recent pace; undefined when too few readings */
  rate?: number
  /** when the limit fills at that pace, if before its reset */
  fullAt?: number
  /** the percent it would show at reset, if it does not fill first */
  atReset?: number
  resetAt?: number
  /** a short sentence for the HUD */
  line: string
  tone: 'ok' | 'warn' | 'bad' | 'idle'
}

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

/**
 * How fast a limit is filling and when it would be full. The pace is the slope of
 * the recent readings (the last hour for the 5-hour limit, the last day for the week),
 * blended with the average since the window opened, so one burst does not swing it.
 */
export function forecast(kind: string, pct: number, resetsAt: string | undefined, samples: readonly Sample[], now: number): Forecast {
  const resetAt = resetsAt ? Date.parse(resetsAt) : NaN
  const hasReset = Number.isFinite(resetAt) && resetAt > now
  const span = WINDOW_MS[kind] ?? WINDOW_MS.seven_day as number
  const isFive = kind === 'five_hour'
  const recentMs = isFive ? 60 * 60_000 : 48 * 3_600_000
  // the week's slope only once its readings span a day: hours of work alone overstate a week
  const minDt = isFive ? 4 * 60_000 : 20 * 3_600_000
  const pts = samples.filter(([t]) => t >= now - recentMs && t <= now + 60_000)
  let slope: number | undefined
  if (pts.length >= 2) {
    const t0 = (pts[0] as Sample)[0]
    const dt = (pts[pts.length - 1] as Sample)[0] - t0
    if (dt >= minDt) {
      // least squares, in percent per hour
      const xs = pts.map(([t]) => (t - t0) / 3_600_000)
      const ys = pts.map(([, p]) => p)
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length
      const my = ys.reduce((a, b) => a + b, 0) / ys.length
      let num = 0
      let den = 0
      xs.forEach((x, i) => {
        num += (x - mx) * ((ys[i] as number) - my)
        den += (x - mx) ** 2
      })
      if (den > 0) slope = Math.max(0, num / den)
    }
  }
  // the average since this window opened (the reset less the window's length)
  let average: number | undefined
  if (hasReset) {
    const opened = resetAt - span
    const hours = (now - opened) / 3_600_000
    // at least half an hour (5-hour) or a whole day (week) under the average
    if (hours > (isFive ? 0.1 : 0.5)) average = pct / Math.max(hours, isFive ? 0.5 : 24)
  }
  const rate = slope !== undefined && average !== undefined ? 0.65 * slope + 0.35 * average : slope ?? average
  if (!hasReset) return { rate, line: pct > 0 ? 'reset time unknown' : 'starts with first message', tone: 'idle' }
  if (rate === undefined) return { resetAt, line: `resets in ${resetIn(resetsAt, now)} · measuring pace`, tone: 'idle' }
  if (rate < 0.05) return { rate, resetAt, atReset: pct, line: `steady · resets in ${resetIn(resetsAt, now)}`, tone: 'ok' }
  const hoursLeft = (resetAt - now) / 3_600_000
  const atReset = pct + rate * hoursLeft
  if (atReset >= 100) {
    const fullAt = now + ((100 - pct) / rate) * 3_600_000
    const early = fmtDuration(resetAt - fullAt).replace(/ \d+s$/, '')
    const at = isFive ? istanbul(fullAt).text.slice(0, 5) : dayTime(fullAt)

    return { rate, resetAt, fullAt, line: `full at ${at} · ${early} before reset`, tone: 'bad' }
  }
  const tone = atReset >= 85 ? 'warn' : 'ok'

  return { rate, resetAt, atReset, line: `≈${Math.round(atReset)}% at reset · in ${resetIn(resetsAt, now)}`, tone }
}

const GUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Sal 14:20" in Istanbul time. */
export function dayTime(t: number): string {
  return `${GUN[new Date(t).getDay()]} ${istanbul(t).text.slice(0, 5)}`
}

/** Today's local date, YYYY-MM-DD: the key the day's cost is kept under. */
export function dayKey(t: number): string {
  const d = new Date(t)

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Adds a reading, keeping the list short and only what moved (or every 5 minutes). */
export function withSample(list: readonly Sample[] | undefined, t: number, pct: number): Sample[] {
  const all = (list ?? []).filter(([at]) => at < t)
  const last = all[all.length - 1]
  if (last && Math.abs(last[1] - pct) < 0.5 && t - last[0] < 5 * 60_000) return all.slice()

  return [...all, [t, Math.round(pct * 10) / 10] as Sample].slice(-80)
}

export function level(pct: number | undefined): { color: string; word: string } {
  if (pct === undefined) return { color: '#64748B', word: 'unknown' }
  if (pct >= 85) return { color: '#EF4444', word: 'critical' }
  if (pct >= 60) return { color: '#F59E0B', word: 'watch' }

  return { color: '#22C55E', word: 'easy' }
}
