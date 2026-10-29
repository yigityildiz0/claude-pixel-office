// Pure rules: what a tool call, a thought or a site means for the office.
import type { Activity, FeedKind, SiteKind, ThinkKind } from '../types'

export const TEAM_COLORS = [
  // mid tones that read on graphite and on ivory alike: clay, sky, heather, rose,
  // sage, teal, ochre, rust (Claude's warm palette, widened for a team)
  '#D97757',
  '#5B8FC7',
  '#9883C4',
  '#C9638A',
  '#7E9F4F',
  '#3E9AA8',
  '#C99234',
  '#B4694A',
]

const NAMES = [
  'Ada', 'Can', 'Ece', 'Mert', 'Deniz', 'Zeynep', 'Kaan', 'Elif', 'Arda', 'Nil',
  'Emre', 'Su', 'Bora', 'Defne', 'Efe', 'İpek', 'Tuna', 'Lara', 'Ozan', 'Mira',
]

export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pick<T>(list: readonly T[], seed: string): T {
  return list[hash(seed) % list.length] as T
}

export function nameFor(index: number): string {
  const base = NAMES[index % NAMES.length] as string
  const round = Math.floor(index / NAMES.length)
  return round === 0 ? base : `${base} ${round + 1}`
}

export function roleFor(type: string, isFork = false, isWorkflow = false): string {
  if (isFork) return 'Klon'
  if (isWorkflow) return 'İş akışı'
  const known: Record<string, string> = {
    'general-purpose': 'Genel',
    Explore: 'Kâşif',
    Plan: 'Planlamacı',
    yigit_quick: 'Hızlı',
    yigit_balanced: 'Dengeli',
    yigit_deep: 'Derin',
    'claude-code-guide': 'Rehber',
    'web-search-agent': 'Araştırmacı',
    claude: 'Genel',
  }
  if (known[type]) return known[type] as string
  const tail = type.split(':').pop() ?? type

  return tail.length > 16 ? tail.slice(0, 15) + '…' : tail
}

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? one.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : one
}

export function baseName(path: unknown): string {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.split(/[\\/]/).filter(Boolean)

  return parts[parts.length - 1] ?? path
}

export function siteOf(text: string): SiteKind {
  const t = text.toLowerCase()
  if (/youtube\.com|youtu\.be|\byoutube\b/.test(t)) return 'youtube'
  if (/reddit\.com|\breddit\b/.test(t)) return 'reddit'
  if (/(^|[/.\s])(x\.com|twitter\.com)|\btwitter\b|\btweet/.test(t)) return 'x'
  if (/wikipedia\.org|\bwiki/.test(t)) return 'wiki'
  if (/github\.com|\bgithub\b|gitlab/.test(t)) return 'github'
  if (/stackoverflow|stackexchange/.test(t)) return 'stack'
  if (/arxiv|pubmed|ncbi|doi\.org|scholar|semantic ?scholar|\.edu\b/.test(t)) return 'paper'
  if (/anthropic\.com|claude\.ai|claude\.com/.test(t)) return 'claude'
  if (/docs?\.|developer\.|\/docs\/|readthedocs|mdn|learn\.microsoft/.test(t)) return 'docs'
  if (/google\./.test(t)) return 'google'

  return 'web'
}

export const SITE_LABEL: Record<SiteKind, string> = {
  youtube: 'YouTube',
  reddit: 'Reddit',
  x: 'X',
  wiki: 'Vikipedi',
  github: 'GitHub',
  stack: 'Stack Overflow',
  google: 'Google',
  docs: 'Doküman',
  paper: 'Makale',
  claude: 'Anthropic',
  web: 'Web',
}

