// Cetvel köprüsü: Cetvel'in dış ajan anlığı (%LOCALAPPDATA%\Cetvel\ajanlar.json, biçim sürümü 1).
// Codex ve Antigravity ajanları ve alt ajanları (ebeveyn karmasıyla) bu dosyadan masaya oturur.
// Cetvel istem, komut ya da yol yazmaz; burada yine de her alan doğrulanır ve yalnız kimlik karması,
// kısa ad, model/efor kimliği, durum, etkinlik türü, hata türü, zamanlar ve sayaçlar okunur. Dosya yoksa,
// bozuksa ya da eskiyse hiçbir şey yapılmaz: Bash/PowerShell kancasından gelen dış işçi algısı aynen sürer.
import type { Activity, FaultCode, Screen, Worker } from '../types'
import type { ToolFacts } from './activities'

export type CvPlatform = 'codex' | 'antigravity' | 'claude_dis'
export type CvStatus = 'calisiyor' | 'bekliyor' | 'bitti' | 'hata' | 'iptal' | 'askida'
export type CvActivity =
  | 'okuma'
  | 'yazma'
  | 'arama'
  | 'komut'
  | 'web'
  | 'dusunme'
  | 'test'
  | 'derleme'
  | 'surum'
  | 'kurulum'
  | 'arac'
  | 'alt_ajan'
  | 'yanit'
  | 'bekleme'
  | 'gorsel'
  | 'bilinmiyor'
export type CvFault = '429' | 'zaman_asimi' | 'izin_reddi' | 'arac_hatasi' | 'baglam_asimi' | 'ag' | 'bilinmiyor'

/** One agent of the snapshot, as the office reads it. */
export type CvAgent = {
  /** Cetvel's hash ('cx-…', 'ag-…', 'cl-…'): never a raw id */
  id: string
  platform: CvPlatform
  /** the parent's hash (it may have left the list) */
  parent?: string
  depth: number
  /** a short role or nickname, never a prompt */
  name: string
  model?: string
  effort?: string
  status: CvStatus
  activity?: CvActivity
  fault?: CvFault
  startedAt?: number
  lastAt: number
  endedAt?: number
  tools: number
  toolErrors: number
}

export type CvSnapshot = { at: number; seq: number; agents: CvAgent[] }

const PLATFORMS: ReadonlySet<string> = new Set<CvPlatform>(['codex', 'antigravity', 'claude_dis'])
const STATUSES: ReadonlySet<string> = new Set<CvStatus>(['calisiyor', 'bekliyor', 'bitti', 'hata', 'iptal', 'askida'])
const ACTIVITIES: ReadonlySet<string> = new Set<CvActivity>(['okuma', 'yazma', 'arama', 'komut', 'web', 'dusunme', 'test', 'derleme', 'surum', 'kurulum', 'arac', 'alt_ajan', 'yanit', 'bekleme', 'gorsel', 'bilinmiyor'])
const FAULTS: ReadonlySet<string> = new Set<CvFault>(['429', 'zaman_asimi', 'izin_reddi', 'arac_hatasi', 'baglam_asimi', 'ag', 'bilinmiyor'])
const ID = /^(cx|ag|cl)-[0-9a-f]{16}$/
const NAME = /^[\p{L}\p{N} ._-]{1,32}$/u
const MODEL = /^[A-Za-z0-9._:@/-]{1,64}$/
/** at most this many agents are read from one snapshot */
const MAX_AGENTS = 200

/** Finished: shown a moment, then the desk is cleared. */
export const isFinished = (s: CvStatus): boolean => s === 'bitti' || s === 'hata' || s === 'iptal'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/** An ISO time ('2026-11-16T09:00:00Z') in ms, or undefined. */
function time(v: unknown): number | undefined {
  const s = str(v)
  if (!s || s.length > 40) return undefined
  const t = Date.parse(s)

  return Number.isFinite(t) ? t : undefined
}

