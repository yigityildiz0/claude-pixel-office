import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, RenderElement } from 'claude-code'

import type { ActLoop, ActState, Breakdown, Daily, FaultCode, FeedItem, FeedKind, Stats, Tab, Talk, Turn, UiPrefs, Usage, Worker } from '../types'
import {
  ACTS,
  activeLoop,
  applyLoop,
  applyPick,
  classifyError,
  clearLoops,
  endAct,
  globalLoopOf,
  hireAct,
  pickActivity,
  pruneAct,
  pushEvWithRules,
  pushMark,
  TOOL_ERR_EVS,
  withEv,
  type ErrorSignalInput,
  type ErrorClassification,
  type ToolFacts,
} from './activities'
import { CV_FAULT, CV_LOOK, CV_VIA, cvKey, isFinished, readSnapshot, type CvAgent, type CvSnapshot } from './cetvel'
import { breakdownHud, hudSvg, isBusy, useHudTheme } from './hud'
import { ARRIVAL_WINDOW_MS, ARRIVE_MS, LEAVE_MS, layoutOffice, movesOu, nextHint, trackMoves } from './layout'
import type { Box, LayoutHint, Move, MoveState, OfficeLayout } from './layout'
import {
  EXT_DEFAULT_MODEL,
  MASCOT_INFO,
  QUIPS,
  TEAM_COLORS,
  THINK_LABEL,
  activityLabel,
  baseName,
  clip,
  dutyFor,
  fatigue,
  mascotFor,
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
const TITLE = 'Piksel Ofis'
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

// —— hata/aksilik takibi (yalnız bellekte tutulur; atomlara ham hata/komut/yol yazılmaz) ——
const repeatTrack = new Map<string, { sig: string; count: number }>()
const toolErrRing = new Map<string, number[]>()
/** #34: çalışan başına ardışık başarısız araç sonucu (her tool_use_id bir kez sayılır; ilk başarılı sonuç sıfırlar) */
const failStreak = new Map<string, number>()
const seenToolFail = new Map<string, { at: number; kind: 'benign' | 'iptal' | 'denied' | 'err'; clsId?: string; stormCounted?: boolean }>()

/** Patron kendi izin isteğini sordu ve henüz yanıtlanmadı (Notification permission_prompt hangi masanın olduğunu söylemez). */
let bossAsked = false

/** Patronun izin-bekle döngüsünü (#27) kapatır; döngü yoksa listeyi aynen döndürür. */
function withoutBossWait(list: Worker[], at: number): Worker[] {
  const i = list.findIndex(w => w.id === 'boss')
  const boss = list[i]
  if (!boss?.act?.loops?.some(l => l.id === 'izin-bekle')) return list
  const next = list.slice()
  next[i] = { ...boss, act: clearLoops(boss.act, ['izin-bekle'], at, false).state }

  return next
}

/** Bir çalışanın hata sayaçlarını sıfırlar (başarı, tur sonu, iptal, ayrılış). */
function resetErrs(id: string): void {
  toolErrRing.delete(id)
  failStreak.delete(id)
}

/** Bir başarısızlığı seriye ekler ve yeni seri boyunu döndürür. */
function bumpStreak(id: string): number {
  const n = (failStreak.get(id) ?? 0) + 1
  failStreak.set(id, n)
  return n
}

/**
 * #41 sayımına girmeyen bekleme/yoklama çağrıları: aynı arka plan görevini beklemek, uyumak ya da durum
 * sormak ilerlemesizlik değildir (katalog: "T" zayıf sinyal; yanlış-pozitif koruması).
 */
const POLL_TOOLS: ReadonlySet<string> = new Set(['TaskOutput', 'BashOutput', 'Monitor', 'ScheduleWakeup', 'TaskList', 'TaskGet', 'ListAgents', 'Sleep', 'Wait'])
function isPollCall(tool: string, input: Record<string, unknown>): boolean {
  if (POLL_TOOLS.has(tool)) return true
  if (tool !== 'Bash' && tool !== 'PowerShell') return false
  const cmd = typeof input.command === 'string' ? input.command.trim() : ''

  return /^(sleep|Start-Sleep|timeout(\.exe)?\s+\/t|wait)\b/i.test(cmd) || /\bgh (pr checks|pr status|run (list|view|watch))\b|\bgit (status|log)\b/i.test(cmd)
}

function stableHashText(v: unknown, depth = 0): string {
  if (depth > 3) return '~'
  if (v === null || v === undefined) return ''
  if (typeof v !== 'object') return String(v).slice(0, 120)
  if (Array.isArray(v)) return `[${v.slice(0, 12).map(x => stableHashText(x, depth + 1)).join(',')}]`
  const rec = v as Record<string, unknown>
  const skip = depth === 0 ? new Set(['tool', 'tool_use_id', 'agentId']) : undefined
  return `{${Object.keys(rec)
    .filter(k => !skip?.has(k))
    .sort()
    .slice(0, 16)
    .map(k => `${k}:${stableHashText(rec[k], depth + 1)}`)
    .join(',')}}`
}

const agentOf = (e: object): string | undefined => ('agent_id' in e && typeof (e as { agent_id?: unknown }).agent_id === 'string' ? (e as { agent_id: string }).agent_id : undefined)

function sigHash(tool: string, input: Record<string, unknown>): string {
  const s = `${tool}\0${stableHashText(input)}`
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

function recordErrStamp(id: string, now: number): boolean {
  const next = (toolErrRing.get(id) ?? []).filter(t => now - t <= 15_000)
  next.push(now)
  toolErrRing.set(id, next)
  return next.filter(t => now - t <= 10_000).length >= 5
}

function markToolFail(toolUseId: string, now: number, info: { kind: 'benign' | 'iptal' | 'denied' | 'err'; clsId?: string; stormCounted?: boolean }): void {
  if (!toolUseId) return
  seenToolFail.set(toolUseId, { at: now, ...info })
  if (seenToolFail.size > 200) {
    for (const [k, v] of seenToolFail) if (now - v.at > 60_000 || seenToolFail.size > 150) seenToolFail.delete(k)
  }
}

function usageMeta(u: Usage | undefined): { fivePct?: number; weekPct?: number; resetsAt?: number } {
  if (!u) return {}
  const five = u.limits.find(l => l.kind === 'five_hour')
  const week = u.limits.find(l => l.kind === 'seven_day')
  const r = five?.resetsAt ? Date.parse(five.resetsAt) : NaN
  return { fivePct: five?.pct, weekPct: week?.pct, resetsAt: Number.isFinite(r) ? r : undefined }
}

function parseResetMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : undefined
}

/**
 * Sınıflandırılmış hatayı uygular. `streak`: bu çalışanın ardışık başarısız sonuç sayısı (≥ 3 → #34);
 * `quiet`: 1.0 kuralı 6 (kırık test kendi şişesini gösterir, kıvılcım çıkmaz), seri yine sayılır.
 */
function applyErrorCls(
  cur: ActState | undefined,
  cls: ErrorClassification,
  streak: number,
  now: number,
  globalLoop: ActLoop | undefined,
  storm: boolean,
  bypassCooldown = false,
  quiet = false,
): ActState {
  if (cls.id === 'kota-devam') {
    const cleared = clearLoops(cur, ['kota-oturum', 'kota-haftalik', 'kredi-bitti'], now, false).state
    const clean = { ...cleared, ev: cleared.ev?.id === 'toparlandi' ? undefined : cleared.ev, evQ: cleared.evQ?.filter(e => e.id !== 'toparlandi') }
    return pushEvWithRules(clean, cls.id, now, { globalLoop, exempt: true })
  }
  if (cls.id === 'iptal') {
    const c1 = clearLoops(cur, 'api', now, false).state
    const c2 = clearLoops(c1, 'tool', now, false).state
    return pushEvWithRules(c2, 'iptal', now, { globalLoop, exempt: true, bypassCooldown: true })
  }
  if (cls.kind === 'loop') {
    return applyLoop(
      cur,
      {
        id: cls.id,
        at: now,
        ...(cls.global ? { global: true } : {}),
        ...(cls.mode ? { mode: cls.mode } : {}),
        ...(cls.resetAt !== undefined ? { resetAt: cls.resetAt } : {}),
      },
      now,
    )
  }
  // #34: derleme (#36) ve komut zaman aşımı (#40) da araç hatasıdır; seriye onlar da yükselir
  if (TOOL_ERR_EVS.has(cls.id) && (storm || streak >= 3)) {
    return applyLoop(cur, { id: 'hata-serisi', at: now, until: now + 60_000 }, now)
  }
  if (quiet && cls.id === 'error-sparks') return cur ?? { at: now, seen: now }
  return pushEvWithRules(cur, cls.id, now, { globalLoop, storm, bypassCooldown, exempt: cls.id === 'kota-devam-yok' })
}

/** Yalnız motorun yapısal alanları; error/text/stdout içinden kod avlanmaz. */
function toolErrorMeta(raw: unknown): Pick<ErrorSignalInput, 'toolCode' | 'exitCode' | 'hookBlocked'> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const nested = r.result && typeof r.result === 'object' ? r.result as Record<string, unknown> : {}
  const error = r.error && typeof r.error === 'object' ? r.error as Record<string, unknown> : {}
  const code = r.error_code ?? error.code ?? nested.error_code ?? nested.code
  const exit = r.exit_code ?? r.exitCode ?? nested.exit_code ?? nested.exitCode
  return {
    ...(typeof code === 'string' ? { toolCode: code } : {}),
    ...(typeof exit === 'number' && Number.isInteger(exit) ? { exitCode: exit } : {}),
    ...(r.hook_blocked === true || nested.hook_blocked === true ? { hookBlocked: true } : {}),
  }
}

function globalFeedText(cls: ErrorClassification): string {
  switch (cls.id) {
    case 'kota-haftalik':
      return 'haftalık kullanım limiti doldu'
    case 'kota-oturum':
      return '5 saatlik kullanım limiti doldu'
    case 'giris-gerek':
      return 'oturum girişi gerekli'
    case 'ag-kopuk':
      return 'ağ bağlantısı koptu'
    case 'asiri-yuk-529':
      return 'sunucu aşırı yüklü'
    case 'queue-ticket':
      return 'hız sınırı · sırada bekliyor'
    case 'zaman-asimi':
      return 'istek zaman aşımına uğradı'
    case 'baglam-asildi':
      return 'bağlam penceresi aşıldı'
    case 'kredi-bitti':
      return 'kredi ya da harcama limiti bitti'
    case 'sunucu-500':
      return 'sunucu hata verdi'
    case 'cok-buyuk-413':
      return 'istek çok büyük'
    case 'cikti-siniri':
      return 'çıktı sınırı aşıldı'
    default:
      return 'bir sorun oluştu'
  }
}

// Tags change when a value's fields change: what an older version stored is
// read as the initial value instead.
const workersA = atom({ plugin: 'piksel-ofis', key: 'workers' } as const, [] as Worker[], { shape: 'workers-2' })
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
// auto compact as this chat has it (shared with kota-bandi when that is installed)
const autoA = atom({ plugin: 'piksel-ofis', key: 'auto' } as const, { isOn: true, at: 75 }, { shape: 'auto-1' })
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
// what a change keeps outside the team, once the team it made is stored
let pendingAfter: Array<() => void> = []
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
const MODEL_RANK: Readonly<Record<string, number>> = { guess: 0, workflow: 1, config: 2, cli: 3, spawn: 3, result: 4, cetvel: 4, step: 5 }
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
// the outside workers one shell call seated
const extGroups = new Map<string, string[]>()

