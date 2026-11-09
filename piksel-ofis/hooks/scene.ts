// The office, the whole pane of it: the wall with its sign, clock, windows and scoreboard, the
// LED ticker, the boss's corner, the desks of the open floor and the people in them. Drawn in
// office units (ou) on the layout layout.ts picks for the pane; hud.ts scales it to pixels.
// Every timed piece sits on the wall clock (events.ts): a redraw shows the same moment the same
// way, and a frame drawn `settled` leaves out everything that ends by itself, so the pane only
// paints again when something it shows for good has changed.
import type { Activity, Daily, FeedItem, Stats, Talk, Turn, Usage, Worker } from '../types'
import { ACT_CAP, ACT_USE_EST, type ActCtx, type ActPart, type ActView, actDefs, actUse, actView, planActs } from './activities'
import { ACTS, ACT_STRIPS, type ActEntry, type ActStrip } from './activity-data'
import { CHAR_SET } from './char-data'
import { CHAR_CSS, type CharKind, type CharOpts, type CharState, charBox, charKindOf, drawCharacter, hatCrop, markOf, propUnit, seatHide, setCharScale } from './characters'
import {
  type Actor,
  type Fx,
  type Scenes,
  type Shape,
  type Stage,
  type Tone,
  after,
  ago,
  bubble,
  bubbleBox,
  bubbleH,
  confetti,
  during,
  except,
  loopWalker,
  n2,
  setClock,
  talkScenes,
  along,
  keptWalk,
  visitHome,
  walkKept,
  type Plan,
  until,
  vStart,
  walker,
} from './events'
import type { Box, Cell, Move, OfficeLayout, Pt } from './layout'
import { ARRIVAL_WINDOW_MS, COFFEE_AFTER_MS, DESK_GEOM, LEAVE_MS, bossSpotFor, deskFrame, deskModuleBox, layoutOffice, pathLen, route, walkMs } from './layout'
import { THINK_LABEL, activityLabel, clip, dayKey, effortLevel, effortWord, esc, splitEffort, fatigue, forecast, hash, istanbul, mascotFor, modelLabel, n1, pick } from './logic'
import type { Sample } from './logic'
import * as P from './props'
import { spriteDefs } from './sprites'

export { ACTIVITY_LABEL, activityLabel, esc } from './logic'
export { anim, eventAge } from './events'
export { ARRIVE_MS, LEAVE_MS } from './layout'

const SCENE_CSS = `
.t{font-family:Bahnschrift,'Styrene B','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif}
.s{font-family:'Tiempos Headline','Copernicus',Georgia,'Times New Roman',serif}
.m{font-family:'Cascadia Code',Consolas,'Fira Code',ui-monospace,monospace}
.fb{transform-box:fill-box;transform-origin:center}
.fbb{transform-box:fill-box;transform-origin:50% 100%}
@keyframes o0{from,to{opacity:0}}
@keyframes o1{from,to{opacity:1}}
@keyframes fade{from{opacity:1}to{opacity:0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes dots{0%,20%{opacity:.15}40%{opacity:1}100%{opacity:.15}}
@keyframes scroll{from{transform:translateY(0)}to{transform:translateY(-12px)}}
@keyframes caret{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes jump{0%,100%{transform:translateY(0)}25%{transform:translateY(-7px)}50%{transform:translateY(0)}65%{transform:translateY(-3px)}80%{transform:translateY(0)}}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
@keyframes steam{0%{transform:translateY(0);opacity:0}30%{opacity:.75}100%{transform:translateY(-11px);opacity:0}}
@keyframes pop{0%{transform:scale(0)}60%{transform:scale(1.18)}100%{transform:scale(1)}}
@keyframes fold{0%{transform:scaleY(1);opacity:1}100%{transform:scaleY(0);opacity:0}}
@keyframes wiggle{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
@keyframes twinkle{0%,100%{opacity:.15}50%{opacity:1}}
@keyframes glow{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes zz{0%{transform:translate(0,0);opacity:0}30%{opacity:1}100%{transform:translate(8px,-14px);opacity:0}}
@keyframes paper{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
@keyframes juggle{0%,100%{transform:translateY(0)}50%{transform:translateY(var(--jh))}}
@keyframes buzz{0%,100%{transform:translateX(0)}20%{transform:translateX(-1px)}40%{transform:translateX(1px)}}
@keyframes stretch{0%,60%,100%{transform:scaleY(1)}70%,90%{transform:scaleY(1.1)}}
@keyframes sip{0%,55%,100%{transform:translate(0,0) rotate(0)}65%,85%{transform:translate(var(--mx),var(--my)) rotate(-28deg)}}
@keyframes confetti{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(540deg);opacity:0}}
@keyframes drip{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(10px);opacity:0}}
@keyframes sp4{to{transform:translateX(-128px)}}
@keyframes rise{0%{transform:translateY(0)}12%,88%{transform:translateY(var(--rh,-8px))}100%{transform:translateY(0)}}
@keyframes blip{0%{opacity:0;transform:scale(.55)}9%{opacity:1;transform:scale(1.08)}16%,88%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1)}}
@keyframes marq{0%,18%{transform:translateX(0)}82%,100%{transform:translateX(var(--mq))}}
@keyframes flap{0%,100%{transform:scaleY(1)}50%{transform:scaleY(-.5)}}
@keyframes tubein{0%{transform:scaleY(0)}12%,88%{transform:scaleY(1)}100%{transform:scaleY(0)}}
@keyframes bslot{0%,16.66%{opacity:1}16.67%,100%{opacity:0}}
@keyframes bslotx{0%,16.66%{opacity:0}16.67%,100%{opacity:1}}
@keyframes bwin{0%{transform:translate(0,0)}2%,14.66%{transform:translate(var(--wx),var(--wy))}16.66%,100%{transform:translate(0,0)}}
@keyframes bw1{0%,1.99%{opacity:1}2%,100%{opacity:0}}
@keyframes bw2{0%,1.99%{opacity:0}2%,14.65%{opacity:1}14.66%,100%{opacity:0}}
@keyframes bw3{0%,14.65%{opacity:0}14.66%,16.65%{opacity:1}16.66%,100%{opacity:0}}
@keyframes pace{0%,16%{transform:translateX(0)}41%,50%{transform:translateX(var(--pd))}75%,100%{transform:translateX(0)}}
@keyframes pcw{0%,16%{opacity:1}16.1%,40.9%{opacity:0}41%,50%{opacity:1}50.1%,74.9%{opacity:0}75%,100%{opacity:1}}
@keyframes pcr{0%,16%{opacity:0}16.1%,40.9%{opacity:1}41%,100%{opacity:0}}
@keyframes pcl{0%,50%{opacity:0}50.1%,74.9%{opacity:1}75%,100%{opacity:0}}
@keyframes tap{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}
@keyframes lk{0%,84.9%{opacity:0}85%,100%{opacity:1}}
@keyframes lkx{0%,84.9%{opacity:1}85%,100%{opacity:0}}
@keyframes yawn{0%,93.9%{opacity:0}94%,99.9%{opacity:1}100%{opacity:0}}
@keyframes sweep{0%{transform:translateX(0)}100%{transform:translateX(var(--vx))}}
@keyframes catin{0%{transform:translateX(var(--cx));opacity:0}10%{opacity:1}100%{transform:translateX(0);opacity:1}}
.still *{animation:none!important}
`

/** The colour behind the office (its floor), for the pane's edge. */
export function sceneBg(theme: 'dark' | 'light'): string {
  return P.palette(theme).floor
}

/** The drawing's style sheet: the office's keyframes, the characters' and the furniture's. */
export const STYLE = SCENE_CSS + CHAR_CSS + P.PROP_CSS

/**
 * Every looping animation picks up where the wall clock says it is: a redraw then
 * continues the motion instead of starting it over, which looked like a flicker.
 */
