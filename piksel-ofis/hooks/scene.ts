// The office as SVG drawn fresh from state on each redraw. Every timed
// animation takes a negative delay or begin from the wall clock, so a redraw
// picks a walk or a flight up where it was rather than restarting.
import type { Activity, SiteKind, Stats, ThinkKind, Turn, Usage, Worker } from '../types'
import { THINK_LABEL, clip, hash, istanbul, level } from './logic'

export const ACTIVITY_LABEL: Record<Activity, string> = {
  idle: 'Boşta',
  thinking: 'Düşünüyor',
  answering: 'Cevap yazıyor',
  reading: 'Okuyor',
  writing: 'Yazıyor',
  running: 'Komut çalıştırıyor',
  web: 'Web’de',
  planning: 'Planlıyor',
  delegating: 'Görev dağıtıyor',
  waiting: 'Seni bekliyor',
  compacting: 'Bağlamı sıkıştırıyor',
  done: 'Bitirdi',
  failed: 'Hata',
  leaving: 'Çıkıyor',
}

export function activityLabel(w: Pick<Worker, 'activity' | 'think'>): string {
  return w.activity === 'thinking' && w.think ? THINK_LABEL[w.think] : ACTIVITY_LABEL[w.activity]
}

/** The scene's own width in its units; the HUD scales it into its frame. */
export const SCENE_W = 480
const W = SCENE_W
const BOSS_TOP = 64
const FLOOR_Y = 184
const COL_W = 160
const ROW_H = 98
export const ARRIVE_MS = 2600
export const LEAVE_MS = 2600
const MAX_DESKS = 24

const GOLD = '#FBBF24'
const GOLD_DARK = '#B45309'
const CLAUDE = '#D97757'

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const n1 = (v: number) => Math.round(v * 10) / 10

/** Rows of one-character pixels as merged runs of rects. */
function pixels(map: readonly string[], palette: Record<string, string>, scale: number, ox: number, oy: number, extra = ''): string {
  let out = ''
  map.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x] as string
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      const fill = palette[ch]
      if (fill) {
        out += `<rect x="${n1(ox + x * scale)}" y="${n1(oy + y * scale)}" width="${(end - x) * scale}" height="${scale}" fill="${fill}"${extra}/>`
      }
      x = end
    }
  })

  return out
}

// Clawd: Claude Code's little worker, recolored per employee.
const CLAWD_ROWS = 7
const CLAWD_LEGS = ['..O.O...O.O..', '..O.O...O.O..']
const CROWN = [
  '..W....W....W..',
  '.YY...YYY...YY.',
  '.YYY.YYYYY.YYY.',
  '.YYYYYYYYYYYYY.',
  '.YYBYYYRYYYBYY.',
  '.YYYYYYYYYYYYY.',
  '.OOOOOOOOOOOOO.',
]

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amount * 255)))
  const r = f((n >> 16) & 255)
  const g = f((n >> 8) & 255)
  const b = f(n & 255)

  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}

export const STYLE = `
.t{font-family:'Styrene B','Anthropic Sans','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif}
.s{font-family:'Tiempos Headline','Copernicus','Anthropic Serif',Georgia,'Times New Roman',serif}
.m{font-family:'Cascadia Code',Consolas,'Fira Code',ui-monospace,monospace}
.fb{transform-box:fill-box;transform-origin:center}
.fbb{transform-box:fill-box;transform-origin:50% 100%}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes typeA{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes typeB{0%,100%{transform:translateY(-3px)}50%{transform:translateY(0)}}
@keyframes look{0%,35%{transform:translateX(-2px)}50%,85%{transform:translateX(2px)}100%{transform:translateX(-2px)}}
@keyframes lookup{0%,100%{transform:translate(1px,-2px)}50%{transform:translate(-1px,-2px)}}
@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.15)}}
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
@keyframes wiggle{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}
@keyframes twinkle{0%,100%{opacity:.15}50%{opacity:1}}
@keyframes shred{0%{transform:translateY(-8px);opacity:1}100%{transform:translateY(16px);opacity:0}}
@keyframes drift{from{transform:translateX(-60px)}to{transform:translateX(360px)}}
@keyframes glow{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes point{0%,100%{transform:translateX(0)}50%{transform:translateX(4px)}}
@keyframes zz{0%{transform:translate(0,0);opacity:0}30%{opacity:1}100%{transform:translate(8px,-14px);opacity:0}}
@keyframes write{0%{stroke-dashoffset:60}100%{stroke-dashoffset:0}}
@keyframes sweep{0%{transform:translateY(-40px);opacity:0}10%{opacity:.5}90%{opacity:.5}100%{transform:translateY(var(--sweep,400px));opacity:0}}
@keyframes shine{0%,70%,100%{opacity:0}80%{opacity:1}}
.still *{animation:none!important}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`

export function anim(name: string, seconds: number, delay = 0, extra = 'infinite'): string {
  return `animation:${name} ${seconds}s ${delay ? `${n1(delay)}s ` : ''}${extra}`
}

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

function phase(seed: string, period: number): number {
  return -((hash(seed) % 1000) / 1000) * period
}

// ——— icons ———————————————————————————————————————————————

export function siteBadge(site: SiteKind, x: number, y: number): string {
  const box = (fill: string, inner: string, stroke = '') =>
    `<g transform="translate(${x},${y})"><rect width="14" height="14" rx="3" fill="${fill}"${stroke}/>${inner}</g>`
  switch (site) {
    case 'youtube':
      return box('#FF0033', '<path d="M5 3.5 L10.5 7 L5 10.5 Z" fill="#fff"/>')
    case 'reddit':
      return box('#FF4500', '<circle cx="7" cy="8" r="4" fill="#fff"/><circle cx="5.5" cy="7.6" r=".9" fill="#FF4500"/><circle cx="8.5" cy="7.6" r=".9" fill="#FF4500"/><circle cx="10" cy="3" r="1.2" fill="#fff"/>')
    case 'x':
      return box('#000', '<path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="#fff" stroke-width="1.8"/>', ' stroke="#475569" stroke-width=".6"')
    case 'wiki':
      return box('#F8FAFC', '<text x="7" y="10.5" text-anchor="middle" font-family="Georgia,serif" font-size="9.5" fill="#111">W</text>')
    case 'github':
      return box('#24292F', '<circle cx="7" cy="7.4" r="3.6" fill="#fff"/><path d="M4.2 4.6 L4.6 2.6 L6 3.9 M9.8 4.6 L9.4 2.6 L8 3.9" fill="#fff" stroke="#fff" stroke-width=".7"/><circle cx="5.8" cy="7.3" r=".6" fill="#24292F"/><circle cx="8.2" cy="7.3" r=".6" fill="#24292F"/>')
    case 'stack':
      return box('#F48024', '<path d="M3.5 10.5 H10.5 M4 8.5 L10 9.2 M4.6 6.4 L10 7.8 M5.6 4.4 L10.4 6.6" stroke="#fff" stroke-width="1.1"/>')
    case 'google':
      return box('#F8FAFC', '<path d="M10.6 6.4 H7 V8 H9 A2.3 2.3 0 1 1 8.3 5.2" fill="none" stroke="#4285F4" stroke-width="1.6"/><circle cx="4.5" cy="10.5" r=".9" fill="#EA4335"/><circle cx="7" cy="11.3" r=".9" fill="#FBBC05"/><circle cx="9.5" cy="10.5" r=".9" fill="#34A853"/>')
    case 'docs':
      return box('#2563EB', '<rect x="4" y="3" width="6" height="8" rx="1" fill="#fff"/><path d="M5 5 H9 M5 7 H9 M5 9 H8" stroke="#2563EB" stroke-width=".8"/>')
    case 'paper':
      return box('#FEF3C7', '<text x="7" y="9.6" text-anchor="middle" class="m" font-size="5" font-weight="700" fill="#92400E">PDF</text>')
    case 'claude':
      return box(CLAUDE, starburst(7, 7, 4.5, '#FFF7ED'))
    case 'web':
      return box('#0EA5E9', '<circle cx="7" cy="7" r="4.2" fill="none" stroke="#fff" stroke-width="1"/><path d="M2.8 7 H11.2 M7 2.8 C4.5 5 4.5 9 7 11.2 C9.5 9 9.5 5 7 2.8" fill="none" stroke="#fff" stroke-width=".8"/>')
  }
}