// —— stops, runs and stalls ——
// A stopped worker (TaskStop, an interrupted turn, a killed task) is not a failure: it rests a moment
// at its desk, then walks out. An agent no list knows, with no call open and no word for this long,
// has stalled (a workflow agent the engine never ends, a stalled retry): it is let go the same way.
const STOP_LINGER_MS = 5000
const AGENT_TTL_MS = 15 * 60_000
// a Workflow call's background task → its run (TaskStop and the background list name the task)
const wfRuns = new Map<string, string>()
// background tasks seen live in a Stop/SubagentStop list: one gone from it has ended
const liveTasks = new Set<string>()
// the tool calls each loop has open (an agent waiting on a long call has not stalled)
const openCalls = new Map<string, number>()
// #44: the last sign of life of each loop (a call, its result, a model step, a thought): a subagent quiet past
// HUNG_MS (or one call past HUNG_CALL_MS) has its parent look for it
const signAt = new Map<string, number>()
// every streamed chunk of a loop's model step bumps its pulse; the tick turns a new pulse into a sign at its own time
const pulse = new Map<string, number>()
const pulseSeen = new Map<string, number>()
const HUNG_MS = 3 * 60_000
const HUNG_CALL_MS = 10 * 60_000
/** A shell call's own time limit (its `timeout`, else the tool's two minutes). */
// the shell tool's own default and ceiling (BASH_DEFAULT_TIMEOUT_MS / BASH_MAX_TIMEOUT_MS change them), read once
let shellDefaultMs = 120_000
let shellMaxMs = 600_000
let shellEnvRead = false
async function readShellEnv($: $): Promise<void> {
  if (shellEnvRead) return
  shellEnvRead = true
  const num = (raw: string | undefined) => {
    const v = Number(raw)
    return raw && Number.isFinite(v) && v > 0 ? v : undefined
  }
  shellMaxMs = num(await $.env.get('BASH_MAX_TIMEOUT_MS').catch(() => undefined)) ?? shellMaxMs
  shellDefaultMs = Math.min(num(await $.env.get('BASH_DEFAULT_TIMEOUT_MS').catch(() => undefined)) ?? shellDefaultMs, Math.max(shellMaxMs, shellDefaultMs))
}
const shellLimit = (input: Record<string, unknown>): number => (typeof input.timeout === 'number' && input.timeout > 0 ? Math.min(input.timeout, shellMaxMs) : shellDefaultMs)
/**
 * #40: the call ran to its own limit. A cut-off call runs at least its limit (the tool's timer ends it), so the
 * margin is only clock slack: at most 500 ms and never more than 5% of a small limit (timeout 2000 → 1900 ms,
 * not 500 ms). A limit under a second is too short to tell a cut-off from a fast failure.
 */
const ranToLimit = (tookMs: number, input: Record<string, unknown>): boolean => {
  const limit = shellLimit(input)
  return limit >= 1000 && input.run_in_background !== true && tookMs >= limit - Math.min(500, limit * 0.05)
}
// #40: when each open shell call began (by tool_use_id): PostToolUseFailure falls back to it when the hook gives no duration
const callStart = new Map<string, number>()
// the latest workflow run: an agent seated by its first call while it runs (a stalled retry) belongs to it
let lastRun: { runId: string; taskId: string; at: number } | undefined

/** A background task's status as an end: undefined while it runs. */
function taskEnd(status: string | undefined): 'done' | 'failed' | 'stopped' | undefined {
  const s = (status ?? '').toLowerCase()
  if (/kill|stop|cancel|abort|interrupt/.test(s)) return 'stopped'
  if (/fail|error/.test(s)) return 'failed'
  if (/complet|done|success|finish/.test(s)) return 'done'

  return undefined
}

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

  return parts.join(' · ')
}

/** An outside worker's name in the feed: its model, else its platform (an agy run names no model). */
function extName(w: Pick<Worker, 'model' | 'via'>): string {
  if (!w.model && w.via === 'agy') return 'Antigravity'

  return modelLabel(w.model, w.via)
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
  const afters = pendingAfter
  const queued = pendingFeed
  const stats = pendingStats
  const edits = pendingTalks
  pendingWorkers = []
  pendingAfter = []
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
      for (const fn of afters) fn()
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
    if (w.stopped) continue
    if (w.activity === 'failed') out.failed++
    else out.done++
  }

  return out
}

function changeWorkers($: $, fn: WorkerChange, written?: () => void): void {
  pendingWorkers.push(fn)
  if (written) pendingAfter.push(written)
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

/** A worker whose job had ended is at work again: its end, and the stop or fault that ended it, are gone (a later end is its own). */
function atWorkAgain(w: Worker): Worker {
  const { stopped: _stopped, fault: _fault, ...rest } = w

  return { ...rest, endedAt: undefined, idleSince: undefined }
}

/** Ends a worker's job as stopped: not a failure (no red, no sparks), it rests a moment and walks out. */
function stoppedEnd(w: Worker, now: number, bubble = 'Durduruldu', fault: FaultCode = 'iptal', playIptal = false): Worker {
  const c1 = clearLoops(w.act, 'api', now, false).state
  const c2 = clearLoops(c1, 'tool', now, false).state
  const clean = endAct(c2, false, now, true)
  const act = playIptal ? pushEvWithRules(clean, 'iptal', now, { exempt: true, bypassCooldown: true }) : clean

  return { ...w, activity: 'idle', since: now, endedAt: now, idleSince: now, stopped: 1, bubble, fault, act }
}

/** The workers a task id names (an agent, a named teammate, an outside worker's shell task, a workflow run) and those they started. */
function namedBy(list: readonly Worker[], taskId: string): Set<string> {
  const runId = wfRuns.get(taskId)
  const hit = new Set<string>()
  for (const w of list) {
    if (w.id === 'boss') continue
    if (w.id === taskId || w.taskId === taskId || (runId !== undefined && w.runId === runId) || (w.addr ?? []).includes(taskId)) hit.add(w.id)
  }
  for (let grew = hit.size > 0; grew; ) {
    grew = false
    for (const w of list) {
      if (!hit.has(w.id) && w.id !== 'boss' && w.parentId !== undefined && hit.has(w.parentId)) {
        hit.add(w.id)
        grew = true
      }
    }
  }

  return hit
}

/** Stops every worker of a task (TaskStop): at once, neutral, then out the door. */
function stopTask($: $, taskId: string): void {
  changeWorkers($, (list, now, emit) => {
    const hit = namedBy(list, taskId)
    if (hit.size === 0) return list

    return list.map(w => {
      if (!hit.has(w.id) || w.endedAt !== undefined || w.activity === 'leaving') return w
      emit(item(now, w, 'turn', 'durduruldu'))
      // a stopped outside run Cetvel still lists as at work does not sit down again
      holdCv(w, now)

      return stoppedEnd(w, now)
    })
  })
}

/** A run starts over (a resume of the same run): the agents of its last attempt (those seated before the call) hand over. */
function stopRun($: $, runId: string, before: ReadonlySet<string>): void {
  const isOld = (w: Worker) => w.runId === runId && before.has(w.id) && w.endedAt === undefined && w.activity !== 'leaving'
  changeWorkers($, (list, now, emit) => {
    if (!list.some(isOld)) return list

    return list.map(w => {
      if (!isOld(w)) return w
      emit(item(now, w, 'turn', 'yeni koşuya devretti'))

      return stoppedEnd(w, now, 'Yeni koşuya devrediyorum')
    })
  })
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
  /** a workflow agent's run and its place in it */
  runId?: string
  wfIndex?: number
}

/** The background task of a workflow run, when the Workflow call's result named it. */
function taskOfRun(runId: string | undefined): string | undefined {
  if (!runId) return undefined
  for (const [task, run] of wfRuns) if (run === runId) return task

  return undefined
}

/** The run fields a hire writes on its worker. */
function runFields(info: HireInfo): Partial<Worker> {
  if (!info.runId) return {}
  const out: Partial<Worker> = { runId: info.runId }
  if (info.wfIndex !== undefined) out.wfIndex = info.wfIndex
  const task = taskOfRun(info.runId)
  if (task) out.taskId = task

  return out
}

/** The worker an earlier attempt of the same run seated for the same agent() call (a resume, a hand-off). */
const twinOf = (list: readonly Worker[], info: HireInfo): Worker | undefined =>
  info.runId && info.wfIndex !== undefined ? list.find(w => w.id !== info.id && w.runId === info.runId && w.wfIndex === info.wfIndex && w.activity !== 'leaving') : undefined

const addrOf = (list: ReadonlyArray<string | undefined>): string[] => [...new Set(list.filter((a): a is string => typeof a === 'string' && a !== ''))]

/**
 * The one who gave a job calls it out: an agent that hires its own is a deputy boss from now on. A deputy's
 * new title also reaches the order its own boss still calls out (three levels deep: no stale name).
 */
function deputize(before: readonly Worker[], all: readonly Worker[], parentId: string, hiredName: string, task: string | undefined, now: number): Worker[] {
  const out = all.map(w => (w.id === parentId ? retitle({ ...w, activity: 'delegating' as const, since: now, bubble: `${hiredName}, ${clip(task || 'şu işe bak', 28)}!`, detail: task ?? '' }, all, true) : w))
  const was = before.find(w => w.id === parentId)
  const titled = out.find(w => w.id === parentId)
  if (!was || !titled || !was.name || was.name === titled.name) return out
  const up = parentOf(before, was)

  return out.map(w => (w.id === up && w.bubble.startsWith(`${was.name}, `) ? { ...w, bubble: `${titled.name}${w.bubble.slice(was.name.length)}` } : w))
}

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
      const tasked = w.task === PRESEATED && Boolean(info.task)
      if (tasked) {
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
      const run = runFields(info)
      if (run.runId && (next.runId !== run.runId || next.wfIndex !== run.wfIndex || (run.taskId && next.taskId !== run.taskId))) {
        next = { ...next, ...run }
        changed = true
      }
      // the same agent() call of an earlier attempt sits elsewhere: it walks out, this desk is the one
      const twin = twinOf(list, info)
      if (twin) {
        gone.set(twin.id, now)
        list = list.map(x => (x.id === twin.id ? { ...(x.endedAt === undefined ? stoppedEnd(x, now, '') : x), activity: 'leaving' as const, since: now, bubble: '' } : x))
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
      const seated = retitle(next, list, true)
      out[had] = seated
      if (!tasked) return out
      // its job is known only now: the one who gave it calls it out (a deputy when that is an agent)
      const from = parentOf(out, seated)
      sayTalk(out, now, () => undefined, say, { id: `ord:${seated.id}`, from, to: seated.id, kind: 'order', text: talkText(undefined, info.task) || 'Yeni görev', isDelivered: true })

      return deputize(list, out, from, seated.name, info.task, now)
    }
    gone.delete(info.id)
    // the same agent() call of an earlier attempt of this run (a resume): the new one takes its desk,
    // its number and its place in the order, so the run is shown once
    const twin = twinOf(list, info)
    if (twin) {
      gone.set(twin.id, now)
      list = list.filter(w => w.id !== twin.id)
    }
    const index = twin ? twin.n : nextHire(list)
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
      ...runFields(info),
    }
    if (twin) {
      worker.color = twin.color
      worker.seat = twin.seat
      worker.joinedAt = twin.joinedAt
      worker.since = now
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

    return deputize(list, all, parentId, worker.name, info.task, now)
  })
  stat($, s => ({ ...s, hired: s.hired + 1 }))
}

