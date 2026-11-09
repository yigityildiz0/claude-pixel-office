// Ofisin nesneleri (tasarım §3.2, §9.4): her nesne bir veriyi sürekli gösterir ya da bir olaya
// tepki verir; listede olmayan nesne çizilmez. Her çizici kendisine verilen kutuyu (ou) tümüyle
// kullanır: en küçük kutuda taşmaz, iki katı kutuda bozulmaz. Yazılar fontOu ile en az okunur
// piksel boyunda; sığmayan yazı önce kısa seçeneklerine iner, zorunlu yazılar (tabela, PATRON,
// kapı levhası) kırpılır ama kaynakta tam kalır. <title> yalnız lite olmayan çizimde.
// Tek seferlik animasyonlar olayın yaşıyla (-yaş gecikme) oynar ve `settled` çizimde hiç yazılmaz;
// döngüler 'infinite' ile biter (phaseLock duvar saatine kilitler).
import type { Duty, FeedKind, Progress, ScreenKind, SiteKind, ThinkKind } from '../types'
import { charIcon, type CharKind } from './characters'
import { BOSS_DESK_TOP, DESK_GEOM, deskModuleBox, fontOu, type Box, type CellKind, type DeskVariant, type Pt } from './layout'
import { SITE_LABEL, THINK_LABEL, esc, hash, istanbul } from './logic'
import { sprite, type SpriteName } from './sprites'

export type DrawCtx = { s: number; now: number; last?: number; motion: boolean; lite: boolean; settled: boolean; theme: 'dark' | 'light' }
export type Pal = Record<'wall' | 'wallHi' | 'floor' | 'floorLine' | 'carpet' | 'glass' | 'wood' | 'woodDark' | 'metal' | 'ink' | 'paper' | 'text' | 'muted' | 'clay' | 'gold' | 'green' | 'amber' | 'red' | 'blue', string>
/** Bir limit: kullanılan %, epoch ms sıfırlanma ve (bu hızla) dolma anı, %/sa hız. */
export type Lim = { pct: number; resetsAt?: number; fullAt?: number; rate?: number }
export type TickerItem = { t: number; kind: FeedKind; who: string; color: string; text: string; to?: string; toColor?: string; face?: CharKind; toFace?: CharKind }
export type ScreenView = { kind: ScreenKind | 'idle' | 'off' | 'boot'; label?: string; site?: SiteKind; think?: ThinkKind; progress?: Progress; steps?: number; since: number }

// ——— ortak yardımcılar ————————————————————————————————————————

const n = (v: number): number => Math.round(v * 10) / 10
const n2 = (v: number): number => Math.round(v * 100) / 100
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
/** Ekranda okunur en küçük yazı (px): bunun altına inen yazı çizilmez (kısalır, kayar ya da gizlenir). */
export const MIN_PX = 7.5
/** Yazı boyu (ou): tasarım boyu, ama ekranda en az `px` (ve hiçbir zaman MIN_PX'ten az) piksel. */
const F = (c: DrawCtx, px: number, design: number): number => fontOu(c.s, Math.max(px, MIN_PX), design)

// ——— yazı defteri: çizilen her yazının kutusu (ou); balonlar ve isim etiketleri bunlara binmez ———
let FLOOR = 0
let REG_OFF = 0
let REG_K = 1
let REG_MAP: ((p: Pt) => Pt) | undefined
const TEXTS: Box[] = []
/** Yeni çizim: defter boşalır, okunurluk eşiği bu ölçeğe (ou → px) göre kurulur. */
export function beginTexts(s: number): void {
  FLOOR = (MIN_PX / s) * 0.999
  TEXTS.length = 0
  REG_OFF = 0
  REG_K = 1
  REG_MAP = undefined
}
/** Ölçekli bir çerçevede (masa) çizim: yazı kutuları çerçevenin dönüşümüyle deftere girer. */
export function inFrame<R>(map: ((p: Pt) => Pt) | undefined, k: number, draw: () => R): R {
  const [m0, k0] = [REG_MAP, REG_K]
  REG_MAP = map
  REG_K = k
  try {
    return draw()
  } finally {
    REG_MAP = m0
    REG_K = k0
  }
}
/** Yerel koordinatlı (kırpan pencere içi) çizim: deftere girmez. */
function local<R>(draw: () => R): R {
  REG_OFF++
  try {
    return draw()
  } finally {
    REG_OFF--
  }
}
/** Bir kutuyu deftere yazar (ou; çerçeve içindeyse dönüştürülür). */
export function noteBox(b: Box): void {
  if (REG_OFF) return
  if (!REG_MAP) {
    TEXTS.push(b)
    return
  }
  const [x0, y0] = REG_MAP([b.x, b.y])
  const [x1, y1] = REG_MAP([b.x + b.w, b.y + b.h])
  TEXTS.push({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
}
/** Kutu defterdeki bir yazıya (pay kadar yakın) değiyor mu; `skip`: bu kayıttan önceki kayıtlara bakılmaz. */
export function textHit(b: Box, pad = 1, from = 0): boolean {
  for (let i = from; i < TEXTS.length; i++) {
    const o = TEXTS[i] as Box
    if (b.x < o.x + o.w + pad && o.x < b.x + b.w + pad && b.y < o.y + o.h + pad && o.y < b.y + b.h + pad) return true
  }
  return false
}
/** Kutunun defterdeki yazılarla kesişen toplam alanı (ou²): hiç boş yer yoksa en az örteni seçmek için. */
export function textOverlap(b: Box): number {
  let a = 0
  for (const o of TEXTS) a += Math.max(0, Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x)) * Math.max(0, Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y))
  return a
}
/** Defterdeki kayıt sayısı (bir çizimin kendi kayıtlarını atlamak için). */
export const textCount = (): number => TEXTS.length
/** Bu boy (ou) ekranda okunur mu. */
export const readable = (fs: number): boolean => fs * REG_K >= FLOOR
/** Çizgi kalınlığı (ou): ekranda en az `px` piksel. */
const W = (c: DrawCtx, px: number, design = 0): number => n(Math.max(design, px / c.s))
/** Olayın yaşı (sn); önceki karede görünmemiş olay en çok 0,4 sn içeriden başlar (eventAge). */
function ago(c: DrawCtx, t: number | undefined): number {
  if (t === undefined) return Infinity
  const a = c.now - t

  return (c.last !== undefined && t > c.last ? Math.min(a, 400) : a) / 1000
}
/** Tek seferlik geçiş çizilsin mi: gerçek (settled olmayan) çizimde, hareket açıkken, olay `dur` sn içindeyse. */
const live = (c: DrawCtx, t: number | undefined, dur: number): boolean => !c.settled && c.motion && ago(c, t) >= 0 && ago(c, t) < dur
/** Tek seferlik CSS animasyonu (olayın yaşından). */
const once = (c: DrawCtx, name: string, dur: number, t: number | undefined, extra = ''): string => `animation:${name} ${dur}s ${n(-ago(c, t))}s 1 both${extra ? ';' + extra : ''}`
const tip = (c: DrawCtx, text: string): string => (c.lite ? '' : `<title>${esc(text)}</title>`)

const NARROW = new Set([...'iljtfrı.,:;\'|!()[]·İI '])
const WIDE = new Set([...'mwMW%@'])
/** Yazı genişliği tahmini (ou): Segoe UI oranları; mono 0,6 em. */
export function textWidth(text: string, fs: number, bold = false, mono = false): number {
  if (mono) return text.length * fs * 0.6
  let w = 0
  for (const ch of text) {
    if (NARROW.has(ch)) w += ch === ' ' ? 0.27 : 0.29
    else if (WIDE.has(ch)) w += 0.84
    else if ((ch >= 'A' && ch <= 'Z') || 'ÇĞÖŞÜ'.includes(ch)) w += 0.66
    else if (ch >= '0' && ch <= '9') w += 0.56
    else w += 0.52
  }

  return w * fs * (bold ? 1.07 : 1)
}

/** Sığan ilk seçenek; hiçbiri sığmazsa ''. */
export function fitText(options: readonly string[], maxW: number, fs: number, bold = false, mono = false): string {
  for (const o of options) if (o && textWidth(o, fs, bold, mono) <= maxW) return o

  return ''
}

/**
 * Tek satır, sağdan '…' ile kısaltılmış (kaymaz, soldan kesilmez). Dosya adında uzantı korunur:
 * 'README.md' → 'REA….md'.
 */
export function ellipsize(text: string, maxW: number, fs: number, bold = false, mono = false): string {
  if (textWidth(text, fs, bold, mono) <= maxW) return text
  // 'Onay · app.tsx': the part after the dot is the news; the label before it gives way first
  const sep = text.lastIndexOf(' · ')
  if (sep > 0) return ellipsize(text.slice(sep + 3), maxW, fs, bold, mono)
  const ext = /\S(\.[A-Za-z0-9]{1,5})$/.test(text) && !/\s/.test(text) ? /(\.[A-Za-z0-9]{1,5})$/.exec(text)?.[1] : undefined
  if (ext && text.length > ext.length + 2) {
    let stem = text.slice(0, -ext.length)
    // the name whole without its extension ('scene') reads better than a cut one ('sce….ts')
    if (textWidth(stem, fs, bold, mono) <= maxW) return stem
    while (stem.length > 1 && textWidth(`${stem}…${ext}`, fs, bold, mono) > maxW) stem = stem.slice(0, -1)
    if (textWidth(`${stem}…${ext}`, fs, bold, mono) <= maxW) return `${stem.trimEnd()}…${ext}`
  }
  let t = text
  while (t.length > 1 && textWidth(`${t}…`, fs, bold, mono) > maxW) t = t.slice(0, -1)

  return `${t.trimEnd()}…`
}

/** Sözcük kaydırma: en çok `lines` satır; taşan son satır '…' ile kısalır. */
function wrap(text: string, maxW: number, fs: number, lines: number, bold = false): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (textWidth(next, fs, bold) <= maxW) cur = next
    else {
      if (cur) out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  if (out.length > lines) {
    const kept = out.slice(0, lines)
    let last = `${kept[lines - 1] ?? ''}…`
    while (last.length > 1 && textWidth(last, fs, bold) > maxW) last = `${last.slice(0, -2).trimEnd()}…`
    kept[lines - 1] = last

    return kept
  }

  return out.map(l => {
    let x = l
    while (x.length > 1 && textWidth(x, fs, bold) > maxW) x = `${x.slice(0, -2)}…`
    return x
  })
}

type TxtOpt = { a?: 'middle' | 'end'; w?: number; m?: boolean; h?: boolean; ls?: number; o?: number; st?: string }
function T(x: number, y: number, text: string, fs: number, fill: string, o: TxtOpt = {}): string {
  if (!text || !readable(fs)) return ''
  const tw = textWidth(text, fs, (o.w ?? 400) >= 600, o.m) + (o.ls ?? 0) * text.length
  noteBox({ x: o.a === 'middle' ? x - tw / 2 : o.a === 'end' ? x - tw : x, y: y - fs * 0.8, w: tw, h: fs })

  return `<text x="${n(x)}" y="${n(y)}" class="${o.m ? 'pm' : o.h ? 'ph' : 'pt'}" font-size="${Math.ceil(fs * 100) / 100}"${o.a ? ` text-anchor="${o.a}"` : ''}${o.w ? ` font-weight="${o.w}"` : ''}${o.ls ? ` letter-spacing="${n(o.ls)}"` : ''}${o.o !== undefined ? ` opacity="${o.o}"` : ''} fill="${fill}"${o.st ? ` style="${o.st}"` : ''}>${esc(text)}</text>`
}
const R = (x: number, y: number, w: number, h: number, fill: string, extra = ''): string => `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, w))}" height="${n(Math.max(0, h))}" fill="${fill}"${extra}/>`
/**
 * Pirinç etiket plakası: nesnenin sayısı duvar kâğıdının üstünde çıplak yazı olarak durmasın.
 * (cx, y) yazının ortası ve taban çizgisi; koyu zemin + açık pirinç yazı (iki temada okunur).
 */
function plate(cx: number, y: number, text: string, fs: number, c: DrawCtx, hot = false): string {
  if (!text || !readable(fs)) return ''
  const w = textWidth(text, fs, true) + fs * 0.7
  const h = fs * 1.22
  const light = c.theme === 'light'
  const bg = light ? '#4A3424' : '#2A2016'
  const edge = hot ? '#6A9BCC' : light ? '#C9A55A' : '#8A6A3A'
  const ink = hot ? '#BFDBFE' : '#F3D9A0'

  return `<rect x="${n(cx - w / 2)}" y="${n(y - fs * 0.92)}" width="${n(w)}" height="${n(h)}" rx="${n(fs * 0.22)}" fill="${bg}" stroke="${edge}" stroke-width="${n(Math.max(0.4, 1 / c.s))}"/>${T(cx, y, text, fs, ink, { a: 'middle', w: 700 })}`
}
/** Kırpan pencere: içerik (0,0)'dan başlayan yerel koordinatlarda. */
const clipBox = (b: Box, inner: string): string => `<svg x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" overflow="hidden">${inner}</svg>`