export function phaseLock(svg: string, now: number): string {
  const t = now / 1000

  return svg.replace(/animation:([\w-]+) ([\d.]+)s (?:(-?[\d.]+)s )?([^;"]*infinite)/g, (_, name: string, dur: string, delay: string | undefined, rest: string) => {
    const d = Number(dur)
    const at = n1(Number(delay ?? 0) - (t % d))

    return `animation:${name} ${dur}s ${at}s ${rest}`
  })
}

export type SceneInput = {
  workers: readonly Worker[]
  usage: Usage
  turn: Turn
  now: number
  motion: boolean
  /** files read, commands run, turns taken: the bookshelf, the rack, the plant… */
  stats?: Stats
  /** today's cost across chats: the scoreboard, the lit windows across the street */
  daily?: Daily
  /** the latest events: the LED ticker */
  feed?: readonly FeedItem[]
  /** the auto compact %, marked on the water cooler */
  autoCompactAt?: number
  fiveFullAt?: number
  weekFullAt?: number
  /** orders, reports and messages between the desks: planes, calls, birds, envelopes */
  talks?: readonly Talk[]
  /** when the previous frame was drawn: what happened since replays from its start (events.ts vStart) */
  lastFrameAt?: number
  layout: OfficeLayout
  /** walks the move tracker planned (ou) */
  moves?: ReadonlyMap<string, Move>
  /** the grid changed: when, and the old desk cells (px) */
  relayout?: { at: number; prevCells: Box[] }
  /** the picture as it stays: no walks, flights, fresh bubbles or reactions (frameKey) */
  settled?: boolean
  theme?: 'dark' | 'light'
}

const CLAUDE = '#D97757'
const SPEED = [1, 0.85, 0.7, 0.5] as const
const HELLOS = ['Merhaba patron!', 'İşe başlıyorum!', 'Masam hazır!', 'Görev bende!', 'Kahvemi aldım!']
const BYES = ['Görüşürüz!', 'İyi çalışmalar!', 'Kolay gelsin!', 'Ben çıkıyorum.']
const CHEERS = ['Aferin {n}!', 'Harika iş {n}!', 'Süpersin {n}!', 'Teşekkürler {n}!']
const OOPS = ['{n}, bir daha bakalım.', 'Sorun değil {n}, çözeriz.', '{n} takıldı, inceliyorum.']
/** Done workers wait this long at their desk before the coffee walk (the move tracker leaves them there from then on). */
const COFFEE_AFTER = COFFEE_AFTER_MS
const WANDER_MS = 24_000
const ACT_AFTER = 45_000
const SLEEP_AFTER = 600_000
const CAT_AFTER = 300_000
const IDLE_QUIP = {
  coffee: ['Kahve molası', 'Bu kahve harika.', 'Bir yudum daha…'],
  paper: ['Teknoloji sayfası…', 'Yeni modeller çıkmış!', 'Gazete okuyorum.'],
  juggle: ['Hop, hop!', 'Boş vakit, jonglörlük vakti', 'Üç top, sıfır hata.'],
  phone: ['Alo? Yeni iş mi?', 'Tamam, not aldım.', 'Biri aradı…'],
  stretch: ['Biraz esneyelim.', 'Sırtım tutuldu…', 'Hazırım!'],
  yawn: ['Ahh… yoruldum.', 'Hakkımız azalıyor…', 'Biraz dinlensek mi?'],
  window: ['Manzara güzel.', 'Şehir çalışıyor.', 'Bulutlara bakıyorum.'],
  wave: ['Kolay gelsin ekip!', 'Selam millet!', 'Harika gidiyoruz!'],
} as const
type Act = keyof typeof IDLE_QUIP

const BUSY: ReadonlySet<Activity> = new Set(['thinking', 'answering', 'reading', 'writing', 'running', 'web', 'planning', 'delegating', 'messaging', 'compacting'])

/** A phase's figure (`svg`) and, drawn with it, its activity props behind (`back`) and in front of (`front`) the desk. */
type Phase = { at: number; svg: string; back?: string; front?: string }

/** Everything one drawing shares. */
type K = {
  input: SceneInput
  L: OfficeLayout
  now: number
  motion: boolean
  lite: boolean
  /** the picture as it stays (frameKey) */
  settled: boolean
  /** timed pieces are drawn (a moving, unsettled picture) */
  live: boolean
  c: P.DrawCtx
  pal: P.Pal
  fs: number
  fat: 0 | 1 | 2 | 3
  speed: number
  team: Worker[]
  boss: Worker
  bossKind: CharKind
  actors: Map<string, Actor>
  sc: Scenes
  /** door and window, coffee and printer times collected while drawing */
  doorAt: number[]
  brewAt?: number
  bubbles: string[]
  /** the lasting desk bubbles' boxes (ou): a bubble that would cover one is left out (crowded small panes) */
  placed: Box[]
  walkers: string[]
  ghosts: string[]
  /** the idle worker that waves back when the boss waves at the team */
  waveBuddy?: string
  /** name plates asked for while drawing: placed last, clear of every other text (nameTag) */
  tags: Array<{ name: string; color: string; at: Pt; bodyH: number; path?: readonly Pt[] }>
  /** where the goodbye bubbles stand: a second one at the same spot is left out (the wave says it) */
  byes: Pt[]
  /** each worker's activity as drawn this frame (activities.ts actView) */
  views: Map<string, ActView>
  /** the activity strips the budget lets in (planActs): a part whose strip is not here is not drawn */
  allowed: ReadonlySet<string>
  /** the idle boss's nap (its ten-minute sleep) drawn as the nap strip: from when */
  napAt?: number
}

/**
 * A run of states over time (each from its `at`, wall clock): a moving picture shows each in
 * its turn, a settled one only the last (what it ends as), a still one the one of this moment.
 */
function timeline(k: K, phases: readonly Phase[], layer: 'svg' | 'back' | 'front' = 'svg'): string {
  const list = phases
  if (list.length === 0) return ''
  const of = (p: Phase): string => p[layer] ?? ''
  if (!k.motion) {
    let cur = list[0] as Phase
    for (const p of list) if (p.at <= k.now) cur = p

    return of(cur)
  }
  if (k.settled) return of(list[list.length - 1] as Phase)
  let out = ''
  list.forEach((p, i) => {
    const next = list[i + 1]
    const a = p.at - k.now
    const b = next ? next.at - k.now : Infinity
    const svg = of(p)
    if (b <= 0 || !svg) return
    if (a <= 0 && b === Infinity) out += svg
    else if (a <= 0) out += until(b, svg)
    else if (b === Infinity) out += after(a, svg)
    else out += during(a, b, svg)
  })

  return out
}

function fallbackBoss(now: number): Worker {
  return { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: CLAUDE, seat: -1, activity: 'idle', bubble: '', detail: '', tools: 0, tokensOut: 0, since: now, joinedAt: now }
}

function limOf(usage: Usage, kind: string, now: number): P.Lim | undefined {
  const l = usage.limits.find(x => x.kind === kind)
  if (!l) return undefined
  const f = forecast(kind, l.pct, l.resetsAt, (usage.samples?.[kind] ?? []) as Sample[], now)
  const r = l.resetsAt ? Date.parse(l.resetsAt) : NaN

  return {
    pct: l.pct,
    resetsAt: Number.isFinite(r) ? r : undefined,
    fullAt: f.fullAt !== undefined ? Math.round(f.fullAt / 60_000) * 60_000 : undefined,
    rate: f.rate !== undefined ? Math.round(f.rate * 10) / 10 : undefined,
  }
}

/** When the 5-hour limit last crossed 80 or 90 % (the battery blinks, everyone yawns once). */
function crossedAt(usage: Usage, now: number): number | undefined {
  const s = (usage.samples?.five_hour ?? []) as Sample[]
  for (let i = s.length - 1; i > 0; i--) {
    const [t, p] = s[i] as Sample
    const q = (s[i - 1] as Sample)[1]
    if (now - t > 15_000) break
    if ((p >= 80 && q < 80) || (p >= 90 && q < 90)) return t
  }

  return undefined
}

/**
 * Minutes from `from` to `now` in steps (by the minute, then by 5, then by 15), counted in wall-clock
 * minutes: every desk turns over at the same minute, so a busy office redraws for it once a minute at most.
 */
function stepMinutes(now: number, from: number): number {
  const m = Math.max(0, Math.floor(now / 60_000) - Math.floor(from / 60_000))

  return m < 10 ? m : m < 60 ? Math.floor(m / 5) * 5 : Math.floor(m / 15) * 15
}

const toneOf = (a: Activity): P.DeskData['tone'] =>
  a === 'waiting' ? 'wait' : a === 'failed' ? 'fail' : a === 'done' ? 'done' : a === 'leaving' ? 'off' : BUSY.has(a) ? 'busy' : 'idle'

/** What a monitor shows: the worker's real work, or what its activity stands for. */
function screenOf(w: Worker, plan = w.plan): P.ScreenView {
  if (w.activity === 'leaving') return { kind: 'off', since: w.since }
  if (w.activity === 'idle' || w.activity === 'done') return { kind: 'idle', since: w.since }
  const steps = Math.min(8, w.tools)
  const s = w.screen
  if (s) return { kind: s.kind, label: s.label, site: s.site, think: s.think, progress: s.kind === 'plan' ? plan : undefined, steps, since: s.at }
  const said = (w.detail || '').split(' · ')[1] ?? ''
  switch (w.activity) {
    case 'thinking':
      return { kind: 'think', label: activityLabel(w), think: w.think, steps, since: w.since }
    case 'reading':
      return { kind: 'file-read', label: clip(said, 28), steps, since: w.since }
    case 'writing':
      return { kind: 'file-write', label: clip(said, 28), steps, since: w.since }
    case 'running':
      return { kind: 'cmd', label: 'komut', steps, since: w.since }
    case 'web':
      return { kind: 'site', label: '', site: w.site, steps, since: w.since }
    case 'planning':
      return { kind: 'plan', label: 'Plan', progress: plan, steps, since: w.since }
    case 'messaging':
      return { kind: 'msg', label: '', steps, since: w.since }
    case 'waiting':
      return { kind: 'wait', label: 'Onay', steps, since: w.since }
    case 'answering':
      return { kind: 'answer', label: 'Cevap', steps, since: w.since }
    case 'delegating':
      return { kind: 'ext', label: clip(w.bubble, 26), steps, since: w.since }
    default:
      return { kind: 'tool', label: clip(w.tool ?? '', 20), steps, since: w.since }
  }
}

/** The office's markup in its own units (layout.SW × layout.SH), without the outer element. */
/**
 * The scene's parts. `squeeze` sheds more when even the lite picture is too big (a crowded office in a
 * huge pane): 1 keeps only the newest talk and eight bubbles, 2 also draws the settled picture (every
 * event at its end, no walks). `cap` is the activity strips' ceiling (§5): `acts` are their defs, `dropped`
 * how many strips the views asked for that did not fit (those figures are drawn in their own state).
 */
export function sceneParts(input: SceneInput, lite: boolean, squeeze = 0, cap: number = ACT_CAP): { body: string; defs: string; acts: string; dropped: number; alt: string } {
  const { workers, usage, turn, now, motion } = input
  const L = input.layout
  setClock(now, input.lastFrameAt, motion && input.settled !== true && squeeze < 2)
  setCharScale(L.s)
  const theme = input.theme ?? 'dark'
  const settled = input.settled === true || squeeze >= 2
  const live = motion && !settled
  const fat = fatigue(usage, now)
  const boss = workers.find(w => w.id === 'boss') ?? fallbackBoss(now)
  const team = workers.filter(w => w.id !== 'boss')
  const bossKind = charKindOf(mascotFor({ id: 'boss', model: boss.model ?? turn.model, via: boss.via }, true))
  const k: K = {
    input, L, now, motion, lite, settled, live,
    c: { s: L.s, now, last: input.lastFrameAt, motion, lite, settled, theme },
    pal: P.palette(theme),
    fs: n2(Math.max(7.5, 10.5 / L.s)),
    fat,
    speed: SPEED[fat],
    team,
    boss,
    bossKind,
    actors: new Map(),
    sc: { layer: '', walkers: '', fx: new Map(), doorAt: [], tube: false },
    doorAt: [],
    bubbles: [],
    placed: [],
    walkers: [],
    ghosts: [],
    byes: [],
    tags: [],
    views: new Map(),
    allowed: new Set(),
  }
  P.beginTexts(L.s)
  // what each one is doing (activities.ts), and which of those strips the budget lets in (§5)
  k.views = actViews(k)
  k.allowed = planActs(k.views, Math.max(0, cap))

  // who stands where: the desks, and the boss at its spot
  for (const w of team) {
    const cell = cellOf(k, w)
    if (!cell) continue
    k.actors.set(w.id, actorAt(k, w, cell.seat, L.charSize, cell.row, cell.col, undefined, true))
  }
  const bossAt = bossPoint(k, bossSpot(boss))
  k.actors.set('boss', actorAt(k, boss, bossAt, L.bossSize, -1, -1, bossKind))
  const moving = new Set<string>()
  for (const [id, m] of input.moves ?? []) if (now < m.at + m.dur) moving.add(id)
  for (const w of team) if (now - w.joinedAt < ARRIVAL_WINDOW_MS + 4000) moving.add(w.id)
  const stage: Stage = { L, actors: k.actors, boss: k.actors.get('boss') as Actor, fs: k.fs, lite, speed: k.speed, busy: moving }
  if (live) k.sc = talkScenes(input.talks ?? [], stage, squeeze >= 1 ? 1 : undefined)

  let body = `<g shape-rendering="crispEdges">${architecture(k)}</g>`
  body += light(k)
  body += wall(k)
  // the ticker over the boss's corner: a big boss's thought cloud or crown never covers the news
  body += bossCorner(k)
  body += P.ticker(L.zones.ticker, tickerItems(k), k.c)
  body += floor(k)
  body += k.ghosts.join('')
  body += k.walkers.join('') + k.sc.walkers
  body += life(k)
  body += k.sc.layer
  body += (squeeze >= 1 ? k.bubbles.filter(Boolean).slice(0, 8) : k.bubbles).join('')
  // the name plates last: every other text is known by now, so none is laid over one
  if (k.tags.length) {
    const plates = k.tags.map(t => placeTag(k, t))
    body = body.replace(/<!--nt(\d+)-->/g, (_, i: string) => plates[Number(i)] ?? '')
  }

  const busy = team.filter(w => w.endedAt === undefined && w.activity !== 'leaving').length
  const alt = `Patron: ${stateLabel(k, boss)}. ${team.length === 0 ? 'Ekip yok.' : `${team.length} çalışan, ${busy} aktif.`}`

  return { body, defs: defsOf(k) + P.deskDefs(k.c), acts: actDefs(k.allowed), dropped: droppedActs(k), alt }
}

// ——— activities (0.9): what each one is doing, as props and body motion ————————————————

/** The 5-hour limit is spent: the boss naps (activities.ts §3.5-17). */
const limitFull = (usage: Usage): boolean => (usage.limits.find(l => l.kind === 'five_hour')?.pct ?? 0) >= 100

/** A critic at work (a reviewer's title, or its duty read off its behaviour): the boss referees. */
const isCritic = (w: Worker): boolean => w.duty === 'critic' || /Denetçi|Kontrolcü/i.test(w.title ?? w.name)

/** Every worker's activity view for this frame; the idle boss's ten-minute nap is drawn as the nap strip. */
function actViews(k: K): Map<string, ActView> {
  const { now, team, boss, input } = k
  const busyTeam = team.filter(w => w.endedAt === undefined && BUSY.has(w.activity))
  const base: Omit<ActCtx, 'isBoss' | 'kind' | 'external'> = {
    now,
    fat: k.fat,
    ctxPct: input.usage.ctxPct,
    limitFull: limitFull(input.usage),
    teamBusy: busyTeam.length,
    criticBusy: busyTeam.some(isCritic),
  }
  const views = new Map<string, ActView>()
  for (const w of team) views.set(w.id, actView(w, { ...base, isBoss: false, kind: charKindOf(mascotFor(w, false)), external: w.kind === 'external' }))
  let bv = actView(boss, { ...base, isBoss: true, kind: k.bossKind, external: false })
  // the boss idle for ten minutes sleeps (bossFigure's last idle phase): the nap strip in place of the z's
  if (boss.activity === 'idle' && !bv.main && (k.motion || now - boss.since >= SLEEP_AFTER)) {
    k.napAt = boss.since + SLEEP_AFTER
    bv = { ...bv, main: { id: 'nap-zzz', strip: 'nap-zzz', at: k.napAt } }
  }
  views.set('boss', bv)

  return views
}

/** How many of the strips the views ask for the budget left out. */
function droppedActs(k: K): number {
  const wanted = new Set<string>()
  for (const v of k.views.values()) {
    for (const p of [v.main, v.ev, v.over, ...(v.extra ?? [])]) if (p) wanted.add(p.strip)
    if (v.main?.id === 'detective-hunt') wanted.add('detective-hunt_sapka')
  }

  return [...wanted].filter(s => !k.allowed.has(s)).length
}

/** What the desk plate says a worker is doing: its activity ('Kod yazıyor'), else its state ('Düşünüyor'). */
const stateLabel = (k: K, w: Worker): string => k.views.get(w.id)?.label ?? activityLabel(w)

/** An activity part the budget lets in, with its manifest entry and strip. */
type Part = { p: ActPart; e: ActEntry; st: ActStrip }

function partOf(k: K, p: ActPart | undefined): Part | undefined {
  if (!p || !k.allowed.has(p.strip)) return undefined
  const e = ACTS[p.id]
  const st = ACT_STRIPS[p.strip]

  return e && st ? { p, e, st } : undefined
}

/** One worker's activity as drawn: its props in two layers, its figure's state and body motion, its event's window. */
type ActDraw = {
  /** the main activity's figure state (taban_durum) and its body motion, when its strip is in */
  main?: { state: CharState; wrap: (fig: string) => string; crop?: number }
  /** the event (one-off) shown between `a` and `b` ms from now, its figure state and body motion */
  ev?: { a: number; b: number; state: CharState; wrap: (fig: string) => string }
  /** the main's props behind the figure (layer 'arka') and in front of the desk (layer 'on', the hat) */
  mainBack: string
  mainFront: string
  /** the event's props, shown in its window */
  evBack: string
  evFront: string
  /** the load sign (sweat) */
  over: string
  /** the top of the highest prop on the head (ou): a bubble stays above it */
  headTop?: number
  /** a side prop stands at the desk's right end: the lamp makes way */
  lampOff: boolean
  /** the lasting props' boxes (ou): bubbles and name plates keep off them */
  boxes: Box[]
}

const HEAD_ANCHORS: ReadonlySet<string> = new Set(['kafa', 'kafa_govde', 'goz'])

/** Props too small to read at 1× (a three-node branch, two hands and a stick): drawn larger about their anchor. */
const PROP_SCALE: Readonly<Record<string, number>> = { 'git-branch': 1.4, 'handoff-baton': 1.4 }

/** The boss's head signs (the load sign, the nap), main or over: beside its crown, not over its face. */
const BESIDE_HEAD: ReadonlySet<string> = new Set(['overheat-sweat', 'nap-zzz'])

/**
 * A worker's activity props (§4.2–4.3): placed at its feet `at` by its family's anchor offset, in prop pixels
 * (`propUnit`), raised to stand on the desk top (`deskTop`, ou) where they would sink behind the desk's front.
 * The main loops on the wall clock (a fixed stagger, phase-locked), the event plays from its stamp; a settled
 * picture keeps the main as one frame and leaves the event out. Undefined: nothing drawn.
 */
function actLayers(k: K, w: Worker, kind: CharKind, size: number, at: Pt, deskTop: number | undefined, ceiling = -Infinity, overBeside?: { x: number; y: number }): ActDraw | undefined {
  const view = k.views.get(w.id)
  if (!view) return undefined
  const { now } = k
  const u = propUnit(kind, size)
  const speed = Math.max(0.1, view.speed || 1)
  const lag = n2(-(hash(w.id) % 997) / 1000)
  const moving = k.motion && !k.lite
  const main = partOf(k, view.main)
  const over = partOf(k, view.over)
  const extra = (view.extra ?? []).map(p => partOf(k, p)).filter((p): p is Part => p !== undefined)
  // the detective's hat comes with the hunt (never alone: its strip may be in while the hunt's is not)
  const hat = main?.p.id === 'detective-hunt' ? partOf(k, { id: 'detective-hunt_sapka', strip: 'detective-hunt_sapka', at: main.p.at }) : undefined
  // the event: from its stamp to its end, only in a moving picture (a still one shows it while it lasts)
  let ev = view.ev && now < view.ev.until ? partOf(k, view.ev) : undefined
  if (ev && k.settled) ev = undefined
  // a paper plane that a delivered message already flies (talks): one plane, not two
  if (ev?.p.id === 'paper-plane' && (k.input.talks ?? []).some(t => t.from === w.id && t.isDelivered && now - t.t < 4000 && t.t <= now)) ev = undefined
  if (!main && !ev && !over && !hat && extra.length === 0) return undefined

  let headTop: number | undefined
  const boxes: Box[] = []
  const place = (q: Part): { x: number; y: number; w: number; h: number } => {
    // the boss's load sign: beside the crown, smaller (there is no room above it under the ticker; over the face it hides it)
    if (overBeside && (q === over || BESIDE_HEAD.has(q.p.id))) {
      const [ow, oh] = [q.st.fw * u * 0.7, q.st.fh * u * 0.7]

      return { x: overBeside.x - ow, y: Math.max(ceiling, overBeside.y - oh * 0.35), w: ow, h: oh }
    }
    const ao = q.e.ao[kind] ?? q.e.ao.diger
    // a small prop is drawn larger about its anchor (it reads at 1×)
    const uu = u * (PROP_SCALE[q.p.id] ?? 1)
    const x = at[0] + ao[0] * u - q.st.pa[0] * uu
    let y = at[1] + ao[1] * u - q.st.pa[1] * uu
    const h = q.st.fh * uu
    // a prop that would sink behind the desk's front stands on its top
    if (deskTop !== undefined && y + h > deskTop) y = deskTop - h
    // and one over the head stays in its own place: not over the desk row above, the ticker or the wall
    if (y < ceiling) y = Math.min(ceiling, deskTop !== undefined ? deskTop - h : ceiling)
    if (HEAD_ANCHORS.has(q.e.anchor)) headTop = Math.min(headTop ?? Infinity, y)

    return { x, y, w: q.st.fw * uu, h }
  }
  /** a strip: looping on the wall clock, played once from `age` ms, or one frame */
  const strip = (q: Part, mode: 'loop' | 'once' | 'still', age = 0, lasting = true): string => {
    actUse(q.p.strip, q.p.id)
    const b = place(q)
    if (lasting) boxes.push(b)
    const { n, fw, fh } = q.st
    const e = q.e
    const fps = e.fps * speed
    const intro = Math.max(0, Math.min(n - 1, e.intro))
    const use = (style: string) => `<svg x="${n2(b.x)}" y="${n2(b.y)}" width="${n2(b.w)}" height="${n2(b.h)}" viewBox="0 0 ${fw} ${fh}" overflow="hidden"><use href="#ac-${q.p.strip}"${style ? ` style="${style}"` : ''}/></svg>`
    if (mode === 'still' || !moving) return use(intro ? `transform:translateX(-${intro * fw}px)` : '')
    if (mode === 'once') return use(`--sx:-${n * fw}px;animation:chs ${r3(n / fps)}s ${n2(-age / 1000)}s steps(${n}) 1`)
    // the loop: plain strips slide (chs); a ping-pong or one after its intro frames steps through its own keyframes
    const len = n - intro
    const loop = e.pingpong || intro
      ? use(`animation:acf-${e.id} ${r3((e.pingpong ? Math.max(1, 2 * len - 2) : len) / fps)}s ${lag}s steps(1,end) infinite`)
      : use(`--sx:-${n * fw}px;animation:chs ${r3(n / fps)}s ${lag}s steps(${n}) infinite`)
    if (!intro || !k.live) return loop
    // the intro frames once from the activity's start, then the loop
    const t0 = vStart(q.p.at)
    const ti = (intro / fps) * 1000
    if (now >= t0 + ti) return loop
    const first = use(`animation:acfi-${e.id} ${r3(intro / fps)}s ${n2(-(now - t0) / 1000)}s steps(1,end) 1 forwards`)

    return during(t0 - now, t0 + ti - now, first) + after(t0 + ti - now, loop)
  }
  /**
   * The body's motion around the figure: on the wall clock (main) or from the event's stamp. It turns and
   * leans about the feet: the moving group's origin is put there by a translation (a fill-box origin would
   * be the middle of the whole strip the figure slides along, far off to its right).
   */
  const body = (e: ActEntry, age?: number) => (fig: string): string => {
    if (!e.body || !moving || k.settled) return fig
    const dur = e.body.ms / 1000 / speed
    const tail = age === undefined ? `${lag}s ${e.body.ease} infinite` : `${n2(-age / 1000)}s ${e.body.ease} ${e.body.count}`

    return `<g transform="translate(${n2(at[0])} ${n2(at[1])})"><g style="--u:${r3(u)};animation:${e.body.name} ${r3(dur)}s ${tail}"><g transform="translate(${n2(-at[0])} ${n2(-at[1])})">${fig}</g></g></g>`
  }
  const layer = (q: Part, svg: string, into: { back: string; front: string }) => {
    if (q.e.layer === 'arka') into.back += svg
    else into.front += svg
  }

  // the main (with its hat and its popcorn)
  const out: ActDraw = { mainBack: '', mainFront: '', evBack: '', evFront: '', over: '', boxes, lampOff: [main, ...extra].some(q => q !== undefined && q.e.layer === 'arka' && q.e.anchor === 'yan') }
  const m = { back: '', front: '' }
  if (main) layer(main, strip(main, k.settled ? 'still' : 'loop'), m)
  for (const x of extra) layer(x, strip(x, k.settled ? 'still' : 'loop'), m)
  if (hat) m.front += strip(hat, k.settled ? 'still' : 'loop')
  out.mainBack = m.back
  out.mainFront = m.front
  if (main) out.main = { state: main.e.base, wrap: body(main.e), crop: hat ? hatCrop(kind) : undefined }
  if (ev) {
    const t0 = k.live ? vStart(ev.p.at) : ev.p.at
    // (a fresh event replays from where the frame starts showing it: its window moves with its start)
    const a = t0 - now
    const b = t0 + ((view.ev as { until: number }).until - ev.p.at) - now
    const age = now - t0
    const e = { back: '', front: '' }
    let svg = strip(ev, ev.e.once ? 'once' : 'loop', age, false)
    // the paper plane flies off along its own path
    if (ev.e.move && moving) svg = `<g style="--u:${r3(u)};animation:acm-${ev.e.id} ${r3(ev.e.move[2] / 1000)}s ${n2(-age / 1000)}s 1 forwards">${svg}</g>`
    layer(ev, svg, e)
    out.ev = { a, b, state: ev.e.base, wrap: body(ev.e, age) }
    out.evBack = k.live ? during(a, b, e.back) : e.back
    out.evFront = k.live ? during(a, b, e.front) : e.front
  }
  // the load sign (sweat) over it all, one frame when settled
  if (over) out.over = strip(over, k.settled ? 'still' : 'loop')
  out.headTop = headTop

  return out
}

/** The main's props are put away while the event plays (it returns when the event ends). */
function evHide(k: K, act: ActDraw, svg: string): string {
  if (!act.ev || !svg) return svg

  return k.live ? except(act.ev.a, act.ev.b, svg) : ''
}

/** A worker's props as drawn: behind the figure, and in front of the desk. */
function actProps(k: K, act: ActDraw | undefined): { back: string; front: string } {
  if (!act) return { back: '', front: '' }

  return { back: evHide(k, act, act.mainBack) + act.evBack, front: evHide(k, act, act.mainFront) + act.evFront + act.over }
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000

const bossSpot = (w: Worker): 'throne' | 'board' | 'shredder' => bossSpotFor(w)

function cellOf(k: K, w: Worker): Cell | undefined {
  const i = k.L.seats.get(w.id)

  return i === undefined ? undefined : k.L.cells[i]
}

function actorAt(k: K, w: Worker, seat: Pt, size: number, row: number, col: number, kind = charKindOf(mascotFor(w, false)), atDesk = false): Actor {
  const cb = charBox(kind, size)
  const isBoss = w.id === 'boss'
  // at a desk the figure sits higher than its feet's spot (sitLift): its hand and head are where they are drawn
  const up = atDesk ? sitLift(k, kind) : 0

  return {
    id: w.id,
    name: isBoss ? 'Patron' : w.name,
    color: w.color,
    kind,
    size,
    seat,
    hand: [seat[0] + (isBoss ? size * 0.55 : -size * 0.45), seat[1] - up - cb.bodyH * 0.5],
    head: [seat[0], seat[1] - up - cb.bodyH],
    row,
    col,
    isBoss,
  }
}

/**
 * How far a seated figure is drawn above its seat (ou). The seat is where its feet stand when it walks
 * in; sitting, the desk hides only its legs and lower body (characters.ts seatHide), whatever its height:
 * a tall star creature and a squat Pofu both show head, arms and chest over the desk top.
 */
function sitLift(k: K, kind: CharKind): number {
  const g = DESK_GEOM[k.L.variant]
  const hidden = (g.deskTop + g.seatDrop - g.slab.y) * k.L.deskScale

  return n2(Math.max(0, hidden - seatHide(kind, k.L.charSize)))
}

/**
 * The boss's spot. On the throne it sits like a desk worker: raised so that its desk hides only legs
 * and lower body (a sun or a star boss shows its face, not just its hair); the squat Pofu stays.
 */
function bossPoint(k: K, spot: 'throne' | 'board' | 'shredder'): Pt {
  const p = k.L.boss[spot]
  if (spot !== 'throne') return p
  const g = P.bossDeskGeom(k.L.boss.desk)
  const lift = Math.max(0, p[1] - g.slabY - seatHide(k.bossKind, k.L.bossSize))

  return lift > 0 ? [p[0], n2(p[1] - lift)] : p
}

// ——— the room ————————————————————————————————————————————————

function defsOf(k: K): string {
  const p = k.pal
  const dark = k.c.theme === 'dark'

  return (
    // parke: şaşırtmalı tahta sıraları, ince damar (tuğla değil)
    `<pattern id="o-fl" width="96" height="28" patternUnits="userSpaceOnUse"><rect width="96" height="28" fill="${p.floor}"/><rect y="7" width="96" height="7" fill="${dark ? '#413227' : '#DDCAAC'}"/><rect y="21" width="96" height="7" fill="${dark ? '#362A21' : '#D3BE9E'}"/><path d="M0 6.5h96M0 13.5h96M0 20.5h96M0 27.5h96M.5 0v6M60.5 0v6M28.5 7v6M84.5 7v6M12.5 14v6M70.5 14v6M44.5 21v6" stroke="${p.floorLine}" stroke-width="1"/><path d="M6 3h22M68 2.5h18M34 10h30M4 17.5h16M76 17h14M50 24.5h26M8 25h20" stroke="${dark ? '#4B3B2F' : '#E6D6BC'}" stroke-width=".8" opacity=".7"/></pattern>` +
    `<pattern id="o-wl" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="${p.wall}"/><rect x="11" width="2" height="24" fill="${p.wallHi}" opacity=".4"/><rect x="4" y="11" width="2" height="2" fill="${p.wallHi}" opacity=".35"/></pattern>` +
    `<pattern id="o-cp" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="${p.carpet}"/><path d="M8 2 L14 8 L8 14 L2 8Z" fill="none" stroke="${p.gold}" stroke-opacity="${dark ? 0.07 : 0.12}"/></pattern>` +
    `<radialGradient id="o-spot"><stop offset="0" stop-color="#FDE68A" stop-opacity="${dark ? 0.22 : 0.3}"/><stop offset="1" stop-color="#FDE68A" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="o-lamp"><stop offset="0" stop-color="#FCD34D" stop-opacity="${dark ? 0.26 : 0.18}"/><stop offset="1" stop-color="#FCD34D" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="o-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFBEB" stop-opacity="${dark ? 0.16 : 0.34}"/><stop offset="1" stop-color="#FFFBEB" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="o-dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FB923C" stop-opacity="${dark ? 0.16 : 0.24}"/><stop offset="1" stop-color="#FB923C" stop-opacity="0"/></linearGradient>`
  )
}

/**
 * A desk drawn at the layout's desk scale: `draw` gets the cell as the unscaled drawing sees it and
 * its output is scaled about the cell's floor (the seats and lanes of the layout match it).
 */
function framed(k: K, cell: Box, draw: (b: Box, c: P.DrawCtx) => string): string {
  const dk = k.L.deskScale
  const fr = deskFrame(cell, dk)
  // the drawing is scaled by dk: its letters are sized for the scale they are seen at
  const c = dk === 1 ? k.c : { ...k.c, s: k.c.s * dk }
  const inner = P.inFrame(dk === 1 ? undefined : fr.map, dk, () => draw(fr.box, c))

  return fr.tf && inner ? `<g transform="${fr.tf}">${inner}</g>` : inner
}

const rect = (b: Box, attrs: string): string => `<rect x="${n1(b.x)}" y="${n1(b.y)}" width="${n1(b.w)}" height="${n1(b.h)}" ${attrs}/>`

/** Walls, carpets, the glass partition, the floor and the corridor: the house itself. */
function architecture(k: K): string {
  const { L, pal } = k
  const z = L.zones
  let out = ''
  // the wall: wallpaper, a wainscot below, a crown moulding above, a skirting at its foot
  out += rect(z.wall, 'fill="url(#o-wl)"')
  out += rect({ x: z.wall.x, y: z.wall.y, w: z.wall.w, h: 3 }, `fill="${pal.woodDark}"`)
  const wain = Math.max(8, z.wall.h * 0.22)
  out += rect({ x: z.wall.x, y: z.wall.y + z.wall.h - wain, w: z.wall.w, h: wain }, `fill="${pal.wallHi}" opacity=".35"`)
  out += rect({ x: z.wall.x, y: z.wall.y + z.wall.h - wain, w: z.wall.w, h: 1.5 }, `fill="${pal.wood}" opacity=".8"`)
  out += rect({ x: z.wall.x, y: z.wall.y + z.wall.h - 3, w: z.wall.w, h: 3 }, `fill="${pal.woodDark}"`)
  // the ticker's frame (the LED band draws itself inside)
  out += rect(z.ticker, `fill="${pal.ink}"`)
  // the boss's corner: a carpet with a border, a soft spotlight on the desk
  out += rect(z.boss, `fill="url(#o-cp)"`)
  out += rect({ x: z.boss.x + 4, y: z.boss.y + 4, w: Math.max(0, z.boss.w - 8), h: Math.max(0, z.boss.h - 8) }, `fill="none" stroke="${pal.gold}" stroke-opacity=".28" stroke-width="1.5"`)
  // the open floor and the corridor's runner
  out += rect(z.floor, 'fill="url(#o-fl)"')
  out += rect(z.corridor, `fill="${pal.carpet}" opacity=".55"`)
  const cx = z.corridor.x + z.corridor.w / 2
  out += `<rect x="${n1(cx - 6)}" y="${n1(z.corridor.y)}" width="12" height="${n1(z.corridor.h)}" fill="${pal.clay}" opacity=".22"/>`
  // the glass partition, with an opening in front of the boss's desk
  const g = z.glass
  const gap = L.boss.front
  if (g.w >= g.h) {
    const g0 = gap[0] - 26
    const g1 = gap[0] + 26
    out += rect({ x: g.x, y: g.y, w: Math.max(0, g0 - g.x), h: g.h }, `fill="${pal.glass}" opacity=".7"`)
    out += rect({ x: g1, y: g.y, w: Math.max(0, g.x + g.w - g1), h: g.h }, `fill="${pal.glass}" opacity=".7"`)
    for (let x = g.x + 30; x < g.x + g.w; x += 48) if (x < g0 - 2 || x > g1 + 2) out += `<rect x="${n1(x)}" y="${n1(g.y - 1)}" width="2" height="${n1(g.h + 2)}" fill="${pal.metal}"/>`
  } else {
    const g0 = gap[1] - 26
    out += rect({ x: g.x, y: g.y, w: g.w, h: Math.max(0, g0 - g.y) }, `fill="${pal.glass}" opacity=".7"`)
    for (let y = g.y + 30; y < g0 - 2; y += 48) out += `<rect x="${n1(g.x - 1)}" y="${n1(y)}" width="${n1(g.w + 2)}" height="2" fill="${pal.metal}"/>`
  }

  return out
}

/** Daylight through the windows on the floor, or at night the lamps of the desks at work. */
function light(k: K): string {
  if (k.lite) return ''
  const { L } = k
  const { h } = istanbul(k.now)
  const z = L.zones
  let out = ''
  if (h >= 7 && h < 20) {
    const fill = h >= 17 ? 'url(#o-dusk)' : 'url(#o-sun)'
    const top = z.ticker.y + z.ticker.h
    const depth = Math.min(160, (L.topo === 'S' ? z.floor.h : z.boss.h + z.floor.h) * 0.45)
    for (const id of ['window0', 'window1', 'window2', 'window3'] as const) {
      const b = L.objects[id]
      if (!b) continue
      const slant = depth * (h < 12 ? 0.55 : h < 15 ? 0.1 : -0.55)
      out += `<path d="M${n1(b.x + 4)} ${n1(top)} H${n1(b.x + b.w - 4)} L${n1(b.x + b.w - 4 + slant)} ${n1(top + depth)} H${n1(b.x + 4 + slant)} Z" fill="${fill}"/>`
    }
  } else {
    for (const w of k.team) {
      const cell = cellOf(k, w)
      if (!cell || !BUSY.has(w.activity)) continue
      out += `<ellipse cx="${n1(cell.seat[0] - L.charSize * 0.6)}" cy="${n1(cell.seat[1])}" rx="${n1(cell.box.w * 0.42)}" ry="${n1(cell.box.h * 0.3)}" fill="url(#o-lamp)"/>`
    }
  }
  // the spotlight over the boss's desk, always on
  const d = L.boss.desk
  out += `<ellipse cx="${n1(d.x + d.w / 2)}" cy="${n1(d.y + d.h * 0.7)}" rx="${n1(d.w * 0.62)}" ry="${n1(d.h * 0.5)}" fill="url(#o-spot)"/>`

  return out
}

// ——— the wall ——————————————————————————————————————————————————

function wall(k: K): string {
  const { L, input, now, c } = k
  const o = L.objects
  const five = limOf(input.usage, 'five_hour', now)
  const week = limOf(input.usage, 'seven_day', now)
  const turn = input.turn
  let out = ''
  if (o.sign) out += P.wallSign(o.sign, { model: modelLabel(turn.model ?? k.boss.model, k.boss.via), effort: effortWord(turn.effort), active: turn.active }, c)
  if (o.clock) out += P.wallClock(o.clock, { five, week, withCalendar: !o.calendar }, c)
  if (o.calendar) out += P.wallCalendar(o.calendar, { week }, c)
  const today = input.daily && input.daily.day === dayKey(now) ? input.daily : undefined
  const lights = today?.sessions ?? 0
  let first = true
  for (const id of ['window0', 'window1', 'window2', 'window3'] as const) {
    const b = o[id]
    if (!b) continue
    out += P.windowView(b, { lights, openAt: first && k.live ? k.sc.windowAt : undefined, sun: first }, c)
    first = false
  }
  if (o.scoreboard) {
    const stats = input.stats
    const sessionMs = stats ? now - (stats.sessionStart || now) : 0
    const stepped = sessionMs < 3_600_000 ? Math.floor(sessionMs / 300_000) * 300_000 : Math.floor(sessionMs / 900_000) * 900_000
    const hours = stepped / 3_600_000
    const usd = input.usage.usd
    const tools = stats ? Object.values(stats.tools).reduce((s, n) => s + n, 0) : 0
    out += P.scoreboard(o.scoreboard, {
      turns: turn.turns,
      tools,
      active: k.team.filter(w => w.endedAt === undefined && w.activity !== 'leaving').length,
      total: k.team.filter(w => w.activity !== 'leaving').length,
      outTokens: stats?.outTokens ?? 0,
      usdToday: today ? today.usd : usd,
      usdChat: usd,
      perHour: usd !== undefined && hours >= 0.25 ? Math.round((usd / hours) * 10) / 10 : undefined,
      chats: today?.sessions,
      sessionMs: stepped,
    }, c)
  }

  return out
}

function tickerItems(k: K): P.TickerItem[] {
  const feed = k.input.feed ?? []
  const byId = new Map(k.input.workers.map(w => [w.id, w] as const))
  const face = (id: string | undefined): CharKind | undefined => {
    const w = id === undefined ? undefined : byId.get(id)

    return w ? charKindOf(mascotFor(w, w.id === 'boss')) : undefined
  }

  return feed
    .slice(-(k.lite ? 4 : 8))
    .reverse()
    // a desk's line says its name as it is now (a title that changed since renames its old lines too)
    .map(f => {
      const who = f.whoId !== undefined && f.whoId !== 'boss' ? byId.get(f.whoId)?.name || f.who : f.who
      const to = f.toId !== undefined && f.toId !== 'boss' && f.to !== undefined ? byId.get(f.toId)?.name || f.to : f.to

      return { t: f.t, kind: f.kind, who, color: f.color, text: f.text, to, toColor: f.toColor, face: face(f.whoId), toFace: face(f.toId) }
    })
}

// ——— the boss's corner ————————————————————————————————————————

function bossCorner(k: K): string {
  const { L, input, now, c, boss, team } = k
  const o = L.objects
  const turn = input.turn
  const stats = input.stats
  const tools = stats?.tools ?? {}
  const sum = (...names: string[]) => names.reduce((s, n) => s + (tools[n] ?? 0), 0)
  const five = limOf(input.usage, 'five_hour', now)
  const week = limOf(input.usage, 'seven_day', now)
  const thinking = boss.activity === 'thinking' || boss.activity === 'planning'
  let out = ''
  if (o.whiteboard) {
    const think = boss.think ?? 'general'
    const title = boss.activity === 'planning' ? 'PLAN' : boss.activity === 'thinking' ? THINK_LABEL[think].toLocaleUpperCase('tr-TR') : turn.active ? 'ÇALIŞIYOR' : 'GÖREV PANOSU'
    out += P.whiteboard(o.whiteboard, {
      title,
      prompt: clip(turn.prompt || 'Yeni iş bekleniyor', 80),
      thought: (boss.detail || activityLabel(boss)).replace(/\s+/g, ' ').trim().slice(0, 140),
      think,
      steps: turn.active ? turn.steps : 0,
      active: thinking || turn.active,
      plan: turn.plan,
      noteAt: k.live ? turn.startedAt : undefined,
    }, c)
  }
  const compacting = boss.activity === 'compacting'
  if (o.cooler) {
    out += P.waterCooler(o.cooler, {
      pct: Math.max(0, Math.min(100, input.usage.ctxPct ?? 0)),
      tokens: input.usage.ctxTokens,
      window: input.usage.ctxWindow,
      autoAt: input.autoCompactAt,
      history: (input.usage.history ?? []).slice(-6),
      drainAt: compacting && k.live ? vStart(boss.since) : undefined,
    }, c)
  }
  if (o.battery) out += P.battery(o.battery, { five, week, flashAt: k.live ? crossedAt(input.usage, now) : undefined }, c)
  if (o.shredder) out += P.shredder(o.shredder, { compacting, autoOn: input.autoCompactAt !== undefined, autoAt: input.autoCompactAt ?? 80, since: compacting ? boss.since : undefined }, c)
  if (o.bookshelf) out += P.bookshelf(o.bookshelf, { read: sum('Read') }, c)
  if (o.archive) out += P.archive(o.archive, { writes: sum('Edit', 'Write', 'MultiEdit', 'NotebookEdit'), openAt: k.live ? lastWriteAt(k) : undefined }, c)
  if (o.rack) out += P.serverRack(o.rack, { runs: sum('Bash', 'PowerShell', 'Monitor'), running: [boss, ...team].some(w => w.activity === 'running') }, c)
  if (o.globe) out += P.globe(o.globe, { web: webCount(tools), active: [boss, ...team].some(w => w.activity === 'web') }, c)
  if (o.plant) out += P.plant(o.plant, { turns: turn.turns }, c)
  if (o.printer) out += P.printer(o.printer, { reports: stats?.reports ?? 0, printAt: k.live ? k.sc.printAt : undefined }, c)

  // the desk, the boss in its chair (or at the board, at the shredder), the desk's front
  const desk = L.boss.desk
  const unread = (input.talks ?? []).filter(t => t.to === 'boss' && unreadTalk(t, now)).length
  const reports = (input.talks ?? []).filter(t => t.to === 'boss' && t.kind === 'report' && t.t >= (turn.startedAt ?? 0)).length
  const data: P.BossDeskData = {
    state: stateLabel(k, boss),
    model: modelLabel(boss.model ?? turn.model, boss.via),
    effort: effortWord(boss.effort ?? turn.effort),
    screen: screenOf(boss, turn.plan ?? boss.plan),
    unread,
    ringing: boss.activity === 'waiting',
    reports,
    mug: true,
  }
  // the desk first (its plate is known to the boss's bubble), drawn around the figure
  const back = P.bossDeskBack(desk, data, c)
  const front = P.bossDeskFront(desk, data, c)
  const fig = bossFigure(k)
  // on the throne: the desk's back, the props behind, the boss, the desk's front, the props on the desk top
  out += back + fig.seated + front + fig.onDesk + fig.standing

  return out
}

const unreadTalk = (t: Talk, now: number): boolean => t.kind === 'message' && t.isDelivered && (t.readAt === undefined || t.readAt > now) && now - t.t < 90_000

function webCount(tools: Record<string, number>): number {
  let n = (tools.WebFetch ?? 0) + (tools.WebSearch ?? 0)
  for (const [name, v] of Object.entries(tools)) if (/browser|navigate|chrome|playwright/i.test(name)) n += v

  return n
}

function lastWriteAt(k: K): number | undefined {
  let at: number | undefined
  for (const w of [k.boss, ...k.team]) if (w.screen?.kind === 'file-write' && k.now - w.screen.at < 4000) at = Math.max(at ?? 0, w.screen.at)

  return at
}

// ——— the boss ———————————————————————————————————————————————————

type Moment = { kind: 'cheer' | 'oops'; who: string; at: number }

/** The newest finish or failure in the team in the last few seconds: the boss reacts to it. */
function bossMoment(k: K): Moment | undefined {
  let best: Moment | undefined
  for (const w of k.team) {
    if (w.endedAt === undefined) continue
    if (w.activity !== 'done' && w.activity !== 'failed' && w.activity !== 'leaving') continue
    const at = vStart(w.endedAt)
    if (k.now - at < 0 || k.now - at > 6000) continue
    if (!best || at > best.at) best = { kind: w.activity === 'failed' ? 'oops' : 'cheer', who: w.name, at }
  }

  return best
}

/** The crown on a boss that is not the crowned Pofu, at its head. */
/**
 * The boss's sprite at `where`. The 'think' strip carries a thought cloud high above the head: where
 * the ticker leaves no room for it, the boss thinks without it (the cloud bubble beside it says the
 * thought), so no bits of a cut cloud peep out under the news.
 */
function bossChar(k: K, state: CharState, where: Pt, opts: CharOpts): string {
  const cb = charBox(k.bossKind, k.L.bossSize)
  const ceiling = k.L.zones.ticker.y + k.L.zones.ticker.h
  const roomy = where[1] - cb.ay >= ceiling - 0.5

  return drawCharacter(k.bossKind, state === 'think' && !roomy ? 'idle' : state, where[0], where[1], k.L.bossSize, opts)
}

function crownOn(k: K, at: Pt): string {
  if (k.bossKind === 'pofu-boss') return ''
  const cb = charBox(k.bossKind, k.L.bossSize)

  return P.crown(at[0], at[1] - cb.bodyH + 1, k.L.bossSize / 28)
}

/**
 * A bubble over a head whose feet are at `where`. It never climbs over the ticker: when there is no
 * room above the head it sits beside it instead (right, or left at the right edge), tail toward it.
 */
function headBubble(k: K, where: Pt, cb: { bodyH: number; left: number; right: number }, text: string, maxW: number, tone: Tone, shape: Shape, avoid: readonly Box[] = []): string {
  const { L, fs } = k
  const top = L.zones.ticker.y + L.zones.ticker.h + 2
  const above = where[1] - cb.bodyH - 6 - bubbleH(fs)
  const half = Math.max(6, (cb.right - cb.left) / 2)
  // where it may stand, best first: over the head, beside it (right, then left), a little lower beside
  // it, then narrower (a shorter line); the first that covers no other text is taken
  const tries: Array<[number, number, number]> = []
  for (const mw of [maxW, maxW * 0.75, maxW * 0.55]) {
    const w = bubbleBox(text, 0, 0, mw, -1e6, 1e6, shape, fs).w
    const right = where[0] + half + w / 2 + 2
    const left = where[0] - half - w / 2 - 2
    const side = right <= L.SW - 2 - w / 2 ? [right, left] : [left, right]
    if (above >= top) tries.push([where[0], above, mw], [where[0] + w * 0.35, above, mw], [where[0] - w * 0.35, above, mw])
    for (const dy of [0, bubbleH(fs) * 0.9]) for (const x of side) tries.push([x, Math.max(top, above) + dy, mw])
  }
  const boxOf = (t: [number, number, number]) => bubbleBox(text, t[0], t[1], t[2], 2, L.SW - 2, shape, fs)
  // (clear of the activity's props too where it can be: a bubble over a plan sheet or a periscope hides it)
  const onProp = (b: Box) => avoid.some(o => b.x < o.x + o.w + 2 && o.x < b.x + b.w + 2 && b.y < o.y + o.h + 2 && o.y < b.y + b.h + 2)
  let pick = tries.find(t => !P.textHit(boxOf(t), 1) && !onProp(boxOf(t))) ?? tries.find(t => !P.textHit(boxOf(t), 1))
  // nowhere clear (a crowded small pane): the news is left out (the desk plate and the board say it),
  // an approval ask stays where it covers the least
  if (!pick && tone === 'warn') pick = [...tries].sort((a, b) => P.textOverlap(boxOf(a)) - P.textOverlap(boxOf(b)))[0]
  if (!pick) return ''
  const [cx, y, mw] = pick
  P.noteBox(boxOf(pick))

  return bubble(text, cx, y, mw, where[0], 2, L.SW - 2, tone, shape, fs)
}

function bossFigure(k: K): { seated: string; onDesk: string; standing: string } {
  const { L, boss, now, live } = k
  const spot = bossSpot(boss)
  const at = bossPoint(k, spot)
  const size = L.bossSize
  const kind = k.bossKind
  const cb = charBox(kind, size)
  const fx = k.sc.fx.get('boss')
  const opts: CharOpts = { speed: k.speed, tired: k.fat, boss: true }
  const fig = (state: CharState, extra: CharOpts = {}, where: Pt = at) => bossChar(k, state, where, { ...opts, ...extra }) + crownOn(k, where)
  const since = vStart(boss.since)
  const fs = k.fs
  // its activity (0.9): on the throne the props stand on the desk top; at the board or the shredder it stands
  const act = actLayers(k, boss, kind, size, at, spot === 'throne' ? P.bossDeskGeom(L.boss.desk).slabY : undefined, L.zones.ticker.y + L.zones.ticker.h + 1, {
    x: at[0] - cb.ax + cb.left,
    y: at[1] - cb.bodyH,
  })
  const am = act?.main
  /** a phase showing the main activity: its figure state and body motion, its props behind and in front */
  const withMain = (when: number, still = false): Phase | undefined =>
    am && act ? { at: when, svg: am.wrap(fig(am.state, { cropTop: am.crop, ...(still ? { play: 'still' as const } : { delay: -0.4 }) })), back: act.mainBack, front: act.mainFront } : undefined
  // a bubble stays above a prop on the head
  const headRoom = act?.headTop !== undefined ? { ...cb, bodyH: Math.max(cb.bodyH, at[1] - act.headTop + 2) } : cb
  const bubbleAt = (where: Pt, text: string, tone: Tone, shape: Shape): string => headBubble(k, where, where === at ? headRoom : cb, text, Math.min(260, Math.max(120, fs * 28)), tone, shape, where === at ? [...(act?.boxes ?? []), ...(act ? [P.bossDeskGeom(L.boss.desk).monitor] : [])] : undefined)
  const phases: Phase[] = []
  const talk: Phase[] = []
  const act0 = boss.activity
  // a walk the tracker planned (to the board, to the shredder, back to the throne)
  const move = live ? k.input.moves?.get('boss') : undefined
  const arrive = move && now < move.at + move.dur ? move.at + move.dur : undefined
  if (move && arrive !== undefined) {
    // (to and from the throne it walks from and to where it sits: bossPoint, raised over the desk's cover)
    const throne = L.boss.throne
    const sat = bossPoint(k, 'throne')
    const near = (p: Pt) => Math.hypot(p[0] - throne[0], p[1] - throne[1]) < 2
    const first = move.pts[0] as Pt
    const last = move.pts[move.pts.length - 1] as Pt
    const pts = sat[1] !== throne[1] ? [...(near(first) ? [sat] : []), ...move.pts, ...(near(last) && move.pts.length > 1 ? [sat] : [])] : move.pts
    k.walkers.push(walker({ kind, size, pts, t0: move.at, dur: move.dur, holdFrom: now, stay: 0, speed: k.speed, tired: k.fat, shadow: !k.lite }))
  }

  if (act0 === 'idle') {
    // a nap the activity asks for at once (the 5-hour limit spent, a full context): no idle acts before it
    const nap = k.napAt === undefined ? withMain(-Infinity) : undefined
    if (nap) {
      phases.push(nap)
      talk.push({ at: -Infinity, svg: '' })
    } else {
      const plain = fig('idle', { delay: -0.4 })
      const quiet = now - boss.since
      phases.push({ at: -Infinity, svg: plain })
      talk.push({ at: -Infinity, svg: '' })
      if (fresh(k, boss)) talk.push({ at: since, svg: bubbleAt(at, boss.bubble, 'royal', 'say') }, { at: since + 5000, svg: '' })
      // ten minutes idle: asleep (the nap strip over its head, else the z's)
      const sleep = (): Phase => withMain(boss.since + SLEEP_AFTER, true) ?? { at: boss.since + SLEEP_AFTER, svg: fig('idle', { play: 'still' }) + zz(k, at, cb.bodyH) }
      if (k.motion) {
        phases.push({ at: boss.since + ACT_AFTER, svg: actLoop(k, at, false) })
        talk.push({ at: boss.since + ACT_AFTER, svg: actLoop(k, at, true) })
        phases.push(sleep())
        talk.push({ at: boss.since + SLEEP_AFTER, svg: '' })
      } else if (quiet >= SLEEP_AFTER) {
        phases.push(sleep())
      }
    }
  } else if (act0 === 'waiting') {
    // waiting for an approval: a coffee while it waits (its activity), pacing after 15 s (no props)
    phases.push(withMain(-Infinity) ?? { at: -Infinity, svg: fig('wait') })
    if (k.motion) phases.push({ at: boss.since + 15_000, svg: pacing(k, at) })
    const ask = boss.bubble || 'Onayını bekliyorum'
    talk.push({ at: -Infinity, svg: bubbleAt(at, ask, 'warn', 'say') })
    if (k.motion && !k.lite) talk.push({ at: boss.since + 60_000, svg: bubbleAt(at, 'Ahh… hâlâ onay bekliyorum', 'warn', 'think') })
  } else if (act0 === 'done') {
    const doneAt = vStart(boss.endedAt ?? boss.since)
    phases.push({ at: -Infinity, svg: fig('done', { play: 'once', delay: n2(-(now - doneAt) / 1000) }) })
    phases.push({ at: doneAt + 2200, svg: fig('idle') })
    talk.push({ at: -Infinity, svg: fresh(k, boss) ? bubbleAt(at, boss.bubble, 'royal', 'say') : '' }, { at: since + 5000, svg: '' })
  } else if (act0 === 'failed') {
    phases.push({ at: -Infinity, svg: fig('fail') + drip(k, at, cb.bodyH) })
    talk.push({ at: -Infinity, svg: bubbleAt(at, 'Bir hata oldu.', 'warn', 'say') })
  } else {
    const state: CharState = act0 === 'thinking' ? 'think' : act0 === 'reading' || act0 === 'web' ? 'read' : act0 === 'delegating' ? 'wave' : 'work'
    phases.push(withMain(-Infinity) ?? { at: -Infinity, svg: fig(state, { left: false }) })
    if (act0 === 'thinking' || act0 === 'planning') {
      talk.push({ at: -Infinity, svg: bubbleAt(at, boss.detail && boss.bubble ? boss.bubble : '…', 'royal', 'think') })
    } else if (act0 === 'answering') {
      talk.push({ at: -Infinity, svg: bubbleAt(at, 'Sana cevabı yazıyorum…', 'royal', 'say') })
    } else {
      talk.push({ at: -Infinity, svg: '' })
      if (fresh(k, boss)) talk.push({ at: since, svg: bubbleAt(at, boss.bubble, 'royal', act0 === 'messaging' ? 'mail' : 'say') }, { at: since + 5000, svg: '' })
    }
  }

  let base = timeline(k, phases)
  let words = timeline(k, talk)
  // the activity's props follow the phases; an event (a one-off) takes the main's place while it plays
  let back = act ? evHide(k, act, timeline(k, phases, 'back')) + act.evBack : ''
  let front = act ? evHide(k, act, timeline(k, phases, 'front')) + act.evFront + act.over : ''
  if (act?.ev) {
    const evFig = act.ev.wrap(fig(act.ev.state, { delay: -0.4 }))
    base = live ? except(act.ev.a, act.ev.b, base) + during(act.ev.a, act.ev.b, evFig) : evFig
  }
  // a reaction or a cue takes the figure for a moment: the props make way
  const swap = (a: number, b: number, svg: string) => {
    base = except(a, b, base) + during(a, b, svg)
    back = except(a, b, back)
    front = except(a, b, front)
  }
  // reactions: a finished or failed worker, a new request, the talks' cues
  if (live) {
    const overrides: Array<[number, number, string]> = []
    const m = bossMoment(k)
    if (m) {
      const a = m.at - now
      if (m.kind === 'cheer') {
        overrides.push([a, a + 2600, fig('done', { play: 'once', delay: n2(-(now - m.at) / 1000) })])
        k.bubbles.push(during(a, a + 6000, `<g>${confetti(at[0], at[1] - cb.bodyH, now - m.at, k.L.bossSize / 56)}</g>`))
        words = except(a, a + 6000, words) + during(a, a + 6000, bubbleAt(at, pick(CHEERS, m.who).replace('{n}', m.who), 'royal', 'say'))
      } else {
        overrides.push([a, a + 2200, fig('fail', { play: 'once', delay: n2(-(now - m.at) / 1000) })])
        k.bubbles.push(during(a, a + 4000, drip(k, at, cb.bodyH)))
        words = except(a, a + 5000, words) + during(a, a + 5000, bubbleAt(at, pick(OOPS, m.who).replace('{n}', m.who), 'light', 'say'))
      }
    }
    const asked = k.input.turn.startedAt
    if (asked !== undefined && now - vStart(asked) < 2200 && (act0 === 'thinking' || act0 === 'planning')) overrides.push([vStart(asked) - now, vStart(asked) + 2000 - now, fig('read')])
    if (fx?.wave) overrides.push([fx.wave[0], fx.wave[1], fig('wave')])
    if (fx?.read) overrides.push([fx.read[0], fx.read[1], fig('read')])
    for (const [a, b, svg] of overrides) swap(a, b, svg)
    if (fx?.jump !== undefined) base = `<g style="animation:jump .9s ${n2(fx.jump / 1000)}s 1">${base}</g>`
    if (fx?.rise) {
      base = `<g style="--rh:${n1(-size * 0.2)}px;animation:rise ${n2((fx.rise[1] - fx.rise[0]) / 1000)}s ${n2(fx.rise[0] / 1000)}s 1">${base}</g>`
      words = except(fx.rise[0], fx.rise[1], words)
      back = except(fx.rise[0], fx.rise[1], back)
      front = except(fx.rise[0], fx.rise[1], front)
    }
  }
  if (arrive !== undefined) {
    base = after(arrive - now, base)
    words = after(arrive - now, words)
    back = after(arrive - now, back)
    front = after(arrive - now, front)
  }
  k.bubbles.push(words)
  const tip = k.lite ? '' : `<title>${esc(`Patron${bossNote(k)} — ${stateLabel(k, boss)}`)}</title>`
  const svg = `<g>${tip}${back}${base}</g>`

  return spot === 'throne' ? { seated: svg, onDesk: front, standing: '' } : { seated: '', onDesk: '', standing: svg + front }
}

function bossNote(k: K): string {
  const model = k.boss.model ?? k.input.turn.model
  const effort = k.boss.effort ?? k.input.turn.effort
  const word = effortWord(effort)
  const parts = [model ? modelLabel(model, k.boss.via) : '', word ? `${word} efor` : ''].filter(Boolean)

  return parts.length ? ` (${parts.join(' · ')})` : ''
}

/** A fresh bubble: news for five seconds after the state began. */
const fresh = (k: K, w: Worker): boolean => k.live && Boolean(w.bubble) && k.now - vStart(w.since) < 5000

/** The newspaper's masthead: readable or left out (the paper alone says it). */
function paperHead(k: K, cx: number, top: number, s: number): string {
  const fs = Math.max(3.6 * s, P.MIN_PX / k.L.s)
  if (P.textWidth('AI GAZETESİ', fs) > 34 * s) return ''

  return `<text x="${n1(cx)}" y="${n1(top + Math.max(4.4 * s, fs * 0.9))}" text-anchor="middle" class="s" font-size="${n2(fs)}" fill="#141413">AI GAZETESİ</text>`
}

function zz(k: K, at: Pt, bodyH: number): string {
  const s = k.L.bossSize / 56

  return [0, 1, 2].map(i => `<text x="${n1(at[0] + 10 * s)}" y="${n1(at[1] - bodyH + 4 * s)}" class="t" font-size="${n2((7 + i * 2) * s)}" font-weight="700" fill="#94A3B8" style="animation:zz 3s ${-i}s infinite">z</text>`).join('')
}

function drip(k: K, at: Pt, bodyH: number): string {
  const s = k.L.bossSize / 56

  return `<path d="M${n1(at[0] + 14 * s)} ${n1(at[1] - bodyH + 6 * s)} q${n2(3 * s)} ${n2(5 * s)} 0 ${n2(7 * s)} q${n2(-3 * s)} ${n2(-2 * s)} 0 ${n2(-7 * s)} z" fill="#6A9BCC" style="animation:drip 1.4s infinite"/>`
}

/**
 * The boss with nothing to do, after 45 s: one CSS loop of six 25-second acts (coffee, the
 * paper, juggling, the phone, a stretch or a yawn, the window or a wave to the team), locked
 * to the wall clock, so it never needs a redraw. `talk` draws the acts' bubbles instead.
 */
function actLoop(k: K, at: Pt, talk: boolean): string {
  const size = k.L.bossSize
  const s = size / 56
  const cb = charBox(k.bossKind, size)
  const head = at[1] - cb.bodyH
  const team = k.team.length > 0
  const acts: Act[] = ['coffee', 'paper', 'juggle', 'phone', k.fat >= 2 ? 'yawn' : 'stretch', team ? 'wave' : 'window']
  const fs = k.fs
  const fig = (state: CharState, extra: CharOpts = {}) => bossChar(k, state, at, { speed: k.speed, tired: k.fat, boss: true, ...extra }) + crownOn(k, at)
  let out = ''
  acts.forEach((act, i) => {
    const gate = (inner: string) => `<g style="opacity:0;animation:bslot 150s ${-25 * i}s infinite">${inner}</g>`
    if (talk) {
      const where: Pt = act === 'window' ? k.L.boss.window : at
      const say = pick(IDLE_QUIP[act], `${act}${hash(k.boss.id)}`)
      out += gate(headBubble(k, where, cb, say, Math.min(240, fs * 24), 'royal', act === 'yawn' ? 'think' : 'say'))
      return
    }
    let inner = ''
    switch (act) {
      case 'coffee': {
        const mx = n1(-14 * s)
        const my = n1(-cb.bodyH * 0.35)
        inner = fig('idle') + `<g class="fb" style="--mx:${mx}px;--my:${my}px;animation:sip 7s ${-i}s infinite"><path d="M${n1(at[0] + 16 * s)} ${n1(at[1] - cb.bodyH * 0.35)} h${n2(9 * s)} l${n2(-1.4 * s)} ${n2(8 * s)} h${n2(-6.2 * s)} z" fill="#F0EEE6" stroke="#2A2522" stroke-width=".5"/><path d="M${n1(at[0] + 19 * s)} ${n1(at[1] - cb.bodyH * 0.35 - 2)} q${n2(2 * s)} ${n2(-3 * s)} 0 ${n2(-6 * s)}" fill="none" stroke="#CBD5E1" stroke-width=".8" style="animation:steam 2s infinite"/></g>`
        break
      }
      case 'paper':
        inner = fig('idle') + `<g class="fbb" style="animation:paper 3s infinite"><rect x="${n1(at[0] - 18 * s)}" y="${n1(head + cb.bodyH * 0.35)}" width="${n2(36 * s)}" height="${n2(20 * s)}" rx="1" fill="#F0EEE6" stroke="#85837A" stroke-width=".5"/><rect x="${n1(at[0] - 15 * s)}" y="${n1(head + cb.bodyH * 0.35 + 6 * s)}" width="${n2(14 * s)}" height="${n2(5 * s)}" fill="#85837A"/><path d="M${n1(at[0] + 1 * s)} ${n1(head + cb.bodyH * 0.35 + 7 * s)} h${n2(14 * s)} M${n1(at[0] - 15 * s)} ${n1(head + cb.bodyH * 0.35 + 14 * s)} h${n2(30 * s)}" stroke="#85837A" stroke-width=".8"/>${paperHead(k, at[0], head + cb.bodyH * 0.35, s)}</g>`
        break
      case 'juggle':
        inner = fig('idle') + [0, 1, 2].map(j => `<circle cx="${n1(at[0] - 10 * s + j * 10 * s)}" cy="${n1(head - 6 * s)}" r="${n2(2.8 * s)}" fill="${['#E0685A', '#6A9BCC', '#FBBF24'][j]}" style="--jh:${n1(-16 * s)}px;animation:juggle .9s ${-j * 0.3}s ease-in-out infinite"/>`).join('')
        break
      case 'phone':
        inner = fig('idle') + `<g style="animation:buzz .5s infinite"><rect x="${n1(at[0] + 12 * s)}" y="${n1(head + 4 * s)}" width="${n2(6 * s)}" height="${n2(11 * s)}" rx="1.2" fill="#1F1E1D" stroke="#D4A27F" stroke-width=".6"/><rect x="${n1(at[0] + 13.2 * s)}" y="${n1(head + 5.6 * s)}" width="${n2(3.6 * s)}" height="${n2(6 * s)}" fill="#6A9BCC"/></g>`
        break
      case 'stretch':
        inner = `<g class="fbb" style="animation:stretch 4s infinite">${fig('idle')}</g>`
        break
      case 'yawn':
        inner = fig('idle', { tired: k.fat })
        break
      case 'wave':
        inner = fig('wave')
        break
      case 'window': {
        const to = k.L.boss.window
        const wx = n1(to[0] - at[0])
        const wy = n1(to[1] - at[1])
        const lock = (name: string) => `animation:${name} 150s ${-25 * i}s infinite`
        const left = to[0] < at[0]
        inner =
          `<g style="--wx:${wx}px;--wy:${wy}px;${lock('bwin')}">` +
          `<g style="opacity:0;${lock('bw1')}">${fig('walk', { left })}</g>` +
          `<g style="opacity:0;${lock('bw2')}">${fig('idle', { left })}</g>` +
          `<g style="opacity:0;${lock('bw3')}">${fig('walk', { left: !left })}</g></g>`
        break
      }
    }
    out += gate(inner)
  })

  return out
}

/** Waiting for an approval for long: pacing behind the desk, a tap of the foot at each end. */
function pacing(k: K, at: Pt): string {
  const size = k.L.bossSize
  const pd = n1(Math.min(k.L.boss.desk.w * 0.22, size * 0.9))
  const fig = (state: CharState, left = false) => bossChar(k, state, at, { speed: k.speed, tired: k.fat, left, boss: true }) + crownOn(k, at)

  return (
    `<g style="--pd:${pd}px;animation:pace 6s infinite">` +
    `<g style="animation:pcw 6s infinite"><g style="animation:tap .3s infinite">${fig('wait')}</g></g>` +
    `<g style="opacity:0;animation:pcr 6s infinite">${fig('walk')}</g>` +
    `<g style="opacity:0;animation:pcl 6s infinite">${fig('walk', true)}</g></g>`
  )
}

// ——— the floor ——————————————————————————————————————————————————

function floor(k: K): string {
  const { L, input, now, c, team } = k
  const stats = input.stats
  const tools = stats?.tools ?? {}
  const sum = (...names: string[]) => names.reduce((s, n) => s + (tools[n] ?? 0), 0)
  const byCell = new Map<number, Worker>()
  for (const w of team) {
    const i = L.seats.get(w.id)
    if (i !== undefined) byCell.set(i, w)
  }
  const resting = team.filter(w => w.activity === 'idle' && w.idleSince !== undefined && w.endedAt === undefined)
  // who goes for a coffee, who rests on the sofa, who wanders: slots, the longest first
  const coffee = team.filter(w => w.activity === 'done' && w.endedAt !== undefined && L.seats.has(w.id)).sort((a, b) => (a.endedAt as number) - (b.endedAt as number)).slice(0, 3)
  const lounges = L.cells.filter(cl => cl.kind === 'lounge')
  const sofa = lounges.length > 0 ? resting.filter(w => L.seats.has(w.id)).sort((a, b) => (a.idleSince as number) - (b.idleSince as number)).slice(0, 3) : []
  const wander = lounges.length > 0 ? [] : resting.filter(w => L.seats.has(w.id)).sort((a, b) => (a.idleSince as number) - (b.idleSince as number)).slice(0, 2)
  const filler: P.FillerData = {
    read: sum('Read'),
    writes: sum('Edit', 'Write', 'MultiEdit', 'NotebookEdit'),
    runs: sum('Bash', 'PowerShell', 'Monitor'),
    running: [k.boss, ...team].some(w => w.activity === 'running'),
    web: webCount(tools),
    webActive: [k.boss, ...team].some(w => w.activity === 'web'),
    turns: input.turn.turns,
    messages: stats?.messages ?? 0,
    resting: resting.length,
  }
  if (k.boss.activity === 'idle' && !k.lite) {
    const calm = team.filter(w => L.seats.has(w.id) && w.activity === 'idle' && w.idleSince === undefined)
    if (calm.length > 0) k.waveBuddy = (calm[hash(`${k.boss.since}`) % calm.length] as Worker).id
  }
  const relayout = k.live && input.relayout && now - input.relayout.at < 3000 ? input.relayout : undefined
  const cells = [...L.cells].sort((a, b) => a.row - b.row || a.col - b.col)
  // the next one hired sits at the first free desk (serpentine order): that desk's card says its number
  const firstFree = L.cells.find(cl => cl.kind === 'free' || (cl.kind === 'desk' && !byCell.has(cl.i)))?.i
  const nextNum = team.reduce((m, w) => Math.max(m, w.n + 1), 0) + 1
  const free = (cell: Cell) => framed(k, cell.box, (b, fc) => P.freeDesk(b, L.variant, fc, cell.i === firstFree ? nextNum : undefined))
  // every seated desk's title and plate share one type size and one rule (props.deskGroup)
  P.deskGroup(team.filter(w => L.seats.has(w.id)).map(w => deskData(k, w)))
  let out = ''
  let deskIndex = 0
  for (const cell of cells) {
    let svg = ''
    switch (cell.kind) {
      case 'desk': {
        const w = byCell.get(cell.i)
        const slot = (list: readonly Worker[]) => (w && list.includes(w) ? w.n % (list === coffee ? 5 : 3) : -1)
        svg = w ? deskWorker(k, w, cell, { coffee: slot(coffee), sofa: slot(sofa), wander: wander.includes(w) ? 0 : -1 }) : free(cell)
        break
      }
      case 'free':
        svg = free(cell)
        break
      case 'coffee':
        svg = P.coffeeCorner(cell.box, { done: stats?.done ?? 0, brewAt: k.live ? k.brewAt : undefined }, c)
        break
      default:
        svg = P.fillerCell(cell.box, cell.kind, filler, c)
    }
    // the grid was laid out anew: the desks are set up one after another
    if (relayout && (cell.kind === 'desk' || cell.kind === 'free')) {
      const d = relayout.at + 60 * deskIndex++ - now
      svg = `<g class="fbb" style="animation:pop .4s ${n2(d / 1000)}s ease-out both">${svg}</g>`
    }
    out += svg
  }
  // the old grid's desks fold away
  if (relayout && !k.lite) {
    for (const old of relayout.prevCells) {
      const b: Box = { x: old.x / L.s, y: old.y / L.s, w: old.w / L.s, h: old.h / L.s }
      if (L.cells.some(cl => Math.abs(cl.box.x - b.x) < 2 && Math.abs(cl.box.y - b.y) < 2)) continue
      out += `<g class="fbb" style="animation:fold 1.2s ${n2((relayout.at - now) / 1000)}s 1 both">${framed(k, b, (fb, fc) => P.freeDesk(fb, L.variant, fc))}</g>`
    }
  }
  // the door last: walkers go in front of it, the plate stays readable
  const leaving = team.filter(w => w.activity === 'leaving')
  for (const w of leaving) leaver(k, w, coffeeSpot(k, w.n % 5))
  if (k.live) k.doorAt.push(...k.sc.doorAt)
  out += P.door(L.doorBox, {
    inside: team.filter(w => L.seats.has(w.id) && w.endedAt === undefined).length,
    total: team.filter(w => w.activity !== 'leaving').length,
    hidden: L.hidden,
    inbound: stats?.inbound ?? 0,
    openAt: k.live ? k.doorAt : undefined,
  }, c)

  return out
}

/** Five places at the coffee counter (stable per worker: `n % 5`), so two coffee-goers rarely share one. */
function coffeeSpot(k: K, slot: number): Pt {
  const [x, y] = k.L.coffee
  const cell = k.L.cells[k.L.cells.length - 1]
  const step = Math.min(k.L.charSize * 0.62, cell ? (cell.box.w * 0.84) / 5 : k.L.charSize * 0.62)

  return [x + step * (Math.max(0, Math.min(4, slot)) - 2), y]
}

/** A small name plate over a figure away from its desk (who is at the coffee, on the sofa, wandering): feet at `at`. */
function nameTag(k: K, w: Worker, at: Pt, bodyH: number, path?: readonly Pt[]): string {
  if (k.lite) return ''
  k.tags.push({ name: w.name, color: w.color, at, bodyH, path })

  // a mark the plate replaces once the rest of the office is drawn (placeTag)
  return `<!--nt${k.tags.length - 1}-->`
}

/**
 * A name plate over a head, placed clear of every text drawn so far and of the plates before it: over
 * the head, else a row higher (up to three), else a little to the side; kept inside the pane; a long
 * name is cut with '…'. Where none of that is clear, the plate is left out (the desk card names it).
 */
function placeTag(k: K, t: { name: string; color: string; at: Pt; bodyH: number; path?: readonly Pt[] }): string {
  const { L } = k
  const fs = n2(Math.max(6, P.MIN_PX / L.s, 9.5 / L.s))
  // a walker carries its plate along its path: the plate keeps inside the pane at every point of it
  const xs = (t.path ?? [t.at]).map(p => p[0] - t.at[0])
  const ys = (t.path ?? [t.at]).map(p => p[1] - t.at[1])
  const [dL, dR, dT] = [Math.min(0, ...xs), Math.max(0, ...xs), Math.min(0, ...ys)]
  const maxW = Math.min(L.SW - 4 - (dR - dL), Math.max(L.charSize * 2.6, fs * 9))
  if (maxW < fs * 3) return ''
  const name = P.ellipsize(t.name, maxW - fs * 0.8, fs, true)
  const tw = P.textWidth(name, fs, true) + fs * 0.8
  const th = fs * 1.3
  const y0 = t.at[1] - t.bodyH - fs * 1.5
  const spots: Pt[] = []
  for (const dy of [0, -1.15, -2.3, -3.45]) for (const dx of [0, 0.6, -0.6]) spots.push([t.at[0] - tw / 2 + dx * tw, y0 + dy * th])
  for (const [x, y] of spots) {
    const box = { x: Math.max(2 - dL, Math.min(L.SW - 2 - tw - dR, x)), y: Math.max(1 - dT, y), w: tw, h: th }
    if (P.textHit(box, 1)) continue
    P.noteBox(box)

    return `<g><rect x="${n1(box.x)}" y="${n1(box.y)}" width="${n1(tw)}" height="${n1(th)}" rx="${n1(fs * 0.35)}" fill="#141210" fill-opacity=".82" stroke="${t.color}" stroke-width="${n2(Math.max(0.5, 1 / L.s))}"/><text x="${n1(box.x + tw / 2)}" y="${n1(box.y + fs * 0.98)}" text-anchor="middle" class="t" font-size="${fs}" font-weight="700" fill="${t.color}">${esc(name)}</text></g>`
  }

  return ''
}

function sofaSpot(k: K, slot: number): Pt {
  const cell = k.L.cells.find(cl => cl.kind === 'lounge')
  if (!cell) return k.L.coffee

  // the sofa's own seats (props.loungeSeats), three places left to right
  return P.loungeSeats(cell.box, 3)[Math.max(0, Math.min(2, slot))] ?? k.L.coffee
}

/** The personal layer of a desk (screen, card, panel…) and what it shows. */
function deskData(k: K, w: Worker, more: { bootAt?: number; packAt?: number } = {}): P.DeskData {
  // the effort as said, else as the model id ends ('gemini-3.8-flash-high', agy)
  const effort = w.effort ?? splitEffort(w.model ?? '').effort

  return {
    num: w.n + 1,
    // the desk's name is its title ('Yazılımcı 2', logic numberedName); the card's chip carries its number
    card: w.name,
    color: w.color,
    external: w.kind === 'external',
    badge: w.via,
    duty: w.duty,
    model: modelLabel(w.model, w.via),
    effort: effortLevel(effort),
    effortText: effortWord(effort),
    // the plate says what it is doing ('Kod yazıyor', 'Dedektif avında'), else its state
    state: stateLabel(k, w),
    lampOff: lampMakesWay(k, w),
    tone: toneOf(w.activity),
    mins: stepMinutes(k.now, w.joinedAt),
    tools: w.tools,
    screen: screenOf(w),
    unread: (k.input.talks ?? []).some(t => t.to === w.id && unreadTalk(t, k.now)),
    tired: k.fat,
    seed: w.id,
    bootAt: k.live ? more.bootAt : undefined,
    packAt: k.live ? more.packAt : undefined,
  }
}

/** The desk lamp makes way for a side prop behind the figure (it stands at the desk's right end). */
function lampMakesWay(k: K, w: Worker): boolean {
  const v = k.views.get(w.id)
  if (!v) return false

  return [v.main, ...(v.extra ?? [])].some(p => {
    const q = partOf(k, p)
    return q !== undefined && q.e.layer === 'arka' && q.e.anchor === 'yan'
  })
}

/** A desk figure's loop stagger: desks of one kind do not move in step. */
const staggered = (w: Worker): CharOpts => ({ delay: n2(-(hash(w.id) % 997) / 1000) })

/** A worker's state at its desk (§5.2), as phases on the wall clock. */
function deskPhases(k: K, w: Worker, fig: (state: CharState, o?: CharOpts) => string): Phase[] {
  const now = k.now
  const since = vStart(w.since)
  const loop = { delay: n2(-(hash(w.id) % 997) / 1000) }
  switch (w.activity) {
    case 'idle': {
      if (k.lite || !k.motion) return [{ at: -Infinity, svg: fig('idle', loop) }]
      // now and then a look to the left (only idle turns its head)
      const look = n2(-(hash(`${w.id}~look`) % 20))
      return [{ at: -Infinity, svg: `<g style="animation:lkx 20s ${look}s infinite">${fig('idle', loop)}</g><g style="opacity:0;animation:lk 20s ${look}s infinite">${fig('idle', { ...loop, left: true })}</g>` }]
    }
    case 'thinking':
    case 'planning':
      return [{ at: -Infinity, svg: fig('think', loop) }]
    case 'reading':
    case 'web':
      return [{ at: -Infinity, svg: fig('read', loop) }]
    case 'waiting':
      return [{ at: -Infinity, svg: fig('wait', loop) }]
    case 'failed':
      return [{ at: -Infinity, svg: fig('fail', loop) }]
    case 'delegating':
      return [{ at: -Infinity, svg: fig('wave', { play: 'once', loops: 2, delay: n2(-(now - since) / 1000) }) }, { at: since + 1800, svg: fig('work', loop) }]
    case 'messaging':
      return [{ at: -Infinity, svg: fig('wave', { play: 'once', delay: n2(-(now - since) / 1000) }) }, { at: since + 900, svg: fig('work', loop) }]
    case 'done': {
      const at = vStart(w.endedAt ?? w.since)
      return [{ at: -Infinity, svg: fig('done', { play: 'once', delay: n2(-(now - at) / 1000) }) }, { at: at + 1600, svg: fig('idle', loop) }]
    }
    default:
      return [{ at: -Infinity, svg: fig('work', loop) }]
  }
}

// the tracker's walks as drawn (pane px): one who leaves mid-walk leaves from where it is
const SEEN_MOVES = new Map<string, Plan & { s: number }>()

/** One desk with its worker: the desk's back, the worker (or its walk), the desk's front, its bubble. */
function deskWorker(k: K, w: Worker, cell: Cell, slots: { coffee: number; sofa: number; wander: number }): string {
  const { L, now, live } = k
  const kind = charKindOf(mascotFor(w, false))
  const size = L.charSize
  const cb = charBox(kind, size)
  const seat = cell.seat
  // seated: higher than the feet's spot by the desk's cover (sitLift); walks start and end at the seat
  const lift = sitLift(k, kind)
  const sit: Pt = [seat[0], n2(seat[1] - lift)]
  // a walk that starts or ends at the chair starts or ends at the seated figure's spot (no hop between the two)
  const standing = (pts: Pt[], chair: Pt = seat, up: number = lift): Pt[] => {
    if (up < 0.5) return pts
    const first = pts[0] as Pt
    const last = pts[pts.length - 1] as Pt
    const hop = (p: Pt): Pt => [p[0], n2(p[1] - up)]
    const near = (p: Pt) => Math.hypot(p[0] - chair[0], p[1] - chair[1]) < 2

    return [...(near(first) ? [hop(first)] : []), ...pts, ...(pts.length > 1 && near(last) ? [hop(last)] : [])]
  }
  // Fable shares Pofu's sheet and Astra the globe's: a small mark tells them apart
  const opts: CharOpts = { speed: k.speed, tired: k.fat, mark: markOf(mascotFor(w, false)) }
  const fig = (state: CharState, o: CharOpts = {}, where: Pt = sit) => drawCharacter(kind, state, where[0], where[1], size, { ...opts, ...o })
  const fx: Fx | undefined = k.sc.fx.get(w.id)
  let bootAt: number | undefined
  let seatedFrom: number | undefined
  let seatedUntil: number | undefined
  let words = ''
  // —— its activity (0.9): props on the desk top, the figure's state and body motion ——
  const g = DESK_GEOM[L.variant]
  const deskTop = n2(seat[1] - (g.deskTop + g.seatDrop - g.slab.y) * L.deskScale)
  const act = actLayers(k, w, kind, size, sit, deskTop, cell.box.y + 1)
  // a bubble over the head stands clear of a prop on it (an idea bulb, a brain, confetti) where its desk has
  // the room; else it covers the prop (it never climbs over the desk row above)
  const bubbleY = (where: Pt): number => {
    const y = where[1] - cb.bodyH - 4 - bubbleH(k.fs)

    return Math.max(cell.box.y + 1, act?.headTop !== undefined && where === sit ? Math.min(y, act.headTop - bubbleH(k.fs) - 2) : y)
  }
  const say = (text: string, tone: Tone = 'light', shape: Shape = 'say', where: Pt = sit) =>
    bubble(text, where[0], bubbleY(where), Math.max(cell.box.w - 4, k.fs * 12), where[0], 2, L.SW - 2, tone, shape, k.fs)

  // —— the arrival: in through the door, along the aisles to the desk, a wave, a hello ——
  const arrStart = vStart(w.joinedAt)
  const toDesk = route(L, L.door, seat)
  const walkDur = Math.max(1400, Math.min(4500, walkMs(pathLen(toDesk), k.speed)))
  const inKey = `${w.id}|in|${w.joinedAt}`
  const inWalk = live && (now < arrStart + 400 + walkDur + 2500 || walkKept(inKey)) ? keptWalk(inKey, { pts: toDesk, t0: arrStart + 400, dur: walkDur }, L, k.speed, w.tools > 0 ? vStart(w.since) : undefined) : undefined
  const arrEnd = inWalk ? inWalk.t0 + inWalk.dur : arrStart + 400 + walkDur
  const arriving = live && now < arrEnd + 2500
  if (arriving && inWalk) {
    if (now < arrEnd) {
      k.walkers.push(walker({ kind, size, pts: standing(inWalk.pts), t0: inWalk.t0, dur: inWalk.dur, holdFrom: inWalk.turned ? now : arrStart, stay: 0, speed: k.speed, tired: k.fat, shadow: !k.lite }))
      if (!inWalk.turned) k.doorAt.push(arrStart)
      seatedFrom = arrEnd
      bootAt = arrEnd
    }
    words += during(arrEnd - now, arrEnd + 2500 - now, say(pick(HELLOS, w.id)))
  }

  // —— a walk to a new desk the move tracker planned ——
  const move = live && !arriving ? k.input.moves?.get(w.id) : undefined
  if (move && move.kind === 'repack' && now < move.at + move.dur) {
    const home = visitHome(w.id, L)
    const to = move.pts[move.pts.length - 1] as Pt
    if (home && Math.hypot(home.at[0] - to[0], home.at[1] - to[1]) <= 2 && home.end > move.at - 30_000) {
      // a visit to the boss's desk walked it back to this desk already (the tracker did not see it go)
      seatedFrom = home.end
    } else {
      k.walkers.push(walker({ kind, size, pts: standing(standing(move.pts, seat), move.pts[0] as Pt), t0: move.at, dur: move.dur, holdFrom: now, stay: 0, speed: k.speed, tired: k.fat, shadow: !k.lite }))
      seatedFrom = move.at + move.dur
      if (live) {
        if (SEEN_MOVES.size > 100) for (const [id, m] of SEEN_MOVES) if (m.t0 + m.dur < now - 60_000) SEEN_MOVES.delete(id)
        SEEN_MOVES.set(w.id, { pts: move.pts.map(p => [p[0] * L.s, p[1] * L.s] as Pt), t0: move.at, dur: move.dur, s: L.s })
      }
    }
    bootAt = seatedFrom
    // its old desk packs up as it stands up
    const from = move.pts[0] as Pt
    const old = L.cells.find(cl => Math.hypot(cl.seat[0] - from[0], cl.seat[1] - from[1]) < 2)
    if (old && old.i !== cell.i) ghostDesk(k, w, old, move.at)
  }

  // —— out of the chair: coffee after a finished job, the sofa or a wander while it waits ——
  let away = ''
  let awayTrack = ''
  if (slots.coffee >= 0 && w.endedAt !== undefined && k.motion) {
    const plan: Plan = { t0: vStart(w.endedAt) + COFFEE_AFTER, pts: route(L, seat, coffeeSpot(k, slots.coffee)), dur: 0 }
    plan.dur = walkMs(pathLen(plan.pts), k.speed)
    if (k.settled) {
      away = fig('idle', {}, coffeeSpot(k, slots.coffee)) + nameTag(k, w, coffeeSpot(k, slots.coffee), cb.bodyH)
      seatedUntil = -Infinity
    } else {
      const { pts, t0, dur, turned } = keptWalk(`${w.id}|coffee|${w.endedAt}`, plan, L, k.speed)
      away = walker({ kind, size, pts: standing(pts), t0, dur, holdFrom: turned ? now : t0, stay: Infinity, post: 'idle', speed: k.speed, tired: k.fat, shadow: !k.lite, tag: nameTag(k, w, pts[pts.length - 1] as Pt, cb.bodyH, pts) })
      seatedUntil = turned ? -Infinity : t0
      if (now - (t0 + dur) < 4000) k.brewAt = t0 + dur
    }
  } else if (slots.sofa >= 0 && w.idleSince !== undefined && k.motion) {
    const spot = sofaSpot(k, slots.sofa)
    const plan: Plan = { t0: vStart(w.idleSince) + 1500, pts: route(L, seat, spot), dur: 0 }
    plan.dur = walkMs(pathLen(plan.pts), k.speed)
    if (k.settled) {
      away = fig('idle', {}, spot) + nameTag(k, w, spot, cb.bodyH)
      seatedUntil = -Infinity
    } else {
      const { pts, t0, dur, turned } = keptWalk(`${w.id}|sofa|${w.idleSince}`, plan, L, k.speed)
      away = walker({ kind, size, pts: standing(pts), t0, dur, holdFrom: turned ? now : t0, stay: Infinity, post: 'idle', speed: k.speed, tired: k.fat, shadow: !k.lite, tag: nameTag(k, w, pts[pts.length - 1] as Pt, cb.bodyH, pts) })
      seatedUntil = turned ? -Infinity : t0
    }
  } else if (slots.wander >= 0 && w.idleSince !== undefined && live) {
    // a colleague's desk, the door or just along its own lane (never the coffee spots: those are taken by the coffee-goers)
    // the stops are off the desks: the corridor beside the grid, the door, the grid's far edge (a wanderer
    // never stands in front of a colleague's card)
    const others = k.L.cells.filter(cl => cl.kind === 'desk' && cl.i !== cell.i)
    const mate = others[hash(`${w.id}~mate`) % Math.max(1, others.length)]
    const px = k.L.passes.length ? k.L.passes : [k.L.door[0]]
    const near = Math.min(...px)
    const far = Math.max(...px)
    // (not in front of the door either: its sign and its letter badge stay readable)
    const goals: Pt[] = [[near, (mate ?? cell).lane], [far, cell.lane]]
    const goal = goals[hash(`${w.id}~walk`) % goals.length] as Pt
    const way = route(L, seat, goal)
    const lp = loopWalker(kind, size, standing(way), w.idleSince, WANDER_MS, { speed: k.speed, tired: k.fat, tag: nameTag(k, w, seat, cb.bodyH, way) })
    away = lp.walker
    awayTrack = lp.away
  }
  if (away) k.walkers.push(away)

  // —— the seated figure: its state, the talks' cues, its gates ——
  let seated = act?.main ? act.main.wrap(fig(act.main.state, { ...staggered(w), cropTop: act.main.crop })) : timeline(k, deskPhases(k, w, fig))
  if (act?.ev) {
    const evFig = act.ev.wrap(fig(act.ev.state, staggered(w)))
    seated = live ? except(act.ev.a, act.ev.b, seated) + during(act.ev.a, act.ev.b, evFig) : evFig
  }
  if (live && fx) {
    const swaps: Array<[number, number, string]> = []
    if (fx.wave) swaps.push([fx.wave[0], fx.wave[1], fig('wave')])
    if (fx.read) swaps.push([fx.read[0], fx.read[1], fig('read')])
    for (const [a, b, svg] of swaps) seated = except(a, b, seated) + during(a, b, svg)
    if (fx.jump !== undefined) seated = `<g style="animation:jump .9s ${n2(fx.jump / 1000)}s 1">${seated}</g>`
    if (fx.rise) seated = `<g style="--rh:${n1(-size * 0.25)}px;animation:rise ${n2((fx.rise[1] - fx.rise[0]) / 1000)}s ${n2(fx.rise[0] / 1000)}s 1">${except(fx.rise[0], fx.rise[1], seated)}${during(fx.rise[0], fx.rise[1], fig('wave'))}</g>`
    if (fx.away) seated = except(fx.away[0], fx.away[1], seated)
  }
  // the boss waves at the team in its idle loop: this worker waves back
  if (k.waveBuddy === w.id && live) {
    const a = k.boss.since + ACT_AFTER - now
    const b = k.boss.since + SLEEP_AFTER - now
    const looped = `<g style="animation:bslotx 150s -125s infinite">${seated}</g><g style="opacity:0;animation:bslot 150s -125s infinite">${fig('wave')}</g>`
    seated = except(a, b, seated) + during(a, b, looped)
  }
  if (arriving) {
    // after the walk: one wave, then to work
    const a = arrEnd - now
    seated = except(a, a + 900, seated) + during(a, a + 900, fig('wave'))
    if (a > 0) seated = after(a, seated)
  } else if (seatedFrom !== undefined) {
    seated = after(seatedFrom - now, seated)
  }
  if (seatedUntil !== undefined) seated = seatedUntil === -Infinity ? '' : until(seatedUntil - now, seated)
  if (awayTrack) seated = `<g>${awayTrack}${seated}</g>`
  // the props go through the seated figure's gates: not before it sits down, not while it is away
  const gateProps = (svg: string): string => {
    if (!svg || awayTrack || seatedUntil === -Infinity) return ''
    let out = svg
    if (live && fx?.rise) out = except(fx.rise[0], fx.rise[1], out)
    if (live && fx?.away) out = except(fx.away[0], fx.away[1], out)
    if (arriving) {
      if (arrEnd - now > 0) out = after(arrEnd - now, out)
    } else if (seatedFrom !== undefined) {
      out = after(seatedFrom - now, out)
    }
    if (seatedUntil !== undefined) out = until(seatedUntil - now, out)

    return out
  }
  const props = actProps(k, act)
  const propsBack = gateProps(props.back)
  const propsFront = gateProps(props.front)
  // name plates keep off its props
  if (propsBack || propsFront) for (const b of act?.boxes ?? []) P.noteBox(b)

  // —— its bubble: a thought, an approval asked, an error, or news for five seconds ——
  const thinking = w.activity === 'thinking' || w.activity === 'planning'
  let text = ''
  let tone: Tone = 'light'
  let shape: Shape = 'say'
  let lasting = false
  if (thinking) {
    text = w.detail && w.bubble ? w.bubble : '…'
    shape = 'think'
    lasting = true
  } else if (w.activity === 'waiting') {
    text = w.bubble || 'Onay bekliyorum'
    tone = 'warn'
    lasting = true
  } else if (w.activity === 'failed') {
    text = w.bubble || 'Bir sorun çıktı…'
    lasting = true
  } else if (fresh(k, w) && !arriving) {
    text = w.bubble
    shape = w.activity === 'messaging' ? 'mail' : 'say'
  }
  const atDesk = seatedUntil === undefined && !awayTrack
  // where the bubble would sit: one that covers a lasting bubble already drawn is left out (the monitor
  // and the card still tell it)
  const bw = Math.min(Math.max(cell.box.w - 4, k.fs * 12), text.length * k.fs * 0.555 + (16 * k.fs) / 8.2)
  const spot: Box = { x: Math.max(2, Math.min(L.SW - 2 - bw, sit[0] - bw / 2)), y: bubbleY(sit), w: bw, h: bubbleH(k.fs) }
  const crowded = k.placed.some(o => spot.x < o.x + o.w + 1 && o.x < spot.x + spot.w + 1 && spot.y < o.y + o.h + 1 && o.y < spot.y + spot.h + 1)
  if (text && atDesk && !crowded) {
    if (lasting) k.placed.push(spot)
    const b = say(text, tone, shape)
    const shown = lasting ? b : until(vStart(w.since) + 5000 - now, b)
    words += seatedFrom !== undefined ? after(seatedFrom - now, shown) : shown
    if (fx?.rise) words = except(fx.rise[0], fx.rise[1], words)
  }
  k.bubbles.push(words)

  const d = deskData(k, w, { bootAt })
  const tip = k.lite ? '' : `<title>${esc(deskTip(w, d.state))}</title>`
  // desk's back, the props behind, the figure, the desk's front, the props in front (on the desk top)
  const full = `${framed(k, cell.box, (b, fc) => P.deskBack(b, L.variant, d, fc))}${propsBack}${seated}${framed(k, cell.box, (b, fc) => P.deskFront(b, L.variant, d, fc))}${propsFront}`
  if (live && bootAt !== undefined && bootAt > now) {
    // the desk stands empty until its worker sits down; then it is set up: the screen lights up
    const empty = framed(k, cell.box, (b, fc) => P.deskBack(b, L.variant, null, fc) + P.deskFront(b, L.variant, null, fc))

    return `<g>${tip}${until(bootAt - now, empty)}${after(bootAt - now, full + bootFlash(k, cell, bootAt))}</g>`
  }

  return `<g>${tip}${full}</g>`
}

/** The light a monitor gives when it is switched on (at `at`, wall clock). */
function bootFlash(k: K, cell: Cell, at: number): string {
  if (k.lite) return ''
  return framed(k, cell.box, fb => {
    const m = deskModuleBox(fb, k.L.variant)
    const g = DESK_GEOM[k.L.variant].monitor
    const sc: Box = { x: m.x + g.x + g.w * 0.06, y: m.y + g.y + g.h * 0.07, w: g.w * 0.88, h: g.h * 0.84 * 0.86 }

    return `<rect x="${n1(sc.x)}" y="${n1(sc.y)}" width="${n1(sc.w)}" height="${n1(sc.h)}" fill="#E0F2FE" style="animation:fade 1.2s ${n2((at - k.now) / 1000)}s 1 forwards"/>`
  })
}

function deskTip(w: Worker, state: string = activityLabel(w)): string {
  const effort = effortWord(w.effort)

  return `${w.name} — ${state}${w.model ? ` · ${modelLabel(w.model, w.via)}` : ''}${effort ? ` · ${effort} efor` : ''}`
}

/**
 * A worker's things on a desk it is leaving (the desk itself is drawn again under them): they fold
 * away from `packAt` (wall clock). `sit` is the worker still seated there until it stands up.
 */
function ghostDesk(k: K, w: Worker, cell: Cell, packAt: number, sit?: { until: number; svg: string }): void {
  const seated = sit && k.now < sit.until ? until(sit.until - k.now, sit.svg) : ''
  // the things are folded away (or lite draws none): the worker still sits there until it stands up
  if (k.now > packAt + 900 || k.lite) {
    if (seated) k.walkers.push(seated)
    return
  }
  const d = deskData(k, w)
  const fold = (inner: string) => `<g class="fbb" style="animation:fold .8s ${n2((packAt - k.now) / 1000)}s 1 both">${inner}</g>`
  k.ghosts.push(until(Math.max(packAt, sit?.until ?? 0) + 900 - k.now, `<g>${fold(framed(k, cell.box, (b, fc) => P.deskBack(b, k.L.variant, d, fc)))}${seated}${fold(framed(k, cell.box, (b, fc) => P.deskFront(b, k.L.variant, d, fc)))}</g>`))
}

/** A worker leaving: its desk packs up, it waves, walks to the door and is gone. */
function leaver(k: K, w: Worker, coffeeAt: Pt): void {
  if (!k.live) return
  const { L, now } = k
  const kind = charKindOf(mascotFor(w, false))
  const size = L.charSize
  const vs = vStart(w.since)
  const fromCoffee = w.endedAt !== undefined && w.since - w.endedAt >= COFFEE_AFTER + 4000
  const seat: Pt = L.leavers.get(w.id) ?? L.door
  // still on its way to another desk when it left (the layout's spot is that desk): it leaves from where it is
  const mv = SEEN_MOVES.get(w.id)
  const onWay = mv && mv.s === L.s && now < mv.t0 + mv.dur ? (now <= mv.t0 ? (mv.pts[0] as Pt) : along(mv.pts, (now - mv.t0) / mv.dur)).map(v => v / L.s) as Pt : undefined
  const from: Pt = fromCoffee ? coffeeAt : onWay ?? seat
  // §4.3: the desk packs up (0–1.2 s) while it stands and waves (0–0.9 s), then the walk, then 0.4 s fading at the door
  const waveAt = vs
  const plan = route(L, from, L.door)
  const out = keptWalk(`${w.id}|out|${w.since}`, { pts: plan, t0: vs + 1200, dur: Math.max(900, Math.min(walkMs(pathLen(plan), k.speed), LEAVE_MS - 1200 - 400)) }, L, k.speed)
  const { pts, t0, dur } = out
  const start = pts[0] as Pt
  if (now >= t0 + dur + 400) return
  // its desk packs up (with the worker still in the chair, unless it is at the coffee or was walking)
  const seated = !fromCoffee && Math.hypot(start[0] - seat[0], start[1] - seat[1]) < 2
  const cell = L.cells.find(cl => Math.hypot(cl.seat[0] - seat[0], cl.seat[1] - seat[1]) < 2)
  // (from the chair it stands up where it sat: the figure drawn seated, higher than its feet's spot)
  const up = seated ? sitLift(k, kind) : 0
  const sitting = seated ? { until: waveAt, svg: drawCharacter(kind, 'idle', seat[0], n2(seat[1] - up), size, { tired: k.fat }) } : undefined
  if (cell && seated) ghostDesk(k, w, cell, vs, sitting)
  else if (sitting && now < waveAt) k.walkers.push(until(waveAt - now, sitting.svg))
  // on its feet with a wave, then out (one that was walking stops where it is and waves)
  k.walkers.push(walker({ kind, size, pts: up >= 0.5 ? [[start[0], n2(start[1] - up)], ...pts] : pts, t0, dur, holdFrom: seated || fromCoffee ? waveAt : Math.min(now, waveAt), pre: 'wave', stay: 400, fadeOut: true, speed: k.speed, tired: k.fat, shadow: !k.lite }))
  const cb = charBox(kind, size)
  const bw = Math.max(80, k.fs * 12)
  if (!k.byes.some(p => Math.abs(p[0] - start[0]) < bw && Math.abs(p[1] - start[1]) < bubbleH(k.fs) * 2)) {
    k.byes.push(start)
    k.bubbles.push(during(waveAt - now, t0 + 600 - now, bubble(pick(BYES, w.id), start[0], start[1] - cb.bodyH - 4 - bubbleH(k.fs), bw, start[0], 2, L.SW - 2, 'light', 'say', k.fs)))
  }
  k.doorAt.push(t0 + dur - 300)
}

// ——— life in the office ———————————————————————————————————————

/** The cat (asleep where the office has rested for five minutes) and the robot vacuum (a pass while the context is compacted). */
function life(k: K): string {
  const { L, now, boss, team } = k
  let out = ''
  // the office empty: no one at work, the boss idle
  const empty = boss.activity === 'idle' && team.every(w => w.endedAt !== undefined || w.activity === 'leaving')
  if (empty && k.motion) {
    const since = Math.max(boss.since, ...team.map(w => w.endedAt ?? 0))
    const at = since + CAT_AFTER
    const sofa = L.cells.find(cl => cl.kind === 'lounge')
    const spot: Pt = sofa ? [sofa.box.x + sofa.box.w * 0.5, sofa.box.y + sofa.box.h - Math.max(10, sofa.box.h * 0.2)] : [L.coffee[0] + L.charSize * 0.6, L.coffee[1]]
    const cat = catAt(k, spot, at)
    out += k.settled ? catAt(k, spot, -Infinity) : now >= at ? cat : after(at - now, cat)
  }
  // the robot vacuum: once across the floor while the boss compacts
  if (k.live && boss.activity === 'compacting') {
    const t0 = vStart(boss.since)
    const z = L.zones.floor
    const y = z.y + z.h - 7
    const vx = n1(z.w - 40)
    if (now - t0 < 12_000) {
      out += during(t0 - now, t0 + 12_000 - now, `<g transform="translate(${n1(z.x + 6)} ${n1(y)})"><g style="--vx:${vx}px;animation:sweep 12s ${n2((t0 - now) / 1000)}s linear 1 both"><title>Robot süpürge</title><ellipse cx="9" cy="3" rx="9" ry="3.6" fill="#3A3934"/><ellipse cx="9" cy="2" rx="7" ry="2.4" fill="#4A4840"/><circle cx="9" cy="1.6" r="1" fill="#8FAE6B" style="animation:pulse 1.6s infinite"/></g></g>`)
    }
  }

  return out
}

/** The office cat, curled up asleep at `spot`; it walks in from the door when it comes (`at`). */
function catAt(k: K, spot: Pt, at: number): string {
  const s = Math.max(0.6, k.L.charSize / 46)
  const body =
    `<ellipse cx="0" cy="${n2(-4 * s)}" rx="${n2(9 * s)}" ry="${n2(4.4 * s)}" fill="#2A2522"/><circle cx="${n2(7 * s)}" cy="${n2(-6 * s)}" r="${n2(3.6 * s)}" fill="#2A2522"/>` +
    `<path d="M${n2(5 * s)} ${n2(-9 * s)} l${n2(1 * s)} ${n2(-3 * s)} l${n2(1.6 * s)} ${n2(2.6 * s)} Z M${n2(8 * s)} ${n2(-9 * s)} l${n2(1.4 * s)} ${n2(-3 * s)} l${n2(1.2 * s)} ${n2(3 * s)} Z" fill="#2A2522"/>` +
    `<path d="M${n2(-8 * s)} ${n2(-3 * s)} q${n2(-5 * s)} ${n2(4 * s)} ${n2(2 * s)} ${n2(4 * s)}" fill="none" stroke="#2A2522" stroke-width="${n2(2 * s)}" stroke-linecap="round"/>` +
    `<path d="M${n2(5.6 * s)} ${n2(-6 * s)} h${n2(1.6 * s)} M${n2(8.4 * s)} ${n2(-6 * s)} h${n2(1.6 * s)}" stroke="#D4A27F" stroke-width=".6"/>` +
    [0, 1].map(i => `<text x="${n2(10 * s)}" y="${n2(-12 * s)}" class="t" font-size="${n2((5 + i * 2) * s)}" font-weight="700" fill="#94A3B8" style="animation:zz 3s ${-i * 1.5}s infinite">z</text>`).join('')
  const walkIn = at !== -Infinity && k.now - at < 4000 && k.live
  const dx = n1(k.L.door[0] - spot[0])
  const inner = walkIn ? `<g style="--cx:${dx}px;animation:catin 4s ${n2((at - k.now) / 1000)}s 1 both">${body}</g>` : body

  return `<g transform="translate(${n1(spot[0])} ${n1(spot[1])})"><title>Ofis kedisi: ofis 5 dakikadır boş</title>${inner}</g>`
}

// ——— the scene alone ———————————————————————————————————————————

/** The activity strips' first ceiling by how hard the picture is squeezed (§5): lite keeps them, then only the boss's and the events', then none. */
export const actCapFor = (squeeze: number): number => (squeeze >= 2 ? 0 : squeeze >= 1 ? 6000 : ACT_CAP)

/**
 * The defs a drawing needs, under the surface's limit (§5). `make(cap)` draws the picture with the activity
 * strips' ceiling `cap` and returns it (`base`) with the marks `<!--ac-->` (activities) and `<!--sp-->`
 * (characters, icons) in its defs and the activity defs (`acts`). The activities may take what the picture
 * and the characters' least (charFloor: a figure never goes missing) leave; where they do not fit, the picture is drawn again with that room as the ceiling, then with none (the
 * least important activities fall back to the figure's own state; a drawn prop always has its symbol). The
 * characters' other states and the icons get the rest (spriteDefs: a state that does not fit shows idle).
 */
/**
 * The least the characters' defs take for a picture (§5), read off its markup: every kind's idle strip (a
 * figure never goes missing) and, for each other state it shows, the stand-in that falls back to idle.
 */
export function charFloor(base: string): number {
  const kinds = new Set<string>()
  const states = new Set<string>()
  for (const m of base.matchAll(/href="#ch-([a-z-]+?)-(idle|walk_sol|walk|wave|work|think|read|wait|done|fail|run)"/g)) {
    kinds.add(m[1] as string)
    if (m[2] !== 'idle') states.add(`${m[1]}-${m[2]}`)
  }
  let est = 300
  for (const kind of kinds) est += (CHAR_SET[kind as CharKind]?.states.idle?.b64.length ?? 1900) + 240

  return est + states.size * 200
}

export function withDefs<T extends { base: string; acts: string }>(make: (cap: number) => T, cap: number): T & { svg: string } {
  let ceiling = Math.max(0, cap)
  for (let i = 0; ; i++) {
    const d = make(ceiling)
    // what the activities may take: what the picture and the characters' least leave
    const room = 126_000 - d.base.length - charFloor(d.base)
    if (d.acts.length <= room || ceiling === 0) {
      const sp = spriteDefs(126_000 - d.base.length - d.acts.length)

      return { ...d, svg: d.base.replace('<!--sp-->', () => sp).replace('<!--ac-->', () => d.acts) }
    }
    // (this drawing's characters are let go: the next one notes its own)
    spriteDefs(0)
    // the ceiling counts the props' markup in the picture too (planActs: ACT_USE_EST a use): what the
    // picture would weigh without them is the room, less a margin
    const uses = (d.base.match(/href="#ac-/g) ?? []).length
    const next = Math.min(ceiling - 1, room + uses * ACT_USE_EST - 400)
    ceiling = i >= 2 || next <= 0 ? 0 : next
  }
}

/**
 * The lighter picture `b` is better than `a` when it fits, shows more of the activities and draws no more
 * figures as plain vector stand-ins: what each one is doing is worth more than the tooltips and the
 * daylight the lite picture leaves out.
 */
export function preferActs(a: { svg: string; dropped: number }, b: { svg: string; dropped: number }): boolean {
  const stand = (svg: string) => (svg.match(/id="cv-/g) ?? []).length

  return b.svg.length <= 128_000 && b.dropped < a.dropped && stand(b.svg) <= stand(a.svg)
}

/** The scene as a document of its own (tests, previews): 960×640 unless told, laid out here. */
export function sceneSvg(input: Omit<SceneInput, 'layout'> & { W?: number; H?: number }): { svg: string; alt: string; height: number } {
  const W = Math.round(input.W ?? 960)
  const H = Math.round(input.H ?? 640)
  const L = layoutOffice({ workers: input.workers, W, H, now: input.now })
  const draw = (lite: boolean, squeeze = 0): { svg: string; alt: string; dropped: number } =>
    withDefs(cap => {
      const parts = sceneParts({ ...input, layout: L }, lite, squeeze, cap)
      const base =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><style>${STYLE}</style><defs>${parts.defs}<!--ac--><!--sp--></defs>` +
        `<rect x="-2" y="-2" width="${W + 4}" height="${H + 4}" fill="${P.palette(input.theme ?? 'dark').floor}"/><g transform="scale(${L.s})"${input.motion ? '' : ' class="still"'}>${parts.body}</g></svg>`

      return { base, acts: parts.acts, dropped: parts.dropped, alt: parts.alt }
    }, actCapFor(squeeze))
  let out = draw(false)
  let lite = false
  for (const squeeze of [-1, 1, 2]) {
    if (out.svg.length <= 128_000) break
    out = draw(true, Math.max(0, squeeze))
    lite = true
  }
  // a crowded office whose full picture leaves no room for the activities: the lite one shows them (preferActs)
  if (!lite && out.dropped > 0) {
    const alt = draw(true)
    if (preferActs(out, alt)) out = alt
  }

  return { svg: phaseLock(out.svg, input.now), alt: out.alt, height: H }
}
