// Ofisin özgün karakterleri: her model ailesinin piksel maskotu, durum başına yatay bir
// kare şeridi (char-data.ts). Bir şerit çizimde bir kez <symbol id="ch-<tür>-<durum>"> olarak
// gömülür; her karakter o şeride w x h'lik bir pencereden bakar ve pencere CSS steps() ile
// kareler arasında kayar. Böylece aynı türden on masa tek kopya öder.
// Bütçe aşılırsa önce fazla durumlar idle'a düşer, en son idle vektör yedeğe iner: karakter
// hiçbir koşulda görünmez olmaz (charDefs).
import type { MascotKind } from '../types'
import { CHAR_SET, type CharKind, type CharSheet, type CharState, type CharStrip } from './char-data'

export type { CharKind, CharState } from './char-data'

/** Şerit anahtarı: durumlar ve EVREN'in sola yürüyüşü. */
type StripKey = CharState | 'walk_sol'

export type CharOpts = {
  /** 'loop' (varsayılan): sonsuz döngü, phaseLock kilitler · 'once': `loops` kez oynar, sonra kare 0 · 'still': tek kare */
  play?: 'loop' | 'once' | 'still'
  /** ≤ 0 sn. once: olayın yaşı (eksi); loop: kademe (aynı türden masalar aynı anda kıpırdamasın) */
  delay?: number
  /** once: kaç kez (varsayılan 1) */
  loops?: number
  /** still: hangi kare (varsayılan 0) */
  frame?: number
  /** fps çarpanı (bitkinlik: 0,85 / 0,7 / 0,5); varsayılan 1 */
  speed?: number
  /** sola bakış/yürüyüş: idle, walk, wave, run aynalanır; ikonlu durumlar asla; EVREN yalnız walk → walk_sol */
  left?: boolean
  /** bitkinlik görünümü (§5.6): 1 esneme bulutu (40 sn), 2 düşük omuz + sık esneme (20 sn), 3 + ter, yürürken çöküş */
  tired?: 0 | 1 | 2 | 3
  /** <title> (lite çizimde verilmez) */
  title?: string
  /** patron: charDefs bütçesinde önce gelir (pofu-boss kendiliğinden patron sayılır) */
  boss?: boolean
  /** paylaşılan şeritte modeli ayıran küçük işaret: Fable açık kitap (Pofu'nun yanında), Astra yıldız halkası (dünyanın üstünde) */
  mark?: CharMark
  /** kaynak satırı: figür bu satırın üstünden kırpılır (iç <svg> viewBox y'si ve boyu; clipPath yok). Etkinlik şapkası baş üstündeki aksesuarı gizler. */
  cropTop?: number
}

/** A sheet two models share tells them apart by a small mark: Fable's open book, Astra's star ring. */
export type CharMark = 'book' | 'star'
const MARK_OF: Readonly<Partial<Record<MascotKind, CharMark>>> = { fable: 'book', astra: 'star' }
/** The mark a model's figure carries (none for a model with its own sheet). */
export const markOf = (m: MascotKind): CharMark | undefined => MARK_OF[m]

