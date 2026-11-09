// Pure rules: what a tool call, a thought or a site means for the office.
import type { Activity, Duty, FeedKind, MascotKind, Progress, Screen, SiteKind, ThinkKind, Usage, Worker } from '../types'

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

/** A desk's identity by hire order: 'Ajan 1', 'Ajan 2', … (never reused in a session). */
export function nameFor(index: number): string {
  return `Ajan ${Math.max(0, Math.floor(index)) + 1}`
}

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
  messaging: 'Mesaj gönderiyor',
  waiting: 'Seni bekliyor',
  compacting: 'Bağlamı sıkıştırıyor',
  done: 'Bitirdi',
  failed: 'Hata',
  leaving: 'Çıkıyor',
}

export function activityLabel(w: Pick<Worker, 'activity' | 'think'>): string {
  return w.activity === 'thinking' && w.think ? THINK_LABEL[w.think] : ACTIVITY_LABEL[w.activity]
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** One decimal, for SVG numbers. */
export const n1 = (v: number): number => Math.round(v * 10) / 10

export function roleFor(type: string, isFork = false, isWorkflow = false): string {
  if (isFork) return 'Klon'
  if (isWorkflow) return 'İş akışı'
  const known: Record<string, string> = {
    'general-purpose': 'Genel',
    Explore: 'Kâşif',
    Plan: 'Planlamacı',
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
  if (/claude\.ai|claude\.com/.test(t)) return 'claude'
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
  claude: 'Claude',
  web: 'Web',
}

/** A monitor reading before its time stamp: what readTool and the chunk watcher hand the desk. */
export type ScreenSpec = Omit<Screen, 'at'>

export type ToolReading = {
  activity: Activity
  feed: FeedKind
  bubble: string
  detail: string
  site?: SiteKind
  label: string
  /** what the desk's monitor shows for this call: a file name, a command kind, a site; never the raw input */
  screen: ScreenSpec
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const PATH_WORD = /^["'(]?(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])\S*$|^\S*[\\/]\S*$/

/** A search query or a pattern as a monitor shows it: a path-looking word as its last part, short. */
export function safeQuery(text: unknown, max = 26): string {
  if (typeof text !== 'string') return ''
  const flat = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => (PATH_WORD.test(word) ? baseName(word.replace(/^["'(]+|["'),.:;]+$/g, '')) : word))
    .join(' ')

  return clip(flat, max)
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
  const fileScreen = (kind: 'file-read' | 'file-write', fallback: string): ScreenSpec => ({ kind, label: file || fallback })

  switch (tool) {
    case 'Read':
      return { activity: 'reading', feed: 'read', label: 'Okuma', bubble: `Okuyorum: ${file}`, detail: said('okudu', file), screen: fileScreen('file-read', 'Dosya') }
    case 'Grep':
      return { activity: 'reading', feed: 'read', label: 'Arama', bubble: 'Dosyalarda arıyorum', detail: 'dosyalarda aradı', screen: { kind: 'search', label: safeQuery(input.pattern) || 'Arama' } }
    case 'Glob':
      return { activity: 'reading', feed: 'read', label: 'Dosya bulma', bubble: 'Dosya arıyorum', detail: 'dosya aradı', screen: { kind: 'search', label: safeQuery(input.pattern) || 'Dosya bulma' } }
    case 'Edit':
    case 'MultiEdit':
      return { activity: 'writing', feed: 'write', label: 'Düzenleme', bubble: `Düzenliyorum: ${file}`, detail: said('düzenledi', file), screen: fileScreen('file-write', 'Dosya') }
    case 'Write':
      return { activity: 'writing', feed: 'write', label: 'Yazma', bubble: `Yazıyorum: ${file}`, detail: said('yazdı', file), screen: fileScreen('file-write', 'Yeni dosya') }
    case 'NotebookEdit':
      return { activity: 'writing', feed: 'write', label: 'Not defteri', bubble: `Not defteri: ${file}`, detail: said('not defterini düzenledi', file), screen: fileScreen('file-write', 'Not defteri') }
    case 'Bash':
    case 'PowerShell': {
      // a codex / gemini / agy CLI run is a job handed to an outside worker
      const ext = readExternal(str(input.command))
      if (ext) {
        const who = ext.cli === 'evren' || ext.profile === 'evren' ? 'EVREN' : modelLabel(ext.model ?? EXT_DEFAULT_MODEL[ext.cli])

        return { activity: 'delegating', feed: 'ext', label: 'Dış işçi', bubble: `${who} işe koşuldu`, detail: 'dış işçiye görev verdi', screen: { kind: 'ext', label: who } }
      }
      // the call's own one-line description reads as a sentence; the command itself never shows
      const what = clip(str(input.description), 34)

      return { activity: 'running', feed: 'run', label: 'Komut', bubble: what ? `Komut: ${clip(what, 26)}` : 'Komut çalıştırıyorum', detail: said('komut çalıştırdı', what), screen: { kind: 'cmd', label: cmdKind(str(input.command)) } }
    }
    case 'Monitor':
      return { activity: 'running', feed: 'run', label: 'İzleme', bubble: 'Süreci izliyorum', detail: 'süreci izliyor', screen: { kind: 'cmd', label: 'izleme' } }
    case 'WebSearch': {
      const query = str(input.query)
      const found = siteOf(`${query} ${(input.allowed_domains as string[] | undefined)?.join(' ') ?? ''}`)
      const site = found === 'web' ? 'google' : found

      return { activity: 'web', feed: 'web', site, label: 'Web araması', bubble: `Arıyorum: ${clip(query, 26)}`, detail: said('web’de aradı', clip(query, 30)), screen: { kind: 'search', label: safeQuery(query) || 'Web araması', site } }
    }
    case 'WebFetch': {
      const site = siteOf(url)

      return { activity: 'web', feed: 'web', site, label: 'Sayfa okuma', bubble: `${SITE_LABEL[site]} okuyorum`, detail: `${SITE_LABEL[site]} sayfası okudu`, screen: { kind: 'site', label: SITE_LABEL[site], site } }
    }
    case 'Agent':
    case 'Task':
      return { activity: 'delegating', feed: 'hire', label: 'Görevlendirme', bubble: `Görev veriyorum: ${clip(str(input.description), 24)}`, detail: said('görev verdi', clip(str(input.description), 32)), screen: { kind: 'msg', label: clip(talkText(undefined, input.description), 26) || 'Yeni görev' } }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'EnterPlanMode':
    case 'ExitPlanMode':
    case 'mcp__ccd_turn__update_plan':
      return { activity: 'planning', feed: 'plan', label: 'Plan', bubble: 'Planı tahtaya yazıyorum', detail: 'planı güncelledi', screen: { kind: 'plan', label: 'Plan' } }
    case 'SendMessage': {
      const to = String(input.to ?? '')
      const name = /^[\p{L}\p{N} _.@-]{1,40}$/u.test(to) && !/^session_/i.test(to) ? clip(to.replace(/@.*$/, ''), 16) : 'başka oturum'

      return { activity: 'messaging', feed: 'talk', label: 'Mesaj', bubble: `Mesaj: ${clip(to, 16)}`, detail: 'mesaj gönderdi', screen: { kind: 'msg', label: name || 'Mesaj' } }
    }
    case 'AskUserQuestion':
      return { activity: 'waiting', feed: 'wait', label: 'Soru', bubble: 'Sana bir sorum var!', detail: 'sana soru sordu', screen: { kind: 'wait', label: 'Soru' } }
    case 'Skill':
      return { activity: 'reading', feed: 'read', label: 'Beceri', bubble: `Beceri: ${clip(str(input.skill), 22)}`, detail: said('beceri yükledi', clip(str(input.skill), 26)), screen: { kind: 'file-read', label: clip(baseName(str(input.skill)), 28) || 'Beceri' } }
    case 'ToolSearch':
      return { activity: 'reading', feed: 'read', label: 'Araç kutusu', bubble: 'Araç kutusunu karıştırıyorum', detail: 'araç kutusuna baktı', screen: { kind: 'search', label: safeQuery(input.query) || 'Araç kutusu' } }
    case 'Artifact':
      return { activity: 'writing', feed: 'write', label: 'Yapıt', bubble: 'Yapıtı yayınlıyorum', detail: 'yapıt yayınladı', screen: { kind: 'file-write', label: file || 'Yapıt' } }
  }

  if (/browser|chrome|playwright|navigate|computer/i.test(tool)) {
    const site = siteOf(url || str(input.text) || str(input.query))

    return { activity: 'web', feed: 'web', site, label: 'Tarayıcı', bubble: url ? `${SITE_LABEL[site]} açıyorum` : 'Tarayıcıyı kullanıyorum', detail: url ? `${SITE_LABEL[site]} açtı` : 'tarayıcı kullandı', screen: { kind: 'site', label: url ? SITE_LABEL[site] : 'Tarayıcı', site } }
  }

  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1] ?? 'mcp'
    const name = server.length > 20 || /^[0-9a-f-]{20,}$/i.test(server) ? short : server
    const isWeb = /search|fetch|scrape|research|consensus|pubmed|context7|docs/i.test(tool)
    const site = isWeb ? siteOf(tool) : undefined

    return { activity: isWeb ? 'web' : 'running', feed: isWeb ? 'web' : 'run', site, label: 'Bağlayıcı', bubble: `${clip(name, 16)} kullanıyorum`, detail: `${clip(name, 22)} kullandı`, screen: isWeb ? { kind: 'site', label: clip(name, 18), site } : { kind: 'tool', label: clip(name, 18) } }
  }

  return { activity: 'running', feed: 'run', label: 'Araç', bubble: `${clip(tool, 20)} kullanıyorum`, detail: `${clip(tool, 24)} kullandı`, screen: { kind: 'tool', label: clip(tool, 18) } }
}

// —— command kinds: one white-listed word for a shell command, never its arguments ——

const CMD_SKIP = /^(?:cd|pushd|popd|set|export|setlocal|chcp|\$env:\S*|env|sudo|time|nohup|call|exec|\.)$/i
const PKG_RUN = new Set(['test', 'build', 'lint', 'dev', 'start', 'typecheck'])
const PKG_INSTALL = new Set(['install', 'i', 'ci', 'add'])
const GIT_SUB = new Set(['status', 'diff', 'log', 'commit', 'push', 'pull', 'checkout', 'add', 'merge', 'rebase'])
const BUILD_SUB = new Set(['build', 'test', 'run'])

/** The words of one shell command, quotes stripped, no further than its first separator. */
function commandWords(segment: string): string[] {
  const out: string[] = []
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')

  return out
}

/**
 * What a shell command does, as one white-listed word ("npm test", "git commit", "silme"):
 * the first meaningful command of the line; arguments, paths and quoted text never come back.
 */
export function cmdKind(command: unknown): string {
  if (typeof command !== 'string' || command.trim() === '') return 'komut'
  const segments = command.split(/&&|\|\||[;|\n]|&(?!\S)/)
  for (const segment of segments) {
    let words = commandWords(segment.trim())
    // a PowerShell call operator and an environment assignment are not the command
    while (words.length > 0 && (words[0] === '&' || /^[A-Za-z_][\w]*=/.test(words[0] as string))) words = words.slice(1)
    if (words.length === 0) continue
    const head = words[0] as string
    if (CMD_SKIP.test(head)) continue
    const cmd = (baseName(head).replace(/\.(exe|cmd|bat|ps1)$/i, '') || head).toLowerCase()
    const rest = words.slice(1).map(w => w.toLowerCase())
    const firstPlain = rest.find(w => !w.startsWith('-'))
    switch (cmd) {
      case 'npm':
      case 'pnpm':
      case 'yarn':
      case 'bun':
      case 'npx': {
        if (cmd === 'npx') {
          const tool = rest.find(w => !w.startsWith('-')) ?? ''
          const name = baseName(tool).replace(/@[\d.^~]*$/, '')
          if (['tsc', 'jest', 'vitest', 'mocha', 'tsx', 'eslint', 'prettier'].includes(name)) return name
          return 'npx'
        }
        let sub = firstPlain ?? ''
        if (sub === 'run' || sub === 'run-script') sub = rest.filter(w => !w.startsWith('-'))[1] ?? ''
        if (PKG_RUN.has(sub)) return `${cmd} ${sub}`
        if (PKG_INSTALL.has(sub) || (cmd === 'yarn' && sub === '')) return 'kurulum'
        return cmd
      }
      case 'git':
        return firstPlain && GIT_SUB.has(firstPlain) ? `git ${firstPlain}` : 'git'
      case 'python':
      case 'python3':
      case 'py': {
        const at = rest.indexOf('-m')
        if (at >= 0 && rest[at + 1] === 'pytest') return 'pytest'
        if (at >= 0 && rest[at + 1] === 'pip') return 'kurulum'
        return 'python'
      }
      case 'uv':
        return rest.includes('pytest') ? 'pytest' : 'python'
      case 'pip':
      case 'pip3':
        return 'kurulum'
      case 'node':
      case 'tsx':
      case 'ts-node':
      case 'deno':
        return 'node'
      case 'tsc':
        return 'tsc'
      case 'pytest':
      case 'jest':
      case 'vitest':
      case 'mocha':
        return cmd
      case 'cargo':
      case 'go':
        return firstPlain && BUILD_SUB.has(firstPlain) ? `${cmd} ${firstPlain}` : cmd
      case 'docker':
        return 'docker'
      case 'curl':
      case 'wget':
      case 'invoke-webrequest':
      case 'iwr':
        return 'indirme'
      case 'ls':
      case 'dir':
      case 'get-childitem':
      case 'gci':
      case 'tree':
        return 'listeleme'
      case 'cat':
      case 'type':
      case 'get-content':
      case 'gc':
      case 'head':
      case 'tail':
      case 'less':
        return 'okuma'
      case 'rm':
      case 'del':
      case 'remove-item':
      case 'rmdir':
      case 'rd':
        return 'silme'
      case 'mkdir':
      case 'cp':
      case 'mv':
      case 'copy':
      case 'move':
      case 'copy-item':
      case 'move-item':
      case 'new-item':
      case 'ren':
      case 'rename-item':
        return 'dosya işi'
      case 'grep':
      case 'rg':
      case 'findstr':
      case 'select-string':
      case 'find':
        return 'arama'
      case 'claude':
        return 'claude'
      default:
        return 'komut'
    }
  }

  return 'komut'
}

/** A TodoWrite call's progress: items completed out of all (undefined without a list). */
export function planOf(input: Record<string, unknown>): Progress | undefined {
  const todos = input.todos
  if (!Array.isArray(todos) || todos.length === 0) return undefined
  const done = todos.filter(t => t !== null && typeof t === 'object' && (t as { status?: unknown }).status === 'completed').length

  return { done, total: todos.length }
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

  // whole minutes, rounded up: the text changes once a minute, not on every redraw
  return fmtDuration(Math.ceil((at - now) / 60_000) * 60_000).replace(/ \d+sn$/, '')
}

// —— limit forecast ——————————————————————————————————————————

/** A limit reading at a moment: [time ms, percent used]. */
export type Sample = [number, number]

export type Forecast = {
  /** percent per hour, at the recent pace; undefined when too few readings */
  rate?: number
  /** when the limit fills at that pace, if before its reset */
  fullAt?: number
  /** the percent it would show at reset, if it does not fill first */
  atReset?: number
  resetAt?: number
  /** a short sentence for the HUD */
  line: string
  tone: 'ok' | 'warn' | 'bad' | 'idle'
}

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

/**
 * How fast a limit is filling and when it would be full. The pace is the slope of
 * the recent readings (the last hour for the 5-hour limit, the last day for the week),
 * blended with the average since the window opened, so one burst does not swing it.
 */
export function forecast(kind: string, pct: number, resetsAt: string | undefined, samples: readonly Sample[], now: number): Forecast {
  const resetAt = resetsAt ? Date.parse(resetsAt) : NaN
  const hasReset = Number.isFinite(resetAt) && resetAt > now
  const span = WINDOW_MS[kind] ?? WINDOW_MS.seven_day as number
  const isFive = kind === 'five_hour'
  const recentMs = isFive ? 60 * 60_000 : 48 * 3_600_000
  // the week's slope only once its readings span a day: hours of work alone overstate a week
  const minDt = isFive ? 4 * 60_000 : 20 * 3_600_000
  const pts = samples.filter(([t]) => t >= now - recentMs && t <= now + 60_000)
  let slope: number | undefined
  if (pts.length >= 2) {
    const t0 = (pts[0] as Sample)[0]
    const dt = (pts[pts.length - 1] as Sample)[0] - t0
    if (dt >= minDt) {
      // least squares, in percent per hour
      const xs = pts.map(([t]) => (t - t0) / 3_600_000)
      const ys = pts.map(([, p]) => p)
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length
      const my = ys.reduce((a, b) => a + b, 0) / ys.length
      let num = 0
      let den = 0
      xs.forEach((x, i) => {
        num += (x - mx) * ((ys[i] as number) - my)
        den += (x - mx) ** 2
      })
      if (den > 0) slope = Math.max(0, num / den)
    }
  }
  // the average since this window opened (the reset less the window's length)
  let average: number | undefined
  if (hasReset) {
    const opened = resetAt - span
    const hours = (now - opened) / 3_600_000
    // at least half an hour (5-hour) or a whole day (week) under the average
    if (hours > (isFive ? 0.1 : 0.5)) average = pct / Math.max(hours, isFive ? 0.5 : 24)
  }
  const rate = slope !== undefined && average !== undefined ? 0.65 * slope + 0.35 * average : slope ?? average
  if (!hasReset) return { rate, line: pct > 0 ? 'sıfırlanma zamanı bilinmiyor' : 'ilk mesajla başlar', tone: 'idle' }
  if (rate === undefined) return { resetAt, line: `sıfırlanma ${resetIn(resetsAt, now)} sonra · hız ölçülüyor`, tone: 'idle' }
  if (rate < 0.05) return { rate, resetAt, atReset: pct, line: `sabit · sıfırlanma ${resetIn(resetsAt, now)} sonra`, tone: 'ok' }
  const hoursLeft = (resetAt - now) / 3_600_000
  const atReset = pct + rate * hoursLeft
  if (atReset >= 100) {
    const fullAt = now + ((100 - pct) / rate) * 3_600_000
    const early = fmtDuration(resetAt - fullAt).replace(/ \d+sn$/, '')
    const at = isFive ? istanbul(fullAt).text.slice(0, 5) : dayTime(fullAt)

    return { rate, resetAt, fullAt, line: `bu hızla ${at}'de dolar · sıfırlanmadan ${early} önce`, tone: 'bad' }
  }
  const tone = atReset >= 85 ? 'warn' : 'ok'

  return { rate, resetAt, atReset, line: `yenilenmede tahmini ≈%${Math.round(atReset)} · ${resetIn(resetsAt, now)} sonra`, tone }
}

const GUN = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']

/** "Sal 14:20" in Istanbul time. */
export function dayTime(t: number): string {
  const d = new Date(t + 3 * 3_600_000)

  return `${GUN[d.getUTCDay()]} ${istanbul(t).text.slice(0, 5)}`
}

/** Today's date in Istanbul, YYYY-MM-DD: the key the day's cost is kept under. */
export function dayKey(t: number): string {
  return new Date(t + 3 * 3_600_000).toISOString().slice(0, 10)
}

/** Adds a reading, keeping the list short and only what moved (or every 5 minutes). */
export function withSample(list: readonly Sample[] | undefined, t: number, pct: number): Sample[] {
  const all = (list ?? []).filter(([at]) => at < t)
  const last = all[all.length - 1]
  if (last && Math.abs(last[1] - pct) < 0.5 && t - last[0] < 5 * 60_000) return all.slice()

  return [...all, [t, Math.round(pct * 10) / 10] as Sample].slice(-80)
}

export function level(pct: number | undefined): { color: string; word: string } {
  if (pct === undefined) return { color: '#64748B', word: 'bilinmiyor' }
  if (pct >= 85) return { color: '#EF4444', word: 'kritik' }
  if (pct >= 60) return { color: '#F59E0B', word: 'dikkat' }

  return { color: '#22C55E', word: 'rahat' }
}


// —— models, mascots and duties ——————————————————————————————

export type MascotFamily = 'Claude' | 'GPT' | 'Gemini' | 'EVREN' | 'Diğer'

export const MASCOT_INFO: Readonly<Record<MascotKind, { label: string; family: MascotFamily; accent: string; creature: string }>> = {
  opus: { label: 'Opus', family: 'Claude', accent: '#E8774F', creature: 'Pofu' },
  sonnet: { label: 'Sonnet', family: 'Claude', accent: '#E5672E', creature: 'Pofu' },
  haiku: { label: 'Haiku', family: 'Claude', accent: '#EFA27E', creature: 'Pofu' },
  fable: { label: 'Fable', family: 'Claude', accent: '#C9774F', creature: 'Pofu' },
  claude: { label: 'Claude', family: 'Claude', accent: '#D97757', creature: 'Pofu' },
  sol: { label: 'Sol', family: 'GPT', accent: '#3ED598', creature: 'güneş' },
  terra: { label: 'Terra', family: 'GPT', accent: '#3B7DDD', creature: 'dünya' },
  luna: { label: 'Luna', family: 'GPT', accent: '#6FD6CF', creature: 'ay' },
  astra: { label: 'Astra', family: 'GPT', accent: '#8B7BEA', creature: 'dünya' },
  argon: { label: 'Argon', family: 'Gemini', accent: '#7B8CEB', creature: 'kristal canavar' },
  flash: { label: 'Flash', family: 'Gemini', accent: '#3C8DEB', creature: 'yıldız' },
  evren: { label: 'EVREN', family: 'EVREN', accent: '#E03A3E', creature: 'ay-yıldız robot' },
  other: { label: 'Model', family: 'Diğer', accent: '#6F8FB8', creature: 'çakıl' },
  boss: { label: 'Patron', family: 'Claude', accent: '#D97757', creature: 'taçlı Pofu' },
}

const GPT_NAME = /(^|[^a-z])(sol|terra|luna|astra)([^a-z]|$)/

/**
 * The mascot of a model id. 'flash' reads as Gemini Flash only inside a Gemini name
 * (deepseek-…-flash and qwen…-flash are other models). The boss keeps the crowned Pofu
 * unless it runs on another family. An effort suffix (agy's `-high`) is not part of the name.
 */
export function mascotOf(model: string | undefined, isBoss?: boolean): MascotKind {
  const m = splitEffort(model ?? '').model.toLowerCase()
  let kind: MascotKind = 'other'
  const gpt = GPT_NAME.exec(m)
  if (m.includes('opus')) kind = 'opus'
  else if (m.includes('sonnet')) kind = 'sonnet'
  else if (m.includes('haiku')) kind = 'haiku'
  else if (m.includes('fable')) kind = 'fable'
  else if (m.includes('claude')) kind = 'claude'
  else if (gpt) kind = gpt[2] as MascotKind
  else if (m.includes('gemini')) kind = m.includes('flash') ? 'flash' : 'argon'
  else if (m.includes('argon')) kind = 'argon'
  else if (/gpt[-_ ]?oss/.test(m)) kind = 'other'
  else if (/gpt|codex/.test(m)) kind = 'sol'
  if (isBoss && (kind === 'opus' || kind === 'other' || kind === 'claude' || kind === 'fable')) return 'boss'

  return kind
}

/**
 * A worker's mascot: an EVREN worker is EVREN whatever model it runs; otherwise its model's,
 * and one whose model is not known yet looks like the family it is guessed to be (its parent's).
 */
export function mascotFor(w: Pick<Worker, 'id' | 'model' | 'via' | 'guess'>, isBoss = w.id === 'boss'): MascotKind {
  if (w.via === 'evren') return 'evren'

  return mascotOf(w.model || w.guess, isBoss)
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** EVREN's own models as people say them. */
const EVREN_MODELS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/deepseek[-_ ]?v?(\d+(?:\.\d+)?)?(?:[-_ ]?(flash|pro|chat|reasoner))?/, m => `DeepSeek${m[1] ? ` V${m[1]}` : ''}${m[2] ? ` ${cap(m[2])}` : ''}`],
  [/glm[-_ ]?(\d+(?:\.\d+)?)?/, m => `GLM${m[1] ? `-${m[1]}` : ''}`],
  [/qwen[-_ ]?(\d+(?:\.\d+)?)?(?:[-_ ]?(flash|max|plus|coder))?/, m => `Qwen${m[1] ? ` ${m[1]}` : ''}${m[2] ? ` ${cap(m[2])}` : ''}`],
  [/mimo/, () => 'MiMo'],
  [/gemma[-_ ]?(\d+)?/, m => `Gemma${m[1] ? ` ${m[1]}` : ''}`],
]

// the Claude CLI's short names ('sonnet', 'opus', 'opusplan', a workflow's model: 'sonnet') and the
// version each stands for today (the CLI's model list: Opus 5.5, Fable 5.1, Sonnet 5.5, Haiku 5.5)
const ALIAS_VERSION: Readonly<Record<string, string>> = { opus: '5.5', sonnet: '5.5', haiku: '5.5', fable: '5.1' }

const version = (major: string | undefined, minor: string | undefined): string => (major ? `${major}${minor !== undefined ? `.${minor}` : ''}` : '')

/**
 * A model id as people say it, with its version: 'claude-opus-5-5' → 'Opus 5.5', 'gpt-6.1-sol' →
 * 'GPT-6.1 Sol' (and 'gpt-6-sol' → 'GPT-6 Sol'), 'gemini-3.8-flash-high' → 'Gemini 3.8 Flash'
 * (agy's effort suffix dropped), 'glm-5.3' → 'GLM-5.3'. An EVREN worker with no model → 'EVREN';
 * a model not known yet → 'model okunuyor' (never a bare dash).
 */
export function modelLabel(model: string | undefined, via?: Worker['via']): string {
  const id = splitEffort(model ?? '').model.trim()
  if (id === '') return via === 'evren' ? 'EVREN' : 'model okunuyor'
  // '[1m]' and the like: the context window, not the model
  const m = id.toLowerCase().replace(/\[[^\]]*\]$/, '')
  if (m === 'evren') return 'EVREN'
  if (m === 'codex') return 'Codex'
  for (const [rule, say] of EVREN_MODELS) {
    const hit = rule.exec(m)
    if (hit) return say(hit)
  }
  const claude = /(opus|sonnet|haiku|fable)[-_ ]?(\d{1,2})(?:[-.](\d{1,2}))?(?!\d)/.exec(m)
  if (claude) return `${cap(claude[1] as string)} ${version(claude[2], claude[3])}`
  const old = /(\d+)[-.](\d)[-.](opus|sonnet|haiku)/.exec(m)
  if (old) return `${cap(old[3] as string)} ${old[1]}.${old[2]}`
  const family = /(opus|sonnet|haiku|fable)/.exec(m)
  if (family) return `${cap(family[1] as string)} ${ALIAS_VERSION[family[1] as string]}`
  const oss = /gpt[-_ ]?oss[-_ ]?(\d+)\s*b?/.exec(m)
  if (oss) return `GPT-OSS ${oss[1]}B`
  const gpt = /gpt[-_ ]?(\d+(?:\.\d+)?)(?:[-_ ]?([a-z]+))?/.exec(m)
  if (gpt) {
    const name = gpt[2]
    const shown = name === undefined ? '' : name === 'codex' ? (/codex[-_ ]max/.test(m) ? ' Codex Max' : ' Codex') :/^(sol|terra|luna|astra|mini|nano|pro|max)$/.test(name) ? ` ${cap(name)}` : ''

    return `GPT-${gpt[1]}${shown}`
  }
  const named = GPT_NAME.exec(m)
  if (named) return `GPT ${cap(named[2] as string)}`
  if (m.includes('claude')) return 'Claude'
  const gem = /gemini[-_ ]?(\d+(?:\.\d+)?)?(?:[-_ ]?(argon|flash[-_ ]lite|flash|pro|ultra|nano))?/.exec(m)
  if (gem) {
    const name = gem[2] ? ` ${gem[2].split(/[-_ ]/).map(cap).join(' ')}` : ''

    return `Gemini${gem[1] ? ` ${gem[1]}` : ''}${name}`
  }
  if (m.includes('argon')) return 'Gemini Argon'
  if (/(^|[^a-z])(gpt)([^a-z]|$)/.test(m)) return 'GPT'

  return clip(id, 28)
}

// —— efforts ——

/** An effort as the office keeps it: the CLIs' words, folded (Codex's ultra, EVREN's kapali as off), or a number. */
export type EffortKey = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'persistent' | 'off'

const EFFORT_ALIAS: Readonly<Record<string, EffortKey>> = {
  minimal: 'minimal',
  min: 'minimal',
  low: 'low',
  dusuk: 'low',
  düşük: 'low',
  medium: 'medium',
  med: 'medium',
  orta: 'medium',
  high: 'high',
  yuksek: 'high',
  yüksek: 'high',
  'cok yuksek': 'xhigh',
  'en yuksek': 'max',
  'en dusuk': 'minimal',
  xhigh: 'xhigh',
  'x-high': 'xhigh',
  extra_high: 'xhigh',
  'extra-high': 'xhigh',
  max: 'max',
  maximum: 'max',
  ultra: 'ultra',
  persistent: 'persistent',
  off: 'off',
  none: 'off',
  kapali: 'off',
  kapalı: 'off',
  false: 'off',
  disabled: 'off',
}

/** Any effort a CLI or an event gives, as the office keeps it ('xhigh', 'ultra', 'off', '8000'); undefined for anything else. */
export function normEffort(v: unknown): string | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? String(Math.round(v)) : undefined
  if (typeof v !== 'string') return undefined
  const w = v.trim().replace(/^["']+|["']+$/g, '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/\s+/g, ' ')
  if (/^\d{1,7}$/.test(w)) return w
  const ascii = w.replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ğ/g, 'g')

  return EFFORT_ALIAS[w] ?? EFFORT_ALIAS[ascii]
}

// agy's suffix ('-high') only with its own words: '-max' and '-ultra' are parts of names
// (qwen3-max, gpt-6.1-codex-max); EVREN's ':max' says an effort; a shown name ends '(High)'
const SUFFIX = /^(.*[a-z0-9])[-_](minimal|low|medium|high|xhigh)$/i
const SUFFIX_COLON = /^(.*[a-z0-9])\s*:\s*(minimal|low|medium|high|xhigh|max|ultra|kapali|off)$/i
const SUFFIX_SHOWN = /^(.*[a-z0-9.])\s*\(\s*(minimal|low|medium|high|xhigh|max|ultra)\s*\)$/i

/**
 * A model id and the effort written into it: agy names `gemini-3.8-flash-high` and
 * `claude-opus-5-5-medium`, EVREN's helper `glm-5.3:high`. Without one the id comes back as it is.
 */
export function splitEffort(model: string): { model: string; effort?: string } {
  const hit = SUFFIX_COLON.exec(model.trim()) ?? SUFFIX_SHOWN.exec(model.trim()) ?? SUFFIX.exec(model.trim())
  if (!hit || !/[a-z]/i.test(hit[1] as string)) return { model: model.trim() }

  return { model: hit[1] as string, effort: normEffort(hit[2]) }
}

/** low → 1 … max → 5 (Codex's ultra and persistent too, the top of the dots); off and unknown → 0; a number by its size. */
export function effortLevel(effort: string | undefined): 0 | 1 | 2 | 3 | 4 | 5 {
  const e = normEffort(effort)
  switch (e) {
    case undefined:
    case 'off':
      return 0
    case 'minimal':
    case 'low':
      return 1
    case 'medium':
      return 2
    case 'high':
      return 3
    case 'xhigh':
      return 4
    case 'max':
    case 'ultra':
    case 'persistent':
      return 5
  }
  const n = Number(e)
  if (!(n > 0)) return 0
  // up to 100: a share of the scale; above it a thinking budget in tokens
  if (n <= 100) return Math.min(5, Math.max(1, Math.ceil(n / 20))) as 1 | 2 | 3 | 4 | 5

  return n < 2048 ? 1 : n < 8192 ? 2 : n < 24_576 ? 3 : n < 49_152 ? 4 : 5
}

/** The effort level in words, for the team list. */
export const EFFORT_LABEL: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = { 1: 'düşük', 2: 'orta', 3: 'yüksek', 4: 'çok yüksek', 5: 'en yüksek' }

const EFFORT_WORD: Readonly<Record<EffortKey, string>> = {
  minimal: 'düşük',
  low: 'düşük',
  medium: 'orta',
  high: 'yüksek',
  xhigh: 'çok yüksek',
  max: 'en yüksek',
  ultra: 'en yüksek',
  persistent: 'en yüksek',
  off: 'kapalı',
}

/** An effort in Turkish words ('yüksek', 'çok yüksek', 'ultra', 'kapalı'); a number by its level; undefined when none is known. */
export function effortWord(effort: string | undefined): string | undefined {
  const e = normEffort(effort)
  if (e === undefined) return undefined
  if (e in EFFORT_WORD) return EFFORT_WORD[e as EffortKey]
  const level = effortLevel(e)

  return level > 0 ? EFFORT_LABEL[level as 1 | 2 | 3 | 4 | 5] : undefined
}

/** 'Sonnet 5.5 · yüksek': a worker's whole model with its effort, one wording for every plate and list. */
export function modelLine(model: string | undefined, effort: string | undefined, via?: Worker['via']): string {
  const word = effortWord(effort ?? splitEffort(model ?? '').effort)

  return word ? `${modelLabel(model, via)} · ${word}` : modelLabel(model, via)
}

export const DUTY_LABEL: Readonly<Record<Duty, string>> = {
  builder: 'İnşaatçı',
  critic: 'Eleştirmen',
  evaluator: 'Değerlendirici',
  explorer: 'Kâşif',
  planner: 'Planlamacı',
  general: 'Genel',
}

const DUTY_RULES: Array<[Duty, RegExp]> = [
  ['critic', /eleştir|critic|review|incele|denetle|audit/],
  ['evaluator', /değerlendir|evaluat|seç|triage|judge/],
  ['builder', /inşa|build|implement|uygula|düzelt|fix/],
  ['explorer', /explore|araştır|keşif|tara|search/],
  ['planner', /plan/],
]

/** Folds İ and I to i, so Turkish and English words read alike. */
const fold = (text: string): string => text.replace(/[İI]/g, 'i').toLowerCase()

/** What a worker does for the team: from what it does (writes, sandbox), then from its task's words. */
export function dutyFor(info: { type?: string; task?: string; writes?: number; sandbox?: 'read' | 'write' }): Duty {
  if ((info.writes ?? 0) > 0 || info.sandbox === 'write') return 'builder'
  if (info.sandbox === 'read') return 'critic'
  const text = fold(`${info.task ?? ''} ${info.type ?? ''}`)
  for (const [duty, rule] of DUTY_RULES) if (rule.test(text)) return duty

  return 'general'
}

// —— titles: what a desk's card says, from what its worker is given and what it does ——

/** Titles a writing worker may keep while it writes (its task said what kind of writing). */
const WRITERS = new Set(['Yazılımcı', 'İnşaatçı', 'Temizlikçi', 'Tasarımcı', 'Arşivci', 'Test Mühendisi', 'Çevirmen'])

const TASK_TITLES: Array<[string, RegExp]> = [
  ['Test Mühendisi', /\btest|birim sına|unit test|regresyon/],
  ['Dedektif', /hata|bug|debug|neden|sorun|teşhis|kök|crash|araştır|investigat|research|incelemesi yap/],
  ['Denetçi', /incele|review|denetle|denetç|audit|eleştir|critic|critique/],
  ['Kontrolcü', /kontrol|doğrula|verify|check|sına|valid/],
  ['Mimar', /mimari|architect|altyapı|şema|schema/],
  ['Planlamacı', /plan|yol haritası|roadmap|strateji|strategy/],
  ['Tasarımcı', /tasarım|görsel|design|\bui\b|\bux\b|logo|resim|çiz|ikon|icon|svg|maskot|sprite|animasyon/],
  ['Muhasebeci', /kota|maliyet|fiyat|bütçe|cost|price|usage|harcama|fatura/],
  ['Arşivci', /belge|doküman|readme|dokümantasyon|\bdocs?\b|rapor yaz|not al|changelog|arşiv/],
  ['Gezgin', /\bweb\b|site|internet|tarayıcı|browser|google|url/],
  ['Çevirmen', /çevir|translat|tercüme/],
  ['Temizlikçi', /refactor|temizle|toparla|sadeleş|düzenle|simplif|cleanup|clean up/],
  ['Haberci', /mesaj|ilet|haber ver|bildir|notify/],
  ['İnşaatçı', /inşa|build|kur\b|kurulum|scaffold|iskelet/],
  ['Yazılımcı', /yaz|kod|implement|uygula|düzelt|fix|ekle|geliştir|code|write/],
  ['Kâşif', /tara|keşf|explore|oku|bul\b|find|search|ara\b|listele|özetle|summar/],
]

const TYPE_TITLES: Readonly<Record<string, string>> = {
  Explore: 'Kâşif',
  Plan: 'Planlamacı',
  'web-search-agent': 'Gezgin',
  'claude-code-guide': 'Rehber',
  fork: 'Klon',
}

const DUTY_TITLES: Readonly<Record<Duty, string | undefined>> = {
  builder: 'Yazılımcı',
  critic: 'Denetçi',
  evaluator: 'Değerlendirici',
  explorer: 'Kâşif',
  planner: 'Planlamacı',
  general: undefined,
}

const TEST_CMD = /^(npm test|pnpm test|yarn test|bun test|pytest|jest|vitest|mocha|cargo test|go test)$/
const DOC_FILE = /\.(md|mdx|txt|rst|docx?|pdf|odt)$/i
const ART_FILE = /\.(svg|png|jpe?g|gif|webp|css|scss|ico|psd|fig)$/i

/** The title a task and an agent type say on their own, before any work (undefined: they say nothing). */
export function taskTitle(task: string | undefined, type?: string): string | undefined {
  const text = fold(task ?? '')
  if (text.trim() !== '' && !/önceden başlamış/.test(text)) for (const [title, rule] of TASK_TITLES) if (rule.test(text)) return title
  if (type && TYPE_TITLES[type]) return TYPE_TITLES[type]

  return undefined
}

/** The title what a worker is doing right now says (undefined: nothing telling, like thinking). */
export function workTitle(w: Pick<Worker, 'activity' | 'screen' | 'tool'>): string | undefined {
  const label = w.screen?.label ?? ''
  switch (w.activity) {
    case 'writing':
      return DOC_FILE.test(label) ? 'Arşivci' : ART_FILE.test(label) ? 'Tasarımcı' : 'Yazılımcı'
    case 'running':
      return w.screen?.kind === 'cmd' && TEST_CMD.test(label) ? 'Test Mühendisi' : undefined
    case 'web':
      return 'Gezgin'
    case 'messaging':
      return 'Haberci'
    case 'planning':
      return 'Planlamacı'
    case 'reading':
      return 'Kâşif'
    default:
      return undefined
  }
}

/**
 * A worker's title, deterministic: an outside CLI is a 'Dış Uzman', one that hires its own agents a
 * 'Yedek Patron'; a test run makes a 'Test Mühendisi'; writing makes a 'Yazılımcı' unless the task
 * named a kind of writing; otherwise the task's words, then what it does, then its duty.
 */
export function titleFor(w: Pick<Worker, 'kind' | 'task' | 'activity' | 'screen' | 'tool' | 'duty'> & { type?: string }, isParent = false): string {
  if (w.kind === 'external') return 'Dış Uzman'
  if (isParent) return 'Yedek Patron'
  const byTask = taskTitle(w.task, w.type)
  const byWork = workTitle(w)
  if (byWork === 'Test Mühendisi') return byWork
  if (byWork && WRITERS.has(byWork)) return byTask && WRITERS.has(byTask) ? byTask : byWork

  return byTask ?? byWork ?? (w.duty ? DUTY_TITLES[w.duty] : undefined) ?? 'Asistan'
}

/**
 * A title change, held steady: a new title takes over only when it comes twice in a row
 * (`next` is the one seen last time); the same title as now clears a pending one.
 */
export function settleTitle(now: string | undefined, next: string | undefined, candidate: string): { title: string; next?: string } {
  if (now === undefined || now === candidate) return { title: candidate }
  if (next === candidate) return { title: candidate }

  return { title: now, next: candidate }
}

/** A desk's name from its title: 'Yazılımcı', a second one 'Yazılımcı 2' (the smallest number free in the office). */
export function numberedName(title: string, others: readonly Pick<Worker, 'id' | 'name'>[], self?: string): string {
  const taken = new Set(others.filter(o => o.id !== self).map(o => o.name))
  if (!taken.has(title)) return title
  for (let k = 2; ; k++) if (!taken.has(`${title} ${k}`)) return `${title} ${k}`
}

// —— outside workers ——

/**
 * `cli` 'evren': the evren_suru helper run as a command. `profile` is read for codex only
 * (`-p evren` runs codex on EVREN); gemini's -p is its prompt, never a profile. `models`: every
 * model of an EVREN swarm (`--model glm-5.3:high,deepseek-v4.1-flash:high`), `model` its first.
 */
export type ExternalCall = { cli: 'codex' | 'gemini' | 'agy' | 'evren'; model?: string; effort?: string; sandbox?: 'read' | 'write'; profile?: string; models?: Array<{ model: string; effort?: string }> }

/** An outside CLI run without -m: the family it runs by default (Antigravity runs Gemini). */
export const EXT_DEFAULT_MODEL: Readonly<Record<ExternalCall['cli'], string>> = { codex: 'codex', gemini: 'gemini', agy: 'gemini', evren: 'evren' }

/** A codex profile's model and effort when its file cannot be read (a profile can supply a fallback model and effort). */
export const PROFILE_DEFAULT: Readonly<Record<string, { model?: string; effort?: string }>> = { evren: { model: 'glm-5.3', effort: 'high' } }

/** A codex config file's own model and effort: the `model =` and `model_reasoning_effort =` lines before its first table. */
export function readCodexConfig(text: string): { model?: string; effort?: string } {
  const head = text.split(/^\s*\[/m)[0] ?? ''
  const model = /^\s*model\s*=\s*["']([^"'\n]{1,60})["']/m.exec(head)?.[1]
  const effort = normEffort(/^\s*model_reasoning_effort\s*=\s*["']?([\w-]{1,16})["']?/m.exec(head)?.[1])
  const out: { model?: string; effort?: string } = {}
  if (model && /^[\w.:/@-]+$/.test(model)) out.model = model
  if (effort) out.effort = effort

  return out
}

// a command word: at the start, after a separator, `$(` or a PowerShell call operator, after a
// wrapper (timeout 600, env X=1, nohup, start /b, cmd /c, powershell -Command, bash -c), a path and quotes allowed
const WRAP = String.raw`(?:(?:timeout(?:\.exe)?\s+(?:-\S+\s+)*\d+[smhd]?|nohup|time|exec|call|env(?:\s+-\S+)*|[A-Za-z_]\w*=\S*|\$env:\w+\s*=\s*\S+\s*;|start(?:\s+"[^"]*")?(?:\s+\/\w+)*|cmd(?:\.exe)?\s+\/[cCkK]|(?:pwsh|powershell)(?:\.exe)?(?:\s+-\w+)*|(?:ba|z)?sh\s+-l?c|npx(?:\.cmd)?(?:\s+-\S+)*|pnpm\s+dlx|bunx|wsl(?:\.exe)?(?:\s+-\S+)*)\s+["']?)*`
const CMD_AT = String.raw`(?:^|[;&|(\n]|\$\()\s*(?:&\s*)?` + WRAP + String.raw`(?:"[^"\n]*[\\/]|'[^'\n]*[\\/]|["']?(?:[^\s"'|;&()]*[\\/])?)`
// a script run through python (its flags allowed) or `uv run`
const PY_RUN = String.raw`(?:(?:python3?|py)(?:\.exe)?["']?\s+(?:-[A-Za-z]\S*\s+)*|uv(?:\.exe)?\s+run\s+(?:(?:python3?|py)(?:\.exe)?\s+(?:-[A-Za-z]\S*\s+)*)?)?`
// the helper under any dated name: evren_suru.py, 2026-11-08_claude_evren_suru.py
const SCRIPT_AT = String.raw`["']?(?:[^\s"'|;&()]*[\\/])?[\w.-]*?`
const CLI_RULES: Array<[ExternalCall['cli'], RegExp]> = [
  ['codex', new RegExp(CMD_AT + String.raw`codex(?:\.exe|\.cmd)?["']?(?=\s|$)`, 'i')],
  ['gemini', new RegExp(CMD_AT + String.raw`gemini(?:\.exe|\.cmd)?["']?(?=\s|$)`, 'i')],
  ['agy', new RegExp(CMD_AT + String.raw`agy(?:\.exe|\.cmd)?["']?(?=\s|$)`, 'i')],
  ['evren', new RegExp(CMD_AT + PY_RUN + SCRIPT_AT + String.raw`evren_suru(?:\.py)?["']?(?=\s|$)`, 'i')],
]
const SEP = new Set([';', '&&', '||', '|', '&'])
// codex's flags that take a value (to find its subcommand after them)
const CODEX_VALUE = new Set(['-m', '--model', '-p', '--profile', '-c', '--config', '-s', '--sandbox', '-a', '--ask-for-approval', '-C', '--cd', '-i', '--image', '--local-provider', '--enable', '--disable'])
const CODEX_JOBS = new Set(['exec', 'e', 'review'])
// the helper's own housekeeping: no model is asked
const EVREN_CHORES = new Set(['tara', 'kontrol', 'kabul', 'modeller', 'kota', 'ping', 'liste', 'yardim', 'help', 'test', 'durum'])

const modelOf = (v: string | undefined) => (v && /^[\w.:/@-]{1,60}$/.test(v) ? v : undefined)
const profileOf = (v: string | undefined) => (v && /^[\w.-]{1,40}$/.test(v) ? v.toLowerCase() : undefined)
const sandboxOf = (v: string | undefined): ExternalCall['sandbox'] => {
  const w = (v ?? '').toLowerCase()
  if (w === 'read-only' || w === 'plan') return 'read'
  if (/^(workspace-write|danger-full-access|accept-edits|auto_edit|auto-edit|yolo)$/.test(w)) return 'write'

  return undefined
}

/**
 * A command line's words after the CLI, up to the next command: quotes joined to what they stand
 * next to (`model_reasoning_effort="ultra"` is one word), a separator ends the list.
 */
function argWords(rest: string): string[] {
  const out: string[] = []
  const re = /(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"';&|])+|[;&|]+/g
  let t: RegExpExecArray | null
  while ((t = re.exec(rest)) !== null) {
    const raw = t[0]
    if (SEP.has(raw)) break
    const ends = /[^\\];$/.test(raw) && !/^["']/.test(raw)
    const word = raw.replace(/;$/, '').replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (_, d: string | undefined, s: string | undefined) => d ?? s ?? '')
    out.push(word)
    if (ends) break
  }

  return out
}

// a quote a wrapper runs as a command line (bash -c "...", cmd /c "...", powershell -Command "...")
const RUNS_QUOTE = /(?:(?:^|\s)-l?c|\/[cCkK]|-Command|-EncodedCommand)\s*$/i
const CLI_PATH = /(?:^|[\\/])(?:codex|gemini|agy|[\w.-]*evren_suru)(?:\.py|\.exe|\.cmd)?$/i

/** The command with every quoted text blanked (same length), except a quote a wrapper runs. */
function maskQuotes(cmd: string): string {
  let out = ''
  let i = 0
  while (i < cmd.length) {
    const ch = cmd[i] as string
    if (ch !== '"' && ch !== "'") {
      out += ch
      i++
      continue
    }
    let j = i + 1
    while (j < cmd.length && cmd[j] !== ch) j += ch === '"' && cmd[j] === '\\' ? 2 : 1
    // left as it is: an unclosed quote, a quote a wrapper runs, a quoted path to the CLI itself
    if (j >= cmd.length || RUNS_QUOTE.test(cmd.slice(0, i)) || CLI_PATH.test(cmd.slice(i + 1, j))) {
      out += ch
      i++
      continue
    }
    out += ch + ' '.repeat(j - i - 1) + ch
    i = j + 1
  }

  return out
}

/**
 * The outside worker a shell command starts (codex, gemini, agy, EVREN's helper), with its model,
 * effort and sandbox. Only those facts are read; the command itself is never kept. The effort comes
 * from `-c model_reasoning_effort=`, `--effort`/`--efor`, or the model id's suffix (agy `-high`, EVREN `:high`).
 */
export function readExternal(command: string): ExternalCall | undefined {
  if (typeof command !== 'string' || command === '') return undefined
  // a line continued (bash \, PowerShell `, cmd ^) is one line
  command = command.replace(/(?:\\|`|\^)\r?\n[ \t]*/g, ' ')
  // a CLI named inside quoted text (a commit message, another CLI's prompt) starts nothing
  const seen = maskQuotes(command)
  let found: { cli: ExternalCall['cli']; at: number; end: number } | undefined
  for (const [cli, rule] of CLI_RULES) {
    const m = rule.exec(seen)
    if (m && (!found || m.index < found.at)) found = { cli, at: m.index, end: m.index + m[0].length }
  }
  if (!found) return undefined
  const out: ExternalCall = { cli: found.cli }
  const tokens = argWords(command.slice(found.end).split('\n')[0] ?? '')
  let models: Array<{ model: string; effort?: string }> = []
  let positional: string | undefined
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] as string
    const cut = tok.startsWith('--') ? tok.indexOf('=') : -1
    const flag = cut > 0 ? tok.slice(0, cut) : tok
    const value = () => (cut > 0 ? tok.slice(cut + 1) : tokens[++i])
    switch (flag) {
      case '-m':
      case '--model': {
        // EVREN's helper takes a swarm: model:effort, model:effort
        const v = value() ?? ''
        const list = v
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => splitEffort(s))
          .filter(p => modelOf(p.model) !== undefined)
        if (list.length > 0) models = list
        break
      }
      case '-c':
      case '--config': {
        const cfg = /^\s*([\w.]+)\s*=\s*(.+)$/.exec(value() ?? '')
        if (cfg?.[1] === 'model_reasoning_effort') out.effort = normEffort(cfg[2]) ?? out.effort
        else if (cfg?.[1] === 'model') {
          const m = modelOf((cfg[2] as string).replace(/^["']|["']$/g, ''))
          if (m) models = [splitEffort(m)]
        }
        break
      }
      case '--effort':
      case '--efor':
      case '--reasoning-effort':
        out.effort = normEffort(value()) ?? out.effort
        break
      case '-s':
      case '--sandbox':
      case '--mode':
      case '--approval-mode':
        out.sandbox = sandboxOf(value()) ?? out.sandbox
        break
      case '--yolo':
      case '--full-auto':
      case '--dangerously-bypass-approvals-and-sandbox':
        out.sandbox = 'write'
        break
      case '-p':
      case '--profile':
        // codex only: gemini's and agy's -p is the prompt, and its text is never read
        if (out.cli === 'codex') out.profile = profileOf(value()) ?? out.profile
        break
      default:
        if (out.cli === 'codex' && CODEX_VALUE.has(flag) && cut < 0) i++
        else if (positional === undefined && !tok.startsWith('-')) positional = tok.toLowerCase()
    }
  }
  // codex runs a job only through exec (or review); its other subcommands are no outside worker
  if (out.cli === 'codex' && (positional === undefined || !CODEX_JOBS.has(positional))) return undefined
  if (out.cli === 'evren' && positional !== undefined && EVREN_CHORES.has(positional)) return undefined
  const first = models[0]
  if (first) {
    out.model = first.model
    if (out.effort === undefined && first.effort) out.effort = first.effort
  }
  if (models.length > 1) out.models = models.slice(0, 6).map(p => (p.effort ?? out.effort ? { model: p.model, effort: p.effort ?? out.effort } : { model: p.model }))
  if (out.profile === undefined) delete out.profile
  if (out.model === undefined) delete out.model
  if (out.effort === undefined) delete out.effort
  if (out.sandbox === undefined) delete out.sandbox

  return out
}

const PATHISH = /^["'(]?(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])\S*$|^\S*[\\/]\S*[\\/]\S*$/

/** A message's line for the office: the SendMessage summary, else the text's first line; short, no raw paths. */
export function talkText(summary: unknown, text: unknown): string {
  let line = typeof summary === 'string' ? summary.replace(/\s+/g, ' ').trim() : ''
  if (line === '' && typeof text === 'string') line = (text.split(/\r?\n/).find(l => l.trim() !== '') ?? '').replace(/\s+/g, ' ').trim()
  const flat = line
    .split(' ')
    .map(word => (PATHISH.test(word) ? baseName(word.replace(/^["'(]+|["'),.:;]+$/g, '')) : word))
    .join(' ')

  return clip(flat, 48)
}

/** A SendMessage recipient as the office knows it: a worker id, 'boss', or '' when nobody here carries it. */
export function resolveAddress(workers: readonly Worker[], to: string): string {
  const want = String(to ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim().toLowerCase()
  if (want === '') return ''
  if (want === 'main' || want === 'team-lead') return 'boss'
  // a seated worker before one on its way out
  const live = [...workers].sort((a, b) => Number(a.endedAt !== undefined) - Number(b.endedAt !== undefined))
  const by = (test: (w: Worker) => boolean) => live.find(test)?.id
  const short = want.includes('@') ? want.slice(0, want.indexOf('@')) : want

  return (
    by(w => w.id.toLowerCase() === want) ??
    by(w => (w.addr ?? []).some(a => a.toLowerCase() === want)) ??
    by(w => w.name.toLowerCase() === want) ??
    by(w => w.id !== 'boss' && ((w.addr ?? []).some(a => a.toLowerCase() === short) || w.name.toLowerCase() === short)) ??
    ''
  )
}

// —— tiredness: the office slows as the plan's allowance runs low ——

export type Fatigue = 0 | 1 | 2 | 3

/** Fps and walking speed by tiredness. */
export const FATIGUE_SPEED: Readonly<Record<Fatigue, number>> = { 0: 1, 1: 0.85, 2: 0.7, 3: 0.5 }

/**
 * How tired the office is: from the higher of the 5-hour and weekly limits' use
 * (0 under 60 %, 1 to 79 %, 2 to 91 %, 3 from 92 % or when the 5-hour limit fills within half an hour at its pace).
 */
export function fatigue(usage: Pick<Usage, 'limits' | 'samples'>, now: number): Fatigue {
  const five = usage.limits.find(l => l.kind === 'five_hour')
  const week = usage.limits.find(l => l.kind === 'seven_day')
  const u = Math.max(five?.pct ?? 0, week?.pct ?? 0)
  if (u >= 92) return 3
  if (five) {
    const f = forecast('five_hour', five.pct, five.resetsAt, (usage.samples?.five_hour ?? []) as Sample[], now)
    if (f.fullAt !== undefined && f.fullAt <= now + 30 * 60_000) return 3
  }
  if (u >= 80) return 2
  if (u >= 60) return 1

  return 0
}
