// The pane as one picture: the whole of it is the office (no header, no side or bottom
// panels). The layout (layout.ts) fits the office to the pane's own size; the scene
// (scene.ts) draws it in office units and this file scales it to the pane's pixels, so
// the office fills the pane to its edges at any size and shape.
import type { Breakdown, Daily, FeedItem, MascotKind, Stats, Talk, Turn, Usage, Worker } from '../types'
import type { Box, Move, OfficeLayout } from './layout'
import { layoutOffice } from './layout'
import { MASCOT_INFO, clip, esc, fmtTokens, forecast, mascotFor } from './logic'
import type { Forecast, Sample } from './logic'
import { STYLE, actCapFor, phaseLock, preferActs, sceneBg, sceneParts, withDefs } from './scene'

// Claude's own look for the context tab: warm graphite or ivory paper, clay as the loud colour
type Palette = Record<'bg' | 'panel' | 'panelHi' | 'line' | 'track' | 'tile' | 'text' | 'muted' | 'dim' | 'orange' | 'claude' | 'cyan' | 'violet' | 'gold' | 'green' | 'amber' | 'red', string>
const DARK: Palette = {
  bg: '#1F1E1D',
  panel: '#262624',
  panelHi: '#2D2C29',
  line: '#3A3934',
  track: '#3A3934',
  tile: '#1F1E1D',
  text: '#F5F4EE',
  muted: '#B7B4A9',
  dim: '#85837A',
  orange: '#D97757',
  claude: '#D97757',
  cyan: '#6A9BCC',
  violet: '#A99BD0',
  gold: '#D4A27F',
  green: '#8FAE6B',
  amber: '#E3A04F',
  red: '#E0685A',
}
const LIGHT: Palette = {
  bg: '#F0EEE6',
  panel: '#FAF9F5',
  panelHi: '#FFFFFF',
  line: '#E3E0D5',
  track: '#E8E6DC',
  tile: '#F0EEE6',
  text: '#141413',
  muted: '#5E5D59',
  dim: '#8F8D85',
  orange: '#C2613F',
  claude: '#D97757',
  cyan: '#3F72A6',
  violet: '#6F5BA8',
  gold: '#A8754E',
  green: '#5F7A3D',
  amber: '#B8701E',
  red: '#C0452F',
}
let C: Palette = DARK
let THEME: 'dark' | 'light' = 'dark'

/** Draws what follows in the app's theme. */
export function useHudTheme(theme: 'dark' | 'light'): void {
  THEME = theme
  C = theme === 'light' ? LIGHT : DARK
}

const SANS = `class="t"`
const MONO = `class="m"`
const PAD = 16
const GAP = 14
/** The Svg element takes at most 131072 characters; the full picture gives way to the lighter one past this. */
const SVG_ROOM = 128_000

const n1 = (v: number) => Math.round(v * 10) / 10

function text(x: number, y: number, s: string, size: number, fill: string, opts = ''): string {
  return `<text x="${n1(x)}" y="${n1(y)}" font-size="${size}" fill="${fill}" ${opts}>${esc(s)}</text>`
}

/** How many characters of a given size fit a width, roughly. */
function fits(width: number, size: number, mono = false): number {
  return Math.max(4, Math.floor(width / (size * (mono ? 0.6 : 0.56))))
}