/** Seats an outside worker (codex, gemini, agy run from the shell) for the call that started it. */
function hireExternal($: $, info: { id: string; parentId: string; ext: NonNullable<ReturnType<typeof readExternal>>; description: string }): void {
  const ext = info.ext
  // the platform picks the mascot, never the model: Codex the green one, Antigravity the blue one (with its badge);
  // the Gemini CLI reads as Antigravity off its model
  const via: Worker['via'] = ext.cli === 'agy' ? 'agy' : ext.cli === 'codex' ? 'gpt' : undefined
  // no -m: the profile's file, else codex's own config, else the family's name
  const cfg = ext.cli === 'codex' ? (ext.profile ? codexCfg.get(ext.profile) : codexCfg.get('')) : undefined
  const base = ext.cli === 'codex' && ext.profile ? codexCfg.get('') : undefined
  const fallModel = cfg?.model ?? base?.model ?? EXT_DEFAULT_MODEL[ext.cli]
  const fallEffort = ext.effort ?? cfg?.effort ?? base?.effort
  const runs = [{ model: ext.model ?? fallModel, effort: fallEffort }]
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
      const look = MASCOT_INFO[mascotFor({ id, model, via, kind: 'external' })]
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
      emit({ t: now, who: worker.name, color: look.accent, whoId: worker.id, kind: 'ext', text: `${model ? modelLine(model, effort, via) : extName(worker)} · başladı${info.description ? ` · ${clip(info.description, 40)}` : ''}` })
      sayTalk(all, now, () => undefined, say, { id: `ord:${worker.id}`, from: parentId, to: worker.id, kind: 'order', text: talkText(undefined, info.description) || 'Dış görev', isDelivered: true })
    })
    // an agent that hands work to outside CLIs is a deputy boss while they run
    const parent = info.parentId

    return parent === 'boss' ? all : all.map(w => (w.id === parent ? retitle(w, all, true) : w))
  })
  stat($, s => ({ ...s, hired: s.hired + runs.length }))
}

/** The desks one shell call seated. */
const groupOf = (id: string): ReadonlySet<string> => new Set(extGroups.get(id) ?? [id])

/** An outside worker's run is over: it reports back to whoever started it. */
function endExternal($: $, id: string, isFailed: boolean): void {
  const ids = groupOf(id)
  changeWorkers($, (list, now, emit, say) =>
    list.map(w => {
      if (!ids.has(w.id) || w.endedAt !== undefined) return w
      holdCv(w, now)
      const label = extName(w)
      emit(item(now, w, 'ext', `${label} · ${isFailed ? 'hata verdi' : 'bitirdi'}${w.task && w.task !== 'Dış görev' ? ` · ${clip(w.task, 40)}` : ''}`))
      say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(list, w), kind: 'report', text: isFailed ? 'Bir sorun çıktı' : 'İş bitti, sonuç hazır', isDelivered: true })

      const done = ended(w, now, isFailed)
      return isFailed ? { ...done, fault: 'isci-coktu', act: pushEvWithRules({ ...done.act!, ev: undefined }, 'isci-coktu', now) } : done
    }),
  )
}

/**
 * The session's background tasks, as a Stop or SubagentStop lists them: a worker whose task ended (or is
 * gone from the list) has finished. An outside worker's shell task gone is done, as before; one the list
 * says failed or was stopped ends so. A workflow run's or a background agent's task that was seen live and
 * is gone ends its agents neutrally (stopped from the app, or done without a SubagentStop).
 */
function settleBackground($: $, tasks: ReadonlyArray<{ id: string; type?: string; status?: string }> | undefined): void {
  if (!Array.isArray(tasks)) return
  const byId = new Map(tasks.map(t => [t.id, t]))
  for (const t of tasks) if (!taskEnd(t.status)) liveTasks.add(t.id)
  if (liveTasks.size > 400) for (const k of liveTasks) if (liveTasks.size > 300) liveTasks.delete(k)
  changeWorkers($, (list, now, emit, say) => {
    let changed = false
    const out = list.map(w => {
      if (!w.taskId || w.endedAt !== undefined || w.activity === 'leaving') return w
      const t = byId.get(w.taskId)
      const end = t ? taskEnd(t.status) : 'gone'
      if (!end) return w
      const extra = w.task && w.task !== 'Dış görev' ? ` · ${clip(w.task, 40)}` : ''
      if (w.kind === 'external') holdCv(w, now)
      if (end === 'stopped') {
        changed = true
        emit(item(now, w, w.kind === 'external' ? 'ext' : 'turn', `${w.kind === 'external' ? `${extName(w)} · ` : ''}durduruldu`))

        return stoppedEnd(w, now)
      }
      if (w.kind === 'external') {
        const failed = end === 'failed'
        changed = true
        emit(item(now, w, 'ext', `${extName(w)} · ${failed ? 'hata verdi' : 'bitirdi'}${extra}`))
        say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(list, w), kind: 'report', text: failed ? 'Bir sorun çıktı' : 'İş bitti, sonuç hazır', isDelivered: true })

        return ended(w, now, failed)
      }
      // an agent of a background task: gone from the list counts only once the list showed it live
      if (end === 'gone' && !liveTasks.has(w.taskId)) return w
      changed = true
      if (end === 'gone') {
        emit(item(now, w, 'turn', 'görev kapandı'))

        return stoppedEnd(w, now, 'Görev kapandı')
      }
      say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(list, w), kind: 'report', text: end === 'done' ? 'Rapor hazır' : 'Görev yarım kaldı', isDelivered: true })

      return ended(w, now, end === 'failed')
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
    if (w.endedAt === undefined && info.status === 'killed') {
      // stopped (TaskStop, the app's stop button): not a failure
      next = stoppedEnd(w, now)
    } else if (w.endedAt === undefined) {
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
  // a loop that streamed since the last tick is alive (#44 counts silence from its last sign)
  for (const [id, n] of pulse) {
    if (pulseSeen.get(id) === n) continue
    pulseSeen.set(id, n)
    signAt.set(id, now)
  }
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
  // an outside worker left in the background past its time is let go (one Cetvel lists at work is Cetvel's to end)
  const isStale = (w: Worker, at: number) => w.kind === 'external' && (w.cv === undefined || !cvLive.has(w.cv)) && w.endedAt === undefined && at - w.joinedAt > EXT_TTL_MS
  // an agent no list knows, with no call open, quiet past its time, has stalled (waiting for you is not)
  const isStalled = (w: Worker, at: number) =>
    (w.kind ?? 'agent') === 'agent' &&
    w.endedAt === undefined &&
    w.activity !== 'leaving' &&
    w.activity !== 'waiting' &&
    w.activity !== 'idle' &&
    !byId.has(w.id) &&
    (openCalls.get(w.id) ?? 0) === 0 &&
    at - Math.max(w.since, w.joinedAt) > AGENT_TTL_MS
  const linger = (w: Worker) => (w.stopped ? STOP_LINGER_MS : LINGER_MS)
  // #44: a subagent at work that gives no sign (no call, no step, no thought) past its time: the one who gave
  // its job looks for it through the periscope until it speaks again or ends (a timer, never a text)
  // one that waits for you (an approval, a question) is not silent: its own loop says why it waits
  const waitsForYou = (w: Worker, at: number) => w.act?.loops?.some(l => (l.id === 'izin-bekle' || l.id === 'soru-bekle') && (l.until === undefined || at < l.until)) ?? false
  // a desk with a seated helper still at work is waiting on it, not hung: the helper's own silence is what counts
  // (A → B: A's one open call is B's Agent call; B's signs are B's, so A is judged through B)
  const isHung = (w: Worker, at: number, busy: ReadonlySet<string>) =>
    w.id !== 'boss' &&
    (w.kind ?? 'agent') === 'agent' &&
    w.endedAt === undefined &&
    w.activity !== 'leaving' &&
    w.activity !== 'waiting' &&
    w.activity !== 'idle' &&
    !busy.has(w.id) &&
    !waitsForYou(w, at) &&
    at - Math.max(w.since, w.joinedAt, signAt.get(w.id) ?? -Infinity) > ((openCalls.get(w.id) ?? 0) > 0 ? HUNG_CALL_MS : HUNG_MS)
  const lookouts = (all: readonly Worker[], at: number): Set<string> => {
    const busy = new Set<string>()
    for (const x of all) if (x.id !== 'boss' && x.endedAt === undefined && x.activity !== 'leaving') busy.add(parentOf(all, x))
    const out = new Set<string>()
    for (const w of all) if (isHung(w, at, busy)) out.add(parentOf(all, w))
    return out
  }
  const looking = (w: Worker) => w.act?.loops?.some(l => l.id === 'alt-ajan-yok') ?? false
  const live = (w: Worker) => w.endedAt === undefined && w.activity !== 'leaving'
  const lookNow = lookouts(list, now)
  const hasActWork = (w: Worker, at: number): boolean => {
    const a = w.act
    if (!a) return false
    if (a.loops?.some(l => l.until !== undefined && at >= l.until)) return true
    if (a.ev && at >= a.ev.until && (a.evQ?.length ?? 0) > 0) return true
    return false
  }
  const needs = list.some(w => {
    if (hasActWork(w, now)) return true
    if (live(w) && looking(w) !== lookNow.has(w.id)) return true
    if (w.id === 'boss') return w.activity === 'delegating' && now - w.since > 5000
    const info = byId.get(w.id)
    if (info && fromList(w, info, now, null, list)) return true
    if (isStale(w, now) || isStalled(w, now)) return true
    if (w.endedAt !== undefined && w.activity !== 'leaving' && now - w.endedAt > linger(w)) return true
    if (w.activity === 'leaving' && now - w.since > LEAVE_MS + 800) return true

    return false
  })
  if (!needs) return
  changeWorkers($, (all, at, emit, say) => {
    const out: Worker[] = []
    for (const w of all) {
      const pruned = hasActWork(w, at) ? { ...w, act: pruneAct(w.act, at).state } : w
      if (pruned.id === 'boss') {
        out.push(pruned.activity === 'delegating' && at - pruned.since > 5000 ? { ...pruned, activity: 'thinking', think: 'general', since: at, bubble: 'Ekip çalışıyor, takipteyim.' } : pruned)
        continue
      }
      if (pruned.activity === 'leaving' && at - pruned.since > LEAVE_MS + 800) {
        gone.set(pruned.id, at)
        // its per-loop notes go with it (a long session does not keep them all)
        currentTool.delete(pruned.id)
        signAt.delete(pruned.id)
        pulse.delete(pruned.id)
        pulseSeen.delete(pruned.id)
        seenModel.delete(pruned.id)
        thinking.delete(pruned.id)
        repeatTrack.delete(pruned.id)
        resetErrs(pruned.id)
        continue
      }
      if (pruned.endedAt !== undefined && pruned.activity !== 'leaving' && at - pruned.endedAt > linger(pruned)) {
        out.push({ ...pruned, activity: 'leaving', since: at, bubble: '' })
        continue
      }
      if (isStale(pruned, at)) {
        emit(item(at, pruned, 'ext', `${extName(pruned)} · süresi doldu`))
        out.push(ended(pruned, at, false, { bubble: 'Süre doldu, çıkıyorum' }))
        continue
      }
      if (isStalled(pruned, at)) {
        emit(item(at, pruned, 'turn', 'yanıt vermiyor, masadan kalktı'))
        out.push(stoppedEnd(pruned, at, 'Sessiz kaldım, çıkıyorum', 'askida'))
        continue
      }
      const info = byId.get(pruned.id)
      const next = info ? fromList(pruned, info, at, say, all) : null
      out.push(next ?? pruned)
    }
    const look = lookouts(out, at)

    return out.map(w => {
      if (!live(w)) return w
      const has = looking(w)
      if (look.has(w.id) && !has) {
        // its own bubble only when nothing louder speaks (an approval it waits for keeps its words)
        const louder = (ACTS[activeLoop(w.act, at)?.id ?? '']?.prio ?? 0) > (ACTS['alt-ajan-yok']?.prio ?? 69)
        return { ...w, ...(louder ? {} : { bubble: 'Alt ajandan ses yok…' }), act: applyLoop(w.act, { id: 'alt-ajan-yok', at }, at) }
      }
      if (!look.has(w.id) && has) return { ...w, act: clearLoops(w.act, ['alt-ajan-yok'], at, false).state }

      return w
    })
  })
}

const INPUT_PATH = /"(file_path|notebook_path|path)"\s*:\s*"([^"]+)/

