import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, RenderElement } from 'claude-code'

import type { Breakdown, Daily, FeedItem, FeedKind, Stats, Tab, Talk, Turn, UiPrefs, Usage, Worker } from '../types'
import { applyPick, endAct, hireAct, pickActivity, pushMark, withEv, type ToolFacts } from './activities'
import { breakdownHud, hudSvg, isBusy, useHudTheme } from './hud'
import { ARRIVAL_WINDOW_MS, ARRIVE_MS, LEAVE_MS, layoutOffice, movesOu, nextHint, trackMoves } from './layout'
import type { Box, LayoutHint, Move, MoveState, OfficeLayout } from './layout'
import {
  EXT_DEFAULT_MODEL,
  MASCOT_INFO,
  PROFILE_DEFAULT,
  QUIPS,
  TEAM_COLORS,
  THINK_LABEL,
  activityLabel,
  baseName,
  clip,
  dutyFor,
  fatigue,
  mascotOf,
  modelLabel,
  modelLine,
  normEffort,
  numberedName,
  planOf,
  readCodexConfig,
  readExternal,
  resolveAddress,
  settleTitle,
  splitEffort,
  talkText,
  titleFor,
  fmtDuration,
  fmtTokens,
  level,
  limitLabel,
  pick,
  readTool,
  resetIn,
  roleFor,
  thinkKind,
  thoughtGist,
  istanbul,
  dayKey,
  withSample,
} from './logic'
import type { Sample } from './logic'
import { isAlive, readShared, writeShared } from './shared'

const PANE = 'piksel-ofis'
const TITLE = 'Claude Ofis'
// a burst of events lands as one redraw: fewer redraws, a steadier picture
const FLUSH_MS = 900
const LINGER_MS = 40_000
const THINK_PUSH_MS = 1600
// the desktop draws a cell of the pane about this many pixels wide and tall:
// the HUD is drawn to the pane's own size from them
const CELL_PX = 8
const ROW_PX = 17
const BOSS = { name: 'Patron', color: '#D97757' }
const OUTSIDE = { name: 'Dışarıdan', color: '#8F8D85' }

// Tags change when a value's fields change: what an older version stored is
// read as the initial value instead.
const workersA = atom({ plugin: 'piksel-ofis', key: 'workers' } as const, [] as Worker[], { shape: 'workers-1' })
const feedA = atom({ plugin: 'piksel-ofis', key: 'feed' } as const, [] as FeedItem[], { shape: 'feed-1' })
const usageA = atom({ plugin: 'piksel-ofis', key: 'usage' } as const, { ctxWindow: 0, limits: [], at: 0 } as Usage, {
  shape: 'usage-1',
})
const turnA = atom({ plugin: 'piksel-ofis', key: 'turn' } as const, { active: false, steps: 0, turns: 0 } as Turn, {
  shape: 'turn-1',
})
const breakdownA = atom({ plugin: 'piksel-ofis', key: 'breakdown' } as const, null as Breakdown | null, {
  shape: 'breakdown-1',
})
const prefsA = atom({ plugin: 'piksel-ofis', key: 'prefs' } as const, { tab: 'ofis', motion: true, compact: false } as UiPrefs, {
  shape: 'prefs-1',
})
// auto compact as this chat has it (shared with an installed usage band)
const autoA = atom({ plugin: 'piksel-ofis', key: 'auto' } as const, { isOn: false, at: 80 }, { shape: 'auto-1' })
// bumped when a held-back drawing is due, so the pane draws it
const frameA = atom({ plugin: 'piksel-ofis', key: 'frame' } as const, 0, { shape: 'frame-1' })
// the app's own light or dark theme
const themeA = atom({ plugin: 'piksel-ofis', key: 'theme' } as const, 'dark' as 'dark' | 'light', { shape: 'theme-1' })
const dailyA = atom({ plugin: 'piksel-ofis', key: 'daily' } as const, { day: '', usd: 0, sessions: 0, at: 0 } as Daily, { shape: 'daily-1' })
const statsA = atom(
  { plugin: 'piksel-ofis', key: 'stats' } as const,
  { tools: {}, hired: 0, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: 0 } as Stats,
  { shape: 'stats-1' },
)
// the office's interactions: orders, reports and messages between the desks
const talksA = atom({ plugin: 'piksel-ofis', key: 'talks' } as const, [] as Talk[], { shape: 'talks-1' })
const TALKS_MAX = 40
const TALK_TTL_MS = 10 * 60_000
// an outside worker the shell left running in the background is let go after this
const EXT_TTL_MS = 30 * 60_000
// the task of an agent seated by its first tool call (it started before the office knew it)
const PRESEATED = 'Önceden başlamış görev'

type $ = EngineInterface
type Emit = (item: FeedItem) => void
type Say = (talk: Talk) => void
type WorkerChange = (list: Worker[], now: number, emit: Emit, say: Say) => Worker[]
/** An edit of the talks; `hear` adds a feed line for a message that came from outside the office. */
type TalkEdit = (list: Talk[], now: number, hear: Emit) => Talk[]
// a message from another session counts as one from outside unless a desk here wrote to the
// same recipient this long before, still unread
const INBOUND_GRACE_MS = 15_000
const INBOUND_READ_MS = 2500

// Changes wait here and land together, so a burst of events is one redraw.
let pendingWorkers: WorkerChange[] = []
let pendingFeed: FeedItem[] = []
let pendingStats: Array<(s: Stats) => Stats> = []
let pendingTalks: TalkEdit[] = []
let flushTimer: { cancel: () => void } | null = null
type ChunkBuf = { text: string; pushedAt: number; kind?: string; textSeen: boolean; calls?: Map<number, { name: string; json: string; shown: boolean }> }
const thinking = new Map<string, ChunkBuf>()
const currentTool = new Map<string, string>()
const warned = new Set<string>()
// a SendMessage call's summary, by the loop that made it, until its session.send
const summaries = new Map<string, { summary?: string; toolUseId: string }>()
// each loop's model and effort as last patched, so an unchanged step writes nothing
const seenModel = new Map<string, string>()

// —— what each loop runs on, from wherever it is learned ——
// A worker's model and effort are learned at its hire (agent.spawn), from its own steps (turn.step),
// from the Agent call's result (resolvedModel), from the Workflow script that started it, or from an
// outside CLI's command line and config. Each is kept with its source: a later, surer one replaces it.
type Learned = { model?: string; effort?: string; from: string; at: number }
const MODEL_RANK: Readonly<Record<string, number>> = { guess: 0, workflow: 1, config: 2, cli: 3, spawn: 3, result: 4, step: 5 }
// learned before the worker was seated (a step before its hire landed): applied when it sits down
const learned = new Map<string, Learned>()
// a Workflow call's agent() options, by its tool_use_id (agent.spawn's for its agents), and the latest
type WfHint = { model?: string; effort?: string; at: number }
const wfHints = new Map<string, WfHint>()
let lastWf: WfHint | undefined
const WF_HINT_MS = 90 * 60_000
// the codex config's own model and effort ('' the default file, else a profile's file)
const codexCfg = new Map<string, { model?: string; effort?: string }>()
// workers that left the office: a late event of theirs (a last step, a list that still says running)
// does not seat them again; only a resume (agent.spawn) or a fresh tool call brings one back
const gone = new Map<string, number>()
const GONE_MS = 15 * 60_000
// the outside workers one shell call seated (an EVREN swarm seats one desk per model)
const extGroups = new Map<string, string[]>()

