// Claude Ofis 0.7: the pure layout engine. The pane's size and the team give the office's
// topology, scale, desk variant, grid, object boxes and walking routes; the move tracker
// walks a repacked team from its old desks to its new ones. Same input, same output.
import type { Worker } from '../types'
import { FATIGUE_SPEED } from './logic'
import type { Fatigue } from './logic'

export type Pt = [number, number]
export type Box = { x: number; y: number; w: number; h: number }
export type RatioClass = 'cok-genis' | 'genis' | 'kare' | 'uzun' | 'cok-dar'
export type Topo = 'T' | 'Tn' | 'S'
export type DeskVariant = 'full' | 'compact' | 'mini'
export type ObjId =
  | 'sign' | 'clock' | 'calendar' | 'scoreboard' | 'window0' | 'window1' | 'window2' | 'window3'
  | 'whiteboard' | 'cooler' | 'battery' | 'shredder' | 'bookshelf' | 'archive' | 'rack' | 'globe' | 'plant' | 'printer'
export type CellKind = 'desk' | 'free' | 'coffee' | 'lounge' | 'library' | 'archive' | 'rack' | 'meeting' | 'globe' | 'plants'
/** One grid cell in serpentine order; `seat` is where a character's feet stand (ou), `lane` the y of its row's walkway. */
export type Cell = { i: number; col: number; row: number; box: Box; kind: CellKind; seat: Pt; lane: number }
export type LayoutHint = { topo: Topo; s: number; variant: DeskVariant; cols: number; rows: number; score: number; at: number }
export type OfficeLayout = {
  W: number; H: number; s: number; SW: number; SH: number
  cls: RatioClass; topo: Topo; variant: DeskVariant; cols: number; rows: number
  /** how much the desks (and their people) are drawn larger than the module, where the cells have room: 1–1.25 */
  deskScale: number
  charSize: number; bossSize: number
  zones: { wall: Box; ticker: Box; boss: Box; floor: Box; corridor: Box; glass: Box }
  objects: Partial<Record<ObjId, Box>>
  /** serpentine order: row 0 (nearest the boss) left to right, row 1 right to left, … */
  cells: Cell[]
  /** packed worker → cell index */
  seats: ReadonlyMap<string, number>
  /** a leaving worker → where its walk out starts (ou) */
  leavers: ReadonlyMap<string, Pt>
  /** workers past MAX_DESKS: the door's "+N çalışan daha" */
  hidden: number
  door: Pt; doorBox: Box; coffee: Pt
  boss: { desk: Box; throne: Pt; board: Pt; shredder: Pt; window: Pt; front: Pt }
  /** x of the vertical walkways (ascending) */
  passes: number[]
  key: string
}

export const MAX_DESKS = 24
export const ARRIVE_MS = 3200, LEAVE_MS = 6000, MOVE_DELAY_MS = 1200, STAGGER_MS = 350, MAX_CONCURRENT = 6, WAVE_GAP_MS = 2600, WALK_OU_S = 80
/** A newcomer's walk from the door lasts at most this long (0.4 s door + 4.5 s walk): no repack move while it lasts. */
export const ARRIVAL_WINDOW_MS = 4900
/** A finished worker walks to the coffee corner this long after it ends: no repack move from then on. */
export const COFFEE_AFTER_MS = 6000
/** The boss's feet stand this far down the boss desk box (behind the desk top). */
export const BOSS_DESK_TOP = 0.6

type DeskGeom = {
  w: number; h: number; deskTop: number; seatX: number; seatDrop: number; charSize: number
  monitor: Box; card: Box; panel?: Box; slab: Box; front: Box; lane: Box; bubbleY: number
}
const bx = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

/** Desk module geometry (from the module's top-left corner, ou); C draws it, B seats the character at seat. */
export const DESK_GEOM: Readonly<Record<DeskVariant, DeskGeom>> = {
  full: { w: 150, h: 108, deskTop: 64, seatX: 96, seatDrop: 14, charSize: 46, monitor: bx(12, 30, 46, 32), card: bx(70, 72, 58, 14), panel: bx(10, 70, 56, 20), slab: bx(4, 62, 142, 6), front: bx(8, 68, 134, 24), lane: bx(0, 96, 150, 12), bubbleY: 2 },
  compact: { w: 122, h: 90, deskTop: 52, seatX: 78, seatDrop: 11, charSize: 38, monitor: bx(8, 24, 38, 26), card: bx(54, 58, 60, 13), panel: bx(6, 58, 46, 12), slab: bx(3, 50, 116, 5), front: bx(6, 55, 110, 20), lane: bx(0, 80, 122, 10), bubbleY: 2 },
  mini: { w: 94, h: 74, deskTop: 42, seatX: 60, seatDrop: 9, charSize: 30, monitor: bx(6, 22, 26, 18), card: bx(34, 44, 56, 16), slab: bx(2, 40, 90, 4), front: bx(4, 44, 86, 16), lane: bx(0, 64, 94, 10), bubbleY: 1 },
}

// —— constants of the zones (ou) ——
const S_STEPS = [2.5, 2.25, 2, 1.75, 1.5, 1.375, 1.25, 1.125, 1, 0.875, 0.75, 0.625] as const
const WALL1 = 80
const WALL2 = 124
const WALL_ONE_MIN = 430
const BOSS_T = { w: 470, h: 128 }
const BOSS_TN = { w: 300, h: 128 }
const COL_S = { w: 290, h: 292 }
const COL_S_MAX = 380
const CORRIDOR = 30
const PAD_SIDE = 6
const PAD_TOP = 6
const PAD_BOTTOM = 4
const GLASS = 4
const BOSS_LANE = 12
const MIN_CHAR_PX = 28
const STRETCH_W = 1.45
const STRETCH_H = 1.35
// a mini desk has no plate (model, effort): it is taken only where a compact one would be far smaller
const VW: Readonly<Record<DeskVariant, number>> = { full: 1, compact: 0.86, mini: 0.5 }
const VARIANTS: readonly DeskVariant[] = ['full', 'compact', 'mini']
const HYSTERESIS = 1.15
const HOLD_MS = 20_000
const MOVE_TTL_MS = 20_000

const r2 = (v: number): number => Math.round(v * 100) / 100
const rb = (b: Box): Box => ({ x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) })
const rp = (p: Pt): Pt => [r2(p[0]), r2(p[1])]
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The ticker band's height: at least 16 ou, and an 11 px line with room. */
const tickerH = (s: number): number => Math.max(16, 11 / s + 5)