/** Saat "13:05" (İstanbul). */
function hm(t: number): string {
  const { h, m } = istanbul(t)

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
/** Türkçe bulunma eki (13:05'te, 21:10'da): son okunan sayının son sözcüğüne göre. */
function locSuffix(t: number): string {
  const { h, m } = istanbul(t)
  const v = m === 0 ? h : m
  const units = ['', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da']
  const tens = ['da', 'da', 'de', 'da', 'ta', 'de']
  const suf = v % 10 !== 0 ? units[v % 10] : tens[Math.floor(v / 10)]

  return `${hm(t)}'${suf ?? 'de'}`
}
const DAYS = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct']
/** Kullanılan % rengi: < 60 yeşil, < 85 amber, kırmızı. */
const usedTone = (p: Pal, pct: number): string => (pct >= 90 ? p.red : pct >= 75 ? p.amber : p.green)

// ——— palet ——————————————————————————————————————————————————

const DARK: Pal = {
  wall: '#2B2622', wallHi: '#3A332D', floor: '#3A2D24', floorLine: '#271E18', carpet: '#2D2536', glass: '#8FB8DE',
  wood: '#7A5638', woodDark: '#4A3424', metal: '#6B7078', ink: '#121110', paper: '#F2EFE7', text: '#F0EEE6', muted: '#9C9890',
  clay: '#D97757', gold: '#F2B33D', green: '#7FB069', amber: '#E3A04F', red: '#E0685A', blue: '#6A9BCC',
}
const LIGHT: Pal = {
  wall: '#EAE4DA', wallHi: '#F6F2EB', floor: '#D8C4A6', floorLine: '#BCA382', carpet: '#DCD2E6', glass: '#7FB2DD',
  wood: '#B88A60', woodDark: '#8B6545', metal: '#9DA3AB', ink: '#24211F', paper: '#FFFDF8', text: '#2A2522', muted: '#6E6A62',
  clay: '#C8623E', gold: '#C98E12', green: '#4F8F3A', amber: '#B97A22', red: '#C24A3A', blue: '#3F78B5',
}
export function palette(theme: 'dark' | 'light'): Pal {
  return theme === 'light' ? LIGHT : DARK
}
/** LED ve ekran renkleri: iki temada aynı (cihazlar her zaman koyu). */
const LED = { bg: '#0D0F13', bezel: '#2A2D33', amber: '#FFB547', green: '#5EE07A', red: '#FF6B5B', dim: '#7E8794', text: '#E8EAED' }

export const PROP_CSS = `.pt{font-family:Bahnschrift,'DIN Alternate','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif}
.ph{font-family:'Ink Free','Segoe Print','Comic Sans MS','Chalkboard SE','Marker Felt',cursive}
.pm{font-family:'Cascadia Code',Consolas,'Fira Code',ui-monospace,monospace}
.pc{transform-box:fill-box;transform-origin:50% 50%}
.pb{transform-box:fill-box;transform-origin:50% 100%}
.pl{transform-box:fill-box;transform-origin:0 50%}
@keyframes pspin{to{transform:rotate(360deg)}}
@keyframes ppulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes pblink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes pdots{0%,20%{opacity:.2}40%{opacity:1}100%{opacity:.2}}
@keyframes pscroll{to{transform:translateY(var(--py))}}
@keyframes pmqa{0%,15%{transform:translateX(0)}85%,100%{transform:translateX(var(--px))}}
@keyframes ptype{from{stroke-dashoffset:var(--pd)}to{stroke-dashoffset:0}}
@keyframes psteam{0%{transform:translateY(0);opacity:0}30%{opacity:.8}100%{transform:translateY(-6px);opacity:0}}
@keyframes ppop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes pfold{0%{transform:scaleY(1);opacity:1}100%{transform:scaleY(0);opacity:0}}
@keyframes pin{from{opacity:0}to{opacity:1}}
@keyframes pout{from{opacity:1}to{opacity:0}}
@keyframes pflick{0%{opacity:.15}10%{opacity:1}18%{opacity:.3}30%,100%{opacity:1}}
@keyframes pslide{from{transform:translate(var(--px),var(--py,0px));opacity:0}to{transform:translate(0,0);opacity:1}}
@keyframes pshift{from{transform:translateX(var(--px))}to{transform:translateX(0)}}
@keyframes pdoor{0%,100%{transform:scaleX(1)}12%,88%{transform:scaleX(.16)}}
@keyframes pdrawer{0%,100%{transform:translateX(0)}20%,70%{transform:translateX(var(--px))}}
@keyframes pwin{0%,100%{transform:translateY(0)}15%,80%{transform:translateY(var(--py))}}
@keyframes pprint{from{transform:translateY(var(--py))}to{transform:translateY(0)}}
@keyframes pdrain{0%{transform:scaleY(1)}70%,100%{transform:scaleY(var(--ps))}}
@keyframes pbub{0%{transform:translateY(0);opacity:0}20%{opacity:.9}100%{transform:translateY(var(--py));opacity:0}}
@keyframes pshred{0%{transform:translateY(-6px);opacity:1}100%{transform:translateY(12px);opacity:0}}
@keyframes pring{0%,100%{transform:rotate(0)}10%{transform:rotate(14deg)}20%{transform:rotate(-14deg)}30%{transform:rotate(9deg)}40%{transform:rotate(0)}}
@keyframes pnote{0%{transform:scale(0) rotate(-25deg)}70%{transform:scale(1.15) rotate(5deg)}100%{transform:scale(1) rotate(0)}}
@keyframes pflash{0%,100%{opacity:0}15%,45%{opacity:1}60%{opacity:.2}75%{opacity:1}}
`

// ——— küçük glifler ———————————————————————————————————————————

/** Ofisin kendi işareti: üç noktalı küçük konuşma balonu (nötr, marka glifi yok). Ad, çağrı yerleri için korundu. */
export function starburst(cx: number, cy: number, r: number, fill: string): string {
  const w = r * 1.9
  const h = r * 1.4
  const x = cx - w / 2
  const y = cy - h / 2 - r * 0.12
  const body = `<path d="M${n(x + r * 0.35)} ${n(y)}H${n(x + w - r * 0.35)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r * 0.35)}V${n(y + h - r * 0.35)}Q${n(x + w)} ${n(y + h)} ${n(x + w - r * 0.35)} ${n(y + h)}H${n(cx + r * 0.1)}L${n(cx - r * 0.45)} ${n(y + h + r * 0.55)}L${n(cx - r * 0.4)} ${n(y + h)}H${n(x + r * 0.35)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r * 0.35)}V${n(y + r * 0.35)}Q${n(x)} ${n(y)} ${n(x + r * 0.35)} ${n(y)}Z" fill="${fill}"/>`
  const dots = [-0.45, 0, 0.45].map(k => `<circle cx="${n(cx + k * r)}" cy="${n(y + h / 2)}" r="${n(r * 0.14)}" fill="#2A2522" opacity=".62"/>`).join('')

  return body + dots
}

/** Küçük zarf: `w` geniş, 0,72 w yüksek, (x, y) sol-üst. */
export function envelope(x: number, y: number, w: number): string {
  const h = n(w * 0.72)

  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${h}" rx="${n(w * 0.1)}" fill="#F8FAFC" stroke="#94A3B8" stroke-width="${n(w * 0.05)}"/><path d="M${n(x + w * 0.05)} ${n(y + w * 0.06)}L${n(x + w / 2)} ${n(y + h * 0.62)}L${n(x + w * 0.95)} ${n(y + w * 0.06)}" fill="none" stroke="#94A3B8" stroke-width="${n(w * 0.06)}" stroke-linejoin="round"/>`
}

/** Kâğıt uçak: (0,0) merkezli, +x yönünü gösterir, ~14 ou. animateMotion'ı saran <g>'ye konur. */
export function plane(color: string): string {
  return `<path d="M7 0L-7 -5.2L-3.6 0L-7 5.2Z" fill="${color}" stroke="#2A2522" stroke-width=".5" stroke-linejoin="round"/><path d="M7 0L-3.6 0L-5 3.2Z" fill="#000" opacity=".16"/>`
}

const CROWN = ['..W....W....W..', '.YY...YYY...YY.', '.YYY.YYYYY.YYY.', '.YYYYYYYYYYYYY.', '.YYBYYYRYYYBYY.', '.YYYYYYYYYYYYY.', '.OOOOOOOOOOOOO.']

/** Piksel taç (0.6): (x, y) = tacın alt-orta noktası (başın üstü), k = piksel boyu (ou); 15 × 7 piksel. */
export function crown(x: number, y: number, k: number): string {
  const pal: Record<string, string> = { Y: '#FBBF24', O: '#B45309', W: '#FDE68A', R: '#EF4444', B: '#3B82F6' }
  const ox = x - 7.5 * k
  const oy = y - 7 * k
  const by: Record<string, string> = {}
  CROWN.forEach((row, yy) => {
    let xx = 0
    while (xx < row.length) {
      const ch = row[xx] as string
      let end = xx + 1
      while (end < row.length && row[end] === ch) end++
      if (pal[ch]) by[ch] = (by[ch] ?? '') + `M${n(ox + xx * k)} ${n(oy + yy * k)}h${n((end - xx) * k)}v${n(k)}h${n(-(end - xx) * k)}z`
      xx = end
    }
  })

  return Object.entries(by).map(([ch, d]) => `<path d="${d}" fill="${pal[ch]}"/>`).join('')
}

/** Site rozeti, size × size (varsayılan 14), (x, y) sol-üst. */
export function siteBadge(site: SiteKind, x: number, y: number, size = 14): string {
  const k = size / 14
  const box = (fill: string, inner: string, stroke = '') => `<g transform="translate(${n(x)},${n(y)})${k !== 1 ? ` scale(${n2(k)})` : ''}"><rect width="14" height="14" rx="3" fill="${fill}"${stroke}/>${inner}</g>`
  switch (site) {
    case 'youtube':
      return box('#FF0033', '<path d="M5 3.5L10.5 7L5 10.5Z" fill="#fff"/>')
    case 'reddit':
      return box('#FF4500', '<circle cx="7" cy="8" r="4" fill="#fff"/><circle cx="5.5" cy="7.6" r=".9" fill="#FF4500"/><circle cx="8.5" cy="7.6" r=".9" fill="#FF4500"/><circle cx="10" cy="3" r="1.2" fill="#fff"/>')
    case 'x':
      return box('#000', '<path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="#fff" stroke-width="1.8"/>', ' stroke="#475569" stroke-width=".6"')
    case 'wiki':
      return box('#F8FAFC', '<text x="7" y="10.5" text-anchor="middle" font-family="Georgia,serif" font-size="9.5" fill="#111">W</text>')
    case 'github':
      return box('#24292F', '<circle cx="7" cy="7.4" r="3.6" fill="#fff"/><path d="M4.2 4.6L4.6 2.6L6 3.9M9.8 4.6L9.4 2.6L8 3.9" fill="#fff" stroke="#fff" stroke-width=".7"/>')
    case 'stack':
      return box('#F48024', '<path d="M3.5 10.5H10.5M4 8.5L10 9.2M4.6 6.4L10 7.8M5.6 4.4L10.4 6.6" stroke="#fff" stroke-width="1.1"/>')
    case 'google':
      return box('#F8FAFC', '<path d="M10.6 6.4H7V8H9A2.3 2.3 0 1 1 8.3 5.2" fill="none" stroke="#4285F4" stroke-width="1.6"/>')
    case 'docs':
      return box('#2563EB', '<rect x="4" y="3" width="6" height="8" rx="1" fill="#fff"/><path d="M5 5H9M5 7H9M5 9H8" stroke="#2563EB" stroke-width=".8"/>')
    case 'paper':
      return box('#FEF3C7', '<text x="7" y="9.6" text-anchor="middle" class="pm" font-size="5" font-weight="700" fill="#92400E">PDF</text>')
    case 'claude':
      return box('#D97757', starburst(7, 7, 4.5, '#FFF7ED'))
    case 'web':
      return box('#0EA5E9', '<circle cx="7" cy="7" r="4.2" fill="none" stroke="#fff" stroke-width="1"/><path d="M2.8 7H11.2M7 2.8C4.5 5 4.5 9 7 11.2C9.5 9 9.5 5 7 2.8" fill="none" stroke="#fff" stroke-width=".8"/>')
  }
}
const SITE_COLOR: Record<SiteKind, string> = {
  youtube: '#FF0033', reddit: '#FF4500', x: '#111', wiki: '#94A3B8', github: '#24292F', stack: '#F48024', google: '#4285F4', docs: '#2563EB', paper: '#D97706', claude: '#D97757', web: '#0EA5E9',
}

/** Düşünce türü simgesi, 14 × 14 tasarım (k ölçek), (x, y) sol-üst. */
export function thinkIcon(kind: ThinkKind, x: number, y: number, ink = '#E2E8F0', k = 1): string {
  const g = (inner: string) => `<g transform="translate(${n(x)},${n(y)})${k !== 1 ? ` scale(${n2(k)})` : ''}">${inner.replace(/#E2E8F0/g, ink)}</g>`
  switch (kind) {
    case 'plan':
      return g('<rect x="2" y="1" width="10" height="12" rx="1.5" fill="#E2E8F0"/><rect x="4.5" y="0" width="5" height="2.5" rx="1" fill="#64748B"/><path d="M4 5H10M4 7.5H10M4 10H8" stroke="#4A4339" stroke-width="1"/>')
    case 'debug':
      return g('<circle cx="6" cy="6" r="3.8" fill="none" stroke="#E2E8F0" stroke-width="1.6"/><path d="M8.8 8.8L12.5 12.5" stroke="#E2E8F0" stroke-width="2" stroke-linecap="round"/><circle cx="6" cy="6" r="1.6" fill="#EF4444"/>')
    case 'research':
      return g('<path d="M1 3Q4 1.5 7 3Q10 1.5 13 3V12Q10 10.5 7 12Q4 10.5 1 12Z" fill="#E2E8F0"/><path d="M7 3V12" stroke="#64748B" stroke-width=".8"/>')
    case 'design':
      return g('<path d="M7 1A6 6 0 1 0 7 13C8 13 8.5 12 8 11C7.5 10 8 9 9.5 9H11A2 2 0 0 0 13 7A6 6 0 0 0 7 1Z" fill="#E2E8F0"/><circle cx="4.5" cy="5" r="1.2" fill="#EF4444"/><circle cx="7.5" cy="3.8" r="1.2" fill="#22C55E"/><circle cx="10" cy="5.6" r="1.2" fill="#3B82F6"/>')
    case 'decide':
      return g('<path d="M7 1.5V12M3 12H11M2 4H12" stroke="#E2E8F0" stroke-width="1.2"/><path d="M2 4L.5 8H3.5ZM12 4L10.5 8H13.5Z" fill="#E2E8F0"/>')
    case 'code':
      return g('<path d="M4.5 3.5L1.5 7L4.5 10.5M9.5 3.5L12.5 7L9.5 10.5M8 2.5L6 11.5" fill="none" stroke="#E2E8F0" stroke-width="1.4" stroke-linecap="round"/>')
    case 'math':
      return g('<rect x="2" y="1" width="10" height="12" rx="1.5" fill="#E2E8F0"/><rect x="3.5" y="2.5" width="7" height="3" fill="#4A4339"/><path d="M4.5 8H5.5M8.5 8H9.5M4.5 10.5H5.5M8.5 10.5H9.5" stroke="#4A4339" stroke-width="1.2"/>')
    case 'general':
      return g('<path d="M2 3.5h10a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H6l-3 2.5V10.5H2A1.5 1.5 0 0 1 .5 9V5A1.5 1.5 0 0 1 2 3.5Z" fill="#E2E8F0"/><path d="M4 7.2h.1M7 7.2h.1M10 7.2h.1" stroke="#4A4339" stroke-width="1.6" stroke-linecap="round"/>')
  }
}

/** 9 × 9 tasarım görev simgesi (çekiç, büyüteç, terazi, dürbün, pergel), (x, y) sol-üst, k ölçek. */
export function dutyIcon(duty: Duty, x: number, y: number, k = 1): string {
  const g = (inner: string) => `<g transform="translate(${n(x)},${n(y)})${k !== 1 ? ` scale(${n2(k)})` : ''}">${inner}</g>`
  switch (duty) {
    case 'builder':
      return g('<path d="M1.6 8.2L6 3.8" stroke="#D4A27F" stroke-width="1.6" stroke-linecap="round"/><path d="M3.8 1.4L8.2 5.8L6.8 7.2L2.4 2.8Z" fill="#CBD5E1"/>')
    case 'critic':
      return g('<circle cx="3.8" cy="3.8" r="2.7" fill="#1A2440" stroke="#E2E8F0" stroke-width="1.2"/><path d="M5.9 5.9L8.3 8.3" stroke="#E2E8F0" stroke-width="1.7" stroke-linecap="round"/>')
    case 'evaluator':
      return g('<path d="M4.5 1.2V7.8M2.6 8H6.4M.8 2.6H8.2" stroke="#E2E8F0" stroke-width="1" stroke-linecap="round"/><path d="M.8 2.8L-.1 5.6H1.7ZM8.2 2.8L7.3 5.6H9.1Z" fill="#FBBF24"/>')
    case 'explorer':
      return g('<circle cx="2.6" cy="6.1" r="2.3" fill="#CBD5E1"/><circle cx="6.4" cy="6.1" r="2.3" fill="#CBD5E1"/><circle cx="2.6" cy="6.1" r="1.1" fill="#1A2440"/><circle cx="6.4" cy="6.1" r="1.1" fill="#1A2440"/><rect x="1.2" y="1.2" width="2.2" height="2.6" rx=".6" fill="#94A3B8"/><rect x="5.6" y="1.2" width="2.2" height="2.6" rx=".6" fill="#94A3B8"/>')
    case 'planner':
      return g('<path d="M4.5 1.6L1.6 8.4M4.5 1.6L7.4 8.4M2.9 5.6H6.1" stroke="#E2E8F0" stroke-width="1.1" stroke-linecap="round" fill="none"/><circle cx="4.5" cy="1.6" r="1.1" fill="#FBBF24"/>')
    case 'general':
      return ''
  }
}

/** Platform rozeti, size × size, (x, y) sol-üst. agy: lacivert zeminde beyaz "A" (nötr, marka rengi yok); EVREN: kırmızı zeminde ay-yıldız. */
export function platformBadge(kind: 'agy' | 'evren', x: number, y: number, size: number): string {
  const k = n2(size / 12)
  const g = (inner: string) => `<g transform="translate(${n(x)},${n(y)}) scale(${k})">${inner}</g>`
  if (kind === 'agy') {
    return g('<rect width="12" height="12" rx="2.4" fill="#3B4A66"/><path d="M3.5 9.4L6 2.8L8.5 9.4M4.4 7.5H7.6" fill="none" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/>')
  }

  return g('<rect width="12" height="12" rx="2.4" fill="#E03A3E"/><circle cx="5" cy="6" r="3.3" fill="#fff"/><circle cx="5.9" cy="6" r="2.65" fill="#E03A3E"/><path d="M8.6 4.4L9 5.6L10.2 5.6L9.2 6.3L9.6 7.5L8.6 6.8L7.6 7.5L8 6.3L7 5.6L8.2 5.6Z" fill="#fff"/>')
}

// ——— duvar ——————————————————————————————————————————————————

/** Neon tabela: 'Claude Ofis' (zorunlu), MESAİDE/MOLA ışığı, patron modeli ve eforu. `since`: tur başı (ışık yanar). */
export function wallSign(b: Box, d: { model: string; effort?: string; active: boolean; since?: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const pad = Math.max(2, Math.min(b.h * 0.13, b.w * 0.06))
  const r = clamp(Math.min(b.h * 0.2, b.w * 0.085), 2.5, 40)
  const tx = b.x + pad + 2 * r + pad * 0.7
  const avail = Math.max(4, b.x + b.w - pad - tx)
  const fsS = F(c, 9, b.h * 0.15)
  const fsT = Math.min(b.h * 0.4, avail / textWidth('Claude Ofis', 1, true))
  const sub = fsS * 1.3 <= b.h * 0.45 ? 1 : 0
  const block = fsT + sub * fsS * 1.35
  const yT = b.y + (b.h - block) / 2 + fsT * 0.8
  const yS = yT + fsT * 0.28 + fsS
  const on = d.active
  const neon = on ? '#FFC3A1' : '#8A7F76'
  let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(Math.min(5, b.h * 0.1))}" fill="#17130F" stroke="${p.woodDark}" stroke-width="${W(c, 1, 1)}"/>`
  out += `<circle cx="${n(b.x + pad * 0.6)}" cy="${n(b.y + pad * 0.6)}" r="${n(pad * 0.18)}" fill="#55504A"/><circle cx="${n(b.x + b.w - pad * 0.6)}" cy="${n(b.y + pad * 0.6)}" r="${n(pad * 0.18)}" fill="#55504A"/>`
  const logo = starburst(b.x + pad + r, yT - fsT * 0.32, r, on ? '#D97757' : '#6B5A50')
  let title = T(tx, yT, 'Claude Ofis', fsT, neon, { w: 700 })
  if (on && !c.lite) title = T(tx, yT, 'Claude Ofis', fsT, 'none', { w: 700, st: `stroke:#D97757;stroke-opacity:.45;stroke-width:${n(fsT * 0.14)}px` }) + title
  let lit = logo + title
  if (on && live(c, d.since, 2)) lit = `<g style="${once(c, 'pflick', 1.4, d.since)}">${lit}</g>`
  out += lit
  if (sub) {
    const word = on ? 'MESAİDE' : 'MOLA'
    const rest = fitText([`${d.model}${d.effort ? ` · ${d.effort}` : ''}`, d.model, ''], avail - textWidth(`${word} · `, fsS, true) - fsS, fsS)
    out += `<circle cx="${n(tx + fsS * 0.32)}" cy="${n(yS - fsS * 0.34)}" r="${n(fsS * 0.3)}" fill="${on ? LED.green : '#5A5650'}"/>`
    out += `<text x="${n(tx + fsS * 0.85)}" y="${n(yS)}" class="pt" font-size="${n(fsS)}" font-weight="700" fill="${on ? LED.green : '#8A857D'}">${word}${rest ? `<tspan font-weight="400" fill="#B9B3A8"> · ${esc(rest)}</tspan>` : ''}</text>`
  }

  return `<g>${tip(c, `Claude Ofis · ${on ? 'mesaide' : 'mola'} · patron ${d.model}${d.effort ? ` · ${d.effort} efor` : ''}`)}${out}</g>`
}

/** 12'lik kadranda bir anın açısı (derece, saat 12'den). */
function dialAngle(t: number): number {
  const { h, m } = istanbul(t)

  return ((h % 12) + m / 60) * 30
}
function polar(cx: number, cy: number, r: number, deg: number): Pt {
  const a = ((deg - 90) * Math.PI) / 180

  return [n(cx + r * Math.cos(a)), n(cy + r * Math.sin(a))]
}

/** Haftalık 7 gün kutusu: bugünden başlar, kullanılan pay dolu, sıfırlanma günü halkalı, dolma günü kırmızı. */
function weekStrip(x: number, y: number, w: number, h: number, week: Lim | undefined, c: DrawCtx, rows = 1): string {
  const p = palette(c.theme)
  const per = rows === 1 ? 7 : 4
  const cw = w / per
  const ch = h / rows
  const today = new Date(c.now + 3 * 3_600_000).getUTCDay()
  const filled = week ? Math.round((clamp(week.pct, 0, 100) / 100) * 7) : 0
  const resetDay = week?.resetsAt && week.resetsAt > c.now ? Math.min(6, Math.floor((week.resetsAt - c.now) / 86_400_000)) : -1
  const fullDay = week?.fullAt !== undefined && (week.resetsAt === undefined || week.fullAt < week.resetsAt) ? Math.min(6, Math.max(0, Math.floor((week.fullAt - c.now) / 86_400_000))) : -1
  const fs = Math.min(ch * 0.62, cw * 0.62, F(c, 8, ch * 0.5))
  const tone = week ? usedTone(p, week.pct) : p.muted
  let out = ''
  for (let i = 0; i < 7; i++) {
    const cx = x + (i % per) * cw
    const cy = y + Math.floor(i / per) * ch
    const ring = i === fullDay ? p.red : i === resetDay ? p.clay : ''
    out += `<rect x="${n(cx + cw * 0.06)}" y="${n(cy + ch * 0.06)}" width="${n(cw * 0.88)}" height="${n(ch * 0.88)}" rx="${n(Math.min(cw, ch) * 0.15)}" fill="${i < filled ? tone : c.theme === 'light' ? '#D8D1C4' : '#4A4038'}"${ring ? ` stroke="${ring}" stroke-width="${W(c, 1.4, Math.min(cw, ch) * 0.12)}"` : ''}${i === fullDay && !c.lite ? ' style="animation:ppulse 1.4s infinite"' : ''}/>`
    out += T(cx + cw / 2, cy + ch * 0.5 + fs * 0.36, DAYS[(today + i) % 7] as string, fs, i < filled ? '#1F1E1D' : c.theme === 'light' ? '#4A443C' : '#E8DCCB', { a: 'middle', w: 700 })
  }

  return out
}

/** Duvar saati: İstanbul saati (ibreler CSS ile döner), 5 saatlik pencere yayı (5 dk kademeli), sıfırlanma noktası, dolma üçgeni; isteğe bağlı haftalık şerit. */
export function wallClock(b: Box, d: { five?: Lim; week?: Lim; withCalendar: boolean }, c: DrawCtx): string {
  const p = palette(c.theme)
  const pad = Math.max(1.5, Math.min(b.w, b.h) * 0.05)
  const stripH = d.withCalendar ? clamp(b.h * 0.24, F(c, 9, 8) * 1.5, b.h * 0.34) : 0
  const side = d.withCalendar && b.w >= b.h * 2.1
  const faceBox: Box = side ? { x: b.x + pad, y: b.y + pad, w: b.h - 2 * pad, h: b.h - 2 * pad } : { x: b.x + pad, y: b.y + pad, w: b.w - 2 * pad, h: b.h - 2 * pad - (stripH ? stripH + pad : 0) }
  const r = Math.max(4, Math.min(faceBox.w, faceBox.h) / 2)
  const cx = side ? faceBox.x + r : b.x + b.w / 2
  const cy = faceBox.y + faceBox.h / 2
  let out = `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${p.paper}" stroke="${p.woodDark}" stroke-width="${n(Math.max(W(c, 1.5), r * 0.1))}"/>`
  let ticks = ''
  for (let i = 0; i < 12; i++) {
    const [x1, y1] = polar(cx, cy, r * 0.86, i * 30)
    const [x2, y2] = polar(cx, cy, r * (i % 3 === 0 ? 0.68 : 0.76), i * 30)
    ticks += `M${x1} ${y1}L${x2} ${y2}`
  }
  out += `<path d="${ticks}" stroke="#5E5D59" stroke-width="${n(Math.max(W(c, 0.8), r * 0.05))}"/>`
  const five = d.five
  const now5 = Math.floor(c.now / 300_000) * 300_000
  if (five?.resetsAt && five.resetsAt > c.now && five.resetsAt - now5 < 12 * 3_600_000) {
    const a0 = dialAngle(now5)
    let a1 = dialAngle(five.resetsAt)
    if (a1 <= a0) a1 += 360
    const ar = r * 0.56
    const [sx, sy] = polar(cx, cy, ar, a0)
    const [ex, ey] = polar(cx, cy, ar, a1)
    const color = usedTone(p, five.pct)
    out += `<path d="M${sx} ${sy}A${n(ar)} ${n(ar)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${ex} ${ey}" fill="none" stroke="${color}" stroke-width="${n(r * 0.2)}" stroke-linecap="round" opacity=".85"/>`
    const [dx, dy] = polar(cx, cy, r * 0.93, a1)
    out += `<circle cx="${dx}" cy="${dy}" r="${n(r * 0.13)}" fill="${color}" stroke="#1F1E1D" stroke-width="${n(r * 0.04)}"/>`
    if (five.fullAt !== undefined && five.fullAt < five.resetsAt && five.fullAt > c.now) {
      const [fx, fy] = polar(cx, cy, r * 0.93, dialAngle(five.fullAt))
      const t = r * 0.16
      out += `<path d="M${fx} ${n(fy - t)}L${n(fx + t)} ${n(fy + t * 0.7)}L${n(fx - t)} ${n(fy + t * 0.7)}Z" fill="${p.red}" stroke="#1F1E1D" stroke-width="${n(r * 0.03)}"${c.lite ? '' : ' style="animation:ppulse 1.2s infinite"'}/>`
    }
  }
  // ibreler: hareket açıkken açı CSS döngüsünden gelir (phaseLock duvar saatine kilitler; dakikada yeniden çizim yok)
  const hand = (len: number, wdt: number, color: string, period: number, base: number, still: number) => {
    const line = `<path d="M${n(cx)} ${n(cy + len * 0.18)}V${n(cy - len)}" stroke="${color}" stroke-width="${n(wdt)}" stroke-linecap="round"/>`
    return c.motion
      ? `<g transform="rotate(${base} ${n(cx)} ${n(cy)})"><g style="transform-origin:${n(cx)}px ${n(cy)}px;animation:pspin ${period}s linear infinite">${line}</g></g>`
      : `<g transform="rotate(${n(still)} ${n(cx)} ${n(cy)})">${line}</g>`
  }
  const st = istanbul(Math.floor(c.now / 300_000) * 300_000)
  out += hand(r * 0.5, r * 0.11, '#141413', 43_200, 90, ((st.h % 12) + st.m / 60) * 30)
  out += hand(r * 0.76, r * 0.07, '#141413', 3_600, 0, st.m * 6)
  if (c.motion && !c.lite && r * c.s >= 14) out += hand(r * 0.8, Math.max(W(c, 0.6), r * 0.03), '#D97757', 60, 0, 0)
  out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.07)}" fill="#D97757"/>`
  if (stripH) {
    if (side) {
      const sx = cx + r + pad * 2
      const sw = b.x + b.w - pad - sx
      const fs = F(c, 9, b.h * 0.2)
      const label = fitText([d.week ? `HAFTA %${Math.round(d.week.pct)}` : 'HAFTA', d.week ? `%${Math.round(d.week.pct)}` : ''], sw, fs, true)
      if (label) out += T(sx, b.y + pad + fs, label, fs, d.week ? usedTone(p, d.week.pct) : p.muted, { w: 800 })
      out += weekStrip(sx, b.y + b.h - pad - stripH, sw, stripH, d.week, c)
    } else {
      out += weekStrip(b.x + pad, b.y + b.h - pad - stripH, b.w - 2 * pad, stripH, d.week, c)
    }
  }
  const t5 = five?.resetsAt ? ` · 5 saat %${Math.round(five.pct)}, ${hm(five.resetsAt)} sıfırlanır` : ''

  return `<g>${tip(c, `Duvar saati (İstanbul)${t5}${five?.fullAt ? ` · bu hızla hak ${locSuffix(five.fullAt)} biter` : ''}`)}${out}</g>`
}

/** Takvim: haftalık %, 7 gün, sıfırlanma ve dolma günü. */
export function wallCalendar(b: Box, d: { week?: Lim }, c: DrawCtx): string {
  const p = palette(c.theme)
  const pad = Math.max(1.5, b.w * 0.06)
  const fs = F(c, 9, b.h * 0.15)
  const headH = Math.min(b.h * 0.34, fs * 1.6)
  const wk = d.week
  let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(Math.min(3, b.w * 0.05))}" fill="${p.paper}" stroke="${p.woodDark}" stroke-width="${W(c, 1, 0.8)}"/>`
  out += `<path d="M${n(b.x)} ${n(b.y + headH)}V${n(b.y + 2)}q0 -2 2 -2H${n(b.x + b.w - 2)}q2 0 2 2V${n(b.y + headH)}Z" fill="${p.red}"/>`
  out += `<path d="M${n(b.x + b.w * 0.28)} ${n(b.y - 1.5)}v${n(headH * 0.4)}M${n(b.x + b.w * 0.72)} ${n(b.y - 1.5)}v${n(headH * 0.4)}" stroke="${p.metal}" stroke-width="${n(Math.max(1, b.w * 0.04))}" stroke-linecap="round"/>`
  const head = fitText([wk ? `HAFTA %${Math.round(wk.pct)}` : 'HAFTA', wk ? `%${Math.round(wk.pct)}` : '—'], b.w - 2 * pad, fs, true)
  out += T(b.x + b.w / 2, b.y + headH / 2 + fs * 0.36, head, fs, '#FFF7ED', { a: 'middle', w: 800 })
  const rows = b.w / (b.h - headH) < 1.1 ? 2 : 1
  const footFs = F(c, 9, b.h * 0.12)
  const resetTxt = wk?.resetsAt && wk.resetsAt > c.now ? DAYS[new Date(wk.resetsAt + 3 * 3_600_000).getUTCDay()] : undefined
  const foot = fitText(resetTxt ? [`${resetTxt} sıfırlanır`, `↻ ${resetTxt}`] : [], b.w - 2 * pad, footFs)
  const gridH = b.h - headH - pad * 2 - (foot ? footFs * 1.3 : 0)
  out += weekStrip(b.x + pad, b.y + headH + pad, b.w - 2 * pad, Math.max(4, gridH), wk, c, rows)
  if (foot) out += T(b.x + b.w / 2, b.y + b.h - pad, foot, footFs, p.muted, { a: 'middle' })

  return `<g>${tip(c, wk ? `Haftalık limit %${Math.round(wk.pct)}${wk.resetsAt ? ` · ${hm(wk.resetsAt)} sıfırlanır` : ''}` : 'Haftalık limit bekleniyor')}${out}</g>`
}

/** Pencere: gökyüzü saat dilimini, aydınlık bina pencereleri bugünkü sohbet sayısını gösterir; olayda pencere açılır. */
export function windowView(b: Box, d: { lights: number; openAt?: number; sun?: boolean }, c: DrawCtx): string {
  const p = palette(c.theme)
  const { h } = istanbul(c.now)
  const night = h < 6 || h >= 20
  const dusk = h >= 17 && h < 20
  const dawn = h >= 6 && h < 8
  const bands = night ? ['#070A1C', '#0E1230', '#1B1D4A'] : dusk ? ['#5B3A8C', '#B4558A', '#F08A4B'] : dawn ? ['#8FA6D8', '#F2A7B0', '#FBD38D'] : ['#3E86E0', '#6FA8EE', '#B9D8F7']
  const ft = clamp(Math.min(b.w, b.h) * 0.06, 1.5, 5)
  const ix = b.x + ft
  const iy = b.y + ft
  const iw = b.w - 2 * ft
  const ih = b.h - 2 * ft
  let sky = ''
  bands.forEach((col, i) => (sky += R(ix, iy + (ih * i) / 3, iw, ih / 3 + 0.5, col)))
  if (night) {
    let stars = ''
    for (let i = 0; i < Math.min(12, Math.round(iw / 12)); i++) stars += `M${n(ix + ((hash(`st${i}${b.x}`) % 1000) / 1000) * iw)} ${n(iy + ((hash(`sy${i}`) % 1000) / 1000) * ih * 0.45)}h.8v.8h-.8z`
    sky += `<path d="${stars}" fill="#fff" opacity=".8"/>`
    // ay ve güneş tek: yalnız ilk pencerede (her pencere kendi güneşini çizmez)
    if (d.sun !== false) sky += `<circle cx="${n(ix + iw * 0.78)}" cy="${n(iy + ih * 0.22)}" r="${n(ih * 0.09)}" fill="#F1F5F9"/><circle cx="${n(ix + iw * 0.78 + ih * 0.04)}" cy="${n(iy + ih * 0.2)}" r="${n(ih * 0.085)}" fill="${bands[0]}"/>`
  } else if (d.sun !== false) {
    const t = clamp((h - 6) / 14, 0, 1)
    sky += `<circle cx="${n(ix + iw * (0.15 + 0.7 * t))}" cy="${n(iy + ih * (0.18 + 0.25 * Math.abs(t - 0.5) * 2))}" r="${n(ih * 0.09)}" fill="${dusk || dawn ? '#FDBA74' : '#FDE047'}"/>`
  }
  // şehir: tek yol; pencereler ışık sayısı kadar yanar (gündüz soluk)
  let bx = ix
  let i = 0
  let city = `M${n(ix)} ${n(iy + ih)}`
  const spots: Pt[] = []
  while (bx < ix + iw) {
    const bw = Math.max(5, iw * (0.08 + ((hash(`bw${i}${Math.round(b.x)}`) % 100) / 100) * 0.1))
    const bh = ih * (0.22 + ((hash(`bh${i}${Math.round(b.x)}`) % 100) / 100) * 0.38)
    const top = iy + ih - bh
    const right = Math.min(ix + iw, bx + bw)
    city += `V${n(top)}H${n(right)}`
    for (let wy = top + 2.5; wy < iy + ih - 2.5; wy += 3.6) for (let wx = bx + 1.6; wx < right - 2.4; wx += 3.2) spots.push([n(wx), n(wy)])
    bx = right + Math.max(0.6, iw * 0.012)
    if (bx < ix + iw) city += `V${n(iy + ih)}H${n(bx)}`
    i++
  }
  city += `V${n(iy + ih)}Z`
  sky += `<path d="${city}" fill="${night ? '#0B1024' : dusk ? '#3B2A55' : '#5B6B82'}"/>`
  const lit = spots
    .map((s, k) => [hash(`l${k}${Math.round(b.x)}`), s] as const)
    .sort((a, b2) => a[0] - b2[0])
    .slice(0, Math.min(Math.max(0, Math.round(d.lights)), 60))
  if (lit.length) sky += `<path d="${lit.map(([, [x, y]]) => `M${x} ${y}h1.4v1.6h-1.4z`).join('')}" fill="#FDE68A" opacity="${night || dusk ? 0.95 : 0.6}"/>`
  // cam, kayan alt kanat, kayıtlar
  const sash = `<g${live(c, d.openAt, 6) ? ` style="--py:${n(-ih * 0.4)}px;${once(c, 'pwin', 5.5, d.openAt)}"` : ''}>${R(ix, iy + ih * 0.52, iw, ft * 0.7, p.wood)}<path d="M${n(ix + iw * 0.12)} ${n(iy + ih * 0.95)}L${n(ix + iw * 0.3)} ${n(iy + ih * 0.58)}" stroke="#fff" stroke-width="${n(iw * 0.03)}" opacity=".15"/></g>`
  let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(ft * 0.6)}" fill="${p.wood}"/>`
  out += clipBox({ x: ix, y: iy, w: iw, h: ih }, `<g transform="translate(${n(-ix)},${n(-iy)})">${sky}</g>`)
  out += `<path d="M${n(ix + iw / 2)} ${n(iy)}V${n(iy + ih * 0.52)}" stroke="${p.wood}" stroke-width="${n(ft * 0.7)}"/>${sash}`
  out += R(b.x - ft * 0.5, b.y + b.h - ft * 0.5, b.w + ft, ft * 0.9, p.woodDark)

  return `<g>${tip(c, `Pencere · ${night ? 'gece' : dusk ? 'akşam' : dawn ? 'şafak' : 'gündüz'} · bugün ${Math.round(d.lights)} sohbet (yanan pencereler)`)}${out}</g>`
}