/** A model or effort id: short, no spaces, never a path. */
function modelId(v: unknown): string | undefined {
  const s = str(v)?.trim()
  if (!s || !MODEL.test(s) || s.startsWith('/') || s.includes('//')) return undefined

  return s
}

/** A display name: short, letters and digits, never a path or a sentence. */
function shortName(v: unknown): string {
  const s = str(v)?.trim() ?? ''
  if (!NAME.test(s) || s.includes('..') || s.split(/\s+/).length > 3) return ''

  return s
}

/**
 * Reads Cetvel's snapshot. Anything it cannot vouch for is dropped: an unknown platform or status drops
 * the agent, an unknown activity or fault reads as unknown, a name that is not a short name is blank.
 * undefined: not a snapshot (missing, half written, another format).
 */
export function readSnapshot(text: string): CvSnapshot | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.surum !== 'number' || r.surum < 1 || !Array.isArray(r.ajanlar)) return undefined
  const agents: CvAgent[] = []
  for (const x of r.ajanlar.slice(0, MAX_AGENTS)) {
    if (!x || typeof x !== 'object') continue
    const a = x as Record<string, unknown>
    const id = str(a.kimlik)
    const platform = str(a.platform)
    const status = str(a.durum)
    const lastAt = time(a.son_etkinlik)
    if (!id || !ID.test(id) || !platform || !PLATFORMS.has(platform) || !status || !STATUSES.has(status) || lastAt === undefined) continue
    const one: CvAgent = { id, platform: platform as CvPlatform, depth: Math.min(count(a.derinlik), 8), name: shortName(a.ad), status: status as CvStatus, lastAt, tools: 0, toolErrors: 0 }
    const parent = str(a.ebeveyn)
    if (parent && ID.test(parent) && parent !== id) one.parent = parent
    const model = modelId(a.model)
    if (model) one.model = model
    const effort = modelId(a.efor)
    if (effort && effort.length <= 16) one.effort = effort
    const act = str(a.etkinlik)
    if (act) one.activity = (ACTIVITIES.has(act) ? act : 'bilinmiyor') as CvActivity
    const fault = str(a.hata_turu)
    if (fault) one.fault = (FAULTS.has(fault) ? fault : 'bilinmiyor') as CvFault
    const startedAt = time(a.baslama)
    if (startedAt !== undefined) one.startedAt = startedAt
    const endedAt = time(a.bitis)
    if (endedAt !== undefined) one.endedAt = endedAt
    const n = a.sayilar && typeof a.sayilar === 'object' ? (a.sayilar as Record<string, unknown>) : {}
    one.tools = count(n.arac)
    one.toolErrors = count(n.arac_hatasi)
    agents.push(one)
  }

  return { at: time(r.zaman) ?? 0, seq: count(r.sira), agents }
}

/** The platform's mascot (`Worker.via`); a Claude session outside this one is the plain orange worker. */
export const CV_VIA: Readonly<Record<CvPlatform, Worker['via']>> = { codex: 'gpt', antigravity: 'agy', claude_dis: undefined }

type Look = { activity: Activity; bubble: string; screen: Omit<Screen, 'at'>; facts?: Omit<ToolFacts, 'phase'> }

/**
 * What a Cetvel activity looks like at the desk: the office's own activity and, for its prop, the tool a
 * call of that kind would be (a fixed stand-in: no command, path or text of the agent is ever used).
 */
