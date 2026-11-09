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
  /** SendMessage yazıyor */
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
  /** Çözülmüş model id: agent.spawn result.model > e.model > e.parentModel; sonra ajanın kendi turn.step e.model'i; dış işçide -m/--model. Yok = bilinmiyor. Patronda turn.step (ana döngü) */
  model?: string
  /** Son adımın eforu: 'low'|'medium'|'high'|'xhigh'|'max' ya da sayı metni */
  effort?: string
  /** 'agent' (varsayılan) | 'external' (Bash/PowerShell ile çalışan codex/gemini/agy CLI) */
  kind?: 'agent' | 'external'
  /** Başlatan döngü: 'boss' ya da ajan id (agent.spawn e.parentAgentId; dış işçide çağıran döngü) */
  parentId?: string
  /** SendMessage adresleri: e.name, result.teammateId, AgentInfo.name/teammateId (id ayrıca her zaman eşleşir) */
  addr?: string[]
  /** Davranıştan görev: dutyFor() */
  duty?: Duty
  /** Edit/Write/MultiEdit/NotebookEdit çağrı sayısı */
  writes?: number
  /** Arka plandaki dış işçinin Bash result.backgroundTaskId değeri */
  taskId?: string
  /** Mesaj bekleyen takım arkadaşı (status 'idle' / TeammateIdle) ya da işini bitiren çalışan: o andan beri */
  idleSince?: number
  /** Çalıştığı platform: 'agy' (Antigravity rozeti) ya da 'evren' (EVREN karakteri, modelden bağımsız) */
  via?: 'agy' | 'evren'
  /** Monitörün gösterdiği o anki gerçek iş */
  screen?: Screen
  /** Bu çalışanın TodoWrite planı */
  plan?: Progress
  /** Model henüz bilinmezken maskotu seçen tahmin (üst ajanın ya da iş akışının modeli); etikete yazılmaz */
  guess?: string
  /** Modelin nereden öğrenildiği: 'spawn' | 'step' | 'result' | 'workflow' | 'cli' | 'config' (ipucu için) */
  modelFrom?: string
  /** agent.spawn subagentType ya da AgentInfo.type (unvan için) */
  agentType?: string
  /** Masa kartının unvanı (numarasız): 'Yazılımcı', 'Dedektif'; `name` bunun numaralısı */
  title?: string
  /** Bir kez görülen yeni unvan: ikinci kez gelirse geçerli olur (titremesin) */
  titleNext?: string
  /** 0.9 etkinlik animasyonu (activities.ts): gösterilen ana etkinlik, bekleyen aday, olay */
  act?: ActState
  /** Son araçların izi (en çok 8, yeni sonda): yalnız türetilmiş işaretler */
  trail?: ActMark[]
}

/** Son araçların izi: yalnız türetilmiş işaretler; ham komut/yol/metin ASLA */
export type ActMark = { t: number; id?: string; f?: 1; d?: 1; s?: 'audit' | 'security' | 'refactor' | 'debug' | 'video' | 'ok' | 'done' }

/** Bir işçinin etkinlik durumu (manifest adları). */
export type ActState = {
  /** gösterilen ana etkinlik (varyant dahil) */
  id?: string
  /** id'nin başladığı an (yalnız id değişince yenilenir) */
  at: number
  /** id'yi doğrulayan son araç anı (60 sn tutma) */
  seen: number
  /** bir kez görülen aday (2-kez kuralı) */
  next?: string
  /** adayın görüldüğü an (tanınmış ama onaylanmamış uzun komut derleme sayılmasın) */
  nextAt?: number
  /** tek seferlik olay */
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
  /** Satırın sahibi olan Worker id (HUD mini maskotu için) */
  whoId?: string
  /** 'talk' satırında alıcının adı, rengi ve id'si */
  to?: string
  toColor?: string
  toId?: string
}

export type TalkKind = 'order' | 'report' | 'message'

/** Ofisteki bir etkileşim: görev verme, rapor ya da ajanlar arası mesaj. */
export type Talk = {
  /** 'msg:<tool_use_id|t>' | 'ord:<workerId>' | 'rep:<workerId>' */
  id: string
  t: number
  /** Gönderen Worker id ('boss' dahil); ofis dışından (başka oturum) gelen mesajda '' */
  from: string
  /** Alıcı Worker id; ofiste olmayan alıcı (başka oturum) için '' */
  to: string
  kind: TalkKind
  /** talkText(): SendMessage summary ya da ilk satır, en çok 48 karakter; ham yol ve komut asla */
  text: string
  isDelivered: boolean
  /** Alıcının session.receive anı */
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
  /** Patronun TodoWrite planı */
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
  /** Biten görevler (kahve köşesindeki bardaklar) */
  done?: number
  /** Hata veren görevler */
  failed?: number
  /** Patrona ya da üst ajana dönen raporlar (yazıcı tepsisi) */
  reports?: number
  /** Masalar arası mesajlar (toplantı masası) */
  messages?: number
  /** Ofis dışından (başka oturumdan) gelen mesajlar (posta yarığı) */
  inbound?: number
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
      frame: Shaped<number>
      daily: Shaped<Daily>
      talks: Shaped<Talk[]>
    }
  }
}