export function ratioClass(r: number): RatioClass {
  return r >= 2.2 ? 'cok-genis' : r >= 1.4 ? 'genis' : r >= 0.85 ? 'kare' : r >= 0.55 ? 'uzun' : 'cok-dar'
}

function prefOf(c: RatioClass): readonly Topo[] {
  return c === 'cok-genis' ? ['S', 'T', 'Tn'] : c === 'genis' ? ['T', 'S', 'Tn'] : c === 'cok-dar' ? ['Tn', 'T', 'S'] : ['T', 'Tn', 'S']
}

/** Text size in ou: the design size, but never under `px` on screen. */
export function fontOu(s: number, px: number, design: number): number {
  return Math.max(design, px / s)
}

/** A desk module's box inside its cell: centred across, resting on the cell's floor (its lane). */
export function deskModuleBox(cell: Box, v: DeskVariant): Box {
  const g = DESK_GEOM[v]

  return { x: cell.x + (cell.w - g.w) / 2, y: cell.y + cell.h - g.h, w: g.w, h: g.h }
}

/** The largest a desk is drawn: its people stay smaller than the boss (1.3 × the module's character). */
const DESK_SCALE_MAX = 1.25

/**
 * How much larger than its module a desk is drawn in a cell of cw × ch: as the cell's slack allows
 * (a little air kept around it), in steps of 0.05, between 1 and 1.25. A roomy office (few people, a
 * large pane) gets larger desks and people instead of empty floor.
 */
export function deskScaleFor(cw: number, ch: number, v: DeskVariant): number {
  const g = DESK_GEOM[v]
  const raw = Math.min(cw / (g.w * 1.06), ch / (g.h * 1.03), DESK_SCALE_MAX)

  return Math.max(1, Math.floor(raw * 20 + 1e-9) / 20)
}

/**
 * A desk drawn `dk` times its size in its cell, scaled about the cell's bottom middle (its floor):
 * `box` is the cell as the unscaled drawing sees it (deskModuleBox, DESK_GEOM work in it as usual),
 * `tf` the transform that puts that drawing in place ('' at 1), `map` a point of it to the office.
 */
export function deskFrame(cell: Box, dk: number): { box: Box; tf: string; map: (p: Pt) => Pt } {
  const ax = cell.x + cell.w / 2
  const ay = cell.y + cell.h
  if (dk === 1) return { box: cell, tf: '', map: p => p }
  const box = { x: ax - cell.w / (2 * dk), y: ay - cell.h / dk, w: cell.w / dk, h: cell.h / dk }
  const r = (v: number) => Math.round(v * 100) / 100

  return { box, tf: `matrix(${dk} 0 0 ${dk} ${r(ax * (1 - dk))} ${r(ay * (1 - dk))})`, map: p => [ax + (p[0] - ax) * dk, ay + (p[1] - ay) * dk] }
}

/** The corridor beside the desks: as wide as a person at that desk size needs to pass the door. */
const corrW = (v: DeskVariant): number => (v === 'full' ? 44 : v === 'compact' ? 38 : 32)

/** The team in desk order: not the boss, not on its way out, by hire time; the first MAX_DESKS. */
export function packOrder(workers: readonly Worker[]): Worker[] {
  return sortedTeam(workers).slice(0, MAX_DESKS)
}