/** The mark at the figure's head (ou): a book held at the right of the head, a ring of stars above it. */
function markSvg(mark: CharMark, sheet: CharSheet, k: number, x: number, y: number): string {
  const top = y - (sheet.ay - sheet.fig.top) * k
  const right = x + (sheet.fig.right - sheet.ax) * k
  const u = Math.max(0.8, (sheet.ay - sheet.fig.top) * k * 0.09)
  if (mark === 'book') {
    // open book: two pages and a spine, at shoulder height right of the figure
    const bx = right - u * 1.2
    const by = top + (sheet.ay - sheet.fig.top) * k * 0.42
    return `<g><path d="M${r2(bx)} ${r2(by)}l${r2(u * 2)} ${r2(-u * 0.5)}v${r2(u * 2.4)}l${r2(-u * 2)} ${r2(u * 0.5)}z" fill="#F5EBDD" stroke="#5B3A1E" stroke-width="${r2(u * 0.3)}"/><path d="M${r2(bx)} ${r2(by)}l${r2(-u * 2)} ${r2(-u * 0.5)}v${r2(u * 2.4)}l${r2(u * 2)} ${r2(u * 0.5)}z" fill="#FFF8EE" stroke="#5B3A1E" stroke-width="${r2(u * 0.3)}"/><path d="M${r2(bx - u * 1.4)} ${r2(by + u * 0.4)}h${r2(u)}M${r2(bx + u * 0.4)} ${r2(by + u * 0.2)}h${r2(u)}" stroke="#B08968" stroke-width="${r2(u * 0.25)}"/></g>`
  }
  // a small ring with three stars over the head
  const cx = x + ((sheet.fig.left + sheet.fig.right) / 2 - sheet.ax) * k
  const cy = top - u * 1.2
  const star = (sx: number, sy: number, r: number) => `M${r2(sx)} ${r2(sy - r)}L${r2(sx + r * 0.3)} ${r2(sy - r * 0.3)}L${r2(sx + r)} ${r2(sy)}L${r2(sx + r * 0.3)} ${r2(sy + r * 0.3)}L${r2(sx)} ${r2(sy + r)}L${r2(sx - r * 0.3)} ${r2(sy + r * 0.3)}L${r2(sx - r)} ${r2(sy)}L${r2(sx - r * 0.3)} ${r2(sy - r * 0.3)}Z`
  return `<g><ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(u * 3.2)}" ry="${r2(u * 0.9)}" fill="none" stroke="#A78BFA" stroke-width="${r2(u * 0.45)}"/><path d="${star(cx, cy - u * 0.9, u * 1.1)}${star(cx - u * 3, cy, u * 0.75)}${star(cx + u * 3, cy, u * 0.75)}" fill="#FDE68A" stroke="#B45309" stroke-width="${r2(u * 0.2)}"/></g>`
}

/** Referans figürün kaynak piksel boyu: `size` bu boya karşılık gelir. */
const REFERENCE_FIGURE_PX = 43
/** Vektör yedeğin en çok uzunluğu (bütçe ayırmada kullanılır). */
const VECTOR_MAX = 1200
/** Aynalanabilen durumlar: ikon (balon, kum saati, onay, X, büyüteç, ekran) taşımayanlar. */
const MIRRORABLE: ReadonlySet<StripKey> = new Set<StripKey>(['idle', 'walk', 'wave', 'run'])
/** Bütçe geçiş 2 sırası (§6.3). */
const STATE_ORDER: readonly StripKey[] = ['work', 'walk', 'think', 'read', 'wait', 'done', 'fail', 'wave', 'run', 'walk_sol']

/** Vektör yedeğin rengi: türün vurgu rengi. */
const ACCENT: Readonly<Record<CharKind, string>> = {
  'pofu': '#FBA469',
  'pofu-opus': '#FBA469',
  'pofu-sonnet': '#FBA469',
  'pofu-haiku': '#FBA469',
  'pofu-boss': '#FBA469',
  'gunes': '#FFD34E',
  'dunya': '#3F8FD8',
  'ay': '#EDE8F8',
  'yildiz': '#7C6CF0',
  'kristal': '#46C9D6',
  'evren': '#E43C38',
  'diger': '#B8C0CC',
}

const KIND_OF: Readonly<Record<string, CharKind>> = {
  boss: 'pofu-boss', opus: 'pofu-opus', sonnet: 'pofu-sonnet', haiku: 'pofu-haiku', claude: 'pofu',
  sol: 'gunes', terra: 'dunya', luna: 'ay', flash: 'yildiz', argon: 'kristal', evren: 'evren', other: 'diger',
  // Kendi şeritleri çizilene dek Fable Pofu'yu, Astra dünya karakterini kullanır.
  fable: 'pofu', astra: 'dunya',
}

/** Model maskotu (logic) → karakter (tasarım §6.1). Bilinmeyen 'diger'. */
export function charKindOf(m: MascotKind): CharKind {
  return KIND_OF[m] ?? 'diger'
}