export function starburst(cx: number, cy: number, r: number, fill: string): string {
  let rays = ''
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    rays += `<line x1="${cx}" y1="${cy}" x2="${n1(cx + Math.cos(a) * r)}" y2="${n1(cy + Math.sin(a) * r)}" stroke="${fill}" stroke-width="${n1(r / 3.2)}" stroke-linecap="round"/>`
  }

  return rays
}

export function thinkIcon(kind: ThinkKind, x: number, y: number, ink = '#E2E8F0'): string {
  const g = (inner: string) => `<g transform="translate(${x},${y})">${inner.replace(/#E2E8F0/g, ink)}</g>`
  switch (kind) {
    case 'plan':
      return g('<rect x="2" y="1" width="10" height="12" rx="1.5" fill="#E2E8F0"/><rect x="4.5" y="0" width="5" height="2.5" rx="1" fill="#64748B"/><path d="M4 5 H10 M4 7.5 H10 M4 10 H8" stroke="#4A4339" stroke-width="1"/>')
    case 'debug':
      return g('<circle cx="6" cy="6" r="3.8" fill="none" stroke="#E2E8F0" stroke-width="1.6"/><path d="M8.8 8.8 L12.5 12.5" stroke="#E2E8F0" stroke-width="2" stroke-linecap="round"/><circle cx="6" cy="6" r="1.6" fill="#EF4444"/>')
    case 'research':
      return g('<path d="M1 3 Q4 1.5 7 3 Q10 1.5 13 3 V12 Q10 10.5 7 12 Q4 10.5 1 12 Z" fill="#E2E8F0"/><path d="M7 3 V12" stroke="#64748B" stroke-width=".8"/>')
    case 'design':
      return g('<path d="M7 1 A6 6 0 1 0 7 13 C8 13 8.5 12 8 11 C7.5 10 8 9 9.5 9 H11 A2 2 0 0 0 13 7 A6 6 0 0 0 7 1 Z" fill="#E2E8F0"/><circle cx="4.5" cy="5" r="1.2" fill="#EF4444"/><circle cx="7.5" cy="3.8" r="1.2" fill="#22C55E"/><circle cx="10" cy="5.6" r="1.2" fill="#3B82F6"/><circle cx="4" cy="8.4" r="1.2" fill="#F59E0B"/>')
    case 'decide':
      return g('<path d="M7 1.5 V12 M3 12 H11 M2 4 H12" stroke="#E2E8F0" stroke-width="1.2"/><path d="M2 4 L0.5 8 H3.5 Z M12 4 L10.5 8 H13.5 Z" fill="#E2E8F0"/>')
    case 'code':
      return g('<path d="M4.5 3.5 L1.5 7 L4.5 10.5 M9.5 3.5 L12.5 7 L9.5 10.5 M8 2.5 L6 11.5" fill="none" stroke="#E2E8F0" stroke-width="1.4" stroke-linecap="round"/>')
    case 'math':
      return g('<rect x="2" y="1" width="10" height="12" rx="1.5" fill="#E2E8F0"/><rect x="3.5" y="2.5" width="7" height="3" fill="#4A4339"/><path d="M4.5 8 H5.5 M8.5 8 H9.5 M4.5 10.5 H5.5 M8.5 10.5 H9.5" stroke="#4A4339" stroke-width="1.2"/>')
    case 'general':
      return g(
        [0, 1, 2]
          .map(i => `<circle cx="${3 + i * 4}" cy="7" r="1.4" fill="#E2E8F0" style="${anim('dots', 1.2, -1.2 + i * 0.2)}"/>`)
          .join(''),
      )
  }
}

/** The badge floating beside a head: what the worker is busy with. */
export function activityBadge(w: Pick<Worker, 'activity' | 'think' | 'site'>, x: number, y: number, seed: string): string {
  const d = phase(seed, 2)
  switch (w.activity) {
    case 'thinking':
      return `<g style="${anim('float', 2.2, d)}"><circle cx="${x + 7}" cy="${y + 7}" r="9" fill="#3A332D" stroke="#94A3B8" stroke-width=".7"/><circle cx="${x - 2}" cy="${y + 17}" r="1.8" fill="#3A332D"/><circle cx="${x - 5}" cy="${y + 21}" r="1.1" fill="#3A332D"/>${thinkIcon(w.think ?? 'general', x, y)}</g>`
    case 'reading':
      return `<g style="${anim('float', 1.8, d)}"><rect x="${x + 1}" y="${y}" width="11" height="14" rx="1.5" fill="#F8FAFC"/><path d="M${x + 3} ${y + 4} H${x + 10} M${x + 3} ${y + 7} H${x + 10} M${x + 3} ${y + 10} H${x + 8}" stroke="#64748B" stroke-width="1"/></g>`
    case 'writing':
    case 'answering':
      return `<g class="fb" style="${anim('wiggle', 0.5, d)}"><path d="M${x + 2} ${y + 12} L${x + 3} ${y + 8} L${x + 10} ${y + 1} L${x + 13} ${y + 4} L${x + 6} ${y + 11} Z" fill="${GOLD}"/><path d="M${x + 2} ${y + 12} L${x + 3} ${y + 8} L${x + 6} ${y + 11} Z" fill="#3A332D"/></g>`
    case 'running':
      return `<g class="fb" style="${anim('spin', 2.4, d, 'linear infinite')}"><circle cx="${x + 7}" cy="${y + 7}" r="4.5" fill="none" stroke="#22D3EE" stroke-width="3" stroke-dasharray="2.4 1.6"/><circle cx="${x + 7}" cy="${y + 7}" r="2" fill="#22D3EE"/></g>`
    case 'web':
      return `<g style="${anim('float', 1.6, d)}">${siteBadge(w.site ?? 'web', x, y)}</g>`
    case 'planning':
      return thinkIcon('plan', x, y)
    case 'delegating':
      return `<g style="${anim('point', 0.8, d)}"><path d="M${x} ${y + 7} L${x + 14} ${y + 1} L${x + 9} ${y + 14} L${x + 7} ${y + 9} Z" fill="#F8FAFC"/><path d="M${x + 7} ${y + 9} L${x + 14} ${y + 1}" stroke="#94A3B8" stroke-width=".6"/></g>`
    case 'waiting':
      return `<g style="${anim('pulse', 1.1)}"><circle cx="${x + 7}" cy="${y + 7}" r="7" fill="#F59E0B"/><text x="${x + 7}" y="${y + 11}" text-anchor="middle" class="t" font-size="11" font-weight="800" fill="#3A332D">?</text></g>`
    case 'done':
      return `<g class="fb"><circle cx="${x + 7}" cy="${y + 7}" r="7" fill="#22C55E"/><path d="M${x + 3.5} ${y + 7.5} L${x + 6} ${y + 10} L${x + 10.5} ${y + 4.5}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>`
    case 'failed':
      return `<g style="${anim('shake', 0.4)}"><circle cx="${x + 7}" cy="${y + 7}" r="7" fill="#EF4444"/><path d="M${x + 7} ${y + 3} V${y + 8.5}" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="${x + 7}" cy="${y + 11}" r="1.1" fill="#fff"/></g>`
    case 'compacting':
      return `<g class="fb" style="${anim('spin', 1.4, 0, 'linear infinite')}"><path d="M${x + 7} ${y + 1} A6 6 0 1 1 ${x + 1} ${y + 7}" fill="none" stroke="#38BDF8" stroke-width="2"/><path d="M${x} ${y + 3} L${x + 1} ${y + 7} L${x + 5} ${y + 6}" fill="none" stroke="#38BDF8" stroke-width="1.6"/></g>`
    case 'idle':
    case 'leaving':
      return ''
  }
}

// ——— monitor screens ———————————————————————————————————————

