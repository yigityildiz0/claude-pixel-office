import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, RenderElement } from 'claude-code'

import type { Breakdown, FeedItem, FeedKind, Stats, Tab, Turn, UiPrefs, Usage, Worker } from '../types'
import { breakdownHud, hudSvg, isBusy, useHudTheme } from './hud'
import {
  QUIPS,
  TEAM_COLORS,
  THINK_LABEL,
  baseName,
  clip,
  fmtDuration,
  fmtTokens,
  level,
  limitLabel,
  nameFor,
  pick,
  readTool,
  resetIn,
  roleFor,
  thinkKind,
  thoughtGist,
  istanbul,
} from './logic'
import { ARRIVE_MS, LEAVE_MS, activityLabel } from './scene'
import { isAlive, readShared, writeShared } from './shared'

const PANE = 'pixel-office'
const TITLE = 'Claude Office'
// a burst of events lands as one redraw: fewer redraws, a steadier picture
const FLUSH_MS = 900
const LINGER_MS = 40_000
const THINK_PUSH_MS = 1600
// the desktop draws a cell of the pane about this many pixels wide and tall:
// the HUD is drawn to the pane's own size from them
const CELL_PX = 8
const ROW_PX = 17
const BOSS = { name: 'Boss', color: '#D97757' }

// Tags change when a value's fields change: what an older version stored is
// read as the initial value instead.
const workersA = atom({ plugin: 'pixel-office', key: 'workers' } as const, [] as Worker[], { shape: 'workers-1' })
const feedA = atom({ plugin: 'pixel-office', key: 'feed' } as const, [] as FeedItem[], { shape: 'feed-1' })
const usageA = atom({ plugin: 'pixel-office', key: 'usage' } as const, { ctxWindow: 0, limits: [], at: 0 } as Usage, {
  shape: 'usage-1',
})
const turnA = atom({ plugin: 'pixel-office', key: 'turn' } as const, { active: false, steps: 0, turns: 0 } as Turn, {
  shape: 'turn-1',
})
const breakdownA = atom({ plugin: 'pixel-office', key: 'breakdown' } as const, null as Breakdown | null, {
  shape: 'breakdown-1',
})
const prefsA = atom({ plugin: 'pixel-office', key: 'prefs' } as const, { tab: 'ofis', motion: true, compact: false } as UiPrefs, {
  shape: 'prefs-1',
})
// auto compact as this chat has it (shared with kota-bandi when that is installed)
const autoA = atom({ plugin: 'pixel-office', key: 'auto' } as const, { isOn: false, at: 80 }, { shape: 'auto-1' })
// bumped when a held-back drawing is due, so the pane draws it
const frameA = atom({ plugin: 'pixel-office', key: 'frame' } as const, 0, { shape: 'frame-1' })
// the app's own light or dark theme
const themeA = atom({ plugin: 'pixel-office', key: 'theme' } as const, 'dark' as 'dark' | 'light', { shape: 'theme-1' })
const statsA = atom(
  { plugin: 'pixel-office', key: 'stats' } as const,
  { tools: {}, hired: 0, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: 0 } as Stats,
  { shape: 'stats-1' },
)

type $ = EngineInterface
type Emit = (item: FeedItem) => void
type WorkerChange = (list: Worker[], now: number, emit: Emit) => Worker[]

// Changes wait here and land together, so a burst of events is one redraw.
let pendingWorkers: WorkerChange[] = []
let pendingFeed: FeedItem[] = []
let pendingStats: Array<(s: Stats) => Stats> = []
let flushTimer: { cancel: () => void } | null = null
const thinking = new Map<string, { text: string; pushedAt: number; kind?: string; textSeen: boolean }>()
const currentTool = new Map<string, string>()
const warned = new Set<string>()

// —— the drawing, held steady ——
// The overview is not drawn from the live values: each change to them (every tool
// call, every measurement) redrew the pane, and the app reloads the image on every
// draw, which flickered while Claude worked. A timer paints a new frame instead, at
// most every FRAME_MS and only when the picture has changed; the pane draws only
// when a new frame lands (the motion runs inside the image).
const FRAME_MS = 4000
type Snap = { workers: Worker[]; feed: FeedItem[]; usage: Usage; turn: Turn; stats: Stats }
type Size = { width: number; fill: number; theme: 'dark' | 'light'; motion: boolean; auto: { isOn: boolean; at: number }; key: string }
let snap: Snap | undefined
let size: Size | undefined
let frame: { key: string; hud: ReturnType<typeof hudSvg>; at: number; size: string } | undefined

