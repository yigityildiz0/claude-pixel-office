// What happens between the desks, drawn as short scenes that end by themselves: paper planes,
// calls across the room, a gull or a pigeon at the window, an envelope under the door, the
// pneumatic tube, a visit to the boss's desk. Also the drawing's clock (every timed piece is
// placed on the wall clock, so a redraw picks it up where it was), the speech bubbles and the
// walker, which moves a character along a route without ever skipping a step.
import type { Talk } from '../types'
import { type CharKind, type CharState, drawCharacter } from './characters'
import type { Box, OfficeLayout, Pt } from './layout'
import { pathLen, route, walkMs } from './layout'
import { clip, esc, hash, n1 } from './logic'
import { envelope, plane } from './props'

// ——— the clock ———————————————————————————————————————————————

let NOW = 0
let LAST: number | undefined
let KEEP = false

/**
 * This drawing's wall clock and the previous frame's (see vStart). `keep`: a picture that is shown
 * as it plays (not the settled one, not a still), whose starts later frames must keep.
 */
export function setClock(now: number, last?: number, keep = false): void {
  NOW = now
  LAST = last
  KEEP = keep
}

/**
 * How long ago an event began, for animations that start with it. The pane paints a
 * new frame every few seconds only: an event newer than the previous frame (t > lastFrameAt)
 * plays again from the start (at most 0.4 s in), one the previous frame already showed
 * goes on at its real age. Milliseconds.
 */
export function eventAge(t: number, now: number, lastFrameAt?: number): number {
  const age = now - t

  return lastFrameAt !== undefined && t > lastFrameAt ? Math.min(age, 400) : age
}

// the starts already drawn (event time → its start): every later frame keeps the start the first one chose
const STARTS = new Map<number, number>()

/**
 * When an event's scene starts on this drawing's clock. Like eventAge, a scene that began
 * after the previous frame starts (almost) at once. A picture that plays remembers the start,
 * so every later frame keeps it, however many frames come and however far apart: a walk or a
 * flight never jumps between frames. The first frame (no previous one) takes the event's own
 * time; the settled picture and stills take the rule alone and remember nothing.
 */
export function vStart(t: number): number {
  const rule = (): number => (LAST === undefined ? t : t > LAST ? Math.max(t, NOW - 400) : LAST - t < 4000 ? Math.max(t, LAST - 400) : t)
  if (!KEEP) return rule()
  const kept = STARTS.get(t)
  if (kept !== undefined && kept <= Math.max(NOW, t)) return kept
  const start = rule()
  if (STARTS.size > 400) for (const [at] of STARTS) if (NOW - at > 120_000) STARTS.delete(at)
  STARTS.set(t, start)

  return start
}

/** Milliseconds since an event's scene started (see vStart). */
export const ago = (t: number): number => NOW - vStart(t)

export const now = (): number => NOW

export const n2 = (v: number): number => Math.round(v * 100) / 100

export function anim(name: string, seconds: number, delay = 0, extra = 'infinite'): string {
  return `animation:${name} ${n2(seconds)}s ${delay ? `${n2(delay)}s ` : ''}${extra}`
}

const sec = (ms: number): string => `${n2(ms / 1000)}s`

// Gates: a piece shown or hidden for a while, on this drawing's clock (offsets in ms from now).
// They use opacity (a hidden group hides all it holds), one-shot CSS animations (phaseLock leaves
// them alone) and drop out of frameKey with every other animation.

/** Shown only between `a` and `b` ms from now. */
export function during(a: number, b: number, inner: string): string {
  if (!inner || b <= 0 || b <= a) return ''

  return `<g style="opacity:0;animation:o1 ${sec(b - a)} ${sec(a)} 1">${inner}</g>`
}

/** Hidden between `a` and `b` ms from now. */
export function except(a: number, b: number, inner: string): string {
  if (!inner || b <= 0 || b <= a) return inner

  return `<g style="animation:o0 ${sec(b - a)} ${sec(a)} 1">${inner}</g>`
}

/** Shown from `a` ms from now on. */
export function after(a: number, inner: string): string {
  if (!inner || a <= 0) return inner

  return `<g style="opacity:0;animation:o1 1s ${sec(a)} 1 forwards">${inner}</g>`
}

/** Shown until `b` ms from now. */
export function until(b: number, inner: string): string {
  if (!inner || b <= 0) return ''

  return `<g style="animation:o0 1s ${sec(b)} 1 forwards">${inner}</g>`
}

// ——— walks kept between frames ———————————————————————————————————

export type Plan = { pts: Pt[]; t0: number; dur: number }
/** Walks already drawn (pane px, wall clock), by worker and purpose. */
const WALKS = new Map<string, Plan & { s: number; hurried?: boolean }>()

/** The point `f` (0–1) of the way along a route, by length. */
export function along(pts: readonly Pt[], f: number): Pt {
  let left = Math.max(0, Math.min(1, f)) * pathLen(pts)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt
    const b = pts[i] as Pt
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (left <= d && d > 0) return [a[0] + ((b[0] - a[0]) * left) / d, a[1] + ((b[1] - a[1]) * left) / d]
    left -= d
  }

  return pts[pts.length - 1] as Pt
}

/** Whether a walk under `key` has been drawn by a picture that plays. */
export const walkKept = (key: string): boolean => WALKS.has(key)

// where each visit to the boss's desk brought its worker back to, and when (pane px, wall clock)
const VISITS = new Map<string, { end: number; at: Pt; s: number }>()

/** The desk a worker's last visit to the boss walked it back to (ou), and when it sat down. */
export function visitHome(id: string, L: OfficeLayout): { end: number; at: Pt } | undefined {
  const v = VISITS.get(id)

  return v && v.s === L.s ? { end: v.end, at: [v.at[0] / L.s, v.at[1] / L.s] } : undefined
}

/**
 * A walk as the frames before drew it. The same walk keeps its route and times; when this frame
 * sends it somewhere else (the office was packed again while it walked) it turns from where it
 * is now, never from the start. Only a picture that plays remembers (see setClock).
 */
export function keptWalk(key: string, plan: Plan, L: OfficeLayout, speed = 1, hurryAt?: number): Plan & { turned: boolean } {
  if (!KEEP) return hurried({ ...plan, turned: false }, hurryAt)
  const s = L.s
  const old = WALKS.get(key)
  const end = plan.pts[plan.pts.length - 1] as Pt
  let out: Plan & { turned: boolean } = { ...plan, turned: false }
  let isHurried = false
  // a new scale redraws the whole office (a relayout): nothing to keep across it
  if (old && old.s === s && NOW >= old.t0) {
    const pts = old.pts.map(p => [p[0] / s, p[1] / s] as Pt)
    const oldEnd = pts[pts.length - 1] as Pt
    if (Math.hypot(oldEnd[0] - end[0], oldEnd[1] - end[1]) <= 2) {
      out = { pts, t0: old.t0, dur: old.dur, turned: old.hurried === true }
      isHurried = old.hurried === true
    } else {
      const here = NOW >= old.t0 + old.dur ? oldEnd : along(pts, (NOW - old.t0) / Math.max(1, old.dur))
      const way = route(L, here, end)
      out = { pts: way, t0: NOW, dur: walkMs(pathLen(way), speed), turned: true }
    }
  }
  // the work began before it arrived: from this frame on (never earlier: the last frame showed it at
  // its own pace up to now) it walks the rest briskly; later frames keep that walk
  if (hurryAt !== undefined && !isHurried) {
    const h = hurried(out, Math.max(hurryAt, NOW))
    if (h !== out) {
      out = h
      isHurried = true
    }
  }
  if (WALKS.size > 200) for (const [id, w] of WALKS) if (w.t0 + w.dur < NOW - 60_000) WALKS.delete(id)
  WALKS.set(key, { pts: out.pts.map(p => [p[0] * s, p[1] * s] as Pt), t0: out.t0, dur: out.dur, s, hurried: isHurried })

  return out
}