function screen(w: Worker, x: number, y: number, sw: number, sh: number, id: string, seed: string): string {
  const clipDef = `<clipPath id="c${id}"><rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="1"/></clipPath>`
  const body = (bg: string, inner: string) =>
    `${clipDef}<rect x="${x}" y="${y}" width="${sw}" height="${sh}" rx="1" fill="${bg}"/><g clip-path="url(#c${id})">${inner}</g>`
  const lines = (color: string, count: number, step: number, widths: number[], x0: number) =>
    Array.from({ length: count }, (_, i) => {
      const lw = Math.max(4, Math.round((widths[i % widths.length] as number) * (sw - 8)))

      return `<rect x="${n1(x0)}" y="${y + 3 + i * step}" width="${lw}" height="1.6" rx=".8" fill="${color}"/>`
    }).join('')
  const d = phase(seed, 3)

  switch (w.activity) {
    case 'reading':
      return body('#E2E8F0', `<g style="${anim('scroll', 3, d, 'linear infinite')}">${lines('#64748B', 9, 3, [0.9, 0.7, 0.85, 0.5, 0.95, 0.6], x + 3)}</g>`)
    case 'writing':
    case 'answering': {
      const colors = ['#F472B6', '#38BDF8', '#A3E635', '#FBBF24', '#C4B5FD']
      const rows = Array.from({ length: 8 }, (_, i) => {
        const indent = (i % 3) * 3
        const lw = 6 + (hash(seed + i) % 14)

        return `<rect x="${x + 3 + indent}" y="${y + 3 + i * 3}" width="${Math.min(lw, sw - 6 - indent)}" height="1.6" rx=".8" fill="${colors[i % colors.length]}"/>`
      }).join('')

      return body('#1F1C19', `<g style="${anim('scroll', 2.2, d, 'steps(4) infinite')}">${rows}</g><rect x="${x + sw - 6}" y="${y + sh - 5}" width="2" height="3" fill="#F8FAFC" style="${anim('caret', 0.9)}"/>`)
    }
    case 'running':
      return body('#1A1816', `<g style="${anim('scroll', 1.6, d, 'steps(4) infinite')}">${lines('#22C55E', 8, 3, [0.6, 0.35, 0.8, 0.45, 0.7], x + 3)}</g><text x="${x + 2}" y="${y + sh - 2}" class="m" font-size="5" fill="#4ADE80">$_</text>`)
    case 'web': {
      const top: Record<SiteKind, string> = {
        youtube: '#FF0033', reddit: '#FF4500', x: '#000', wiki: '#CBD5E1', github: '#24292F', stack: '#F48024',
        google: '#4285F4', docs: '#2563EB', paper: '#D97706', claude: CLAUDE, web: '#0EA5E9',
      }

      return body('#F8FAFC', `<rect x="${x}" y="${y}" width="${sw}" height="4" fill="${top[w.site ?? 'web']}"/><rect x="${x + 3}" y="${y + 6}" width="${n1(sw * 0.45)}" height="${sh - 9}" rx="1" fill="#CBD5E1" style="${anim('pulse', 2.4, d)}"/>${lines('#94A3B8', 4, 3, [0.4, 0.35, 0.42, 0.3], x + sw * 0.55)}`)
    }
    case 'thinking':
      return body('#24201C', [0, 1, 2].map(i => `<circle cx="${n1(x + sw / 2 - 5 + i * 5)}" cy="${n1(y + sh / 2)}" r="1.3" fill="#94A3B8" style="${anim('dots', 1.2, -1.2 + i * 0.2)}"/>`).join(''))
    case 'planning':
      return body('#F8FAFC', [0, 1, 2, 3].map(i => `<rect x="${x + 3}" y="${y + 3 + i * 4}" width="2.5" height="2.5" fill="${i < 2 ? '#22C55E' : '#CBD5E1'}"/><rect x="${x + 8}" y="${y + 3.5 + i * 4}" width="${sw - 14}" height="1.6" fill="#64748B"/>`).join(''))
    case 'done':
      return body('#052E16', `<path d="M${n1(x + sw / 2 - 5)} ${n1(y + sh / 2)} L${n1(x + sw / 2 - 1)} ${n1(y + sh / 2 + 4)} L${n1(x + sw / 2 + 6)} ${n1(y + sh / 2 - 4)}" fill="none" stroke="#22C55E" stroke-width="2.2"/>`)
    case 'failed':
      return body('#450A0A', `<path d="M${n1(x + sw / 2 - 4)} ${n1(y + sh / 2 - 4)} L${n1(x + sw / 2 + 4)} ${n1(y + sh / 2 + 4)} M${n1(x + sw / 2 + 4)} ${n1(y + sh / 2 - 4)} L${n1(x + sw / 2 - 4)} ${n1(y + sh / 2 + 4)}" stroke="#EF4444" stroke-width="2.2"/>`)
    case 'waiting':
      return body('#451A03', `<text x="${n1(x + sw / 2)}" y="${n1(y + sh / 2 + 4)}" text-anchor="middle" class="t" font-size="11" font-weight="800" fill="#F59E0B" style="${anim('pulse', 1)}">?</text>`)
    default:
      return body('#070B18', `<g style="${anim('glow', 4, d)}">${starburst(n1(x + sw / 2), n1(y + sh / 2), 3.2, CLAUDE)}</g>`)
  }
}

// ——— characters ————————————————————————————————————————

/** One Clawd at pixel size `s`: body, arms (typing when busy), eyes (reading, looking up). */
function clawd(color: string, x: number, y: number, w: Pick<Worker, 'activity'>, seed: string, withLegs: boolean, s = 3): string {
  const d = phase(seed, 2)
  const dark = shade(color, -0.18)
  const light = shade(color, 0.14)
  const isTyping = w.activity === 'writing' || w.activity === 'answering' || w.activity === 'running'
  const eyes =
    w.activity === 'reading' || w.activity === 'web'
      ? `animation:look 1.6s ${n1(d)}s infinite`
      : w.activity === 'thinking'
        ? `animation:lookup 2.4s ${n1(d)}s infinite`
        : ''
  const body =
    `<rect x="${x + 2 * s}" y="${y}" width="${9 * s}" height="${CLAWD_ROWS * s}" fill="${color}"/>` +
    `<rect x="${x + 2 * s}" y="${y}" width="${9 * s}" height="${s}" fill="${light}"/>` +
    `<rect x="${x + 2 * s}" y="${y + 6 * s}" width="${9 * s}" height="${s}" fill="${dark}"/>`
  const arm = (side: 'L' | 'R') => {
    const ax = side === 'L' ? x : x + 11 * s
    const style = isTyping ? `style="animation:${side === 'L' ? 'typeA' : 'typeB'} .28s ${n1(d)}s infinite"` : ''

    return `<g ${style}><rect x="${ax}" y="${y + 3 * s}" width="${2 * s}" height="${2 * s}" fill="${color}"/><rect x="${ax}" y="${y + 4 * s}" width="${2 * s}" height="${s}" fill="${dark}"/></g>`
  }
  const eye = (cx: number) =>
    `<rect class="fb" x="${x + cx * s}" y="${y + 1 * s}" width="${s}" height="${2 * s}" fill="#141414" style="animation:blink 4.2s ${n1(phase(seed + cx, 4.2))}s infinite"/>`
  const legs = withLegs ? `<g style="animation:typeA .3s infinite">${pixels(CLAWD_LEGS, { O: dark }, s, x, y + 7 * s)}</g>` : ''
  const mood =
    w.activity === 'done'
      ? `style="animation:jump 1.4s ${n1(d)}s infinite"`
      : w.activity === 'failed'
        ? 'style="animation:shake .45s infinite"'
        : `style="animation:bob 2.6s ${n1(d)}s infinite"`

  return `<g ${mood}>${body}${arm('L')}${arm('R')}<g style="${eyes}">${eye(4)}${eye(8)}</g>${legs}</g>`
}