const r2 = (v: number): number => Math.round(v * 100) / 100
const r3 = (v: number): number => Math.round(v * 1000) / 1000
const escText = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ——— ölçek ve keskinlik ——————————————————————————————————————

let SCALE = 1

/** Bu çizimin px/ou ölçeği; keskin piksel için (§6.4). Sahne her çizimin başında çağırır. */
export function setCharScale(s: number): void {
  SCALE = Number.isFinite(s) && s > 0 ? s : 1
}

const sheetOf = (kind: CharKind): CharSheet => CHAR_SET[kind] ?? CHAR_SET.diger

/**
 * Kaynak pikseli başına ou. Tasarım: k = öneri × size / 43; ekranda k_px = k × s; k_px ≥ 2 tam
 * sayıya, değilse 0,5 katına (en az 1) yuvarlanır. k_px < 0,8 ise (çok küçük yedek yerleşim)
 * yuvarlanmaz: 1'e büyütmek figürü %25'ten çok büyütür ve masadan taşırırdı.
 */
function unit(sheet: CharSheet, size: number): number {
  const kp = ((sheet.scale * size) / REFERENCE_FIGURE_PX) * SCALE
  const snapped = kp >= 2 ? Math.round(kp) : kp >= 0.8 ? Math.max(1, Math.round(kp * 2) / 2) : kp

  return snapped / SCALE
}

// ——— kullanım kaydı (charDefs için) —————————————————————————————

const uses = new Map<CharKind, Map<StripKey, number>>()
let bossKind: CharKind | undefined

function note(kind: CharKind, key: StripKey, boss?: boolean): void {
  let m = uses.get(kind)
  if (!m) uses.set(kind, (m = new Map()))
  m.set(key, (m.get(key) ?? 0) + 1)
  if (boss || (kind === 'pofu-boss' && bossKind === undefined)) bossKind = kind
}

type Resolved = { key: StripKey; strip: CharStrip; fpsMul: number; mirror: boolean; state: CharState }

function resolve(kind: CharKind, sheet: CharSheet, wanted: CharState, left: boolean): Resolved {
  let state: CharState = wanted
  let fpsMul = 1
  // 'run' yalnız pofu'da var; diğerleri walk şeridini 1,5 kat hızlı oynatır
  if (state === 'run' && !sheet.states.run) {
    state = 'walk'
    fpsMul = 1.5
  }
  let key: StripKey = state
  let mirror = false
  if (left) {
    if (kind === 'evren') {
      // EVREN'in göğsündeki ay aynalanmaz: sola yürüyüşün kendi şeridi var
      if (state === 'walk' && sheet.states.walk_sol) key = 'walk_sol'
    } else {
      mirror = MIRRORABLE.has(state)
    }
  }
  if (!sheet.states[key]) key = 'idle'

  return { key, strip: sheet.states[key] as CharStrip, fpsMul, mirror, state }
}

// ——— çizim ————————————————————————————————————————————————

/**
 * (x, y) = ayak tabanı orta noktası (manifest `anker`), çağıranın biriminde (ou).
 * size = referans figür boyu (43 kaynak px) karşılığı ou; her tür kendi önerilen
 * ölçeğiyle orantılı çizilir: k = olcek_onerisi × size / 43 (ou / kaynak px), §6.4 yuvarlaması.
 * Döner: <svg x y width height viewBox="0 0 w h" overflow="hidden"><use href="#ch-<kind>-<state>" style="--sx:-<n·w>px;animation:chs <n/fps/speed>s <delay>s steps(<n>) infinite"/></svg>
 */