function observeChunk($: $, id: string, chunk: { kind: string; text?: string; name?: string; json?: string; index?: number }): void {
  pulse.set(id, (pulse.get(id) ?? 0) + 1)
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
      patch($, id, (w, at) => {
        signAt.set(id, at)

        return w.endedAt !== undefined
          ? null
          : {
              activity: 'thinking',
              think: kind,
              streamAt: at,
              since: w.activity === 'thinking' ? w.since : at,
              bubble: `${THINK_LABEL[kind]}: ${clip(gist, 60)}`,
              detail: gist,
              // the monitor shows the kind of thought; it keeps its time while the kind holds
              screen: w.screen?.kind === 'think' && w.screen.think === kind ? w.screen : { kind: 'think', label: THINK_LABEL[kind], think: kind, at },
            }
      })
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

function stepEnded($: $, id: string, result: { stopReason?: string | null; usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | null }): void {
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
  if (result.stopReason === 'model_context_window_exceeded') {
    patch($, id, (w, at) => ({ fault: 'baglam-asildi', act: applyLoop(w.act, { id: 'baglam-asildi', at }, at), bubble: 'Bağlam penceresi doldu!' }))
    feed($, id === 'boss' ? BOSS : { name: 'Ajan', color: '#94A3B8', id }, 'fail', 'bağlam penceresi doldu')
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

// —— Cetvel: the outside agents of other terminals and apps (Codex, Antigravity) and their subagents ——
// Cetvel writes %LOCALAPPDATA%\Cetvel\ajanlar.json (atomically; on a change, else every 15 s). The office
// looks at its time every CV_POLL_MS and reads it only when it changed; a missing, broken or stale file
// changes nothing but its own desks (the shell-call path for outside workers runs as before).
const CV_POLL_MS = 3000
// no fresh write for this long: Cetvel has stopped, its desks are let go
const CV_STALE_MS = 90_000
// a shell call of this chat and Cetvel's agent this close in time are one run: one desk
const CV_TWIN_MS = 120_000
// at most this many desks from Cetvel at once
const CV_MAX = 16
// a Cetvel agent the office has not seated is seated only while it is at work: one quiet this long is not
const CV_FRESH_MS = 10 * 60_000
let cvFile: string | null | undefined
let cvMtime = 0
let cvSeq = -1
let cvFresh = 0
// What was last applied for each Cetvel agent (unchanged agents are left alone), its tool errors, and the
// last event its desk saw. They are written once the change is stored (update may run a change again).
const cvSeen = new Map<string, string>()
const cvErrors = new Map<string, number>()
const cvLast = new Map<string, number>()
// an agent whose desk was let go from this chat (TaskStop, its shell task stopped or over): no desk again
// until Cetvel shows an event of it after that moment
const cvHold = new Map<string, number>()
// the agents the latest snapshot lists at work: a shell desk joined to one of them keeps its seat past the shell's own time
let cvLive: ReadonlySet<string> = new Set()

/** A shell desk joined to a Cetvel agent is let go here: that agent sits again only on a new event. */
function holdCv(w: Worker, now: number): void {
  if (w.cv) cvHold.set(w.cv, Math.max(now, cvHold.get(w.cv) ?? 0))
}

/** The mascot of a Cetvel agent: its platform's. */
const cvViaOf = (a: CvAgent): Worker['via'] => CV_VIA[a.platform]

/**
 * How well a shell-call desk (codex, agy run from this chat) matches a Cetvel agent: lower is nearer,
 * Infinity is not it. The same platform, started at about the same time; a run that goes on with an earlier
 * session (codex exec resume, agy on an old conversation) started long before the call and has been at work
 * since: it matches by its last event, ranked after any start match.
 */
function twinScore(w: Worker, a: CvAgent): number {
  if (a.depth !== 0 || w.kind !== 'external' || w.cv !== undefined || !w.id.startsWith('ext:') || w.activity === 'leaving') return Infinity
  const via = CV_VIA[a.platform]
  if (w.via !== via) return Infinity
  let gap = Math.abs(w.joinedAt - (a.startedAt ?? a.lastAt))
  if (gap > CV_TWIN_MS) {
    const since = a.lastAt - w.joinedAt
    // (event times are whole seconds)
    if (a.startedAt === undefined || a.startedAt >= w.joinedAt || since < -5000 || since > CV_TWIN_MS) return Infinity
    gap = CV_TWIN_MS + Math.abs(since)
  }
  const other = a.model && w.model && splitEffort(a.model).model !== splitEffort(w.model).model

  return gap + (other ? CV_TWIN_MS : 0) + (w.endedAt !== undefined ? CV_TWIN_MS / 2 : 0)
}

/** The shell-call desk that is this Cetvel agent: its nearest, unless another agent still to be seated is nearer to that desk. */
function shellTwin(list: readonly Worker[], a: CvAgent, rivals: readonly CvAgent[]): number {
  let best = -1
  let score = Infinity
  list.forEach((w, i) => {
    const s = twinScore(w, a)
    if (s >= score) return
    if (rivals.some(b => b.id !== a.id && twinScore(w, b) < s)) return
    score = s
    best = i
  })

  return best
}

/** Seats a Cetvel agent: under its parent's desk when that is in the office (a subagent), else on its own. */
function cvHire(list: readonly Worker[], a: CvAgent, now: number, emit: Emit, say: Say): Worker {
  const parent = a.parent ? list.find(w => w.cv === a.parent && w.activity !== 'leaving') : undefined
  const via = cvViaOf(a)
  const id = `cv:${a.id}`
  const index = nextHire(list)
  const look = MASCOT_INFO[mascotFor({ id, model: a.model, via, kind: 'external' })]
  let w: Worker = {
    id,
    n: index,
    name: '',
    role: 'Dış işçi',
    task: a.name || (parent ? 'Alt görev' : 'Dış görev'),
    color: look.accent,
    seat: packIndex(list),
    activity: 'running',
    bubble: 'Çalışıyorum',
    detail: '',
    tools: a.tools,
    tokensOut: 0,
    since: now + ARRIVE_MS,
    joinedAt: now,
    kind: 'external',
    parentId: parent?.id ?? 'boss',
    writes: 0,
    cv: a.id,
  }
  if (via) w.via = via
  if (a.model) {
    w.model = a.model
    w.modelFrom = 'cetvel'
  }
  const effort = normEffort(a.effort)
  if (effort) w.effort = effort
  w.screen = { kind: 'ext', label: extName(w), at: now }
  const act = hireAct(a.name, undefined, false, id, now)
  if (act) w.act = act
  w = retitle(w, list, true)
  const all = list.concat(w)
  emit({ t: now, who: w.name, color: w.color, whoId: w.id, kind: 'ext', text: `${w.model ? modelLine(w.model, w.effort, via) : extName(w)} · başladı${a.name ? ` · ${clip(a.name, 40)}` : ''}` })
  // a subagent gets its job from its parent's desk; a top agent comes in from outside the office
  if (parent) sayTalk(all, now, () => undefined, say, { id: `ord:${w.id}`, from: parent.id, to: w.id, kind: 'order', text: clip(a.name, 48) || 'Alt görev', isDelivered: true })

  return w
}

/** A Cetvel agent's state on its desk: model and effort, at work (its activity as a prop), waiting, stalled, or ended. */
function cvApply(w: Worker, a: CvAgent, now: number, emit: Emit, say: Say, list: readonly Worker[], errors: number | undefined): Worker {
  let next = withModel(w, { model: a.model, effort: a.effort, from: 'cetvel', at: now }) ?? w
  // Cetvel's own desk: its platform may be known only later
  const via = cvViaOf(a)
  if (next.id.startsWith('cv:') && a.model && via !== next.via) {
    next = { ...next, color: MASCOT_INFO[mascotFor({ id: next.id, model: a.model, via, kind: 'external' })].accent }
    if (via) next.via = via
    else delete next.via
  }
  if (isFinished(a.status)) {
    if (next.endedAt !== undefined) return next
    if (a.status === 'iptal') {
      emit(item(now, next, 'ext', `${extName(next)} · durduruldu`))

      return stoppedEnd(next, now)
    }
    const failed = a.status === 'hata'
    const f = failed ? CV_FAULT[a.fault ?? 'bilinmiyor'] : undefined
    emit(item(now, next, 'ext', `${extName(next)} · ${failed ? 'hata verdi' : 'bitirdi'}${next.task && next.task !== 'Dış görev' ? ` · ${clip(next.task, 40)}` : ''}`))
    say({ id: `rep:${next.id}`, t: now, from: next.id, to: parentOf(list, next), kind: 'report', text: failed ? 'Bir sorun çıktı' : 'İş bitti, sonuç hazır', isDelivered: true })
    const out = ended(next, now, failed, f ? { bubble: f.bubble, fault: f.code } : {})
    // the catalog's trigger, as the nearest reaction the office has (429 the queue ticket, a refusal the shield, timeout/ctx/net)
    if (f) {
      const p = pickActivity({ ...f.facts, phase: 'result' }, [], `${next.id}:${a.lastAt}`, now)
      out.act = applyPick(out.act, { ...p, force: true }, now)
      const cls = classifyError({ source: 'Cetvel', code: a.fault, text: f.facts.out })
      if (cls && cls.id !== 'error-sparks' && cls.id !== p.ev) {
        out.act = pushEvWithRules(out.act, cls.id, now, { bypassCooldown: true, exempt: true })
      }
    }

    return out
  }
  // a shell-call desk that ended stays ended (its call is over); Cetvel's own desk is back at work on a new turn
  if (next.endedAt !== undefined) {
    if (!next.id.startsWith('cv:')) return next
    // a branch stopped from this chat comes back top-down: not while the desk above it is still the stopped one
    const above = next.stopped && next.parentId ? list.find(x => x.id === next.parentId) : undefined
    if (above && above.stopped && (above.endedAt !== undefined || above.activity === 'leaving')) return next
    next = { ...next, endedAt: undefined, idleSince: undefined }
    delete next.stopped
  }
  if (a.status === 'bekliyor' || a.status === 'askida') {
    const stalled = a.status === 'askida'
    const bubble = stalled ? 'Yanıt gelmiyor…' : 'Seni bekliyor'
    if (next.activity === 'waiting' && next.bubble === bubble) return next
    const out: Worker = { ...next, activity: 'waiting', since: Math.max(now, next.since), bubble, screen: { kind: 'wait', label: stalled ? 'Askıda' : 'Bekleme', at: now } }
    if (stalled) out.fault = 'askida'
    else delete out.fault

    return out
  }
  const look = CV_LOOK[a.activity ?? 'bilinmiyor']
  const moved: Worker = { ...next, activity: look.activity, bubble: look.bubble, detail: '', tools: Math.max(next.tools, a.tools), since: next.activity === look.activity ? next.since : Math.max(now, next.since), screen: { ...look.screen, at: now } }
  delete moved.fault
  let trail = next.trail
  let act = clearLoops(next.act, 'api', now, false).state
  if (look.facts) {
    // a fixed stand-in call of that kind picks the prop: Cetvel says it once, so it holds at once
    const p = pickActivity({ ...look.facts, phase: 'call' }, next.trail ?? [], `${next.id}:${a.lastAt}`, now)
    act = applyPick(act, { ...p, force: true }, now)
    trail = pushMark(trail, p.mark)
  }
  moved.act = act
  // a tool error it went on from: the sparks (veya ardışık/çoklu hatada #34)
  if (errors !== undefined && a.toolErrors > errors) {
    const p = pickActivity({ ...CV_FAULT.arac_hatasi.facts, phase: 'result' }, [], `${next.id}:${a.lastAt}:e`, now)
    const storm = a.toolErrors - errors >= 5
    moved.act = storm ? applyLoop(moved.act, { id: 'hata-serisi', at: now, until: now + 60_000 }, now) : applyPick(moved.act, p, now)
    trail = pushMark(trail, { ...p.mark, t: now })
  }
  if (trail && trail.length > 0) moved.trail = trail

  return moved
}

/**
 * Cetvel's snapshot as one change of the team. What it learns of each agent (applied, its errors, its last
 * event) is kept only once the change is stored: `written` runs then.
 */
function cetvelChange(snap: CvSnapshot): { change: WorkerChange; written: () => void } {
  let seen = new Map<string, string>()
  let errs = new Map<string, number>()
  let last = new Map<string, number>()
  const listed = new Set(snap.agents.map(a => a.id))
  const change: WorkerChange = (list, now, emit, say) => {
    // (a write that missed runs this again from the start)
    seen = new Map()
    errs = new Map()
    last = new Map()
    let all = list.slice()
    let changed = false
    const hired: string[] = []
    let seats = all.filter(w => w.id.startsWith('cv:') && w.endedAt === undefined && w.activity !== 'leaving').length
    // An agent with no desk sits down only while it is at work: not finished, not stalled, an event of it
    // in the last minutes; one whose desk was let go (its turn over, Cetvel gone a while, stopped from
    // this chat) only once Cetvel shows an event of it after that.
    const mayHire = (a: CvAgent): boolean => {
      if (isFinished(a.status) || a.status === 'askida' || now - a.lastAt > CV_FRESH_MS) return false
      const hold = Math.max(cvLast.get(a.id) ?? -Infinity, cvHold.get(a.id) ?? -Infinity)

      return a.lastAt > hold
    }
    // the agents still to be seated that a shell desk could be
    const rivals = snap.agents.filter(a => a.depth === 0 && !all.some(w => w.cv === a.id && w.activity !== 'leaving') && mayHire(a))
    // parents first, so a subagent finds its parent's desk
    const agents = snap.agents.slice().sort((x, y) => x.depth - y.depth || (x.startedAt ?? x.lastAt) - (y.startedAt ?? y.lastAt))
    for (const a of agents) {
      let at = all.findIndex(w => w.cv === a.id && w.activity !== 'leaving')
      // a subagent reports to its parent's live desk: a parent that sat down again (a new turn) takes its branch back
      if (at >= 0 && a.parent) {
        const cur = all[at] as Worker
        const up = all.find(w => w.cv === a.parent && w.activity !== 'leaving' && w.endedAt === undefined)
        if (up && up.id !== cur.id && cur.parentId !== up.id) {
          all[at] = { ...cur, parentId: up.id }
          changed = true
        }
      }
      const key = cvKey(a)
      if (at >= 0 && cvSeen.get(a.id) === key) continue
      if (at < 0) {
        if (!mayHire(a)) continue
        const twin = shellTwin(all, a, rivals)
        if (twin >= 0) {
          all[twin] = { ...(all[twin] as Worker), cv: a.id }
          at = twin
        } else {
          if (seats >= CV_MAX) continue
          const w = cvHire(all, a, now, emit, say)
          all = all.concat(w)
          at = all.length - 1
          seats++
          hired.push(w.parentId ?? 'boss')
        }
        changed = true
      }
      const was = all[at] as Worker
      const next = cvApply(was, a, now, emit, say, all, cvErrors.get(a.id))
      seen.set(a.id, key)
      errs.set(a.id, a.toolErrors)
      last.set(a.id, a.lastAt)
      if (next !== was) {
        all[at] = next
        changed = true
      }
    }
    // a desk Cetvel no longer lists has finished (Cetvel drops a finished agent after a while)
    all = all.map(w => {
      if (!w.id.startsWith('cv:') || !w.cv || listed.has(w.cv) || w.endedAt !== undefined || w.activity === 'leaving') return w
      changed = true
      emit(item(now, w, 'ext', `${extName(w)} · bitirdi`))
      say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(all, w), kind: 'report', text: 'İş bitti, sonuç hazır', isDelivered: true })

      return ended(w, now, false)
    })
    if (!changed) return list
    // a desk whose subagents just sat down is a deputy boss while they run
    const parents = new Set(hired.filter(p => p !== 'boss'))

    return parents.size === 0 ? all : all.map(w => (parents.has(w.id) ? retitle(w, all, true) : w))
  }
  const written = () => {
    for (const [k, v] of seen) cvSeen.set(k, v)
    for (const [k, v] of errs) cvErrors.set(k, v)
    for (const [k, v] of last) cvLast.set(k, Math.max(v, cvLast.get(k) ?? -Infinity))
    // what is known of agents Cetvel no longer lists goes, once there is much of it
    for (const m of [cvSeen, cvErrors, cvLast, cvHold] as Array<Map<string, unknown>>) if (m.size > 300) for (const k of m.keys()) if (!listed.has(k)) m.delete(k)
  }

  return { change, written }
}

/** Cetvel stopped writing (or its file is gone): its own desks leave; the shell-call desks are the shell's. */
function cetvelGone($: $): void {
  cvSeen.clear()
  cvLive = new Set()
  changeWorkers($, (list, now, emit) => {
    if (!list.some(w => w.id.startsWith('cv:') && w.endedAt === undefined && w.activity !== 'leaving')) return list

    return list.map(w => {
      if (!w.id.startsWith('cv:') || w.endedAt !== undefined || w.activity === 'leaving') return w
      emit(item(now, w, 'ext', `${extName(w)} · hat kapandı`))

      return stoppedEnd(w, now, 'Hat kapandı', 'isci-coktu')
    })
  })
}

/** Looks at Cetvel's file: read only when its time changed, applied only when its content did. */
async function pollCetvel($: $): Promise<void> {
  if (cvFile === undefined) {
    const base = await $.env.get('LOCALAPPDATA').catch(() => undefined)
    cvFile = base ? `${base.replace(/\\/g, '/').replace(/\/$/, '')}/Cetvel/ajanlar.json` : null
  }
  if (!cvFile) return
  const now = await $.clock.now()
  const stat = await $.fs.stat(cvFile).catch(() => undefined)
  if (!stat || stat.kind !== 'file') {
    if (cvSeq >= 0) {
      cvSeq = -1
      cvMtime = 0
      cetvelGone($)
    }
    return
  }
  if (stat.mtimeMs !== cvMtime) {
    cvMtime = stat.mtimeMs
    const snap = readSnapshot(String(await $.fs.read(cvFile).catch(() => '')))
    // half written or another format: wait for the next write
    if (!snap) return
    cvFresh = Math.max(snap.at, stat.mtimeMs)
    if (now - cvFresh <= CV_STALE_MS && snap.seq !== cvSeq) {
      cvSeq = snap.seq
      cvLive = new Set(snap.agents.filter(a => !isFinished(a.status)).map(a => a.id))
      const { change, written } = cetvelChange(snap)
      changeWorkers($, change, written)
    }
  }
  if (cvSeq >= 0 && now - cvFresh > CV_STALE_MS) {
    cvSeq = -1
    cetvelGone($)
  }
}

export const register: Register = (on, options) => {

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    bossAsked = false
    await update($, workersA, list => (list.some(w => w.id === 'boss') ? list.map(w => (w.id === 'boss' ? { ...w, name: BOSS.name } : w)) : [newBoss(now, BOSS.name), ...list]))
    changeWorkers($, (list, at) => list.map(w => ({ ...w, act: clearLoops(w.act, 'api', at, true).state })))
    await update($, statsA, s => (s.sessionStart ? s : { ...s, sessionStart: now }))
    await $.command.register({ name: 'ofis', description: 'Piksel Ofis panelini açar: canlı piksel ofis, ekip, akış ve bağlam.' })
    $.clock.every(2000, () => void tick($).catch(() => undefined))
    // Cetvel's outside agents (Codex, Antigravity and their subagents), when its file is there
    $.clock.every(CV_POLL_MS, () => void pollCetvel($).catch(() => undefined))
    $.clock.after(500, () => void pollCetvel($).catch(() => undefined))
    $.clock.every(1000, () => void paint($).catch(() => undefined))
    // the auto compact setting may change from kota-bandi's band; the theme from the app
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
      const fivePct = usage.rateLimits.find(l => l.kind === 'five_hour')?.percentUsed ?? 0
      const weekPct = usage.rateLimits.find(l => l.kind === 'seven_day')?.percentUsed ?? 0
      patch($, 'boss', (w, at) => {
        let act = clearLoops(clearLoops(w.act, ['giris-gerek', 'sikistirma'], at, false).state, 'api', at, false).state
        if (fivePct < 100) act = clearLoops(act, ['kota-oturum'], at, false).state
        if (weekPct < 100) act = clearLoops(act, ['kota-haftalik'], at, false).state
        return { act }
      })
    } catch {
      // Figures arrive with the first measurement instead.
    }

    return result
  })

  on('command.run', { command: 'ofis' }, async $ => {
    const placed = await $.ui.open({ id: PANE, title: TITLE })

    return { text: placed.isPlaced ? 'Piksel Ofis paneli açıldı.' : `Panel açılamadı: ${placed.reason}` }
  })

  on('turn.start', async ($, e, next) => {
    const id = workerId(e.agentId)
    if (id === 'boss') {
      isTurning = true
      const now = await $.clock.now()
      await update($, turnA, t => ({ ...t, active: true, startedAt: now, steps: 0, turns: t.turns + 1, prompt: clip(e.text, 140) }))
      patch($, 'boss', (w, at) => ({
        activity: 'thinking',
        think: 'general',
        since: at,
        streamAt: undefined,
        bubble: pick(QUIPS.turn, String(at)),
        detail: clip(e.text, 200),
        // the new prompt is the answer it waited for (#28)
        ...(w.act?.loops?.some(l => l.id === 'soru-bekle') ? { act: clearLoops(w.act, ['soru-bekle'], at, false).state } : {}),
      }))
      feed($, BOSS, 'prompt', `yeni istek · ${clip(e.text, 50)}`)
    } else {
      patch($, id, (w, at) => {
        signAt.set(id, at)
        return w.endedAt === undefined ? { activity: 'thinking', since: at, streamAt: undefined } : null
      })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const id = workerId(e.agentId)
    signAt.set(id, await $.clock.now())
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
    let resumes: { runId: string; before: ReadonlySet<string> } | undefined
    if (tool === 'Workflow') {
      // a resume starts the run over: its last attempt's agents hand over to the new ones, once the call went through
      if (typeof input.resumeFromRunId === 'string' && input.resumeFromRunId) {
        const runId = input.resumeFromRunId
        resumes = { runId, before: new Set((await read($, workersA).catch(() => [] as Worker[])).filter(w => w.runId === runId).map(w => w.id)) }
      }
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
    // #41: aynı araç + aynı girdi üst üste 5 kez; bekleme/yoklama çağrısı sayılmaz (ama farklı çağrıdır: çarkı durdurur)
    const poll = isPollCall(tool, input)
    const callSig = poll ? '' : sigHash(tool, input)
    const prevRep = repeatTrack.get(id)
    const repCount = !poll && prevRep?.sig === callSig ? prevRep.count + 1 : 1
    repeatTrack.set(id, { sig: callSig, count: poll ? 0 : repCount })
    // the boss's own ask is answered by its own call; an agent's approval also ends the boss's mirrored wait (#27)
    if (id === 'boss') bossAsked = false
    let approvedAgent = false
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
        // seated while a workflow runs: one of its agents (its spawn, if it comes, says which one)
        if (lastRun && now - lastRun.at < WF_HINT_MS) {
          w.runId = lastRun.runId
          w.taskId = lastRun.taskId
        }
        if (!w.model) {
          const guess = guessOf(all, 'boss')
          if (guess) w.guess = guess
        }
        gone.delete(id)
        all = all.concat(retitle(w, all, true))
      }

      return all.map(w => {
        if (w.id !== id || w.activity === 'leaving') return w
        // a finished worker that calls a tool is at work again (its end came early, or it was woken): what ended it goes too
        const back = w.endedAt !== undefined ? atWorkAgain(w) : w
        // a message's line and an outside worker's come with their own rows
        if (tool !== 'SendMessage' && !ext) emit({ t: now, who: w.name, color: w.color, whoId: w.id, kind: r.feed, text: r.detail })
        // the monitor shows the real work: a file name, a command's kind, a site; never the command or a path
        const moved: Worker = { ...back, activity: r.activity, site: r.site, tool, bubble: r.bubble, detail: r.detail, since: now, streamAt: undefined, tools: w.tools + 1, screen: { ...r.screen, at: now } }
        if (isWrite) {
          moved.writes = (w.writes ?? 0) + 1
          if ((w.writes ?? 0) === 0 && w.id !== 'boss') moved.duty = dutyFor({ task: w.task, writes: moved.writes })
        }
        if (plan && w.id !== 'boss') moved.plan = plan
        // its activity: a new one only when it comes twice (no flicker); a one-off plays from now
        const hadPerm = back.act?.loops?.some(l => l.id === 'izin-bekle') ?? false
        if (hadPerm && w.id !== 'boss') approvedAgent = true
        const hadRepeat = back.act?.loops?.some(l => l.id === 'sonsuz-dongu') ?? false
        let baseAct = hadPerm ? clearLoops(back.act, ['izin-bekle'], now, false).state : back.act
        // a call after a question (#28): it was answered
        if (baseAct?.loops?.some(l => l.id === 'soru-bekle')) baseAct = clearLoops(baseAct, ['soru-bekle'], now, false).state
        if (repCount === 1 && hadRepeat) baseAct = clearLoops(baseAct, ['sonsuz-dongu'], now, true).state
        const p = pickActivity({ ...facts, teamFailed: all.some(x => x.activity === 'failed' && x.endedAt !== undefined) }, w.trail ?? [], e.tool_use_id, now)
        let nextAct = applyPick(baseAct, p, now)
        if (hadPerm) nextAct = pushEvWithRules(nextAct, 'izin-onay', now, { bypassCooldown: true })
        if (repCount >= 5) nextAct = applyLoop(nextAct, { id: 'sonsuz-dongu', at: now }, now)
        moved.act = nextAct
        const trail = pushMark(w.trail, p.mark)
        if (trail.length > 0) moved.trail = trail

        // its title follows what it does, once the same work comes twice
        return retitle(moved, all)
      })
    })
    // an agent's approval was the prompt the boss mirrored (Notification permission_prompt has no agent): it ends
    // the boss's wait too, unless the boss asked for itself and has not been answered
    // (queued after the change above, so it sees what that change found)
    changeWorkers($, (list, at) => (approvedAgent && !bossAsked ? withoutBossWait(list, at) : list))
    // the boss's plan goes on the whiteboard
    if (plan && id === 'boss') void update($, turnA, t => ({ ...t, plan })).catch(() => undefined)
    // an outside CLI started from any loop (a workflow agent's too) takes a desk of its own, under that loop
    if (ext) hireExternal($, { id: extId, parentId: id, ext, description })
    stat($, s => ({ ...s, tools: { ...s.tools, [tool]: (s.tools[tool] ?? 0) + 1 } }))

    openCalls.set(id, (openCalls.get(id) ?? 0) + 1)
    const callAt = await $.clock.now()
    signAt.set(id, callAt)
    if (isShell && e.tool_use_id) {
      await readShellEnv($).catch(() => undefined)
      callStart.set(e.tool_use_id, callAt)
      if (callStart.size > 200) for (const k of callStart.keys()) if (callStart.size > 150) callStart.delete(k)
    }
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } finally {
      const left = (openCalls.get(id) ?? 1) - 1
      if (left > 0) openCalls.set(id, left)
      else openCalls.delete(id)
      if (e.tool_use_id) callStart.delete(e.tool_use_id)
    }
    const meta = toolErrorMeta(ran)
    const failed = ('isError' in ran && ran.isError === true) || (meta.exitCode !== undefined && meta.exitCode !== 0)
    // refused (by you or a hook): the call never ran, so nothing it would have done is shown
    const denied = 'deny' in ran && typeof ran.deny === 'string'
    if (resumes && !failed && !denied) stopRun($, resumes.runId, resumes.before)
    // a Workflow call names its background task and its run: TaskStop and the task list find its agents by them
    if (tool === 'Workflow' && !failed && 'result' in ran) {
      const rec = (ran.result ?? {}) as { taskId?: unknown; runId?: unknown }
      if (typeof rec.taskId === 'string' && typeof rec.runId === 'string' && rec.taskId && rec.runId) {
        const taskId = rec.taskId
        const runId = rec.runId
        wfRuns.set(taskId, runId)
        if (wfRuns.size > 60) for (const k of wfRuns.keys()) if (wfRuns.size > 40) wfRuns.delete(k)
        lastRun = { runId, taskId, at: await $.clock.now() }
        changeWorkers($, list => (list.some(w => w.runId === runId && w.taskId !== taskId) ? list.map(w => (w.runId === runId ? { ...w, taskId } : w)) : list))
      }
    }
    // TaskStop: the task it stopped (an agent, a workflow run, an outside worker's shell) leaves its desks at once
    if (tool === 'TaskStop' && !failed && !denied) {
      const rec = (('result' in ran ? ran.result : undefined) ?? {}) as { task_id?: unknown }
      const taskId = typeof rec.task_id === 'string' && rec.task_id ? rec.task_id : typeof input.task_id === 'string' ? input.task_id : typeof input.shell_id === 'string' ? input.shell_id : ''
      if (taskId) stopTask($, taskId)
    }
    // the result: a refusal (shield), a queue (429/529), a broken test, an agent's report back, a spark
    const prevFail = seenToolFail.get(e.tool_use_id)
    const errNow = await $.clock.now()
    signAt.set(id, errNow)
    // #40: a shell call that ran to its own time limit was cut off (its time says it, not its text)
    const timedOut = isShell && ranToLimit(errNow - callAt, input)
    const cutOff = !failed && !denied && timedOut && ((('result' in ran ? ran.result : undefined) ?? {}) as { interrupted?: unknown }).interrupted === true
    const uSnap = failed || denied ? await read($, usageA).catch(() => undefined) : undefined
    let grepBenign = false
    {
      const said = (ran as { text?: unknown }).text
      const res: ToolFacts = { ...facts, phase: 'result', failed: failed || cutOff, denied }
      if (typeof said === 'string') res.out = said.slice(0, 4000)
      else if (failed && typeof ran.result === 'string') res.out = ran.result.slice(0, 4000)
      grepBenign = prevFail?.kind === 'benign'
      if (!failed && !denied && !cutOff) {
        resetErrs(id)
        const p = pickActivity(res, [], e.tool_use_id, errNow)
        changeWorkers($, (list, at) => {
          const gl = globalLoopOf(list, at)
          let changed = false
          const out = list.map(w => {
            if (w.id !== id) {
              // Küresel API engeli patronda tutulur; başka masadaki başarı da bağlantının döndüğünü kanıtlar.
              if (w.id === 'boss' && w.act?.loops?.some(l => l.global && ['ag-kopuk', 'asiri-yuk-529', 'queue-ticket', 'zaman-asimi'].includes(l.id))) {
                changed = true
                return { ...w, act: clearLoops(w.act, 'api', at, true).state }
              }
              return w
            }
            if (w.endedAt !== undefined || w.activity === 'leaving') return w
            const r1 = clearLoops(w.act, 'api', at, true)
            const r2 = clearLoops(r1.state, ['hata-serisi'], at, true)
            let act = r2.state
            const hadLoops = r1.closed.length > 0 || r2.closed.length > 0
            if (!p.main && !p.ev && !p.mark.f && !p.mark.s && !hadLoops) return w
            changed = true
            if (p.main) act = applyPick(act, { ...p, ev: undefined }, at)
            if (p.ev) act = pushEvWithRules(act, p.ev, at, { globalLoop: gl, bypassCooldown: true })
            const trail = pushMark(w.trail, { ...p.mark, t: at })
            const upd: Worker = { ...w, act, ...(trail.length > 0 ? { trail } : {}) }
            if (hadLoops) delete upd.fault
            return upd
          })
          return changed ? out : list
        })
      } else if (denied) {
        if (prevFail?.clsId !== 'shield-guard' && prevFail?.clsId !== 'kural-engeli') {
          changeWorkers($, (list, at) => {
            const gl = globalLoopOf(list, at)
            return list.map(w => {
              if (w.id !== id || w.endedAt !== undefined || w.activity === 'leaving') return w
              const cleared = clearLoops(w.act, ['izin-bekle'], at, false).state
              const act = pushEvWithRules(cleared, meta.hookBlocked ? 'kural-engeli' : 'shield-guard', at, { globalLoop: gl })
              const trail = pushMark(w.trail, { t: at, s: 'audit' })
              return { ...w, fault: meta.hookBlocked ? 'kural-engeli' : 'izin-red', act, ...(trail.length > 0 ? { trail } : {}) }
            })
          })
        }
      } else if (prevFail?.kind === 'err') {
        // PostToolUseFailure came first and did it all for this call (its play, its one mark, its place in
        // the streak and the storm count): the same failure is not counted twice
      } else if (prevFail?.kind !== 'benign' && prevFail?.kind !== 'iptal') {
        const cmdStr = typeof input.command === 'string' ? input.command : undefined
        const cls = classifyError({
          source: 'ToolCall',
          tool,
          cmd: cmdStr,
          text: res.out,
          timedOut,
          ...meta,
          ...usageMeta(uSnap),
        })
        if (!cls) {
          grepBenign = true
          markToolFail(e.tool_use_id, errNow, { kind: 'benign' })
        } else {
          markToolFail(e.tool_use_id, errNow, { kind: 'err', clsId: cls.id, stormCounted: true })
          const storm = recordErrStamp(id, errNow)
          const streak = bumpStreak(id)
          const p = pickActivity(res, [], e.tool_use_id, errNow)
          // a broken test shows its own flask, no sparks (1.0 rule 6); it still counts in the streak
          const quiet = cls.id === 'error-sparks' && p.main !== undefined && p.ev === undefined
          changeWorkers($, (list, at) => {
            const gl = globalLoopOf(list, at)
            return list.map(w => {
              if (w.id !== id || w.endedAt !== undefined || w.activity === 'leaving') return w
              const cleared = clearLoops(w.act, ['izin-bekle'], at, false).state
              let act = cls.id === 'test-kirik' ? cleared : applyPick(cleared, cls.kind === 'loop' ? { ...p, ev: undefined } : { ...p, ev: p.ev === 'error-sparks' || p.ev === 'queue-ticket' ? undefined : p.ev }, at)
              const trail = pushMark(w.trail, { ...p.mark, f: 1, t: at })
              act = applyErrorCls(act, cls, streak, at, gl, storm, false, quiet)
              return { ...w, act, ...(cls.fault ? { fault: cls.fault } : {}), ...(trail.length > 0 ? { trail } : {}) }
            })
          })
        }
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
      else endExternal($, extId, failed || res.interrupted === true || denied)
    }
    if (currentTool.get(id) === e.tool_use_id) {
      const isInterrupt = prevFail?.kind === 'iptal'
      const effectiveFail = failed && !grepBenign && !isInterrupt
      // a hire waits for its worker, as does a backgrounded outside worker; a foreground one has answered
      const waits = r.activity === 'delegating' && !effectiveFail && (!ext || isBackground)
      patch($, id, (w, at) =>
        w.endedAt !== undefined || waits
          ? null
          : { activity: isInterrupt ? 'idle' : 'thinking', think: 'general', since: at, bubble: isInterrupt ? 'Durduruldu.' : effectiveFail ? `${r.label} hata verdi, bakıyorum` : 'Sonuca bakıyorum…' },
      )
      if (effectiveFail) {
        changeWorkers($, (list, _now, emit) => {
          const w = list.find(x => x.id === id)
          if (w) emit({ t: errNow, who: w.name, color: w.color, whoId: w.id, kind: 'fail', text: `${r.label.toLocaleLowerCase('tr-TR')} hata verdi` })

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
      if (e.workflow?.runId) {
        info.runId = e.workflow.runId
        info.wfIndex = e.workflow.agentIndex
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
            const back: Worker = { ...atWorkAgain(w), activity: 'thinking' as const, think: 'general' as const, since: now, bubble: 'Yeniden göreve döndüm' }

            return model ? withModel(back, { model, effort: info.effort, from: info.from ?? 'spawn', at: now }) ?? back : back
          })
        })
      }
    }

    return result
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const summary = typeof e.last_assistant_message === 'string' ? clip(e.last_assistant_message, 220) : undefined
    repeatTrack.delete(e.agent_id)
    resetErrs(e.agent_id)
    changeWorkers($, (list, now, emit, say) =>
      list.map(w => {
        if (w.id !== e.agent_id || w.endedAt !== undefined) return w
        emit(item(now, w, 'done', 'görevi bitirdi'))
        // the report flies back to whoever gave the job
        say({ id: `rep:${w.id}`, t: now, from: w.id, to: parentOf(list, w), kind: 'report', text: talkText(undefined, e.last_assistant_message) || 'Rapor hazır', isDelivered: true })
        const c1 = clearLoops(w.act, 'api', now, false).state
        const c2 = clearLoops(c1, 'tool', now, false).state

        return { ...ended({ ...w, act: c2 }, now, false), summary, detail: summary ?? '' }
      }),
    )
    settleBackground($, e.background_tasks)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    repeatTrack.delete('boss')
    resetErrs('boss')
    patch($, 'boss', (w, at) => {
      const c1 = clearLoops(w.act, 'api', at, true)
      const c2 = clearLoops(c1.state, 'tool', at, true)
      if (c1.closed.length === 0 && c2.closed.length === 0) return null
      return { act: c2.state }
    })
    settleBackground($, e.background_tasks)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.StopFailure', async ($, e, next) => {
    const now = await $.clock.now()
    const id = workerId(agentOf(e))
    const uSnap = await read($, usageA).catch(() => undefined)
    // Ham hata/assistant metni yalnız sınıflandırma için yerel okunur; state/balona asla yazılmaz
    const raw = [e.error_details, e.last_assistant_message].filter((s): s is string => typeof s === 'string').join(' ')
    const cls =
      classifyError({ source: 'StopFailure', code: e.error, text: raw, ...usageMeta(uSnap) }) ??
      ({ id: 'error-sparks', fault: 'arac-hata', kind: 'ev', prio: 50, bubble: 'Bir sorun oluştu' } as ErrorClassification)
    // #45: a subagent's turn that ended in an API error is over: it drops (failed, never a celebration)
    const drops = id !== 'boss' && !cls.global
    if (drops) {
      repeatTrack.delete(id)
      resetErrs(id)
    }
    changeWorkers($, (list, at, emit, say) => {
      const gl = globalLoopOf(list, at)
      const who = list.find(w => w.id === id) ?? BOSS
      emit(item(at, who, 'fail', globalFeedText(cls)))
      return list.map(w => {
        // a global lock or outage lives on the boss alone (rule 7: it reaches every desk through globalLoopOf, and
        // its ends — auth_success, the quota back, the boss's next answer — are the boss's): a copy on an agent
        // would outlive them
        if (cls.global ? w.id !== 'boss' : w.id !== id) return w
        if (drops) {
          if (w.endedAt !== undefined || w.activity === 'leaving') return w
          // its parent hears of it (never the raw error); the mishap plays, then the puff of smoke
          say({ id: `rep:${w.id}`, t: at, from: w.id, to: parentOf(list, w), kind: 'report', text: 'Hatayla düştüm', isDelivered: true })
          const c1 = clearLoops(w.act, 'api', at, false).state
          const c2 = clearLoops(c1, 'tool', at, false).state
          const down = ended({ ...w, act: c2 }, at, true, { bubble: 'Hatayla düştüm', fault: 'alt-ajan-dustu' })
          let act = down.act
          if (cls.kind === 'ev' && cls.id !== 'error-sparks') act = pushEvWithRules(act, cls.id, at, { exempt: true, bypassCooldown: true })
          act = pushEvWithRules(act, 'alt-ajan-dustu', at, { exempt: true, bypassCooldown: true })
          return { ...down, act }
        }
        const nextAct = applyErrorCls(w.act, cls, 0, at, gl, false, false)
        return {
          ...w,
          ...(cls.fault ? { fault: cls.fault } : {}),
          ...(cls.bubble ? { bubble: cls.bubble } : {}),
          act: nextAct,
        }
      })
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    const now = await $.clock.now()
    const id = workerId(agentOf(e))
    const prev = seenToolFail.get(e.tool_use_id)
    if (prev && (prev.kind === 'benign' || prev.kind === 'iptal' || prev.clsId)) return next(e)
    const inp = (e.tool_input ?? {}) as Record<string, unknown>
    const cmdStr = typeof inp.command === 'string' ? inp.command : undefined
    const errText = typeof e.error === 'string' ? e.error : ''
    const isInterrupt = e.is_interrupt === true
    if (isInterrupt) {
      markToolFail(e.tool_use_id, now, { kind: 'iptal', clsId: 'iptal' })
      changeWorkers($, (list, at, emit) => {
        const gl = globalLoopOf(list, at)
        const who = list.find(w => w.id === id) ?? BOSS
        emit(item(at, who, 'turn', 'durduruldu'))
        return list.map(w => {
          if (w.id !== id || w.endedAt !== undefined || w.activity === 'leaving') return w
          const act = applyErrorCls(w.act, { id: 'iptal', fault: 'iptal', kind: 'ev', prio: 88, bubble: 'Durduruldu' }, 0, at, gl, false, true)
          return { ...w, activity: 'idle', since: at, fault: 'iptal', bubble: 'Durduruldu', act }
        })
      })
      return next(e)
    }
    const uSnap = await read($, usageA).catch(() => undefined)
    // #40: the hook says how long the call ran (else the call's own start, kept by tool.call); a shell call that
    // reached its own limit timed out. This record is the one the call's result defers to, so it must know.
    const hookMs = (e as { duration_ms?: unknown }).duration_ms
    const startedAt = callStart.get(e.tool_use_id)
    const tookMs = typeof hookMs === 'number' && Number.isFinite(hookMs) ? hookMs : startedAt !== undefined ? now - startedAt : undefined
    const timedOut = (e.tool_name === 'Bash' || e.tool_name === 'PowerShell') && tookMs !== undefined && ranToLimit(tookMs, inp)
    const cls = classifyError({ source: 'PostToolUseFailure', tool: e.tool_name, cmd: cmdStr, text: errText, timedOut, ...toolErrorMeta(e), ...usageMeta(uSnap) })
    if (!cls) {
      markToolFail(e.tool_use_id, now, { kind: 'benign' })
      return next(e)
    }
    // recorded first: the tool.call result of this same call does not count it again
    markToolFail(e.tool_use_id, now, { kind: 'err', clsId: cls.id, stormCounted: true })
    const storm = recordErrStamp(id, now)
    const streak = bumpStreak(id)
    // the same pick the tool.call result makes: its one mark (a broken test's is the flask's), its main, no sparks for a test
    const p = pickActivity({ ...toolFacts(e.tool_name, inp, false), phase: 'result', failed: true, out: errText.slice(0, 4000) }, [], e.tool_use_id, now)
    const quiet = cls.id === 'error-sparks' && p.main !== undefined && p.ev === undefined
    changeWorkers($, (list, at) => {
      const gl = globalLoopOf(list, at)
      return list.map(w => {
        if (w.id !== id || w.endedAt !== undefined || w.activity === 'leaving') return w
        const cleared = clearLoops(w.act, ['izin-bekle'], at, false).state
        const picked = p.main && cls.id !== 'test-kirik' ? applyPick(cleared, { ...p, ev: undefined }, at) : cleared
        const trail = pushMark(w.trail, { ...p.mark, f: 1, t: at })
        const act = applyErrorCls(picked, cls, streak, at, gl, storm, false, quiet)
        return { ...w, ...(cls.fault ? { fault: cls.fault } : {}), act, trail }
      })
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionDenied', async ($, e, next) => {
    const now = await $.clock.now()
    const id = workerId(agentOf(e))
    changeWorkers($, (list, at, emit) => {
      const gl = globalLoopOf(list, at)
      const who = list.find(w => w.id === id) ?? BOSS
      emit(item(at, who, 'fail', 'izin verilmedi'))
      return list.map(w => {
        if (w.id !== id || w.endedAt !== undefined || w.activity === 'leaving') return w
        const cleared = clearLoops(w.act, ['izin-bekle'], at, false).state
        const act = pushEvWithRules(cleared, 'shield-guard', at, { globalLoop: gl })
        const trail = pushMark(w.trail, { t: at, s: 'audit' })
        return { ...w, fault: 'izin-red', bubble: 'İzin verilmedi', act, trail }
      })
    })
    markToolFail(e.tool_use_id, now, { kind: 'denied', clsId: 'shield-guard' })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', async ($, e, next) => {
    patch($, workerId(agentOf(e)), (w, at) => ({ act: pushEvWithRules(w.act, 'model-gecis', at) }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PreCompact', async ($, e, next) => {
    const id = workerId(agentOf(e))
    const mode = e.trigger === 'auto' ? 'auto' : 'manual'
    patch($, id, (w, at) => {
      const cleared = clearLoops(w.act, ['baglam-asildi'], at, false).state
      return {
        activity: 'compacting',
        since: at,
        fault: 'sikistirma',
        bubble: pick(QUIPS.compact, String(at)),
        act: applyLoop(cleared, { id: 'sikistirma', at, mode }, at),
      }
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostCompact', async ($, e, next) => {
    const id = workerId(agentOf(e))
    patch($, id, (w, at) => {
      const cleared = clearLoops(w.act, ['sikistirma', 'baglam-asildi'], at, true).state
      const { fault: _f, ...rest } = w
      void _f
      return { ...rest, activity: 'idle', since: at, bubble: 'Masa toparlandı, devam!', act: cleared }
    })

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
      patch($, agentId, (w, at) =>
        w.endedAt !== undefined
          ? null
          : {
              activity: 'waiting',
              since: at,
              fault: 'izin-bekle',
              bubble: `Onay bekliyorum: ${tool}`,
              screen: { kind: 'wait', label: tool || 'Onay', at },
              act: applyLoop(w.act, { id: 'izin-bekle', at }, at),
            },
      )
      changeWorkers($, (list, _now, emit) => {
        const w = list.find(x => x.id === agentId)
        if (w) emit(item(Date.now(), w, 'wait', `onay bekliyor · ${tool}`))

        return list
      })
    } else {
      // the boss's own ask: the Notification that follows says it in the feed
      bossAsked = true
      patch($, 'boss', (w, at) => ({
        activity: 'waiting',
        since: at,
        fault: 'izin-bekle',
        bubble: `Onayını bekliyorum: ${tool}`,
        screen: { kind: 'wait', label: tool || 'Onay', at },
        act: applyLoop(w.act, { id: 'izin-bekle', at }, at),
      }))
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
      if (e.isAborted || e.reason === 'aborted') {
        repeatTrack.delete('boss')
        resetErrs('boss')
        patch($, 'boss', (w, at) => {
          const c1 = clearLoops(w.act, 'api', at, false).state
          const c2 = clearLoops(c1, 'tool', at, false).state
          const act = pushEvWithRules(c2, 'iptal', at, { exempt: true, bypassCooldown: true })
          return { activity: 'idle', since: at, bubble: words, fault: 'iptal', act }
        })
      } else if (e.reason === 'answer') {
        repeatTrack.delete('boss')
        resetErrs('boss')
        patch($, 'boss', (w, at) => {
          const c1 = clearLoops(w.act, 'lock', at, true)
          const c2 = clearLoops(c1.state, 'api', at, true)
          const c3 = clearLoops(c2.state, 'tool', at, true)
          return { activity: 'idle', since: at, bubble: words, act: c3.state }
        })
      } else {
        // an error or a refusal ends the turn too: nothing waits for an approval or repeats in it any more (the
        // API loops a StopFailure set stay until their own end)
        repeatTrack.delete('boss')
        resetErrs('boss')
        patch($, 'boss', (w, at) => ({
          activity: e.reason === 'error' ? 'failed' : 'idle',
          since: at,
          bubble: words,
          ...(w.act?.loops ? { act: clearLoops(w.act, ['izin-bekle', 'sonsuz-dongu', 'hata-serisi'], at, false).state } : {}),
        }))
      }
      bossAsked = false
      feed($, BOSS, e.reason === 'error' ? 'fail' : 'turn', `${words}${e.usage ? ` · ${fmtTokens(e.usage.output_tokens)} token üretildi` : ''}`)
    } else if (e.reason === 'error') {
      repeatTrack.delete(id)
      resetErrs(id)
      changeWorkers($, (list, at, _emit, say) =>
        list.map(w => {
          if (w.id !== id || w.endedAt !== undefined) return w
          say({ id: `rep:${w.id}`, t: at, from: w.id, to: parentOf(list, w), kind: 'report', text: 'Görev yarım kaldı', isDelivered: true })

          return ended(w, at, true)
        }),
      )
    } else if (e.reason === 'aborted' || e.reason === 'refusal') {
      repeatTrack.delete(id)
      resetErrs(id)
      // an interrupted (or refused) turn ends the agent, unless it is a teammate that waits for its next one
      const info = await $.agent.list().then(l => l.find(a => a.id === id)).catch(() => undefined)
      if (!info?.teammateId) {
        const refused = e.reason === 'refusal'
        changeWorkers($, (list, at, emit) =>
          list.map(w => {
            if (w.id !== id || w.endedAt !== undefined || w.activity === 'leaving') return w
            emit(item(at, w, 'turn', refused ? 'yapamayacağını söyledi' : 'durduruldu'))

            return stoppedEnd(w, at, refused ? 'Bunu yapamam' : 'Durduruldu', refused ? 'model-reddi' : 'iptal', !refused)
          }),
        )
      } else if (e.reason === 'aborted') {
        patch($, id, (w, at) => {
          const c1 = clearLoops(w.act, 'api', at, false).state
          const c2 = clearLoops(c1, 'tool', at, false).state
          return { activity: 'idle', since: at, fault: 'iptal', bubble: 'Durduruldu', act: pushEvWithRules(c2, 'iptal', at, { exempt: true, bypassCooldown: true }) }
        })
      }
    } else if (e.reason === 'answer') {
      repeatTrack.delete(id)
      resetErrs(id)
      patch($, id, (w, at) => {
        const c1 = clearLoops(w.act, 'api', at, true)
        const c2 = clearLoops(c1.state, 'tool', at, true)
        if (c1.closed.length === 0 && c2.closed.length === 0) return null
        return { act: c2.state }
      })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined) {
      const mode = e.trigger === 'auto' ? 'auto' : 'manual'
      patch($, 'boss', (w, at) => {
        const cleared = clearLoops(w.act, ['baglam-asildi'], at, false).state
        return {
          activity: 'compacting',
          since: at,
          fault: 'sikistirma',
          bubble: pick(QUIPS.compact, String(at)),
          act: applyLoop(cleared, { id: 'sikistirma', at, mode }, at),
        }
      })
      feed($, BOSS, 'compact', `Bağlam sıkıştırılıyor (${e.trigger === 'auto' ? 'otomatik' : 'elle'})`)
      await flush($)
    }
    const result = await next(e)
    if (e.agentId === undefined) {
      patch($, 'boss', (w, at) => ({
        activity: 'idle',
        since: at,
        act: clearLoops(w.act, ['sikistirma', 'baglam-asildi'], at, true).state,
        bubble: 'Masa toparlandı, devam!',
      }))
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
    const five = e.rateLimits.find(l => l.kind === 'five_hour')
    const week = e.rateLimits.find(l => l.kind === 'seven_day')
    const lock = week && week.percentUsed >= 100 ? { id: 'kota-haftalik' as const, resetAt: parseResetMs(week.resetsAt) } : five && five.percentUsed >= 100 ? { id: 'kota-oturum' as const, resetAt: parseResetMs(five.resetsAt) } : undefined
    if (lock) {
      changeWorkers($, (list, at, emit) =>
        list.map(w => {
          if (w.id !== 'boss') return w
          // a lock seen anew is news (its line paints the office soon); a measurement that repeats it is not
          if (!w.act?.loops?.some(l => l.id === lock.id)) emit(item(at, w, 'fail', lock.id === 'kota-haftalik' ? 'haftalık kullanım limiti doldu' : '5 saatlik kullanım limiti doldu'))

          return { ...w, fault: lock.id, act: applyLoop(w.act, { id: lock.id, at, global: true, resetAt: lock.resetAt }, at) }
        }),
      )
    } else if (e.rateLimits.length > 0 && (week?.percentUsed ?? 0) < 100 && (five?.percentUsed ?? 0) < 100) {
      patch($, 'boss', (w, at) => {
        const r = clearLoops(w.act, ['kota-oturum', 'kota-haftalik'], at, true)
        if (r.closed.length === 0) return null
        return { act: r.state }
      })
    }
    for (const l of e.rateLimits) {
      for (const mark of [80, 90]) {
        const key = `${l.kind}:${mark}:${l.resetsAt ?? ''}`
        if (l.percentUsed >= mark && !warned.has(key)) {
          warned.add(key)
          const reset = resetIn(l.resetsAt, now)
          $.ui.toast(`Piksel Ofis: ${limitLabel(l.kind)} limiti %${Math.round(l.percentUsed)}${reset ? ` · ${reset} sonra sıfırlanır` : ''}`)
          feed($, { name: 'Ofis', color: '#C99234' }, 'limit', `${limitLabel(l.kind)} limiti %${Math.round(l.percentUsed)} oldu`)
        }
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    const nt = e.notification_type
    if (/permission/i.test(nt)) {
      patch($, 'boss', (w, at) => ({
        activity: 'waiting',
        since: at,
        fault: 'izin-bekle',
        bubble: 'Onayını bekliyorum!',
        detail: 'Onay bekleniyor',
        act: applyLoop(w.act, { id: 'izin-bekle', at }, at),
      }))
      feed($, BOSS, 'wait', 'onayını bekliyor')
    } else if (classifyError({ source: 'Notification', code: nt })?.id === 'soru-bekle') {
      // #28: a question, an idle prompt or an MCP form waits for you; an approval it waits for keeps its words (#27 > #28)
      patch($, 'boss', (w, at) => {
        const asking = activeLoop(w.act, at)?.id === 'izin-bekle'
        return {
          activity: 'waiting',
          since: w.activity === 'waiting' ? w.since : at,
          ...(asking ? {} : { fault: 'soru-bekle' as const, bubble: 'Cevabını bekliyorum', detail: 'Cevap bekleniyor' }),
          act: applyLoop(w.act, { id: 'soru-bekle', at }, at),
        }
      })
      feed($, BOSS, 'wait', 'cevabını bekliyor')
    } else if (/auth_success/i.test(nt)) {
      patch($, 'boss', (w, at) => {
        const r = clearLoops(w.act, ['giris-gerek'], at, true)
        if (r.closed.length === 0) return null
        return { act: r.state }
      })
      feed($, BOSS, 'turn', 'oturum yeniden doğrulandı')
    } else {
      const cls = classifyError({ source: 'Notification', code: nt, text: `${e.title ?? ''} ${e.message ?? ''}`, ...usageMeta(await read($, usageA)) })
      if (cls) patch($, 'boss', (w, at) => ({
        ...(cls.fault ? { fault: cls.fault } : {}),
        ...(cls.bubble ? { bubble: cls.bubble } : {}),
        act: applyErrorCls(w.act, cls, 0, at, undefined, false),
      }))
      if (cls) feed($, BOSS, cls.id === 'kota-devam' ? 'turn' : 'fail', cls.bubble ?? 'Bir aksilik oldu')
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