/** A Workflow script's agent() options: the one model and the one effort it names, if it names one of each. */
function workflowHint(script: string, now: number): WfHint {
  const distinct = (re: RegExp) => [...new Set([...script.matchAll(re)].map(m => m[1] as string))]
  // a workflow's agents are Claude loops: a 'model:' naming anything else is text (a prompt's example)
  const models = distinct(/\bmodel\s*:\s*['"`]([\w.\-[\]]{2,60})['"`]/g).filter(m => /opus|sonnet|haiku|fable|claude/i.test(m))
  const efforts = distinct(/\beffort\s*:\s*['"`]?(\w{2,12})['"`]?/g).map(e => normEffort(e)).filter((e): e is string => e !== undefined)
  const hint: WfHint = { at: now }
  if (models.length === 1) hint.model = models[0]
  if (new Set(efforts).size === 1) hint.effort = efforts[0]

  return hint
}

/** The latest Workflow call's hint, while it may still be running. */
const recentWf = (now: number): WfHint | undefined => (lastWf && now - lastWf.at < WF_HINT_MS ? lastWf : undefined)

/** A worker as it is once a model (and effort) is learned: from a surer source only; null when nothing changes. */
function withModel(w: Worker, l: Learned): Worker | null {
  const rank = MODEL_RANK[l.from] ?? 0
  const had = MODEL_RANK[w.modelFrom ?? 'guess'] ?? 0
  const split = l.model ? splitEffort(l.model) : undefined
  const model = split?.model || undefined
  const effort = normEffort(l.effort) ?? split?.effort
  const next: Worker = { ...w }
  let changed = false
  if (model && model !== w.model && (rank >= had || !w.model)) {
    next.model = model
    next.modelFrom = l.from
    delete next.guess
    changed = true
  }
  if (effort && effort !== w.effort && (rank >= had || !w.effort)) {
    next.effort = effort
    changed = true
  }

  return changed ? next : null
}

/** Learns what a loop runs on: patched at once when it is seated, kept for its seat otherwise. */
function learnModel($: $, id: string, l: Omit<Learned, 'at'>): void {
  if (!l.model && !l.effort) return
  const was = learned.get(id)
  const rank = MODEL_RANK[l.from] ?? 0
  if (!was || rank >= (MODEL_RANK[was.from] ?? 0)) learned.set(id, { model: l.model ?? was?.model, effort: l.effort ?? was?.effort, from: l.from, at: Date.now() })
  if (learned.size > 300) for (const [k, v] of learned) if (Date.now() - v.at > GONE_MS) learned.delete(k)
  changeWorkers($, list => {
    const at = list.findIndex(w => w.id === id)
    if (at < 0) return list
    const next = withModel(list[at] as Worker, { ...l, at: 0 })
    if (!next) return list
    const out = list.slice()
    out[at] = next

    return out
  })
}

/** The guess for a worker whose model is not known yet: its parent's model (the boss's, else its guess). */
function guessOf(list: readonly Worker[], parentId: string | undefined): string | undefined {
  const p = list.find(w => w.id === (parentId ?? 'boss'))

  return p?.model || p?.guess
}

/** Reads the codex config files a run may use (no process is ever started): the default and a profile's. */
async function loadCodexCfg($: $, profile = ''): Promise<void> {
  if (codexCfg.has(profile)) return
  codexCfg.set(profile, {})
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (!home) return
    const file = profile === '' ? 'config.toml' : `${profile}.config.toml`
    const text = String(await $.fs.read(`${home}/.codex/${file}`))
    codexCfg.set(profile, readCodexConfig(text))
  } catch {
    // no file: the defaults stand
  }
}

/** Whether a worker runs workers of its own in the office, agents or outside CLIs (its title is then 'Yedek Patron'). */
const isParent = (list: readonly Worker[], id: string): boolean => id !== 'boss' && list.some(x => x.parentId === id && x.id !== id && x.endedAt === undefined && x.activity !== 'leaving')

// the title of a worker nothing tells about yet: the first telling work replaces it at once
const NO_TITLE = 'Asistan'

/** A worker's title brought up to date with what it does, held steady (twice in a row), and its numbered name. */
function retitle(w: Worker, list: readonly Worker[], force = false): Worker {
  if (w.id === 'boss') return w
  const cand = titleFor({ ...w, type: w.agentType }, isParent(list, w.id))
  // nothing telling (thinking, a hand-off): the title stays as it is
  if (cand === NO_TITLE && w.title && !force) return w
  const s = force || w.title === NO_TITLE ? { title: cand } : settleTitle(w.title, w.titleNext, cand)
  const out: Worker = { ...w, title: s.title }
  if (s.next) out.titleNext = s.next
  else delete out.titleNext
  if (s.title !== w.title || !w.title) out.name = numberedName(s.title, list, w.id)

  return out
}
// when the last news (an order, a report, a message, an outside worker, an error) landed
let newsAt = 0

// —— the drawing, held steady ——
// The overview is not drawn from the live values: each change to them (every tool
// call, every measurement) redrew the pane, and the app reloads the image on every
// draw, which flickered while Claude worked. A timer paints a new frame instead, at
// most every FRAME_MS and only when the picture has changed; the pane draws only
// when a new frame lands (the motion runs inside the image).
const FRAME_MS = 8000
// news (an order, a report, a message) is painted sooner, while it is still happening
const URGENT_MS = 2500
type Snap = { workers: Worker[]; feed: FeedItem[]; usage: Usage; turn: Turn; stats: Stats; daily: Daily; talks: Talk[] }
type Size = { width: number; fill: number; theme: 'dark' | 'light'; motion: boolean; auto: { isOn: boolean; at: number }; key: string }
let snap: Snap | undefined
let size: Size | undefined
let frame: { key: string; hud: ReturnType<typeof hudSvg>; at: number; size: string } | undefined

/** What the picture shows, without the animations' start times: those differ on every draw. */
const frameKey = (svg: string): string => svg.replace(/animation(?:-delay)?:[^;"]*/g, '').replace(/ begin="[^"]*"/g, '')

// —— the office's layout and its walks, kept between frames (module memory: a reload draws everyone in place) ——
// the last layout, kept while it still holds the team (no reshuffle for one hire or one exit)
let layoutHint: LayoutHint | undefined
let hintDims = ''
// where everyone stood in the last frame and who is walking where (pane pixels)
let moveState: MoveState | undefined

// the picture's input: 0.6's fields and 0.7's (layout, walks, the settled picture)
type HudArgs = Parameters<typeof hudSvg>[0] & {
  talks?: readonly Talk[]
  lastFrameAt?: number
  layout?: OfficeLayout
  moves?: ReadonlyMap<string, Move>
  relayout?: { at: number; prevCells: Box[] }
  settled?: boolean
}
type Extra = Pick<HudArgs, 'layout' | 'moves' | 'relayout' | 'settled'>

/** The drawing's height: the pane's rows less the toolbar, never so small that the office cannot be laid out. */
const heightOf = (at: Size): number => Math.max(160, at.fill)

/** Draws a frame; `lastFrameAt` is when the previous one was drawn, so events since then play from their start. */
function drawFrame(s: Snap, at: Size, now: number, lastFrameAt: number | undefined, extra: Extra): ReturnType<typeof hudSvg> {
  useHudTheme(at.theme)
  const args: HudArgs = { ...s, now, motion: at.motion, width: at.width, fill: heightOf(at), autoCompact: at.auto, daily: s.daily, talks: s.talks, lastFrameAt, ...extra }

  return hudSvg(args)
}

/** The office for this frame: the last layout is kept while it fits; a new pane size starts afresh. */
function officeOf(s: Snap, at: Size, now: number): OfficeLayout {
  const dims = `${at.width}x${heightOf(at)}`
  if (dims !== hintDims) {
    hintDims = dims
    layoutHint = undefined
  }
  const spotsPx = moveState && moveState.sizeKey === at.key ? { ...moveState.spots, ...(moveState.leaving ?? {}) } : undefined

  return layoutOffice({ workers: s.workers, W: at.width, H: heightOf(at), hint: layoutHint, now, spotsPx })
}

/** The latest talk's time: news that has to be drawn even when it leaves the settled picture as it was. */
const stampOf = (talks: readonly Talk[]): number => talks.reduce((m, t) => Math.max(m, t.t), 0)

/** The latest one-off activity's start (a confetti, a spark, a paper plane): it is drawn once, then ends by its own animation. */
const evStamp = (workers: readonly Worker[]): number => workers.reduce((m, w) => Math.max(m, w.act?.ev?.at ?? 0), 0)

/**
 * The frame's key: the settled picture (everyone at their place and in their lasting state, nothing
 * walking, flying or fading) and the latest talk. A walk, a plane or a bubble ending changes neither,
 * so none of them redraws the pane; every passing thing ends by its own animation.
 */
function settledKey(s: Snap, at: Size, now: number, L: OfficeLayout): string {
  return `${frameKey(drawFrame(s, at, now, undefined, { layout: L, settled: true }).svg)}|${stampOf(s.talks)}|${evStamp(s.workers)}`
}

/** The picture as it plays: the tracker walks whoever's place changed, then the frame is drawn with the walks. */
function drawLive(s: Snap, at: Size, now: number, lastFrameAt: number | undefined, L: OfficeLayout): ReturnType<typeof hudSvg> {
  moveState = trackMoves(moveState, L, s.workers, now, at.key, fatigue(s.usage, now))
  layoutHint = nextHint(layoutHint, L, now)
  const st = moveState
  const relayout = st.relayoutAt !== undefined && st.prevCells ? { at: st.relayoutAt, prevCells: st.prevCells } : undefined

  return drawFrame(s, at, now, lastFrameAt, { layout: L, moves: movesOu(st, L, now), relayout, settled: false })
}

async function readSnap($: $): Promise<Snap> {
  const [workers, feed, usage, turn, stats, daily, talks] = await Promise.all([read($, workersA), read($, feedA), read($, usageA), read($, turnA), read($, statsA), read($, dailyA), read($, talksA)])

  return { workers, feed, usage, turn, stats, daily, talks }
}

// the settled picture is drawn to be compared, not shown: an unchanged state is not drawn again for
// it within a quarter minute (what the settled picture shows of the clock moves in minutes)
const CHECK_MS = 15_000
let checked: { sig: string; key: string } | undefined

async function paint($: $): Promise<void> {
  snap = await readSnap($)
  if (!size) return
  const now = await $.clock.now()
  const wait = frame && newsAt > frame.at ? URGENT_MS : FRAME_MS
  if (frame && frame.size === size.key && now - frame.at < wait) return
  const hintSig = layoutHint ? `${layoutHint.topo}|${layoutHint.s}|${layoutHint.variant}|${layoutHint.cols}|${layoutHint.rows}|${layoutHint.at}` : ''
  const sig = `${size.key}|${Math.floor(now / CHECK_MS)}|${hintSig}|${JSON.stringify(snap)}`
  if (frame && frame.size === size.key && checked?.sig === sig && checked.key === frame.key) return
  const L = officeOf(snap, size, now)
  const key = settledKey(snap, size, now, L)
  checked = { sig, key }
  if (frame && frame.size === size.key && frame.key === key) return
  const hud = drawLive(snap, size, now, frame?.at, L)
  frame = { key, hud, at: now, size: size.key }
  await update($, frameA, n => n + 1)
}

// —— auto compact ——
const AT_MIN = 15
const AT_MAX = 95
const AT_STEP = 5
// An installed usage band runs auto compact; the office runs it when alone.
const PARTNERS = ['usage-band']
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
  $.ui.toast(next.isOn ? `Oto-sıkıştırma açık: bağlam %${next.at} olunca` : 'Oto-sıkıştırma kapalı')
}

function compactNow($: $): void {
  if (isCompacting) return
  isCompacting = true
  // compacting outlasts a press or a hook: a timer starts it
  $.clock.after(0, async () => {
    try {
      await $.command.run({ command: 'compact' })
    } catch (error) {
      $.ui.toast(`Sıkıştırma başlatılamadı: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      isCompacting = false
    }
  })
}

/** Between turns, at or past the %: compacts once (unless a usage band runs it). */
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
  $.ui.toast(`Bağlam %${Math.round(pct)}: oto-sıkıştırılıyor (eşik %${auto.at})`)
  $.clock.after(1000, async () => {
    try {
      try {
        await $.session.compact()
      } catch {
        // the desktop app compacts as a turn of its own: typed, as the button does
        await $.command.run({ command: 'compact' })
      }
    } catch (error) {
      $.ui.toast(`Oto-sıkıştırma başlatılamadı: ${error instanceof Error ? error.message : String(error)}`)
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

// —— the day's cost and the limits' pace, shared across chats ——
// Each chat keeps its own cost under `gun:<day>:<chat>` ({usd, base}: base is what it had
// cost when the day began, for a chat that started yesterday); the day is their sum.
// The limits are the account's: every chat adds its readings to one list per limit
// (`lim`), so the pace counts what all of them spend.
const LIM_KEY = 'lim'
type LimStore = Record<string, { reset?: string; s: Sample[] }>

async function syncDaily($: $): Promise<void> {
  const now = await $.clock.now()
  const day = dayKey(now)
  const sid = await chatOf($)
  const [usage, stats] = await Promise.all([read($, usageA), read($, statsA)])
  const usd = usage.usd
  if (usd !== undefined) {
    const key = `gun:${day}:${sid}`
    const had = (await $.store.get(key)) as { usd: number; base: number } | undefined
    const base = had ? had.base : stats.sessionStart && dayKey(stats.sessionStart) === day ? 0 : usd
    if (!had || Math.abs(had.usd - usd) >= 0.005) await $.store.set(key, { usd, base })
  }
  let total = 0
  let sessions = 0
  for (const key of await $.store.keys()) {
    if (!key.startsWith('gun:')) continue
    if (!key.startsWith(`gun:${day}:`)) {
      // older than three days: dropped
      const d = key.slice(4, 14)
      if (Date.parse(d) < now - 3 * 86_400_000) await $.store.delete(key).catch(() => undefined)
      continue
    }
    const v = (await $.store.get(key)) as { usd?: number; base?: number } | undefined
    const spent = Math.max(0, (v?.usd ?? 0) - (v?.base ?? 0))
    if (spent > 0.004) {
      total += spent
      sessions++
    }
  }
  const was = await read($, dailyA)
  if (was.day !== day || Math.abs(was.usd - total) >= 0.005 || was.sessions !== sessions) {
    await update($, dailyA, () => ({ day, usd: total, sessions, at: now }))
  }
}

/** Adds this reading of each limit to the shared list; returns every limit's list. */
async function syncSamples($: $, limits: ReadonlyArray<{ kind: string; pct: number; resetsAt?: string }>, now: number): Promise<Record<string, Sample[]>> {
  let all: LimStore = {}
  try {
    all = ((await $.store.get(LIM_KEY)) as LimStore | undefined) ?? {}
  } catch {
    all = {}
  }
  let changed = false
  for (const l of limits) {
    const had = all[l.kind]
    const fresh = !had || had.reset !== l.resetsAt
    const before = fresh ? [] : had.s
    const s = withSample(before, now, l.pct)
    if (fresh || s.length !== before.length) {
      all[l.kind] = { reset: l.resetsAt, s }
      changed = true
    }
  }
  if (changed) await $.store.set(LIM_KEY, all).catch(() => undefined)

  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.s]))
}

/** The context % trail the sparkline draws: a new point only when it moved. */
function withHistory(list: readonly number[] | undefined, pct: number): number[] {
  const all = list ?? []
  const last = all[all.length - 1]

  return last !== undefined && Math.abs(last - pct) < 0.5 ? all.slice() : [...all, Math.round(pct * 10) / 10].slice(-60)
}

/** 'Sonnet 5.5 · yüksek': the whole model and its effort, as known ('model okunuyor' until then); the platform when not Claude Code's own. */
function whoLine(w: Worker): string {
  const parts = [modelLine(w.model, w.effort, w.via)]
  if (w.via === 'agy') parts.push('Antigravity')
  else if (w.via === 'evren' && w.model && w.model !== 'evren') parts.push('EVREN')

  return parts.join(' · ')
}

/** '2dk' and '45sn': the team list's time at the desk, without the seconds past a minute. */
function shortDuration(ms: number): string {
  return fmtDuration(ms).replace(/ \d+sn$/, '').replace(/ 0dk$/, '')
}

/** '✉ Patron → Ada · Testleri çalıştır': one talk as a line of text. */
function talkLine(t: Talk, workers: readonly Worker[], feedList: readonly FeedItem[]): string {
  // someone outside the office: the name the message was sent to, as its feed line kept it
  const outside = () => feedList.find(f => f.kind === 'talk' && f.t === t.t && f.toId === '')?.to ?? 'başka oturum'
  const name = (id: string) => (id === '' ? outside() : workers.find(w => w.id === id)?.name ?? (id === 'boss' ? BOSS.name : 'eski çalışan'))
  const mark = t.kind === 'order' ? '✈' : t.kind === 'report' ? '⇠' : '✉'
  // a message from another session: "Dışarıdan"
  const from = t.from === '' ? OUTSIDE.name : name(t.from)

  return `${mark} ${from} → ${name(t.to)} · ${t.isDelivered ? '' : 'ulaşmadı · '}${t.text}`
}

const strOf = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** A call's facts for its activity: what it reads, runs or says, used there and then and never kept. */
function toolFacts(tool: string, input: Record<string, unknown>, external: boolean): ToolFacts {
  const isShell = tool === 'Bash' || tool === 'PowerShell'
  const f: ToolFacts = { tool, phase: 'call' }
  const file = strOf(input.file_path) ?? strOf(input.notebook_path) ?? strOf(input.path)
  if (file) f.file = file
  if (isShell) {
    const cmd = strOf(input.command)
    if (cmd) f.cmd = cmd
    if (input.run_in_background === true) f.bg = true
  }
  const skill = strOf(input.skill)
  if (skill) f.skill = skill
  const text = tool === 'Grep' ? strOf(input.pattern) : [input.description, input.summary, input.prompt, input.message].filter((v): v is string => typeof v === 'string').join(' ').slice(0, 2000)
  if (text) f.text = text
  const type = strOf(input.subagent_type)
  if (type) f.agentType = type
  if (Array.isArray(input.findings)) f.findings = input.findings.length
  if (external) f.external = true

  return f
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
  const edits = pendingTalks
  pendingWorkers = []
  pendingFeed = []
  pendingStats = []
  pendingTalks = []
  const now = await $.clock.now()
  // What the changes say goes to the feed, from the attempt that was written.
  let said: FeedItem[] = []
  let talks: Talk[] = []
  let heard: FeedItem[] = []
  let ends = { done: 0, failed: 0 }
  try {
    if (changes.length > 0) {
      await update($, workersA, list => {
        said = []
        talks = []
        const out = changes.reduce(
          (acc, fn) =>
            fn(
              acc,
              now,
              one => said.push({ ...one, text: clip(one.text, 160) }),
              talk => talks.push(talk),
            ),
          list,
        )
        ends = countEnds(list, out)

        return handBack(list, out, now)
      })
    }
    if (talks.length > 0 || edits.length > 0) {
      const fresh = talks
      await update($, talksA, list => {
        heard = []
        // a talk said again (a second report) replaces the first, so it plays anew
        const ids = new Set(fresh.map(t => t.id))
        const all = edits.reduce((acc, fn) => fn(acc, now, one => heard.push({ ...one, text: clip(one.text, 160) })), [...list.filter(t => !ids.has(t.id)), ...fresh])

        return all.filter(t => now - t.t < TALK_TTL_MS).slice(-TALKS_MAX)
      })
    }
    const feed = [...queued, ...said, ...heard].sort((a, b) => a.t - b.t)
    if (talks.length > 0 || heard.length > 0 || feed.some(f => f.kind === 'ext' || f.kind === 'fail')) newsAt = now
    if (feed.length > 0) await update($, feedA, list => [...list, ...feed].slice(-90))
    // the office's counters: finished and failed jobs, reports, messages between the desks, messages from outside
    const reports = talks.filter(t => t.kind === 'report').length
    const messages = talks.filter(t => t.kind === 'message' && t.from !== '' && t.to !== '').length
    const inbound = heard.length
    if (ends.done + ends.failed + reports + messages + inbound > 0) {
      const add = { ...ends }
      stats.push(s => ({
        ...s,
        done: (s.done ?? 0) + add.done,
        failed: (s.failed ?? 0) + add.failed,
        reports: (s.reports ?? 0) + reports,
        messages: (s.messages ?? 0) + messages,
        inbound: (s.inbound ?? 0) + inbound,
      }))
    }
    if (stats.length > 0) await update($, statsA, s => stats.reduce((acc, fn) => fn(acc), s))
  } catch {
    // A lost write only costs one frame of the office.
  }
}

/** A worker whose job ended in this change hands its work back: its parent passes the baton (2 s, then its own activity). */
function handBack(before: readonly Worker[], after: Worker[], now: number): Worker[] {
  const was = new Map(before.map(w => [w.id, w]))
  const parents = new Set<string>()
  for (const w of after) {
    if (w.id === 'boss' || w.endedAt === undefined || was.get(w.id)?.endedAt !== undefined) continue
    parents.add(parentOf(after, w))
  }
  if (parents.size === 0) return after

  return after.map(w => (parents.has(w.id) && w.endedAt === undefined && w.activity !== 'leaving' ? { ...w, act: withEv(w.act ?? { at: now, seen: now }, 'handoff-baton', now) } : w))
}

/** Workers whose job ended in this change: done (the coffee corner's cups) and failed. */
function countEnds(before: readonly Worker[], after: readonly Worker[]): { done: number; failed: number } {
  const was = new Map(before.map(w => [w.id, w]))
  const out = { done: 0, failed: 0 }
  for (const w of after) {
    if (w.id === 'boss' || w.endedAt === undefined) continue
    const b = was.get(w.id)
    if (b && b.endedAt !== undefined) continue
    if (w.activity === 'failed') out.failed++
    else out.done++
  }

  return out
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

function feed($: $, who: Worker | { name: string; color: string; id?: string }, kind: FeedKind, text: string): void {
  pendingFeed.push(item(Date.now(), who, kind, text))
  schedule($)
}

function item(t: number, who: Pick<Worker, 'name' | 'color'> & { id?: string }, kind: FeedKind, text: string): FeedItem {
  const row: FeedItem = { t, who: who.name, color: who.color, kind, text: clip(text, 160) }
  if (who.id) row.whoId = who.id

  return row
}

/** A talk between two desks, with its feed line; `to` '' is someone outside the office. */
function sayTalk(list: readonly Worker[], now: number, emit: Emit, say: Say, talk: Omit<Talk, 't'>, toName?: string): void {
  say({ ...talk, t: now })
  const from = list.find(w => w.id === talk.from) ?? { id: 'boss', name: BOSS.name, color: BOSS.color }
  const to = list.find(w => w.id === talk.to)
  emit({
    t: now,
    who: from.name,
    color: from.color,
    whoId: from.id,
    kind: 'talk',
    text: talk.isDelivered ? talk.text : `ulaşmadı · ${talk.text}`,
    to: to?.name ?? toName ?? 'başka oturum',
    toColor: to?.color ?? '#8F8D85',
    toId: talk.to,
  })
}

/** Ends a worker's job: done or failed, from now on idle at its desk until it leaves. */
function ended(w: Worker, now: number, isFailed: boolean, extra: Partial<Worker> = {}): Worker {
  return {
    ...w,
    activity: isFailed ? 'failed' : 'done',
    since: now,
    endedAt: now,
    idleSince: now,
    bubble: isFailed ? pick(QUIPS.fail, w.id) : pick(QUIPS.done, w.id),
    // its activity ends with it: a confetti, or a spark (the one-off stays to play)
    act: endAct(w.act, isFailed, now),
    ...extra,
  }
}

/** Who reports to whom: the worker's parent when it is still in the office, else the boss. */
function parentOf(list: readonly Worker[], w: Worker): string {
  const p = w.parentId

  return p && list.some(x => x.id === p) ? p : 'boss'
}

function stat($: $, fn: (s: Stats) => Stats): void {
  pendingStats.push(fn)
  schedule($)
}

/** A newcomer's place in desk order (the layout packs by hire time; `seat` only keeps the stored shape). */
function packIndex(list: readonly Worker[]): number {
  return list.filter(w => w.id !== 'boss' && w.activity !== 'leaving').length
}

function newBoss(now: number, name: string): Worker {
  return {
    id: 'boss',
    n: -1,
    name,
    role: 'Patron',
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

type HireInfo = {
  id: string
  type: string
  task: string
  isFork?: boolean
  isWorkflow?: boolean
  name?: string
  model?: string
  effort?: string
  /** where the model came from (MODEL_RANK) */
  from?: string
  /** a family to look like until the model is known */
  guess?: string
  parentId?: string
  addr?: Array<string | undefined>
}

const addrOf = (list: ReadonlyArray<string | undefined>): string[] => [...new Set(list.filter((a): a is string => typeof a === 'string' && a !== ''))]

/** Seats a new employee; the one who hired them points them to their desk. */
function hire($: $, info: HireInfo): void {
  changeWorkers($, (list, now, emit, say) => {
    const had = list.findIndex(w => w.id === info.id)
    // already seated (by its first tool call, before this spawn landed): the spawn's model, task,
    // type, name and parent fill in what the early seat could not know
    if (had >= 0) {
      const w = list[had] as Worker
      let next: Worker = withModel(w, { model: info.model, effort: info.effort, from: info.from ?? 'spawn', at: now }) ?? w
      let changed = next !== w
      if (w.task === PRESEATED && info.task) {
        const parentId = info.parentId && info.parentId !== w.id && list.some(x => x.id === info.parentId) ? info.parentId : w.parentId
        next = { ...next, task: clip(info.task, 120), agentType: info.isFork ? 'fork' : info.type, role: roleFor(info.type, info.isFork, info.isWorkflow), duty: dutyFor({ type: info.type, task: info.task, writes: w.writes }), ...(parentId ? { parentId } : {}) }
        if (!w.act?.id) {
          const act = hireAct(info.task, info.type, false, w.id, now)
          if (act) next.act = act
        }
        changed = true
      }
      const addr = addrOf([...(w.addr ?? []), ...(info.addr ?? [])])
      if (addr.length !== (w.addr ?? []).length) {
        next = { ...next, addr }
        changed = true
      }
      if (!changed) return list
      if (next.model) {
        delete next.guess
        seenModel.set(info.id, `${next.model}|${next.effort ?? ''}`)
      } else if (!next.guess) {
        const guess = info.guess ?? guessOf(list, next.parentId)
        if (guess) next.guess = guess
      }
      const out = list.slice()
      out[had] = retitle(next, list, true)

      return out
    }
    gone.delete(info.id)
    const index = nextHire(list)
    const parentId = info.parentId && list.some(w => w.id === info.parentId) ? info.parentId : 'boss'
    let worker: Worker = {
      id: info.id,
      n: index,
      name: '',
      role: roleFor(info.type, info.isFork, info.isWorkflow),
      task: clip(info.task || 'Görev', 120),
      color: TEAM_COLORS[index % TEAM_COLORS.length] as string,
      seat: packIndex(list),
      activity: 'thinking',
      think: 'general',
      bubble: '',
      detail: '',
      tools: 0,
      tokensOut: 0,
      since: now + ARRIVE_MS,
      joinedAt: now,
      kind: 'agent',
      parentId,
      duty: dutyFor({ type: info.type, task: info.task, writes: 0 }),
      writes: 0,
      agentType: info.isFork ? 'fork' : info.type,
    }
    // what its job looks like from the start (an Explore agent maps, a "draw the logo" one paints)
    const act = hireAct(info.task, info.type, false, info.id, now)
    if (act) worker.act = act
    // what it runs on: the spawn's own, else what was learned before it sat down; a guess for its look meanwhile
    for (const l of [info.model || info.effort ? { model: info.model, effort: info.effort, from: info.from ?? 'spawn', at: now } : undefined, learned.get(info.id)]) {
      if (l) worker = withModel(worker, l) ?? worker
    }
    if (!worker.model) {
      const guess = info.guess ?? guessOf(list, parentId)
      if (guess) worker.guess = guess
    }
    worker = retitle(worker, list, true)
    const addr = addrOf(info.addr ?? [])
    if (addr.length > 0) worker.addr = addr
    if (worker.model) seenModel.set(info.id, `${worker.model}|${worker.effort ?? ''}`)
    emit({ t: now, who: worker.name, color: worker.color, whoId: worker.id, kind: 'hire', text: `işe başladı · ${clip(worker.task, 40)}` })
    const all = list.concat(worker)
    sayTalk(all, now, () => undefined, say, { id: `ord:${worker.id}`, from: parentId, to: worker.id, kind: 'order', text: talkText(undefined, info.task) || 'Yeni görev', isDelivered: true })

    return all.map(w =>
      w.id === parentId
        ? // an agent that hires its own is a deputy boss from now on
          retitle({ ...w, activity: 'delegating' as const, since: now, bubble: `${worker.name}, ${clip(info.task || 'şu işe bak', 28)}!`, detail: info.task }, all, true)
        : w,
    )
  })
  stat($, s => ({ ...s, hired: s.hired + 1 }))
}

/** Seats an outside worker (codex, gemini, agy run from the shell) for the call that started it. */
function hireExternal($: $, info: { id: string; parentId: string; ext: NonNullable<ReturnType<typeof readExternal>>; description: string }): void {
  const ext = info.ext
  // the platform: Antigravity gets its badge; EVREN (its helper, or codex on the evren profile) its own character
  const via: Worker['via'] = ext.cli === 'agy' ? 'agy' : ext.cli === 'evren' || ext.profile === 'evren' ? 'evren' : undefined
  // no -m: the profile's file (codex -p evren: glm-5.3, high), else codex's own config, else the family's name
  const cfg = ext.cli === 'codex' ? (ext.profile ? { ...PROFILE_DEFAULT[ext.profile], ...codexCfg.get(ext.profile) } : codexCfg.get('')) : undefined
  const base = ext.cli === 'codex' && ext.profile && ext.profile !== 'evren' ? codexCfg.get('') : undefined
  const fallModel = cfg?.model ?? base?.model ?? (via === 'evren' ? EXT_DEFAULT_MODEL.evren : EXT_DEFAULT_MODEL[ext.cli])
  const fallEffort = ext.effort ?? cfg?.effort ?? base?.effort
  // an EVREN swarm takes one desk per model
  const runs = ext.models && ext.models.length > 1 ? ext.models : [{ model: ext.model ?? fallModel, effort: fallEffort }]
  const ids = runs.map((_, k) => (k === 0 ? info.id : `${info.id}#${k + 1}`))
  extGroups.set(info.id, ids)
  if (extGroups.size > 200) for (const k of extGroups.keys()) if (extGroups.size > 150) extGroups.delete(k)
  const duty = dutyFor({ sandbox: ext.sandbox })
  changeWorkers($, (list, now, emit, say) => {
    let all = list
    runs.forEach((run, k) => {
      const id = ids[k] as string
      if (all.some(w => w.id === id)) return
      const model = run.model
      const effort = run.effort ?? fallEffort
      const kind = via === 'evren' ? 'evren' : mascotOf(model)
      const look = MASCOT_INFO[kind]
      const label = modelLabel(model, via)
      const index = nextHire(all)
      const parentId = all.some(w => w.id === info.parentId) ? info.parentId : 'boss'
      let worker: Worker = {
        id,
        n: index,
        name: '',
        role: 'Dış işçi',
        task: clip(info.description || 'Dış görev', 120),
        color: look.accent,
        seat: packIndex(all),
        activity: 'running',
        bubble: duty === 'critic' ? 'İnceliyorum (salt okunur)' : duty === 'builder' ? 'Kod yazıyorum' : 'Çalışıyorum',
        detail: '',
        tools: 0,
        tokensOut: 0,
        since: now + ARRIVE_MS,
        joinedAt: now,
        kind: 'external',
        model,
        modelFrom: ext.model ? 'cli' : 'config',
        parentId,
        duty,
        writes: 0,
        screen: { kind: 'ext', label, at: now },
      }
      // on the line: a headset at its desk, the radio call that brought it in
      const act = hireAct(info.description, undefined, true, id, now)
      if (act) worker.act = act
      if (via) worker.via = via
      if (effort) worker.effort = effort
      worker = retitle(worker, all, true)
      all = all.concat(worker)
      emit({ t: now, who: worker.name, color: look.accent, whoId: worker.id, kind: 'ext', text: `${modelLine(model, effort, via)} · başladı${info.description ? ` · ${clip(info.description, 40)}` : ''}` })
      sayTalk(all, now, () => undefined, say, { id: `ord:${worker.id}`, from: parentId, to: worker.id, kind: 'order', text: talkText(undefined, info.description) || 'Dış görev', isDelivered: true })
    })
    // an agent that hands work to outside CLIs is a deputy boss while they run
    const parent = info.parentId

    return parent === 'boss' ? all : all.map(w => (w.id === parent ? retitle(w, all, true) : w))
  })
  stat($, s => ({ ...s, hired: s.hired + runs.length }))
}

/** The desks one shell call seated (one, or a swarm's). */
const groupOf = (id: string): ReadonlySet<string> => new Set(extGroups.get(id) ?? [id])

/** An outside worker's run is over: it reports back to whoever started it. */
function endExternal($: $, id: string, isFailed: boolean): void {
  const ids = groupOf(id)
  changeWorkers($, (list, now, emit, say) =>
    list.map(w => {
      if (!ids.has(w.id) || w.endedAt !== undefined) return w
      const label = modelLabel(w.model, w.via)
      emit(item(now, w, 'ext', `${label} · ${isFailed ? 'hata verdi' : 'bitirdi'}${w.task && w.task !== 'Dış görev' ? ` · ${clip(w.task, 40)}` : ''}`))
      say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(list, w), kind: 'report', text: isFailed ? 'Bir sorun çıktı' : 'İş bitti, sonuç hazır', isDelivered: true })

      return ended(w, now, isFailed)
    }),
  )
}

/** The shell's background tasks still running: an outside worker whose task is gone has finished. */
function settleBackground($: $, tasks: ReadonlyArray<{ id: string }> | undefined): void {
  if (!Array.isArray(tasks)) return
  const live = new Set(tasks.map(t => t.id))
  changeWorkers($, (list, now, emit, say) => {
    let changed = false
    const out = list.map(w => {
      if (w.kind !== 'external' || !w.taskId || w.endedAt !== undefined || live.has(w.taskId)) return w
      changed = true
      emit(item(now, w, 'ext', `${modelLabel(w.model, w.via)} · bitirdi${w.task && w.task !== 'Dış görev' ? ` · ${clip(w.task, 40)}` : ''}`))
      say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(list, w), kind: 'report', text: 'İş bitti, sonuç hazır', isDelivered: true })

      return ended(w, now, false)
    })

    return changed ? out : list
  })
}

/**
 * What the engine's agent list says about a seated worker, as the worker it makes
 * (null: nothing changed). An idle teammate waits at its desk; one that runs again
 * gets back to work, even after it had finished.
 */
function fromList(w: Worker, info: AgentInfo, now: number, say: Say | null, list: readonly Worker[]): Worker | null {
  let next: Worker | null = null
  const ends = info.status === 'completed' || info.status === 'failed' || info.status === 'killed'
  if (w.activity === 'leaving') return null
  if (ends) {
    if (w.endedAt === undefined) {
      next = ended(w, now, info.status !== 'completed')
      if (say) say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(list, w), kind: 'report', text: info.status === 'completed' ? 'Rapor hazır' : 'Görev yarım kaldı', isDelivered: true })
    }
  } else if (info.status === 'waiting') {
    if (w.endedAt === undefined && w.activity !== 'waiting') next = { ...w, activity: 'waiting', since: now, bubble: 'Onay bekliyorum…' }
  } else if (info.status === 'idle') {
    if (w.endedAt === undefined && w.activity !== 'idle') next = { ...w, activity: 'idle', since: now, idleSince: now, bubble: 'Mesaj bekliyorum…' }
  } else if (info.status === 'running') {
    // a finished worker is not brought back by the list alone (it lags behind the end): a resume or
    // a tool call of its own does that; a teammate that waited gets back to work
    if (w.endedAt === undefined && w.activity === 'idle') {
      next = { ...w, activity: 'thinking', think: 'general', since: now, idleSince: undefined, bubble: 'Mesaj geldi, bakıyorum' }
    }
  }
  const addr = addrOf([...(w.addr ?? []), info.name, info.teammateId])
  if (addr.length !== (w.addr ?? []).length) next = { ...(next ?? w), addr }
  // seated before the office knew it (its first tool call): the list names its task, type and parent
  if (w.task === PRESEATED && info.description) {
    const base = next ?? w
    const parentId = info.parentId && list.some(x => x.id === info.parentId) ? info.parentId : base.parentId
    next = retitle({ ...base, task: clip(info.description, 120), agentType: info.type, role: roleFor(info.type), duty: dutyFor({ type: info.type, task: info.description, writes: base.writes }), ...(parentId ? { parentId } : {}) }, list, true)
    if (!next.model && parentId) {
      const guess = guessOf(list, parentId)
      if (guess) next.guess = guess
    }
  }

  return next
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
  for (const [id, at] of gone) if (now - at > GONE_MS) gone.delete(id)
  for (const a of agents) {
    const live = a.status === 'running' || a.status === 'pending' || a.status === 'waiting'
    // one that just left is still listed as running a moment: it is not walked in again
    if (!known.has(a.id) && live && !gone.has(a.id)) {
      hire($, { id: a.id, type: a.type, task: a.description, name: a.name, parentId: a.parentId ?? 'boss', addr: [a.name, a.teammateId] })
    }
  }
  const byId = new Map(agents.map(a => [a.id, a]))
  // an outside worker left in the background past its time is let go
  const isStale = (w: Worker, at: number) => w.kind === 'external' && w.endedAt === undefined && at - w.joinedAt > EXT_TTL_MS
  const needs = list.some(w => {
    if (w.id === 'boss') return w.activity === 'delegating' && now - w.since > 5000
    const info = byId.get(w.id)
    if (info && fromList(w, info, now, null, list)) return true
    if (isStale(w, now)) return true
    if (w.endedAt !== undefined && w.activity !== 'leaving' && now - w.endedAt > LINGER_MS) return true
    if (w.activity === 'leaving' && now - w.since > LEAVE_MS + 800) return true

    return false
  })
  if (!needs) return
  changeWorkers($, (all, at, emit, say) => {
    const out: Worker[] = []
    for (const w of all) {
      if (w.id === 'boss') {
        out.push(w.activity === 'delegating' && at - w.since > 5000 ? { ...w, activity: 'thinking', think: 'general', since: at, bubble: 'Ekip çalışıyor, takipteyim.' } : w)
        continue
      }
      if (w.activity === 'leaving' && at - w.since > LEAVE_MS + 800) {
        gone.set(w.id, at)
        // its per-loop notes go with it (a long session does not keep them all)
        currentTool.delete(w.id)
        seenModel.delete(w.id)
        thinking.delete(w.id)
        continue
      }
      if (w.endedAt !== undefined && w.activity !== 'leaving' && at - w.endedAt > LINGER_MS) {
        out.push({ ...w, activity: 'leaving', since: at, bubble: '' })
        continue
      }
      if (isStale(w, at)) {
        emit(item(at, w, 'ext', `${modelLabel(w.model, w.via)} · süresi doldu`))
        out.push(ended(w, at, false, { bubble: 'Süre doldu, çıkıyorum' }))
        continue
      }
      const info = byId.get(w.id)
      const next = info ? fromList(w, info, at, say, all) : null
      out.push(next ?? w)
    }

    return out
  })
}

const INPUT_PATH = /"(file_path|notebook_path|path)"\s*:\s*"([^"]+)/