export function drawCharacter(kind: CharKind, state: CharState, x: number, y: number, size: number, opts: CharOpts = {}): string {
  const sheet = sheetOf(kind)
  const r = resolve(kind, sheet, state, Boolean(opts.left))
  note(kind, r.key, opts.boss)
  const k = unit(sheet, size)
  const n = r.strip.n
  const play = opts.play ?? 'loop'
  let style = ''
  if (play === 'still') {
    const f = Math.max(0, Math.min(n - 1, Math.round(opts.frame ?? 0)))
    if (f) style = `transform:translateX(-${f * sheet.w}px)`
  } else {
    const fps = r.strip.fps * r.fpsMul * Math.max(0.1, opts.speed ?? 1)
    const delay = Math.min(0, opts.delay ?? 0)
    const count = play === 'once' ? String(Math.max(1, Math.round(opts.loops ?? 1))) : 'infinite'
    style = `--sx:-${n * sheet.w}px;animation:chs ${r3(n / fps)}s ${r2(delay)}s steps(${n}) ${count}`
  }
  const crop = Math.max(0, Math.min(sheet.h - 1, Math.round(opts.cropTop ?? 0)))
  let out = `<svg x="${r2(x - sheet.ax * k)}" y="${r2(y - (sheet.ay - crop) * k)}" width="${r2(sheet.w * k)}" height="${r2((sheet.h - crop) * k)}" viewBox="0 ${crop} ${sheet.w} ${sheet.h - crop}" overflow="hidden"><use href="#ch-${kind}-${r.key}"${style ? ` style="${style}"` : ''}/></svg>`
  if (r.mirror) out = `<g transform="matrix(-1 0 0 1 ${r2(2 * x)} 0)">${out}</g>`
  if (opts.mark) out += markSvg(opts.mark, sheet, k, x, y)

  const tired = opts.tired
  if (tired) out = tiredLayer(out, sheet, k, x, y, r.state, tired, opts.delay ?? 0)
  if (opts.title) out = `<g><title>${escText(opts.title)}</title>${out}</g>`

  return out
}

/** Bitkinlik görünümü (§5.6): omuz düşer, esneme bulutu, ter damlası, yürürken çöküş. */
function tiredLayer(fig: string, sheet: CharSheet, k: number, x: number, y: number, state: CharState, tired: 1 | 2 | 3, delay: number): string {
  const walking = state === 'walk' || state === 'run'
  let out = fig
  if (walking && tired >= 3) {
    // sürünerek: ayak tabanına göre %92 boy, 2° öne eğim
    out = `<g transform="translate(${r2(x)} ${r2(y)}) rotate(2) scale(1 .92) translate(${r2(-x)} ${r2(-y)})">${out}</g>`
  } else if (!walking && tired >= 2) {
    // düşük omuz: %96 boy, 1 ou çökük (masada alt gövde zaten gizli)
    out = `<g transform="translate(0 ${r2(y * 0.04 + 1)}) scale(1 .96)">${out}</g>`
  }
  const bodyH = (sheet.ay - sheet.fig.top) * k
  const headX = x + (sheet.fig.right - sheet.ax) * k * 0.7
  const headY = y - bodyH * 0.95
  const u = Math.max(2.4, bodyH * 0.16)
  // esneme: kafanın sağ üstünde iki küçük "z" (havada yüzen göz gibi okunan oval yerine); 1. kademe 40 sn'de, 2-3. kademe 20 sn'de bir
  const period = tired === 1 ? 40 : 20
  const zee = (cx: number, cy: number, s: number) => `M${r2(cx - s)} ${r2(cy - s)}h${r2(2 * s)}l${r2(-2 * s)} ${r2(2 * s)}h${r2(2 * s)}`
  out += `<g class="chy" style="animation:chyawn ${period}s ${r2(Math.min(0, delay) * 7)}s infinite"><path d="${zee(headX + u * 0.6, headY - u * 0.2, u * 0.45)}${zee(headX + u * 1.7, headY - u * 1.3, u * 0.6)}" fill="none" stroke="#E2E8F0" stroke-width="${r2(u * 0.28)}" stroke-linejoin="round" stroke-linecap="round"/></g>`
  if (tired >= 3) {
    const dx = x + (sheet.fig.left - sheet.ax) * k * 0.55
    out += `<path d="M${r2(dx)} ${r2(headY + u)}q${r2(u * 0.55)} ${r2(u * 0.9)} 0 ${r2(u * 1.3)}q${r2(-u * 0.55)} ${r2(-u * 0.4)} 0 ${r2(-u * 1.3)}z" fill="#7DD3FC" style="animation:chsweat 2.4s ${r2(Math.min(0, delay))}s infinite"/>`
  }

  return out
}