/** The boss: an orange Clawd king with crown, red ermine mantle and sceptre. */
function king(x: number, y: number, w: Worker): string {
  const s = 4
  const capeTop = y + 2 * s
  let out = ''
  // mantle behind the body, its ermine edges either side
  out += `<path d="M${x - 4} ${capeTop + 4} Q${x - 6} ${y + 40} ${x - 2} ${y + 44} H${x + 13 * s + 2} Q${x + 13 * s + 6} ${y + 40} ${x + 13 * s + 4} ${capeTop + 4} Z" fill="#B91C1C"/>`
  out += `<path d="M${x - 4} ${capeTop + 4} Q${x + 6.5 * s} ${capeTop - 6} ${x + 13 * s + 4} ${capeTop + 4}" fill="none" stroke="#7F1D1D" stroke-width="3"/>`
  for (const ex of [x - 5, x + 13 * s - 1]) {
    out += `<rect x="${ex}" y="${capeTop + 4}" width="6" height="${y + 42 - capeTop - 4}" rx="2" fill="#F8FAFC"/>`
    for (let ey = capeTop + 8; ey < y + 40; ey += 7) out += `<rect x="${ex + 2}" y="${ey}" width="2" height="3" fill="#231F1C"/>`
  }
  out += clawd(CLAUDE, x, y, w, 'boss', false, s)
  // ermine collar across the shoulders
  out += `<rect x="${x + 2 * s}" y="${y + 5 * s}" width="${9 * s}" height="5" fill="#F8FAFC"/>`
  for (let cx = x + 2 * s + 3; cx < x + 11 * s - 2; cx += 7) out += `<rect x="${cx}" y="${y + 5 * s + 1}" width="2" height="3" fill="#231F1C"/>`
  // crown, with a glint that runs across now and then
  const crownX = x + 6.5 * s - 15
  const crownY = y - 15
  out += `<g style="${anim('float', 3.2)}">${pixels(CROWN, { Y: GOLD, O: GOLD_DARK, W: '#FDE68A', R: '#EF4444', B: '#3B82F6' }, 2, crownX, crownY)}<rect x="${crownX + 4}" y="${crownY + 6}" width="3" height="6" fill="#FFF7D6" opacity="0" style="${anim('shine', 4.5, -1.2)}"/></g>`
  // sceptre in the right hand
  const sx = x + 13 * s + 1
  out += `<g class="fbb" style="${w.activity === 'delegating' ? 'animation:wiggle .7s infinite' : ''}"><rect x="${sx}" y="${y - 2}" width="3" height="${y + 34 - (y - 2)}" rx="1.5" fill="${GOLD}"/><circle cx="${sx + 1.5}" cy="${y - 5}" r="4.5" fill="${GOLD}"/><circle cx="${sx + 1.5}" cy="${y - 5}" r="2" fill="#EF4444"/><rect x="${sx}" y="${y - 13}" width="3" height="5" fill="${GOLD}"/><rect x="${sx - 1.5}" y="${y - 11.5}" width="6" height="2" fill="${GOLD}"/></g>`

  return out
}

// ——— bubbles —————————————————————————————————————————————

function bubble(text: string, cx: number, y: number, maxW: number, tailX: number, minX = 2, maxX = W - 2, tone: 'light' | 'warn' | 'royal' = 'light'): string {
  if (!text) return ''
  const chars = Math.max(4, Math.floor((maxW - 12) / 4.55))
  const line = clip(text, chars)
  const width = Math.min(maxW, Math.max(36, line.length * 4.55 + 12))
  let left = cx - width / 2
  left = Math.max(minX, Math.min(maxX - width, left))
  const fill = tone === 'warn' ? '#FEF3C7' : tone === 'royal' ? '#FFF7E6' : '#F8FAFC'
  const stroke = tone === 'royal' ? GOLD : '#2A2522'
  const tx = Math.max(left + 6, Math.min(left + width - 6, tailX))

  return `<g><rect x="${n1(left)}" y="${y}" width="${n1(width)}" height="15" rx="5" fill="${fill}" stroke="${stroke}" stroke-opacity="${tone === 'royal' ? 0.9 : 0.25}"/><path d="M${n1(tx - 3)} ${y + 14.5} L${n1(tx)} ${y + 19} L${n1(tx + 3)} ${y + 14.5} Z" fill="${fill}"/><text x="${n1(left + width / 2)}" y="${y + 10.5}" text-anchor="middle" class="t" font-size="8.2" font-weight="600" fill="#2A2522">${esc(line)}</text></g>`
}

// ——— the room ——————————————————————————————————————————

function windowStrip(now: number, x0: number, x1: number): string {
  const { h } = istanbul(now)
  const night = h < 6 || h >= 20
  const dusk = h >= 17 && h < 20
  const dawn = h >= 6 && h < 8
  const [top, bottom] = night ? ['#050816', '#1E1B4B'] : dusk ? ['#7C3AED', '#F97316'] : dawn ? ['#FDA4AF', '#FDE68A'] : ['#3B82F6', '#BFDBFE']
  const width = x1 - x0
  let out = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><clipPath id="win"><rect x="${x0}" y="8" width="${width}" height="48" rx="2"/></clipPath></defs>`
  out += `<rect x="${x0}" y="8" width="${width}" height="48" fill="url(#sky)"/><g clip-path="url(#win)">`
  if (night) {
    for (let i = 0; i < 26; i++) {
      const sx = x0 + (hash('s' + i) % width)
      const sy = 10 + (hash('y' + i) % 26)
      out += `<circle cx="${sx}" cy="${sy}" r="${i % 5 === 0 ? 0.9 : 0.55}" fill="#fff" style="${anim('twinkle', 2 + (i % 4), -(i % 7) * 0.4)}"/>`
    }
    out += `<circle cx="${x1 - 40}" cy="20" r="6" fill="#F1F5F9"/><circle cx="${x1 - 37}" cy="18" r="5.5" fill="${top}"/>`
  } else {
    const sunY = dusk ? 40 : dawn ? 38 : 18
    out += `<circle cx="${x1 - 50}" cy="${sunY}" r="7" fill="${dusk || dawn ? '#FDBA74' : '#FDE047'}"/>`
    out += `<g style="${anim('drift', 70, -((now / 1000) % 70), 'linear infinite')}"><ellipse cx="${x0 + 30}" cy="18" rx="13" ry="4" fill="#fff" opacity=".85"/><ellipse cx="${x0 + 120}" cy="26" rx="10" ry="3.2" fill="#fff" opacity=".7"/></g>`
  }
  let bx = x0 - 4
  let i = 0
  const neon = ['#D97757', '#D4A27F', '#E3A04F', '#F0EEE6']
  while (bx < x1) {
    const bw = 14 + (hash('bw' + i) % 18)
    const bh = 14 + (hash('bh' + i) % 28)
    const by = 56 - bh
    out += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${night ? '#0B1024' : dusk ? '#3B0764' : '#475569'}" opacity="${night ? 1 : 0.85}"/>`
    if (night && i % 4 === 1) out += `<rect x="${bx + 2}" y="${by + 2}" width="${bw - 4}" height="2" fill="${neon[i % neon.length]}" style="${anim('glow', 3, -i)}"/>`
    if (night || dusk) {
      for (let wy = by + 5; wy < 54; wy += 5) {
        for (let wx = bx + 2; wx < bx + bw - 3; wx += 4) {
          const k = hash(`${i}-${wx}-${wy}`)
          if (k % 3 === 0) {
            out += `<rect x="${wx}" y="${wy}" width="2" height="2" fill="#FDE68A"${k % 11 === 0 ? ` style="${anim('twinkle', 5, -(k % 5))}"` : ' opacity=".75"'}/>`
          }
        }
      }
    }
    bx += bw + 2
    i++
  }
  out += `</g>`
  for (let mx = x0; mx <= x1; mx += width / 3) out += `<rect x="${n1(mx - 1.5)}" y="8" width="3" height="48" fill="#3A332D"/>`
  out += `<rect x="${x0 - 2}" y="6" width="${width + 4}" height="3" fill="#4A4339"/><rect x="${x0 - 2}" y="55" width="${width + 4}" height="3" fill="#4A4339"/>`

  return out
}


const limitTone = (pct: number) => (pct >= 90 ? '#E0685A' : pct >= 75 ? '#E3A04F' : '#8FAE6B')
const pad2 = (n: number) => String(n).padStart(2, '0')