/** Süre: 1 saatten kısa 5 dk, uzun 15 dk kademeli (her dakika yeniden çizim olmasın). */
function stepDuration(ms: number): string {
  const min = Math.max(0, ms / 60_000)
  if (min < 60) return `${Math.floor(min / 5) * 5}dk`
  const q = Math.floor(min / 15) * 15

  return `${Math.floor(q / 60)}sa${q % 60 ? ` ${q % 60}dk` : ''}`
}
const tok = (v: number): string => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))

/** LED skor tabelası: tur, araç, ajan, üretilen, süre, bugün/bu sohbet $, $/sa (API karşılığı, tahmini). */
export function scoreboard(b: Box, d: { turns: number; tools: number; active: number; total: number; outTokens: number; usdToday?: number; usdChat?: number; perHour?: number; chats?: number; sessionMs: number }, c: DrawCtx): string {
  // duvara asılı LED pano: ahşap çerçeve, köşe vidaları, çerçevenin içinde koyu panel
  const fw = Math.max(1.5, Math.min(b.w, b.h) * 0.045)
  const pad = Math.max(2, Math.min(b.w, b.h) * 0.07) + fw
  const fsL = F(c, 9, b.h * 0.12)
  const fsV = F(c, 12, b.h * 0.21)
  const innerW = b.w - 2 * pad
  const widthOf = ([l, v]: [string, string]) => Math.max(textWidth(l, fsL, true) + l.length * fsL * 0.05, textWidth(v, fsV, true, true)) + fsV * 0.7
  // önce para: BUGÜN ile BU SOHBET yan yana (dar panoda alt alta), sonra sayaçlar; sığmayan sayaç düşer, para düşmez
  const money: Array<[string, string]> = []
  if (d.usdToday !== undefined) money.push(['BUGÜN', `$${d.usdToday.toFixed(2)}`])
  if (d.usdChat !== undefined) {
    const full: [string, string] = ['BU SOHBET', `$${d.usdChat.toFixed(2)}`]
    const short: [string, string] = ['SOHBET', full[1]]
    const day = money[0] ? widthOf(money[0]) : 0
    // yan yana sığan en uzun etiket; yan yana hiç sığmıyorsa kendi satırında sığan
    money.push(day + widthOf(full) <= innerW ? full : day + widthOf(short) <= innerW ? short : widthOf(full) <= innerW ? full : short)
  }
  const counters: Array<[string, string]> = [
    ['AJAN', `${d.active}/${d.total}`],
    ['TUR', String(d.turns)],
    ['ARAÇ', String(d.tools)],
    ['SÜRE', stepDuration(d.sessionMs)],
    ['ÜRETİLEN', tok(d.outTokens)],
  ]
  if (d.perHour !== undefined) counters.push(['$/SA', `$${d.perHour.toFixed(1)}`])
  if (d.chats !== undefined) counters.push(['SOHBETLER', String(d.chats)])
  const rowH = fsL * 1.1 + fsV * 1.12
  const footFs = F(c, 9, b.h * 0.1)
  const maxRows = Math.max(1, Math.floor((b.h - 2 * pad) / rowH))
  const placed: Array<Array<[string, string]>> = []
  const left = [...money]
  const rest = [...counters]
  for (let r = 0; r < maxRows && (left.length || rest.length); r++) {
    const row: Array<[string, string]> = []
    let used = 0
    // para hücreleri sırayla: sığmayan bir sonraki satıra kalır
    while (left.length && (row.length === 0 || used + widthOf(left[0] as [string, string]) <= innerW)) {
      used += widthOf(left[0] as [string, string])
      row.push(left.shift() as [string, string])
    }
    // sayaçlar: sığmayan atlanır, arkasındaki daha dar olan denenir; kalan para hücrelerine satır kalıyorsa yanlarına da
    if (left.length <= maxRows - r - 1) {
      for (let j = 0; j < rest.length; j++) {
        const cell = rest[j] as [string, string]
        if (used + widthOf(cell) > innerW) continue
        used += widthOf(cell)
        row.push(cell)
        rest.splice(j--, 1)
      }
    }
    if (!row.length) break
    placed.push(row)
  }
  // AJAN goes last of all counters: it takes a narrower counter's place (with 'SOHBET' for 'BU SOHBET' if need be)
  const ajan = rest.find(r => r[0] === 'AJAN')
  if (ajan) {
    const sum = (row: Array<[string, string]>) => row.reduce((a, x) => a + widthOf(x), 0)
    // all at work: '10' says it as well as '10/10' where only the shorter fits
    const forms: Array<[string, string]> = d.active === d.total ? [ajan, ['AJAN', String(d.active)]] : [ajan]
    swap: for (const form of forms) for (const row of [...placed].reverse()) {
      for (let j = row.length - 1; j >= 0; j--) {
        const cell = row[j] as [string, string]
        if (cell[1].startsWith('$')) continue
        for (const shorten of [false, true]) {
          const next = row.map((x, i): [string, string] => (i === j ? form : shorten && x[0] === 'BU SOHBET' ? ['SOHBET', x[1]] : x))
          if (sum(next) <= innerW) {
            row.splice(0, row.length, ...next)
            break swap
          }
        }
      }
    }
  }
  const rows = placed.length
  const foot = b.h - 2 * pad - rows * rowH >= footFs * 1.2
  const pw = palette(c.theme)
  let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(Math.min(3, b.h * 0.04))}" fill="${pw.wood}" stroke="${pw.woodDark}" stroke-width="${W(c, 1, 0.8)}"/>` + R(b.x + fw * 0.3, b.y + fw * 0.25, b.w - fw * 0.6, fw * 0.3, '#fff', ' opacity=".12"')
  out += `<rect x="${n(b.x + fw)}" y="${n(b.y + fw)}" width="${n(b.w - 2 * fw)}" height="${n(b.h - 2 * fw)}" rx="${n(Math.min(3, b.h * 0.05))}" fill="${LED.bezel}"/><rect x="${n(b.x + fw + (pad - fw) * 0.45)}" y="${n(b.y + fw + (pad - fw) * 0.45)}" width="${n(b.w - 2 * fw - (pad - fw) * 0.9)}" height="${n(b.h - 2 * fw - (pad - fw) * 0.9)}" rx="${n(Math.min(3, b.h * 0.05))}" fill="${LED.bg}"/>`
  const vr = n(fw * 0.28)
  out += `<path d="${[[b.x + fw / 2, b.y + fw / 2], [b.x + b.w - fw / 2, b.y + fw / 2], [b.x + fw / 2, b.y + b.h - fw / 2], [b.x + b.w - fw / 2, b.y + b.h - fw / 2]].map(([x, y]) => `M${n((x as number) - vr)} ${n(y as number)}a${vr} ${vr} 0 1 0 ${n(vr * 2)} 0a${vr} ${vr} 0 1 0 ${n(-vr * 2)} 0`).join('')}" fill="#C9B79C"/>`
  const top = b.y + pad + (b.h - 2 * pad - rows * rowH - (foot ? footFs * 1.2 : 0)) / 2
  placed.forEach((row, r) => {
    // her hücre kendi genişliğinde, artan yer eşit dağılır (geniş değer komşusuna taşmaz)
    const ws = row.map(widthOf)
    const extra = (innerW - ws.reduce((a, b2) => a + b2, 0)) / row.length
    let cx = b.x + pad
    row.forEach(([l, v], j) => {
      const cw = (ws[j] as number) + extra
      const x = cx + cw / 2
      const sepX = cx
      cx += cw
      const y = top + r * rowH
      out += T(x, y + fsL * 0.9, l, fsL, LED.dim, { a: 'middle', w: 700, ls: fsL * 0.05 })
      const money = v.startsWith('$')
      out += T(x, y + fsL * 1.1 + fsV * 0.92, v, fsV, money ? LED.green : LED.amber, { a: 'middle', w: 700, m: true })
      if (j) out += `<path d="M${n(sepX)} ${n(y + rowH * 0.15)}v${n(rowH * 0.7)}" stroke="#262A31" stroke-width="${W(c, 1, 0.6)}"/>`
    })
  })
  if (foot) out += T(b.x + b.w / 2, b.y + b.h - pad, fitText(['API KARŞILIĞI · TAHMİNİ', 'TAHMİNİ'], innerW - 24 * footFs * 0.06, footFs), footFs, '#5C6470', { a: 'middle', ls: footFs * 0.06 })

  return `<g>${tip(c, `Tur ${d.turns} · araç ${d.tools} · ajan ${d.active}/${d.total} · üretilen ${tok(d.outTokens)} · süre ${stepDuration(d.sessionMs)}${d.usdToday !== undefined ? ` · bugün $${d.usdToday.toFixed(2)}` : ''}${d.usdChat !== undefined ? ` · bu sohbet $${d.usdChat.toFixed(2)}` : ''} (API karşılığı, tahmini; fatura değil)`)}${out}</g>`
}

const FEED_SPRITE: Partial<Record<FeedKind, SpriteName>> = {
  think: 'think', read: 'read', write: 'write', run: 'run', web: 'web', plan: 'plan', talk: 'send', wait: 'wait', done: 'done', fail: 'fail', compact: 'squeeze',
}

/**
 * LED kayan yazı bandı. En yeni öğe solda, sabit ve tam (kaynakta hiç kısaltılmaz; banda sığmazsa
 * penceresinde gidip gelir). Eskiler sağında, yeni öğe gelince bir yuva sağa kayar (en çok 8, lite 4).
 */
export function ticker(b: Box, items: readonly TickerItem[], c: DrawCtx): string {
  const fs = F(c, 11, b.h * 0.58)
  const base = b.y + b.h / 2 + fs * 0.36
  const icon = Math.min(b.h * 0.9, fs * 1.25)
  const gap = fs * 1.3
  let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="${LED.bg}"/><path d="M${n(b.x)} ${n(b.y + 0.4)}H${n(b.x + b.w)}M${n(b.x)} ${n(b.y + b.h - 0.4)}H${n(b.x + b.w)}" stroke="${LED.bezel}" stroke-width="${W(c, 1, 0.8)}"/>`
  let x = b.x + fs * 0.5
  const tag = b.w / fs > 42
  if (tag) {
    const tw = textWidth('CANLI', fs * 0.8, true) + fs * 0.8
    out += `<rect x="${n(x)}" y="${n(b.y + b.h / 2 - fs * 0.62)}" width="${n(tw)}" height="${n(fs * 1.24)}" rx="${n(fs * 0.3)}" fill="#B42318"/>${T(x + tw / 2, b.y + b.h / 2 + fs * 0.29, 'CANLI', fs * 0.8, '#FFF', { a: 'middle', w: 800, ls: fs * 0.05 })}`
    x += tw + gap * 0.7
  }
  const list = [...items].sort((a, b2) => b2.t - a.t).slice(0, c.lite ? 4 : 8)
  // bir haber: sığmayan gövde sağdan '…' ile kısalır; ad bile sığmıyorsa hiç çizilmez (kesik yazı yok)
  const piece = (it: TickerItem, x0: number, newest: boolean, maxW = Infinity): { svg: string; w: number } => {
    let s = ''
    let cx = x0
    const sp = newest ? FEED_SPRITE[it.kind] : undefined
    if (sp) {
      const a = ago(c, it.t)
      const icn = sprite(sp, cx, b.y + b.h / 2 - icon / 2, icon, live(c, it.t, 2.7), -a, 3)
      if (icn) {
        s += icn
        cx += icon + fs * 0.3
      }
    }
    if (it.face) {
      s += charIcon(it.face, cx, b.y + b.h / 2 - icon / 2, icon)
      cx += icon + fs * 0.25
    }
    let t = `<tspan fill="${it.color}" font-weight="700">${esc(it.who)}</tspan>`
    let w = textWidth(it.who, fs, true)
    if (it.to) {
      let face = ''
      t += ' → '
      w += textWidth(' → ', fs)
      if (it.toFace) {
        face = charIcon(it.toFace, cx + w, b.y + b.h / 2 - icon / 2, icon)
        t += `<tspan dx="${n(icon + fs * 0.2)}" fill="${it.toColor ?? LED.text}" font-weight="700">${esc(it.to)}</tspan>`
        w += icon + fs * 0.2
      } else t += `<tspan fill="${it.toColor ?? LED.text}" font-weight="700">${esc(it.to)}</tspan>`
      w += textWidth(it.to, fs, true)
      s += face
    }
    const head = cx - x0 + w * 1.08
    if (head > maxW) return { svg: '', w: Infinity }
    const full = (it.to ? '· ' : '') + (it.text.length > 60 ? `${it.text.slice(0, 59)}…` : it.text)
    const room = (maxW - head) / 1.08 - textWidth(' ', fs)
    const body = room === Infinity || textWidth(full, fs) <= room ? full : room >= fs * 2.5 ? ellipsize(full, room, fs) : ''
    if (body) {
      t += ` ${esc(body)}`
      w += textWidth(` ${body}`, fs)
    }
    s += `<text x="${n(cx)}" y="${n(base)}" class="pt" font-size="${n(fs)}" fill="${newest ? LED.text : '#AEB4BE'}">${t}</text>`

    return { svg: s, w: cx - x0 + w * 1.08 }
  }
  const first = list[0]
  if (!first) return `<g>${out}${T(x, base, 'Ofis sessiz', fs, LED.dim)}</g>`
  // en yeni: penceresine sığmazsa gövdesi kısalır (kaymaz, kesilmez)
  const slot = Math.min(b.x + b.w - x - fs * 0.5, Math.max(b.w * 0.5, Math.min(b.w - (x - b.x) - fs, 520)))
  const nw = piece(first, 0, true, slot)
  let lead = nw.svg
  // the newest fades in where it stands, rising a little: sliding in from the side, its clip window would
  // show a cut piece of it ('…nut çalıştırdı') at the start
  if (live(c, first.t, 1.2)) lead = `<g style="--px:0px;--py:${n(fs * 0.3)}px;${once(c, 'pslide', 0.7, first.t)}">${lead}</g>`
  if (nw.w !== Infinity) {
    out += clipBox({ x, y: b.y, w: Math.min(slot, nw.w + fs * 0.2), h: b.h }, `<g transform="translate(0,${n(-b.y)})">${lead}</g>`)
    noteBox({ x, y: b.y, w: Math.min(slot, nw.w), h: b.h })
    x += Math.min(slot, nw.w) + gap
  }
  // eskiler: yalnız tümüyle sığanlar (sondaki gövdesi kısalmış olabilir); yarım kalan haber yok
  if (list.length > 1 && b.x + b.w - x > fs * 4) {
    out += `<path d="M${n(x - gap * 0.5)} ${n(b.y + b.h * 0.22)}v${n(b.h * 0.56)}" stroke="${LED.bezel}" stroke-width="${W(c, 1.2, 1)}"/>`
    let rest = ''
    let rx = 0
    const avail = b.x + b.w - x - fs * 0.4
    for (const [i, it] of list.slice(1).entries()) {
      const pc = piece(it, rx, false, avail - rx)
      if (pc.w === Infinity) break
      if (i > 0) rest += `<circle cx="${n(rx - gap / 2)}" cy="${n(b.y + b.h / 2)}" r="${n(fs * 0.16)}" fill="${LED.amber}" opacity=".7"/>`
      rest += `<g opacity="${n(Math.max(0.45, 1 - i * 0.09))}">${pc.svg}</g>`
      rx += pc.w + gap
      if (avail - rx < fs * 4) break
    }
    if (rest) {
      noteBox({ x, y: b.y, w: Math.max(0, rx - gap), h: b.h })
      // the older ones fade in at their new places (shifted in from the left, the one that was newest showed cut)
      if (live(c, first.t, 1.2)) rest = `<g style="${once(c, 'pin', 0.8, first.t)}">${rest}</g>`
      out += clipBox({ x, y: b.y, w: b.x + b.w - x, h: b.h }, `<g transform="translate(0,${n(-b.y)})">${rest}</g>`)
    }
  }

  return `<g>${out}</g>`
}

// ——— patron bölgesi ————————————————————————————————————————————

/** Beyaz tahta: başlık (PLAN, HATA AYIKLAMA…), istek not kartı, kayan düşünce, adım çentikleri, plan ilerlemesi. */
export function whiteboard(b: Box, d: { title: string; prompt: string; thought: string; think: ThinkKind; steps: number; active: boolean; plan?: Progress; noteAt?: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const fr = Math.max(1.5, Math.min(b.w, b.h) * 0.035)
  const ix = b.x + fr
  const iy = b.y + fr
  const iw = b.w - 2 * fr
  const trayH = Math.max(2, b.h * 0.06)
  const ih = b.h - 2 * fr - trayH
  const pad = Math.max(2, iw * 0.04)
  const fsT = F(c, 9, ih * 0.14)
  const fsB = F(c, 9, ih * 0.11)
  const ink = '#1E3A8A'
  let out = `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h - trayH)}" rx="${n(fr)}" fill="${p.metal}"/><rect x="${n(ix)}" y="${n(iy)}" width="${n(iw)}" height="${n(ih)}" fill="${c.theme === 'light' ? '#FBFBF7' : '#E9E7E0'}"/>`
  out += `<path d="M${n(ix + iw * 0.55)} ${n(iy + ih * 0.1)}L${n(ix + iw * 0.8)} ${n(iy + ih * 0.9)}" stroke="#fff" stroke-width="${n(iw * 0.08)}" opacity=".35"/>`
  // kalem tablası ve kalemler
  out += R(b.x + b.w * 0.08, b.y + b.h - trayH * 1.4, b.w * 0.84, trayH * 1.1, p.metal) + R(b.x + b.w * 0.2, b.y + b.h - trayH * 1.8, b.w * 0.1, trayH * 0.5, '#1D4ED8') + R(b.x + b.w * 0.33, b.y + b.h - trayH * 1.8, b.w * 0.1, trayH * 0.5, '#DC2626') + R(b.x + b.w * 0.46, b.y + b.h - trayH * 1.8, b.w * 0.08, trayH * 0.5, '#111')
  let y = iy + pad + fsT * 0.85
  const iconK = (fsT * 1.15) / 14
  const titleW = (iw - 2 * pad - 14 * iconK - pad) * 0.92
  out += T(ix + pad, y, fitText([d.title.toLocaleUpperCase('tr-TR'), d.title.toLocaleUpperCase('tr-TR').split(' ')[0] ?? ''], titleW, fsT, true) || d.title.slice(0, 4), fsT, ink, { w: 700, h: true, ls: fsT * 0.03 })
  out += thinkIcon(d.think, ix + iw - pad - 14 * iconK, y - fsT * 0.95, '#1E3A8A', iconK)
  y += fsT * 0.45
  const footH = fsB * 1.5
  const bodyH = iy + ih - pad - footH - y
  // istek: sarı not kartı (yeni istekte yapışır)
  const wide = iw > ih * 1.5
  const noteW = wide ? iw * 0.44 : iw - 2 * pad
  // the text whole where a smaller hand (down to 9 px) fits it, before a '…'
  const fit = (text: string, w: number, h: number, most: number): { lines: string[]; fs: number } => {
    const floor = Math.min(fsB, F(c, 9, 0))
    for (let fs = fsB; fs >= floor - 1e-6; fs -= Math.max(0.05, fsB * 0.05)) {
      const k = Math.min(most, Math.floor(h / (fs * 1.2)))
      if (k < 1) break
      const lines = wrap(text, w, fs, k)
      if (!lines.some(l => l.endsWith('…'))) return { lines, fs }
    }
    const k = Math.min(most, Math.floor(h / (fsB * 1.2)))
    return { lines: k >= 1 ? wrap(text, w, fsB, k) : [], fs: fsB }
  }
  // tek satıra bile yer yoksa (çok küçük tahta) not kartı ve düşünce çizilmez: başlık ve adımlar kalır
  const noteFit = fit(d.prompt || 'Yeni iş bekleniyor', noteW - pad * 1.2, (wide ? bodyH : bodyH * 0.55) - pad * 0.4, 4)
  const pl = noteFit.lines
  const fsN = noteFit.fs
  const lineH = fsN * 1.2
  const noteH = pl.length ? Math.min(wide ? bodyH : bodyH * 0.6, pl.length * lineH + pad) : 0
  let note = `<rect x="${n(ix + pad)}" y="${n(y)}" width="${n(noteW)}" height="${n(noteH)}" fill="#FDE68A"/><path d="M${n(ix + pad + noteW - noteH * 0.25)} ${n(y + noteH)}l${n(noteH * 0.25)} ${n(-noteH * 0.25)}v${n(noteH * 0.25)}z" fill="#E7C65A"/>`
  pl.forEach((l, i) => (note += T(ix + pad * 1.6, y + pad * 0.4 + fsN * 0.95 + i * lineH, l, fsN, '#3B2F0B', { h: true })))
  if (live(c, d.noteAt, 1.6)) note = `<g class="pc" style="${once(c, 'pnote', 0.7, d.noteAt)}">${note}</g>`
  if (pl.length) out += note
  // düşünce: el yazısı satırları; uzunsa penceresinde kayar
  const tx = wide ? ix + pad * 2 + noteW : ix + pad
  const ty = wide ? y : y + noteH + pad * 0.6
  const tw2 = wide ? iw - 3 * pad - noteW : iw - 2 * pad
  const th = wide ? bodyH : bodyH - noteH - pad * 0.6
  const thought = d.thought.replace(/\s+/g, ' ').trim().slice(0, 140)
  if (thought && th >= fsB * 1.2) {
    const got = fit(thought, tw2, th, 6)
    const tl = got.lines
    const fsH = got.fs
    const lh = fsH * 1.2
    tl.forEach((l, i) => (out += T(tx, ty + fsH * 0.95 + i * lh, l, fsH, '#1E3A8A', { h: true })))
    if (d.active && c.motion && !c.lite && tl.length) {
      const last = tl[tl.length - 1] as string
      out += R(tx + textWidth(last, fsH) + fsH * 0.15, ty + (tl.length - 1) * lh + fsH * 0.1, Math.max(0.8, fsH * 0.1), fsH, '#1E3A8A', ' style="animation:pblink .9s infinite"')
    }
  }
  // adımlar ve plan
  const fy = iy + ih - pad - footH * 0.25
  const plan = d.plan && d.plan.total > 0 ? d.plan : undefined
  const planW = plan ? Math.min(iw * 0.45, textWidth(`${plan.done}/${plan.total}`, fsB, true) + iw * 0.2) : 0
  const notchW = iw - 2 * pad - (plan ? planW + pad : 0)
  const count = 12
  const step = notchW / count
  const lit = Math.min(count, d.active ? d.steps : 0)
  let on = ''
  let off = ''
  for (let i = 0; i < count; i++) (i < lit ? (on += `M${n(ix + pad + i * step)} ${n(fy - footH * 0.5)}h${n(step * 0.72)}v${n(footH * 0.45)}h${n(-step * 0.72)}z`) : (off += `M${n(ix + pad + i * step)} ${n(fy - footH * 0.5)}h${n(step * 0.72)}v${n(footH * 0.45)}h${n(-step * 0.72)}z`))
  if (on) out += `<path d="${on}" fill="#D97757"/>`
  if (off) out += `<path d="${off}" fill="#CBD5E1"/>`
  if (plan) {
    const px0 = ix + iw - pad - planW
    const bw = planW - textWidth(`${plan.done}/${plan.total}`, fsB, true) - pad * 0.5
    out += R(px0, fy - footH * 0.5, bw, footH * 0.45, '#CBD5E1') + R(px0, fy - footH * 0.5, (bw * clamp(plan.done, 0, plan.total)) / plan.total, footH * 0.45, '#16A34A')
    out += T(ix + iw - pad, fy, `${plan.done}/${plan.total}`, fsB, '#166534', { a: 'end', w: 800 })
  }

  return `<g>${tip(c, `${d.title}: ${d.prompt}${plan ? ` · plan ${plan.done}/${plan.total}` : ''}`)}${out}</g>`
}

