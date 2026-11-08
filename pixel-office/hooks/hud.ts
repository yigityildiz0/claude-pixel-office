// The pane as one Claude-styled dashboard, drawn in real pixels: the caller gives the width
// the pane has, one unit of the drawing is one pixel, so text keeps its size at
// any window size and the layout reflows (two columns when wide, one when narrow).
import type { Breakdown, Daily, FeedItem, FeedKind, Stats, Turn, Usage, Worker } from '../types'
import { clip, dayKey, fmtDuration, fmtTokens, forecast, istanbul } from './logic'
import type { Forecast, Sample } from './logic'
import { STYLE, bestCols, esc, phaseLock, sceneHeight, sceneParts, starburst } from './scene'

// Claude's own look, as its app, site and posters draw it: warm graphite or ivory
// paper, clay as the one loud colour, hairline rules, a serif for the headlines
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

/** Draws what follows in the app's theme. */
export function useHudTheme(theme: 'dark' | 'light'): void {
  C = theme === 'light' ? LIGHT : DARK
}

const SANS = `class="t"`
const MONO = `class="m"`
const SERIF = `class="s"`
const PAD = 16
const GAP = 14
// the SVG element takes at most this many characters
const SVG_ROOM = 128_000

const n1 = (v: number) => Math.round(v * 10) / 10

function text(x: number, y: number, s: string, size: number, fill: string, opts = ''): string {
  return `<text x="${n1(x)}" y="${n1(y)}" font-size="${size}" fill="${fill}" ${opts}>${esc(s)}</text>`
}

/** How many characters of a given size fit a width, roughly. */
function fits(width: number, size: number, mono = false): number {
  return Math.max(4, Math.floor(width / (size * (mono ? 0.6 : 0.56))))
}

// kept as ids the rest of the drawing names: the glow is a soft shadow now, no neon
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