/** Where on a 12-hour dial a moment falls, in degrees from twelve. */
function dialAngle(t: number): number {
  const { h, m } = istanbul(t)

  return ((h % 12) + m / 60) * 30
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180

  return [n1(cx + r * Math.cos(a)), n1(cy + r * Math.sin(a))]
}

/**
 * The limit clock: an analog face whose arc runs from now to the moment the
 * 5-hour limit resets (a dot there), the digital time beside it, the 5-hour % and
 * its reset written out, and the week as seven calendar days, the reset day ringed.
 */
function limitClock(now: number, usage: Usage, cx: number, cy: number): string {
  const r = 24
  const five = usage.limits.find(l => l.kind === 'five_hour')
  const week = usage.limits.find(l => l.kind === 'seven_day')
  const fiveReset = five?.resetsAt ? Date.parse(five.resetsAt) : NaN
  const fiveOn = five !== undefined && Number.isFinite(fiveReset) && fiveReset > now
  const fivePct = fiveOn && five ? five.pct : 0
  let out = '<g><title>Limit saati: renkli yay, şimdiden 5 saatlik limitin sıfırlanacağı ana kadar</title>'
  out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F0EEE6" stroke="#D4A27F" stroke-width="2"/>`
  for (let i = 0; i < 12; i++) {
    const [x1, y1] = polar(cx, cy, r - 2, i * 30)
    const [x2, y2] = polar(cx, cy, r - (i % 3 === 0 ? 6 : 4), i * 30)
    out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5E5D59" stroke-width="${i % 3 === 0 ? 1.4 : 0.8}"/>`
  }
  if (fiveOn && fiveReset - now < 12 * 3_600_000) {
    const a0 = dialAngle(now)
    let a1 = dialAngle(fiveReset)
    if (a1 <= a0) a1 += 360
    const [sx, sy] = polar(cx, cy, r - 9, a0)
    const [ex, ey] = polar(cx, cy, r - 9, a1)
    const color = limitTone(fivePct)
    out += `<path d="M${sx} ${sy} A${r - 9} ${r - 9} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${ex} ${ey}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity=".85"/>`
    const [dx, dy] = polar(cx, cy, r + 1, a1)
    out += `<circle cx="${dx}" cy="${dy}" r="3.2" fill="${color}" stroke="#1F1E1D" stroke-width="1"><title>Sıfırlanma anı</title></circle>`
  }
  const { h, m, s } = istanbul(now)
  const [hx, hy] = polar(cx, cy, r - 12, ((h % 12) + m / 60) * 30)
  const [mx, my] = polar(cx, cy, r - 5, m * 6)
  out += `<line x1="${cx}" y1="${cy}" x2="${hx}" y2="${hy}" stroke="#141413" stroke-width="2.4" stroke-linecap="round"/><line x1="${cx}" y1="${cy}" x2="${mx}" y2="${my}" stroke="#141413" stroke-width="1.5" stroke-linecap="round"/>`
  // the second hand turns on its own, started where the real second is
  out += `<g transform="rotate(${s * 6} ${cx} ${cy})"><g style="transform-origin:${cx}px ${cy}px;animation:spin 60s linear infinite"><line x1="${cx}" y1="${cy + 3}" x2="${cx}" y2="${cy - r + 4}" stroke="${CLAUDE}" stroke-width=".8"/></g></g><circle cx="${cx}" cy="${cy}" r="1.8" fill="${CLAUDE}"/>`
  // the digital side
  const x = cx + r + 9
  out += `<text x="${x}" y="${cy - 9}" class="s" font-size="15" fill="#F0EEE6">${pad2(h)}:${pad2(m)}</text>`
  if (five) {
    out += `<text x="${x}" y="${cy + 3}" class="t" font-size="7" font-weight="800" letter-spacing=".6" fill="${limitTone(fivePct)}">${fiveOn ? `5 SAAT %${Math.round(fivePct)}` : '5 SAAT BOŞTA'}</text>`
    const rt = istanbul(fiveReset)
    out += fiveOn
      ? `<text x="${x}" y="${cy + 12}" class="t" font-size="6.6" fill="#D4A27F">${pad2(rt.h)}:${pad2(rt.m)} sıfırlanır</text>`
      : `<text x="${x}" y="${cy + 12}" class="t" font-size="6.6" fill="#85837A">ilk mesajla başlar</text>`
  } else {
    out += `<text x="${x}" y="${cy + 6}" class="t" font-size="6.6" fill="#85837A">limitler ilk yanıtta gelir</text>`
  }
  // the week: seven days from today, the used share filled, the reset day ringed
  if (week) {
    const wr = week.resetsAt ? Date.parse(week.resetsAt) : NaN
    const resetDay = Number.isFinite(wr) && wr > now ? Math.min(6, Math.floor((wr - now) / 86_400_000)) : -1
    const filled = Math.round((Math.min(100, week.pct) / 100) * 7)
    const DAY = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct']
    const today = new Date(now + 3 * 3_600_000).getUTCDay()
    for (let i = 0; i < 7; i++) {
      const bx = x + i * 11
      const name = DAY[(today + i) % 7] as string
      out += `<rect x="${bx}" y="${cy + 16}" width="9.5" height="9" rx="1.5" fill="${i < filled ? limitTone(week.pct) : '#3A3934'}" stroke="${i === resetDay ? CLAUDE : 'none'}" stroke-width="1.4"><title>${name}${i === resetDay ? ': haftalık limit sıfırlanır' : ''}</title></rect>`
      out += `<text x="${n1(bx + 4.75)}" y="${cy + 22.6}" text-anchor="middle" class="t" font-size="4.6" font-weight="700" fill="${i < filled ? '#1F1E1D' : '#85837A'}">${name}</text>`
    }
    out += `<text x="${x + 50}" y="${cy - 10}" class="t" font-size="7" font-weight="800" letter-spacing=".6" fill="${limitTone(week.pct)}">HAFTA %${Math.round(week.pct)}</text>`
  }

  return `${out}</g>`
}

/** The context tank: how full the context is, the auto compact line across it. */
function contextTank(usage: Usage, x: number, y: number, mark?: number): string {
  const w = 20
  const tall = 50
  const pct = Math.max(0, Math.min(100, usage.ctxPct ?? 0))
  const color = pct >= 85 ? '#E0685A' : pct >= 60 ? '#E3A04F' : '#6A9BCC'
  const fill = n1((tall - 4) * (pct / 100))
  let out = `<g><title>Bağlam %${Math.round(pct)}</title><rect x="${x}" y="${y}" width="${w}" height="${tall}" rx="4" fill="#1F1E1D" stroke="#D4A27F" stroke-opacity=".6"/>`
  out += `<rect x="${x + 2}" y="${n1(y + tall - 2 - fill)}" width="${w - 4}" height="${fill}" rx="2" fill="${color}" opacity=".85"/>`
  out += `<rect x="${x + 4}" y="${n1(y + tall - 2 - fill)}" width="3" height="${fill}" fill="#fff" opacity=".18"/>`
  if (mark !== undefined) {
    const my = n1(y + tall - 2 - (tall - 4) * (mark / 100))
    out += `<line x1="${x - 3}" y1="${my}" x2="${x + w + 3}" y2="${my}" stroke="#F0EEE6" stroke-width="1.2" stroke-dasharray="2 1.5"><title>Oto-sıkıştırma %${mark}</title></line>`
  }
  out += `<text x="${x + w / 2}" y="${y - 3}" text-anchor="middle" class="t" font-size="6.2" font-weight="800" fill="#F0EEE6">BAĞLAM</text>`
  out += `<text x="${x + w / 2}" y="${y + tall + 9}" text-anchor="middle" class="m" font-size="7.5" font-weight="700" fill="${color}">%${Math.round(pct)}</text></g>`

  return out
}