/**
 * Etkinlik propunun bir pikselinin ou karşılığı: karakterin ekran pikseli (oynat.html: karakter
 * `olcek_onerisi` ile, prop ölçek 1 çizilir). Her kaynak pikseli 2 prop pikseli eder.
 */
export function propUnit(kind: CharKind, size: number): number {
  const sheet = sheetOf(kind)

  return unit(sheet, size) / Math.max(1, sheet.scale)
}

/** Etkinlik şapkası için baş üstündeki aksesuarın bittiği kaynak satır; yüz korunur. */
export function hatCrop(kind: CharKind): number | undefined {
  // Idle kare 0: bere 10–17, çiçek 13–17, taç 10–14; yüz aşağıda kalır.
  // Düz baş ve göz hizasındaki gözlük kırpılmaz.
  return ({ 'pofu-sonnet': 18, 'pofu-haiku': 18, 'pofu-boss': 15 } as Partial<Record<CharKind, number>>)[kind]
}

/**
 * Yerleştirme için ölçüler (ou), yuvarlanmış ölçekle: çerçeve (w, h), ayak (ax, ay; çerçeve
 * sol-üstüne göre), idle kare 0'ın görünür sınırları (top, bottom, left, right; çerçeve sol-üstüne
 * göre, right/bottom hariç sınır) ve bodyH = ay − top (ayaktan başın tepesine). Baş tepesi = y − bodyH.
 */
export function charBox(kind: CharKind, size: number): { w: number; h: number; ax: number; ay: number; top: number; bottom: number; left: number; right: number; bodyH: number } {
  const sheet = sheetOf(kind)
  const k = unit(sheet, size)

  return {
    w: r2(sheet.w * k),
    h: r2(sheet.h * k),
    ax: r2(sheet.ax * k),
    ay: r2(sheet.ay * k),
    top: r2(sheet.fig.top * k),
    bottom: r2(sheet.fig.bottom * k),
    left: r2(sheet.fig.left * k),
    right: r2(sheet.fig.right * k),
    bodyH: r2((sheet.ay - sheet.fig.top) * k),
  }
}

/** Oturan figürde masanın gizlediği boy (ou, ayaktan yukarı): yalnız bacaklar ve alt gövde. */
export function seatHide(kind: CharKind, size: number): number {
  const sheet = sheetOf(kind)
  const row = sheet.ay - Math.round((sheet.ay - sheet.fig.top) * 0.2)

  return r2(Math.max(0, sheet.ay - row) * unit(sheet, size))
}

/** Kayan yazı ve kart için: idle kare 0, sabit, baş-omuz kırpılmış; (x, y) sol-üst köşe, size × size kare. */
export function charIcon(kind: CharKind, x: number, y: number, size: number): string {
  const sheet = sheetOf(kind)
  note(kind, 'idle')
  const f = sheet.fig
  const side = Math.min(f.right - f.left, f.bottom - f.top)
  const vx = (f.left + f.right) / 2 - side / 2

  return `<svg x="${r2(x)}" y="${r2(y)}" width="${r2(size)}" height="${r2(size)}" viewBox="${r2(vx)} ${f.top} ${side} ${side}" overflow="hidden"><use href="#ch-${kind}-idle"/></svg>`
}

// ——— defs ve bütçe ———————————————————————————————————————————

function stripSymbol(kind: CharKind, key: StripKey): string {
  const sheet = sheetOf(kind)
  const strip = sheet.states[key]
  if (!strip) return ''
  const w = strip.n * sheet.w

  return `<symbol id="ch-${kind}-${key}" viewBox="0 0 ${w} ${sheet.h}" width="${w}" height="${sheet.h}"><image href="data:image/png;base64,${strip.b64}" width="${w}" height="${sheet.h}" style="image-rendering:pixelated"/></symbol>`
}

/**
 * Sığmayan durum idle kare 0'a düşer: tek karelik pencere (w × h) idle şeridini gösterir ve
 * bu sembole bakan <use>'ların kayması CSS ile durdurulur (fallbackStyle). Tasarımdaki "n adet
 * kare 0 kopyası" ile aynı görüntü, kare sayısından bağımsız ~130 karakter.
 */