export function prettyModel(model: string | undefined): string {
  if (!model) return '—'
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(model)
  if (!m) return clip(model, 18)
  const name = (m[1] as string).charAt(0).toUpperCase() + (m[1] as string).slice(1)

  return `${name} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

const FEED_GLYPH: Record<FeedKind, string> = {
  prompt: '▶', think: '◆', read: '▤', write: '✎', run: '›', web: '◎', plan: '☰', hire: '+', done: '✓',
  fail: '✕', compact: '⇣', limit: '!', turn: '■', wait: '?',
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
  /** auto compact as set: marked on the context ring */
  autoCompact?: { isOn: boolean; at: number }
  /** today's cost across chats */
  daily?: Daily
}

export function isBusy(turn: Turn, boss: Worker | undefined): boolean {
  return turn.active || (boss !== undefined && !['idle', 'done', 'failed'].includes(boss.activity))
}

export function hudSvg(input: HudInput): { svg: string; alt: string; width: number; height: number } {
  const full = buildHud(input, false)
  const hud = full.svg.length <= SVG_ROOM ? full : buildHud(input, true)

  return { ...hud, svg: phaseLock(hud.svg, input.now) }
}

const TONE = (t: Forecast['tone']) => (t === 'bad' ? C.red : t === 'warn' ? C.amber : t === 'ok' ? C.green : C.dim)
const pctTone = (p: number) => (p >= 90 ? C.red : p >= 70 ? C.amber : C.green)

/** The forecast of one limit from the readings the usage carries. */
export function limitForecast(usage: Usage, kind: string, now: number): { pct: number; f: Forecast } | undefined {
  const l = usage.limits.find(x => x.kind === kind)
  if (!l) return undefined

  return { pct: l.pct, f: forecast(kind, l.pct, l.resetsAt, (usage.samples?.[kind] ?? []) as Sample[], now) }
}

/** A gauge card: a title row, a big figure, then up to two lines. */
function card(x: number, y: number, w: number, h: number, title: string, accent: string, right?: [string, string]): string {
  let out = `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${h}" rx="12" fill="${C.panel}" stroke="${C.line}" filter="url(#h-lift)"/>`
  out += `<rect x="${n1(x + 12)}" y="${n1(y + 12)}" width="3" height="10" rx="1.5" fill="${accent}"/>`
  out += text(x + 21, y + 21, title, 9.5, C.muted, `${SANS} font-weight="800" letter-spacing="1.4"`)
  if (right) out += text(x + w - 12, y + 21, right[0], 10, right[1], `${MONO} font-weight="700" text-anchor="end"`)

  return out
}

function ctxCard(x: number, y: number, w: number, h: number, usage: Usage, auto?: { isOn: boolean; at: number }): string {
  const pct = Math.max(0, Math.min(100, usage.ctxPct ?? 0))
  const color = pct >= 85 ? C.red : pct >= 60 ? C.amber : C.cyan
  let out = card(x, y, w, h, 'CONTEXT', C.cyan, [usage.ctxWindow ? `${fmtTokens(usage.ctxTokens)} / ${fmtTokens(usage.ctxWindow)}` : '', C.dim])
  const r = Math.min(24, (h - 40) / 2)
  const cx = x + 16 + r
  const cy = y + 32 + r
  const circ = 2 * Math.PI * r
  out += `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" fill="none" stroke="${C.track}" stroke-width="6"/>`
  out += `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${n1((circ * pct) / 100)} ${n1(circ)}" transform="rotate(-90 ${n1(cx)} ${n1(cy)})"/>`
  if (auto?.isOn) {
    const a = ((auto.at / 100) * 360 - 90) * (Math.PI / 180)
    out += `<line x1="${n1(cx + (r - 6) * Math.cos(a))}" y1="${n1(cy + (r - 6) * Math.sin(a))}" x2="${n1(cx + (r + 6) * Math.cos(a))}" y2="${n1(cy + (r + 6) * Math.sin(a))}" stroke="${C.text}" stroke-width="2"/>`
  }
  out += text(cx, cy + 5, `${Math.round(pct)}%`, 14, C.text, `${MONO} font-weight="800" text-anchor="middle"`)
  const tx = cx + r + 14
  const room = x + w - 12 - tx
  out += text(tx, y + 48, pct >= 85 ? 'nearly full' : pct >= 60 ? 'filling up' : 'room to spare', 14, color, `${SANS} font-weight="700"`)
  out += text(tx, y + 66, clip(auto?.isOn ? `auto-compact at ${auto.at}%` : 'auto-compact off', fits(room, 11)), 11, C.muted, SANS)
  // the trail of the context %, newest at the right
  const hist = (usage.history ?? []).slice(-40)
  if (hist.length > 1 && h >= 92) {
    const sx = tx
    const sw = room
    const sy = y + h - 12
    const pts = hist.map((p, i) => `${n1(sx + (i * sw) / (hist.length - 1))},${n1(sy - (p / 100) * 14)}`).join(' ')
    out += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4" opacity=".7"/>`
  }

  return out
}

function limitCard(x: number, y: number, w: number, h: number, title: string, lf: { pct: number; f: Forecast } | undefined): string {
  if (!lf) {
    let out = card(x, y, w, h, title, C.dim)
    out += text(x + 14, y + 52, '—', 22, C.dim, `${MONO} font-weight="800"`)
    out += text(x + 14, y + 72, 'after first reply', 11, C.muted, SANS)

    return out
  }
  const { pct, f } = lf
  const color = pctTone(pct)
  let out = card(x, y, w, h, title, color, f.rate !== undefined ? [`${f.rate >= 10 ? Math.round(f.rate) : f.rate.toFixed(1)}%/hr`, C.dim] : undefined)
  out += text(x + 14, y + 50, `${Math.round(pct)}%`, 22, C.text, `${MONO} font-weight="800"`)
  // the bar: used, then the pace's projection to the reset (hatched), a mark where it fills
  const bx = x + 74
  const bw = x + w - 14 - bx
  const by = y + 38
  out += `<rect x="${n1(bx)}" y="${by}" width="${n1(bw)}" height="10" rx="5" fill="${C.track}"/>`
  const proj = Math.min(100, f.fullAt !== undefined ? 100 : f.atReset ?? pct)
  if (proj > pct) out += `<rect x="${n1(bx + (bw * pct) / 100)}" y="${by}" width="${n1((bw * (proj - pct)) / 100)}" height="10" fill="url(#h-hatch)" opacity=".9"><title>Projected at reset</title></rect>`
  out += `<rect x="${n1(bx)}" y="${by}" width="${n1(Math.max(4, (bw * Math.min(100, pct)) / 100))}" height="10" rx="5" fill="${color}"/>`
  if (f.fullAt !== undefined) out += `<rect x="${n1(bx + bw - 2)}" y="${by - 3}" width="3" height="16" rx="1" fill="${C.red}" style="animation:pulse 1.2s infinite"/>`
  const [a, b] = f.line.split(' · ')
  const room = fits(w - 28, 11.5)
  out += text(x + 14, y + 70, clip(a ?? '', room), 11.5, TONE(f.tone), `${SANS} font-weight="700"`)
  if (b && h >= 92) out += text(x + 14, y + 86, clip(b, room), 11, C.muted, SANS)

  return out
}

function costCard(x: number, y: number, w: number, h: number, usage: Usage, stats: Stats, daily: Daily | undefined, now: number): string {
  const hours = Math.max(1 / 60, (now - (stats.sessionStart || now)) / 3_600_000)
  const session = usage.usd
  const perHour = session !== undefined && hours >= 0.1 ? session / hours : undefined
  let out = card(x, y, w, h, 'COST · API EQUIVALENT', C.gold, daily ? [`${daily.sessions} chats`, C.dim] : undefined)
  const today = daily && daily.day === dayKey(now) ? daily.usd : session
  out += text(x + 14, y + 50, today === undefined ? '—' : `$${today.toFixed(2)}`, 22, C.gold, `${MONO} font-weight="800"`)
  out += text(x + w - 14, y + 50, 'today', 11, C.muted, `${SANS} text-anchor="end"`)
  const room = fits(w - 28, 11.5)
  out += text(x + 14, y + 70, clip(`this chat $${(session ?? 0).toFixed(2)}${perHour !== undefined ? ` · $${perHour.toFixed(2)}/hr` : ''}`, room), 11.5, C.text, `${SANS} font-weight="600"`)
  if (h >= 92) out += text(x + 14, y + 86, clip(`${fmtTokens(stats.outTokens)} tokens out · ${fmtDuration(now - (stats.sessionStart || now)).replace(/ \d+s$/, '')}`, room), 11, C.muted, SANS)

  return out
}

function buildHud(input: HudInput, lite: boolean): { svg: string; alt: string; width: number; height: number } {
  const { workers, feed, usage, turn, stats, now, motion } = input
  const W = Math.round(Math.max(340, Math.min(3200, input.width)))
  const H = Math.round(Math.max(380, Math.min(4000, input.fill ?? 760)))
  const boss = workers.find(w => w.id === 'boss')
  const team = workers.filter(w => w.id !== 'boss')
  const busy = isBusy(turn, boss)
  const five = limitForecast(usage, 'five_hour', now)
  const week = limitForecast(usage, 'seven_day', now)
  const parts: string[] = []

  // —— header: the name, the model at work, the state ——
  parts.push(`<g>${starburst(PAD + 11, PAD + 13, 9, C.claude)}</g>`)
  parts.push(text(PAD + 28, PAD + 20, 'Claude Office', 19, C.text, `${SERIF} font-weight="500"`))
  const EFFORT: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'very high', max: 'maximum' }
  const chips: Array<[string, string]> = [
    [busy ? 'WORKING' : 'IDLE', busy ? C.green : C.dim],
    [`${prettyModel(turn.model)}${turn.effort ? ` · ${EFFORT[turn.effort] ?? turn.effort}` : ''}`, C.orange],
    [`${team.filter(w => w.endedAt === undefined).length} agents`, C.violet],
  ]
  const chipW = (label: string, first: boolean) => label.length * 7.9 + (first ? 30 : 22)
  while (chips.length > 1 && chips.reduce((s, [l], i) => s + chipW(l, i === 0) + 6, 0) > W - 2 * PAD - 150) chips.splice(chips.length - 1, 1)
  let cx = W - PAD
  for (let i = chips.length - 1; i >= 0; i--) {
    const [label, color] = chips[i] as [string, string]
    const cw = chipW(label, i === 0)
    cx -= cw
    parts.push(`<rect x="${n1(cx)}" y="${PAD + 2}" width="${n1(cw)}" height="22" rx="11" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-opacity=".35"/>`)
    if (i === 0) {
      parts.push(`<circle cx="${n1(cx + 12)}" cy="${PAD + 13}" r="3.5" fill="${color}"${busy ? ' style="animation:pulse 1.4s infinite"' : ''}/>`)
      parts.push(text(cx + 21, PAD + 17, label, 11, color, `${SANS} font-weight="800" letter-spacing="1"`))
    } else {
      parts.push(text(cx + 10, PAD + 17, label, 11, color, `${SANS} font-weight="700"`))
    }
    cx -= 6
  }

  // —— the gauges: context, both limits with their pace, the cost ——
  const gy = PAD + 34
  const cols = W >= 900 ? 4 : 2
  const rows = cols === 4 ? 1 : 2
  const gh = H >= 620 ? 96 : 82
  const gw = (W - 2 * PAD - (cols - 1) * 10) / cols
  const at = (i: number): [number, number] => [PAD + (i % cols) * (gw + 10), gy + Math.floor(i / cols) * (gh + 10)]
  parts.push(ctxCard(...at(0), gw, gh, usage, input.autoCompact))
  parts.push(limitCard(...at(1), gw, gh, '5 HOURS', five))
  parts.push(limitCard(...at(2), gw, gh, 'WEEKLY', week))
  parts.push(costCard(...at(3), gw, gh, usage, stats, input.daily, now))
  const sceneTop = gy + rows * gh + (rows - 1) * 10 + GAP

  // —— the office: as large as fits both ways, centred, never cut ——
  const rowH = 22
  const boxY = sceneTop
  const boxW = W - 2 * PAD
  const roomFor = H - PAD - boxY
  // first as if the office had all the room above one ticker line
  let boxH = Math.max(120, roomFor - 26 - GAP)
  const deskCols = bestCols(workers, boxW - 12, boxH - 12)
  const scene = sceneParts(
    { workers, usage, turn, now, motion, stats, cols: deskCols, autoCompactAt: input.autoCompact?.isOn ? input.autoCompact.at : undefined, fiveFullAt: five?.f.fullAt, weekFullAt: week?.f.fullAt },
    lite,
  )
  const sceneW = deskCols * 160
  void sceneHeight
  const scale = Math.min((boxW - 12) / sceneW, (boxH - 12) / scene.height)
  const dw = sceneW * scale
  const dh = scene.height * scale
  // a tall, narrow pane leaves room under the office: the latest events fill it instead of a void
  const spare = boxH - (dh + 12)
  const feedRows = spare > 120 ? Math.min(14, Math.floor((spare - 40) / rowH)) : 0
  if (feedRows > 0) boxH = Math.ceil(dh + 12)
  parts.push(`<rect x="${PAD}" y="${boxY}" width="${boxW}" height="${boxH}" rx="14" fill="${C.panel}" stroke="${C.line}" filter="url(#h-lift)"/>`)

  // —— below it: the latest events, one line when the office takes the height, a list when not ——
  const listY = boxY + boxH + GAP
  const listH = H - PAD - listY
  const items = feed.slice(-Math.max(1, feedRows || 1)).reverse()
  parts.push(`<rect x="${PAD}" y="${listY}" width="${W - 2 * PAD}" height="${n1(listH)}" rx="${feedRows ? 12 : 9}" fill="${C.panel}" stroke="${C.line}"/>`)
  if (feedRows) parts.push(text(PAD + 14, listY + 20, 'RECENT EVENTS', 9.5, C.muted, `${SANS} font-weight="800" letter-spacing="1.4"`))
  const firstY = feedRows ? listY + 42 : listY + n1(listH / 2) + 4
  if (items.length === 0) parts.push(text(PAD + 12, firstY, 'Events appear as Claude works', 11.5, C.muted, SANS))
  items.forEach((f, i) => {
    const y = firstY + i * rowH
    parts.push(`<g opacity="${n1(i === 0 ? 1 : Math.max(0.45, 1 - i * 0.05))}">`)
    parts.push(text(PAD + 12, y, istanbul(f.t).text.slice(0, 5), 11, C.dim, MONO))
    parts.push(text(PAD + 56, y, FEED_GLYPH[f.kind], 12, f.color, `${SANS} font-weight="800"`))
    parts.push(text(PAD + 72, y, f.who, 11.5, f.color, `${SANS} font-weight="700"`))
    const tx = PAD + 72 + Math.min(12, f.who.length) * 6.8 + 8
    parts.push(text(tx, y, clip(f.text, fits(W - PAD - 12 - tx, 11.5)), 11.5, C.text, SANS))
    parts.push(`</g>`)
  })
  parts.push(
    `<g transform="translate(${n1(PAD + (boxW - dw) / 2)} ${n1(boxY + (boxH - dh) / 2)}) scale(${scale.toFixed(4)})"><clipPath id="h-sc"><rect width="${sceneW}" height="${scene.height}" rx="8"/></clipPath><g clip-path="url(#h-sc)">${scene.body}</g></g>`,
  )

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<style>${STYLE}</style><defs>${hudDefs()}<pattern id="h-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="${C.amber}" opacity=".55"/></pattern>${scene.defs}</defs>` +
    `<rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>` +
    `<g class="${motion ? '' : 'still'}">${parts.join('')}</g></svg>`

  const lim = (label: string, lf?: { pct: number; f: Forecast }) => (lf ? `${label} ${Math.round(lf.pct)}% (${lf.f.line})` : '')
  const alt = [scene.alt, `Context ${Math.round(usage.ctxPct ?? 0)}%.`, lim('5 hours', five), lim('Weekly', week)].filter(Boolean).join(' ')

  return { svg, alt, width: W, height: H }
}

// —— the context tab: the window by category, in the same style ——

const CATEGORY_TR: Record<string, string> = {
  'System prompt': 'System prompt',
  'System tools': 'System tools',
  'MCP tools': 'MCP tools',
  'Custom agents': 'Custom agents',
  'Memory files': 'Memory files',
  Messages: 'Messages',
  Skills: 'Skills',
  'Free space': 'Free space',
  'Autocompact buffer': 'Autocompact buffer',
  'Slash commands': 'Slash commands',
}

export const CATEGORY_COLORS = ['#FF8B5E', '#22D3EE', '#A78BFA', '#34D399', '#FBBF24', '#F472B6', '#A3E635', '#FB7185', '#818CF8']

export function categoryName(name: string): string {
  return CATEGORY_TR[name] ?? name
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
  parts.push(text(PAD + 100, PAD + 58, `${fmtTokens(b.total)} / ${fmtTokens(b.max)} token`, 14, C.muted, MONO))
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