/** The boss's board: the request, the thought's kind, how far the turn has got. */
function taskBoard(bossW: Worker, turn: Turn): string {
  const kind = bossW.think ?? 'general'
  const title = bossW.activity === 'planning' ? 'PLAN' : bossW.activity === 'thinking' ? THINK_LABEL[kind].toLocaleUpperCase('tr-TR') : turn.active ? 'ÇALIŞIYOR' : 'GÖREV PANOSU'
  const gist = clip(turn.prompt ?? 'Yeni iş bekleniyor', 28)
  // the thought itself, its first words, where a scribble once stood
  const thought = clip(bossW.detail || bossW.bubble || '', 30)
  // one notch per step of this turn, up to 12: the board fills as the work goes on
  const steps = Math.min(12, turn.active ? turn.steps : 0)
  const notches = Array.from({ length: 12 }, (_, i) => `<rect x="${24 + i * 8}" y="122" width="6" height="4" rx="1" fill="${i < steps ? CLAUDE : '#3A3934'}"/>`).join('')

  return `<g><rect x="16" y="72" width="128" height="60" rx="4" fill="#24221E" stroke="#D97757" stroke-opacity=".7"/><text x="24" y="85" class="t" font-size="8" font-weight="800" letter-spacing=".8" fill="#D4A27F">${esc(clip(title, 22))}</text>${thinkIcon(kind, 122, 75, '#D4A27F')}<text x="24" y="99" class="t" font-size="7.2" fill="#F0EEE6">${esc(gist)}</text><text x="24" y="111" class="t" font-size="6.6" fill="#B7B4A9">${esc(thought)}</text>${notches}<text x="124" y="126.5" class="m" font-size="6" fill="#85837A">${turn.active ? turn.steps : ''}</text><path d="M38 132 L32 166 M122 132 L128 166" stroke="#4A4339" stroke-width="2"/></g>`
}

/** The library: one book for every file read this session, a shelf at a time. */
function bookshelf(read: number): string {
  const books = [CLAUDE, '#D4A27F', '#6A9BCC', GOLD, '#8FAE6B', '#A99BD0', '#E3A04F', '#F0EEE6']
  let out = '<rect x="392" y="74" width="50" height="98" rx="2" fill="#2E2620"/><rect x="392" y="74" width="50" height="98" rx="2" fill="none" stroke="#D4A27F" stroke-opacity=".35"/>'
  let left = Math.min(read, 21)
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 78 + shelf * 31
    out += `<rect x="395" y="${y + 26}" width="44" height="3" fill="#4A3B2E"/>`
    let bx = 397
    for (let b = 0; b < 7 && bx < 436 && left > 0; b++, left--) {
      const bw = 4 + (hash(`b${shelf}${b}`) % 3)
      const bh = 16 + (hash(`h${shelf}${b}`) % 9)
      out += `<rect x="${bx}" y="${y + 26 - bh}" width="${bw}" height="${bh}" fill="${books[(shelf * 3 + b) % books.length]}"/>`
      bx += bw + 1
    }
  }
  out += `<text x="417" y="71" text-anchor="middle" class="m" font-size="6.5" fill="#B7B4A9">${read} dosya okundu</text>`

  return out
}

/** The plant grows a leaf every two turns, up to seven. */
function plant(x: number, y: number, turns: number): string {
  const leaves = Math.max(1, Math.min(7, Math.ceil(turns / 2)))
  const greens = ['#5F7A3D', '#8FAE6B', '#788C5D']
  let out = ''
  for (let i = 0; i < leaves; i++) {
    const a = -60 + (120 * i) / Math.max(1, leaves - 1)
    out += `<ellipse cx="8" cy="-${6 + i}" rx="2.6" ry="${6 + (i % 3)}" fill="${greens[i % 3]}" transform="rotate(${leaves === 1 ? 0 : n1(a)} 8 0)"/>`
  }

  return `<g transform="translate(${x},${y})"><path d="M0 0 h16 l-2 14 h-12 z" fill="#8A5A3C"/><g class="fbb" style="animation:wiggle 6s ${n1(-((Date.now() % 6000) / 1000))}s infinite">${out}</g></g>`
}

// ——— the scene ——————————————————————————————————————————

export type SceneInput = {
  workers: readonly Worker[]
  usage: Usage
  turn: Turn
  now: number
  motion: boolean
  /** files read and turns taken: the library and the plant */
  stats?: Stats
  /** the auto compact %, drawn across the context tank */
  autoCompactAt?: number
}

export type SceneParts = { body: string; defs: string; alt: string; height: number }

export function seatXY(seat: number): { x: number; y: number } {
  return { x: (seat % 3) * COL_W, y: FLOOR_Y + 8 + Math.floor(seat / 3) * ROW_H }
}