function fallbackSymbol(kind: CharKind, key: StripKey): string {
  const s = sheetOf(kind)

  return `<symbol id="ch-${kind}-${key}" viewBox="0 0 ${s.w} ${s.h}" width="${s.w}" height="${s.h}"><use href="#ch-${kind}-idle"/></symbol>`
}

const fallbackSel = (kind: CharKind, key: StripKey): string => `use[href="#ch-${kind}-${key}"]`
const FALLBACK_RULE = '{animation:none!important;transform:none!important}'
const fallbackStyle = (sels: readonly string[]): string => (sels.length ? `<style>${sels.join(',')}${FALLBACK_RULE}</style>` : '')

/** Son çare: türün vurgu renginde basit figür, idle şeridiyle aynı w × h ve kare sayısında (≤ 1200 karakter). */
function vectorIdle(kind: CharKind): string {
  const s = sheetOf(kind)
  const n = s.states.idle?.n ?? 1
  const f = s.fig
  const c = ACCENT[kind]
  const bw = f.right - f.left
  const bh = Math.max(4, s.ay - f.top - 3)
  const leg = Math.max(1, Math.round(bw / 6))
  const eye = Math.max(1, Math.round(bw / 10))
  const ey = f.top + Math.round(bh * 0.4)
  const fig = `<g id="cv-${kind}"><rect x="${f.left}" y="${f.top}" width="${bw}" height="${bh}" rx="${Math.max(1, Math.round(bw / 6))}" fill="${c}" stroke="#1A1816"/><path d="M${f.left + leg} ${f.top + bh}h${leg}v3h-${leg}zM${f.right - 2 * leg} ${f.top + bh}h${leg}v3h-${leg}zM${f.left + Math.round(bw * 0.28)} ${ey}h${eye}v${eye * 2}h-${eye}zM${f.right - Math.round(bw * 0.28) - eye} ${ey}h${eye}v${eye * 2}h-${eye}z" fill="#1A1816"/></g>`
  let more = ''
  for (let i = 1; i < n; i++) more += `<use href="#cv-${kind}" x="${i * s.w}"/>`

  return `<symbol id="ch-${kind}-idle" viewBox="0 0 ${n * s.w} ${s.h}" width="${n * s.w}" height="${s.h}">${fig}${more}</symbol>`
}

const sum = (m: ReadonlyMap<StripKey, number> | undefined): number => [...(m?.values() ?? [])].reduce((a, b) => a + b, 0)

/**
 * Son çağrıdan beri çizilen (tür, durum) çiftlerinin <symbol>'leri; listeyi sıfırlar (§6.3).
 * 1. Her türün idle şeridi (patron önce, sonra çok kullanılan); sığmayan tür vektör yedeğe iner.
 *    Sonraki türlerin en ucuz idle'ı ve tüm idle'a düşüşlerin yeri ayrılır: hiçbir tür idle'sız kalmaz.
 * 2. Diğer durumlar work, walk, think, read, wait, done, fail, wave, run, walk_sol sırasıyla, her
 *    durumda türler patron önce ve kullanım sayısına göre; sığmayan durum idle kare 0'a düşer.
 * Bütçe idle'ları ve düşüşleri karşılıyorsa çıktı bütçeyi aşmaz; karşılamıyorsa yalnız zorunlu
 * en ucuz semboller yazılır. Çizimdeki her href="#ch-…" için bir id vardır.
 */