function sortedTeam(workers: readonly Worker[]): Worker[] {
  return workers
    .filter(w => w.id !== 'boss' && w.activity !== 'leaving')
    .slice()
    .sort((a, b) => a.joinedAt - b.joinedAt || a.n - b.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Where the boss stands for what it does: the whiteboard when planning, the shredder when compacting. */
export function bossSpotFor(boss: Worker | undefined): 'throne' | 'board' | 'shredder' {
  if (boss?.activity === 'planning') return 'board'
  if (boss?.activity === 'compacting') return 'shredder'

  return 'throne'
}

// —— choosing the topology, scale and desk ——

type Base = { wallH: number; bossH: number; colW: number; floor: Box }

/** The zones at their base sizes, if they fit the scene at all. */
function compose(t: Topo, SW: number, SH: number, s: number): Base | undefined {
  const tk = tickerH(s)
  if (t === 'T') {
    if (SW < BOSS_T.w) return undefined
    const top = WALL1 + tk + BOSS_T.h
    if (SH - top <= PAD_TOP + PAD_BOTTOM) return undefined

    return { wallH: WALL1, bossH: BOSS_T.h, colW: 0, floor: { x: 0, y: top, w: SW, h: SH - top } }
  }
  if (t === 'Tn') {
    if (SW < BOSS_TN.w) return undefined
    const wall = SW >= WALL_ONE_MIN ? WALL1 : WALL2
    const top = wall + tk + BOSS_TN.h
    if (SH - top <= PAD_TOP + PAD_BOTTOM) return undefined

    return { wallH: wall, bossH: BOSS_TN.h, colW: 0, floor: { x: 0, y: top, w: SW, h: SH - top } }
  }
  if (SH < WALL1 + tk + COL_S.h) return undefined
  if (SW - COL_S.w < CORRIDOR + PAD_SIDE + DESK_GEOM.mini.w) return undefined

  return { wallH: WALL1, bossH: 0, colW: COL_S.w, floor: { x: COL_S.w, y: WALL1 + tk, w: SW - COL_S.w, h: SH - WALL1 - tk } }
}

type Grid = { c: number; r: number; score: number }

/** The best grid of `cells` modules on the floor: few empty cells, cells shaped like the module, little stretch. */
function fitGrid(floor: Box, cells: number, v: DeskVariant): Grid | undefined {
  const m = DESK_GEOM[v]
  const aw = floor.w - CORRIDOR - PAD_SIDE
  const ah = floor.h - PAD_TOP - PAD_BOTTOM
  let best: Grid | undefined
  for (let c = 1; c <= Math.min(cells, Math.floor(aw / m.w)); c++) {
    const r = Math.ceil(cells / c)
    if (r * m.h > ah) continue
    const cw = aw / c
    const ch = ah / r
    const free = c * r - cells
    const stretch = Math.max(0, cw / m.w - STRETCH_W) + Math.max(0, ch / m.h - STRETCH_H)
    const score = free * 3 + Math.abs(cw / ch - m.w / m.h) + stretch * 2
    if (!best || score < best.score - 1e-9) best = { c, r, score }
  }

  return best
}

type Cand = { topo: Topo; v: DeskVariant; s: number; c: number; r: number; score: number; fixed: boolean }

function candScore(topo: Topo, v: DeskVariant, s: number, cls: RatioClass): number {
  return s * VW[v] * (topo === prefOf(cls)[0] ? 1.12 : 1)
}

function search(W: number, H: number, cells: number, cls: RatioClass): Cand {
  const pref = prefOf(cls)
  let best: Cand | undefined
  for (const topo of pref) {
    for (const v of VARIANTS) {
      for (const s of S_STEPS) {
        if (DESK_GEOM[v].charSize * s < MIN_CHAR_PX) break
        const z = compose(topo, W / s, H / s, s)
        if (!z) continue
        const g = fitGrid(z.floor, cells, v)
        if (!g) continue
        const score = candScore(topo, v, s, cls)
        if (!best || score > best.score + 1e-9) best = { topo, v, s, c: g.c, r: g.r, score, fixed: false }
        break
      }
    }
  }
  if (best) return best
  // a very small pane: mini desks on the narrow block, the scale stepping down until it fits
  for (let k = 0; k < 400; k++) {
    const s = Math.round((0.6 - k * 0.025) * 1000) / 1000
    if (s <= 0.02) break
    const z = compose('Tn', W / s, H / s, s)
    if (!z) continue
    const g = fitGrid(z.floor, cells, 'mini')
    if (!g) continue

    return { topo: 'Tn', v: 'mini', s, c: g.c, r: g.r, score: 0, fixed: false }
  }
  // nothing fits even so (a pane of a few pixels): the smallest scale, one column
  const s = 0.025

  return { topo: 'Tn', v: 'mini', s, c: 1, r: cells, score: 0, fixed: false }
}

/** The hinted layout, if it still holds `cells` and is readable. */
function fromHint(h: LayoutHint, W: number, H: number, cells: number): Cand | undefined {
  const z = compose(h.topo, W / h.s, H / h.s, h.s)
  if (!z) return undefined
  const m = DESK_GEOM[h.variant]
  if (!m) return undefined
  const aw = z.floor.w - CORRIDOR - PAD_SIDE
  const ah = z.floor.h - PAD_TOP - PAD_BOTTOM
  if (h.cols < 1 || h.rows < 1 || h.cols * h.rows < cells) return undefined
  if (h.cols * m.w > aw + 1e-6 || h.rows * m.h > ah + 1e-6) return undefined
  if (h.s >= 0.625 && m.charSize * h.s < MIN_CHAR_PX) return undefined

  return { topo: h.topo, v: h.variant, s: h.s, c: h.cols, r: h.rows, score: h.score, fixed: true }
}

// —— the wall, the boss zone and the floor ——

type Placed = Partial<Record<ObjId, Box>>

/** Lays out boxes left to right in [x0, x1], the slack spread evenly between and around them. */
function spread(items: ReadonlyArray<{ id: ObjId; w: number; h: number }>, x0: number, x1: number, yBottom: number, out: Placed): void {
  if (items.length === 0) return
  const sum = items.reduce((a, it) => a + it.w, 0)
  const gap = Math.max(0, (x1 - x0 - sum) / (items.length + 1))
  let x = x0 + gap
  for (const it of items) {
    out[it.id] = { x, y: yBottom - it.h, w: it.w, h: it.h }
    x += it.w + gap
  }
}

/** One wall row: sign, windows, clock, windows, scoreboard; the windows take what is left. */
function wallRow(wall: Box, y: number, h: number, out: Placed, withScore: boolean): void {
  const m = 6
  const inner = wall.w - 2 * m
  const gap = 6
  let sign = 136
  let score = withScore ? 156 : 0
  const clock = Math.round(h) + 30
  const fixedGaps = (withScore ? 3 : 2) * gap
  const minWin = 56
  let rem = inner - sign - score - clock - fixedGaps
  if (rem < minWin) {
    // a narrow wall: the sign and the scoreboard give way first
    const need = minWin - rem
    const give = Math.min(need, sign - 96 + (withScore ? score - 112 : 0))
    const signGive = withScore ? give * ((sign - 96) / Math.max(1, sign - 96 + score - 112)) : give
    sign -= signGive
    score -= give - signGive
    rem = inner - sign - score - clock - fixedGaps
  }
  const wins = clamp(Math.floor(rem / 140), 1, 4)
  let ww = Math.max(24, Math.min(260, (rem - (wins - 1) * gap) / wins))
  // a long wall: the sign, the scoreboard and the windows grow before the gaps do
  let spare = rem - wins * ww - (wins - 1) * gap
  if (spare > 0) {
    const sg = Math.min(spare / 3, 64)
    sign += sg
    spare -= sg
    if (withScore) {
      const sc = Math.min(spare / 2, 84)
      score += sc
      spare -= sc
    }
    ww = Math.min(360, ww + spare / wins)
  }
  const left = Math.ceil(wins / 2)
  const items: Array<{ id: ObjId; w: number }> = [{ id: 'sign', w: sign }]
  for (let i = 0; i < left; i++) items.push({ id: `window${i}` as ObjId, w: ww })
  items.push({ id: 'clock', w: clock })
  for (let i = left; i < wins; i++) items.push({ id: `window${i}` as ObjId, w: ww })
  if (withScore) items.push({ id: 'scoreboard', w: score })
  const sum = items.reduce((a, it) => a + it.w, 0)
  const g = Math.max(0, (inner - sum) / Math.max(1, items.length - 1))
  let x = wall.x + m
  for (const it of items) {
    out[it.id] = { x, y, w: it.w, h }
    x += it.w + g
  }
}

/** The two-storey wall of a narrow office: sign, clock and a window above; whiteboard, calendar and scoreboard below. */
function wallTwo(wall: Box, out: Placed): void {
  const m = 6
  const inner = wall.w - 2 * m
  const h1 = (wall.h - 18) * 0.46
  const h2 = wall.h - 18 - h1
  const y1 = wall.y + 6
  const y2 = y1 + h1 + 6
  const sign = Math.min(136, inner * 0.4)
  const clock = h1
  const win = Math.max(24, inner - sign - clock - 12)
  let x = wall.x + m
  out.sign = { x, y: y1, w: sign, h: h1 }
  x += sign + 6
  out.window0 = { x, y: y1, w: win, h: h1 }
  x += win + 6
  out.clock = { x, y: y1, w: clock, h: h1 }
  const wb = inner * 0.42
  const cal = Math.max(40, inner * 0.17)
  const sc = inner - wb - cal - 12
  x = wall.x + m
  out.whiteboard = { x, y: y2, w: wb, h: h2 }
  x += wb + 6
  out.calendar = { x, y: y2, w: cal, h: h2 }
  x += cal + 6
  out.scoreboard = { x, y: y2, w: sc, h: h2 }
}

const EXTRAS: ReadonlyArray<{ id: ObjId; w: number; hMax: number }> = [
  { id: 'bookshelf', w: 48, hMax: Infinity },
  { id: 'archive', w: 36, hMax: 84 },
  { id: 'rack', w: 34, hMax: Infinity },
  { id: 'globe', w: 30, hMax: 64 },
  { id: 'printer', w: 40, hMax: 52 },
  { id: 'plant', w: 24, hMax: 72 },
]

/** The boss strip across the office (T, Tn): whiteboard and cooler, the boss desk, battery and shredder, extras as room allows. */
function bossStrip(zone: Box, withWb: boolean, out: Placed): Box {
  const m = 4
  const gap = 4
  const inner = zone.w - 2 * m
  const y0 = zone.y + 4
  const hMax = zone.h - 4 - GLASS - BOSS_LANE
  const bottom = y0 + hMax
  const hk = clamp(zone.h / BOSS_T.h, 1, 1.4)
  let wb = withWb ? 130 * hk : 0
  let cooler = 34
  let desk = 216 * hk
  let battery = 44
  let shredder = 26
  const count = withWb ? 5 : 4
  const fixed = () => wb + cooler + desk + battery + shredder + (count + 1) * gap
  // a tight strip: the desk and the whiteboard give way first, then the cooler, the battery, the shredder
  if (fixed() > inner) desk = Math.max(180, desk - (fixed() - inner))
  if (fixed() > inner && withWb) wb = Math.max(100, wb - (fixed() - inner))
  if (fixed() > inner) cooler = Math.max(28, cooler - (fixed() - inner))
  if (fixed() > inner) battery = Math.max(38, battery - (fixed() - inner))
  if (fixed() > inner) shredder = Math.max(22, shredder - (fixed() - inner))
  if (fixed() > inner) desk = Math.max(120, desk - (fixed() - inner))
  // the left wing reads outward from the desk: cooler, whiteboard; the right: battery, shredder
  const leftW: Array<{ id: ObjId; w: number; h: number }> = [{ id: 'cooler', w: cooler, h: hMax }]
  if (withWb) leftW.push({ id: 'whiteboard', w: wb, h: hMax })
  const rightW: Array<{ id: ObjId; w: number; h: number }> = [
    { id: 'battery', w: battery, h: hMax },
    { id: 'shredder', w: shredder, h: Math.min(hMax, 64) },
  ]
  let room = inner - fixed()
  for (const ex of EXTRAS) {
    if (room < ex.w + gap) continue
    const it = { id: ex.id, w: ex.w, h: Math.min(hMax, ex.hMax) }
    const lsum = leftW.reduce((a, x) => a + x.w, 0)
    const rsum = rightW.reduce((a, x) => a + x.w, 0)
    if (ex.id === 'printer') rightW.unshift(it)
    else if (lsum <= rsum) leftW.push(it)
    else rightW.push(it)
    room -= ex.w + gap
  }
  const left = leftW.slice().reverse()
  const lsum = left.reduce((a, x) => a + x.w, 0) + left.length * gap
  const rsum = rightW.reduce((a, x) => a + x.w, 0) + rightW.length * gap
  // the desk in the middle when both wings fit beside it, else pushed aside
  let dx = zone.x + zone.w / 2 - desk / 2
  if (dx - (zone.x + m) < lsum) dx = zone.x + m + lsum
  if (zone.x + zone.w - m - (dx + desk) < rsum) dx = Math.max(zone.x + m + lsum, zone.x + zone.w - m - rsum - desk)
  spread(left, zone.x + m, dx, bottom, out)
  spread(rightW, dx + desk, zone.x + zone.w - m, bottom, out)

  return { x: dx, y: y0, w: desk, h: hMax }
}

/** The boss column of a very wide office (S): the boss desk, the whiteboard, and a row of cooler, battery, shredder, bookshelf. */
function bossColumn(zone: Box, out: Placed): Box {
  const m = 6
  const laneRoom = 20
  const w = zone.w - m - GLASS - laneRoom
  const y0 = zone.y + 4
  // the desk, the whiteboard and the row share the column's height as 132 : 76 : 84
  const avail = zone.h - 8 - 8
  const dh = (avail * 132) / COL_S.h
  const wh = (avail * 76) / COL_S.h
  const rh = avail - dh - wh
  const desk = { x: zone.x + m, y: y0, w, h: dh }
  out.whiteboard = { x: zone.x + m, y: y0 + dh + 4, w, h: wh }
  const rowY = y0 + dh + 4 + wh + 4
  const bottom = rowY + rh
  const row: Array<{ id: ObjId; w: number; h: number }> = [
    { id: 'cooler', w: 34, h: rh },
    { id: 'battery', w: 44, h: rh },
    { id: 'shredder', w: 26, h: Math.min(rh, 64) },
    { id: 'bookshelf', w: 48, h: rh },
  ]
  let room = w - row.reduce((a, x) => a + x.w, 0) - (row.length + 1) * 4
  for (const ex of EXTRAS) {
    if (ex.id === 'bookshelf' || room < ex.w + 4) continue
    row.push({ id: ex.id, w: ex.w, h: Math.min(rh, ex.hMax) })
    room -= ex.w + 4
  }
  spread(row, zone.x + m, zone.x + m + w, bottom, out)

  return desk
}

const FILLER_ORDER: ReadonlyArray<{ kind: CellKind; obj?: ObjId }> = [
  { kind: 'lounge' },
  { kind: 'library', obj: 'bookshelf' },
  { kind: 'archive', obj: 'archive' },
  { kind: 'rack', obj: 'rack' },
  { kind: 'meeting' },
  { kind: 'globe', obj: 'globe' },
  { kind: 'plants', obj: 'plant' },
]

// what is left over once every data object has its cell: corners that still show a figure (the
// plants grow with the turns, the sofa holds who waits, the table counts the messages)
const SPARE: readonly CellKind[] = ['plants', 'lounge', 'meeting']

/**
 * What the cells between the desks and the coffee corner hold: the data objects the boss zone had
 * no room for, then spare data corners. No empty "ready desk": every cell shows something (a new
 * worker's desk takes the first of these cells, the grid has room without a placeholder).
 */
function fillerKinds(slots: number, _n: number, placed: Placed): CellKind[] {
  const out: CellKind[] = []
  for (const f of FILLER_ORDER) {
    if (out.length >= slots) break
    if (f.obj && placed[f.obj]) continue
    out.push(f.kind)
  }
  for (let i = 0; out.length < slots; i++) out.push(SPARE[i % SPARE.length] as CellKind)

  return out
}

// —— the layout ——

/**
 * The office for a pane of W × H pixels and this team. A hint (the last layout) is kept while it
 * still holds the team and nothing is clearly better, and for 20 s after it last changed;
 * `spotsPx` (the move tracker's last positions, px) says where a leaving worker starts its walk out.
 */
export function layoutOffice(a: { workers: readonly Worker[]; W: number; H: number; hint?: LayoutHint; now?: number; spotsPx?: Readonly<Record<string, Pt>> }): OfficeLayout {
  const W = Math.max(1, a.W)
  const H = Math.max(1, a.H)
  const team = sortedTeam(a.workers)
  const packed = team.slice(0, MAX_DESKS)
  const N = packed.length
  const cells0 = N === 0 ? 3 : N + 1
  const cls = ratioClass(W / H)
  const best = search(W, H, cells0, cls)
  let cand = best
  if (a.hint) {
    const held = fromHint(a.hint, W, H, cells0)
    const elapsed = a.now === undefined ? Infinity : a.now - a.hint.at
    // the same scale and desks on a grid with fewer empty cells (people left): after the hold the grid
    // is rebuilt for the team that stays, so no row of ready desks is left between them and the coffee
    const tidier = held !== undefined && best.topo === held.topo && best.s === held.s && best.v === held.v && best.c * best.r < held.c * held.r
    if (held && (elapsed < HOLD_MS || (best.score < a.hint.score * HYSTERESIS && !tidier))) cand = held
  }

  return build(cand, W, H, cls, a.workers, packed, team.length - packed.length, a.spotsPx)
}

function build(cand: Cand, W: number, H: number, cls: RatioClass, workers: readonly Worker[], packed: readonly Worker[], hidden: number, spotsPx?: Readonly<Record<string, Pt>>): OfficeLayout {
  const { topo, v, s } = cand
  const SW = W / s
  const SH = H / s
  const tick = tickerH(s)
  const g = DESK_GEOM[v]
  const N = packed.length
  const twoFloor = topo === 'Tn' && SW < WALL_ONE_MIN
  const wallBase = twoFloor ? WALL2 : WALL1
  const bossBase = topo === 'S' ? 0 : BOSS_T.h
  let colW = topo === 'S' ? COL_S.w : 0
  let aw = (topo === 'S' ? SW - colW : SW) - CORRIDOR - PAD_SIDE
  let c = cand.c
  const r = cand.r
  // across: more columns while the cells stretch too wide (the new cells become fillers)
  if (!cand.fixed) while (aw / c > STRETCH_W * g.w && (c + 1) * g.w <= aw) c++
  if (topo === 'S') {
    const excess = aw - c * STRETCH_W * g.w
    if (excess > 0) {
      const grow = Math.min(COL_S_MAX - COL_S.w, excess)
      colW += grow
      aw -= grow
    }
  }
  // down: the cells first (to 1.35 × the module), then the wall and the boss zone, then the cells again
  let wallH = wallBase
  let bossH = bossBase
  const floorH0 = SH - wallBase - tick - bossBase
  let slack = Math.max(0, floorH0 - PAD_TOP - PAD_BOTTOM - r * g.h)
  slack -= Math.min(slack, r * (STRETCH_H - 1) * g.h)
  if (slack > 0) {
    if (topo === 'S') {
      const keep = Math.max(0, SH - wallBase - tick - COL_S.h)
      wallH += Math.max(0, Math.min(slack, 0.5 * wallBase, keep))
    } else {
      const wa = Math.min(0.45 * slack, 0.5 * wallBase)
      const ba = Math.min(0.55 * slack, 0.4 * bossBase)
      wallH += wa
      bossH += ba
    }
  }

  // zones
  const wall: Box = { x: 0, y: 0, w: SW, h: wallH }
  const ticker: Box = { x: 0, y: wallH, w: SW, h: tick }
  const top = wallH + tick
  let boss: Box, floor: Box, glass: Box, corridor: Box, grid: Box
  if (topo === 'S') {
    boss = { x: 0, y: top, w: colW, h: SH - top }
    glass = { x: colW - GLASS, y: top, w: GLASS, h: SH - top }
    floor = { x: colW, y: top, w: SW - colW, h: SH - top }
    corridor = { x: SW - CORRIDOR, y: top, w: CORRIDOR, h: floor.h }
    grid = { x: colW + PAD_SIDE, y: top + PAD_TOP, w: aw, h: floor.h - PAD_TOP - PAD_BOTTOM }
  } else {
    boss = { x: 0, y: top, w: SW, h: bossH }
    glass = { x: 0, y: top + bossH - GLASS, w: SW, h: GLASS }
    floor = { x: 0, y: top + bossH, w: SW, h: SH - top - bossH }
    corridor = { x: 0, y: floor.y, w: CORRIDOR, h: floor.h }
    grid = { x: CORRIDOR, y: floor.y + PAD_TOP, w: aw, h: floor.h - PAD_TOP - PAD_BOTTOM }
  }

  // objects
  const objects: Placed = {}
  if (twoFloor) wallTwo(wall, objects)
  else wallRow(wall, wall.y + 6, wall.h - 12, objects, true)
  const desk = topo === 'S' ? bossColumn(boss, objects) : bossStrip(boss, !twoFloor, objects)

  // the grid, in serpentine order
  const cw = grid.w / c
  const ch = grid.h / r
  // a roomy grid (few people, a large pane): the desks and their people are drawn larger
  const dk = deskScaleFor(cw, ch, v)
  const total = c * r
  const kinds: CellKind[] = [...Array<CellKind>(Math.min(N, total)).fill('desk'), ...fillerKinds(Math.max(0, total - N - 1), N, objects), 'coffee']
  const cells: Cell[] = []
  for (let row = 0; row < r; row++) {
    for (let k = 0; k < c; k++) {
      const col = row % 2 === 0 ? k : c - 1 - k
      const i = cells.length
      const box = { x: grid.x + col * cw, y: grid.y + row * ch, w: cw, h: ch }
      // the desk as drawn at `dk` (deskFrame): its seat and lane in office units
      const fr = deskFrame(box, dk)
      const mod = deskModuleBox(fr.box, v)
      const lane = fr.map([0, mod.y + g.lane.y + g.lane.h / 2])[1]
      const kind = kinds[i] ?? 'free'
      const seatY = mod.y + g.deskTop + g.seatDrop
      const seat: Pt = fr.map(kind === 'desk' || kind === 'free' ? [mod.x + g.seatX, seatY] : [fr.box.x + fr.box.w / 2, seatY])
      cells.push({ i, col, row, box: rb(box), kind, seat: rp(seat), lane: r2(lane) })
    }
  }
  const seats = new Map<string, number>()
  packed.forEach((w, i) => seats.set(w.id, i))
  const coffeeCell = cells[cells.length - 1] as Cell
  const coffee = coffeeCell.seat

  // the boss's spots and the walkways
  const passes: number[] = []
  // the corridor's walkway and the door: a person is wider than the corridor, so it walks far enough
  // from the pane's edge to be seen whole (it fades out at the door, it is never cut by the edge)
  const half = g.charSize * dk * 0.6 + 1
  const corrX = topo === 'S' ? Math.min(corridor.x + CORRIDOR / 2, SW - half) : Math.max(corridor.x + CORRIDOR / 2, half)
  for (let k = 1; k < c; k++) passes.push(grid.x + k * cw)
  let throne: Pt, board: Pt, shredderPt: Pt, windowPt: Pt, front: Pt
  const wb = objects.whiteboard
  const sh = objects.shredder
  const win = objects.window0
  const lastLane = cells.filter(x => x.row === r - 1)[0]?.lane ?? SH - 6
  throne = [desk.x + desk.w / 2, desk.y + desk.h * BOSS_DESK_TOP]
  if (topo === 'S') {
    const laneX = glass.x - 10
    passes.push(floor.x + PAD_SIDE / 2, corrX)
    board = [laneX, wb ? wb.y + wb.h / 2 : desk.y + desk.h + 8]
    shredderPt = [laneX, sh ? sh.y + sh.h * 0.8 : SH - 20]
    windowPt = [laneX, boss.y + 8]
    front = [glass.x + GLASS / 2, lastLane]
  } else {
    const laneY = glass.y - BOSS_LANE / 2
    passes.push(corrX, grid.x + grid.w + PAD_SIDE / 2)
    board = [wb ? clamp(wb.x + wb.w / 2, 8, SW - 8) : desk.x - 12, laneY]
    shredderPt = [sh ? sh.x + sh.w / 2 : desk.x + desk.w + 12, laneY]
    windowPt = [win ? clamp(win.x + win.w / 2, 8, SW - 8) : desk.x - 12, laneY]
    // the opening in the glass: beside the boss desk, where the boss steps out from behind it
    front = [desk.x - 8, glass.y + GLASS / 2]
  }
  passes.sort((p, q) => p - q)

  // leavers: from the tracker's last spot, else from their place in hire order
  const leavers = new Map<string, Pt>()
  const deskCount = Math.max(1, N)
  for (const w of workers) {
    if (w.id === 'boss' || w.activity !== 'leaving') continue
    const spot = spotsPx?.[w.id]
    if (spot) {
      leavers.set(w.id, rp([spot[0] / s, spot[1] / s]))
      continue
    }
    let idx = 0
    for (const p of packed) if (p.joinedAt < w.joinedAt || (p.joinedAt === w.joinedAt && p.n < w.n)) idx++
    const cell = cells[Math.min(idx, deskCount - 1)] ?? (cells[0] as Cell)
    leavers.set(w.id, cell.seat)
  }

  const L: OfficeLayout = {
    W, H, s, SW: r2(SW), SH: r2(SH),
    cls, topo, variant: v, cols: c, rows: r,
    deskScale: dk,
    charSize: r2(g.charSize * dk),
    // the boss stays the largest figure in the office
    bossSize: r2(Math.max(g.charSize * 1.3, g.charSize * dk * 1.15)),
    zones: { wall: rb(wall), ticker: rb(ticker), boss: rb(boss), floor: rb(floor), corridor: rb(corridor), glass: rb(glass) },
    objects: Object.fromEntries(Object.entries(objects).map(([id, b]) => [id, rb(b as Box)])) as Placed,
    cells,
    seats,
    leavers,
    hidden,
    door: rp([corrX, SH - 6]),
    doorBox: rb(corridor),
    coffee,
    boss: { desk: rb(desk), throne: rp(throne), board: rp(board), shredder: rp(shredderPt), window: rp(windowPt), front: rp(front) },
    passes: passes.map(r2),
    key: `${topo}|${s}|${v}|${c}|${r}`,
  }

  return L
}

/** The hint for the next layout: this layout as chosen now. */
export function hintOf(L: OfficeLayout, now: number): LayoutHint {
  return { topo: L.topo, s: L.s, variant: L.variant, cols: L.cols, rows: L.rows, score: candScore(L.topo, L.variant, L.s, L.cls), at: now }
}

/** The hint to keep: the previous one while the layout did not change (its time is when it last changed), else this layout's. */
export function nextHint(prev: LayoutHint | undefined, L: OfficeLayout, now: number): LayoutHint {
  if (prev && `${prev.topo}|${prev.s}|${prev.variant}|${prev.cols}|${prev.rows}` === L.key) return prev

  return hintOf(L, now)
}

// —— walking ——

export function pathLen(pts: readonly Pt[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1] as Pt
    const q = pts[i] as Pt
    len += Math.hypot(q[0] - p[0], q[1] - p[1])
  }

  return len
}

/** How long a walk of `lenOu` takes, ms: 80 ou a second at full speed, between 0.9 and 4.5 s. */
export function walkMs(lenOu: number, speed = 1): number {
  return clamp((lenOu / WALK_OU_S) * 1000 / Math.max(0.1, speed), 900, 4500)
}

type Net = {
  topo: Topo
  rowLanes: number[]
  gy: number
  ch: number
  rows: number
  floor: Box
  boss: Box
  corridor: Box
  corrX: number
  topLane: number
  bossLane: number
  laneX: number
  front: Pt
  frontNode: Pt
  desk: Box
  passes: readonly number[]
}

function netOf(L: OfficeLayout): Net {
  const rowLanes: number[] = []
  for (const c of L.cells) rowLanes[c.row] = c.lane
  const first = L.cells[0]
  const z = L.zones
  const topLane = z.floor.y + PAD_TOP / 2
  const corrX = z.corridor.x + z.corridor.w / 2
  const front = L.boss.front
  const isS = L.topo === 'S'

  return {
    topo: L.topo,
    rowLanes,
    gy: first ? first.box.y : z.floor.y,
    ch: first ? first.box.h : z.floor.h,
    rows: L.rows,
    floor: z.floor,
    boss: z.boss,
    corridor: z.corridor,
    corrX,
    topLane,
    bossLane: z.glass.y - BOSS_LANE / 2,
    laneX: z.glass.x - 10,
    front,
    frontNode: isS ? [z.floor.x + PAD_SIDE / 2, front[1]] : [front[0], topLane],
    desk: L.boss.desk,
    passes: L.passes,
  }
}

type Place = 'boss' | 'corr' | 'grid'

function placeOf(n: Net, p: Pt): Place {
  if (n.topo === 'S' ? p[0] < n.floor.x - 0.5 : p[1] < n.floor.y - 0.5) return 'boss'
  if (p[0] >= n.corridor.x - 0.5 && p[0] <= n.corridor.x + n.corridor.w + 0.5 && p[1] >= n.corridor.y - 0.5) return 'corr'

  return 'grid'
}

function laneOf(n: Net, y: number): number {
  const row = clamp(Math.floor((y - n.gy) / Math.max(1, n.ch)), 0, Math.max(0, n.rows - 1))

  return n.rowLanes[row] ?? y
}

/** From a point to the boss zone's own walkway (T: the lane before the glass; S: the lane by the glass). */
function toBossLane(n: Net, p: Pt, towardX: number): Pt[] {
  if (n.topo === 'S') return [p, [n.laneX, p[1]]]
  const d = n.desk
  const behind = p[1] < n.bossLane - 2 && p[0] > d.x - 2 && p[0] < d.x + d.w + 2 && p[1] > d.y
  if (behind) {
    const side = towardX < d.x + d.w / 2 ? d.x - 8 : d.x + d.w + 8

    return [p, [side, p[1]], [side, n.bossLane]]
  }

  return [p, [p[0], n.bossLane]]
}

/** From a boss-zone point out through the glass opening to the floor's walkways. */
function bossOut(n: Net, p: Pt): Pt[] {
  const inner = toBossLane(n, p, n.front[0])
  if (n.topo === 'S') return [...inner, [n.laneX, n.front[1]], n.front, n.frontNode]

  return [...inner, [n.front[0], n.bossLane], n.front, n.frontNode]
}

/** From a point to a node on the floor's network: a lane (grid, boss) or the corridor's walkway. */
function enter(n: Net, p: Pt): { pts: Pt[]; onLane: boolean } {
  const at = placeOf(n, p)
  if (at === 'boss') return { pts: bossOut(n, p), onLane: true }
  if (at === 'corr') return { pts: [p, [n.corrX, p[1]]], onLane: false }

  return { pts: [p, [p[0], laneOf(n, p[1])]], onLane: true }
}

function nearestPass(n: Net, x1: number, x2: number): number {
  let best = n.passes[0] ?? n.corrX
  let cost = Infinity
  for (const p of n.passes) {
    const c = Math.abs(x1 - p) + Math.abs(p - x2)
    if (c < cost - 1e-9) {
      cost = c
      best = p
    }
  }

  return best
}

function connect(n: Net, a: Pt, aLane: boolean, b: Pt, bLane: boolean): Pt[] {
  if (aLane && bLane) {
    if (Math.abs(a[1] - b[1]) < 0.5) return [b]
    const p = nearestPass(n, a[0], b[0])

    return [[p, a[1]], [p, b[1]], b]
  }
  // the corridor's walkway is a vertical pass of its own
  if (!aLane && bLane) return [[a[0], b[1]], b]
  if (aLane && !bLane) return [[b[0], a[1]], b]

  return [b]
}

function clean(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last[0] - p[0]) < 0.5 && Math.abs(last[1] - p[1]) < 0.5) continue
    out.push([r2(p[0]), r2(p[1])])
  }
  // a point in the middle of a straight run says nothing
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1] as Pt
    const b = out[i] as Pt
    const c = out[i + 1] as Pt
    const vertical = Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5
    const horizontal = Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5
    if (vertical || horizontal) out.splice(i, 1)
  }
  if (out.length > 8) return [...out.slice(0, 4), ...out.slice(-4)]

  return out
}