export type ToolReading = {
  activity: Activity
  feed: FeedKind
  bubble: string
  detail: string
  site?: SiteKind
  label: string
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Reads one tool call as a Turkish desk activity. `detail` is the plain line the
 * feed shows: a verb and at most a file name, never a raw command or a path.
 */
export function readTool(tool: string, input: Record<string, unknown>): ToolReading {
  const path = str(input.file_path) || str(input.notebook_path) || str(input.path)
  const file = clip(baseName(path), 28)
  const url = str(input.url)
  const short = tool.startsWith('mcp__') ? tool.split('__').slice(-1)[0] ?? tool : tool
  const said = (verb: string, what = '') => (what ? `${verb} · ${what}` : verb)

  switch (tool) {
    case 'Read':
      return { activity: 'reading', feed: 'read', label: 'Okuma', bubble: `Okuyorum: ${file}`, detail: said('okudu', file) }
    case 'Grep':
      return { activity: 'reading', feed: 'read', label: 'Arama', bubble: 'Dosyalarda arıyorum', detail: 'dosyalarda aradı' }
    case 'Glob':
      return { activity: 'reading', feed: 'read', label: 'Dosya bulma', bubble: 'Dosya arıyorum', detail: 'dosya aradı' }
    case 'Edit':
    case 'MultiEdit':
      return { activity: 'writing', feed: 'write', label: 'Düzenleme', bubble: `Düzenliyorum: ${file}`, detail: said('düzenledi', file) }
    case 'Write':
      return { activity: 'writing', feed: 'write', label: 'Yazma', bubble: `Yazıyorum: ${file}`, detail: said('yazdı', file) }
    case 'NotebookEdit':
      return { activity: 'writing', feed: 'write', label: 'Not defteri', bubble: `Not defteri: ${file}`, detail: said('not defterini düzenledi', file) }
    case 'Bash':
    case 'PowerShell': {
      // the call's own one-line description reads as a sentence; the command itself never shows
      const what = clip(str(input.description), 34)

      return { activity: 'running', feed: 'run', label: 'Komut', bubble: what ? `Komut: ${clip(what, 26)}` : 'Komut çalıştırıyorum', detail: said('komut çalıştırdı', what) }
    }
    case 'Monitor':
      return { activity: 'running', feed: 'run', label: 'İzleme', bubble: 'Süreci izliyorum', detail: 'süreci izliyor' }
    case 'WebSearch': {
      const query = str(input.query)
      const site = siteOf(`${query} ${(input.allowed_domains as string[] | undefined)?.join(' ') ?? ''}`)

      return { activity: 'web', feed: 'web', site: site === 'web' ? 'google' : site, label: 'Web araması', bubble: `Arıyorum: ${clip(query, 26)}`, detail: said('web’de aradı', clip(query, 30)) }
    }
    case 'WebFetch':
      return { activity: 'web', feed: 'web', site: siteOf(url), label: 'Sayfa okuma', bubble: `${SITE_LABEL[siteOf(url)]} okuyorum`, detail: `${SITE_LABEL[siteOf(url)]} sayfası okudu` }
    case 'Agent':
    case 'Task':
      return { activity: 'delegating', feed: 'hire', label: 'Görevlendirme', bubble: `Görev veriyorum: ${clip(str(input.description), 24)}`, detail: said('görev verdi', clip(str(input.description), 32)) }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'EnterPlanMode':
    case 'ExitPlanMode':
    case 'mcp__ccd_turn__update_plan':
      return { activity: 'planning', feed: 'plan', label: 'Plan', bubble: 'Planı tahtaya yazıyorum', detail: 'planı güncelledi' }
    case 'AskUserQuestion':
      return { activity: 'waiting', feed: 'wait', label: 'Soru', bubble: 'Sana bir sorum var!', detail: 'sana soru sordu' }
    case 'Skill':
      return { activity: 'reading', feed: 'read', label: 'Beceri', bubble: `Beceri: ${clip(str(input.skill), 22)}`, detail: said('beceri yükledi', clip(str(input.skill), 26)) }
    case 'ToolSearch':
      return { activity: 'reading', feed: 'read', label: 'Araç kutusu', bubble: 'Araç kutusunu karıştırıyorum', detail: 'araç kutusuna baktı' }
    case 'Artifact':
      return { activity: 'writing', feed: 'write', label: 'Yapıt', bubble: 'Yapıtı yayınlıyorum', detail: 'yapıt yayınladı' }
  }

  if (/browser|chrome|playwright|navigate|computer/i.test(tool)) {
    const site = siteOf(url || str(input.text) || str(input.query))

    return { activity: 'web', feed: 'web', site, label: 'Tarayıcı', bubble: url ? `${SITE_LABEL[site]} açıyorum` : 'Tarayıcıyı kullanıyorum', detail: url ? `${SITE_LABEL[site]} açtı` : 'tarayıcı kullandı' }
  }

  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1] ?? 'mcp'
    const name = server.length > 20 || /^[0-9a-f-]{20,}$/i.test(server) ? short : server
    const isWeb = /search|fetch|scrape|research|consensus|pubmed|context7|docs/i.test(tool)

    return { activity: isWeb ? 'web' : 'running', feed: isWeb ? 'web' : 'run', site: isWeb ? siteOf(tool) : undefined, label: 'Bağlayıcı', bubble: `${clip(name, 16)} kullanıyorum`, detail: `${clip(name, 22)} kullandı` }
  }

  return { activity: 'running', feed: 'run', label: 'Araç', bubble: `${clip(tool, 20)} kullanıyorum`, detail: `${clip(tool, 24)} kullandı` }
}