/** Su sebili = bağlam: su seviyesi %, renk mavi/amber/kırmızı, damacanada token/pencere, oto eşiği kesik çizgi, son ölçümler çentik; sıkıştırmada boşalır. */
export function waterCooler(b: Box, d: { pct: number; tokens?: number; window?: number; autoAt?: number; history?: readonly number[]; drainAt?: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const pct = clamp(d.pct, 0, 100)
  const color = pct >= 85 ? '#E0685A' : pct >= 60 ? '#E3A04F' : '#5DA9E9'
  const fsN = F(c, 9, b.w * 0.34)
  const fsS = F(c, 9, b.w * 0.2)
  const tokTxt = d.tokens !== undefined ? fitText([`${tok(d.tokens)}${d.window ? ` / ${tok(d.window)}` : ''}`, `${tok(d.tokens)}${d.window ? `/${tok(d.window)}` : ''}`, tok(d.tokens)], b.w - 2, fsS, false, true) : ''
  const textH = fsN * 1.15 + (tokTxt ? fsS * 1.2 : 0)
  const bodyH = b.h - textH - 1
  const bw = Math.min(b.w * 0.86, bodyH * 0.55)
  const bx = b.x + (b.w - bw) / 2
  const bottleH = bodyH * 0.46
  const cabY = b.y + bottleH + bodyH * 0.04
  const cabH = bodyH - bottleH - bodyH * 0.04
  let out = ''
  // damacana (ters): yukarıda gövde, altta boyun
  const neckW = bw * 0.32
  const by = b.y + 0.5
  const bh = bottleH - bodyH * 0.04
  const level = (bh - 2) * (pct / 100)
  out += `<path d="M${n(bx + bw * 0.08)} ${n(by + bh * 0.84)}V${n(by + bh * 0.12)}q0 -${n(bh * 0.12)} ${n(bw * 0.18)} -${n(bh * 0.12)}H${n(bx + bw * 0.74)}q${n(bw * 0.18)} 0 ${n(bw * 0.18)} ${n(bh * 0.12)}V${n(by + bh * 0.84)}q0 ${n(bh * 0.1)} -${n(bw * 0.29)} ${n(bh * 0.12)}H${n(bx + bw * 0.37)}q-${n(bw * 0.29)} -${n(bh * 0.02)} -${n(bw * 0.29)} -${n(bh * 0.12)}Z" fill="#CFE8FA" fill-opacity=".28" stroke="#9CC9EA" stroke-width="${W(c, 1, 0.8)}"/>`
  let water = R(bx + bw * 0.12, by + bh - 1 - level, bw * 0.76, level, color, ` fill-opacity=".85"`)
  if (live(c, d.drainAt, 6)) water = `<g class="pb" style="--ps:.3;${once(c, 'pdrain', 5, d.drainAt)}">${water}</g>`
  out += water + R(bx + bw * 0.2, by + bh - 1 - level, bw * 0.08, level, '#fff', ' opacity=".25"')
  if (live(c, d.drainAt, 6)) {
    for (let i = 0; i < 4; i++) out += `<circle cx="${n(bx + bw * (0.3 + i * 0.13))}" cy="${n(by + bh - 2)}" r="${n(bw * 0.05)}" fill="#fff" opacity="0" style="--py:${n(-bh * 0.7)}px;animation:pbub 1.4s ${n(-ago(c, d.drainAt) + i * 0.3)}s 3"/>`
  }
  if (d.autoAt) {
    const ay = by + bh - 1 - (bh - 2) * (d.autoAt / 100)
    out += `<path d="M${n(bx + bw * 0.04)} ${n(ay)}H${n(bx + bw * 0.96)}" stroke="#E0685A" stroke-width="${W(c, 1.2, 0.9)}" stroke-dasharray="${n(bw * 0.1)} ${n(bw * 0.07)}"/>`
  }
  const hist = (d.history ?? []).slice(-6)
  if (hist.length) out += `<path d="${hist.map(v => `M${n(bx + bw * 0.02)} ${n(by + bh - 1 - (bh - 2) * (clamp(v, 0, 100) / 100))}h${n(bw * 0.1)}`).join('')}" stroke="${p.muted}" stroke-width="${W(c, 1, 0.7)}"/>`
  out += R(bx + bw / 2 - neckW / 2, by + bh, neckW, bodyH * 0.05, '#9CC9EA')
  // dolap: musluklar, damla tepsisi
  out += `<rect x="${n(bx)}" y="${n(cabY)}" width="${n(bw)}" height="${n(cabH)}" rx="${n(bw * 0.12)}" fill="${c.theme === 'light' ? '#F4F4F2' : '#D8D6D0'}" stroke="${p.metal}" stroke-width="${W(c, 1, 0.8)}"/>`
  out += R(bx + bw * 0.18, cabY + cabH * 0.16, bw * 0.16, cabH * 0.1, '#3B82F6') + R(bx + bw * 0.66, cabY + cabH * 0.16, bw * 0.16, cabH * 0.1, '#EF4444')
  out += R(bx + bw * 0.12, cabY + cabH * 0.46, bw * 0.76, cabH * 0.07, '#8A8F98') + R(bx + bw * 0.1, cabY + cabH - cabH * 0.08, bw * 0.8, cabH * 0.05, '#6B7078')
  // yazılar
  out += T(b.x + b.w / 2, b.y + bodyH + fsN * 0.95, `%${Math.round(pct)}`, fsN, color === '#5DA9E9' ? p.text : color, { a: 'middle', w: 800 })
  if (tokTxt) out += T(b.x + b.w / 2, b.y + bodyH + fsN * 1.15 + fsS * 0.95, tokTxt, fsS, p.muted, { a: 'middle', m: true })

  return `<g>${tip(c, `Bağlam (su sebili) %${Math.round(pct)}${d.tokens !== undefined ? ` · ${tok(d.tokens)}${d.window ? ` / ${tok(d.window)}` : ''} token` : ''}${d.autoAt ? ` · oto-sıkıştırma %${d.autoAt}` : ''}`)}${out}</g>`
}

/** Enerji bataryası: 5 saatlik ve haftalık KALAN hak (dolu = kalan), hız, tahmini tükenecek dilim (taralı), bitiş/dolma saati; boşsa yanıp sönen BİTTİ. */
export function battery(b: Box, d: { five?: Lim; week?: Lim; flashAt?: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const fs = F(c, 9, Math.min(b.w * 0.2, b.h * 0.07))
  const fsB = F(c, 9, Math.min(b.w * 0.27, b.h * 0.1))
  const cellsDef: Array<{ key: string; label: string; lim?: Lim }> = [
    { key: '5S', label: '5S', lim: d.five },
    { key: 'H', label: 'HAFTA', lim: d.week },
  ]
  const rem = (l?: Lim) => (l ? clamp(100 - l.pct, 0, 100) : undefined)
  const proj = (l?: Lim): { used: number; out: boolean } => {
    if (!l) return { used: 0, out: false }
    const r = rem(l) ?? 0
    if (l.fullAt !== undefined && (l.resetsAt === undefined || l.fullAt < l.resetsAt)) return { used: r, out: true }
    // 5 dk kademeli: boşta resim her saniye değişmesin (frameKey)
    const now5 = Math.floor(c.now / 300_000) * 300_000
    if (l.rate && l.resetsAt && l.resetsAt > now5) return { used: Math.min(r, Math.round((l.rate * (l.resetsAt - now5)) / 3_600_000)), out: false }
    return { used: 0, out: false }
  }
  // alt yazılar: bataryanın kendi genişliğinde (yanındaki öğütücünün plakası birkaç ou ötede)
  const lines: Array<{ t: string; color: string; size: number; bold?: boolean; blink?: boolean }> = []
  const f5 = d.five
  const r5 = rem(f5)
  // iki satır: kalan haklar (5S solda, H sağda: hücrelerle aynı sıra) ve tek zaman bilgisi; hız yalnız ipucunda
  const rw = rem(d.week)
  if (r5 !== undefined && f5) {
    if (r5 <= 0) lines.push({ t: 'BİTTİ', color: p.red, size: fsB, bold: true, blink: true })
    else {
      const a = `5S %${Math.round(r5)}`
      const both = rw !== undefined ? fitText([`${a} · H %${Math.round(rw)}`], b.w, fsB, true) : ''
      lines.push({ t: both || fitText([a, `%${Math.round(r5)}`], b.w, fsB, true) || `%${Math.round(r5)}`, color: r5 < 20 ? p.red : r5 < 40 ? p.amber : p.text, size: fsB, bold: true })
      if (!both && rw !== undefined) lines.push({ t: fitText([`H %${Math.round(rw)}`, `%${Math.round(rw)}`], b.w, fs, true), color: rw < 20 ? p.red : p.muted, size: fs, bold: true })
    }
    const pr = proj(f5)
    // the whole sentence at a smaller type before a shorter one ('15:42'de biter' → 'biter 15:42' → '15:42')
    const when = (opts: string[]) => {
      for (const [i, o] of opts.entries()) {
        // a longer one only down to 9 px: the shorter one reads better than a tiny sentence
        const f = fitFont([o], b.w, fs, Math.min(fs, F(c, i < opts.length - 1 ? 9 : MIN_PX, 0)))
        if (f) return { t: f.text, size: f.fs }
      }
      return { t: '', size: fs }
    }
    if (pr.out && f5.fullAt) lines.push({ ...when([`${locSuffix(f5.fullAt)} biter`, `biter ${hm(f5.fullAt)}`, hm(f5.fullAt)]), color: p.red })
    else if (f5.resetsAt && f5.resetsAt > c.now) lines.push({ ...when([`${locSuffix(f5.resetsAt)} yenilenir`, `yenilenme ${hm(f5.resetsAt)}`, hm(f5.resetsAt)]), color: p.muted })
  } else if (rw !== undefined) lines.push({ t: fitText([`H %${Math.round(rw)}`, `%${Math.round(rw)}`], b.w, fs, true), color: rw < 20 ? p.red : p.muted, size: fs, bold: true })
  if (r5 === undefined && rw === undefined) lines.push({ t: fitText(['limit yok', '—'], b.w, fs), color: p.muted, size: fs })
  let textH = 0
  const shown = lines.filter(l => l.t)
  for (const l of shown) textH += l.size * 1.18
  while (shown.length > 1 && textH > b.h * 0.45) textH -= (shown.pop() as { size: number }).size * 1.18
  // gövde
  const gh = b.h - textH - 1
  const gw = Math.min(b.w, gh * 0.62)
  const gx = b.x + (b.w - gw) / 2
  const capH = Math.max(1.5, gh * 0.05)
  const by = b.y + capH
  const bh = gh - capH
  const warn = Math.max(f5?.pct ?? 0, d.week?.pct ?? 0)
  const edge = warn >= 90 ? p.red : warn >= 80 ? p.amber : p.metal
  let out = R(gx + gw * 0.32, b.y, gw * 0.36, capH + 0.5, p.metal)
  out += `<rect x="${n(gx)}" y="${n(by)}" width="${n(gw)}" height="${n(bh)}" rx="${n(gw * 0.14)}" fill="${c.theme === 'light' ? '#2B2F36' : '#1A1D22'}" stroke="${edge}" stroke-width="${n(Math.max(W(c, 1.2), gw * 0.05))}"${warn >= 80 && !c.lite ? ` style="animation:ppulse ${warn >= 90 ? 0.9 : 1.6}s infinite"` : ''}/>`
  // şimşek amblemi
  const lh = bh * 0.16
  const lx = gx + gw / 2
  const ly = by + bh * 0.04
  out += `<path d="M${n(lx + lh * 0.12)} ${n(ly)}L${n(lx - lh * 0.32)} ${n(ly + lh * 0.58)}H${n(lx)}L${n(lx - lh * 0.12)} ${n(ly + lh)}L${n(lx + lh * 0.32)} ${n(ly + lh * 0.4)}H${n(lx)}Z" fill="#FACC15"/>`
  // iki hücre
  const cy0 = by + bh * 0.24
  const ch = bh * 0.7
  const cw = (gw * 0.76) / 2
  const fsC = Math.min(F(c, 8, cw * 0.55), cw * 0.75)
  const labelIn = fsC * 1.1 < ch * 0.18
  cellsDef.forEach((cell, i) => {
    const x = gx + gw * 0.08 + i * (cw + gw * 0.08)
    const r = rem(cell.lim)
    out += R(x, cy0, cw, ch, '#0B0C0F')
    if (r !== undefined) {
      const fh = (ch - 2) * (r / 100)
      const col = r < 20 ? '#EF4444' : r < 40 ? '#F59E0B' : '#22C55E'
      out += R(x + 1, cy0 + ch - 1 - fh, cw - 2, fh, col, r <= 0 && !c.lite ? ' style="animation:pblink .8s infinite"' : '')
      // segment çizgileri (piksel batarya görünümü)
      let seg = ''
      for (let k = 1; k < 5; k++) seg += `M${n(x)} ${n(cy0 + (ch * k) / 5)}h${n(cw)}`
      out += `<path d="${seg}" stroke="#0B0C0F" stroke-width="${W(c, 1, ch * 0.02)}"/>`
      const pr = proj(cell.lim)
      if (pr.used > 0.5) {
        const hy = cy0 + ch - 1 - fh
        const hh = (ch - 2) * (pr.used / 100)
        let hatch = ''
        for (let k = -cw; k < hh; k += Math.max(1.6, cw * 0.28)) hatch += `M${n(x + 1)} ${n(hy + k + cw)}L${n(x + cw - 1)} ${n(hy + k)}`
        out += clipBox({ x: x + 1, y: hy, w: cw - 2, h: hh }, `<path d="${hatch}" transform="translate(${n(-x - 1)},${n(-hy)})" stroke="${pr.out ? '#7F1D1D' : '#14532D'}" stroke-width="${n(Math.max(0.6, cw * 0.1))}"/>`)
        out += `<path d="M${n(x - 1)} ${n(hy + hh)}h${n(cw + 2)}" stroke="${pr.out ? p.red : '#FDE68A'}" stroke-width="${W(c, 1.2, 0.9)}"/>`
      }
    } else {
      out += T(x + cw / 2, cy0 + ch / 2 + fsC * 0.35, '—', fsC, '#555', { a: 'middle' })
    }
    if (labelIn) out += T(x + cw / 2, cy0 + fsC * 1.05, cell.key, fsC, '#E8EAED', { a: 'middle', w: 800 })
  })
  if (live(c, d.flashAt, 3.5)) out += `<rect x="${n(gx)}" y="${n(by)}" width="${n(gw)}" height="${n(bh)}" rx="${n(gw * 0.14)}" fill="none" stroke="#FDE047" stroke-width="${n(gw * 0.12)}" opacity="0" style="${once(c, 'pflash', 3, d.flashAt)}"/>`
  let ty = b.y + gh + 1
  for (const l of shown) {
    ty += l.size * 1.02
    out += T(b.x + b.w / 2, ty, l.t, l.size, l.color, { a: 'middle', w: l.bold ? 800 : undefined, st: l.blink && !c.lite ? 'animation:pblink 1s infinite' : undefined })
    ty += l.size * 0.16
  }
  const tipTxt = [
    f5 ? `5 saat: kalan %${Math.round(rem(f5) ?? 0)}${f5.rate ? `, %${n(f5.rate)}/sa` : ''}${f5.fullAt ? `, bu hızla ${locSuffix(f5.fullAt)} biter` : ''}${f5.resetsAt ? `, ${locSuffix(f5.resetsAt)} yenilenir` : ''}` : '',
    d.week ? `haftalık: kalan %${Math.round(rem(d.week) ?? 0)}` : '',
  ].filter(Boolean).join(' · ')

  return `<g>${tip(c, `Kullanım hakkı (batarya) · ${tipTxt || 'limit bilgisi yok'}`)}${out}</g>`
}

/** Öğütücü: oto-sıkıştırma ışığı ve eşiği; sıkıştırmada evrak öğütür. */
export function shredder(b: Box, d: { compacting: boolean; autoOn: boolean; autoAt: number; since?: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const fs0 = F(c, 9, b.w * 0.3)
  const fsMin = Math.min(fs0, F(c, MIN_PX, 0))
  // the plate keeps within a hair of its own width, and clear of the battery's 'biter' line beside it:
  // the whole word at a smaller type first ('oto %75'), the bare number only when even that will not do
  const clear = (t: string, fs: number) => {
    const w = textWidth(t, fs, true) + fs * 0.7
    const y = b.y + b.h - fs * 0.32
    return w <= b.w + 2 && !textHit({ x: b.x + b.w / 2 - w / 2, y: y - fs * 0.92, w, h: fs * 1.22 }, 0)
  }
  let label = ''
  let fs = fs0
  for (const t of d.autoOn ? [`oto %${d.autoAt}`, `%${d.autoAt}`] : ['kapalı', 'kpl', '—']) {
    for (let f = fs0; f >= fsMin - 1e-6 && !label; f -= Math.max(0.05, fs0 * 0.05)) if (clear(t, f)) (label = t), (fs = f)
    if (label) break
  }
  const ys = b.y + b.h - fs * 0.32
  const textH = label ? fs * 1.2 : 0
  const h = b.h - textH
  const w = Math.min(b.w, h * 0.7)
  const x = b.x + (b.w - w) / 2
  const headH = h * 0.24
  let out = `<rect x="${n(x)}" y="${n(b.y + headH)}" width="${n(w)}" height="${n(h - headH)}" rx="${n(w * 0.08)}" fill="${c.theme === 'light' ? '#5B5F66' : '#3A3D43'}"/>`
  out += R(x + w * 0.15, b.y + headH + (h - headH) * 0.2, w * 0.7, (h - headH) * 0.5, '#15171A')
  // kutudaki şeritler: kesimli kâğıt
  let strips = ''
  for (let i = 0; i < 6; i++) strips += `M${n(x + w * (0.2 + i * 0.11))} ${n(b.y + headH + (h - headH) * 0.7)}v-${n((h - headH) * (0.12 + ((hash(`sh${i}`) % 10) / 40)))}`
  out += `<path d="${strips}" stroke="#E5E7EB" stroke-width="${n(w * 0.05)}"/>`
  out += `<rect x="${n(x - w * 0.06)}" y="${n(b.y)}" width="${n(w * 1.12)}" height="${n(headH)}" rx="${n(w * 0.1)}" fill="${p.metal}"/>` + R(x + w * 0.12, b.y + headH * 0.18, w * 0.76, headH * 0.16, '#111')
  out += `<circle cx="${n(x + w * 0.82)}" cy="${n(b.y + headH * 0.62)}" r="${n(w * 0.08)}" fill="${d.compacting ? LED.green : d.autoOn ? '#16A34A' : '#64748B'}"${d.compacting && !c.lite ? ' style="animation:ppulse .6s infinite"' : ''}/>`
  if (d.compacting && c.motion) {
    out += `<rect x="${n(x + w * 0.2)}" y="${n(b.y - headH * 0.45)}" width="${n(w * 0.6)}" height="${n(headH * 0.7)}" fill="#F8FAFC" stroke="#CBD5E1" stroke-width=".4" style="--py:${n(headH)}px;animation:pprint 1.2s infinite reverse"/>`
    for (let i = 0; i < 4; i++) out += R(x + w * (0.22 + i * 0.15), b.y + headH * 1.1, w * 0.06, (h - headH) * 0.25, '#E5E7EB', ` style="animation:pshred .9s ${n(-i * 0.22)}s infinite"`)
  }
  if (label) out += plate(b.x + b.w / 2, ys, label, fs, c)

  return `<g>${tip(c, `Öğütücü (oto-sıkıştırma) · ${d.autoOn ? `açık, %${d.autoAt}` : 'kapalı'}${d.compacting ? ' · şimdi sıkıştırıyor' : ''}`)}${out}</g>`
}

const BOOK = ['#D97757', '#D4A27F', '#6A9BCC', '#E9B949', '#8FAE6B', '#A99BD0', '#E3A04F', '#C9638A', '#5B8FC7']

/** Kitaplık: okunan her dosya bir kitap. */
export function bookshelf(b: Box, d: { read: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const fs = F(c, 9, b.w * 0.2)
  const label = fitText([`${d.read} dosya`, `${d.read}`], b.w + 2, fs, true)
  const top = b.y + (label ? fs * 1.25 : 0)
  const h = b.y + b.h - top
  const t = Math.max(1.2, b.w * 0.06)
  const shelves = clamp(Math.floor(h / 22), 1, 8)
  const sh = (h - t) / shelves
  let out = `<rect x="${n(b.x)}" y="${n(top)}" width="${n(b.w)}" height="${n(h)}" rx="${n(t * 0.6)}" fill="${p.woodDark}"/>` + R(b.x + t, top + t, b.w - 2 * t, h - 2 * t, c.theme === 'light' ? '#6E5038' : '#2E2620')
  let left = Math.max(0, d.read)
  const books: string[] = []
  const perShelfMax = Math.max(1, Math.floor((b.w - 2 * t) / 3.4))
  for (let s = 0; s < shelves; s++) {
    const y = top + t + (s + 1) * sh - t * 0.2
    out += R(b.x + t * 0.5, y - t * 0.6, b.w - t, t * 0.9, p.wood)
    let bx = b.x + t * 1.4
    for (let k = 0; k < perShelfMax && left > 0; k++) {
      const bw = Math.max(1.6, (b.w - 2 * t) / perShelfMax - 0.6 + ((hash(`b${s}${k}`) % 3) - 1) * 0.3)
      if (bx + bw > b.x + b.w - t * 1.2) break
      const bh = sh * (0.55 + (hash(`h${s}${k}`) % 30) / 100)
      const col = (s * 3 + k) % BOOK.length
      books[col] = (books[col] ?? '') + `M${n(bx)} ${n(y - t * 0.6 - bh)}h${n(bw)}v${n(bh)}h${n(-bw)}z`
      bx += bw + 0.6
      left--
    }
  }
  books.forEach((dd, i) => (out += dd ? `<path d="${dd}" fill="${BOOK[i]}"/>` : ''))
  if (label) out += plate(b.x + b.w / 2, b.y + fs * 0.95, label, fs, c)

  return `<g>${tip(c, `Kitaplık · bu oturumda ${d.read} dosya okundu`)}${out}</g>`
}

/** Arşiv dolabı: yazılan dosyalar dolu çekmeceler (5 yazım bir çekmece); yazma anında çekmece açılır. */
export function archive(b: Box, d: { writes: number; openAt?: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const fs = F(c, 9, b.w * 0.24)
  const label = fitText([`${d.writes} yazım`, `${d.writes}`], b.w + 2, fs, true)
  const top = b.y + (label ? fs * 1.25 : 0)
  const h = b.y + b.h - top
  const drawers = clamp(Math.floor(h / 17), 2, 6)
  const dh = (h - 2) / drawers
  const full = Math.min(drawers, Math.ceil(Math.max(0, d.writes) / 5))
  let out = `<rect x="${n(b.x)}" y="${n(top)}" width="${n(b.w)}" height="${n(h)}" rx="${n(b.w * 0.05)}" fill="${c.theme === 'light' ? '#8C949E' : '#4B525C'}"/>`
  for (let i = 0; i < drawers; i++) {
    const y = top + 1 + i * dh
    const filled = drawers - 1 - i < full
    let drw = `<rect x="${n(b.x + b.w * 0.07)}" y="${n(y + dh * 0.08)}" width="${n(b.w * 0.86)}" height="${n(dh * 0.84)}" rx="${n(b.w * 0.04)}" fill="${c.theme === 'light' ? '#A7AFB9' : '#5E6670'}"/>`
    if (filled) drw += `<path d="M${n(b.x + b.w * 0.2)} ${n(y + dh * 0.08)}v-${n(dh * 0.18)}h${n(b.w * 0.14)}v${n(dh * 0.18)}M${n(b.x + b.w * 0.55)} ${n(y + dh * 0.08)}v-${n(dh * 0.13)}h${n(b.w * 0.12)}v${n(dh * 0.13)}" fill="${BOOK[i % BOOK.length]}"/>`
    drw += R(b.x + b.w * 0.36, y + dh * 0.32, b.w * 0.28, dh * 0.2, filled ? p.paper : '#3A3F46') + R(b.x + b.w * 0.42, y + dh * 0.6, b.w * 0.16, dh * 0.1, '#1F2328')
    const last = drawers - full === i
    if (last && live(c, d.openAt, 2)) drw = `<g style="--px:${n(b.w * 0.2)}px;${once(c, 'pdrawer', 1.6, d.openAt)}">${drw}</g>`
    out += drw
  }
  if (label) out += plate(b.x + b.w / 2, b.y + fs * 0.95, label, fs, c)

  return `<g>${tip(c, `Arşiv · ${d.writes} dosya yazımı`)}${out}</g>`
}

/** Sunucu dolabı: çalıştırılan komut sayısı yanan LED'ler; biri komut çalıştırırken LED'ler yanıp söner. */
export function serverRack(b: Box, d: { runs: number; running: boolean }, c: DrawCtx): string {
  const p = palette(c.theme)
  const fs = F(c, 9, b.w * 0.24)
  const label = fitText([`${d.runs} komut`, `${d.runs}`], b.w + 2, fs, true)
  const top = b.y + (label ? fs * 1.25 : 0)
  const h = b.y + b.h - top
  const units = clamp(Math.floor((h - 4) / 8), 2, 16)
  const uh = (h - 4) / units
  let out = `<rect x="${n(b.x)}" y="${n(top)}" width="${n(b.w)}" height="${n(h)}" rx="${n(b.w * 0.05)}" fill="#202329"/>`
  let left = Math.max(0, d.runs)
  let on = ''
  let off = ''
  let blink = ''
  let faces = ''
  let slots = ''
  for (let u = 0; u < units; u++) {
    const y = top + 2 + u * uh
    faces += `M${n(b.x + b.w * 0.08)} ${n(y + uh * 0.1)}h${n(b.w * 0.84)}v${n(uh * 0.8)}h${n(-b.w * 0.84)}z`
    slots += `M${n(b.x + b.w * 0.6)} ${n(y + uh * 0.36)}h${n(b.w * 0.26)}v${n(uh * 0.28)}h${n(-b.w * 0.26)}z`
    for (let k = 0; k < 4; k++) {
      const lx = b.x + b.w * (0.14 + k * 0.1)
      const dot = `M${n(lx)} ${n(y + uh * 0.38)}h${n(b.w * 0.06)}v${n(uh * 0.24)}h${n(-b.w * 0.06)}z`
      if (left > 0) {
        if (d.running && (u + k) % 3 === 0) blink += dot
        else on += dot
        left--
      } else off += dot
    }
  }
  out += `<path d="${faces}" fill="#2E333B"/><path d="${slots}" fill="#14171B"/>`
  if (off) out += `<path d="${off}" fill="#3A4048"/>`
  if (on) out += `<path d="${on}" fill="${LED.green}"/>`
  if (blink) out += `<path d="${blink}" fill="${LED.amber}"${c.lite ? '' : ' style="animation:pblink .5s infinite"'}/>`
  if (label) out += plate(b.x + b.w / 2, b.y + fs * 0.95, label, fs, c, d.running)

  return `<g>${tip(c, `Sunucu dolabı · ${d.runs} komut${d.running ? ' · şimdi çalışıyor' : ''}`)}${out}</g>`
}

/** Küre: web adımları; biri web'deyken döner. */
export function globe(b: Box, d: { web: number; active: boolean }, c: DrawCtx): string {
  const p = palette(c.theme)
  const fs = F(c, 9, b.w * 0.26)
  const label = fitText([`${d.web} web`, `${d.web}`], b.w + 2, fs, true)
  const h = b.h - (label ? fs * 1.25 : 0)
  const r = Math.min(b.w * 0.44, h * 0.33)
  const cx = b.x + b.w / 2
  const cy = b.y + h - r * 1.25 - h * 0.12
  let out = `<path d="M${n(cx - r * 0.7)} ${n(b.y + h)}h${n(r * 1.4)}l${n(-r * 0.25)} ${n(-h * 0.08)}h${n(-r * 0.9)}z" fill="${p.woodDark}"/>` + R(cx - r * 0.06, cy + r, r * 0.12, b.y + h - h * 0.08 - cy - r, p.metal)
  out += `<path d="M${n(cx - r * 1.12)} ${n(cy)}A${n(r * 1.12)} ${n(r * 1.12)} 0 0 0 ${n(cx + r * 0.6)} ${n(cy + r * 0.95)}" fill="none" stroke="${p.gold}" stroke-width="${n(r * 0.1)}"/>`
  out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#2F6FB3"/>`
  const land = `<path d="M${n(-r * 0.6)} ${n(-r * 0.5)}q${n(r * 0.4)} ${n(-r * 0.2)} ${n(r * 0.6)} ${n(r * 0.1)}t${n(r * 0.2)} ${n(r * 0.5)}q${n(-r * 0.3)} ${n(r * 0.3)} ${n(-r * 0.5)} 0zM${n(r * 0.3)} ${n(r * 0.1)}q${n(r * 0.3)} 0 ${n(r * 0.4)} ${n(r * 0.3)}l${n(-r * 0.2)} ${n(r * 0.4)}q${n(-r * 0.3)} ${n(-r * 0.2)} ${n(-r * 0.2)} ${n(-r * 0.7)}z" fill="#6FBF73"/>`
  const lands = `<g transform="translate(${n(cx)},${n(cy)})">${land}<g transform="translate(${n(r * 2)},0)">${land}</g><g transform="translate(${n(-r * 2)},0)">${land}</g></g>`
  const spin = d.active && c.motion && !c.lite ? ` style="--px:${n(-r * 2)}px;animation:pmqa 4s linear infinite"` : ''
  out += clipBox({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, `<g transform="translate(${n(-(cx - r))},${n(-(cy - r))})"><g${spin}>${lands}</g></g>`)
  out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="#1E3A5F" stroke-width="${W(c, 1, r * 0.06)}"/><path d="M${n(cx - r)} ${n(cy)}H${n(cx + r)}" stroke="#1E3A5F" stroke-width="${n(r * 0.04)}" opacity=".5"/>`
  if (label) out += plate(cx, b.y + b.h - fs * 0.32, label, fs, c, d.active)

  return `<g>${tip(c, `Küre · ${d.web} web adımı${d.active ? ' · şimdi web\'de' : ''}`)}${out}</g>`
}

/** Bitki: iki turda bir yaprak, en çok 7. */
export function plant(b: Box, d: { turns: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const leaves = clamp(Math.ceil(Math.max(0, d.turns) / 2), 1, 7)
  const potH = Math.min(b.h * 0.3, b.w * 0.9)
  const potW = Math.min(b.w * 0.9, potH * 1.1)
  const px = b.x + (b.w - potW) / 2
  const py = b.y + b.h - potH
  const fs = F(c, 9, potH * 0.4)
  let out = ''
  const greens = ['#5F7A3D', '#8FAE6B', '#788C5D']
  const stem = b.h - potH
  for (let i = 0; i < leaves; i++) {
    const a = leaves === 1 ? 0 : -55 + (110 * i) / (leaves - 1)
    const len = stem * (0.35 + (i % 3) * 0.12)
    out += `<ellipse cx="${n(b.x + b.w / 2)}" cy="${n(py - len / 2)}" rx="${n(Math.max(1.2, b.w * 0.13))}" ry="${n(len / 2)}" fill="${greens[i % 3]}" transform="rotate(${n(a)} ${n(b.x + b.w / 2)} ${n(py)})"/>`
  }
  out += `<path d="M${n(px)} ${n(py)}h${n(potW)}l${n(-potW * 0.12)} ${n(potH)}h${n(-potW * 0.76)}z" fill="#A0603C"/>` + R(px - potW * 0.04, py, potW * 1.08, potH * 0.18, '#B97448')
  const t = fitText([`${d.turns}`], potW, fs, true)
  if (t) out += T(b.x + b.w / 2, py + potH * 0.72, t, fs, '#FFF1E6', { a: 'middle', w: 800 })

  return `<g>${tip(c, `Bitki · ${d.turns} tur (iki turda bir yaprak)`)}${out}${c.theme === 'light' ? '' : `<path d="M${n(px)} ${n(b.y + b.h)}h${n(potW)}" stroke="${p.ink}" stroke-width=".5" opacity=".3"/>`}</g>`
}

/** Yazıcı: çıkış tepsisinde rapor sayısı kadar kâğıt; rapor olayında kâğıt basar. */
export function printer(b: Box, d: { reports: number; printAt?: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const fs = F(c, 9, b.w * 0.2)
  const label = fitText([`${d.reports} rapor`, `${d.reports}`], b.w + 2, fs, true)
  const top = b.y + (label ? fs * 1.25 : 0)
  const h = b.y + b.h - top
  const bodyY = top + h * 0.3
  let out = R(b.x + b.w * 0.18, top, b.w * 0.64, h * 0.34, p.paper) + `<rect x="${n(b.x)}" y="${n(bodyY)}" width="${n(b.w)}" height="${n(h * 0.5)}" rx="${n(b.w * 0.06)}" fill="${c.theme === 'light' ? '#C9CDD3' : '#585D66'}"/>`
  out += R(b.x + b.w * 0.1, bodyY + h * 0.12, b.w * 0.8, h * 0.06, '#1F2328') + `<circle cx="${n(b.x + b.w * 0.86)}" cy="${n(bodyY + h * 0.3)}" r="${n(b.w * 0.04)}" fill="${LED.green}"/>`
  // çıkış tepsisi: rapor kağıtları
  const trayY = b.y + b.h - h * 0.2
  out += R(b.x + b.w * 0.06, trayY + h * 0.14, b.w * 0.88, h * 0.06, '#3A3F46')
  const sheets = Math.min(6, Math.max(0, d.reports))
  for (let i = 0; i < sheets; i++) out += R(b.x + b.w * 0.16 + (i % 2) * 0.6, trayY + h * 0.14 - (i + 1) * Math.max(0.8, h * 0.025), b.w * 0.68, Math.max(0.7, h * 0.02), p.paper)
  if (live(c, d.printAt, 3)) out += `<g style="--py:${n(-h * 0.25)}px;${once(c, 'pprint', 1.6, d.printAt)}">${R(b.x + b.w * 0.18, bodyY + h * 0.18, b.w * 0.64, h * 0.3, '#FFFFFF')}<path d="M${n(b.x + b.w * 0.26)} ${n(bodyY + h * 0.28)}h${n(b.w * 0.45)}M${n(b.x + b.w * 0.26)} ${n(bodyY + h * 0.36)}h${n(b.w * 0.35)}" stroke="#94A3B8" stroke-width="${n(h * 0.02)}"/></g>`
  if (label) out += plate(b.x + b.w / 2, b.y + fs * 0.95, label, fs, c)

  return `<g>${tip(c, `Yazıcı · ${d.reports} rapor`)}${out}</g>`
}

// ——— zemin ——————————————————————————————————————————————————

/**
 * Kapı (koridorun altında) ve koridor duvarındaki dikey levha: içerideki/toplam ajan, gizli fazla
 * ajan ('+N çalışan daha', zorunlu), posta yarığında dışarıdan gelen mesaj sayısı. Gelişte/gidişte açılır.
 */
export function door(b: Box, d: { inside: number; total: number; hidden: number; inbound: number; openAt?: readonly number[] }, c: DrawCtx): string {
  const p = palette(c.theme)
  const dw = b.w * 0.8
  const dh = Math.min(b.h * 0.42, dw * 2.3)
  const dx = b.x + (b.w - dw) / 2
  const dy = b.y + b.h - dh
  let out = `<rect x="${n(dx - b.w * 0.07)}" y="${n(dy - b.w * 0.07)}" width="${n(dw + b.w * 0.14)}" height="${n(dh + b.w * 0.07)}" fill="${p.woodDark}"/>` + R(dx, dy, dw, dh, '#0E0C0A')
  let leaf = `<rect x="${n(dx)}" y="${n(dy)}" width="${n(dw)}" height="${n(dh)}" fill="${p.wood}"/>` + R(dx + dw * 0.18, dy + dh * 0.08, dw * 0.64, dh * 0.3, p.glass, ' opacity=".55"') + R(dx + dw * 0.18, dy + dh * 0.46, dw * 0.64, dh * 0.42, '#000', ' opacity=".12"') + `<circle cx="${n(dx + dw * 0.82)}" cy="${n(dy + dh * 0.56)}" r="${n(dw * 0.06)}" fill="${p.gold}"/>`
  // posta yarığı
  leaf += R(dx + dw * 0.26, dy + dh * 0.62, dw * 0.48, dh * 0.035, '#1A1715')
  const recent = (d.openAt ?? []).filter(t => live(c, t, 6)).sort((a, b2) => a - b2)
  if (recent.length) {
    const first = recent[0] as number
    const last = recent[recent.length - 1] as number
    const dur = (last - first) / 1000 + 1.6
    leaf = `<g class="pl" style="${once(c, 'pdoor', n(dur), first)}">${leaf}</g>`
  }
  out += leaf + R(b.x, b.y + b.h - b.w * 0.08, b.w, b.w * 0.08, '#2E2A27', ' opacity=".6"')
  if (d.inbound > 0) {
    const ew = dw * 0.36
    // rozet sayısı okunur boyda: rozet sayıya göre büyür (kapı kanadının üstüne taşabilir, kapının dışına değil)
    const num = String(Math.min(99, d.inbound))
    const bf = Math.min(F(c, MIN_PX, ew * 0.38), dw * 0.42)
    const br = Math.max(ew * 0.32, bf * (num.length > 1 ? 0.95 : 0.72))
    const bx = Math.min(dx + dw - br, dx + dw * 0.32 + ew)
    const by = dy + dh * 0.68
    out += envelope(dx + dw * 0.32, by, ew) + `<circle cx="${n(bx)}" cy="${n(by)}" r="${n(br)}" fill="${p.red}" stroke="#1A1715" stroke-width="${W(c, 0.8, br * 0.1)}"/>${T(bx, by + bf * 0.36, num, bf, '#fff', { a: 'middle', w: 800 })}`
  }
  // kapının üstünde ışıklı tabela (çıkış levhası gibi): İÇERİDE / 7/9; dar koridorda kişi simgesi + sayı
  const sw = b.w * 0.94
  const sx = b.x + (b.w - sw) / 2
  const count = `${d.inside}/${d.total}`
  const fsC = Math.min(F(c, 9, b.w * 0.32), (sw * 0.9) / Math.max(1, textWidth(count, 1, true, true)))
  const fsL = F(c, 9, b.w * 0.2)
  const word = textWidth('İÇERİDE', fsL, true) <= sw * 0.92
  const signH = word ? fsL * 1.25 + fsC * 1.25 + fsC * 0.3 : fsC * 1.35 + fsC * 1.2
  const sy = dy - b.w * 0.07 - signH - Math.max(2, b.w * 0.08)
  out += `<rect x="${n(sx)}" y="${n(sy)}" width="${n(sw)}" height="${n(signH)}" rx="${n(Math.min(3, sw * 0.08))}" fill="#10241B" stroke="#2F6B4F" stroke-width="${W(c, 1, 0.8)}"/>`
  if (!c.lite) out += `<rect x="${n(sx - sw * 0.06)}" y="${n(sy + signH)}" width="${n(sw * 1.12)}" height="${n(b.w * 0.3)}" fill="#7CF0A6" opacity=".07"/>`
  if (word) {
    out += T(b.x + b.w / 2, sy + fsL * 1.02, 'İÇERİDE', fsL, '#B6F5CF', { a: 'middle', w: 800 })
    out += T(b.x + b.w / 2, sy + fsL * 1.25 + fsC * 0.98, count, fsC, '#7CF0A6', { a: 'middle', w: 800, m: true })
  } else {
    // kişi simgesi: baş ve gövde
    const pr = fsC * 0.32
    const pcx = b.x + b.w / 2
    out += `<circle cx="${n(pcx)}" cy="${n(sy + fsC * 0.45)}" r="${n(pr)}" fill="#B6F5CF"/><path d="M${n(pcx - pr * 1.5)} ${n(sy + fsC * 1.3)}q0 ${n(-pr * 2)} ${n(pr * 1.5)} ${n(-pr * 2)}t${n(pr * 1.5)} ${n(pr * 2)}z" fill="#B6F5CF"/>`
    out += T(pcx, sy + fsC * 1.35 + fsC * 0.95, count, fsC, '#7CF0A6', { a: 'middle', w: 800, m: true })
  }
  // fazla ajan: koridor duvarında dikey altın levha (aşağıdan yukarı okunur); zorunlu yazı küçülür ama kesilmez
  if (d.hidden > 0) {
    const text = `+${d.hidden} çalışan daha`
    const fs = Math.min(F(c, 9, b.w * 0.36), b.w * 0.42)
    const room = Math.max(4, sy - b.y - b.w * 0.3)
    const f2 = Math.min(fs, room / (textWidth(text, 1, true) + 1))
    const l2 = textWidth(text, f2, true) + f2
    const y0 = sy - b.w * 0.15
    const cx = b.x + b.w / 2
    out += `<rect x="${n(cx - f2 * 0.72)}" y="${n(y0 - l2)}" width="${n(f2 * 1.44)}" height="${n(l2)}" rx="${n(f2 * 0.3)}" fill="${p.gold}"/><text transform="translate(${n(cx + f2 * 0.35)},${n(y0 - f2 * 0.5)}) rotate(-90)" class="pt" font-size="${n(f2)}" font-weight="800" fill="#1F1E1D">${esc(text)}</text>`
  }

  return `<g>${tip(c, `Kapı · içeride ${d.inside} / ${d.total} ajan${d.hidden ? ` · +${d.hidden} çalışan daha` : ''}${d.inbound ? ` · dışarıdan ${d.inbound} mesaj` : ''}`)}${out}</g>`
}

/** Hücre içinde zemine basan nesne kutusu: arka kenara yaslı, şeridin (lane) üstünde. */
function standBox(cell: Box, w: number, h: number, dx = 0.5): Box {
  const laneH = Math.min(12, cell.h * 0.14)
  const hh = Math.min(h, cell.h - laneH - 4)
  const ww = Math.min(w, cell.w - 6)

  return { x: cell.x + (cell.w - ww) * dx, y: cell.y + cell.h - laneH - hh, w: ww, h: hh }
}

/** Kahve köşesi: biten her görev bir bardak (en çok 8); biri gelince demlenir. */
export function coffeeCorner(b: Box, d: { done: number; brewAt?: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const laneH = Math.min(12, b.h * 0.14)
  const counterH = Math.min(b.h * 0.26, b.w * 0.2)
  const cy = b.y + b.h - laneH - counterH - b.h * 0.25
  const cx0 = b.x + b.w * 0.08
  const cw = b.w * 0.84
  const fs = F(c, 10, counterH * 0.22)
  let out = `<rect x="${n(cx0)}" y="${n(cy)}" width="${n(cw)}" height="${n(counterH)}" rx="${n(counterH * 0.08)}" fill="${p.wood}"/>` + R(cx0 - 1, cy - counterH * 0.1, cw + 2, counterH * 0.14, p.woodDark)
  // makine
  const mw = Math.min(cw * 0.3, counterH * 1.3)
  const mh = counterH * 1.25
  const mx = cx0 + cw * 0.06
  const my = cy - counterH * 0.1 - mh
  out += `<rect x="${n(mx)}" y="${n(my)}" width="${n(mw)}" height="${n(mh)}" rx="${n(mw * 0.08)}" fill="#2F3238"/>` + R(mx + mw * 0.15, my + mh * 0.12, mw * 0.7, mh * 0.22, '#111') + R(mx + mw * 0.3, my + mh * 0.48, mw * 0.4, mh * 0.08, '#888E98')
  const brewing = live(c, d.brewAt, 6)
  out += `<circle cx="${n(mx + mw * 0.8)}" cy="${n(my + mh * 0.23)}" r="${n(mw * 0.06)}" fill="${brewing ? LED.amber : LED.green}"/>`
  out += `<path d="M${n(mx + mw * 0.35)} ${n(my + mh * 0.78)}h${n(mw * 0.3)}l${n(-mw * 0.04)} ${n(mh * 0.2)}h${n(-mw * 0.22)}z" fill="#F0EEE6"/>`
  if (brewing) {
    out += `<path d="M${n(mx + mw * 0.5)} ${n(my + mh * 0.56)}v${n(mh * 0.2)}" stroke="#6B3E26" stroke-width="${n(mw * 0.05)}" style="animation:ppulse .5s infinite"/>`
    for (let i = 0; i < 2; i++) out += `<path d="M${n(mx + mw * (0.42 + i * 0.16))} ${n(my + mh * 0.74)}q${n(mw * 0.06)} ${n(-mh * 0.12)} 0 ${n(-mh * 0.24)}" fill="none" stroke="#CBD5E1" stroke-width="${n(mw * 0.04)}" style="animation:psteam 1.8s ${n(-i * 0.9)}s 3"/>`
  }
  // bardaklar
  const cups = Math.min(8, Math.max(0, d.done))
  const cupW = Math.min(counterH * 0.38, (cw * 0.55) / 8.5)
  let cupsD = ''
  for (let i = 0; i < cups; i++) {
    const x = cx0 + cw * 0.42 + i * cupW * 1.25
    const y = cy - counterH * 0.1 - cupW * 1.1
    cupsD += `M${n(x)} ${n(y)}h${n(cupW)}l${n(-cupW * 0.12)} ${n(cupW * 1.1)}h${n(-cupW * 0.76)}z`
  }
  if (cupsD) out += `<path d="${cupsD}" fill="${p.paper}" stroke="#8A8178" stroke-width="${n(cupW * 0.06)}"/>`
  // sayaç tezgâhın önünde değil, duvarda pirinç levhada: kahve içenler tezgâhın önünde durur, yazıyı örtmez
  const label = fitText([`${d.done} iş bitti`, `${d.done} bitti`, `${d.done}`], cw * 0.6 - fs * 0.7, fs, true)
  if (label) out += plate(cx0 + cw * 0.68, b.y + fs + 2, label, fs, c)

  return `<g>${tip(c, `Kahve köşesi · ${d.done} görev bitti`)}${out}</g>`
}

const sofaBox = (b: Box): Box => standBox(b, b.w * 0.8, Math.min(b.h * 0.45, b.w * 0.35))

/** Kanepede oturanların ayak noktaları (ou): dinlenen ekip arkadaşları için, soldan sağa `count` yer. */
export function loungeSeats(b: Box, count: number): Pt[] {
  const sb = sofaBox(b)
  const k = Math.max(1, Math.min(4, count))

  return Array.from({ length: k }, (_, i) => [n(sb.x + sb.w * (0.2 + (0.6 * (i + 0.5)) / k)), n(sb.y + sb.h * 0.7)] as Pt)
}

/** Dinlenme köşesi: kanepe; mesaj bekleyen ekip arkadaşı sayısı (oturanları sahne loungeSeats ile çizer). */
export function lounge(b: Box, d: { resting: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const sb = sofaBox(b)
  const fs = F(c, 10, sb.h * 0.16)
  let out = `<ellipse cx="${n(sb.x + sb.w / 2)}" cy="${n(sb.y + sb.h)}" rx="${n(sb.w * 0.55)}" ry="${n(sb.h * 0.16)}" fill="${p.carpet}"/>`
  // piksel kanepe: köşeli, koyu konturlu, minderleri dikişli (düz yuvarlak dikdörtgen değil)
  const ol = ` stroke="#1F0A45" stroke-width="${W(c, 1.5, 0.9)}"`
  const rr = n(Math.min(2, sb.h * 0.05))
  out += `<rect x="${n(sb.x)}" y="${n(sb.y)}" width="${n(sb.w)}" height="${n(sb.h * 0.55)}" rx="${rr}" fill="#5B3A8C"${ol}/>` + R(sb.x + sb.w * 0.04, sb.y + sb.h * 0.06, sb.w * 0.92, sb.h * 0.05, '#7A58B0')
  out += `<rect x="${n(sb.x)}" y="${n(sb.y + sb.h * 0.42)}" width="${n(sb.w)}" height="${n(sb.h * 0.4)}" rx="${rr}" fill="#47306E"${ol}/>`
  out += `<path d="M${n(sb.x + sb.w / 3)} ${n(sb.y + sb.h * 0.08)}v${n(sb.h * 0.7)}M${n(sb.x + (sb.w * 2) / 3)} ${n(sb.y + sb.h * 0.08)}v${n(sb.h * 0.7)}" stroke="#2E1F4A" stroke-width="${W(c, 1, 0.7)}"/>`
  out += `<rect x="${n(sb.x - sb.w * 0.04)}" y="${n(sb.y + sb.h * 0.3)}" width="${n(sb.w * 0.1)}" height="${n(sb.h * 0.55)}" rx="${rr}" fill="#3E2862"${ol}/><rect x="${n(sb.x + sb.w * 0.94)}" y="${n(sb.y + sb.h * 0.3)}" width="${n(sb.w * 0.1)}" height="${n(sb.h * 0.55)}" rx="${rr}" fill="#3E2862"${ol}/>` + R(sb.x + sb.w * 0.05, sb.y + sb.h * 0.82, sb.w * 0.04, sb.h * 0.18, '#1F0A45') + R(sb.x + sb.w * 0.91, sb.y + sb.h * 0.82, sb.w * 0.04, sb.h * 0.18, '#1F0A45')
  // levha kanepenin arkasında değil, duvarın üstünde: oturanlar yazıyı örtmez
  const label = fitText(d.resting > 0 ? [`${d.resting} mesaj bekliyor`, `${d.resting} bekliyor`, `${d.resting}`] : ['Dinlenme', ''], b.w * 0.9 - fs * 0.7, fs, true)
  if (label) out += plate(b.x + b.w / 2, b.y + fs + 2, label, fs, c)

  return `<g>${tip(c, `Dinlenme köşesi · ${d.resting} ekip arkadaşı mesaj bekliyor`)}${out}</g>`
}

/** Toplantı masası: masalar arası mesaj sayısı kadar kâğıt/zarf. */
export function meetingTable(b: Box, d: { messages: number }, c: DrawCtx): string {
  const p = palette(c.theme)
  const sb = standBox(b, b.w * 0.82, Math.min(b.h * 0.5, b.w * 0.42))
  const fs = F(c, 9, sb.h * 0.18)
  const cx = sb.x + sb.w / 2
  const ty = sb.y + sb.h * 0.4
  let out = ''
  // sandalyeler (arkada iki, önde iki)
  for (const fx of [0.22, 0.68]) out += `<rect x="${n(sb.x + sb.w * fx)}" y="${n(sb.y)}" width="${n(sb.w * 0.12)}" height="${n(sb.h * 0.4)}" rx="${n(sb.w * 0.03)}" fill="${p.woodDark}"/>`
  out += `<ellipse cx="${n(cx)}" cy="${n(ty)}" rx="${n(sb.w * 0.48)}" ry="${n(sb.h * 0.2)}" fill="${p.wood}"/>` + R(cx - sb.w * 0.03, ty + sb.h * 0.18, sb.w * 0.06, sb.h * 0.38, p.woodDark)
  const papers = Math.min(8, Math.max(0, d.messages))
  let notes = ''
  const ew = sb.w * 0.08
  for (let i = 0; i < papers; i++) {
    const a = (i / Math.max(1, papers)) * Math.PI * 2
    notes += `M${n(cx + Math.cos(a) * sb.w * 0.3 - ew / 2)} ${n(ty + Math.sin(a) * sb.h * 0.1 - ew * 0.36)}h${n(ew)}v${n(ew * 0.72)}h${n(-ew)}z`
  }
  if (notes) out += `<path d="${notes}" fill="#F8FAFC" stroke="#94A3B8" stroke-width="${n(ew * 0.06)}"/>`
  for (const fx of [0.14, 0.76]) out += `<rect x="${n(sb.x + sb.w * fx)}" y="${n(sb.y + sb.h * 0.62)}" width="${n(sb.w * 0.12)}" height="${n(sb.h * 0.38)}" rx="${n(sb.w * 0.03)}" fill="${p.woodDark}"/>`
  const label = fitText([`${d.messages} mesaj`, `${d.messages}`], sb.w, fs, true)
  if (label) out += T(cx, sb.y + sb.h + fs * 0.1, label, fs, p.muted, { a: 'middle', w: 700 })

  return `<g>${tip(c, `Toplantı masası · masalar arası ${d.messages} mesaj`)}${out}</g>`
}

export type FillerData = { read?: number; writes?: number; runs?: number; running?: boolean; web?: number; webActive?: boolean; turns?: number; messages?: number; resting?: number }

const variantFor = (cell: Box): DeskVariant => (cell.w >= DESK_GEOM.full.w && cell.h >= DESK_GEOM.full.h ? 'full' : cell.w >= DESK_GEOM.compact.w && cell.h >= DESK_GEOM.compact.h ? 'compact' : 'mini')

/** Zemin ızgarasında masa olmayan hücre: dinlenme, kitaplık, arşiv, sunucu, toplantı, küre, bitki köşesi; 'free' için freeDesk(cell, L.variant) tercih edilir (burada hücre boyundan seçilir). */
export function fillerCell(cell: Box, kind: CellKind, data: FillerData, c: DrawCtx): string {
  const tall = (w: number, h: number, dx = 0.5) => standBox(cell, w, h, dx)
  const hh = cell.h * 0.78
  switch (kind) {
    case 'lounge':
      return lounge(cell, { resting: data.resting ?? 0 }, c)
    case 'library':
      return bookshelf(tall(Math.min(cell.w * 0.7, hh * 0.75), hh), { read: data.read ?? 0 }, c)
    case 'archive': {
      const w = Math.min(cell.w * 0.34, hh * 0.45)
      return archive(tall(w, hh * 0.8, 0.3), { writes: data.writes ?? 0 }, c) + plant(tall(w * 0.6, hh * 0.7, 0.75), { turns: data.turns ?? 0 }, c)
    }
    case 'rack':
      return serverRack(tall(Math.min(cell.w * 0.34, hh * 0.42), hh), { runs: data.runs ?? 0, running: Boolean(data.running) }, c)
    case 'meeting':
      return meetingTable(cell, { messages: data.messages ?? 0 }, c)
    case 'globe':
      return globe(tall(Math.min(cell.w * 0.4, hh * 0.5), hh * 0.85), { web: data.web ?? 0, active: Boolean(data.webActive) }, c)
    case 'plants': {
      const w = Math.min(cell.w * 0.22, hh * 0.35)
      return plant(tall(w, hh * 0.85, 0.25), { turns: data.turns ?? 0 }, c) + plant(tall(w * 0.8, hh * 0.6, 0.6), { turns: Math.max(0, (data.turns ?? 0) - 4) }, c)
    }
    case 'coffee':
      return coffeeCorner(cell, { done: 0 }, c)
    case 'free':
    case 'desk':
      return freeDesk(cell, variantFor(cell), c)
  }
}

// ——— ajan masası ————————————————————————————————————————————————
// Masa hücreye aittir (iskelet), kişisel katman (ekran içeriği, kart, panel, evrak, kupa, zarf) işçiye.

export type DeskData = {
  num: number; card: string; color: string; external: boolean; badge?: 'agy' | 'evren'; duty?: Duty
  model: string; effort: 0 | 1 | 2 | 3 | 4 | 5 | 6; effortText?: string; state: string; tone: 'busy' | 'idle' | 'wait' | 'fail' | 'done' | 'off'; mins?: number
  tools: number; screen: ScreenView; unread: boolean; tired: 0 | 1 | 2 | 3; seed: string; bootAt?: number; packAt?: number
  /** a side activity prop stands at the desk's right end (0.9): the lamp is left out */
  lampOff?: boolean
}

const TONE: Record<DeskData['tone'], string> = { busy: '#5EE07A', idle: '#7E8794', wait: '#FFB547', fail: '#FF6B5B', done: '#60A5FA', off: '#3A3F46' }

/**
 * Tekrarlanan mobilya <symbol>'leri (her çizimde bir kez): masa iskeleti, sandalye, monitör çerçevesi,
 * görev simgeleri, platform rozetleri, lamba. `only` verilirse yalnız o boyun masa sembolleri yazılır
 * (yerleşimin tek masa boyu; hazır masalar da freeDesk(cell, L.variant) ile aynı boyu kullanmalı).
 */
export function deskDefs(c: DrawCtx, only?: DeskVariant): string {
  const p = palette(c.theme)
  let out = ''
  for (const v of (only ? [only] : ['full', 'compact', 'mini']) as DeskVariant[]) {
    const g = DESK_GEOM[v]
    const s = g.slab
    const f = g.front
    const legW = Math.max(2, g.w * 0.03)
    const legY = f.y + f.h
    const legH = g.lane.y - legY
    // masa: tabla (üst yüz + kalınlık), ön panel, bacaklar
    out += `<symbol id="pk-d-${v}" viewBox="0 0 ${g.w} ${g.h}" width="${g.w}" height="${g.h}" overflow="visible">${R(f.x + 2, legY - 1, legW, legH + 1, p.woodDark)}${R(f.x + f.w - 2 - legW, legY - 1, legW, legH + 1, p.woodDark)}${R(f.x, f.y, f.w, f.h, p.woodDark)}${R(f.x + f.w * 0.03, f.y + f.h * 0.12, f.w * 0.94, f.h * 0.76, p.wood, ' opacity=".55"')}${R(s.x, s.y, s.w, s.h, p.wood)}${R(s.x, s.y, s.w, s.h * 0.3, '#fff', ' opacity=".14"')}${R(s.x, s.y + s.h * 0.75, s.w, s.h * 0.25, '#000', ' opacity=".18"')}</symbol>`
    // sandalye sırtı (karakterin arkasında görünen)
    const cw = g.charSize * 0.78
    const ch = g.charSize * 0.62
    out += `<symbol id="pk-c-${v}" viewBox="0 0 ${n(cw)} ${n(ch)}" width="${n(cw)}" height="${n(ch)}"><rect width="${n(cw)}" height="${n(ch)}" rx="${n(cw * 0.22)}" fill="#2B2F3A"/><rect x="${n(cw * 0.1)}" y="${n(ch * 0.1)}" width="${n(cw * 0.8)}" height="${n(ch * 0.8)}" rx="${n(cw * 0.16)}" fill="#353A47"/></symbol>`
    // monitör çerçevesi + ayak
    const m = g.monitor
    out += `<symbol id="pk-m-${v}" viewBox="0 0 ${m.w} ${m.h}" width="${m.w}" height="${m.h}">${R(m.w * 0.42, m.h * 0.8, m.w * 0.16, m.h * 0.2, '#2A2D33')}${R(m.w * 0.3, m.h * 0.94, m.w * 0.4, m.h * 0.06, '#2A2D33')}<rect width="${m.w}" height="${n(m.h * 0.84)}" rx="${n(m.w * 0.05)}" fill="#1B1D22"/></symbol>`
  }
  // ortak: görev simgeleri, platform rozetleri, masa lambası (yanık/sönük)
  for (const duty of ['builder', 'critic', 'evaluator', 'explorer', 'planner'] as Duty[]) out += `<symbol id="pk-du-${duty}" viewBox="0 0 9 9" width="9" height="9" overflow="visible">${dutyIcon(duty, 0, 0)}</symbol>`
  out += `<symbol id="pk-agy" viewBox="0 0 12 12" width="12" height="12">${platformBadge('agy', 0, 0, 12)}</symbol><symbol id="pk-ev" viewBox="0 0 12 12" width="12" height="12">${platformBadge('evren', 0, 0, 12)}</symbol>`
  const lamp = (head: string) => `<path d="M-4 0h8M0 0l-3 -11l-5 2" fill="none" stroke="#3A3F46" stroke-width="1.6" stroke-linecap="round"/><path d="M-6 -10l-6 4l3 3z" fill="${head}"/>`
  out += `<symbol id="pk-l1" viewBox="-14 -14 20 15" width="20" height="15" overflow="visible">${lamp('#FDE68A')}</symbol><symbol id="pk-l0" viewBox="-14 -14 20 15" width="20" height="15" overflow="visible">${lamp('#4B5563')}</symbol>`

  return out
}

/** Monitörün ekran kutusu (çerçeve içi), modül sol-üstüne göre. */
const screenOf = (m: Box): Box => ({ x: m.x + m.w * 0.06, y: m.y + m.h * 0.07, w: m.w * 0.88, h: m.h * 0.84 * 0.86 })

/** Zemin halısı/gölge, lamba ışığı, sandalye, monitör (d null: boş masa, sandalye içeride, ekran kapalı). */
export function deskBack(cell: Box, v: DeskVariant, d: DeskData | null, c: DrawCtx): string {
  const g = DESK_GEOM[v]
  const m = deskModuleBox(cell, v)
  const X = (x: number) => m.x + x
  const Y = (y: number) => m.y + y
  // gölge; dolu masada işçi renginde halı
  let out = `<ellipse cx="${n(X(g.w / 2))}" cy="${n(Y(g.lane.y - 1))}" rx="${n(g.slab.w * 0.5)}" ry="${n(g.lane.h * 0.45)}" fill="${d ? d.color : '#000'}" opacity="${d ? 0.2 : 0.22}"/>`
  // sandalye: dolu masada karakterin arkasında, boş masada içeri itilmiş
  const cw = g.charSize * 0.78
  const ch = g.charSize * 0.62
  const cy = d ? Y(g.deskTop - ch * 0.82) : Y(g.deskTop - ch * 0.42)
  out += `<use href="#pk-c-${v}" x="${n(X(g.seatX) - cw / 2)}" y="${n(cy)}"/>`
  // monitör
  const mon = g.monitor
  out += `<use href="#pk-m-${v}" x="${n(X(mon.x))}" y="${n(Y(mon.y))}"/>`
  const sc = screenOf({ x: X(mon.x), y: Y(mon.y), w: mon.w, h: mon.h })
  let scr = monitor(sc, d ? d.screen : { kind: 'off', since: 0 }, c, d?.seed ?? `free${Math.round(cell.x)}`)
  if (d && live(c, d.bootAt, 1.5)) scr += `<rect x="${n(sc.x)}" y="${n(sc.y)}" width="${n(sc.w)}" height="${n(sc.h)}" fill="#E0F2FE" style="${once(c, 'pout', 1.2, d.bootAt)}"/>`
  if (d && live(c, d.packAt, 2)) scr += `<rect x="${n(sc.x)}" y="${n(sc.y)}" width="${n(sc.w)}" height="${n(sc.h)}" fill="#050507" opacity="0" style="${once(c, 'pin', 1, d.packAt)}"/>`
  out += scr
  // dış işçi: monitörde anten (çalışırken sinyal)
  if (d?.external) {
    const ax = X(mon.x + mon.w * 0.86)
    const ay = Y(mon.y)
    const r = Math.max(1, mon.w * 0.035)
    out += `<path d="M${n(ax)} ${n(ay)}v${n(-mon.h * 0.28)}" stroke="#94A3B8" stroke-width="${n(r * 0.6)}"/><circle cx="${n(ax)}" cy="${n(ay - mon.h * 0.3)}" r="${n(r)}" fill="#F2B33D"/>`
    if (d.tone === 'busy' && !c.lite) out += `<path d="M${n(ax - r * 2.2)} ${n(ay - mon.h * 0.42)}q${n(-r * 1.4)} ${n(r * 1.8)} 0 ${n(r * 3.6)}M${n(ax + r * 2.2)} ${n(ay - mon.h * 0.42)}q${n(r * 1.4)} ${n(r * 1.8)} 0 ${n(r * 3.6)}" fill="none" stroke="#F2B33D" stroke-width="${n(r * 0.5)}" stroke-linecap="round" style="animation:ppulse 1.5s infinite"/>`
  }

  return out
}

/** Tabla, ön panel, kart (numara çipi + unvan), mini panel (tam model, efor, durum, süre), evrak, kupa, zarf, rozet, lamba. */
export function deskFront(cell: Box, v: DeskVariant, d: DeskData | null, c: DrawCtx): string {
  const g = DESK_GEOM[v]
  const m = deskModuleBox(cell, v)
  const X = (x: number) => m.x + x
  const Y = (y: number) => m.y + y
  let out = `<use href="#pk-d-${v}" x="${n(m.x)}" y="${n(m.y)}"/>`
  if (!d) return out + freeCard(m, v, c)
  out += R(X(g.slab.x), Y(g.slab.y + g.slab.h - 1), g.slab.w, 1, d.color, ' opacity=".9"')
  // lamba (sağ uç): meşgulken yanık
  const lx = X(g.slab.x + g.slab.w - g.charSize * 0.18)
  const ly = Y(g.slab.y)
  const u = g.charSize / 46
  if (d.tone === 'busy' && !d.lampOff) out += `<path d="M${n(lx - 9 * u)} ${n(ly - 6 * u)}L${n(lx - 20 * u)} ${n(ly)}H${n(lx - 3 * u)}Z" fill="#FDE68A" opacity="${istanbul(c.now).h >= 19 || istanbul(c.now).h < 7 ? 0.32 : 0.2}"/>`
  if (!d.lampOff) out += `<use href="#pk-l${d.tone === 'busy' ? 1 : 0}" x="${n(lx - 14 * u)}" y="${n(ly - 14 * u)}" width="${n(20 * u)}" height="${n(15 * u)}"/>`
  // evrak destesi: 3 araçta bir yaprak, en çok 8
  const sheets = Math.min(8, Math.floor(Math.max(0, d.tools) / 3))
  if (sheets) {
    let s = ''
    const sx = X(g.slab.x + g.slab.w * 0.67)
    for (let i = 0; i < sheets; i++) s += `M${n(sx + ((hash(d.seed + i) % 3) - 1) * 0.6 * u)} ${n(ly - (i + 0.6) * 1.3 * u)}h${n(13 * u)}`
    out += `<path d="${s}" stroke="#E2E8F0" stroke-width="${n(1.05 * u)}"/>`
  }
  // kupa (bitkinlik ≥ 1), buhar (2-3)
  if (d.tired >= 1) {
    const kx = X(g.monitor.x + g.monitor.w + 3 * u)
    out += `<path d="M${n(kx)} ${n(ly - 7 * u)}h${n(6 * u)}l${n(-0.8 * u)} ${n(7 * u)}h${n(-4.4 * u)}z" fill="#E7E5E4"/><path d="M${n(kx + 6 * u)} ${n(ly - 5.5 * u)}q${n(2.4 * u)} 0 ${n(2.4 * u)} ${n(2 * u)}q0 ${n(2 * u)} ${n(-2.6 * u)} ${n(2 * u)}" fill="none" stroke="#E7E5E4" stroke-width="${n(1 * u)}"/>`
    if (d.tired >= 2 && !c.lite) out += `<path d="M${n(kx + 2 * u)} ${n(ly - 8 * u)}q${n(1.6 * u)} ${n(-2.4 * u)} 0 ${n(-4.8 * u)}M${n(kx + 4.4 * u)} ${n(ly - 8 * u)}q${n(1.6 * u)} ${n(-2.4 * u)} 0 ${n(-4.8 * u)}" fill="none" stroke="#CBD5E1" stroke-width="${n(0.8 * u)}" style="animation:psteam 2.2s infinite"/>`
  }
  // okunmamış zarf: monitörün önünde
  if (d.unread) {
    const ew = 11 * u
    const ex = X(g.monitor.x + g.monitor.w * 0.2)
    out += `<g${c.lite ? '' : ' style="animation:ppulse 1.6s infinite"'}>${envelope(ex, ly - ew * 0.72 - 0.5, ew)}<circle cx="${n(ex + ew)}" cy="${n(ly - ew * 0.72)}" r="${n(2 * u)}" fill="#EF4444"/></g>`
  }
  // kart: işçi renginde numara çipi + görev simgesi, unvan ('Yazılımcı 2'), sağda platform rozeti; dış işçide kesikli kenar
  // a mini desk has no plate: its card's lower row carries the model and effort ('Opus 5.5 · orta')
  const whole = g.card
  const cb = g.panel ? whole : { ...whole, h: whole.h * 0.56 }
  const cx = X(cb.x)
  const cy = Y(cb.y)
  const fsC = Math.min(F(c, 10, cb.h * 0.62), cb.h * 0.92)
  const fsCmin = Math.min(fsC, F(c, MIN_PX, 0))
  const iconK = (cb.h * 0.62) / 9
  const badgeW = d.badge ? cb.h * 0.82 : 0
  // the title says who it is ('Yazılımcı 2'): the chip is a dot in the worker's colour (the number is in the tooltip)
  const chipW = cb.h * 0.4
  const base = cx + cb.h * 0.2 + chipW + cb.h * 0.2
  // one type size for every desk's title (a row reads as one set): the largest each one fits at whole, the smallest of those
  const fsG = grouped(`c|${n2(cb.w)}|${n2(cb.h)}|${n2(fsC)}|${n2(fsCmin)}`, () =>
    Math.min(fsC, ...GROUP.map(m => cardFit(m, cb.w, cb.h, fsC, fsCmin, iconK)).filter(f => !f.cut).map(f => f.fs)),
  )
  // (a long one does not shrink the row below 4/5 of the design: it takes two lines at the row's size instead)
  const fit = cardFit(d, cb.w, cb.h, Math.max(fsCmin, Math.min(fsC, Math.max(fsG, fsC * 0.8))), fsCmin, iconK)
  const dutyW = fit.duty ? 9 * iconK + cb.h * 0.15 : 0
  const fsL = fit.fs
  const labelX = base + dutyW
  let card = `<rect x="${n(cx)}" y="${n(cy)}" width="${n(cb.w)}" height="${n(whole.h)}" rx="${n(cb.h * 0.3)}" fill="#14161A" stroke="${d.color}" stroke-width="${W(c, 1, cb.h * 0.08)}"${d.external ? ` stroke-dasharray="${n(cb.h * 0.25)} ${n(cb.h * 0.16)}"` : ''}/>`
  card += `<circle cx="${n(cx + cb.h * 0.2 + chipW / 2)}" cy="${n(cy + cb.h / 2)}" r="${n(cb.h * 0.2)}" fill="${d.color}"/>`
  if (dutyW && d.duty) card += `<use href="#pk-du-${d.duty}" x="${n(base - cb.h * 0.05)}" y="${n(cy + cb.h * 0.19)}" width="${n(9 * iconK)}" height="${n(9 * iconK)}"/>`
  if (fit.lines.length === 2) fit.lines.forEach((l, i) => (card += T(labelX, cy + cb.h / 2 + fsL * 0.36 + (i - 0.5) * fsL * 1.06, l, fsL, '#F1F5F9', { w: 700 })))
  else card += T(labelX, cy + cb.h / 2 + fsL * 0.36, fit.lines[0] ?? '', fsL, '#F1F5F9', { w: 700 })
  if (d.badge) card += `<use href="#pk-${d.badge === 'agy' ? 'agy' : 'ev'}" x="${n(cx + cb.w - badgeW - cb.h * 0.15)}" y="${n(cy + (cb.h - badgeW) / 2)}" width="${n(badgeW)}" height="${n(badgeW)}"/>`
  // mini panel yoksa (mini masa) durum ışığı kartta
  if (!g.panel) {
    card += `<circle cx="${n(cx + cb.w - cb.h * 0.35 - badgeW)}" cy="${n(cy + cb.h * 0.22)}" r="${n(cb.h * 0.12)}" fill="${TONE[d.tone]}"/>`
    // the model row: whole name and effort, else the whole name alone; never cut (the tooltip has it all)
    const rowH = whole.h - cb.h
    const fsMax = Math.min(F(c, MIN_PX, rowH * 0.7), rowH * 0.9)
    const avail = cb.w - cb.h * 0.5
    const opts = d.effortText ? [`${d.model} · ${d.effortText}`, d.model] : [d.model]
    const got = fitFont(opts, avail, fsMax, Math.min(fsMax, F(c, MIN_PX, 0)), true)
    if (got && readable(got.fs)) {
      const ty = cy + cb.h + rowH / 2 + got.fs * 0.34
      const cut = got.text.indexOf(' · ')
      const spans = cut > 0 ? `<tspan fill="#E8EAED">${esc(got.text.slice(0, cut))}</tspan><tspan fill="#7E8794"> · </tspan><tspan fill="#F2B33D">${esc(got.text.slice(cut + 3))}</tspan>` : `<tspan fill="#E8EAED">${esc(got.text)}</tspan>`
      noteBox({ x: cx + cb.h * 0.25, y: ty - got.fs * 0.8, w: textWidth(got.text, got.fs, true), h: got.fs })
      card += `<text x="${n(cx + cb.h * 0.25)}" y="${n(ty)}" class="pt" font-size="${Math.ceil(got.fs * 100) / 100}" font-weight="700">${spans}</text>`
    }
  }
  if (live(c, d.bootAt, 2)) card = `<g class="pb" style="${once(c, 'ppop', 0.5, d.bootAt, `animation-delay:${n(0.5 - ago(c, d.bootAt))}s`)}">${card}</g>`
  else if (live(c, d.packAt, 3)) card = `<g class="pb" style="${once(c, 'pfold', 0.6, d.packAt)}">${card}</g>`
  out += card
  // mini panel: tam model adı ve efor yazıyla ('Opus 5.5 · orta'), durum · süre; hiçbiri kesilmez
  let stateShown = false
  if (g.panel) {
    const pb = g.panel
    const px = X(pb.x)
    const py = Y(pb.y)
    const fsP = Math.min(F(c, 9, pb.h * 0.36), pb.h * 0.8)
    // one type size for every desk's plate, at least 10 px where the whole names fit at it (else down to the floor),
    // and one rule for what a plate leaves out (the state, the minutes): the same on every desk
    const fsPmin = Math.min(fsP, F(c, 10, 0))
    const fsPfloor = Math.min(fsP, F(c, MIN_PX, 0))
    const spec = grouped(`p|${n2(pb.w)}|${n2(pb.h)}|${n2(fsP)}|${n2(fsPfloor)}`, () => plateSpec(GROUP, pb.w, pb.h, fsP, fsPmin, fsPfloor))
    const lay = panelLines(d, pb.w, pb.h, fsP, fsPfloor, spec)
    const fs = lay.fs
    const led = Math.min(pb.h * 0.12, fs * 0.3)
    const tx = px + led * 2 + pb.w * 0.06
    let panel = `<rect x="${n(px)}" y="${n(py)}" width="${n(pb.w)}" height="${n(pb.h)}" rx="${n(Math.min(2.5, pb.h * 0.15))}" fill="#0E1014" stroke="#2A2F37" stroke-width="${W(c, 0.8, 0.5)}"/>`
    // efor yazıya sığmadıysa: sağ kenarda dikey 5 nokta (alttan dolar)
    if (lay.dots && d.effort > 0) {
      const dr = Math.min(pb.h / 13, pb.w * 0.035)
      const dx = px + pb.w - pb.w * 0.04 - dr
      const top = py + (pb.h - dr * 2.4 * 4) / 2
      const col = (from: number, to: number, color: string) =>
        to > from ? `<path d="M${n(dx)} ${n(top + (4 - (to - 1)) * dr * 2.4)}v${n((to - from - 1) * dr * 2.4 + 0.01)}" stroke="${color}" stroke-width="${n(dr * 2)}" stroke-linecap="round" stroke-dasharray="0 ${n(dr * 2.4)}"/>` : ''
      panel += col(0, Math.min(5, d.effort), '#F2B33D') + col(Math.min(5, d.effort), 5, '#3A3F46')
    }
    const lh = fs * 1.12
    const rowY = (i: number) => py + (pb.h - lay.lines.length * lh) / 2 + fs * 0.86 + i * lh
    panel += `<circle cx="${n(px + led + pb.w * 0.04)}" cy="${n(rowY(0) - fs * 0.33)}" r="${n(led)}" fill="${TONE[d.tone]}"${live(c, d.screen.since, 1.4) ? ` style="${once(c, 'pflash', 1.2, d.screen.since)}"` : ''}/>`
    const stateInk = TONE[d.tone] === '#7E8794' ? '#AEB4BE' : TONE[d.tone]
    const ink: Record<PanelPart['k'], string> = { model: '#E8EAED', eff: '#F2B33D', state: stateInk, sep: '#7E8794' }
    lay.lines.forEach((parts, i) => {
      const y = rowY(i)
      const text = parts.map(p => p.t).join('')
      if (!readable(fs) || !text) return
      noteBox({ x: tx, y: y - fs * 0.8, w: textWidth(text, fs, parts.some(p => p.k === 'model')), h: fs })
      const spans = parts.map(p => `<tspan fill="${ink[p.k]}"${p.k === 'model' ? ' font-weight="700"' : ''}>${esc(p.t)}</tspan>`).join('')
      panel += `<text x="${n(tx)}" y="${n(y)}" class="pt" font-size="${Math.ceil(fs * 100) / 100}">${spans}</text>`
    })
    if (live(c, d.bootAt, 2)) panel = `<g style="${once(c, 'pin', 0.6, d.bootAt, `animation-delay:${n(0.8 - ago(c, d.bootAt))}s`)}">${panel}</g>`
    else if (live(c, d.packAt, 3)) panel = `<g style="${once(c, 'pout', 0.8, d.packAt)}">${panel}</g>`
    out += panel
    stateShown = readable(fs) && lay.lines.some(l => l.some(p => p.k === 'state'))
  }
  // what it is doing ('Kod yazıyor'), when the plate has no room for it: a tab hanging under the desk's front
  if (!stateShown && d.state) out += stateTab(m, g, d, c)

  return `<g>${tip(c, `${d.card} (#${d.num}) · ${d.model}${d.effortText ? ` · ${d.effortText} efor` : d.effort ? ` · efor ${d.effort}/5` : ''} · ${d.state}${d.mins !== undefined ? ` · ${d.mins} dk` : ''}`)}${out}</g>`
}

/**
 * The state tab (0.9): one short line ('Kod yazıyor', 'Dedektif avında') on a small dark tab under the desk's
 * front, below the plate, where the plate itself has no room for the state. Left out where it would not be
 * readable or would touch a text drawn before it.
 */
function stateTab(m: Box, g: (typeof DESK_GEOM)[DeskVariant], d: DeskData, c: DrawCtx): string {
  const top = m.y + g.front.y + g.front.h + 0.8
  const room = m.y + g.h - top
  if (room <= 2) return ''
  // (about the plate's own type size: a line under it, not a headline)
  const fs = Math.min(F(c, 9, room * 0.52), room * 0.8)
  if (!readable(fs)) return ''
  const left = m.x + (g.panel ? g.panel.x : g.card.x)
  const maxW = m.x + g.front.x + g.front.w - left
  const pad = fs * 0.45
  const text = ellipsize(d.state, maxW - pad * 2, fs)
  if (!text || text === '…') return ''
  const w = textWidth(text, fs) + pad * 2
  // (kept off the module's bottom edge: what stands below the desk starts there)
  const h = Math.min(room - 1.5, fs * 1.3)
  if (h < fs) return ''
  const box = { x: left, y: top, w, h }
  if (textHit(box, 0.5)) return ''
  noteBox(box)
  const ink = TONE[d.tone] === '#7E8794' ? '#AEB4BE' : TONE[d.tone]

  return `<g><rect x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(2, h * 0.3))}" fill="#0E1014" fill-opacity=".92" stroke="#2A2F37" stroke-width="${W(c, 0.8, 0.5)}"/><text x="${n(left + pad)}" y="${n(top + h / 2 + fs * 0.36)}" class="pt" font-size="${Math.ceil(fs * 100) / 100}" fill="${ink}">${esc(text)}</text></g>`
}

type PanelPart = { t: string; k: 'model' | 'eff' | 'state' | 'sep' }
type PlateSet = { lines: PanelPart[][]; level: 0 | 1 | 2; whole: boolean }
type PlateSpec = { fs: number; level: number } | undefined
type PlateText = Pick<DeskData, 'model' | 'effortText' | 'state' | 'mins'>

/** The plate's possible line sets, richest first: the whole name on one line before any break. Level: 2 state and minutes, 1 state, 0 neither. */
function plateSets(d: PlateText): PlateSet[] {
  const M = (t: string): PanelPart => ({ t, k: 'model' })
  const E = (t: string): PanelPart => ({ t, k: 'eff' })
  const S = (t: string): PanelPart => ({ t, k: 'state' })
  const dot: PanelPart = { t: ' · ', k: 'sep' }
  const model = d.model
  const eff = d.effortText
  const mins = d.mins !== undefined ? ` · ${d.mins}dk` : ''
  const st = d.state
  const cut = model.lastIndexOf(' ')
  const a = cut > 0 ? M(model.slice(0, cut)) : undefined
  const b = cut > 0 ? M(model.slice(cut + 1)) : undefined
  const out: PlateSet[] = []
  const add = (level: 0 | 1 | 2, whole: boolean, ...lines: PanelPart[][]) => void out.push({ lines, level, whole })
  if (eff) {
    add(2, true, [M(model), dot, E(eff)], [S(`${st}${mins}`)])
    add(1, true, [M(model), dot, E(eff)], [S(st)])
    add(2, true, [M(model)], [E(eff), dot, S(`${st}${mins}`)])
    add(1, true, [M(model)], [E(eff), dot, S(st)])
    add(2, true, [M(model)], [E(eff)], [S(`${st}${mins}`)])
    add(1, true, [M(model)], [E(eff)], [S(st)])
    add(0, true, [M(model)], [E(eff)])
    add(0, true, [M(model), dot, E(eff)])
    if (a && b) {
      add(0, false, [a], [b, dot, E(eff)])
      add(0, false, [a], [b], [E(eff)])
      // the whole name on two lines with the effort as dots, before any cut
      add(0, false, [a], [b])
    }
  } else {
    add(2, true, [M(model)], [S(`${st}${mins}`)])
    add(1, true, [M(model)], [S(st)])
    if (a && b) {
      add(1, false, [a], [b], [S(st)])
      add(0, false, [a], [b])
    }
  }
  add(0, true, [M(model)])

  return out
}

/** The plate size and the level every desk of the drawing can show: the smallest size any one needs whole, the poorest level at it. */
function plateSpec(ds: readonly PlateText[], w: number, h: number, fsMax: number, fsPref: number, fsFloor: number): PlateSpec {
  // the level the desks show at a size (a name that breaks onto two lines there leaves the state out alone)
  const levelAt = (fs: number) => {
    const at = ds.map(m => panelLines(m, w, h, fsMax, fsFloor, { fs, level: 2 }))
    const whole = at.filter(l => l.whole)
    return Math.min(...(whole.length ? whole : at).map(l => l.level))
  }
  // the state on every plate when each one fits it, whole, at the preferred size or larger, and the
  // plates are then not much smaller than without it (the model and effort are the plate's news)
  const told = ds.map(m => panelLines(m, w, h, fsMax, fsPref, undefined, 1))
  const bare = plateBare(ds, w, h, fsMax, fsPref, fsFloor)
  if (ds.length > 0 && told.every(l => !l.cut)) {
    const fs = rowSize(told.map(l => l.fs))
    if (!bare || fs * 1.15 >= bare) return { fs, level: levelAt(fs) }
  }
  return bare === undefined ? undefined : { fs: bare, level: levelAt(bare) }
}

/** The plate size every desk fits its whole name and effort at (the state as it may): the smallest of their best sizes. */
function plateBare(ds: readonly PlateText[], w: number, h: number, fsMax: number, fsPref: number, fsFloor: number): number | undefined {
  // a name that is cut, or whose effort fits only as dots, takes a smaller size down to the floor: the effort in words
  const lays = ds.map(m => {
    const l = panelLines(m, w, h, fsMax, fsPref)
    if (!l.cut && !(l.dots && m.effortText)) return l
    const f = panelLines(m, w, h, fsMax, fsFloor)
    return !f.cut && (l.cut || !f.dots) ? f : l
  })
  const ok = lays.filter(l => !l.cut)

  return ok.length === 0 ? undefined : rowSize(ok.map(l => l.fs))
}

/**
 * The mini panel's lines: the whole model name and the effort in words first, then the state; the
 * richest set that fits at a size near the design, else a smaller one down to the floor; the name on
 * two lines only when it fits whole at no size ('DeepSeek V4.1' / 'Flash'), cut never but at the end.
 * `spec`: the drawing's one size and level (each desk takes the richest set within it). `dots`: the
 * effort did not fit in words (the dots stand for it).
 */
/** The drawing's one size: the smallest desk's, unless one long name would shrink the rest below 6/7 of the middle one (it breaks onto two lines instead). */
function rowSize(sizes: readonly number[]): number {
  const sorted = [...sizes].sort((a, b) => a - b)
  const mid = sorted[Math.floor(sorted.length / 2)] ?? 0
  return Math.max(sorted[0] ?? 0, mid * (6 / 7))
}

function panelLines(d: PlateText, w: number, h: number, fsMax: number, fsMin: number, spec?: PlateSpec, minLevel = 0): { fs: number; lines: PanelPart[][]; dots: boolean; level: number; whole: boolean; cut?: boolean } {
  const sets = plateSets(d).filter(x => x.level >= minLevel)
  // the text column: from after the state light to the right edge
  const avail = (fs: number) => w - Math.min(h * 0.12, fs * 0.3) * 2 - w * 0.06 - w * 0.04
  const fits = (set: PlateSet, fs: number) =>
    set.lines.length * fs * 1.12 <= h * 0.94 && set.lines.every(line => textWidth(line.map(p => p.t).join(''), fs, line.some(p => p.k === 'model')) <= avail(fs))
  const done = (set: PlateSet, fs: number) => ({ fs, lines: set.lines, dots: !set.lines.some(l => l.some(p => p.k === 'eff')), level: set.level, whole: set.whole })
  if (spec) for (const set of sets) if (set.level <= spec.level && fits(set, spec.fs)) return done(set, spec.fs)
  const steps = (from: number, to: number): number[] => {
    const out: number[] = []
    for (let f = from; f >= to - 1e-6; f -= Math.max(0.05, from * 0.04)) out.push(f)
    if (out[out.length - 1] !== to) out.push(to)
    return out
  }
  // near the design size the richest whole set wins; below it the largest size a whole set fits at (the
  // poorer set before the smaller type); then the name on two lines, again the largest size first
  const near = Math.max(fsMin, fsMax * 0.86)
  const whole = sets.filter(x => x.whole)
  const broken = sets.filter(x => !x.whole)
  for (const set of whole) for (const fs of steps(fsMax, near)) if (fits(set, fs)) return done(set, fs)
  for (const fs of steps(near, fsMin)) for (const set of whole) if (fits(set, fs)) return done(set, fs)
  // (the effort in words at any size before the dots)
  const worded = broken.filter(x => !d.effortText || x.lines.some(l => l.some(p => p.k === 'eff')))
  for (const group of [worded, broken.filter(x => !worded.includes(x))]) for (const fs of steps(fsMax, fsMin)) for (const set of group) if (fits(set, fs)) return done(set, fs)
  // nothing fits (a tiny panel): the model alone, cut at the floor size, with the dots for the effort
  return { fs: fsMin, lines: [[{ t: ellipsize(d.model, avail(fsMin), fsMin, true), k: 'model' }]], dots: true, level: 0, whole: false, cut: true }
}

/** A desk title's lines at the largest size from `fsMax` it fits at whole: one line (with the duty icon when it fits near full size), else two, else cut. */
function cardFit(d: Pick<DeskData, 'card' | 'badge' | 'duty'>, w: number, h: number, fsMax: number, fsMin: number, iconK: number): { lines: string[]; fs: number; duty: boolean; cut?: boolean } {
  const badgeW = d.badge ? h * 0.82 : 0
  const room = w - h * 0.8 - badgeW - h * 0.25
  const dutyW = d.duty && d.duty !== 'general' ? 9 * iconK + h * 0.15 : 0
  if (dutyW) {
    const one = fitFont([d.card], room - dutyW, fsMax, Math.max(fsMin, fsMax * 0.85), true)
    if (one) return { lines: [one.text], fs: one.fs, duty: true }
  }
  // near the row's size on one line, else on two lines, else smaller on one line
  const one = fitFont([d.card], room, fsMax, Math.max(fsMin, fsMax * 0.92), true)
  if (one) return { lines: [one.text], fs: one.fs, duty: false }
  const two = twoLines(d.card, room, Math.min(fsMax, (h * 0.9) / 2.12), Math.max(fsMin, fsMax * 0.6))
  if (two) return { lines: two.lines, fs: two.fs, duty: false }
  const small = fitFont([d.card], room, fsMax, fsMin, true)
  if (small) return { lines: [small.text], fs: small.fs, duty: false }

  return { lines: [ellipsize(d.card, room, fsMin, true)], fs: fsMin, duty: false, cut: true }
}

// ——— one type size for every desk of a drawing (deskGroup: scene sets it before the desks are drawn) ———
type GroupDesk = PlateText & Pick<DeskData, 'card' | 'badge' | 'duty'>
let GROUP: readonly GroupDesk[] = []
const GROUP_MEMO = new Map<string, unknown>()
/** The desks drawn together: their titles and plates share one size and one rule. */
export function deskGroup(ds: readonly DeskData[]): void {
  GROUP = ds.map(d => ({ card: d.card, badge: d.badge, duty: d.duty, model: d.model, effortText: d.effortText, state: d.state, mins: d.mins }))
  GROUP_MEMO.clear()
}
function grouped<T>(key: string, make: () => T): T {
  if (!GROUP_MEMO.has(key)) GROUP_MEMO.set(key, make())
  return GROUP_MEMO.get(key) as T
}

/** A name on two lines, broken at the word that balances them best, at the largest size both fit. */
function twoLines(text: string, maxW: number, fsMax: number, fsMin: number): { lines: [string, string]; fs: number } | undefined {
  const words = text.trim().split(/\s+/)
  if (words.length < 2 || fsMax < fsMin) return undefined
  let best: [string, string] | undefined
  let bestW = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const w = Math.max(textWidth(a, 1, true), textWidth(b, 1, true))
    if (w < bestW) (bestW = w), (best = [a, b])
  }
  if (!best) return undefined
  const fs = Math.min(fsMax, maxW / bestW)

  return fs >= fsMin - 1e-6 ? { lines: best, fs } : undefined
}

/** The largest size from `fsMax` down to `fsMin` at which one of `options` fits in `maxW` (the first that does). */
function fitFont(options: readonly string[], maxW: number, fsMax: number, fsMin: number, bold = false): { text: string; fs: number } | undefined {
  for (let fs = fsMax; fs >= fsMin - 1e-6; fs -= Math.max(0.05, fsMax * 0.04)) {
    const t = fitText(options, maxW, fs, bold)
    if (t) return { text: t, fs }
  }
  const t = fitText(options, maxW, fsMin, bold)

  return t ? { text: t, fs: fsMin } : undefined
}

/** Hazır masanın kartı: sıradaki gelenin numarası (yalnız ilk boş masada); öbürlerinde yazısız kesikli çerçeve. */
function freeCard(m: Box, v: DeskVariant, c: DrawCtx, next?: number): string {
  const cb = DESK_GEOM[v].card
  const fs = Math.min(F(c, 10, cb.h * 0.6), cb.h * 0.9)
  const label = next ? fitText([`Sıradaki · #${next}`, `Sıradaki #${next}`, `#${next}`], cb.w - cb.h * 0.5, fs, true) : ''

  return `<rect x="${n(m.x + cb.x)}" y="${n(m.y + cb.y)}" width="${n(cb.w)}" height="${n(cb.h)}" rx="${n(cb.h * 0.3)}" fill="none" stroke="#7E8794" stroke-width="${W(c, 1, cb.h * 0.06)}" stroke-dasharray="${n(cb.h * 0.2)} ${n(cb.h * 0.2)}"/>${label ? T(m.x + cb.x + cb.w / 2, m.y + cb.y + cb.h / 2 + fs * 0.36, label, fs, '#9CA3AF', { a: 'middle', w: 700 }) : ''}`
}

/**
 * Hazır masa: boş, sandalye içeride, sönük; yeni gelen için yer. `next`: sıradaki gelenin numarası (yeni
 * ajan ilk boş masaya oturur); verilmezse kart yazısızdır (amaçsız 'Hazır masa' yazıları yığılmasın).
 */
export function freeDesk(cell: Box, v: DeskVariant, c: DrawCtx, next?: number): string {
  const m = deskModuleBox(cell, v)

  return `<g opacity="${next ? 0.62 : 0.5}">${tip(c, next ? `Boş masa: sıradaki ajan (#${next}) buraya oturur` : 'Boş masa: yeni gelenler için yer')}${deskBack(cell, v, null, c)}<use href="#pk-d-${v}" x="${n(m.x)}" y="${n(m.y)}"/>${freeCard(m, v, c, next)}</g>`
}

// ——— monitör içerikleri ————————————————————————————————————————

/** Araç adlarının ekranda okunur kısa adları (uzundan kısaya); sırayla sığan ilki yazılır. */
const TOOL_WORDS: Readonly<Record<string, readonly string[]>> = {
  workflow: ['İş akışı', 'Akış'], webfetch: ['Web sayfası', 'Web'], websearch: ['Web arama', 'Arama'], todowrite: ['Plan'],
  agent: ['Alt ajan', 'Ajan'], task: ['Alt ajan', 'Ajan'], sendmessage: ['Mesaj'], skill: ['Beceri'], toolsearch: ['Araç arama', 'Araç'],
  notebookedit: ['Defter'], monitor: ['İzleme', 'İzle'], askuserquestion: ['Soru'], exitplanmode: ['Plan'], enterplanmode: ['Plan'],
  powershell: ['Komut'], bash: ['Komut'], multiedit: ['Düzenleme', 'Düzen'], artifact: ['Sayfa'], schedulewakeup: ['Zamanla'],
}

/**
 * Bir ekran yazısının anlamlı kısa biçimleri (uzundan kısaya, ilki kendisi): bilinen araç adı Türkçe kısa
 * adına, 'A · B' B'ye, model adı sürümsüz ailesine ve tek sözcüğüne ('Gemini 3.8 Flash' → 'Gemini Flash' →
 * 'Flash' → 'Gemini'), MCP aracı son parçasına iner. Hiçbiri kesik ('WorkFl…') değildir.
 */
export function screenWords(text: string): string[] {
  const t = text.trim()
  const out: string[] = [t]
  const key = t.toLowerCase().replace(/[^a-z]/g, '')
  out.push(...(TOOL_WORDS[key] ?? []))
  const dot = t.lastIndexOf(' · ')
  if (dot > 0) out.push(...screenWords(t.slice(dot + 3)), t.slice(0, dot))
  const mcp = /^mcp__.*?__([^_].*)$/.exec(t)
  if (mcp) out.push((mcp[1] as string).replace(/_/g, ' '))
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length > 1) {
    const plain = words.filter(w => !/\d/.test(w))
    // a model name drops its version, then keeps its family's own word ('Flash', 'Sol'); a phrase its first word
    if (plain.length && plain.length < words.length) out.push(plain.join(' '), plain[plain.length - 1] as string)
    out.push(words[0] as string)
  }
  const camel = /^([A-Z][a-z]+)[A-Z]/.exec(t)
  if (camel) out.push(camel[1] as string)

  return [...new Set(out.filter(Boolean))]
}

/** Ekranın içi: o anki gerçek iş (dosya adı, komut türü, site, düşünce türü, ilerleme). `b` ekran kutusu. */
export function monitor(b: Box, scr: ScreenView, c: DrawCtx, seed: string): string {
  // ekranın içi yerel koordinatlı (kırpan pencere): yazıları deftere girmez, monitörün kendisi zaten kutu
  return local(() => monitorIn(b, scr, c, seed))
}
function monitorIn(b: Box, scr: ScreenView, c: DrawCtx, seed: string): string {
  const w = b.w
  const h = b.h
  const fs = Math.min(F(c, MIN_PX, h * 0.24), h * 0.42)
  const ph = -((hash(seed) % 1000) / 1000) * 3
  const anim = (name: string, dur: number, extra = 'infinite') => (c.motion && !c.lite ? `animation:${name} ${dur}s ${n(ph)}s ${extra}` : '')
  const lineW = Math.max(0.6, h * 0.07)
  const lines = (x0: number, y0: number, count: number, step: number, color: string, maxW: number) => {
    let dd = ''
    for (let i = 0; i < count; i++) dd += `M${n(x0)} ${n(y0 + i * step)}h${n(maxW * (0.45 + ((hash(seed + i) % 50) / 100)))}`
    return `<path d="${dd}" stroke="${color}" stroke-width="${n(lineW)}" stroke-linecap="round"/>`
  }
  const label = (scr.label ?? '').trim()
  /**
   * Başlık: sığmazsa önce anlamlı kısa biçimine iner ('Workflow' → 'Akış', 'Gemini 3.8 Flash' → 'Flash';
   * screenWords), o da sığmazsa sağdan '…' ile kısalır (dosya adında uzantı korunur); soldan kesilmez, kaymaz.
   */
  const title = (text: string, x: number, y: number, color: string, maxW: number, bold = false, mono = false) => {
    if (!text || !readable(fs)) return ''
    // harfin sol çıkıntısı kırpılmasın: yazı pencerenin kenarından biraz içeride başlar
    const room = maxW * 0.9 - fs * 0.15
    const file = scr.kind === 'file-read' || scr.kind === 'file-write' || scr.kind === 'cmd' || scr.kind === 'search'
    const shown = (file ? '' : fitText(screenWords(text), room, fs, bold, mono)) || ellipsize(text, room, fs, bold, mono)
    const t = T(fs * 0.15, fs * 0.85, shown, fs, color, { w: bold ? 700 : undefined, m: mono })
    return `<svg x="${n(x)}" y="${n(y)}" width="${n(maxW)}" height="${n(fs * 1.15)}" overflow="hidden">${t}</svg>`
  }
  const bar = fs * 1.35
  let bg = '#0B0D14'
  let inner = ''
  switch (scr.kind) {
    case 'file-read':
      bg = '#E8EDF3'
      inner = `<g style="--py:${n(-h * 0.3)}px;${anim('pscroll', 4, 'linear infinite')}">${lines(w * 0.08, bar + h * 0.15, 7, h * 0.12, '#7C8796', w * 0.84)}</g>${R(0, 0, w, bar, '#CBD5E1')}${title(label, w * 0.05, (bar - fs * 1.15) / 2, '#1F2937', w * 0.9, true)}`
      break
    case 'file-write': {
      bg = '#1E1E26'
      const cols = ['#F472B6', '#38BDF8', '#A3E635', '#FBBF24', '#C4B5FD']
      let code = ''
      for (let i = 0; i < 5; i++) {
        const lw = w * (0.3 + ((hash(seed + 'c' + i) % 45) / 100))
        const y = bar + h * 0.12 + i * h * 0.13
        code += `<path d="M${n(w * 0.08 + (i % 3) * w * 0.05)} ${n(y)}h${n(lw)}" stroke="${cols[i % 5]}" stroke-width="${n(lineW)}" stroke-linecap="round"${i === 4 && c.motion && !c.lite ? ` stroke-dasharray="${n(lw)}" style="--pd:${n(lw)};${anim('ptype', 1.8)}"` : ''}/>`
      }
      inner = `${code}${R(0, 0, w, bar, '#2A2A35')}${R(w * 0.03, bar * 0.12, Math.min(w * 0.8, textWidth(label, fs, false, true) + w * 0.08), bar * 0.88, '#1E1E26')}${title(label, w * 0.06, (bar - fs * 1.15) / 2 + bar * 0.06, '#E5E7EB', w * 0.74, false, true)}${R(w * 0.8, h * 0.82, lineW * 0.9, h * 0.11, '#F8FAFC', c.motion && !c.lite ? ' style="animation:pblink .9s infinite"' : '')}`
      break
    }
    case 'search':
      bg = '#F8FAFC'
      inner = `<rect x="${n(w * 0.05)}" y="${n(h * 0.07)}" width="${n(w * 0.9)}" height="${n(bar)}" rx="${n(bar / 2)}" fill="#fff" stroke="#3B82F6" stroke-width="${n(lineW * 0.6)}"/><circle cx="${n(w * 0.05 + bar * 0.5)}" cy="${n(h * 0.07 + bar * 0.45)}" r="${n(bar * 0.2)}" fill="none" stroke="#3B82F6" stroke-width="${n(lineW * 0.5)}"/>${title(label, w * 0.05 + bar * 0.85, h * 0.07 + (bar - fs * 1.15) / 2, '#1E3A8A', w * 0.9 - bar, false, true)}${lines(w * 0.1, h * 0.07 + bar + h * 0.16, 3, h * 0.17, '#94A3B8', w * 0.8)}${R(w * 0.1, h * 0.07 + bar + h * 0.12, w * 0.18, h * 0.08, '#FDE68A', ' opacity=".8"')}`
      break
    case 'cmd':
      bg = '#0D1117'
      inner = `<g style="--py:${n(-h * 0.26)}px;${anim('pscroll', 1.8, 'steps(4) infinite')}">${lines(w * 0.07, bar + h * 0.15, 7, h * 0.13, '#22C55E', w * 0.8)}</g>${R(0, 0, w, bar * 1.05, '#0D1117')}${title(`$ ${label || 'komut'}`, w * 0.05, (bar - fs * 1.15) / 2, '#4ADE80', w * 0.9, true, true)}`
      break
    case 'site': {
      bg = '#FFFFFF'
      const site = scr.site ?? 'web'
      const bs = bar * 0.8
      inner = `${R(0, 0, w, bar, SITE_COLOR[site])}${siteBadge(site, w * 0.04, (bar - bs) / 2, bs)}${title(label || SITE_LABEL[site], w * 0.06 + bs, (bar - fs * 1.15) / 2, site === 'wiki' || site === 'google' ? '#111' : '#fff', w * 0.88 - bs, true)}<rect x="${n(w * 0.06)}" y="${n(bar + h * 0.1)}" width="${n(w * 0.38)}" height="${n(h - bar - h * 0.2)}" rx="${n(w * 0.02)}" fill="#E2E8F0"${anim('ppulse', 2.4) ? ` style="${anim('ppulse', 2.4)}"` : ''}/>${lines(w * 0.52, bar + h * 0.16, 4, h * 0.14, '#94A3B8', w * 0.42)}`
      break
    }
    case 'think': {
      bg = '#1F1B2E'
      const k = Math.min(h * 0.5, w * 0.28) / 14
      inner = `${thinkIcon(scr.think ?? 'general', w * 0.06, (h - 14 * k) / 2 - fs * 0.4, '#C4B5FD', k)}${title(label || THINK_LABEL[scr.think ?? 'general'], w * 0.1 + 14 * k, h / 2 - fs * 0.95, '#E9D5FF', w * 0.86 - 14 * k, true)}${[0, 1, 2].map(i => `<circle cx="${n(w * 0.14 + 14 * k + i * fs * 0.8)}" cy="${n(h / 2 + fs * 0.75)}" r="${n(fs * 0.22)}" fill="#C4B5FD"${c.motion && !c.lite ? ` style="animation:pdots 1.2s ${n(-1.2 + i * 0.2)}s infinite"` : ''}/>`).join('')}`
      break
    }
    case 'plan': {
      bg = '#F8FAFC'
      const pr = scr.progress
      const total = pr && pr.total > 0 ? pr.total : 4
      const done = pr ? clamp(pr.done, 0, total) : 0
      const rows = Math.min(4, total)
      const rh = (h - bar * 1.2) / (rows + 0.3)
      let list = ''
      for (let i = 0; i < rows; i++) {
        const y = h * 0.06 + i * rh
        const ok = i < done
        list += R(w * 0.06, y + rh * 0.2, rh * 0.55, rh * 0.55, ok ? '#22C55E' : '#CBD5E1') + R(w * 0.06 + rh * 0.8, y + rh * 0.38, w * (0.4 + ((hash(seed + 'p' + i) % 30) / 100)), Math.max(0.6, rh * 0.18), ok ? '#94A3B8' : '#475569')
      }
      const bw = w * 0.88 - textWidth(`${done}/${total}`, fs, true, true) - w * 0.04
      inner = `${list}${R(w * 0.06, h - bar * 0.85, bw, bar * 0.4, '#E2E8F0')}${R(w * 0.06, h - bar * 0.85, (bw * done) / total, bar * 0.4, '#16A34A')}${T(w * 0.95, h - bar * 0.35, `${done}/${total}`, fs, '#166534', { a: 'end', w: 700, m: true })}`
      break
    }
    case 'msg':
      bg = '#1F2A3C'
      inner = `<g${anim('ppulse', 1.8) ? ` style="${anim('ppulse', 1.8)}"` : ''}>${envelope(w * 0.08, h * 0.12, Math.min(w * 0.3, h * 0.55))}</g>${title(label ? `→ ${label}` : '→', w * 0.08, h * 0.62, '#E2E8F0', w * 0.86, true)}`
      break
    case 'answer':
      bg = '#F5F1EA'
      inner = `<rect x="${n(w * 0.06)}" y="${n(h * 0.1)}" width="${n(w * 0.7)}" height="${n(h * 0.36)}" rx="${n(h * 0.08)}" fill="#E7DED0"/>${lines(w * 0.12, h * 0.2, 2, h * 0.12, '#6B5E4E', w * 0.55)}<rect x="${n(w * 0.3)}" y="${n(h * 0.54)}" width="${n(w * 0.64)}" height="${n(h * 0.34)}" rx="${n(h * 0.08)}" fill="#D97757" opacity=".85"/><path d="M${n(w * 0.36)} ${n(h * 0.71)}h${n(w * 0.48)}" stroke="#FFF7ED" stroke-width="${n(lineW)}" stroke-linecap="round"${c.motion && !c.lite ? ` stroke-dasharray="${n(w * 0.48)}" style="--pd:${n(w * 0.48)};animation:ptype 1.6s ${n(ph)}s infinite"` : ''}/>`
      break
    case 'wait':
      bg = '#3A2A0A'
      inner = `${T(w * 0.22, h * 0.68, '?', h * 0.6, '#F59E0B', { a: 'middle', w: 800, st: anim('ppulse', 1) })}${title(label ? `Onay · ${label}` : 'Onay', w * 0.4, h / 2 - fs * 0.6, '#FDE68A', w * 0.56, true)}`
      break
    case 'ext': {
      bg = '#10162A'
      const r = Math.min(h * 0.22, w * 0.12)
      inner = `<g style="transform-origin:${n(w * 0.06 + r)}px ${n(h / 2)}px;${anim('pspin', 1.4, 'linear infinite')}"><circle cx="${n(w * 0.06 + r)}" cy="${n(h / 2)}" r="${n(r)}" fill="none" stroke="#F2B33D" stroke-width="${n(r * 0.35)}" stroke-dasharray="${n(r * 2.2)} ${n(r * 1.1)}"/></g>${title(label || 'Dış işçi çalışıyor', w * 0.1 + r * 2, h / 2 - fs * 0.6, '#FDE68A', w * 0.86 - r * 2, true)}`
      break
    }
    case 'tool': {
      bg = '#1B2430'
      const r = Math.min(h * 0.22, w * 0.12)
      const gx = w * 0.06 + r
      inner = `<circle cx="${n(gx)}" cy="${n(h / 2)}" r="${n(r)}" fill="none" stroke="#94A3B8" stroke-width="${n(r * 0.5)}" stroke-dasharray="${n(r * 0.5)} ${n(r * 0.36)}"/><circle cx="${n(gx)}" cy="${n(h / 2)}" r="${n(r * 0.35)}" fill="#94A3B8"/>${title(label || 'Araç', w * 0.1 + r * 2, h / 2 - fs * 0.6, '#E2E8F0', w * 0.86 - r * 2, true, true)}`
      break
    }
    case 'idle':
      bg = '#0B0D14'
      inner = `<g opacity=".35">${starburst(w / 2, h / 2, Math.min(w, h) * 0.22, '#D97757')}</g>`
      break
    case 'boot':
      bg = '#E0F2FE'
      inner = `${starburst(w / 2, h / 2, Math.min(w, h) * 0.24, '#D97757')}`
      break
    case 'off':
      bg = '#050507'
      inner = `<path d="M${n(w * 0.1)} ${n(h * 0.9)}L${n(w * 0.4)} ${n(h * 0.1)}" stroke="#fff" stroke-width="${n(w * 0.06)}" opacity=".05"/>`
      break
  }
  // lite çizimde ya da ekranda çok küçük monitörde yalnız zemin ve etiket (satırlar seçilmez)
  const simple = c.lite || h * c.s < 28
  if (simple && scr.kind !== 'idle' && scr.kind !== 'off' && scr.kind !== 'boot') {
    const lab =
      scr.kind === 'cmd' ? `$ ${label || 'komut'}` : scr.kind === 'site' ? label || SITE_LABEL[scr.site ?? 'web'] : scr.kind === 'think' ? label || THINK_LABEL[scr.think ?? 'general'] : scr.kind === 'plan' && scr.progress ? `${scr.progress.done}/${scr.progress.total}` : scr.kind === 'wait' ? `Onay · ${label}` : scr.kind === 'msg' ? `→ ${label}` : label
    inner = title(lab, w * 0.06, (h - fs * 1.15) / 2, bg === '#FFFFFF' || bg === '#F8FAFC' || bg === '#E8EDF3' || bg === '#F5F1EA' ? '#1F2937' : '#E8EAED', w * 0.88, true, scr.kind === 'cmd')
  }
  const steps = Math.min(8, Math.max(0, scr.steps ?? 0))
  if (!simple && steps && scr.kind !== 'plan' && scr.kind !== 'idle' && scr.kind !== 'off' && scr.kind !== 'boot') {
    const r = Math.max(0.5, h * 0.035)
    inner += `<path d="M${n(w - r * 2 - (steps - 1) * r * 2.6)} ${n(h - r * 2)}h${n((steps - 1) * r * 2.6 + 0.01)}" stroke="#D97757" stroke-width="${n(r * 2)}" stroke-linecap="round" stroke-dasharray="0 ${n(r * 2.6)}"/>`
  }

  return `<svg x="${n(b.x)}" y="${n(b.y)}" width="${n(w)}" height="${n(h)}" overflow="hidden"><rect width="${n(w)}" height="${n(h)}" fill="${bg}"/>${inner}</svg>`
}

// ——— patron masası ———————————————————————————————————————————————

export type BossDeskData = { state: string; model: string; effort?: string; screen: ScreenView; unread: number; ringing: boolean; reports: number; mug: boolean }

/** Patron masasının geometrisi (kutu içinde): ayak noktası layout'taki taht noktasıyla aynı (BOSS_DESK_TOP). */
export function bossDeskGeom(b: Box): { seat: Pt; slabY: number; slabH: number; frontY: number; frontH: number; legY: number; throne: Box; monitor: Box } {
  const seatY = b.y + b.h * BOSS_DESK_TOP
  const slabY = b.y + b.h * (BOSS_DESK_TOP - 0.13)
  const slabH = Math.max(3, b.h * 0.055)
  const frontY = slabY + slabH
  const legY = b.y + b.h * 0.9
  const tw = Math.min(b.w * 0.44, b.h * 0.9)
  const mw = Math.min(b.w * 0.24, b.h * 0.42)
  const mh = mw * 0.66

  return {
    seat: [n(b.x + b.w / 2), n(seatY)],
    slabY,
    slabH,
    frontY,
    frontH: legY - frontY,
    legY,
    throne: { x: b.x + (b.w - tw) / 2, y: b.y + b.h * 0.02, w: tw, h: slabY - b.y - b.h * 0.02 },
    monitor: { x: b.x + b.w * 0.07, y: slabY - mh, w: mw, h: mh },
  }
}

/** Taht, arka ışık (spot), patron halısı, monitör. */
export function bossDeskBack(b: Box, d: BossDeskData, c: DrawCtx): string {
  const p = palette(c.theme)
  const g = bossDeskGeom(b)
  const t = g.throne
  const gold = '#F2B33D'
  let out = `<ellipse cx="${n(b.x + b.w / 2)}" cy="${n(b.y + b.h - b.h * 0.03)}" rx="${n(b.w * 0.48)}" ry="${n(b.h * 0.07)}" fill="#7F1D1D" opacity=".55"/><ellipse cx="${n(b.x + b.w / 2)}" cy="${n(b.y + b.h - b.h * 0.03)}" rx="${n(b.w * 0.42)}" ry="${n(b.h * 0.05)}" fill="none" stroke="${gold}" stroke-width="${W(c, 1, b.h * 0.008)}" opacity=".6"/>`
  out += `<ellipse cx="${n(t.x + t.w / 2)}" cy="${n(t.y + t.h * 0.45)}" rx="${n(t.w * 0.95)}" ry="${n(t.h * 0.7)}" fill="${gold}" opacity="${c.theme === 'light' ? 0.12 : 0.08}"/>`
  // taht: yüksek sırt, altın kenar, topuzlar
  const r = t.w * 0.5
  out += `<path d="M${n(t.x)} ${n(t.y + t.h)}V${n(t.y + r * 0.6)}Q${n(t.x)} ${n(t.y + r * 0.05)} ${n(t.x + t.w / 2)} ${n(t.y)}Q${n(t.x + t.w)} ${n(t.y + r * 0.05)} ${n(t.x + t.w)} ${n(t.y + r * 0.6)}V${n(t.y + t.h)}Z" fill="#3B0764" stroke="${gold}" stroke-width="${n(Math.max(W(c, 1.4), t.w * 0.03))}"/>`
  const i = t.w * 0.1
  out += `<path d="M${n(t.x + i)} ${n(t.y + t.h)}V${n(t.y + r * 0.66)}Q${n(t.x + i)} ${n(t.y + r * 0.18)} ${n(t.x + t.w / 2)} ${n(t.y + i)}Q${n(t.x + t.w - i)} ${n(t.y + r * 0.18)} ${n(t.x + t.w - i)} ${n(t.y + r * 0.66)}V${n(t.y + t.h)}Z" fill="#581C87"/>`
  out += `<circle cx="${n(t.x)}" cy="${n(t.y + r * 0.6)}" r="${n(t.w * 0.05)}" fill="${gold}"/><circle cx="${n(t.x + t.w)}" cy="${n(t.y + r * 0.6)}" r="${n(t.w * 0.05)}" fill="${gold}"/><circle cx="${n(t.x + t.w / 2)}" cy="${n(t.y)}" r="${n(t.w * 0.05)}" fill="${gold}"/>`
  // monitör
  const m = g.monitor
  out += R(m.x + m.w * 0.44, m.y + m.h * 0.8, m.w * 0.12, m.h * 0.2, '#2A2D33') + `<rect x="${n(m.x)}" y="${n(m.y)}" width="${n(m.w)}" height="${n(m.h * 0.84)}" rx="${n(m.w * 0.04)}" fill="#1B1D22" stroke="${gold}" stroke-opacity=".5" stroke-width="${W(c, 0.8, m.w * 0.015)}"/>`
  out += monitor(screenOf(m), d.screen, c, 'boss')
  void p

  return out
}

/** Masa (koyu cam + altın kenar), 'PATRON · <durum>' plakası (zorunlu), telefon, gelen kutusu, rapor yığını, kupa. */
export function bossDeskFront(b: Box, d: BossDeskData, c: DrawCtx): string {
  const p = palette(c.theme)
  const g = bossDeskGeom(b)
  const gold = '#F2B33D'
  const x0 = b.x + b.w * 0.01
  const w0 = b.w * 0.98
  let out = R(x0 + w0 * 0.04, g.legY, w0 * 0.04, b.y + b.h - g.legY - b.h * 0.04, '#1A1715') + R(x0 + w0 * 0.92, g.legY, w0 * 0.04, b.y + b.h - g.legY - b.h * 0.04, '#1A1715')
  out += `<rect x="${n(x0 + w0 * 0.02)}" y="${n(g.frontY)}" width="${n(w0 * 0.96)}" height="${n(g.frontH)}" fill="#2A2522"/><rect x="${n(x0 + w0 * 0.05)}" y="${n(g.frontY + g.frontH * 0.12)}" width="${n(w0 * 0.9)}" height="${n(g.frontH * 0.76)}" fill="none" stroke="${gold}" stroke-opacity=".35" stroke-width="${W(c, 0.8, b.h * 0.006)}"/>`
  out += R(x0, g.slabY, w0, g.slabH, '#1F2937') + R(x0, g.slabY, w0, Math.max(0.8, g.slabH * 0.28), gold)
  // plaka
  const fs = Math.min(F(c, 10, b.h * 0.085), g.frontH * 0.36)
  // harf aralığı (0,06 em) genişliğe katılır
  const plateW = (s: string) => textWidth(s, fs, true) + s.length * fs * 0.06
  const plateTxt = [`PATRON · ${d.state}`, 'PATRON'].find(s => plateW(s) <= w0 * 0.62) ?? 'PATRON'
  const pw = Math.min(w0 * 0.7, plateW(plateTxt) + fs * 1.6)
  const ph = fs * 1.6
  const px = b.x + b.w / 2 - pw / 2
  const py = g.frontY + g.frontH * 0.42 - ph / 2
  out += `<rect x="${n(px)}" y="${n(py)}" width="${n(pw)}" height="${n(ph)}" rx="${n(ph * 0.22)}" fill="#14110F" stroke="${gold}" stroke-width="${W(c, 1, fs * 0.08)}"/>`
  if (readable(fs)) {
    out += clipBox({ x: px, y: py, w: pw, h: ph }, local(() => T(pw / 2, ph / 2 + fs * 0.36, plateTxt, fs, gold, { a: 'middle', w: 800, ls: fs * 0.06 })))
    noteBox({ x: px, y: py, w: pw, h: ph })
  }
  // model satırı masanın ön yüzünün içinde kalır (alt kenarı plaka gibi, taşmaz); sığmazsa kısalır, yine olmazsa çizilmez
  // the whole model with its effort ('GPT-6.1 Sol · çok yüksek'), a smaller type before the effort is dropped
  const fsM0 = F(c, 9, b.h * 0.06)
  const fit = fitFont([`${d.model}${d.effort ? ` · ${d.effort}` : ''}`], w0 * 0.86, fsM0, Math.min(fsM0, F(c, MIN_PX, 0))) ?? fitFont([d.model], w0 * 0.86, fsM0, Math.min(fsM0, F(c, MIN_PX, 0)))
  const modelTxt = fit?.text ?? ''
  const fsM = fit?.fs ?? fsM0
  const frontBottom = g.frontY + g.frontH - Math.max(1, g.frontH * 0.12)
  if (modelTxt && py + ph + fsM * 1.15 <= frontBottom) {
    const y = Math.min(py + ph + fsM * 1.1, frontBottom - fsM * 0.22)
    const cut = d.effort && modelTxt !== d.model ? modelTxt.length - d.effort.length : -1
    // the effort in the plate's gold, the model in its grey
    if (cut > 0 && readable(fsM)) {
      noteBox({ x: b.x + b.w / 2 - textWidth(modelTxt, fsM) / 2, y: y - fsM * 0.8, w: textWidth(modelTxt, fsM), h: fsM })
      out += `<text x="${n(b.x + b.w / 2)}" y="${n(y)}" class="pt" font-size="${Math.ceil(fsM * 100) / 100}" text-anchor="middle" fill="#B9B3A8">${esc(modelTxt.slice(0, cut))}<tspan fill="${gold}">${esc(modelTxt.slice(cut))}</tspan></text>`
    } else out += T(b.x + b.w / 2, y, modelTxt, fsM, '#B9B3A8', { a: 'middle' })
  }
  // masa üstü: rapor yığını, telefon, gelen kutusu, kupa
  const u = b.h / 108
  const top = g.slabY
  const reports = Math.min(10, Math.max(0, d.reports))
  if (reports) {
    let s = ''
    const sx = g.monitor.x + g.monitor.w + b.w * 0.04
    for (let i = 0; i < reports; i++) s += `M${n(sx + ((hash('rp' + i) % 3) - 1) * 0.7 * u)} ${n(top - (i + 0.6) * 1.5 * u)}h${n(16 * u)}`
    out += `<path d="${s}" stroke="#E2E8F0" stroke-width="${n(1.2 * u)}"/>`
  }
  if (d.mug) {
    const kx = g.monitor.x + g.monitor.w + b.w * 0.04 + (reports ? 20 * u : 0)
    out += `<path d="M${n(kx)} ${n(top - 8 * u)}h${n(7 * u)}l${n(-1 * u)} ${n(8 * u)}h${n(-5 * u)}z" fill="${gold}"/><path d="M${n(kx + 7 * u)} ${n(top - 6.5 * u)}q${n(2.6 * u)} 0 ${n(2.6 * u)} ${n(2.2 * u)}q0 ${n(2.2 * u)} ${n(-2.8 * u)} ${n(2.2 * u)}" fill="none" stroke="${gold}" stroke-width="${n(1.1 * u)}"/>`
  }
  // telefon (onay beklerken çalar)
  const phx = b.x + b.w * 0.7
  let phone = `<path d="M${n(phx)} ${n(top)}l${n(2 * u)} ${n(-6 * u)}h${n(10 * u)}l${n(2 * u)} ${n(6 * u)}z" fill="#1F2937"/><path d="M${n(phx - 1 * u)} ${n(top - 7 * u)}q${n(8 * u)} ${n(-4 * u)} ${n(16 * u)} 0" fill="none" stroke="#111827" stroke-width="${n(2.4 * u)}" stroke-linecap="round"/>`
  if (d.ringing && c.motion) {
    phone = `<g style="transform-origin:${n(phx + 7 * u)}px ${n(top)}px;animation:pring 1.1s infinite">${phone}</g>`
    for (let k = 0; k < 2; k++) phone += `<path d="M${n(phx + 17 * u + k * 3 * u)} ${n(top - 10 * u - k * 2 * u)}q${n(3 * u)} ${n(4 * u)} 0 ${n(8 * u)}" fill="none" stroke="${p.amber}" stroke-width="${n(0.9 * u)}" style="animation:ppulse 1s ${n(-k * 0.4)}s infinite"/>`
  }
  out += phone
  // gelen kutusu: okunmamış mesajlar
  const ix = b.x + b.w * 0.86
  const iw = b.w * 0.1
  out += R(ix, top - 5 * u, iw, 5 * u, '#3F3A35') + R(ix, top - 5 * u, iw, 1 * u, gold, ' opacity=".7"')
  const unread = Math.min(4, Math.max(0, d.unread))
  for (let k = 0; k < unread; k++) out += envelope(ix + iw * 0.1 + k * 0.8 * u, top - 4 * u - (k + 1) * 2.2 * u, iw * 0.8)
  if (d.unread > 0) {
    const num = String(Math.min(99, d.unread))
    const uf = F(c, MIN_PX, 3.6 * u)
    const ur = Math.max(3.2 * u, uf * (num.length > 1 ? 0.95 : 0.72))
    out += `<circle cx="${n(ix + iw)}" cy="${n(top - 12 * u)}" r="${n(ur)}" fill="#EF4444"/>${T(ix + iw, top - 12 * u + uf * 0.36, num, uf, '#fff', { a: 'middle', w: 800 })}`
  }

  return `<g>${tip(c, `Patron · ${d.state} · ${d.model}${d.effort ? ` · ${d.effort} efor` : ''}${d.unread ? ` · ${d.unread} okunmamış` : ''}`)}${out}</g>`
}