function observeChunk($: $, id: string, chunk: { kind: string; text?: string; name?: string; json?: string; index?: number }): void {
  const buf: ChunkBuf = thinking.get(id) ?? { text: '', pushedAt: 0, textSeen: false }
  if (chunk.kind === 'tool' && chunk.name && typeof chunk.index === 'number') {
    buf.calls = buf.calls ?? new Map()
    buf.calls.set(chunk.index, { name: chunk.name, json: '', shown: false })
  } else if (chunk.kind === 'input' && typeof chunk.json === 'string' && typeof chunk.index === 'number') {
    // the arguments stream in: once the file is named, the bubble says which
    const call = buf.calls?.get(chunk.index)
    if (call && !call.shown) {
      call.json = (call.json + chunk.json).slice(0, 4000)
      const m = INPUT_PATH.exec(call.json)
      // the path is whole once its closing quote has arrived
      if (m && call.json.length > (m.index ?? 0) + m[0].length) {
        call.shown = true
        const label = readTool(call.name, {}).label
        const file = clip(baseName((m[2] as string).replace(/\\\\/g, '\\')), 28)
        patch($, id, (w, at) => (w.endedAt !== undefined ? null : { bubble: `Sırada: ${label} · ${file}`, since: at }))
      }
    }
    thinking.set(id, buf)
    return
  }
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
          : {
              activity: 'thinking',
              think: kind,
              since: w.activity === 'thinking' ? w.since : at,
              bubble: `${THINK_LABEL[kind]}: ${clip(gist, 60)}`,
              detail: gist,
              // the monitor shows the kind of thought; it keeps its time while the kind holds
              screen: w.screen?.kind === 'think' && w.screen.think === kind ? w.screen : { kind: 'think', label: THINK_LABEL[kind], think: kind, at },
            },
      )
    }
  } else if (chunk.kind === 'text' && !buf.textSeen) {
    buf.textSeen = true
    patch($, id, (w, at) =>
      w.endedAt !== undefined
        ? null
        : { activity: 'answering', since: at, bubble: id === 'boss' ? 'Sana cevabı yazıyorum…' : 'Raporu yazıyorum…', screen: { kind: 'answer', label: id === 'boss' ? 'Cevap' : 'Rapor', at } },
    )
  } else if (chunk.kind === 'tool' && chunk.name) {
    const name = chunk.name
    patch($, id, (w, at) => (w.endedAt !== undefined ? null : { bubble: `Sırada: ${readTool(name, {}).label}`, since: at }))
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
      if (w) emit({ t: Date.now(), who: w.name, color: w.color, whoId: w.id, kind: 'think', text: `${THINK_LABEL[kind]} · ${thoughtGist(buf.text, 60)}` })

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
    await $.command.register({ name: 'ofis', description: 'Claude Ofis panelini açar: canlı piksel ofis, ekip, akış ve bağlam.' })
    $.clock.every(2000, () => void tick($).catch(() => undefined))
    $.clock.every(1000, () => void paint($).catch(() => undefined))
    // the auto compact setting may change from a shared usage band; the theme from the app
    await syncAuto($).catch(() => undefined)
    await syncTheme($)
    // codex's own config: the model and effort of a `codex exec` run without -m
    void loadCodexCfg($).catch(() => undefined)
    $.clock.every(3000, () => void syncAuto($).catch(() => undefined))
    $.clock.every(4000, () => void syncTheme($))
    $.clock.every(60_000, () => void syncDaily($).catch(() => undefined))
    $.clock.after(3000, () => void syncDaily($).catch(() => undefined))
    const surfaces = await $.session.surfaces()
    if (options.otomatikAc !== false && surfaces.some(s => s === 'desktop' || s === 'vscode')) {
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
      const samples = await syncSamples($, usage.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })), now)
      await update($, usageA, u => ({ ...u, samples }))
    } catch {
      // Figures arrive with the first measurement instead.
    }

    return result
  })

  on('command.run', { command: 'ofis' }, async $ => {
    const placed = await $.ui.open({ id: PANE, title: TITLE })

    return { text: placed.isPlaced ? 'Claude Ofis paneli açıldı.' : `Panel açılamadı: ${placed.reason}` }
  })

  on('turn.start', async ($, e, next) => {
    const id = workerId(e.agentId)
    if (id === 'boss') {
      isTurning = true
      const now = await $.clock.now()
      await update($, turnA, t => ({ ...t, active: true, startedAt: now, steps: 0, turns: t.turns + 1, prompt: clip(e.text, 140) }))
      patch($, 'boss', (w, at) => ({ activity: 'thinking', think: 'general', since: at, bubble: pick(QUIPS.turn, String(at)), detail: clip(e.text, 200) }))
      feed($, BOSS, 'prompt', `yeni istek · ${clip(e.text, 50)}`)
    } else {
      patch($, id, (w, at) => (w.endedAt === undefined ? { activity: 'thinking', since: at } : null))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const id = workerId(e.agentId)
    const effort = normEffort(e.effort)
    if (id === 'boss') {
      void update($, turnA, t => ({ ...t, steps: t.steps + 1, model: e.model, effort: effort ?? t.effort })).catch(() => undefined)
    }
    // the desk shows what this loop runs on: learned only when it changed (kept for a loop not seated yet)
    const seen = `${e.model}|${effort ?? ''}`
    if (e.model && seenModel.get(id) !== seen) {
      seenModel.set(id, seen)
      learnModel($, id, { model: e.model, effort, from: 'step' })
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
    const isShell = tool === 'Bash' || tool === 'PowerShell'
    // a codex / gemini / agy run: an outside worker takes a desk for it (the command is never kept)
    const ext = isShell ? readExternal(typeof input.command === 'string' ? input.command : '') : undefined
    const extId = `ext:${e.tool_use_id}`
    const description = typeof input.description === 'string' ? input.description : ''
    if (tool === 'SendMessage') {
      // its line comes from session.send, which knows whether it was delivered
      summaries.set(id, { summary: typeof input.summary === 'string' ? input.summary : undefined, toolUseId: e.tool_use_id })
    }
    const isWrite = tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit'
    // what the call is for, as its activity (the path, the command and the text stay in this function)
    const facts = toolFacts(tool, input, Boolean(ext))
    // a TodoWrite list: its items done out of all
    const plan = tool === 'TodoWrite' ? planOf(input) : undefined
    // a Workflow call: its agent() options say what its agents run on (agent.spawn finds it by this call's id)
    if (tool === 'Workflow') {
      let script = typeof input.script === 'string' ? input.script : ''
      if (!script && typeof input.scriptPath === 'string') script = String(await $.fs.read(input.scriptPath).catch(() => ''))
      const hint = workflowHint(script.slice(0, 200_000), Date.now())
      wfHints.set(e.tool_use_id, hint)
      if (wfHints.size > 50) for (const k of wfHints.keys()) if (wfHints.size > 40) wfHints.delete(k)
      lastWf = hint
    }
    // a codex run on a profile: its file says the model and effort when the command does not
    if (ext?.cli === 'codex') {
      await loadCodexCfg($)
      if (ext.profile) await loadCodexCfg($, ext.profile)
    }
    changeWorkers($, (list, now, emit) => {
      let all = list
      if (!all.some(w => w.id === id) && id !== 'boss') {
        // An agent that started before the office knew it (a workflow's agents, one from before a reload):
        // seated now, at its desk already; what it runs on comes from what was learned, else the workflow's
        // options, and it looks like its parent's family until its own step says (never a bare dash)
        const index = nextHire(all)
        const wf = recentWf(now)
        let w: Worker = {
          id,
          n: index,
          name: '',
          role: 'Ajan',
          task: PRESEATED,
          color: TEAM_COLORS[index % TEAM_COLORS.length] as string,
          seat: packIndex(all),
          activity: 'thinking',
          bubble: '',
          detail: '',
          tools: 0,
          tokensOut: 0,
          since: now,
          // already at its desk: no walk in from the door
          joinedAt: now - ARRIVAL_WINDOW_MS - 1000,
          kind: 'agent',
          parentId: 'boss',
        }
        for (const l of [wf ? { model: wf.model, effort: wf.effort, from: 'workflow', at: wf.at } : undefined, learned.get(id)]) if (l) w = withModel(w, l) ?? w
        if (!w.model) {
          const guess = guessOf(all, 'boss')
          if (guess) w.guess = guess
        }
        gone.delete(id)
        all = all.concat(retitle(w, all, true))
      }

      return all.map(w => {
        if (w.id !== id || w.activity === 'leaving') return w
        // a finished worker that calls a tool is at work again (its end came early, or it was woken)
        const back = w.endedAt !== undefined ? { ...w, endedAt: undefined, idleSince: undefined } : w
        // a message's line and an outside worker's come with their own rows
        if (tool !== 'SendMessage' && !ext) emit({ t: now, who: w.name, color: w.color, whoId: w.id, kind: r.feed, text: r.detail })
        // the monitor shows the real work: a file name, a command's kind, a site; never the command or a path
        const moved: Worker = { ...back, activity: r.activity, site: r.site, tool, bubble: r.bubble, detail: r.detail, since: now, tools: w.tools + 1, screen: { ...r.screen, at: now } }
        if (isWrite) {
          moved.writes = (w.writes ?? 0) + 1
          if ((w.writes ?? 0) === 0 && w.id !== 'boss') moved.duty = dutyFor({ task: w.task, writes: moved.writes })
        }
        if (plan && w.id !== 'boss') moved.plan = plan
        // its activity: a new one only when it comes twice (no flicker); a one-off plays from now
        const p = pickActivity({ ...facts, teamFailed: all.some(x => x.activity === 'failed' && x.endedAt !== undefined) }, w.trail ?? [], e.tool_use_id, now)
        moved.act = applyPick(back.act, p, now)
        const trail = pushMark(w.trail, p.mark)
        if (trail.length > 0) moved.trail = trail

        // its title follows what it does, once the same work comes twice
        return retitle(moved, all)
      })
    })
    // the boss's plan goes on the whiteboard
    if (plan && id === 'boss') void update($, turnA, t => ({ ...t, plan })).catch(() => undefined)
    // an outside CLI started from any loop (a workflow agent's too) takes a desk of its own, under that loop
    if (ext) hireExternal($, { id: extId, parentId: id, ext, description })
    stat($, s => ({ ...s, tools: { ...s.tools, [tool]: (s.tools[tool] ?? 0) + 1 } }))

    const ran = await next(e)
    const failed = 'isError' in ran && ran.isError === true
    // the result: a refusal (shield), a queue (429/529), a broken test, an agent's report back, a spark
    {
      const said = (ran as { text?: unknown }).text
      const res: ToolFacts = { ...facts, phase: 'result', failed, denied: 'deny' in ran && typeof ran.deny === 'string' }
      if (typeof said === 'string') res.out = said.slice(0, 4000)
      else if (failed && typeof ran.result === 'string') res.out = ran.result.slice(0, 4000)
      const p = pickActivity(res, [], e.tool_use_id, Date.now())
      // (a passing test's mark clears an old failure: it is written too)
      if (p.main || p.ev || p.mark.f || p.mark.s) {
        patch($, id, (w, at) => {
          if (w.endedAt !== undefined || w.activity === 'leaving') return null
          const trail = pushMark(w.trail, { ...p.mark, t: at })

          return { act: applyPick(w.act, p, at), ...(trail.length > 0 ? { trail } : {}) }
        })
      }
    }
    // an Agent call's record names the model its agent resolved to
    if ((tool === 'Agent' || tool === 'Task') && !failed && 'result' in ran) {
      const rec = (ran.result ?? {}) as { agentId?: unknown; resolvedModel?: unknown }
      if (typeof rec.agentId === 'string' && typeof rec.resolvedModel === 'string' && rec.resolvedModel) learnModel($, rec.agentId, { model: rec.resolvedModel, from: 'result' })
    }
    let isBackground = false
    if (ext) {
      const res = (('result' in ran ? ran.result : undefined) ?? {}) as { interrupted?: unknown; backgroundTaskId?: unknown }
      const taskId = !failed && typeof res.backgroundTaskId === 'string' ? res.backgroundTaskId : undefined
      isBackground = taskId !== undefined
      if (taskId) for (const one of groupOf(extId)) patch($, one, () => ({ taskId }))
      // a refused call never ran: that counts as a failure too
      else endExternal($, extId, failed || res.interrupted === true || ('deny' in ran && typeof ran.deny === 'string'))
    }
    if (currentTool.get(id) === e.tool_use_id) {
      // a hire waits for its worker, as does a backgrounded outside worker; a foreground one has answered
      const waits = r.activity === 'delegating' && !failed && (!ext || isBackground)
      patch($, id, (w, at) =>
        w.endedAt !== undefined || waits
          ? null
          : { activity: 'thinking', think: 'general', since: at, bubble: failed ? `${r.label} hata verdi, bakıyorum` : 'Sonuca bakıyorum…' },
      )
      if (failed) {
        changeWorkers($, (list, _now, emit) => {
          const w = list.find(x => x.id === id)
          if (w) emit({ t: Date.now(), who: w.name, color: w.color, whoId: w.id, kind: 'fail', text: `${r.label.toLocaleLowerCase('tr-TR')} hata verdi` })

          return list
        })
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('agentId' in result && result.agentId) {
      const agentId = result.agentId
      // the resolved id first; the call's own; a fork runs on its parent's. The parent's model is
      // otherwise only a guess for the look (the agent's own definition may name another).
      const wf = e.workflow ? wfHints.get(e.tool_use_id) ?? recentWf(Date.now()) : undefined
      const model = result.model || e.model || (e.fork ? e.parentModel : undefined) || wf?.model || undefined
      const info: HireInfo = {
        id: agentId,
        type: e.subagentType,
        task: e.description || e.prompt,
        isFork: e.fork,
        isWorkflow: e.workflow !== undefined,
        name: e.name,
        model,
        effort: wf?.effort,
        from: result.model || e.model || e.fork ? 'spawn' : 'workflow',
        guess: e.parentModel || undefined,
        parentId: e.parentAgentId ?? 'boss',
        addr: [e.name, result.teammateId],
      }
      const isSeated = e.resume !== undefined && (await read($, workersA).catch(() => [] as Worker[])).some(w => w.id === agentId)
      if (!isSeated) {
        // a resumed agent that has left the office is hired anew, under its name
        hire($, info)
      } else {
        // back to work: a worker still in the office sits down again
        changeWorkers($, (list, now) => {
          return list.map(w => {
            if (w.id !== agentId) return w
            const back: Worker = { ...w, activity: 'thinking' as const, think: 'general' as const, since: now, endedAt: undefined, idleSince: undefined, bubble: 'Yeniden göreve döndüm' }

            return model ? withModel(back, { model, effort: info.effort, from: info.from ?? 'spawn', at: now }) ?? back : back
          })
        })
      }
    }

    return result
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const summary = typeof e.last_assistant_message === 'string' ? clip(e.last_assistant_message, 220) : undefined
    changeWorkers($, (list, now, emit, say) =>
      list.map(w => {
        if (w.id !== e.agent_id || w.endedAt !== undefined) return w
        emit(item(now, w, 'done', 'görevi bitirdi'))
        // the report flies back to whoever gave the job
        say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(list, w), kind: 'report', text: talkText(undefined, e.last_assistant_message) || 'Rapor hazır', isDelivered: true })

        return { ...ended(w, now, false), summary, detail: summary ?? '' }
      }),
    )
    settleBackground($, e.background_tasks)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    settleBackground($, e.background_tasks)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.TeammateIdle', async ($, e, next) => {
    // a teammate waits for a message: it rests at its desk until one comes
    changeWorkers($, (list, now) => {
      const id = e.agent_id ?? resolveAddress(list, e.teammate_name)

      return list.map(w =>
        w.id !== id || w.id === 'boss' || w.endedAt !== undefined || w.activity === 'idle'
          ? w
          : { ...w, activity: 'idle' as const, since: now, idleSince: now, bubble: 'Mesaj bekliyorum…' },
      )
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    const tool = clip(String(e.tool_name ?? ''), 16)
    if (e.agent_id) {
      const agentId = e.agent_id
      patch($, agentId, (w, at) => (w.endedAt !== undefined ? null : { activity: 'waiting', since: at, bubble: `Onay bekliyorum: ${tool}`, screen: { kind: 'wait', label: tool || 'Onay', at } }))
      changeWorkers($, (list, _now, emit) => {
        const w = list.find(x => x.id === agentId)
        if (w) emit(item(Date.now(), w, 'wait', `onay bekliyor · ${tool}`))

        return list
      })
    } else {
      // the boss's own ask: the Notification that follows says it in the feed
      patch($, 'boss', (w, at) => ({ activity: 'waiting', since: at, bubble: `Onayını bekliyorum: ${tool}`, screen: { kind: 'wait', label: tool || 'Onay', at } }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.send', async ($, e, next) => {
    const sent = await next(e)
    try {
      const from = workerId(e.agentId)
      const pending = summaries.get(from)
      summaries.delete(from)
      const text = talkText(pending?.summary, e.text) || 'Mesaj'
      const raw = String(e.to ?? '')
      // a name outside the office is shown as said; an id or an address as "another session"
      const toName = /^[\p{L}\p{N} _.-]{1,24}$/u.test(raw) && !/^session_/i.test(raw) ? clip(raw, 14) : 'başka oturum'
      const tId = pending?.toolUseId
      changeWorkers($, (list, now, emit, say) => {
        const to = resolveAddress(list, raw)
        sayTalk(list, now, emit, say, { id: `msg:${tId ?? now}`, from, to, kind: 'message', text, isDelivered: sent.isDelivered === true }, toName)

        return list
      })
    } catch {
      // Watching never stands in the way of a message.
    }

    return sent
  }).catch(($, e, next) => next(e))

  on('session.receive', async ($, e, next) => {
    const got = await next(e)
    const kind = e.origin.kind
    // a relay's event or a trigger is not a message from a desk
    if (kind !== 'task-notification' && kind !== 'scheduled-trigger' && kind !== 'bridge' && kind !== 'slack-ping' && kind !== 'projects-relay') {
      const to = workerId(e.agentId)
      // another session's message (not a desk's here): it comes in from outside the office
      const fromAfar = kind === 'peer' || kind === 'peer-send-message'
      const text = talkText(undefined, e.text) || 'Mesaj'
      const who = fromAfar ? (await read($, workersA).catch(() => [] as Worker[])).find(w => w.id === to) : undefined
      pendingTalks.push((list, now, hear) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const t = list[i] as Talk
          // a desk here wrote to it and it is unread: this is that message, now read
          if (t.to === to && t.readAt === undefined && t.kind === 'message' && (!fromAfar || (t.from !== '' && now - t.t < INBOUND_GRACE_MS))) {
            const out = list.slice()
            out[i] = { ...t, readAt: now }
            return out
          }
        }
        if (!fromAfar) return list
        hear({ t: now, who: OUTSIDE.name, color: OUTSIDE.color, kind: 'talk', text, to: who?.name ?? BOSS.name, toColor: who?.color ?? BOSS.color, toId: to })

        return [...list, { id: `in:${now}`, t: now, from: '', to, kind: 'message', text, isDelivered: true, readAt: now + INBOUND_READ_MS }]
      })
      schedule($)
    }

    return got
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = workerId(e.agentId)
    if (id === 'boss') {
      const now = await $.clock.now()
      await update($, turnA, t => ({ ...t, active: false, lastEndedAt: now }))
      isTurning = false
      // the turn is over: auto compact may run now, never mid-reply
      $.clock.after(500, () => void read($, usageA).then(u => watchAuto($, u.ctxPct)).catch(() => undefined))
      const words = e.isAborted ? 'Durduruldu.' : e.reason === 'error' ? 'Bir hata oldu.' : `Tamamlandı (${fmtDuration(e.durationMs)})`
      patch($, 'boss', (w, at) => ({ activity: e.reason === 'error' ? 'failed' : 'idle', since: at, bubble: words }))
      feed($, BOSS, e.reason === 'error' ? 'fail' : 'turn', `${words}${e.usage ? ` · ${fmtTokens(e.usage.output_tokens)} token üretildi` : ''}`)
    } else if (e.reason === 'error') {
      changeWorkers($, (list, at, _emit, say) =>
        list.map(w => {
          if (w.id !== id || w.endedAt !== undefined) return w
          say({ id: `rep:${w.id}`, t: at, from: w.id, to: parentOf(list, w), kind: 'report', text: 'Görev yarım kaldı', isDelivered: true })

          return ended(w, at, true)
        }),
      )
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined) {
      patch($, 'boss', (w, at) => ({ activity: 'compacting', since: at, bubble: pick(QUIPS.compact, String(at)) }))
      feed($, BOSS, 'compact', `Bağlam sıkıştırılıyor (${e.trigger === 'auto' ? 'otomatik' : 'elle'})`)
      await flush($)
    }
    const result = await next(e)
    if (e.agentId === undefined) {
      patch($, 'boss', (w, at) => ({ activity: 'idle', since: at, bubble: 'Masa toparlandı, devam!' }))
      void update($, breakdownA, () => null).catch(() => undefined)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const samples = e.rateLimits.length > 0 ? await syncSamples($, e.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })), now).catch(() => undefined) : undefined
    await update($, usageA, u => ({
      ...u,
      ctxPct: e.context.percent ?? u.ctxPct,
      history: e.context.percent === undefined ? u.history : withHistory(u.history, e.context.percent),
      ctxTokens: e.context.tokens ?? u.ctxTokens,
      ctxWindow: e.context.window,
      limits: e.rateLimits.length > 0 ? e.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })) : u.limits,
      usd: e.cost?.usd ?? u.usd,
      samples: samples ?? u.samples,
      at: now,
    }))
    await watchAuto($, e.context.percent)
    for (const l of e.rateLimits) {
      for (const mark of [80, 90]) {
        const key = `${l.kind}:${mark}:${l.resetsAt ?? ''}`
        if (l.percentUsed >= mark && !warned.has(key)) {
          warned.add(key)
          const reset = resetIn(l.resetsAt, now)
          $.ui.toast(`Claude Ofis: ${limitLabel(l.kind)} limiti %${Math.round(l.percentUsed)}${reset ? ` · ${reset} sonra sıfırlanır` : ''}`)
          feed($, { name: 'Ofis', color: '#C99234' }, 'limit', `${limitLabel(l.kind)} limiti %${Math.round(l.percentUsed)} oldu`)
        }
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    if (/permission/i.test(e.notification_type)) {
      patch($, 'boss', (w, at) => ({ activity: 'waiting', since: at, bubble: 'Onayını bekliyorum!', detail: e.message }))
      feed($, BOSS, 'wait', 'onayını bekliyor')
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
    // off the overview the live values are read (and redraw the pane); on it, the last frame's.
    // The first look (no frame yet) reads them too: the timer's snapshot can be up to a second old,
    // and the first frame would show the office as it was before the last tool call.
    const live = isOverview && snap && frame ? snap : await readSnap($)
    if (isOverview && !frame) snap = live
    const { workers, usage, turn, stats, talks } = live
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
      ['ofis', 'Genel'],
      ['ekip', `Ekip (${team.length})`],
      ['baglam', 'Bağlam'],
    ]
    // the controls: the views on one row; the settings fold out from "Ayarlar"
    const settingsOpen = prefs.settings === true
    const toolbar = (
      <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} alignItems="center">
        {tabs.map(([t, label]) => (
          <Button key={`tab-${t}`} label={label} variant={tab === t ? 'primary' : 'secondary'} onPress={setTab(t)} />
        ))}
        <Text dimColor>│</Text>
        <Button key="settings" label={settingsOpen ? 'Ayarlar ▴' : 'Ayarlar ▾'} variant={settingsOpen ? 'primary' : 'secondary'} onPress={() => void update($, prefsA, p => ({ ...p, settings: p.settings !== true }))} />
      </Box>
      {settingsOpen ? (
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Button
          key="auto"
          label={auto.isOn ? `Oto-sıkıştırma: açık · %${auto.at}` : 'Oto-sıkıştırma: kapalı'}
          variant={auto.isOn ? 'primary' : 'secondary'}
          onPress={() => void setAuto($, a => ({ ...a, isOn: !a.isOn }))}
        />
        {auto.isOn ? <Button key="autoDown" label="−5" onPress={() => void setAuto($, a => ({ ...a, at: a.at - AT_STEP }))} /> : null}
        {auto.isOn ? <Button key="autoUp" label="+5" onPress={() => void setAuto($, a => ({ ...a, at: a.at + AT_STEP }))} /> : null}
        <Button key="compact" label="Şimdi sıkıştır" onPress={() => compactNow($)} />
        <Button
          key="motion"
          label={prefs.motion ? 'Hareket: açık' : 'Hareket: kapalı'}
          onPress={() => void update($, prefsA, p => ({ ...p, motion: !p.motion }))}
        />
        <Button
          key="hints"
          label={prefs.hints === true ? 'İpuçları: açık (titreyebilir)' : 'İpuçları: kapalı'}
          onPress={() => void update($, prefsA, p => ({ ...p, hints: p.hints !== true }))}
        />
      </Box>
      ) : null}
      </Box>
    )
    const SvgEl = e.surface !== 'terminal' && 'Svg' in els && els.Svg ? els.Svg : null
    // the pane keeps a margin of its own around the picture: asking for every column cropped both edges
    const width = Math.max(340, e.props.bodyColumns * CELL_PX - 40)
    // less the toolbar above the drawing: one row of buttons, two with the settings open
    const fill = Math.max(0, e.props.scroll.bodyRows * ROW_PX - (settingsOpen ? 104 : 60))

    const teamView = (): RenderElement => {
      const rows = [...(bossW ? [bossW] : []), ...team]

      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Bir çalışana tıkla: o ajanın konuşması ana ekranda açılır.</Text>
          {rows.map(w => (
            <Button
              key={`w-${w.id}`}
              plain
              onPress={() => void (w.kind === 'external' ? Promise.resolve() : $.ui.view(w.id === 'boss' ? {} : { agentId: w.id })).catch(() => undefined)}
            >
              <Text color={w.color} weight="bold">{`■ ${w.name}`}</Text>
              <Text dimColor>{`  ${whoLine(w)} · `}</Text>
              <Text>{activityLabel(w)}</Text>
              <Text dimColor>{w.id === 'boss' ? ` · ${stats.hired} işe alım` : ` · ${w.tools} araç · ${shortDuration((w.endedAt ?? now) - w.joinedAt)}`}</Text>
            </Button>
          ))}
        </Box>
      )
    }

    const contextView = (): RenderElement => {
      if (!breakdown || !SvgEl) {
        return (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>Bağlam dökümü hesaplanıyor (yerel tahmin, token harcamaz).</Text>
            <Button key="ctx-refresh" label="Şimdi hesapla" onPress={() => void refreshBreakdown($).catch(() => undefined)} />
          </Box>
        )
      }
      const card = breakdownHud(breakdown, width)

      return (
        <Box flexDirection="column" gap={1}>
          <SvgEl source={card.svg} alt={card.alt} width={card.width} height={card.height} isInteractive={prefs.hints === true} />
          <Box flexDirection="row" gap={1} alignItems="center">
            <Button key="ctx-refresh" label="Yenile" onPress={() => void refreshBreakdown($).catch(() => undefined)} />
            <Text dimColor>{`Son hesap ${istanbul(breakdown.at).text.slice(0, 5)} · kesin sayım için /context`}</Text>
          </Box>
        </Box>
      )
    }

    if (!SvgEl) {
      const busy = isBusy(turn, bossW)

      return (
        <Box flexDirection="column" gap={1}>
          <Text weight="bold" color="#FDBA74">{`CLAUDE OFİS · ${busy ? 'Çalışıyor' : 'Boşta'}`}</Text>
          <Text color="#CBD5E1">{`Patron: ${bossW ? activityLabel(bossW) : 'Boşta'} — ${bossW?.bubble ?? ''}`}</Text>
          <Text color={level(usage.ctxPct).color}>
            {`Bağlam %${Math.round(usage.ctxPct ?? 0)} (${fmtTokens(usage.ctxTokens)} / ${fmtTokens(usage.ctxWindow)})${usage.limits
              .map(l => ` · ${limitLabel(l.kind)} %${Math.round(l.pct)}`)
              .join('')}`}
          </Text>
          {team.map(w => (
            <Text key={`t-${w.id}`} color={w.color}>{`■ ${w.name}  ${whoLine(w)} · ${activityLabel(w)} · ${w.tools} araç · ${shortDuration((w.endedAt ?? now) - w.joinedAt)}${w.bubble ? ` — ${w.bubble}` : ''}`}</Text>
          ))}
          {talks.slice(-3).map(t => (
            <Text key={`m-${t.id}`} color="#94A3B8">{talkLine(t, workers, live.feed)}</Text>
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

    // the pane's reported size wobbles by a row or a few columns while Claude works (the spinner,
    // the composer): a small change keeps the old size, so the picture is not drawn again for it
    // a pane that got SMALLER is drawn again at once (an old, larger picture would run off the frame);
    // only a pane that grew a little keeps the old picture, leaving a thin strip rather than a cropped edge
    const steady = size && width >= size.width && fill >= size.fill && width - size.width < 40 && fill - size.fill < 60
    const useW = steady && size ? size.width : width
    const useF = steady && size ? size.fill : fill
    size = { width: useW, fill: useF, theme, motion: prefs.motion, auto, key: `${useW}x${useF}:${theme}:${prefs.motion}:${auto.isOn}:${auto.at}` }
    if (!frame || frame.size !== size.key) {
      // a new size (or the first look): everyone is drawn at their place, no walks
      const at = await $.clock.now()
      const L = officeOf(live, size, at)
      const key = settledKey(live, size, at, L)
      const fresh = drawLive(live, size, at, frame?.at, L)
      frame = { key, hud: fresh, at, size: size.key }
    }
    const hud = frame.hud

    return (
      <Box flexDirection="column" gap={1}>
        {toolbar}
        {/* an image by default: the interactive mode draws the picture in a sandboxed frame that
            loads again from blank on every change, which is the pane's blinking */}
        <SvgEl source={hud.svg} alt={hud.alt} width={hud.width} height={hud.height} isInteractive={prefs.hints === true} />
      </Box>
    )
  })
}