const THINK_RULES: Array<[ThinkKind, RegExp]> = [
  ['debug', /\b(error|bug|fail|failing|broken|crash|exception|fix|wrong|hata|bozuk|çalışmıyor|düzelt|neden olmuyor)\b/i],
  ['plan', /\b(plan|steps?|first|then|next|approach|strategy|outline|önce|sonra|adım|yaklaşım|strateji)\b/i],
  ['research', /\b(search|research|source|docs?|documentation|look up|find out|araştır|kaynak|doküman|bul)\w*/i],
  ['design', /\b(design|layout|ui|ux|color|colour|palette|font|style|tasarım|renk|yerleşim|görünüm)\b/i],
  ['decide', /\b(should i|whether|alternatively|instead|trade-?off|option|decide|karar|belki|yoksa|seçenek)\b/i],
  ['math', /\b(calculate|compute|sum|percent|estimate|tokens?|\d+\s*[x*×/+-]\s*\d+|hesapla|yüzde)\b/i],
  ['code', /\b(function|implement|code|class|type|module|hook|refactor|kod|fonksiyon|yaz)\w*/i],
]

/** The kind of thought the latest thinking text shows: most clues, the newest breaking a tie. */
export function thinkKind(text: string): ThinkKind {
  const tail = text.slice(-600)
  const scores: Array<[ThinkKind, number, number]> = []
  let lastAt = -1
  for (const [kind, rule] of THINK_RULES) {
    const global = new RegExp(rule.source, 'gi')
    let match: RegExpExecArray | null
    let count = 0
    let last = -1
    while ((match = global.exec(tail)) !== null) {
      count++
      last = match.index
    }
    if (count > 0) scores.push([kind, count, last])
    lastAt = Math.max(lastAt, last)
  }
  let best: ThinkKind = 'general'
  let bestScore = 0
  for (const [kind, count, last] of scores) {
    const score = count + (last === lastAt ? 0.5 : 0)
    if (score > bestScore) {
      bestScore = score
      best = kind
    }
  }

  return best
}

export const THINK_LABEL: Record<ThinkKind, string> = {
  plan: 'Planlıyor',
  debug: 'Hata avında',
  research: 'Araştırmayı kurguluyor',
  design: 'Tasarlıyor',
  decide: 'Karar veriyor',
  code: 'Kodu kurguluyor',
  math: 'Hesaplıyor',
  general: 'Düşünüyor',
}

/** The last whole sentence of a thinking text, short enough for a bubble. */
export function thoughtGist(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  const sentences = flat.split(/(?<=[.!?:])\s+/).filter(s => s.length > 8)
  const last = sentences.length > 1 ? sentences[sentences.length - 2] ?? '' : sentences[0] ?? flat

  return clip(last, max)
}

export const QUIPS = {
  hello: [
    'Merhaba patron! Hemen başlıyorum.',
    'Kahvemi aldım, işe koyuluyorum.',
    'Görev bende, merak etme.',
    'Masam hazır, başlıyorum!',
    'İlk günüm, heyecanlıyım!',
  ],
  done: ['Rapor masanızda!', 'Tamamdır, teslim!', 'İş bitti patron.', 'Hepsi hazır!', 'Görev tamam ✓'],
  fail: ['Bir sorun çıktı…', 'Takıldım patron.', 'Bu iş olmadı…'],
  idle: ['Kahve molası.', 'Sıradaki işi bekliyorum.', 'Ofis sakin.', 'Hazırım, ne yapalım?'],
  compact: ['Masayı topluyorum…', 'Evrakları arşivliyorum.', 'Bağlamı sıkıştırıyorum.'],
  turn: ['Yeni iş geldi!', 'Hemen bakıyorum.', 'Anladım, başlıyorum.'],
}

export function limitLabel(kind: string): string {
  const known: Record<string, string> = {
    five_hour: '5 saat',
    seven_day: 'Haftalık',
    seven_day_opus: 'Haftalık Opus',
    seven_day_sonnet: 'Haftalık Sonnet',
    spend_limit: 'Harcama',
  }

  return known[kind] ?? kind.replace(/_/g, ' ')
}

export function fmtTokens(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(n >= 100_000 ? 0 : 1) + 'k'

  return String(Math.round(n))
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}sn`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}dk ${s % 60}sn`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}sa ${m % 60}dk`

  return `${Math.floor(h / 24)}g ${h % 24}sa`
}

/** Istanbul wall time (UTC+3 all year) for a clock-reading `now`. */
export function istanbul(now: number): { h: number; m: number; s: number; text: string } {
  const d = new Date(now + 3 * 3600_000)
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const s = d.getUTCSeconds()
  const pad = (n: number) => String(n).padStart(2, '0')

  return { h, m, s, text: `${pad(h)}:${pad(m)}:${pad(s)}` }
}

export function resetIn(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''

  return fmtDuration(at - now).replace(/ \d+sn$/, '')
}

export function level(pct: number | undefined): { color: string; word: string } {
  if (pct === undefined) return { color: '#64748B', word: 'bilinmiyor' }
  if (pct >= 85) return { color: '#EF4444', word: 'kritik' }
  if (pct >= 60) return { color: '#F59E0B', word: 'dikkat' }

  return { color: '#22C55E', word: 'rahat' }
}