/** How much faster than its own pace a worker walks the rest of the way once wanted at work: brisk, never a jump. */
export const HURRY_PACE = 1.4
export const HURRY_MIN_MS = 500

/** The route from `f` (0–1) of the way along to its end: the point there, then the corners after it. */
export function restOf(pts: readonly Pt[], f: number): Pt[] {
  let left = Math.max(0, Math.min(1, f)) * pathLen(pts)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt
    const b = pts[i] as Pt
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (left <= d && d > 0) {
      const at: Pt = [a[0] + ((b[0] - a[0]) * left) / d, a[1] + ((b[1] - a[1]) * left) / d]

      return Math.hypot(b[0] - at[0], b[1] - at[1]) < 1e-6 ? [at, ...pts.slice(i + 1)] : [at, ...pts.slice(i)]
    }
    left -= d
  }
  const last = pts[pts.length - 1]

  return last ? [last] : []
}

/**
 * A walk whose worker's job began before it arrived (`hurryAt`, wall clock): from that moment it
 * walks the rest 1.4 times as fast (at least 0.5 s) and sits down; up to then it is the walk as
 * planned, so no frame shows it further back than an earlier one did. Worked out from the plan and
 * the event alone: every frame draws the same.
 */
export function hurried(plan: Plan & { turned: boolean }, hurryAt: number | undefined): Plan & { turned: boolean } {
  if (hurryAt === undefined || plan.pts.length < 2 || plan.dur <= 0) return plan
  const end = plan.t0 + plan.dur
  const from = Math.max(hurryAt, plan.t0)
  const left = end - from
  const dur = Math.max(HURRY_MIN_MS, left / HURRY_PACE)
  if (left - dur < 150) return plan

  return { pts: restOf(plan.pts, (from - plan.t0) / plan.dur), t0: from, dur, turned: true }
}

// ——— bubbles ——————————————————————————————————————————————————

export type Tone = 'light' | 'warn' | 'royal'
/** say: round, what is said · think: a cloud on two small bubbles · shout: spiky, called across the room · mail: a message, with an envelope badge */
export type Shape = 'say' | 'think' | 'shout' | 'mail'