export function charDefs(budget = Infinity): string {
  const boss = bossKind
  const total = (k: CharKind) => sum(uses.get(k))
  const kinds = [...uses.keys()].sort((a, b) => Number(b === boss) - Number(a === boss) || total(b) - total(a) || a.localeCompare(b))
  const pending: Array<[CharKind, StripKey]> = []
  for (const st of STATE_ORDER) {
    const byUse = kinds.filter(k => (uses.get(k)?.get(st) ?? 0) > 0)
    byUse.sort((a, b) => Number(b === boss) - Number(a === boss) || (uses.get(b)?.get(st) ?? 0) - (uses.get(a)?.get(st) ?? 0))
    for (const k of byUse) pending.push([k, st])
  }
  uses.clear()
  bossKind = undefined

  const realIdle = kinds.map(k => stripSymbol(k, 'idle'))
  const vecIdle = kinds.map(k => vectorIdle(k))
  const cheapIdle = kinds.map((_, i) => Math.min((realIdle[i] as string).length || VECTOR_MAX, (vecIdle[i] as string).length))
  // her düşüş: pencere sembolü + stil seçicisi (+ virgül); stil kabı bir kez
  const fbLen = pending.map(([k, st]) => fallbackSymbol(k, st).length + fallbackSel(k, st).length + 1)
  const wrap = fallbackStyle(['']).length
  const mustFallback = pending.length ? fbLen.reduce((a, b) => a + b, 0) + wrap : 0

  let out = ''
  kinds.forEach((k, i) => {
    const real = realIdle[i] as string
    let reserve = mustFallback
    for (let j = i + 1; j < kinds.length; j++) reserve += cheapIdle[j] as number
    out += real && out.length + real.length + reserve <= budget ? real : (vecIdle[i] as string)
  })

  const sels: string[] = []
  pending.forEach(([k, st], i) => {
    const real = stripSymbol(k, st)
    let reserve = sels.length ? 0 : wrap
    for (let j = i + 1; j < pending.length; j++) reserve += fbLen[j] as number
    if (real && out.length + sels.join(',').length + real.length + reserve <= budget) {
      out += real
    } else {
      out += fallbackSymbol(k, st)
      sels.push(fallbackSel(k, st))
    }
  })

  return out + fallbackStyle(sels)
}

/** STYLE'a eklenir: şerit kaydırma, esneme bulutu, ter damlası. */
export const CHAR_CSS = `@keyframes chs{to{transform:translateX(var(--sx))}}
@keyframes chyawn{0%,90%{opacity:0;transform:scale(.3)}92.5%,97.5%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.7)}}
@keyframes chsweat{0%{opacity:0;transform:translateY(0)}25%{opacity:1}100%{opacity:0;transform:translateY(5px)}}
.chy{opacity:0;transform-box:fill-box;transform-origin:0 100%}
`

// ——— geçiş: 0.6 sahnesinin eski arayüzü —————————————————————————
// scene.ts ve hud.ts yeni sahneye (drawCharacter/charIcon) geçince bu bölüm silinir. Eski
// çağrıları yeni karakterlere bağlar: 40 birimlik kare (x, y sol-üst), size genişlik.

/** @deprecated geçiş */
export type MascotOpts = { motion?: 'still' | 'work' | 'once'; period?: number; delay?: number; loops?: number; frame?: 0 | 1 | 2 | 3; crop?: number; flip?: boolean }
/** @deprecated geçiş */
export const CH_FRAME = 40
/** @deprecated geçiş */
export const mascotBase = (_kind: MascotKind): number => 38
/** @deprecated geçiş */
export const mascotTop = (_kind: MascotKind): number => 6
/** @deprecated geçiş */
export const mascotHead = (_kind: MascotKind): number => 10
/** @deprecated geçiş */
export function mascot(kind: MascotKind, x: number, y: number, size: number, opts: MascotOpts = {}): string {
  const motion = opts.motion ?? 'still'
  const state: CharState = motion === 'work' ? 'work' : motion === 'once' ? 'done' : 'idle'
  const foot = y + (size * Math.min(CH_FRAME, opts.crop ?? 38)) / CH_FRAME

  return drawCharacter(charKindOf(kind), state, x + size / 2, foot, size * 0.85, {
    play: motion === 'still' ? 'still' : motion === 'once' ? 'once' : 'loop',
    delay: opts.delay,
    loops: opts.loops,
    left: opts.flip,
  })
}
/** @deprecated geçiş */
export function mascotIcon(kind: MascotKind, x: number, y: number, size: number): string {
  return charIcon(charKindOf(kind), x, y, size)
}
