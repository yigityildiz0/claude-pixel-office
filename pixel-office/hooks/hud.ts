// The pane as one Claude-styled dashboard, drawn in real pixels: the caller gives the width
// the pane has, one unit of the drawing is one pixel, so text keeps its size at
// any window size and the layout reflows (two columns when wide, one when narrow).
import type { Breakdown, FeedItem, FeedKind, Stats, Turn, Usage, Worker } from '../types'
import { clip, fmtDuration, fmtTokens, istanbul, limitLabel } from './logic'
import { SCENE_W, STYLE, activityBadge, activityLabel, esc, sceneParts, starburst } from './scene'

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
  /** the height that fills the pane, when the layout can use it */
  fill?: number
  /** auto compact as set: marked on the context ring */
  autoCompact?: { isOn: boolean; at: number }
}

export function isBusy(turn: Turn, boss: Worker | undefined): boolean {
  return turn.active || (boss !== undefined && !['idle', 'done', 'failed'].includes(boss.activity))
}

export function hudSvg(input: HudInput): { svg: string; alt: string; width: number; height: number } {
  const full = buildHud(input, false)

  return full.svg.length <= SVG_ROOM ? full : buildHud(input, true)
}

function buildHud(input: HudInput, lite: boolean): { svg: string; alt: string; width: number; height: number } {
  const { workers, feed, usage, turn, stats, now, motion } = input
  const W = Math.round(Math.max(340, Math.min(3200, input.width)))
  const boss = workers.find(w => w.id === 'boss')
  const team = workers.filter(w => w.id !== 'boss')
  const busy = isBusy(turn, boss)
  const scene = sceneParts({ workers, usage, turn, now, motion, stats, autoCompactAt: input.autoCompact?.isOn ? input.autoCompact.at : undefined }, lite)
  const isWide = W >= 980
  const parts: string[] = []

  // —— header ——
  const headH = 46
  parts.push(`<g>${starburst(PAD + 14, PAD + 17, 11, C.claude)}`)
  parts.push(text(PAD + 34, PAD + 25, 'Claude Office', 22, C.text, `${SERIF} font-weight="500"`))
  parts.push(`</g>`)
  const live = busy ? C.green : C.dim
  const chips: Array<[string, string]> = [
    [busy ? 'WORKING' : 'IDLE', live],
    // the model, its effort and the time are on the room's sign and clock
    [`${team.filter(w => w.endedAt === undefined).length} agents`, C.violet],
  ]
  const chipW = ([label]: [string, string]) => label.length * 8.6 + (label === chips[0]?.[0] ? 34 : 22) + 8
  // a narrow pane drops the least needed first: effort, then the model, then the clock
  while (chips.length > 1 && chips.reduce((sum, c) => sum + chipW(c), 0) > W - 2 * PAD - 190) chips.splice(chips.length === 4 ? 2 : 1, 1)
  let cx = W - PAD
  for (const [label, color] of [...chips].reverse()) {
    const cw = label.length * 8.6 + (label === chips[0]?.[0] ? 34 : 22)
    cx -= cw
    parts.push(`<rect x="${n1(cx)}" y="${PAD + 4}" width="${n1(cw)}" height="26" rx="13" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-opacity=".35"/>`)
    if (label === chips[0]?.[0]) {
      parts.push(`<circle cx="${n1(cx + 14)}" cy="${PAD + 17}" r="4" fill="${color}" ${busy ? ` style="animation:pulse 1.4s ${n1(-((now % 1400) / 1000))}s infinite"` : ''}/>`)
      parts.push(text(cx + 24, PAD + 21.5, label, 12, color, `${SANS} font-weight="800" letter-spacing="1"`))
    } else {
      parts.push(text(cx + 11, PAD + 21.5, label, 12, color, `${MONO} font-weight="700"`))
    }
    cx -= 8
  }

  const top = PAD + headH
  const leftW = isWide ? Math.round((W - 2 * PAD - GAP) * 0.66) : W - 2 * PAD
  const rightX = isWide ? PAD + leftW + GAP : PAD
  const rightW = isWide ? W - PAD - rightX : W - 2 * PAD

  // —— the office, framed ——
  const feedMin = 44 + (isWide ? 5 : 8) * 24
  const sceneInner = leftW - 16
  const sceneScale = sceneInner / SCENE_W
  // a crowded office can grow very tall: cap it, centred, so the panel stays in proportion
  const maxSceneH = isWide ? Math.max(340, (input.fill ?? 900) - top - (16 + GAP + 64)) : 900
  const fitScale = Math.min(sceneScale, maxSceneH / scene.height)
  const sceneH = Math.round(scene.height * fitScale)
  const sceneDrawW = SCENE_W * fitScale
  // side by side the frame runs to the pane's foot, the room centred in it
  const sceneFrameH = isWide ? Math.max(sceneH + 16, (input.fill ?? 0) - top - GAP - 64) : sceneH + 16
  const sceneY = top + Math.round((sceneFrameH - sceneH) / 2)
  parts.push(panel(PAD, top, leftW, sceneFrameH, undefined, C.orange))
  parts.push(
    `<g transform="translate(${n1(PAD + 8 + (sceneInner - sceneDrawW) / 2)} ${sceneY}) scale(${fitScale.toFixed(4)})"><clipPath id="h-sc${scene.height}"><rect width="${SCENE_W}" height="${scene.height}" rx="8"/></clipPath><g clip-path="url(#h-sc${scene.height})">${scene.body}</g></g>`,
  )

  // —— "now": one plain line of what the boss is doing ——
  const nowY = top + sceneFrameH + GAP
  const nowH = 64
  parts.push(panel(PAD, nowY, leftW, nowH, undefined, C.gold))
  if (boss) {
    parts.push(`<g transform="translate(${PAD + 18},${nowY + 18}) scale(1.9)">${activityBadge(boss, 0, 0, 'now') || `<circle cx="7" cy="7" r="6" fill="${C.dim}"/>`}</g>`)
  }
  parts.push(text(PAD + 58, nowY + 27, `BOSS · ${(boss ? activityLabel(boss) : 'Idle').toUpperCase()}`, 12, C.gold, `${SANS} font-weight="800" letter-spacing="1.4"`))
  const nowLine = boss?.bubble || (busy ? 'Working…' : 'Waiting for a new job')
  parts.push(text(PAD + 58, nowY + 48, clip(nowLine, fits(leftW - 80, 14)), 14, C.text, `${SANS} font-weight="600"`))
  const leftBottom = nowY + nowH

  // the context and the limits live in the room itself (the tank, the limit clock,
  // the week's calendar): the column beside it holds the session and the team
  const limits = usage.limits.slice(0, 3)
  let ry = isWide ? top : leftBottom + GAP

  // —— session figures ——
  const tools = Object.values(stats.tools).reduce((a, b) => a + b, 0)
  const tiles: Array<[string, string, string]> = [
    ['TURNS', String(turn.turns), C.text],
    ['TOOLS', String(tools), C.cyan],
    ['AGENTS', String(stats.hired), C.violet],
    ['OUTPUT', fmtTokens(stats.outTokens), C.orange],
    ['COST', usage.usd === undefined ? '—' : `$${usage.usd.toFixed(2)}`, C.gold],
    ['TIME', fmtDuration(now - (stats.sessionStart || now)).replace(/ \d+s$/, ''), C.green],
  ]
  const perRow = rightW >= 420 ? 3 : 2
  const tileW = (rightW - 36 - (perRow - 1) * 10) / perRow
  const tileRows = Math.ceil(tiles.length / perRow)
  const statH = 44 + tileRows * 58
  parts.push(panel(rightX, ry, rightW, statH, 'SESSION', C.violet))
  tiles.forEach(([label, value, color], i) => {
    const tx = rightX + 18 + (i % perRow) * (tileW + 10)
    const ty = ry + 40 + Math.floor(i / perRow) * 58
    parts.push(`<rect x="${n1(tx)}" y="${ty}" width="${n1(tileW)}" height="50" rx="10" fill="${C.tile}" stroke="${C.line}"/>`)
    parts.push(text(tx + 12, ty + 29, clip(value, fits(tileW - 20, 18, true)), 18, color, `${MONO} font-weight="800"`))
    parts.push(text(tx + 12, ty + 43, label, 9.5, C.muted, `${SANS} font-weight="700" letter-spacing="1.2"`))
  })
  ry += statH + GAP

  // —— team: as many rows as its height holds ——
  const teamY = ry
  const teamNatural = 44 + Math.max(1, Math.min(team.length, 8)) * 30 + (team.length > 8 ? 22 : 0)
  const drawTeam = (h: number) => {
    const fitsAll = Math.max(1, Math.floor((h - 44) / 30))
    const shown = team.slice(0, team.length > fitsAll ? Math.max(1, Math.floor((h - 66) / 30)) : fitsAll)
    parts.push(panel(rightX, teamY, rightW, h, `TEAM · ${team.filter(w => w.endedAt === undefined).length} ACTIVE`, C.green))
    if (shown.length === 0) parts.push(text(rightX + 18, teamY + 62, 'Subagents show up here as they start', 13, C.muted, SANS))
    shown.forEach((w, i) => {
      const y = teamY + 42 + i * 30
      const st = activityLabel(w)
      const stColor = w.activity === 'done' ? C.green : w.activity === 'failed' ? C.red : w.activity === 'waiting' ? C.amber : C.muted
      parts.push(`<rect x="${rightX + 18}" y="${y + 4}" width="12" height="12" rx="3" fill="${w.color}" filter="url(#h-glow)"/>`)
      parts.push(text(rightX + 40, y + 15, w.name, 13.5, C.text, `${SANS} font-weight="700"`))
      parts.push(text(rightX + 40 + w.name.length * 7.8 + 8, y + 15, w.role, 12, C.dim, SANS))
      parts.push(text(rightX + rightW - 18, y + 15, clip(st, 18), 12, stColor, `${SANS} font-weight="700" text-anchor="end"`))
    })
    if (team.length > shown.length) parts.push(text(rightX + 18, teamY + h - 14, `+${team.length - shown.length} more`, 12, C.dim, SANS))
  }

  // —— live feed: as many of the latest events as its height holds ——
  const rowH = 24
  const drawFeed = (x: number, y: number, w: number, h: number) => {
    const items = feed.slice(-Math.max(1, Math.floor((h - 44) / rowH))).reverse()
    parts.push(panel(x, y, w, h, 'LIVE FEED', C.orange))
    if (items.length === 0) parts.push(text(x + 18, y + 62, 'Events flow here as Claude works', 13, C.muted, SANS))
    items.forEach((f, i) => {
      const fy = y + 40 + i * rowH
      const fade = i === 0 ? 1 : Math.max(0.45, 1 - i * 0.04)
      parts.push(`<g opacity="${n1(fade)}">`)
      parts.push(text(x + 18, fy + 13, istanbul(f.t).text.slice(0, 5), 11.5, C.dim, MONO))
      parts.push(text(x + 64, fy + 13, FEED_GLYPH[f.kind], 13, f.color, `${SANS} font-weight="800"`))
      parts.push(text(x + 82, fy + 13, f.who, 12.5, f.color, `${SANS} font-weight="700"`))
      const textX = x + 82 + Math.min(12, f.who.length) * 7.2 + 8
      parts.push(text(textX, fy + 13, clip(f.text, fits(x + w - 18 - textX, 12.5)), 12.5, C.text, SANS))
      parts.push(`</g>`)
    })
  }

  // side by side: the room on the left, the team and then the feed on the right;
  // stacked: the team, then the feed down to the pane's foot
  let bottom: number
  if (isWide) {
    // the room takes the left column whole; the feed runs down the right one
    drawTeam(teamNatural)
    const feedY = teamY + teamNatural + GAP
    bottom = Math.max(leftBottom, feedY + feedMin, input.fill ?? 0)
    drawFeed(rightX, feedY, rightW, bottom - feedY)
  } else {
    drawTeam(teamNatural)
    const feedY = teamY + teamNatural + GAP
    bottom = Math.max(feedY + feedMin, input.fill ?? 0)
    drawFeed(rightX, feedY, rightW, bottom - feedY)
  }

  const H = Math.round(bottom + PAD)

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<style>${STYLE}</style><defs>${hudDefs()}${scene.defs}</defs>` +
    `<rect width="${W}" height="${H}" rx="16" fill="${C.bg}"/>` +
    `<g class="${motion ? '' : 'still'}">${parts.join('')}</g></svg>`

  const alt = `${scene.alt} Context ${Math.round(usage.ctxPct ?? 0)}%. ${limits.map(l => `${limitLabel(l.kind)} ${Math.round(l.pct)}%`).join(', ')}`

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