export function prettyModel(model: string | undefined): string {
  if (!model) return '—'
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(model)
  if (!m) return clip(model, 18)
  const name = (m[1] as string).charAt(0).toUpperCase() + (m[1] as string).slice(1)

  return `${name} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

export type HudInput = {
  workers: readonly Worker[]
  feed: readonly FeedItem[]
  usage: Usage
  turn: Turn
  stats: Stats
  now: number
  motion: boolean
  /** the pane's width in pixels: the drawing's width */
  width: number
  /** the pane's height in pixels: the drawing fills it exactly, never scrolls */
  fill?: number
  /** auto compact as set: marked on the water cooler */
  autoCompact?: { isOn: boolean; at: number }
  /** today's cost across chats */
  daily?: Daily
  /** orders, reports and messages between the desks */
  talks?: readonly Talk[]
  /** when the previous frame was drawn: what happened since replays from its start */
  lastFrameAt?: number
  /** the office's layout for this pane (computed here when not given) */
  layout?: OfficeLayout
  /** the walks the move tracker planned, in office units */
  moves?: ReadonlyMap<string, Move>
  /** the grid was laid out anew: when, and the old desk cells (px) */
  relayout?: { at: number; prevCells: Box[] }
  /** the picture as it stays, for frameKey: no walks, flights, fresh bubbles or reactions */
  settled?: boolean
}

export function isBusy(turn: Turn, boss: Worker | undefined): boolean {
  return turn.active || (boss !== undefined && !['idle', 'done', 'failed'].includes(boss.activity))
}

/** The forecast of one limit from the readings the usage carries. */
export function limitForecast(usage: Usage, kind: string, now: number): { pct: number; f: Forecast } | undefined {
  const l = usage.limits.find(x => x.kind === kind)
  if (!l) return undefined

  return { pct: l.pct, f: forecast(kind, l.pct, l.resetsAt, (usage.samples?.[kind] ?? []) as Sample[], now) }
}

/** The model families an office can seat, in the order a tie shows them. */
const KIND_ORDER: readonly MascotKind[] = ['opus', 'sonnet', 'haiku', 'fable', 'claude', 'sol', 'terra', 'luna', 'astra', 'argon', 'flash', 'evren', 'other', 'boss']

/** A family's short name for a sentence: "Opus", "GPT Terra", "Gemini Flash". */
function kindName(kind: MascotKind): string {
  const info = MASCOT_INFO[kind]

  return info.family === 'Claude' || info.family === 'EVREN' ? info.label : info.family === 'Other' ? 'other model' : `${info.family} ${info.label}`
}

/** The pane's size in pixels, as the drawing takes it. */
function paneSize(input: HudInput): { W: number; H: number } {
  return { W: Math.round(Math.max(340, Math.min(3200, input.width))), H: Math.round(Math.max(380, Math.min(4000, input.fill ?? 760))) }
}

export function hudSvg(input: HudInput): { svg: string; alt: string; width: number; height: number } {
  const { W, H } = paneSize(input)
  const L = input.layout && input.layout.W === W && input.layout.H === H ? input.layout : layoutOffice({ workers: input.workers, W, H, now: input.now })
  // full, then lite, then lighter still (the newest talk only, then the settled picture) until it fits
  let hud = buildHud(input, L, W, H, false)
  for (const squeeze of [0, 1, 2]) {
    if (hud.svg.length <= SVG_ROOM) break
    hud = buildHud(input, L, W, H, true, squeeze)
  }
  // a crowded office whose full picture leaves no room for the activity props: the lite one shows them
  if (!hud.lite && hud.dropped > 0) {
    const lite = buildHud(input, L, W, H, true)
    if (preferActs(hud, lite)) hud = lite
  }
  // a kind drawn as its plain vector stand-in (its idle strip did not fit): the lighter picture leaves
  // room for the real sprites; it is taken when it has fewer stand-ins
  const stand = (svg: string) => (svg.match(/id="cv-/g) ?? []).length
  if (stand(hud.svg) > 0) {
    for (const squeeze of [0, 1]) {
      const lite = buildHud(input, L, W, H, true, squeeze)
      if (lite.svg.length <= SVG_ROOM && stand(lite.svg) < stand(hud.svg)) hud = lite
      if (stand(hud.svg) === 0) break
    }
  }

  return { svg: phaseLock(hud.svg, input.now), alt: hud.alt, width: hud.width, height: hud.height }
}

type Built = { svg: string; alt: string; width: number; height: number; lite: boolean; dropped: number }

function buildHud(input: HudInput, L: OfficeLayout, W: number, H: number, lite: boolean, squeeze = 0): Built {
  const { workers, usage, turn, now, motion } = input
  const five = limitForecast(usage, 'five_hour', now)
  const week = limitForecast(usage, 'seven_day', now)
  const bg = sceneBg(THEME)
  // the office with its activity props: drawn again with less room for them when the defs do not fit (scene.withDefs)
  const scene = withDefs(cap => {
    const parts = sceneParts(
      {
        workers, usage, turn, now, motion,
        stats: input.stats, daily: input.daily, feed: input.feed,
        autoCompactAt: input.autoCompact?.isOn ? input.autoCompact.at : undefined,
        fiveFullAt: five?.f.fullAt, weekFullAt: week?.f.fullAt,
        talks: input.talks, lastFrameAt: input.lastFrameAt,
        layout: L, moves: input.moves, relayout: input.relayout, settled: input.settled, theme: THEME,
      },
      lite,
      squeeze,
      cap,
    )
    const base =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">` +
      `<style>${STYLE}</style><defs><clipPath id="o-pane"><rect width="${W}" height="${H}" rx="4"/></clipPath>${parts.defs}<!--ac--><!--sp--></defs>` +
      `<rect x="-2" y="-2" width="${W + 4}" height="${H + 4}" fill="${bg}"/>` +
      `<g clip-path="url(#o-pane)"><g transform="scale(${L.s})"${motion ? '' : ' class="still"'}>${parts.body}</g></g></svg>`

    return { base, acts: parts.acts, dropped: parts.dropped, alt: parts.alt }
  }, actCapFor(squeeze))

  // who is at work, by model family: the biggest groups first (a tie keeps the family order)
  const team = workers.filter(w => w.id !== 'boss')
  const tally = new Map<MascotKind, number>()
  for (const w of team.filter(x => x.endedAt === undefined)) {
    const kind = mascotFor(w, false)
    tally.set(kind, (tally.get(kind) ?? 0) + 1)
  }
  const mix = [...tally.entries()].sort((a, b) => b[1] - a[1] || KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]))
  const lim = (label: string, lf?: { pct: number; f: Forecast }) => (lf ? `${label} ${Math.round(lf.pct)}% (${lf.f.line})` : '')
  const crewAlt = mix.length > 0 ? `Team: ${mix.map(([kind, n]) => `${n} ${kindName(kind)}`).join(', ')}.` : ''
  const chatter = input.talks ? input.talks.filter(t => now - t.t <= 60_000 && t.t <= now).length : undefined
  const chatAlt = chatter === undefined ? '' : chatter > 0 ? `${chatter} ${chatter === 1 ? 'message' : 'messages'} in the last 60s.` : `No messages in the last 60s.`
  const alt = [scene.alt, `Context ${Math.round(usage.ctxPct ?? 0)}%.`, lim('5 hour', five), lim('Weekly', week), crewAlt, chatAlt].filter(Boolean).join(' ')

  // (the characters, the activities and the icons went in last, only as many as fit under the surface's limit)
  return { svg: scene.svg, alt, width: W, height: H, lite, dropped: scene.dropped }
}