export const CV_LOOK: Readonly<Record<CvActivity, Look>> = {
  okuma: { activity: 'reading', bubble: 'Dosya okuyor', screen: { kind: 'file-read', label: 'Dosya' }, facts: { tool: 'Read' } },
  yazma: { activity: 'writing', bubble: 'Kod yazıyor', screen: { kind: 'file-write', label: 'Dosya' }, facts: { tool: 'Edit' } },
  arama: { activity: 'reading', bubble: 'Arıyor', screen: { kind: 'search', label: 'Arama' }, facts: { tool: 'Grep' } },
  komut: { activity: 'running', bubble: 'Komut çalıştırıyor', screen: { kind: 'cmd', label: 'Komut' }, facts: { tool: 'Bash' } },
  web: { activity: 'web', bubble: 'Webde arıyor', screen: { kind: 'site', label: 'Web', site: 'web' }, facts: { tool: 'WebSearch' } },
  dusunme: { activity: 'thinking', bubble: 'Düşünüyor', screen: { kind: 'think', label: 'Düşünce', think: 'general' } },
  test: { activity: 'running', bubble: 'Test koşuyor', screen: { kind: 'cmd', label: 'test' }, facts: { tool: 'Bash', cmd: 'npm test' } },
  derleme: { activity: 'running', bubble: 'Derliyor', screen: { kind: 'cmd', label: 'derleme' }, facts: { tool: 'Bash', cmd: 'cargo build' } },
  surum: { activity: 'running', bubble: 'Git işi', screen: { kind: 'cmd', label: 'git' }, facts: { tool: 'Bash', cmd: 'git status' } },
  kurulum: { activity: 'running', bubble: 'Paket kuruyor', screen: { kind: 'cmd', label: 'kurulum' }, facts: { tool: 'Bash', cmd: 'npm install' } },
  arac: { activity: 'running', bubble: 'Araç kullanıyor', screen: { kind: 'tool', label: 'Araç' }, facts: { tool: 'mcp__dis__arac' } },
  alt_ajan: { activity: 'delegating', bubble: 'Alt ajana iş verdi', screen: { kind: 'msg', label: 'Alt ajan' }, facts: { tool: 'Agent' } },
  yanit: { activity: 'answering', bubble: 'Cevap yazıyor', screen: { kind: 'answer', label: 'Cevap' } },
  bekleme: { activity: 'waiting', bubble: 'Bekliyor', screen: { kind: 'wait', label: 'Bekleme' } },
  gorsel: { activity: 'writing', bubble: 'Görsel hazırlıyor', screen: { kind: 'file-write', label: 'Görsel' }, facts: { tool: 'Write', file: 'gorsel.png' } },
  bilinmiyor: { activity: 'running', bubble: 'Çalışıyor', screen: { kind: 'ext', label: 'Çalışıyor' } },
}

/**
 * A Cetvel fault → the error catalog's trigger (the office's error catalog). Its own animation
 * comes in a later round; until then the nearest reaction the office has plays: a result of that kind
 * (429 → the queue ticket, a refusal → the shield, any other failure → the sparks).
 */
export const CV_FAULT: Readonly<Record<CvFault, { code: FaultCode; bubble: string; facts: Omit<ToolFacts, 'phase'> }>> = {
  '429': { code: 'hiz-429', bubble: 'Hız sınırı: sırada bekliyorum', facts: { tool: 'Bash', failed: true, apiFault: 'rate_limit', out: '429 Too Many Requests' } },
  zaman_asimi: { code: 'zaman-asimi', bubble: 'Zaman aşımı', facts: { tool: 'Bash', failed: true, out: 'Request timed out' } },
  izin_reddi: { code: 'izin-red', bubble: 'İzin verilmedi', facts: { tool: 'Bash', denied: true } },
  arac_hatasi: { code: 'arac-hata', bubble: 'Araç hata verdi', facts: { tool: 'Bash', failed: true, out: 'error' } },
  baglam_asimi: { code: 'baglam-asildi', bubble: 'Bağlam taştı', facts: { tool: 'Bash', failed: true, out: 'Prompt is too long' } },
  ag: { code: 'ag-kopuk', bubble: 'Bağlantı koptu', facts: { tool: 'Bash', failed: true, out: 'Connection lost' } },
  bilinmiyor: { code: 'isci-coktu', bubble: 'Hat koptu', facts: { tool: 'Bash', failed: true, out: 'error' } },
}

/** What an agent's state comes to, for telling whether anything changed since it was last applied. */
export const cvKey = (a: CvAgent): string => [a.status, a.activity ?? '', a.fault ?? '', a.lastAt, a.toolErrors, a.model ?? '', a.effort ?? '', a.parent ?? ''].join('|')