/** The scene as a standalone document: what tests and previews draw. */
export function sceneSvg(input: SceneInput): { svg: string; alt: string; height: number } {
  const parts = sceneParts(input, false)
  const svg = phaseLock(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${parts.height}" width="${W}" height="${parts.height}"><style>${STYLE}</style><defs>${parts.defs}</defs>${parts.body}</svg>`, input.now)

  return { svg, alt: parts.alt, height: parts.height }
}

export const SCENE_DEFS = `<filter id="neon" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="lamp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDE68A" stop-opacity=".3"/><stop offset="1" stop-color="#FDE68A" stop-opacity="0"/></linearGradient><radialGradient id="pool"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`

/** The office's markup in its own units (SCENE_W wide), without the outer element. */
export function sceneParts(input: SceneInput, lite: boolean): SceneParts {
  const { workers, usage, turn, now, motion } = input
  const bossW = workers.find(w => w.id === 'boss') ?? fallbackBoss(now)
  const team = workers.filter(w => w.id !== 'boss').slice(0, MAX_DESKS)
  const extra = workers.filter(w => w.id !== 'boss').length - team.length
  const rows = team.length === 0 ? 0 : Math.floor(Math.max(...team.map(w => w.seat)) / 3) + 1
  const floorH = rows === 0 ? 70 : rows * ROW_H + 14
  const H = FLOOR_Y + floorH + 6
  const doorX = 10
  const doorY = H - 40
  const { h } = istanbul(now)
  const isNight = h < 6 || h >= 20

  let svg = `<g class="${motion ? '' : 'still'}">`

  // wall, sign, clock, windows
  svg += `<rect width="${W}" height="${BOSS_TOP}" fill="#2B2926"/><rect y="${BOSS_TOP - 3}" width="${W}" height="3" fill="#D97757" opacity=".35"/>`
  // the sign says whether the office is at work
  // the sign: who is at work (the model and its effort), and whether the office is open
  const model = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(turn.model ?? '')
  const who = model ? `${(model[1] as string).charAt(0).toUpperCase()}${(model[1] as string).slice(1)} ${model[2]}${model[3] ? `.${model[3]}` : ''}` : 'Claude'
  const EFFORT: Record<string, string> = { low: 'düşük efor', medium: 'orta efor', high: 'yüksek efor', xhigh: 'çok yüksek efor', max: 'en yüksek efor' }
  svg += `<g>${starburst(20, 22, 7, CLAUDE)}<text x="32" y="27" class="s" font-size="13" fill="#F0EEE6">${esc(who)}</text></g>`
  svg += `<text x="14" y="46" class="t" font-size="7.5" font-weight="800" letter-spacing=".6"><tspan fill="${turn.active ? '#8FAE6B' : '#85837A'}">${turn.active ? 'MESAİDE' : 'MOLA'}</tspan><tspan fill="#D4A27F">${turn.effort ? ` · ${esc((EFFORT[turn.effort] ?? turn.effort).toLocaleUpperCase('tr-TR'))}` : ''}</tspan></text>`
  svg += limitClock(now, usage, 146, 31)
  svg += windowStrip(now, 300, W - 10)

  // the throne room
  svg += `<rect y="${BOSS_TOP}" width="${W}" height="${FLOOR_Y - BOSS_TOP}" fill="#33302B"/>`
  svg += `<rect x="146" y="148" width="208" height="32" rx="3" fill="#7F1D1D"/><rect x="150" y="151" width="200" height="26" rx="2" fill="none" stroke="${GOLD}" stroke-opacity=".7"/>`
  if (isNight) svg += `<path d="M252 64 L208 180 H296 Z" fill="url(#lamp)"/>`
  svg += taskBoard(bossW, turn)
  svg += contextTank(usage, 366, 76, input.autoCompactAt)
  svg += bookshelf(input.stats?.tools.Read ?? 0)
  svg += plant(452, 162, turn.turns)
  svg += bossDesk(bossW, usage, now, motion, team)

  // glass partition
  svg += `<rect y="${FLOOR_Y - 6}" width="${W}" height="6" fill="#D4A27F" opacity=".1"/><rect y="${FLOOR_Y - 6}" width="${W}" height="1.2" fill="#D97757" opacity=".6"/>`
  for (let gx = 0; gx < W; gx += 60) svg += `<rect x="${gx}" y="${FLOOR_Y - 6}" width="2" height="6" fill="#4A4339"/>`

  // the open floor, faint plank lines on it
  svg += `<rect y="${FLOOR_Y}" width="${W}" height="${H - FLOOR_Y}" fill="#262220"/>`
  for (let fy = FLOOR_Y + 14; fy < H; fy += 24) svg += `<rect y="${fy}" width="${W}" height="1" fill="#D4A27F" opacity=".06"/>`
  for (let fx = 20; fx < W; fx += 40) svg += `<rect x="${fx}" y="${FLOOR_Y}" width="1" height="${H - FLOOR_Y}" fill="#D4A27F" opacity=".04"/>`
  svg += `<g><rect x="0" y="${H - 64}" width="22" height="58" fill="#1F1E1D"/><rect x="3" y="${H - 61}" width="17" height="52" fill="#3A2F28" stroke="#D4A27F" stroke-opacity=".4"/><circle cx="16" cy="${H - 34}" r="1.4" fill="${GOLD}"/><text x="11" y="${H - 67}" text-anchor="middle" class="t" font-size="6" font-weight="800" letter-spacing=".6" fill="#D4A27F">GİRİŞ</text></g>`

  if (team.length === 0) {
    svg += lounge(FLOOR_Y, H)
  } else {
    for (const w of team) svg += desk(w, now, motion, doorX, doorY, lite)
    svg += `<g transform="translate(${W - 34},${H - 34})"><rect width="22" height="28" rx="2" fill="#3A332D" stroke="#A78BFA" stroke-opacity=".5"/><rect x="3" y="4" width="16" height="8" rx="1" fill="#1A1816"/><circle cx="11" cy="19" r="3" fill="${CLAUDE}"/><g style="${anim('steam', 2)}"><path d="M9 -3 q2 -3 0 -6" stroke="#CBD5E1" fill="none" stroke-width="1"/></g></g>`
    if (extra > 0) svg += `<text x="${W - 8}" y="${FLOOR_Y + 12}" text-anchor="end" class="t" font-size="8" fill="#94A3B8">+${extra} çalışan daha</text>`
  }

  svg += `</g>`

  const busy = team.filter(w => w.endedAt === undefined).length
  const alt = `Patron: ${activityLabel(bossW)}. ${team.length === 0 ? 'Ekip yok.' : `${team.length} çalışan, ${busy} aktif.`}`

  return { body: svg, defs: SCENE_DEFS, alt, height: H }
}

function fallbackBoss(now: number): Worker {
  return { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: CLAUDE, seat: -1, activity: 'idle', bubble: '', detail: '', tools: 0, tokensOut: 0, since: now, joinedAt: now }
}

function bossDesk(w: Worker, usage: Usage, now: number, motion: boolean, team: readonly Worker[]): string {
  const kx = 226
  const ky = 88
  let out = ''
  // throne
  out += `<path d="M216 128 V84 Q216 66 252 64 Q288 66 288 84 V128 Z" fill="#3B0764" stroke="${GOLD}" stroke-width="2"/><path d="M222 126 V86 Q222 72 252 70 Q282 72 282 86 V126 Z" fill="#581C87"/><circle cx="216" cy="84" r="3.5" fill="${GOLD}"/><circle cx="288" cy="84" r="3.5" fill="${GOLD}"/><circle cx="252" cy="62" r="3" fill="${GOLD}"/>`
  out += king(kx, ky, w)
  // desk: black glass, gold edge
  out += `<rect x="160" y="118" width="186" height="8" rx="2" fill="#1F2937"/><rect x="160" y="118" width="186" height="1.6" fill="${GOLD}"/><rect x="164" y="126" width="178" height="30" fill="#2A2522"/><rect x="164" y="126" width="178" height="30" fill="none" stroke="${GOLD}" stroke-opacity=".35"/><rect x="164" y="156" width="6" height="20" fill="#1F1C19"/><rect x="336" y="156" width="6" height="20" fill="#1F1C19"/>`
  // monitor
  out += `<rect x="170" y="88" width="44" height="28" rx="2" fill="#1A1816" stroke="#D4A27F" stroke-opacity=".5"/>${screen(w, 173, 91, 38, 21, 'boss', 'boss')}<rect x="189" y="116" width="6" height="3" fill="#4A4339"/>`
  // golden cup
  out += `<g><path d="M296 108 h10 l-1.5 8 h-7 z" fill="${GOLD}"/><rect x="299" y="116" width="4" height="2" fill="${GOLD_DARK}"/>${[0, 1].map(i => `<path d="M${299 + i * 4} 106 q2 -3 0 -6" fill="none" stroke="#CBD5E1" stroke-width="1" style="${anim('steam', 2.2, -i * 1.1)}"/>`).join('')}</g>`
  // paper pile = context fill
  const pct = usage.ctxPct ?? 0
  const sheets = Math.min(14, Math.round(pct / 7))
  const pileColor = level(usage.ctxPct).color
  let pile = ''
  for (let i = 0; i < sheets; i++) {
    const off = (hash('p' + i) % 3) - 1
    pile += `<rect x="${316 + off}" y="${n1(116 - (i + 1) * 2.4)}" width="20" height="2" fill="${i >= sheets - 2 && pct >= 60 ? pileColor : '#E2E8F0'}" stroke="#94A3B8" stroke-width=".3"/>`
  }
  out += `<g><title>Bağlam %${Math.round(pct)} dolu</title>${pile}</g>`
  // shredder
  out += `<g><title>Bağlam öğütücü</title><rect x="356" y="140" width="26" height="30" rx="2" fill="#3A332D" stroke="#D4A27F" stroke-opacity=".35"/><rect x="358" y="140" width="22" height="4" fill="#1A1816"/><circle cx="377" cy="150" r="1.6" fill="${w.activity === 'compacting' ? '#22C55E' : '#64748B'}"/>${
    w.activity === 'compacting'
      ? [0, 1, 2, 3].map(i => `<rect x="${360 + i * 5}" y="146" width="2" height="8" fill="#E2E8F0" style="${anim('shred', 0.9, -i * 0.22)}"/>`).join('') + `<rect x="362" y="128" width="14" height="10" fill="#F8FAFC" style="${anim('shred', 1.2)}"/>`
      : ''
  }</g>`
  // name plate: only the title
  out += `<rect x="222" y="134" width="62" height="14" rx="3" fill="#1F1C19" stroke="${GOLD}" stroke-width="1"/><text x="253" y="144.2" text-anchor="middle" class="t" font-size="8" font-weight="800" letter-spacing="1.6" fill="${GOLD}">PATRON</text>`
  // badge + bubble
  out += activityBadge(w, kx + 58, ky - 22, 'boss')
  if (w.activity === 'idle' && now - w.since > 180_000) {
    out += [0, 1, 2].map(i => `<text x="${kx + 46}" y="${ky - 6}" class="t" font-size="${7 + i * 2}" font-weight="700" fill="#94A3B8" style="${anim('zz', 3, -i)}">z</text>`).join('')
  }
  out += bubble(w.bubble, kx + 26 + 100, 46, 230, kx + 40, 150, W - 4, w.activity === 'waiting' ? 'warn' : 'royal')
  // paper planes: orders out to new arrivals, reports back from finishers
  if (motion) {
    for (const t of team) {
      const age = now - t.joinedAt
      if (age < ARRIVE_MS + 1200) {
        const { x, y } = seatXY(t.seat)
        out += plane(kx + 54, ky + 14, x + 95, y + 30, -age / 1000, 1.3, 2)
      }
      if (t.endedAt !== undefined && now - t.endedAt < 3500 && (t.activity === 'done' || t.activity === 'failed')) {
        const { x, y } = seatXY(t.seat)
        out += plane(x + 95, y + 30, kx + 54, ky + 14, -(now - t.endedAt) / 1000, 1.4, 2)
      }
    }
  }

  return `<g><title>${esc(`Patron — ${activityLabel(w)}`)}</title>${out}</g>`
}

function plane(x0: number, y0: number, x1: number, y1: number, begin: number, dur: number, repeat: number): string {
  const cx = (x0 + x1) / 2
  const cy = Math.min(y0, y1) - 40

  return `<g><path d="M-6 -3 L6 0 L-6 3 L-3 0 Z" fill="#F8FAFC" stroke="#2A2522" stroke-width=".4" opacity="0"><animateMotion path="M${n1(x0)} ${n1(y0)} Q${n1(cx)} ${n1(cy)} ${n1(x1)} ${n1(y1)}" dur="${dur}s" begin="${n1(begin)}s" repeatCount="${repeat}" rotate="auto" fill="remove"/><set attributeName="opacity" to="1" begin="${n1(begin)}s" dur="${n1(dur * repeat)}s"/></path></g>`
}

function lounge(y: number, H: number): string {
  return `<g>${plant(40, H - 22, 1)}<rect x="70" y="${H - 34}" width="90" height="22" rx="6" fill="#2E1065"/><rect x="70" y="${H - 44}" width="90" height="12" rx="6" fill="#4C1D95"/><rect x="70" y="${H - 13}" width="90" height="2" fill="#A78BFA" opacity=".6"/><rect x="186" y="${H - 26}" width="40" height="4" rx="2" fill="#4A4339"/><rect x="204" y="${H - 22}" width="4" height="12" fill="#4A4339"/><text x="${W / 2 + 40}" y="${y + 30}" text-anchor="middle" class="t" font-size="9" font-weight="600" fill="#94A3B8">Ekip yok · Patron tek başına</text><g transform="translate(${W - 40},${H - 40})"><rect width="22" height="28" rx="2" fill="#3A332D" stroke="#A78BFA" stroke-opacity=".5"/><rect x="3" y="4" width="16" height="8" rx="1" fill="#1A1816"/><circle cx="11" cy="19" r="3" fill="${CLAUDE}"/></g></g>`
}

function desk(w: Worker, now: number, motion: boolean, doorX: number, doorY: number, lite: boolean): string {
  const { x, y } = seatXY(w.seat)
  const id = w.id.replace(/[^a-zA-Z0-9]/g, '').slice(-12) || String(w.seat)
  const seed = w.id
  const age = now - w.joinedAt
  const arriving = motion && age < ARRIVE_MS
  const leaving = w.activity === 'leaving'
  const leftFor = w.endedAt === undefined ? 0 : now - w.since
  const isNew = age < 1800
  let out = ''

  // desk furniture, glowing in the worker's colour (drops in when brand new)
  let furniture = `<ellipse cx="${x + 80}" cy="${y + 90}" rx="58" ry="6" fill="${w.color}" opacity=".18"${lite ? '' : ` style="${anim('glow', 3, phase(seed, 3))}"`}/>`
  furniture += `<rect x="${x + 76}" y="${y + 26}" width="42" height="34" rx="6" fill="#1A2440"/>`
  furniture += `<rect x="${x + 22}" y="${y + 54}" width="116" height="7" rx="2" fill="#3A332D"/><rect x="${x + 22}" y="${y + 54}" width="116" height="1.4" fill="${w.color}"/><rect x="${x + 26}" y="${y + 61}" width="108" height="22" fill="#2A2522"/><rect x="${x + 26}" y="${y + 83}" width="5" height="9" fill="#1F1C19"/><rect x="${x + 129}" y="${y + 83}" width="5" height="9" fill="#1F1C19"/>`
  furniture += `<rect x="${x + 28}" y="${y + 30}" width="42" height="24" rx="2" fill="#1A1816" stroke="${w.color}" stroke-opacity=".45"/>${
    lite ? `<rect x="${x + 31}" y="${y + 33}" width="36" height="18" rx="1" fill="${w.color}" opacity=".3"/>` : screen(w, x + 31, y + 33, 36, 18, id, seed)
  }`
  const deco = lite ? -1 : hash(seed + 'd') % 3
  furniture +=
    deco === -1
      ? ''
      : deco === 0
        ? plant(x + 120, y + 48, 0.45)
        : deco === 1
          ? `<rect x="${x + 122}" y="${y + 46}" width="7" height="8" rx="1" fill="#F8FAFC"/><path d="M${x + 129} ${y + 48} q3 0 3 2 q0 2 -3 2" fill="none" stroke="#F8FAFC" stroke-width="1.2"/>`
          : `<path d="M${x + 124} ${y + 54} V${y + 44} L${x + 131} ${y + 40}" fill="none" stroke="#94A3B8" stroke-width="1.4"/><path d="M${x + 128} ${y + 38} L${x + 136} ${y + 42} L${x + 131} ${y + 45} Z" fill="${GOLD}"/>`
  const role = `${w.name} · ${w.role}`
  const tagW = Math.min(104, clip(role, 22).length * 4.6 + 18)
  furniture += `<rect x="${x + 30}" y="${y + 65}" width="${n1(tagW)}" height="13" rx="6.5" fill="#1A1816" stroke="${w.color}" stroke-opacity=".8"/><circle cx="${x + 38}" cy="${y + 71.5}" r="2.5" fill="${w.color}"/><text x="${x + 44}" y="${y + 74.6}" class="t" font-size="7.6" font-weight="700" fill="#F1F5F9">${esc(clip(role, 22))}</text>`
  out += isNew ? `<g class="fb" style="animation:pop .6s ${n1(-age / 1000)}s ease-out both">${furniture}</g>` : furniture

  // the worker at the desk
  const charX = x + 79
  const charY = y + 30
  const seated = `<g>${clawd(w.color, charX, charY, w, seed, false)}</g>`
  if (arriving) {
    out += `<g visibility="hidden"><set attributeName="visibility" to="visible" begin="${n1((ARRIVE_MS - age) / 1000)}s" fill="freeze"/>${seated}</g>`
  } else if (!leaving) {
    out += seated
  }

  if (!leaving && !arriving) out += activityBadge(w, charX + 42, charY - 8, seed)
  const bubbleText = arriving ? pickHello(seed) : w.bubble
  if (!leaving && bubbleText) {
    out += bubble(bubbleText, x + 80, y + 1, 150, charX + 20, x + 2, x + COL_W - 2, w.activity === 'waiting' ? 'warn' : 'light')
  }

  // walkers on top: arriving from the door, or leaving to it
  if (arriving) {
    out += `<g><animateTransform attributeName="transform" type="translate" from="${n1(doorX - charX)} ${n1(doorY - charY)}" to="0 0" dur="${ARRIVE_MS / 1000}s" begin="${n1(-age / 1000)}s" fill="freeze"/><set attributeName="visibility" to="hidden" begin="${n1((ARRIVE_MS - age) / 1000)}s" fill="freeze"/>${clawd(w.color, charX, charY, { activity: 'idle' }, seed, true)}</g>`
  }
  if (leaving && motion && leftFor < LEAVE_MS + 500) {
    out += `<g><animateTransform attributeName="transform" type="translate" from="0 0" to="${n1(doorX - charX)} ${n1(doorY - charY)}" dur="${LEAVE_MS / 1000}s" begin="${n1(-leftFor / 1000)}s" fill="freeze"/><animate attributeName="opacity" from="1" to="0" dur="${LEAVE_MS / 1000}s" begin="${n1(-leftFor / 1000)}s" fill="freeze"/>${clawd(w.color, charX, charY, { activity: 'idle' }, seed, true)}</g>`
  }

  const tip = `${w.name} (${w.role}) — ${activityLabel(w)}${lite ? '' : `\n${clip(w.task, 70)}`}`

  return `<g><title>${esc(tip)}</title>${out}</g>`
}

const HELLOS = ['Merhaba patron!', 'İşe başlıyorum!', 'Masam hazır!', 'Görev bende!', 'Kahvemi aldım!']

function pickHello(seed: string): string {
  return HELLOS[hash(seed) % HELLOS.length] as string
}