/** The walk between two points (ou) along the walkways, never over a desk: at most 8 points, from and to included. */
export function route(L: OfficeLayout, from: Pt, to: Pt): Pt[] {
  const n = netOf(L)
  const pa = placeOf(n, from)
  const pb = placeOf(n, to)
  if (pa === 'boss' && pb === 'boss') {
    const a = toBossLane(n, from, to[0])
    const b = toBossLane(n, to, from[0]).reverse()

    return clean([...a, ...b])
  }
  const a = enter(n, from)
  const b = enter(n, to)
  const aEnd = a.pts[a.pts.length - 1] as Pt
  const bEnd = b.pts[b.pts.length - 1] as Pt
  const mid = connect(n, aEnd, a.onLane, bEnd, b.onLane)

  return clean([...a.pts, ...mid.slice(0, -1), ...b.pts.slice().reverse()])
}

/** Where a walk is at `now`: its first point before it starts, its last after it ends, along its length between. */
export function positionAt(m: Move, now: number): Pt {
  const first = m.pts[0] ?? [0, 0]
  const last = m.pts[m.pts.length - 1] ?? first
  if (now <= m.at || m.pts.length < 2) return [first[0], first[1]]
  if (now >= m.at + m.dur) return [last[0], last[1]]
  let d = ((now - m.at) / m.dur) * pathLen(m.pts)
  for (let i = 1; i < m.pts.length; i++) {
    const p = m.pts[i - 1] as Pt
    const q = m.pts[i] as Pt
    const seg = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d <= seg) {
      const t = seg > 0 ? d / seg : 0

      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
    }
    d -= seg
  }

  return [last[0], last[1]]
}