function drawFrame(s: Snap, at: Size, now: number): ReturnType<typeof hudSvg> {
  useHudTheme(at.theme)

  return hudSvg({ ...s, now, motion: at.motion, width: at.width, fill: at.fill, autoCompact: at.auto })
}

async function paint($: $): Promise<void> {
  const [workers, feed, usage, turn, stats] = await Promise.all([read($, workersA), read($, feedA), read($, usageA), read($, turnA), read($, statsA)])
  snap = { workers, feed, usage, turn, stats }
  if (!size) return
  const now = await $.clock.now()
  if (frame && frame.size === size.key && now - frame.at < FRAME_MS) return
  const hud = drawFrame(snap, size, now)
  // the animations' start times differ on every draw: what is shown is the rest
  const key = hud.svg.replace(/animation:[^;"]*/g, '')
  if (frame && frame.size === size.key && frame.key === key) return
  frame = { key, hud, at: now, size: size.key }
  await update($, frameA, n => n + 1)
}

// —— auto compact ——
const AT_MIN = 15
const AT_MAX = 95
const AT_STEP = 5
// the usage band (Turkish kota-bandi or English usage-band) runs auto compact when it
// is installed; this office runs it only alone
const PARTNERS = ['kota-bandi', 'usage-band']
let chat: string | undefined
let isCompacting = false
// compacted and still past the %: wait until the context drops below it
let isStuck = false
let isTurning = false

async function chatOf($: $): Promise<string> {
  if (chat) return chat
  try {
    chat = await $.session.id()
  } catch {
    chat = 'chat'
  }

  return chat
}

/** Picks up a change made from the other mod's band. */
async function syncAuto($: $): Promise<void> {
  const shared = await readShared($, await chatOf($))
  if (!shared) return
  const was = await read($, autoA)
  if (was.isOn !== shared.isOn || was.at !== shared.at) await update($, autoA, () => ({ isOn: shared.isOn, at: shared.at }))
}

async function setAuto($: $, fn: (a: { isOn: boolean; at: number }) => { isOn: boolean; at: number }): Promise<void> {
  const next = fn(await read($, autoA))
  next.at = Math.min(AT_MAX, Math.max(AT_MIN, Math.round(next.at / AT_STEP) * AT_STEP))
  await update($, autoA, () => next)
  await writeShared($, await chatOf($), { ...next, t: await $.clock.now() })
  isStuck = false
  $.ui.toast(next.isOn ? `Auto-compact on: at ${next.at}% context` : 'Auto-compact off')
}

function compactNow($: $): void {
  if (isCompacting) return
  isCompacting = true
  // compacting outlasts a press or a hook: a timer starts it
  $.clock.after(0, async () => {
    try {
      await $.command.run({ command: 'compact' })
    } catch (error) {
      $.ui.toast(`Could not start compacting: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      isCompacting = false
    }
  })
}

/** Between turns, at or past the %: compacts once (unless kota-bandi runs it). */
async function watchAuto($: $, pct: number | undefined): Promise<void> {
  if (pct === undefined) return
  const auto = await read($, autoA)
  if (!auto.isOn) return
  if (Math.round(pct) < auto.at) {
    isStuck = false
    return
  }
  if (isStuck || isTurning || isCompacting) return
  const now = await $.clock.now()
  if ((await Promise.all(PARTNERS.map(mod => isAlive($, mod, now)))).some(Boolean)) return
  isStuck = true
  isCompacting = true
  $.ui.toast(`Context ${Math.round(pct)}%: auto-compacting (threshold ${auto.at}%)`)
  $.clock.after(1000, async () => {
    try {
      try {
        await $.session.compact()
      } catch {
        // the desktop app compacts as a turn of its own: typed, as the button does
        await $.command.run({ command: 'compact' })
      }
    } catch (error) {
      $.ui.toast(`Could not start auto-compact: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      isCompacting = false
    }
  })
}

// —— the app's theme, read from its own settings file (no process is ever started) ——
let themeFile: { mtimeMs: number; mode?: string } | undefined
async function syncTheme($: $): Promise<void> {
  try {
    const appData = await $.env.get('APPDATA')
    const home = await $.env.get('HOME')
    const path = appData ? `${appData}/Claude/config.json` : home ? `${home}/Library/Application Support/Claude/config.json` : undefined
    if (!path) return
    const { mtimeMs } = await $.fs.stat(path)
    if (themeFile?.mtimeMs !== mtimeMs) {
      themeFile = { mtimeMs, mode: (JSON.parse(String(await $.fs.read(path))) as { userThemeMode?: string }).userThemeMode }
    }
    const next = themeFile.mode === 'light' ? 'light' : 'dark'
    if (next !== (await read($, themeA))) await update($, themeA, () => next)
  } catch {
    // unknown: dark
  }
}

/** The context % trail the sparkline draws: a new point only when it moved. */
function withHistory(list: readonly number[] | undefined, pct: number): number[] {
  const all = list ?? []
  const last = all[all.length - 1]

  return last !== undefined && Math.abs(last - pct) < 0.5 ? all.slice() : [...all, Math.round(pct * 10) / 10].slice(-60)
}

function workerId(agentId: string | undefined): string {
  return agentId ?? 'boss'
}

function schedule($: $): void {
  if (flushTimer) return
  flushTimer = $.clock.after(FLUSH_MS, () => {
    flushTimer = null
    void flush($)
  })
}

async function flush($: $): Promise<void> {
  const changes = pendingWorkers
  const queued = pendingFeed
  const stats = pendingStats
  pendingWorkers = []
  pendingFeed = []
  pendingStats = []
  const now = await $.clock.now()
  // What the changes say goes to the feed, from the attempt that was written.
  let said: FeedItem[] = []
  try {
    if (changes.length > 0) {
      await update($, workersA, list => {
        said = []

        return changes.reduce((acc, fn) => fn(acc, now, one => said.push({ ...one, text: clip(one.text, 160) })), list)
      })
    }
    const feed = [...queued, ...said].sort((a, b) => a.t - b.t)
    if (feed.length > 0) await update($, feedA, list => [...list, ...feed].slice(-90))
    if (stats.length > 0) await update($, statsA, s => stats.reduce((acc, fn) => fn(acc), s))
  } catch {
    // A lost write only costs one frame of the office.
  }
}

function changeWorkers($: $, fn: WorkerChange): void {
  pendingWorkers.push(fn)
  schedule($)
}

function patch($: $, id: string, fn: (w: Worker, now: number) => Partial<Worker> | null): void {
  changeWorkers($, (list, now, emit) => {
    const at = list.findIndex(w => w.id === id)
    if (at < 0) return list
    const was = list[at] as Worker
    const p = fn(was, now)
    if (!p) return list
    const next = list.slice()
    next[at] = { ...was, ...p }

    return next
  })
}

function feed($: $, who: Worker | { name: string; color: string }, kind: FeedKind, text: string): void {
  pendingFeed.push(item(Date.now(), who, kind, text))
  schedule($)
}

function item(t: number, who: Pick<Worker, 'name' | 'color'>, kind: FeedKind, text: string): FeedItem {
  return { t, who: who.name, color: who.color, kind, text: clip(text, 160) }
}

function stat($: $, fn: (s: Stats) => Stats): void {
  pendingStats.push(fn)
  schedule($)
}

function freeSeat(list: readonly Worker[]): number {
  const taken = new Set(list.filter(w => w.id !== 'boss').map(w => w.seat))
  let seat = 0
  while (taken.has(seat)) seat++

  return seat
}

function newBoss(now: number, name: string): Worker {
  return {
    id: 'boss',
    n: -1,
    name,
    role: 'Boss',
    task: '',
    color: '#D97757',
    seat: -1,
    activity: 'idle',
    bubble: pick(QUIPS.idle, String(now)),
    detail: '',
    tools: 0,
    tokensOut: 0,
    since: now,
    joinedAt: now,
  }
}

// Hire order outlives a departure; after a reload the seated team carries it.
let hireSeq = 0

function nextHire(list: readonly Worker[]): number {
  const index = Math.max(hireSeq, ...list.map(w => w.n + 1))
  hireSeq = index + 1

  return index
}

/** Seats a new employee; the boss points them to their desk. */
function hire($: $, info: { id: string; type: string; task: string; isFork?: boolean; isWorkflow?: boolean; name?: string }): void {
  changeWorkers($, (list, now, emit) => {
    if (list.some(w => w.id === info.id)) return list
    const index = nextHire(list)
    const worker: Worker = {
      id: info.id,
      n: index,
      name: info.name ? clip(info.name, 12) : nameFor(index),
      role: roleFor(info.type, info.isFork, info.isWorkflow),
      task: clip(info.task || 'Task', 120),
      color: TEAM_COLORS[index % TEAM_COLORS.length] as string,
      seat: freeSeat(list),
      activity: 'thinking',
      think: 'general',
      bubble: '',
      detail: '',
      tools: 0,
      tokensOut: 0,
      since: now + ARRIVE_MS,
      joinedAt: now,
    }
    const team = list.filter(w => w.id !== 'boss').length + 1
    emit({ t: now, who: worker.name, color: worker.color, kind: 'hire', text: `started · ${clip(worker.task, 40)}` })
    if (team > 1 && (team - 1) % 3 === 0) {
      emit({ t: now, who: 'Office', color: '#8F8D85', kind: 'hire', text: `The office grew: desk row ${Math.ceil(team / 3)} is set up` })
    }

    return list.map(w =>
      w.id === 'boss'
        ? { ...w, activity: 'delegating' as const, since: now, bubble: `${worker.name}, ${clip(info.task || 'take a look at this', 28)}!`, detail: info.task }
        : w,
    ).concat(worker)
  })
  stat($, s => ({ ...s, hired: s.hired + 1 }))
}

function agentWorkerState(info: AgentInfo): Partial<Worker> | null {
  switch (info.status) {
    case 'completed':
      return { activity: 'done' }
    case 'failed':
    case 'killed':
      return { activity: 'failed' }
    case 'waiting':
      return { activity: 'waiting', bubble: 'Waiting for approval…' }
    default:
      return null
  }
}

async function refreshBreakdown($: $): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary', columns: 80 })
  const b = usage.context.breakdown
  if (!b) return
  const now = await $.clock.now()
  const top = <T,>(list: readonly T[] | undefined, map: (x: T) => { name: string; tokens: number; note?: string }) =>
    (list ?? []).map(map).sort((a, z) => z.tokens - a.tokens).slice(0, 6)
  const threshold = b.autoCompactThreshold
  const value: Breakdown = {
    at: now,
    total: b.totalTokens,
    max: b.maxTokens,
    pct: b.percentage,
    model: b.model,
    autocompact: threshold === undefined ? undefined : threshold > 100 ? (100 * threshold) / Math.max(1, b.maxTokens) : threshold,
    categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
    memory: top(b.memoryFiles, f => ({ name: baseName(f.path), tokens: f.tokens, note: f.type })),
    mcp: top(b.mcpTools, t => ({ name: t.name.split('__').slice(-1)[0] ?? t.name, tokens: t.tokens, note: t.serverName })),
    skills: top(b.skills?.skillFrontmatter, s => ({ name: s.name, tokens: s.tokens })),
    agents: top(b.agents as unknown as Array<Record<string, unknown>>, a => ({
      name: String(a.agentType ?? a.name ?? 'ajan'),
      tokens: Number(a.tokens ?? 0),
    })),
  }
  await update($, breakdownA, () => value)
}

/** Keeps the team in step with the engine's own agent list, and walks finished workers out. */
async function tick($: $): Promise<void> {
  const now = await $.clock.now()
  let agents: AgentInfo[] = []
  try {
    agents = await $.agent.list()
  } catch {
    agents = []
  }
  const list = await read($, workersA)
  const known = new Set(list.map(w => w.id))
  for (const a of agents) {
    const live = a.status === 'running' || a.status === 'pending' || a.status === 'waiting'
    if (!known.has(a.id) && live) {
      hire($, { id: a.id, type: a.type, task: a.description, name: a.name })
    }
  }
  const byId = new Map(agents.map(a => [a.id, a]))
  const needs = list.some(w => {
    if (w.id === 'boss') return w.activity === 'delegating' && now - w.since > 5000
    const info = byId.get(w.id)
    const state = info ? agentWorkerState(info) : null
    if (state && w.endedAt === undefined && state.activity !== w.activity) return true
    if (w.endedAt !== undefined && w.activity !== 'leaving' && now - w.endedAt > LINGER_MS) return true
    if (w.activity === 'leaving' && now - w.since > LEAVE_MS + 800) return true

    return false
  })
  if (!needs) return
  changeWorkers($, (all, at) => {
    const out: Worker[] = []
    for (const w of all) {
      if (w.id === 'boss') {
        out.push(w.activity === 'delegating' && at - w.since > 5000 ? { ...w, activity: 'thinking', think: 'general', since: at, bubble: 'The team is on it, I am watching.' } : w)
        continue
      }
      if (w.activity === 'leaving' && at - w.since > LEAVE_MS + 800) continue
      if (w.endedAt !== undefined && w.activity !== 'leaving' && at - w.endedAt > LINGER_MS) {
        out.push({ ...w, activity: 'leaving', since: at, bubble: '' })
        continue
      }
      const info = byId.get(w.id)
      const state = info ? agentWorkerState(info) : null
      if (state && w.endedAt === undefined && state.activity !== w.activity) {
        const ends = state.activity === 'done' || state.activity === 'failed'
        out.push({
          ...w,
          ...state,
          since: at,
          endedAt: ends ? at : undefined,
          bubble: state.bubble ?? (state.activity === 'done' ? pick(QUIPS.done, w.id) : pick(QUIPS.fail, w.id)),
        })
        continue
      }
      out.push(w)
    }

    return out
  })
}

function observeChunk($: $, id: string, chunk: { kind: string; text?: string; name?: string }): void {
  const buf = thinking.get(id) ?? { text: '', pushedAt: 0, textSeen: false }
  if (chunk.kind === 'thinking' && chunk.text) {
    buf.text = (buf.text + chunk.text).slice(-2400)
    const now = Date.now()
    if (now - buf.pushedAt > THINK_PUSH_MS && buf.text.length > 40) {
      buf.pushedAt = now
      const kind = thinkKind(buf.text)
      const gist = thoughtGist(buf.text, 220)
      patch($, id, (w, at) =>
        w.endedAt !== undefined
          ? null
          : { activity: 'thinking', think: kind, since: w.activity === 'thinking' ? w.since : at, bubble: `${THINK_LABEL[kind]}: ${clip(gist, 60)}`, detail: gist },
      )
    }
  } else if (chunk.kind === 'text' && !buf.textSeen) {
    buf.textSeen = true
    patch($, id, (w, at) => (w.endedAt !== undefined ? null : { activity: 'answering', since: at, bubble: id === 'boss' ? 'Writing you the answer…' : 'Writing the report…' }))
  } else if (chunk.kind === 'tool' && chunk.name) {
    const name = chunk.name
    patch($, id, (w, at) => (w.endedAt !== undefined ? null : { bubble: `Next: ${readTool(name, {}).label}`, since: at }))
  }
  thinking.set(id, buf)
}

function stepEnded($: $, id: string, result: { usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | null }): void {
  const buf = thinking.get(id)
  thinking.delete(id)
  const usage = result.usage
  if (usage) {
    const out = usage.output_tokens ?? 0
    patch($, id, w => ({ tokensOut: w.tokensOut + out }))
    stat($, s => ({
      ...s,
      outTokens: s.outTokens + out,
      inTokens: s.inTokens + (usage.input_tokens ?? 0),
      cacheRead: s.cacheRead + (usage.cache_read_input_tokens ?? 0),
    }))
  }
  if (buf && buf.text.length > 60) {
    const kind = thinkKind(buf.text)
    changeWorkers($, (list, _now, emit) => {
      const w = list.find(x => x.id === id)
      if (w) emit({ t: Date.now(), who: w.name, color: w.color, kind: 'think', text: `${THINK_LABEL[kind]} · ${thoughtGist(buf.text, 60)}` })

      return list
    })
  }
}

export const register: Register = (on, options) => {

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    await update($, workersA, list => (list.some(w => w.id === 'boss') ? list.map(w => (w.id === 'boss' ? { ...w, name: BOSS.name } : w)) : [newBoss(now, BOSS.name), ...list]))
    await update($, statsA, s => (s.sessionStart ? s : { ...s, sessionStart: now }))
    await $.command.register({ name: 'office', description: 'Opens the Claude Office pane: the live pixel office, the team, the feed and the context.' })
    $.clock.every(2000, () => void tick($).catch(() => undefined))
    $.clock.every(1000, () => void paint($).catch(() => undefined))
    // the auto compact setting may change from kota-bandi's band; the theme from the app
    await syncAuto($).catch(() => undefined)
    await syncTheme($)
    $.clock.every(3000, () => void syncAuto($).catch(() => undefined))
    $.clock.every(4000, () => void syncTheme($))
    const surfaces = await $.session.surfaces()
    if (options.autoOpen !== false && surfaces.some(s => s === 'desktop' || s === 'vscode')) {
      void $.ui.open({ id: PANE, title: TITLE })
    }
    try {
      const usage = await $.session.usage()
      // the session's own start, not the moment the office opened
      await update($, statsA, s => ({ ...s, sessionStart: usage.startedAt }))
      await update($, usageA, u => ({
        ...u,
        ctxPct: usage.context.percent,
        ctxTokens: usage.context.tokens,
        ctxWindow: usage.context.window,
        limits: usage.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })),
        usd: usage.cost?.usd,
        at: now,
        history: usage.context.percent === undefined ? u.history : withHistory(u.history, usage.context.percent),
      }))
    } catch {
      // Figures arrive with the first measurement instead.
    }

    return result
  })

  on('command.run', { command: 'office' }, async $ => {
    const placed = await $.ui.open({ id: PANE, title: TITLE })

    return { text: placed.isPlaced ? 'Claude Office pane opened.' : `Could not open the pane: ${placed.reason}` }
  })

  on('turn.start', async ($, e, next) => {
    const id = workerId(e.agentId)
    if (id === 'boss') {
      isTurning = true
      const now = await $.clock.now()
      await update($, turnA, t => ({ ...t, active: true, startedAt: now, steps: 0, turns: t.turns + 1, prompt: clip(e.text, 140) }))
      patch($, 'boss', (w, at) => ({ activity: 'thinking', think: 'general', since: at, bubble: pick(QUIPS.turn, String(at)), detail: clip(e.text, 200) }))
      feed($, BOSS, 'prompt', `new request · ${clip(e.text, 50)}`)
    } else {
      patch($, id, (w, at) => (w.endedAt === undefined ? { activity: 'thinking', since: at } : null))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const id = workerId(e.agentId)
    if (id === 'boss') {
      void update($, turnA, t => ({ ...t, steps: t.steps + 1, model: e.model, effort: e.effort === undefined ? t.effort : String(e.effort) })).catch(() => undefined)
    }
    thinking.set(id, { text: '', pushedAt: 0, textSeen: false })
    const stream = next(e)
    let finished = false
    try {
      for (;;) {
        const step = await stream.next()
        if (step.done) {
          finished = true
          try {
            stepEnded($, id, step.value)
          } catch {
            // Watching never stands in the model's way.
          }

          return step.value
        }
        try {
          observeChunk($, id, step.value)
        } catch {
          // As above.
        }
        yield step.value
      }
    } finally {
      if (!finished) await stream.return(undefined as never)
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = workerId(e.agentId)
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const r = readTool(tool, input)
    currentTool.set(id, e.tool_use_id)
    changeWorkers($, (list, now, emit) => {
      let all = list
      if (!all.some(w => w.id === id) && id !== 'boss') {
        // An agent that started before the office opened: seat it now.
        const index = nextHire(all)
        all = all.concat({
          id,
          n: index,
          name: nameFor(index),
          role: 'Agent',
          task: 'A task started earlier',
          color: TEAM_COLORS[index % TEAM_COLORS.length] as string,
          seat: freeSeat(all),
          activity: 'thinking',
          bubble: '',
          detail: '',
          tools: 0,
          tokensOut: 0,
          since: now,
          joinedAt: now - ARRIVE_MS,
        })
      }

      return all.map(w => {
        if (w.id !== id || w.endedAt !== undefined) return w
        emit({ t: now, who: w.name, color: w.color, kind: r.feed, text: r.detail })

        return { ...w, activity: r.activity, site: r.site, tool, bubble: r.bubble, detail: r.detail, since: now, tools: w.tools + 1 }
      })
    })
    stat($, s => ({ ...s, tools: { ...s.tools, [tool]: (s.tools[tool] ?? 0) + 1 } }))

    const ran = await next(e)
    if (currentTool.get(id) === e.tool_use_id) {
      const failed = 'isError' in ran && ran.isError === true
      patch($, id, (w, at) =>
        w.endedAt !== undefined || (r.activity === 'delegating' && !failed)
          ? null
          : { activity: 'thinking', think: 'general', since: at, bubble: failed ? `${r.label} failed, looking into it` : 'Looking at the result…' },
      )
      if (failed) {
        changeWorkers($, (list, _now, emit) => {
          const w = list.find(x => x.id === id)
          if (w) emit({ t: Date.now(), who: w.name, color: w.color, kind: 'fail', text: `${r.label.toLowerCase()} failed` })

          return list
        })
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('agentId' in result && result.agentId && !e.resume) {
      hire($, {
        id: result.agentId,
        type: e.subagentType,
        task: e.description || e.prompt,
        isFork: e.fork,
        isWorkflow: e.workflow !== undefined,
        name: e.name,
      })
    }

    return result
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const summary = typeof e.last_assistant_message === 'string' ? clip(e.last_assistant_message, 220) : undefined
    changeWorkers($, (list, now, emit) =>
      list.map(w => {
        if (w.id !== e.agent_id || w.endedAt !== undefined) return w
        emit(item(now, w, 'done', 'finished the task'))

        return { ...w, activity: 'done' as const, since: now, endedAt: now, summary, bubble: pick(QUIPS.done, w.id), detail: summary ?? '' }
      }),
    )

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = workerId(e.agentId)
    if (id === 'boss') {
      const now = await $.clock.now()
      await update($, turnA, t => ({ ...t, active: false, lastEndedAt: now }))
      isTurning = false
      // the turn is over: auto compact may run now, never mid-reply
      $.clock.after(500, () => void read($, usageA).then(u => watchAuto($, u.ctxPct)).catch(() => undefined))
      const words = e.isAborted ? 'Stopped.' : e.reason === 'error' ? 'Something went wrong.' : `Done (${fmtDuration(e.durationMs)})`
      patch($, 'boss', (w, at) => ({ activity: e.reason === 'error' ? 'failed' : 'idle', since: at, bubble: words }))
      feed($, BOSS, e.reason === 'error' ? 'fail' : 'turn', `${words}${e.usage ? ` · ${fmtTokens(e.usage.output_tokens)} tokens out` : ''}`)
    } else if (e.reason === 'error') {
      patch($, id, (w, at) => (w.endedAt !== undefined ? null : { activity: 'failed', since: at, endedAt: at, bubble: pick(QUIPS.fail, w.id) }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined) {
      patch($, 'boss', (w, at) => ({ activity: 'compacting', since: at, bubble: pick(QUIPS.compact, String(at)) }))
      feed($, BOSS, 'compact', `Compacting the context (${e.trigger === 'auto' ? 'auto' : 'manual'})`)
      await flush($)
    }
    const result = await next(e)
    if (e.agentId === undefined) {
      patch($, 'boss', (w, at) => ({ activity: 'idle', since: at, bubble: 'Desk tidied, carrying on!' }))
      void update($, breakdownA, () => null).catch(() => undefined)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, usageA, u => ({
      ...u,
      ctxPct: e.context.percent ?? u.ctxPct,
      history: e.context.percent === undefined ? u.history : withHistory(u.history, e.context.percent),
      ctxTokens: e.context.tokens ?? u.ctxTokens,
      ctxWindow: e.context.window,
      limits: e.rateLimits.length > 0 ? e.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })) : u.limits,
      usd: e.cost?.usd ?? u.usd,
      at: now,
    }))
    await watchAuto($, e.context.percent)
    for (const l of e.rateLimits) {
      for (const mark of [80, 90]) {
        const key = `${l.kind}:${mark}:${l.resetsAt ?? ''}`
        if (l.percentUsed >= mark && !warned.has(key)) {
          warned.add(key)
          const reset = resetIn(l.resetsAt, now)
          $.ui.toast(`Claude Office: ${limitLabel(l.kind)} limit at ${Math.round(l.percentUsed)}%${reset ? ` · resets in ${reset}` : ''}`)
          feed($, { name: 'Office', color: '#C99234' }, 'limit', `${limitLabel(l.kind)} limit reached ${Math.round(l.percentUsed)}%`)
        }
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    if (/permission/i.test(e.notification_type)) {
      patch($, 'boss', (w, at) => ({ activity: 'waiting', since: at, bubble: 'Waiting for your approval!', detail: e.message }))
      feed($, BOSS, 'wait', 'waiting for your approval')
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const prefs = await read($, prefsA)
    const auto = await read($, autoA)
    const theme = e.surface === 'desktop' ? await read($, themeA) : 'dark'
    await read($, frameA)
    const isOverview = (prefs.tab === 'akis' ? 'ofis' : prefs.tab) === 'ofis' && e.surface !== 'terminal'
    // off the overview the live values are read (and redraw the pane); on it, the last frame's
    const live = isOverview && snap ? snap : await (async () => {
      const [workers, feed, usage, turn, stats] = await Promise.all([read($, workersA), read($, feedA), read($, usageA), read($, turnA), read($, statsA)])
      return { workers, feed, usage, turn, stats }
    })()
    const { workers, usage, turn, stats } = live
    const breakdown = isOverview ? null : await read($, breakdownA)
    useHudTheme(theme)
    const now = await $.clock.now()
    const bossW = workers.find(w => w.id === 'boss')
    const team = workers.filter(w => w.id !== 'boss')
    const tab: Tab = prefs.tab === 'akis' ? 'ofis' : prefs.tab
    const setTab = (next: Tab) => () => {
      void update($, prefsA, p => ({ ...p, tab: next }))
      if (next === 'baglam') void refreshBreakdown($).catch(() => undefined)
    }
    const tabs: Array<[Tab, string]> = [
      ['ofis', 'Overview'],
      ['ekip', `Team (${team.length})`],
      ['baglam', 'Context'],
    ]
    // the controls: the views, then what runs the office (auto compact, compact now, motion)
    const toolbar = (
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        {tabs.map(([t, label]) => (
          <Button key={`tab-${t}`} label={label} variant={tab === t ? 'primary' : 'secondary'} onPress={setTab(t)} />
        ))}
        <Text dimColor>│</Text>
        <Button
          key="auto"
          label={auto.isOn ? `Auto-compact: on · ${auto.at}%` : 'Auto-compact: off'}
          variant={auto.isOn ? 'primary' : 'secondary'}
          onPress={() => void setAuto($, a => ({ ...a, isOn: !a.isOn }))}
        />
        {auto.isOn ? <Button key="autoDown" label="−5" onPress={() => void setAuto($, a => ({ ...a, at: a.at - AT_STEP }))} /> : null}
        {auto.isOn ? <Button key="autoUp" label="+5" onPress={() => void setAuto($, a => ({ ...a, at: a.at + AT_STEP }))} /> : null}
        <Button key="compact" label="Compact now" onPress={() => compactNow($)} />
        <Button
          key="motion"
          label={prefs.motion ? 'Motion: on' : 'Motion: off'}
          onPress={() => void update($, prefsA, p => ({ ...p, motion: !p.motion }))}
        />
      </Box>
    )
    const SvgEl = e.surface !== 'terminal' && 'Svg' in els && els.Svg ? els.Svg : null
    const width = Math.max(340, e.props.bodyColumns * CELL_PX)
    // less the toolbar above the drawing (about four rows)
    const fill = Math.max(0, e.props.scroll.bodyRows * ROW_PX - 72)

    const teamView = (): RenderElement => {
      const rows = [...(bossW ? [bossW] : []), ...team]

      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Click a worker: that agent's conversation opens in the main view.</Text>
          {rows.map(w => (
            <Button key={`w-${w.id}`} plain onPress={() => void $.ui.view(w.id === 'boss' ? {} : { agentId: w.id }).catch(() => undefined)}>
              <Text color={w.color} weight="bold">{`■ ${w.name}`}</Text>
              <Text dimColor>{` ${w.role} · `}</Text>
              <Text>{activityLabel(w)}</Text>
              <Text dimColor>{w.id === 'boss' ? ` · ${stats.hired} hired` : ` · ${w.tools} tools · ${fmtDuration((w.endedAt ?? now) - w.joinedAt)}`}</Text>
            </Button>
          ))}
        </Box>
      )
    }

    const contextView = (): RenderElement => {
      if (!breakdown || !SvgEl) {
        return (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Working out the context breakdown (a local estimate, no tokens spent).</Text>
            <Button key="ctx-refresh" label="Work it out now" onPress={() => void refreshBreakdown($).catch(() => undefined)} />
          </Box>
        )
      }
      const card = breakdownHud(breakdown, width)

      return (
        <Box flexDirection="column" gap={1}>
          <SvgEl source={card.svg} alt={card.alt} width={card.width} height={card.height} isInteractive />
          <Box flexDirection="row" gap={1} alignItems="center">
            <Button key="ctx-refresh" label="Refresh" onPress={() => void refreshBreakdown($).catch(() => undefined)} />
            <Text dimColor>{`Last worked out ${istanbul(breakdown.at).text.slice(0, 5)} · /context for the exact count`}</Text>
          </Box>
        </Box>
      )
    }

    if (!SvgEl) {
      const busy = isBusy(turn, bossW)

      return (
        <Box flexDirection="column" gap={1}>
          <Text weight="bold" color="#FDBA74">{`CLAUDE OFFICE · ${busy ? 'Working' : 'Idle'}`}</Text>
          <Text color="#CBD5E1">{`Boss: ${bossW ? activityLabel(bossW) : 'Idle'} — ${bossW?.bubble ?? ''}`}</Text>
          <Text color={level(usage.ctxPct).color}>
            {`Context ${Math.round(usage.ctxPct ?? 0)}% (${fmtTokens(usage.ctxTokens)} / ${fmtTokens(usage.ctxWindow)})${usage.limits
              .map(l => ` · ${limitLabel(l.kind)} ${Math.round(l.pct)}%`)
              .join('')}`}
          </Text>
          {team.map(w => (
            <Text key={`t-${w.id}`} color={w.color}>{`■ ${w.name} (${w.role}) · ${activityLabel(w)} — ${w.bubble}`}</Text>
          ))}
          {toolbar}
          {tab === 'ekip' ? teamView() : null}
        </Box>
      )
    }

    if (tab === 'ekip' || tab === 'baglam') {
      return (
        <Box flexDirection="column" gap={1}>
          {toolbar}
          {tab === 'ekip' ? teamView() : contextView()}
        </Box>
      )
    }

    size = { width, fill, theme, motion: prefs.motion, auto, key: `${width}x${fill}:${theme}:${prefs.motion}:${auto.isOn}:${auto.at}` }
    if (!frame || frame.size !== size.key) {
      const at = await $.clock.now()
      const fresh = drawFrame(live, size, at)
      frame = { key: fresh.svg.replace(/animation:[^;"]*/g, ''), hud: fresh, at, size: size.key }
    }
    const hud = frame.hud

    return (
      <Box flexDirection="column" gap={1}>
        {toolbar}
        <SvgEl source={hud.svg} alt={hud.alt} width={hud.width} height={hud.height} isInteractive />
      </Box>
    )
  })
}