/** A speech bubble whose tail points at (tailX, y + its height + tail): `fs` is its letter size. */
export function bubble(text: string, cx: number, y: number, maxW: number, tailX: number, minX: number, maxX: number, tone: Tone = 'light', shape: Shape = 'say', fs = 8.2): string {
  if (!text) return ''
  const k = fs / 8.2
  const cw = fs * 0.555
  const pad = (shape === 'mail' ? 22 : shape === 'shout' ? 18 : shape === 'think' ? 16 : 12) * k
  const chars = Math.max(2, Math.floor((maxW - pad) / cw))
  const line = clip(text, chars)
  const width = Math.min(maxW, Math.max((shape === 'think' ? 30 : 36) * k, line.length * cw + pad))
  const left = Math.max(minX, Math.min(maxX - width, cx - width / 2))
  const fill = tone === 'warn' ? '#FEF3C7' : tone === 'royal' ? '#FFF7E6' : '#EDE6D8'
  const stroke = tone === 'royal' ? '#FBBF24' : '#2A2522'
  const tx = Math.max(left + 6 * k, Math.min(left + width - 6 * k, tailX))
  const mid = n1(left + width / 2 + (shape === 'mail' ? 4 * k : 0))
  const h = 15 * k
  const label = (weight: number, color = '#2A2522') => `<text x="${mid}" y="${n1(y + 10.5 * k)}" text-anchor="middle" class="t" font-size="${n2(fs)}" font-weight="${weight}" fill="${color}">${esc(line)}</text>`

  if (shape === 'think') {
    const bumps = Math.max(2, Math.round((width - 12 * k) / (10 * k)))
    const seg = n2((width - 12 * k) / bumps)
    const r = n2(seg / 2)
    const toward = tailX < cx ? -1 : 1
    const top = (dir: 1 | -1) => `a${r} ${n2(3 * k)} 0 0 1 ${n2(dir * seg)} 0`.repeat(bumps)
    const e = n2(6 * k)
    const d = `M${n1(left + 6 * k)} ${n1(y + 1.5 * k)}${top(1)}a${e} ${e} 0 0 1 0 ${n2(12 * k)}${top(-1)}a${e} ${e} 0 0 1 0 ${n2(-12 * k)}Z`
    const ink = `fill="${fill}" stroke="${stroke}" stroke-opacity=".5" stroke-width="${n2(k)}"`

    return `<g><path d="${d}" ${ink}/><circle cx="${n1(tx)}" cy="${n1(y + 18.4 * k)}" r="${n2(2.6 * k)}" ${ink}/><circle cx="${n1(tx - 2.6 * k * toward)}" cy="${n1(y + 23.4 * k)}" r="${n2(1.5 * k)}" ${ink}/>${label(600, '#4A4339')}</g>`
  }

  if (shape === 'shout') {
    const n = Math.max(4, Math.round(width / (6.5 * k)))
    const pts: Pt[] = []
    for (let i = 0; i <= n; i++) pts.push([left + (width * i) / n, y + (i % 2 === 0 ? -2.6 : 1.4) * k])
    pts.push([left + width + 3 * k, y + 7.5 * k])
    let tail = false
    for (let i = n; i >= 0; i--) {
      const px = left + (width * i) / n
      if (!tail && Math.abs(px - tx) <= width / n / 2) {
        tail = true
        pts.push([px + 3.4 * k, y + 13.6 * k], [tx, y + 23 * k], [px - 3.4 * k, y + 13.6 * k])
      } else {
        pts.push([px, y + (i % 2 === 0 ? 17.6 : 13.6) * k])
      }
    }
    pts.push([left - 3 * k, y + 7.5 * k])
    const d = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${n1(px)} ${n1(py)}`).join(' ')

    return `<g><path d="${d} Z" fill="${tone === 'light' ? '#FFF1C9' : fill}" stroke="#C2410C" stroke-width="${n2(k)}" stroke-linejoin="round"/>${label(800, '#7C2D12')}</g>`
  }

  const badge = shape === 'mail' ? `<circle cx="${n1(left + 3 * k)}" cy="${n1(y + 2 * k)}" r="${n2(6.4 * k)}" fill="#F59E0B" stroke="#2A2522" stroke-opacity=".35" stroke-width=".7"/>${envelope(n1(left - 1 * k), n1(y - 0.9 * k), n2(8 * k))}` : ''

  return `<g><rect x="${n1(left)}" y="${n1(y)}" width="${n1(width)}" height="${n2(h)}" rx="${n2(5 * k)}" fill="${fill}" stroke="${stroke}" stroke-opacity="${tone === 'royal' ? 0.9 : 0.25}"/><path d="M${n1(tx - 3 * k)} ${n1(y + 14.5 * k)} L${n1(tx)} ${n1(y + 19 * k)} L${n1(tx + 3 * k)} ${n1(y + 14.5 * k)} Z" fill="${fill}"/>${label(600)}${badge}</g>`
}

/** The box (ou) a bubble drawn with these arguments takes, tail included: for keeping it off other text. */
export function bubbleBox(text: string, cx: number, y: number, maxW: number, minX: number, maxX: number, shape: Shape = 'say', fs = 8.2): { x: number; y: number; w: number; h: number } {
  const k = fs / 8.2
  const cw = fs * 0.555
  const pad = (shape === 'mail' ? 22 : shape === 'shout' ? 18 : shape === 'think' ? 16 : 12) * k
  const line = clip(text, Math.max(2, Math.floor((maxW - pad) / cw)))
  const width = Math.min(maxW, Math.max((shape === 'think' ? 30 : 36) * k, line.length * cw + pad))
  const left = Math.max(minX, Math.min(maxX - width, cx - width / 2))
  const out = shape === 'shout' ? 3 * k : shape === 'mail' ? 7 * k : 0

  return { x: left - out, y: y - (shape === 'shout' ? 2.6 * k : shape === 'mail' ? 4.4 * k : 0), w: width + 2 * out, h: bubbleH(fs) + (shape === 'shout' ? 2.6 * k : 0) }
}

/** A bubble's full height (tail included), for placing it above a head. */
export const bubbleH = (fs: number): number => (23 * fs) / 8.2

// ——— walking ——————————————————————————————————————————————————

export type Walk = {
  kind: CharKind
  size: number
  /** absolute points (ou): the first is where it stands up, the last where it arrives */
  pts: Pt[]
  /** when the walk itself starts (ms, wall clock) */
  t0: number
  /** how long the walk takes (ms) */
  dur: number
  /** shown standing at the first point from this moment until t0 (default: from t0) */
  holdFrom?: number
  /** the state while standing before the walk (default idle) */
  pre?: CharState
  /** shown standing at the last point for this long after arriving (ms; Infinity: stays) */
  stay?: number
  /** the state while standing after it (default idle) */
  post?: CharState
  speed?: number
  tired?: 0 | 1 | 2 | 3
  /** the walker fades out over the last 400 ms (through a door) */
  fadeOut?: boolean
  shadow?: boolean
  /** a running stride: Pofu's 'run' strip where it has one */
  run?: boolean
  /** drawn with the figure (its name plate), placed for the figure standing at the last point */
  tag?: string
}

const rk = (v: number): string => String(Math.round(v * 10000) / 10000)

type Phase = { at: number; layer: number }

/**
 * A character walking a route, on the wall clock: standing at the start until t0, then along
 * every point at an even pace (facing the way it goes), then standing at the end or gone.
 * One SMIL translate for the whole route and one discrete visibility track per pose, all on
 * the same timeline, so any redraw shows the same place at the same moment. Nothing when the
 * walk (and the stay after it) is over.
 */
export function walker(w: Walk): string {
  const pts = dedupe(w.pts)
  if (pts.length === 0) return ''
  const end = pts[pts.length - 1] as Pt
  // shown from `show` (standing until t0); the timeline starts now or at `show`, whichever is first
  const show = Math.min(w.holdFrom ?? w.t0, w.t0)
  const anchor = Math.min(show, NOW)
  const hidden = show - anchor
  const hold = w.t0 - anchor
  const stay = w.stay ?? 0
  const finite = Number.isFinite(stay)
  const D = hold + w.dur + (finite ? stay : 0)
  if (finite && NOW >= anchor + D) return ''
  if (!finite && NOW >= anchor + D) {
    // The walk ended before this picture: drawn standing at its end, without animations. Chromium
    // applies no frozen value of an animation that ended before the picture loaded (a negative begin
    // past its whole duration), so the animated poses would all stay hidden and the worker vanish.
    let face = 1
    for (let i = 1; i < pts.length; i++) {
      const dx = (pts[i] as Pt)[0] - (pts[i - 1] as Pt)[0]
      if (Math.abs(dx) > 0.5) face = dx > 0 ? 1 : -1
    }
    const post = w.post ?? 'idle'
    const still = drawCharacter(w.kind, post, end[0], end[1], w.size, { speed: w.speed ?? 1, tired: w.tired, left: face < 0 && post === 'idle' })
    const foot = w.shadow === false ? '' : `<ellipse cx="${n1(end[0])}" cy="${n1(end[1])}" rx="${n2(w.size * 0.26)}" ry="${n2(w.size * 0.06)}" fill="#000" opacity=".25"/>`

    return `<g>${foot}${still}${w.tag ?? ''}</g>`
  }
  const total = pathLen(pts)
  const moving = total > 0.5 && w.dur > 0
  // the translate track: standing, walking (even pace), standing
  const keys: number[] = []
  const vals: string[] = []
  const rel = (p: Pt) => `${n1(p[0] - end[0])} ${n1(p[1] - end[1])}`
  const span = finite ? D : hold + w.dur
  const tk = (ms: number) => (span > 0 ? Math.min(1, ms / span) : 1)
  const first = pts[0] as Pt
  keys.push(0)
  vals.push(rel(first))
  if (hold > 0) {
    keys.push(tk(hold))
    vals.push(rel(first))
  }
  // the poses: 0 standing before, 1 walking right, 2 walking left, 3 standing after (-1: not shown)
  const phases: Phase[] = [{ at: 0, layer: -1 }]
  if (hold > hidden || !moving) phases.push({ at: tk(hidden), layer: 0 })
  let acc = 0
  let facing = 1
  if (moving) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as Pt
      const b = pts[i] as Pt
      const d = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (Math.abs(b[0] - a[0]) > 0.5) facing = b[0] > a[0] ? 1 : -1
      phases.push({ at: tk(hold + (w.dur * acc) / total), layer: facing > 0 ? 1 : 2 })
      acc += d
      const at = tk(hold + (w.dur * acc) / total)
      if (at > (keys[keys.length - 1] as number) + 0.0001) {
        keys.push(at)
        vals.push(rel(b))
      }
    }
  }
  if (keys[keys.length - 1] !== 1) {
    keys.push(1)
    vals.push('0 0')
  }
  phases.push({ at: tk(hold + w.dur), layer: finite && stay <= 0 ? -1 : 3 })
  // a stay that ends: gone a moment before the timeline does (the frozen value is the last one)
  if (finite && stay > 0) phases.push({ at: tk(D - 1), layer: -1 })
  // the first walking phase replaces the pre-stand when there is no hold
  const clean: Phase[] = []
  for (const p of phases) {
    const last = clean[clean.length - 1]
    if (last && Math.abs(last.at - p.at) < 0.00005) clean[clean.length - 1] = p
    else if (!last || last.layer !== p.layer) clean.push(p)
  }
  if (clean[0] && clean[0].at !== 0) clean.unshift({ at: 0, layer: -1 })
  const B = sec(anchor - NOW)
  const Dur = sec(Math.max(1, span))
  const speed = w.speed ?? 1
  const opts = { speed, tired: w.tired }
  // a long route in the time it has (the 4.5 s ceiling, the way out): it runs (Pofu run, the others hurry)
  const gait: CharState = w.run || (moving && total / Math.max(0.001, w.dur / 1000) > 110) ? 'run' : 'walk'
  const poses: Array<[number, string]> = [
    [0, drawCharacter(w.kind, w.pre ?? 'idle', end[0], end[1], w.size, { ...opts, left: facingAt(pts, 0) < 0 })],
    [1, drawCharacter(w.kind, gait, end[0], end[1], w.size, opts)],
    [2, drawCharacter(w.kind, gait, end[0], end[1], w.size, { ...opts, left: true })],
    [3, drawCharacter(w.kind, w.post ?? 'idle', end[0], end[1], w.size, { ...opts, left: facing < 0 && (w.post ?? 'idle') === 'idle' })],
  ]
  let layers = ''
  for (const [id, fig] of poses) {
    if (!clean.some(p => p.layer === id)) continue
    const values = clean.map(p => (p.layer === id ? 'visible' : 'hidden')).join(';')
    const times = clean.map(p => rk(p.at)).join(';')
    layers += `<g visibility="hidden"><animate attributeName="visibility" calcMode="discrete" values="${values}" keyTimes="${times}" dur="${Dur}" begin="${B}" fill="freeze"/>${fig}</g>`
  }
  const shadow = w.shadow === false ? '' : `<ellipse cx="${n1(end[0])}" cy="${n1(end[1])}" rx="${n2(w.size * 0.26)}" ry="${n2(w.size * 0.06)}" fill="#000" opacity=".25"/>`
  const move = `<animateTransform attributeName="transform" type="translate" values="${vals.join(';')}" keyTimes="${keys.map(rk).join(';')}" dur="${Dur}" begin="${B}" fill="freeze"/>`
  const fade = w.fadeOut && finite ? `<animate attributeName="opacity" values="1;1;0" keyTimes="0;${rk(Math.max(0, 1 - 400 / Math.max(1, D)))};1" dur="${Dur}" begin="${B}" fill="freeze"/>` : ''

  // the name plate shows while the figure is shown (any pose)
  const tag = w.tag ? `<g visibility="hidden"><animate attributeName="visibility" calcMode="discrete" values="${clean.map(p => (p.layer >= 0 ? 'visible' : 'hidden')).join(';')}" keyTimes="${clean.map(p => rk(p.at)).join(';')}" dur="${Dur}" begin="${B}" fill="freeze"/>${w.tag}</g>` : ''

  return `<g>${move}${fade}${shadow}${layers}${tag}</g>`
}

function facingAt(pts: readonly Pt[], from: number): number {
  for (let i = from + 1; i < pts.length; i++) {
    const dx = (pts[i] as Pt)[0] - (pts[i - 1] as Pt)[0]
    if (Math.abs(dx) > 0.5) return dx > 0 ? 1 : -1
  }

  return 1
}

function dedupe(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.5) out.push(p)
  }

  return out
}

/**
 * A walk out and back that repeats for ever (`period` ms), in phase with the wall clock from
 * `start`: the 0.6 office's wander, on any route. Returns the walker and, for the figure left at
 * the start (a seated worker), the visibility track that hides it while it is away.
 */
export function loopWalker(kind: CharKind, size: number, there: Pt[], start: number, period: number, opts: { speed?: number; tired?: 0 | 1 | 2 | 3; tag?: string } = {}): { walker: string; away: string } {
  const out = dedupe(there)
  if (out.length < 2) return { walker: '', away: '' }
  const back = [...out].reverse()
  const len = pathLen(out)
  const leg = Math.min(period * 0.3, walkMs(len, opts.speed ?? 1))
  // 0 → 4 % seated, then out, a stop, back, seated
  const t1 = period * 0.04
  const t2 = t1 + leg
  const t4 = period * 0.96
  const t3 = t4 - leg
  const keys: number[] = [0, t1 / period]
  const origin = out[0] as Pt
  const rel = (p: Pt) => `${n1(p[0] - origin[0])} ${n1(p[1] - origin[1])}`
  const vals: string[] = [rel(origin), rel(origin)]
  let acc = 0
  for (let i = 1; i < out.length; i++) {
    acc += Math.hypot((out[i] as Pt)[0] - (out[i - 1] as Pt)[0], (out[i] as Pt)[1] - (out[i - 1] as Pt)[1])
    keys.push((t1 + (leg * acc) / len) / period)
    vals.push(rel(out[i] as Pt))
  }
  keys.push(t3 / period)
  vals.push(rel(out[out.length - 1] as Pt))
  acc = 0
  for (let i = 1; i < back.length; i++) {
    acc += Math.hypot((back[i] as Pt)[0] - (back[i - 1] as Pt)[0], (back[i] as Pt)[1] - (back[i - 1] as Pt)[1])
    keys.push((t3 + (leg * acc) / len) / period)
    vals.push(rel(back[i] as Pt))
  }
  keys.push(1)
  vals.push(rel(origin))
  const ok: number[] = []
  const ov: string[] = []
  keys.forEach((k, i) => {
    if (ok.length === 0 || k > (ok[ok.length - 1] as number) + 0.0001) {
      ok.push(k)
      ov.push(vals[i] as string)
    }
  })
  ok[ok.length - 1] = 1
  const P = sec(period)
  const B = sec(-(((NOW - start) % period) + period) % period)
  const outDir = facingAt(out, 0)
  const track = (vis: (phase: 'seat' | 'out' | 'stop' | 'back') => boolean) => {
    const at = [0, t1 / period, t2 / period, t3 / period, t4 / period]
    const which: Array<'seat' | 'out' | 'stop' | 'back'> = ['seat', 'out', 'stop', 'back', 'seat']
    return `<animate attributeName="visibility" calcMode="discrete" values="${which.map(p => (vis(p) ? 'visible' : 'hidden')).join(';')}" keyTimes="${at.map(rk).join(';')}" dur="${P}" begin="${B}" repeatCount="indefinite"/>`
  }
  const fig = (state: CharState, left: boolean) => drawCharacter(kind, state, origin[0], origin[1], size, { speed: opts.speed, tired: opts.tired, left })
  const layers =
    `<g visibility="hidden">${track(p => p === 'out')}${fig('walk', outDir < 0)}</g>` +
    `<g visibility="hidden">${track(p => p === 'stop')}${fig('idle', outDir < 0)}</g>` +
    `<g visibility="hidden">${track(p => p === 'back')}${fig('walk', outDir > 0)}</g>`
  const shadow = `<ellipse cx="${n1(origin[0])}" cy="${n1(origin[1])}" rx="${n2(size * 0.26)}" ry="${n2(size * 0.06)}" fill="#000" opacity=".22"/>`
  const walkerSvg = `<g><animateTransform attributeName="transform" type="translate" values="${ov.join(';')}" keyTimes="${ok.map(rk).join(';')}" dur="${P}" begin="${B}" repeatCount="indefinite"/><g visibility="hidden">${track(p => p !== 'seat')}${shadow}</g>${layers}${opts.tag ? `<g visibility="hidden">${track(p => p !== 'seat')}${opts.tag}</g>` : ''}</g>`

  return { walker: walkerSvg, away: track(p => p === 'seat') }
}

// ——— the talks ————————————————————————————————————————————————

/** Someone the talks can start or end at: a desk (or the boss's throne). */
export type Actor = {
  id: string
  name: string
  color: string
  kind: CharKind
  size: number
  /** feet (ou) */
  seat: Pt
  /** where a plane leaves from and lands */
  hand: Pt
  /** the top of the head */
  head: Pt
  row: number
  col: number
  isBoss: boolean
}

export type Stage = {
  L: OfficeLayout
  actors: ReadonlyMap<string, Actor>
  boss: Actor
  /** bubble letter size (ou) */
  fs: number
  lite: boolean
  speed: number
  /** who is on the move (walking in, packed to another desk): no visit to the boss for them */
  busy?: ReadonlySet<string>
}

/** What a scene asks of the people in it, in ms from now: stand and call, hop, wave, read, be away from the desk. */
export type Fx = { rise?: [number, number]; jump?: number; wave?: [number, number]; read?: [number, number]; away?: [number, number] }

export type Scenes = {
  /** the planes, birds, envelopes and calls, on top of everything */
  layer: string
  /** walkers that belong to a scene (a visit to the boss's desk) */
  walkers: string
  fx: Map<string, Fx>
  /** when the window opens and the door opens (wall clock) */
  windowAt?: number
  doorAt: number[]
  printAt?: number
  /** the tube in the ceiling above the boss's desk, while it carries a capsule */
  tube: boolean
}

const MAX_TALKS = 4
/** A scene is at most this long. */
const SCENE_MS = 6000
const PLANE_COLOR: Record<Talk['kind'], string> = { order: '#FDE68A', report: '#86EFAC', message: '#F8FAFC' }

/** The talks' scenes, newest first, at most four at a time; each picks its variant from its id, so it plays the same on every redraw. */
export function talkScenes(talks: readonly Talk[], st: Stage, max = MAX_TALKS): Scenes {
  const out: Scenes = { layer: '', walkers: '', fx: new Map(), doorAt: [], tube: false }
  let shown = 0
  for (const t of [...talks].sort((p, q) => q.t - p.t)) {
    if (shown >= max) break
    const age = ago(t.t)
    if (age < 0 || age > SCENE_MS) continue
    const from = t.from === '' ? undefined : st.actors.get(t.from)
    if (t.from !== '' && !from) continue
    const to = t.to === '' ? undefined : st.actors.get(t.to)
    const v = hash(t.id)
    const t0 = -age
    shown++
    if (!from && to) inbound(t, to, v, t0, st, out)
    else if (from && !to) outbound(t, from, v, t0, st, out)
    else if (from && to && !t.isDelivered) lost(t, from, to, v, t0, st, out)
    else if (from && to) between(t, from, to, v, t0, st, out)
  }

  return out
}

function fxOf(map: Map<string, Fx>, id: string): Fx {
  let f = map.get(id)
  if (!f) map.set(id, (f = {}))

  return f
}

/** A paper plane along a path, shown only while it flies (offsets in ms from now). */
function flight(path: string, color: string, begin: number, dur: number, size: number, fade = false): string {
  if (begin + dur <= 0) return ''
  const k = n2(size / 12)
  const fx = fade ? `<animate attributeName="opacity" values="1;1;0" keyTimes="0;.7;1" dur="${sec(dur)}" begin="${sec(begin)}" fill="freeze"/>` : ''

  return `<g opacity="0"><animateMotion path="${path}" dur="${sec(dur)}" begin="${sec(begin)}" rotate="auto" fill="remove"/><set attributeName="opacity" to="1" begin="${sec(begin)}" dur="${sec(dur)}"/>${fx}<g transform="scale(${k})">${plane(color)}</g></g>`
}

const arc = (a: Pt, b: Pt, lift: number, top = 4): string => {
  const cx = (a[0] + b[0]) / 2
  const cy = Math.max(top, Math.min(a[1], b[1]) - lift)

  return `M${n1(a[0])} ${n1(a[1])} Q${n1(cx)} ${n1(cy)} ${n1(b[0])} ${n1(b[1])}`
}

/** A plane that turns a loop half way. */
const loopArc = (a: Pt, b: Pt, lift: number, r: number): string => {
  const m: Pt = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - lift]
  const dir = b[0] >= a[0] ? 1 : -1

  return `M${n1(a[0])} ${n1(a[1])} Q${n1((a[0] + m[0]) / 2)} ${n1(m[1])} ${n1(m[0])} ${n1(m[1])} a${n1(r)} ${n1(r)} 0 1 ${dir > 0 ? 0 : 1} 0 ${n1(-2 * r)} a${n1(r)} ${n1(r)} 0 1 ${dir > 0 ? 0 : 1} 0 ${n1(2 * r)} Q${n1((m[0] + b[0]) / 2)} ${n1(m[1])} ${n1(b[0])} ${n1(b[1])}`
}

/** A call across the room: a spiky bubble with the name, while the sender stands. */
function shout(name: string, from: Actor, a: number, b: number, st: Stage): string {
  if (!name) return ''
  const [hx, hy] = from.head
  const fs = st.fs

  return during(a, b, bubble(`${name}!`, hx, hy - 4 - bubbleH(fs), Math.max(60, fs * 14), hx, 2, st.L.SW - 2, 'light', 'shout', fs))
}

/** Where a sender's question mark floats when its message reached nobody. */
function question(from: Actor, a: number, st: Stage): string {
  const [hx, hy] = from.head
  const r = n2(st.fs * 0.9)

  return during(a, a + 2400, `<g class="fb" style="animation:blip 2.4s ${sec(a)} 1 both"><circle cx="${n1(hx)}" cy="${n1(hy - r - 2)}" r="${r}" fill="#F59E0B" stroke="#2A2522" stroke-opacity=".3"/><text x="${n1(hx)}" y="${n1(hy - 2 - r * 0.55)}" text-anchor="middle" class="t" font-size="${n2(r * 1.4)}" font-weight="800" fill="#3A332D">?</text></g>`)
}

function between(t: Talk, from: Actor, to: Actor, v: number, t0: number, st: Stage, out: Scenes): void {
  const size = Math.max(8, st.L.charSize * 0.34)
  const near = !from.isBoss && !to.isBoss && from.row === to.row && Math.abs(from.col - to.col) === 1
  const dist = Math.hypot(to.hand[0] - from.hand[0], to.hand[1] - from.hand[1])
  const color = PLANE_COLOR[t.kind]
  const toName = to.isBoss ? 'Patron' : to.name
  const land = (at: number) => {
    const f = fxOf(out.fx, to.id)
    if (f.jump === undefined) f.jump = at
    if (to.isBoss) f.wave ??= [at - 150, at + 750]
  }
  if (t.kind === 'report') {
    const variant = v % 3
    // a visit: the sender takes the file to the boss's desk, hands it over and walks back
    // a visit starts only in the first frame that shows the talk (a later one cannot begin it half-way) and
    // not while the sender is on the move; one under way goes on
    const kept = walkKept(`${t.id}|there`)
    const fresh = LAST === undefined || t.t > LAST
    if (variant === 1 && to.isBoss && !from.isBoss && (kept || (fresh && !st.busy?.has(from.id)))) {
      const front = st.L.boss.front
      const plan = route(st.L, from.seat, front)
      const leg0 = walkMs(pathLen(plan), st.speed)
      if (leg0 <= 2400 || kept) {
        const a = t0
        // the legs as the first frame drew them: the way there from the desk it left, the way back to its desk now
        const there = keptWalk(`${t.id}|there`, { pts: plan, t0: NOW + a, dur: leg0 }, st.L, st.speed)
        const home = route(st.L, front, from.seat)
        const backAt = there.t0 + there.dur + 900
        const back = keptWalk(`${t.id}|back`, { pts: home, t0: backAt, dur: walkMs(pathLen(home), st.speed) }, st.L, st.speed)
        const walkThere = walker({ kind: from.kind, size: from.size, pts: there.pts, t0: there.t0, dur: there.dur, holdFrom: Math.min(NOW + a, there.t0), stay: Math.max(0, back.t0 - there.t0 - there.dur), post: 'wave', speed: st.speed })
        const walkBack = walker({ kind: from.kind, size: from.size, pts: back.pts, t0: back.t0, dur: back.dur, holdFrom: back.t0, stay: 0, speed: st.speed })
        out.walkers += walkThere + walkBack
        const homeAt = back.pts[back.pts.length - 1] as Pt
        if (KEEP) VISITS.set(from.id, { end: back.t0 + back.dur, at: [homeAt[0] * st.L.s, homeAt[1] * st.L.s], s: st.L.s })
        fxOf(out.fx, from.id).away = [Math.min(a, there.t0 - NOW), back.t0 + back.dur - NOW]
        const leg = there.t0 + there.dur - NOW - a
        fxOf(out.fx, to.id).wave = [a + leg, a + leg + 900]
        const [fx, fy] = st.L.boss.front
        out.layer += during(a + leg, a + leg + 900, `<g transform="translate(${n1(fx + size * 0.4)} ${n1(fy - from.size * 0.55)})"><rect x="${n1(-size * 0.5)}" y="${n1(-size * 0.4)}" width="${n1(size)}" height="${n1(size * 0.8)}" rx="1" fill="#86EFAC" stroke="#2A2522" stroke-width=".5"/></g>`)
        return
      }
    }
    // the printer beside the boss prints the report; the boss pulls the sheet
    if (variant === 2 && to.isBoss && st.L.objects.printer) {
      const p = st.L.objects.printer
      out.printAt = NOW + t0 + 200
      const sheet: Pt = [p.x + p.w / 2, p.y + p.h * 0.3]
      out.layer += flight(arc(sheet, to.hand, 20), '#F8FAFC', t0 + 1600, 900, size)
      fxOf(out.fx, to.id).read = [t0 + 2500, t0 + 4300]
      return
    }
    out.layer += flight(arc(from.hand, to.hand, 64 + Math.min(40, dist / 7)), color, t0 + 200, 1400, size)
    fxOf(out.fx, from.id).wave ??= [t0, t0 + 900]
    land(t0 + 1600)
    return
  }
  if (t.kind === 'order') {
    const variant = v % 3
    const lift = 64 + Math.min(40, dist / 7)
    if (variant === 1) {
      fxOf(out.fx, from.id).rise = [t0, t0 + 1800]
      out.layer += shout(toName, from, t0, t0 + 1800, st)
      out.layer += flight(arc(from.hand, to.hand, lift), color, t0 + 350, 1400, size)
      land(t0 + 1750)
    } else if (variant === 2) {
      fxOf(out.fx, from.id).wave ??= [t0, t0 + 1200]
      out.layer += flight(loopArc(from.hand, to.hand, lift * 0.8, Math.max(10, size * 1.6)), color, t0 + 300, 2000, size)
      land(t0 + 2300)
    } else {
      fxOf(out.fx, from.id).wave ??= [t0, t0 + 1200]
      out.layer += flight(arc(from.hand, to.hand, lift + 20), color, t0 + 300, 1500, size)
      land(t0 + 1800)
    }
    return
  }
  // a message between desks
  if (near) {
    if (v % 2 === 1) {
      // an envelope slides along the desks
      const y = Math.min(from.hand[1], to.hand[1]) + size * 0.4
      const path = `M${n1(from.hand[0])} ${n1(y)} L${n1(to.hand[0])} ${n1(y)}`
      out.layer += `<g opacity="0"><animateMotion path="${path}" dur="1.1s" begin="${sec(t0 + 150)}" fill="remove"/><set attributeName="opacity" to="1" begin="${sec(t0 + 150)}" dur="1.1s"/>${envelope(n1(-size * 0.6), n1(-size * 0.45), n2(size * 1.2))}</g>`
      land(t0 + 1250)
    } else {
      out.layer += flight(arc(from.hand, to.hand, 18), color, t0, 900, size)
      land(t0 + 900)
    }
    return
  }
  if (v % 2 === 1) {
    // up to the ceiling, a bounce, down to the desk
    const top = 6
    const mid: Pt = [(from.hand[0] + to.hand[0]) / 2, top]
    const path = `M${n1(from.hand[0])} ${n1(from.hand[1])} Q${n1((from.hand[0] + mid[0]) / 2)} ${n1(top)} ${n1(mid[0])} ${n1(mid[1])} Q${n1((mid[0] + to.hand[0]) / 2)} ${n1(top)} ${n1(to.hand[0])} ${n1(to.hand[1])}`
    fxOf(out.fx, from.id).wave ??= [t0, t0 + 900]
    out.layer += flight(path, color, t0 + 200, 1600, size)
    land(t0 + 1800)
    return
  }
  fxOf(out.fx, from.id).rise = [t0, t0 + 1800]
  out.layer += shout(toName, from, t0, t0 + 1800, st)
  out.layer += flight(arc(from.hand, to.hand, 64 + Math.min(40, dist / 7)), color, t0 + 350, 1400, size)
  land(t0 + 1750)
}

function lost(t: Talk, from: Actor, to: Actor, v: number, t0: number, st: Stage, out: Scenes): void {
  const size = Math.max(8, st.L.charSize * 0.34)
  const [x0, y0] = from.hand
  const [x1, y1] = to.hand
  const lift = 40
  const cx = (x0 + x1) / 2
  const cy = Math.max(6, Math.min(y0, y1) - lift)
  const u = 0.55
  const q = (a: number, b: number) => a + (b - a) * u
  const s0: Pt = [q(x0, cx), q(y0, cy)]
  const s1: Pt = [q(cx, x1), q(cy, y1)]
  const m: Pt = [q(s0[0], s1[0]), q(s0[1], s1[1])]
  if (v % 2 === 1) {
    // it crumples into a ball half way and drops
    const path = `M${n1(x0)} ${n1(y0)} Q${n1(s0[0])} ${n1(s0[1])} ${n1(m[0])} ${n1(m[1])}`
    out.layer += flight(path, PLANE_COLOR[t.kind], t0, 800, size)
    out.layer += `<g opacity="0"><animateMotion path="M${n1(m[0])} ${n1(m[1])} L${n1(m[0] + 4)} ${n1(Math.max(m[1], y0) + size * 2)}" dur="1.6s" begin="${sec(t0 + 800)}" calcMode="linear" keyPoints="0;1;1" keyTimes="0;0.5625;1" fill="remove"/><set attributeName="opacity" to="1" begin="${sec(t0 + 800)}" dur="1.6s"/><circle r="${n2(size * 0.32)}" fill="#E2E8F0" stroke="#64748B" stroke-width=".6"/><path d="M${n1(-size * 0.2)} 0 l${n1(size * 0.15)} ${n1(-size * 0.1)} l${n1(size * 0.12)} ${n1(size * 0.16)}" fill="none" stroke="#64748B" stroke-width=".5"/></g>`
  } else {
    const path = `M${n1(x0)} ${n1(y0)} Q${n1(s0[0])} ${n1(s0[1])} ${n1(m[0])} ${n1(m[1])} L${n1(m[0] + 3)} ${n1(m[1] + 20)}`
    out.layer += flight(path, PLANE_COLOR[t.kind], t0, 1400, size, true)
  }
  out.layer += question(from, t0 + 900, st)
}

/** A bird (a gull or a pigeon) seen from the front, its wings beating. */
function bird(kind: 'gull' | 'pigeon', size: number, carry: boolean): string {
  const body = kind === 'gull' ? '#F8FAFC' : '#94A3B8'
  const wing = kind === 'gull' ? '#CBD5E1' : '#64748B'
  const neck = kind === 'gull' ? '#F8FAFC' : '#5EEAD4'
  const k = size / 20

  return (
    `<g class="fb" style="animation:flap .32s infinite"><path d="M0 0 Q${n2(-6 * k)} ${n2(-7 * k)} ${n2(-11 * k)} ${n2(-2 * k)} Q${n2(-6 * k)} ${n2(-3 * k)} 0 ${n2(2 * k)} Q${n2(6 * k)} ${n2(-3 * k)} ${n2(11 * k)} ${n2(-2 * k)} Q${n2(6 * k)} ${n2(-7 * k)} 0 0Z" fill="${wing}" stroke="#2A2522" stroke-width="${n2(0.4 * k)}"/></g>` +
    `<ellipse cx="0" cy="${n2(2 * k)}" rx="${n2(3.4 * k)}" ry="${n2(4.4 * k)}" fill="${body}" stroke="#2A2522" stroke-width="${n2(0.4 * k)}"/><circle cx="0" cy="${n2(-2.6 * k)}" r="${n2(2.4 * k)}" fill="${neck}"/><circle cx="${n2(-0.9 * k)}" cy="${n2(-3 * k)}" r="${n2(0.5 * k)}" fill="#141413"/><circle cx="${n2(0.9 * k)}" cy="${n2(-3 * k)}" r="${n2(0.5 * k)}" fill="#141413"/><path d="M${n2(-0.8 * k)} ${n2(-1.8 * k)} L0 ${n2(-0.4 * k)} L${n2(0.8 * k)} ${n2(-1.8 * k)}Z" fill="#F59E0B"/>` +
    (carry ? envelope(n2(-3.2 * k), n2(5.6 * k), n2(6.4 * k)) : '')
  )
}

/** Something flying a path once, shown while it flies. */
function carry(path: string, begin: number, dur: number, inner: string, freezeFor = 0): string {
  if (begin + dur + freezeFor <= 0) return ''
  // the rest at the end is part of the motion (keyPoints), not a frozen value: Chromium applies no frozen
  // value of a motion that ended before the picture loaded, which drew the thing at the scene's corner
  const total = dur + freezeFor
  const motion =
    freezeFor > 0
      ? `<animateMotion path="${path}" dur="${sec(total)}" begin="${sec(begin)}" calcMode="linear" keyPoints="0;1;1" keyTimes="0;${rk(dur / total)};1" fill="remove"/>`
      : `<animateMotion path="${path}" dur="${sec(dur)}" begin="${sec(begin)}" fill="remove"/>`

  return `<g opacity="0">${motion}<set attributeName="opacity" to="1" begin="${sec(begin)}" dur="${sec(total)}"/>${inner}</g>`
}

/** The window planes and birds use, and a point outside it. */
function windowGate(st: Stage): { box: Box; inside: Pt; outside: Pt } | undefined {
  const o = st.L.objects
  const box = o.window0 ?? o.window1 ?? o.window2 ?? o.window3
  if (!box) return undefined

  return { box, inside: [box.x + box.w * 0.6, box.y + box.h * 0.55], outside: [box.x + box.w * 0.9, box.y + box.h * 0.25] }
}

function inbound(t: Talk, to: Actor, v: number, t0: number, st: Stage, out: Scenes): void {
  const size = Math.max(10, st.L.charSize * 0.45)
  const gate = windowGate(st)
  const desk: Pt = to.isBoss ? [st.L.boss.desk.x + st.L.boss.desk.w * 0.78, st.L.boss.desk.y + st.L.boss.desk.h * 0.55] : to.hand
  const options = gate ? 4 : 2
  let variant = v % options
  if (!gate) variant += 2
  if (!to.isBoss && variant >= 2) variant = gate ? 0 : 2
  if (variant === 0 && gate) {
    // a gull comes in at the window, drops the envelope on the desk, flies off
    out.windowAt = NOW + t0
    const path = `M${n1(gate.outside[0])} ${n1(gate.outside[1])} Q${n1((gate.inside[0] + desk[0]) / 2)} ${n1(Math.min(gate.inside[1], desk[1]) - 30)} ${n1(desk[0])} ${n1(desk[1] - size * 1.2)} Q${n1((gate.inside[0] + desk[0]) / 2 + 20)} ${n1(Math.min(gate.inside[1], desk[1]) - 40)} ${n1(gate.outside[0])} ${n1(gate.outside[1])}`
    out.layer += carry(path, t0 + 300, 4200, bird('gull', size * 1.4, false))
    out.layer += carry(`M${n1(gate.outside[0])} ${n1(gate.outside[1])} Q${n1((gate.inside[0] + desk[0]) / 2)} ${n1(Math.min(gate.inside[1], desk[1]) - 30)} ${n1(desk[0])} ${n1(desk[1] - size * 1.2)} L${n1(desk[0])} ${n1(desk[1])}`, t0 + 300, 2400, envelope(n2(-size * 0.5), n2(-size * 0.2), n2(size)))
    fxOf(out.fx, to.id).read = [t0 + 2700, t0 + 4500]
    return
  }
  if (variant === 1 && gate) {
    // a carrier pigeon lands on the desk, the boss takes the note, it flies off
    out.windowAt = NOW + t0
    const land: Pt = [desk[0] - size * 0.8, desk[1] - size * 0.6]
    out.layer += carry(`M${n1(gate.outside[0])} ${n1(gate.outside[1])} Q${n1((gate.inside[0] + land[0]) / 2)} ${n1(Math.min(gate.inside[1], land[1]) - 24)} ${n1(land[0])} ${n1(land[1])}`, t0 + 300, 1700, bird('pigeon', size * 1.2, true), 1600)
    out.layer += carry(`M${n1(land[0])} ${n1(land[1])} Q${n1((gate.inside[0] + land[0]) / 2)} ${n1(Math.min(gate.inside[1], land[1]) - 30)} ${n1(gate.outside[0])} ${n1(gate.outside[1])}`, t0 + 3600, 1500, bird('pigeon', size * 1.2, false))
    fxOf(out.fx, to.id).read = [t0 + 2100, t0 + 3700]
    return
  }
  if (variant === 2) {
    // an envelope slides in under the door and glides across the floor to the desk
    const d = st.L.door
    const front = st.L.boss.front
    const target = to.isBoss ? desk : to.hand
    const path = `M${n1(d[0])} ${n1(d[1] - 2)} L${n1((d[0] + front[0]) / 2)} ${n1(d[1] - 2)} Q${n1(front[0])} ${n1(d[1] - 2)} ${n1(front[0])} ${n1(front[1])} L${n1(target[0])} ${n1(target[1])}`
    out.layer += carry(path, t0 + 200, 3200, envelope(n2(-size * 0.5), n2(-size * 0.36), n2(size)))
    fxOf(out.fx, to.id).read = [t0 + 3400, t0 + 5000]
    return
  }
  // the pneumatic tube: a capsule drops from the boss corner's ceiling (under the ticker: it never
  // crosses the clock or the news) onto the desk and pops open
  out.tube = true
  const top = tubeTop(st)
  const path = `M${n1(desk[0])} ${n1(top)} L${n1(desk[0])} ${n1(desk[1] - size * 0.5)}`
  out.layer += tubePipe(desk[0], desk[1], size, t0, 4200, top)
  out.layer += carry(path, t0 + 300, 1300, capsule(size), 700)
  out.layer += during(t0 + 2300, t0 + 4300, `<g class="fb" style="animation:pop .4s ${sec(t0 + 2300)} ease-out both">${envelope(n1(desk[0] - size * 0.5), n1(desk[1] - size * 0.9), n2(size))}</g>`)
  fxOf(out.fx, to.id).read = [t0 + 2400, t0 + 4300]
}

function capsule(size: number): string {
  const w = n2(size * 0.6)
  const h = n2(size * 1.1)

  return `<rect x="${n2(-size * 0.3)}" y="${n2(-size * 0.55)}" width="${w}" height="${h}" rx="${n2(size * 0.3)}" fill="#E2E8F0" stroke="#475569" stroke-width=".6"/><rect x="${n2(-size * 0.3)}" y="${n2(-size * 0.1)}" width="${w}" height="${n2(size * 0.2)}" fill="#D97757"/>`
}

/** The ceiling of the boss's corner: the ticker's lower edge. */
const tubeTop = (st: Stage): number => st.L.zones.ticker.y + st.L.zones.ticker.h

/** The tube coming down from the corner's ceiling (`top`) while it is in use: a glass pipe and a hatch. */
function tubePipe(x: number, y: number, size: number, a: number, dur: number, top: number): string {
  const w = n2(size * 0.9)
  const h = Math.max(0, y - size * 1.2 - top)

  return during(a, a + dur, `<g class="fb" style="animation:tubein ${sec(dur)} ${sec(a)} 1 both"><rect x="${n1(x - size * 0.6)}" y="${n1(top)}" width="${n2(size * 1.2)}" height="${n2(size * 0.22)}" rx="1" fill="#475569"/><rect x="${n1(x - size * 0.45)}" y="${n1(top)}" width="${w}" height="${n1(h)}" fill="#CFE3EA" fill-opacity=".3" stroke="#94A3B8" stroke-width=".8"/><rect x="${n1(x - size * 0.6)}" y="${n1(top + h - size * 0.2)}" width="${n2(size * 1.2)}" height="${n2(size * 0.3)}" rx="1" fill="#64748B"/></g>`)
}

function outbound(t: Talk, from: Actor, v: number, t0: number, st: Stage, out: Scenes): void {
  const size = Math.max(8, st.L.charSize * 0.34)
  const gate = windowGate(st)
  const variant = from.isBoss ? v % 3 : 0
  if (variant === 1 && gate) {
    // a pigeon comes for the note and carries it off
    out.windowAt = NOW + t0
    const land: Pt = [from.hand[0] - size * 1.6, from.hand[1] - size * 0.8]
    out.layer += carry(`M${n1(gate.outside[0])} ${n1(gate.outside[1])} Q${n1((gate.inside[0] + land[0]) / 2)} ${n1(Math.min(gate.inside[1], land[1]) - 24)} ${n1(land[0])} ${n1(land[1])}`, t0, 1500, bird('pigeon', size * 1.6, false), 1300)
    out.layer += carry(`M${n1(land[0])} ${n1(land[1])} Q${n1((gate.inside[0] + land[0]) / 2)} ${n1(Math.min(gate.inside[1], land[1]) - 30)} ${n1(gate.outside[0])} ${n1(gate.outside[1])}`, t0 + 2800, 1600, bird('pigeon', size * 1.6, true))
    fxOf(out.fx, from.id).wave = [t0 + 1500, t0 + 2700]
    return
  }
  if (variant === 2 || (!gate && from.isBoss)) {
    // into the tube, and up
    out.tube = true
    const top = tubeTop(st)
    out.layer += tubePipe(from.hand[0], from.hand[1], size * 1.3, t0, 3200, top)
    out.layer += carry(`M${n1(from.hand[0])} ${n1(from.hand[1] - size)} L${n1(from.hand[0])} ${n1(top)}`, t0 + 900, 1100, capsule(size * 1.3))
    fxOf(out.fx, from.id).wave = [t0, t0 + 900]
    return
  }
  // a plane out of the window (the window opens for it)
  const end: Pt = gate ? gate.outside : [st.L.SW - 20, 6]
  if (gate) out.windowAt = NOW + t0
  fxOf(out.fx, from.id).wave ??= [t0, t0 + 900]
  out.layer += flight(arc(from.hand, end, 34), PLANE_COLOR[t.kind], t0 + 200, 1600, size, true)
}

// ——— the boss's cheer ————————————————————————————————————————

/** Confetti bursting from (cx, cy), `age` ms after the news. */
export function confetti(cx: number, cy: number, age: number, spread = 1): string {
  const colors = ['#D97757', '#FBBF24', '#8FAE6B', '#6A9BCC', '#A99BD0', '#F0EEE6']
  let out = ''
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2
    const r = (26 + (hash(`c${i}`) % 22)) * spread
    const dx = n1(Math.cos(a) * r)
    const dy = n1(Math.sin(a) * r * 0.8 + 18 * spread)
    out += `<rect x="${n1(cx)}" y="${n1(cy)}" width="${n2(3 * spread)}" height="${n2((i % 2 ? 3 : 5) * spread)}" fill="${colors[i % colors.length]}" style="--dx:${dx}px;--dy:${dy}px;animation:confetti 1.5s ${n2(-age / 1000)}s 3 ease-out both"/>`
  }

  return out
}