export type Move = { pts: Pt[]; at: number; dur: number; kind: 'repack' | 'boss' }
/**
 * The tracker's memory between frames (px). `cellsPx` is this layout's desk cells (the next
 * relayout's `prevCells`); `leaving` keeps where each leaving worker started its walk out.
 */
export type MoveState = {
  sizeKey: string
  layoutKey: string
  s: number
  spots: Record<string, Pt>
  moves: Record<string, Move>
  relayoutAt?: number
  prevCells?: Box[]
  cellsPx?: Box[]
  leaving?: Record<string, Pt>
}

const dist = (p: Pt, q: Pt): number => Math.hypot(p[0] - q[0], p[1] - q[1])
const scalePt = (p: Pt, k: number): Pt => [r2(p[0] * k), r2(p[1] * k)]
const scaleBox = (b: Box, k: number): Box => ({ x: r2(b.x * k), y: r2(b.y * k), w: r2(b.w * k), h: r2(b.h * k) })

/**
 * Walks the team to its new places: everyone whose desk changed since the last frame gets a
 * walk from where it is now (mid-walk too) to its new desk, at most six at a time, 350 ms apart;
 * when someone left, the walks wait 1.2 s while it packs up. A new size walks nobody.
 */
export function trackMoves(prev: MoveState | undefined, L: OfficeLayout, workers: readonly Worker[], now: number, sizeKey: string, fatigue: Fatigue = 0): MoveState {
  const s = L.s
  const speed = FATIGUE_SPEED[fatigue] ?? 1
  const byId = new Map(workers.map(w => [w.id, w]))
  const targets: Record<string, Pt> = {}
  const order: Array<[string, number]> = []
  for (const [id, i] of L.seats) {
    const cell = L.cells[i]
    if (!cell) continue
    targets[id] = scalePt(cell.seat, s)
    order.push([id, i])
  }
  const boss = byId.get('boss')
  if (boss) targets.boss = scalePt(L.boss[bossSpotFor(boss)], s)
  const cellsPx = L.cells.filter(c => c.kind === 'desk' || c.kind === 'free').map(c => scaleBox(c.box, s))
  if (!prev || prev.sizeKey !== sizeKey) return { sizeKey, layoutKey: L.key, s, spots: targets, moves: {}, cellsPx, leaving: {} }

  const posNow = (id: string): Pt | undefined => {
    const m = prev.moves[id]
    if (m && now < m.at + m.dur) return positionAt(m, now)

    return prev.spots[id]
  }
  const moves: Record<string, Move> = {}
  for (const [id, m] of Object.entries(prev.moves)) if (id in targets && now < m.at + m.dur + MOVE_TTL_MS) moves[id] = m
  // who left since the last frame: its walk out starts where it stood
  const leaving: Record<string, Pt> = {}
  for (const [id, p] of Object.entries(prev.leaving ?? {})) if (byId.has(id) && !(id in targets)) leaving[id] = p
  for (const id of Object.keys(leaving)) if (byId.get(id)?.activity !== 'leaving') delete leaving[id]
  let departed = false
  for (const id of Object.keys(prev.spots)) {
    if (id === 'boss' || id in targets) continue
    departed = true
    const p = posNow(id)
    if (byId.get(id)?.activity === 'leaving' && p && !(id in leaving)) leaving[id] = [r2(p[0]), r2(p[1])]
  }
  // the walks, nearest the boss first
  order.sort((p, q) => p[1] - q[1])
  let k = 0
  for (const [id] of order) {
    const was = prev.spots[id]
    const to = targets[id] as Pt
    if (!was || dist(was, to) <= 2) continue
    const w = byId.get(id)
    // a newcomer still walking in from the door goes straight to its new desk; one at the coffee stays there
    if (w && now - w.joinedAt < ARRIVAL_WINDOW_MS) continue
    if (w && w.activity === 'done' && w.endedAt !== undefined && now - w.endedAt >= COFFEE_AFTER_MS) continue
    const from = posNow(id) ?? was
    const pts = route(L, [from[0] / s, from[1] / s], [to[0] / s, to[1] / s]).map(p => scalePt(p, s))
    const at = now + (departed ? MOVE_DELAY_MS : 0) + STAGGER_MS * (k % MAX_CONCURRENT) + WAVE_GAP_MS * Math.floor(k / MAX_CONCURRENT)
    moves[id] = { pts, at, dur: walkMs(pathLen(pts) / s, speed), kind: 'repack' }
    k++
  }
  const bWas = prev.spots.boss
  const bTo = targets.boss
  if (bWas && bTo && dist(bWas, bTo) > 2) {
    const from = posNow('boss') ?? bWas
    const pts = route(L, [from[0] / s, from[1] / s], [bTo[0] / s, bTo[1] / s]).map(p => scalePt(p, s))
    moves.boss = { pts, at: now, dur: walkMs(pathLen(pts) / s, speed), kind: 'boss' }
  }
  const out: MoveState = { sizeKey, layoutKey: L.key, s, spots: targets, moves, cellsPx, leaving }
  if (prev.layoutKey !== L.key) {
    out.relayoutAt = now
    if (prev.cellsPx) out.prevCells = prev.cellsPx
  } else if (prev.relayoutAt !== undefined && now - prev.relayoutAt < MOVE_TTL_MS) {
    out.relayoutAt = prev.relayoutAt
    if (prev.prevCells) out.prevCells = prev.prevCells
  }

  return out
}

/** The tracker's walks still worth drawing, in ou for this layout. */
export function movesOu(st: MoveState | undefined, L: OfficeLayout, now: number): ReadonlyMap<string, Move> {
  const out = new Map<string, Move>()
  if (!st) return out
  for (const [id, m] of Object.entries(st.moves)) {
    if (now >= m.at + m.dur + MOVE_TTL_MS) continue
    out.set(id, { pts: m.pts.map(p => [r2(p[0] / L.s), r2(p[1] / L.s)] as Pt), at: m.at, dur: m.dur, kind: m.kind })
  }

  return out
}