// —— the context tab: the window by category, in the same style ——

const CATEGORY_EN: Record<string, string> = {
  'System prompt': 'System prompt',
  'System tools': 'System tools',
  'MCP tools': 'MCP tools',
  'Custom agents': 'Custom agents',
  'Memory files': 'Memory files',
  Messages: 'Messages',
  Skills: 'Skills',
  'Free space': 'Free space',
  'Autocompact buffer': 'Compaction buffer',
  'Slash commands': 'Commands',
}

export const CATEGORY_COLORS = ['#FF8B5E', '#22D3EE', '#A78BFA', '#34D399', '#FBBF24', '#F472B6', '#A3E635', '#FB7185', '#818CF8']

export function categoryName(name: string): string {
  return CATEGORY_EN[name] ?? name
}

const hudDefs = () => `
<filter id="h-glow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="0" flood-opacity="0"/></filter>
<filter id="h-lift" x="-5%" y="-5%" width="110%" height="120%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000" flood-opacity="${C === DARK ? 0.35 : 0.06}"/></filter>`

/** A card: paper or graphite, a hairline edge, a small-caps title with a clay mark. */
function panel(x: number, y: number, w: number, h: number, title?: string, accent = C.claude): string {
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${C.panel}" stroke="${C.line}" stroke-width="1" filter="url(#h-lift)"/>`
  if (title) {
    out += `<rect x="${x + 18}" y="${y + 15}" width="3" height="11" rx="1.5" fill="${accent}"/>`
    out += text(x + 28, y + 24.5, title, 10.5, C.muted, `${SANS} font-weight="700" letter-spacing="1.5"`)
  }

  return out
}

export function breakdownHud(b: Breakdown, width: number): { svg: string; alt: string; width: number; height: number } {
  const W = Math.round(Math.max(340, Math.min(3200, width)))
  const used = b.categories.filter(c => c.kind === 'used' && c.tokens > 0).sort((x, y) => y.tokens - x.tokens)
  const lists: Array<[string, Breakdown['memory']]> = [
    ['MEMORY FILES', b.memory],
    ['MCP TOOLS', b.mcp],
    ['SKILLS', b.skills],
  ].filter((l): l is [string, Breakdown['memory']] => (l[1] as Breakdown['memory']).length > 0) as Array<[string, Breakdown['memory']]>
  const parts: string[] = []
  const iw = W - 2 * PAD
  const topH = 120 + Math.ceil(used.length / (iw >= 700 ? 3 : 2)) * 26
  parts.push(panel(PAD, PAD, iw, topH, `CONTEXT BREAKDOWN · ${prettyModel(b.model)}`, C.cyan))
  parts.push(text(PAD + 18, PAD + 58, `${Math.round(b.pct)}%`, 26, C.text, `${MONO} font-weight="800"`))
  parts.push(text(PAD + 100, PAD + 58, `${fmtTokens(b.total)} / ${fmtTokens(b.max)} tokens`, 14, C.muted, MONO))
  let x = PAD + 18
  const bw = iw - 36
  parts.push(`<rect x="${x}" y="${PAD + 72}" width="${bw}" height="14" rx="7" fill="${C.track}"/>`)
  used.forEach((c, i) => {
    const w = (bw * c.tokens) / Math.max(1, b.max)
    if (w < 0.5) return
    parts.push(`<rect x="${n1(x)}" y="${PAD + 72}" width="${n1(w)}" height="14" fill="${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}"><title>${esc(`${categoryName(c.name)}: ${fmtTokens(c.tokens)}`)}</title></rect>`)
    x += w
  })
  if (b.autocompact !== undefined) parts.push(`<rect x="${n1(PAD + 18 + (bw * b.autocompact) / 100)}" y="${PAD + 66}" width="2" height="26" fill="${C.text}"><title>Auto-compact threshold</title></rect>`)
  const cols = iw >= 700 ? 3 : 2
  const cw = bw / cols
  used.forEach((c, i) => {
    const cx = PAD + 18 + (i % cols) * cw
    const cy = PAD + 112 + Math.floor(i / cols) * 26
    parts.push(`<rect x="${n1(cx)}" y="${cy - 10}" width="10" height="10" rx="2" fill="${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}"/>`)
    parts.push(text(cx + 18, cy, clip(categoryName(c.name), fits(cw - 90, 13)), 13, C.text, SANS))
    parts.push(text(cx + cw - 16, cy, fmtTokens(c.tokens), 13, C.muted, `${MONO} text-anchor="end"`))
  })
  let y = PAD + topH + GAP
  const listCols = Math.max(1, Math.min(lists.length, iw >= 900 ? 3 : iw >= 600 ? 2 : 1))
  const lw = (iw - (listCols - 1) * GAP) / listCols
  let rowMax = 0
  lists.forEach(([title, items], i) => {
    const col = i % listCols
    if (col === 0 && i > 0) {
      y += rowMax + GAP
      rowMax = 0
    }
    const lx = PAD + col * (lw + GAP)
    const lh = 44 + items.length * 24
    rowMax = Math.max(rowMax, lh)
    parts.push(panel(lx, y, lw, lh, title, C.violet))
    items.forEach((it, k) => {
      const iy = y + 58 + k * 24
      parts.push(text(lx + 18, iy, clip(it.name, fits(lw - 100, 13)), 13, C.text, SANS))
      parts.push(text(lx + lw - 18, iy, fmtTokens(it.tokens), 13, C.muted, `${MONO} text-anchor="end"`))
    })
  })
  const H = Math.round(y + rowMax + PAD)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><style>${STYLE}</style><defs>${hudDefs()}</defs>` +
    `<rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>${parts.join('')}</svg>`

  return { svg, alt: `Context ${Math.round(b.pct)}%: ${used.map(c => `${categoryName(c.name)} ${fmtTokens(c.tokens)}`).join(', ')}`, width: W, height: H }
}
