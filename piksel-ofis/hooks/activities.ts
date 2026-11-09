// Claude Ofis 0.9: iş türüne göre etkinlik animasyonları (tasarım v5).
// Bir işçinin son araçları/görevi/durumu → etkinlik (resim çiziyor, kod yazıyor, dedektif avında…).
// Bu dosya saftır: rastgelelik yok (her "olasılık" hash(seed) ile), saat yok (now dışarıdan gelir).
// Ham komut, yol ya da metin hiçbir zaman kalıcı duruma yazılmaz; yalnız türetilmiş işaretler (ActMark).
//
// Akış: tool.call → pickActivity (aday) → settleAct (2-kez kuralı: titreme yok) + withEv (tek seferlik
// olay) → Worker.act/trail. Çizim anında actView süre/bağlam/yorgunluk/ambiyansı türetir, planActs
// bütçeye göre hangi şeritlerin gömüleceğini seçer, actDefs yalnız kullanılanları yazar.
import type { ActMark, ActState, Activity, Worker } from '../types'
import type { CharKind } from './char-data'
import { ACTS, ACT_CSS, ACT_STRIPS, ACT_TRIGGERS, type ActEntry } from './activity-data'
import { FATIGUE_SPEED, hash, readExternal } from './logic'

export { ACTS, ACT_CSS, ACT_STRIPS, ACT_TRIGGERS }
export type { ActAnchor, ActClass, ActEntry, ActStrip } from './activity-data'

// ——— sözleşme tipleri ————————————————————————————————————————

export type ToolFacts = {
  /** 'Read', 'Bash', 'mcp__x__generate_image', … */
  tool: string
  phase: 'call' | 'result'
  /** yol (fonksiyon içinde uzantı/ad kalıbı için; saklanmaz) */
  file?: string
  /** Bash/PowerShell komutu (saklanmaz) */
  cmd?: string
  /** run_in_background */
  bg?: boolean
  /** Skill input.skill */
  skill?: string
  /** description / summary / prompt / Agent görev metni / Grep deseni (anahtar kelime için; saklanmaz) */
  text?: string
  agentType?: string
  failed?: boolean
  denied?: boolean
  /** sonuç metninin ilk 4000 karakteri (yalnız desen için) */
  out?: string
  /** ReportFindings findings.length */
  findings?: number
  /** komut dış CLI (readExternal) → çağıran için radio-call */
  external?: boolean
  /** wrap_up: ofiste başarısız biten işçi var (temiz bitiş değil) */
  teamFailed?: boolean
}

/** pickActivity sonucu (tasarımdaki `Pick`; TS'nin Pick yardımcısıyla çakışmasın diye bu adla) */
export type ActPick = {
  main?: string
  ev?: string
  mark: ActMark
  clearEv?: boolean
  /** güçlü, tek seferlik sinyal (Skill, ReportFindings, bildirim, wrap_up, sonuç evresi varyantı): 2-kez kuralı atlanır */
  force?: true
  /** bu çağrı süren denetimin parçası (denetim izinde Read/Grep): denetim etkinliği tazelenir ya da bekleyen denetim adayı onaylanır */
  keep?: true
}

export type ActCtx = {
  now: number
  isBoss: boolean
  fat: 0 | 1 | 2 | 3
  /** bağlam yüzdesi (yalnız patron: bağlam oturumundur) */
  ctxPct?: number
  /** 5 saatlik hak %100 */
  limitFull: boolean
  /** meşgul ekip üyesi sayısı (patronun gözetlemesi için) */
  teamBusy: number
  /** meşgul bir denetçi/kontrolcü var (patron hakemlik yapar) */
  criticBusy: boolean
  kind: CharKind
  external: boolean
}
export type ActPart = { id: string; strip: string; at: number }
export type ActView = {
  main?: ActPart
  ev?: ActPart & { until: number }
  /** üst: ana etkinliğin üstüne binen yük göstergesi (overheat-sweat) */
  over?: ActPart
  /** detective-hunt şapkası (baş üstündeki aksesuar gizlenir) */
  hat?: boolean
  /** ek katmanlar: film-shoot_misir */
  extra?: ActPart[]
  /** masa mini paneli: Türkçe, tek satır, ≤ 16 karakter */
  label?: string
  /** fps ve gövde süresi çarpanı (yorgunluk) */
  speed: number
}

// ——— etiketler (§7) ——————————————————————————————————————————

export const ACT_LABEL: Readonly<Record<string, string>> = {
  'paint-canvas': 'Resim çiziyor',
  'pixel-sketch': 'Piksel çiziyor',
  'quill-write': 'Metin yazıyor',
  'music-compose': 'Beste yapıyor',
  'film-shoot': 'Video çekiyor',
  'idea-bulb': 'Fikir buldu',
  'type-fast': 'Kod yazıyor',
  'bug-fix': 'Hata onarıyor',
  'compile-wait': 'Derleniyor',
  'code-read': 'Kod okuyor',
  'test-tube': 'Test koşuyor',
  'test-tube_fail': 'Test kırıldı',
  'plan-blueprint': 'Plan çiziyor',
  'globe-spin': 'Web’de arıyor',
  'radar-scan': 'Sayfa tarıyor',
  'library-shelf': 'Dosya arıyor',
  'map-explore': 'Proje geziyor',
  'spreadsheet-fill': 'Tablo dolduruyor',
  'database-barrel': 'Veritabanında',
  'funnel-filter': 'Veri süzüyor',
  'scale-compare': 'Karşılaştırıyor',
  'git-branch': 'Git işinde',
  'coffee-break': 'Kahve molası',
  'overheat-sweat': 'Ter döküyor',
  'queue-ticket': 'Sırada bekliyor',
  'magnify-eye': 'Görsel inceliyor',
  'dictionary-translate': 'Çeviri yapıyor',
  binoculars: 'Gözetliyor',
  periscope: 'Ekibi gözlüyor',
  'security-cam': 'Süreci izliyor',
  'watch-lighthouse': 'Nöbet tutuyor',
  'checklist-audit': 'Denetliyor',
  'checklist-audit_fail': 'Bulgu yazıyor',
  'detective-hunt': 'Dedektif avında',
  'radio-call': 'Ajan çağırıyor',
  'paper-plane': 'Mesaj uçuruyor',
  'mail-envelope': 'E-posta yazıyor',
  'megaphone-announce': 'Duyuru yapıyor',
  'headset-listen': 'Ses dinliyor',
  'handoff-baton': 'Devir teslim',
  'chart-grow': 'Grafik çıkarıyor',
  'abacus-calc': 'Hesap yapıyor',
  'deploy-rocket': 'Yayına alıyor',
  'archive-boxes': 'Arşivliyor',
  'memory-brain': 'Hafıza yazıyor',
  'shield-guard': 'Güvenlik tarıyor',
  'broom-cleanup': 'Temizlik yapıyor',
  'nap-zzz': 'Uyukluyor',
  'error-sparks': 'Hata aldı',
  'confetti-party': 'Kutluyor',
}
/** dış işçide kulaklık */
export const EXTERNAL_LABEL = 'Dış hatta'

// ——— küçük yardımcılar ————————————————————————————————————————

/** Türkçe katlama (üretici ile aynı): İ/I → i, küçük harf */
export const fold = (s: string): string => s.replace(/[İI]/g, 'i').toLowerCase()

const entry = (id: string | undefined): ActEntry | undefined => (id ? ACTS[id] : undefined)

/** varyantın ana kaydı (test-tube_fail → test-tube); diğerleri kendisi */
export const familyOf = (id: string): string => {
  const e = ACTS[id]

  return e && e.role === 'varyant' && e.of ? e.of : id
}

/** tek seferlik (sure tek) ya da olay sınıfı: ev olarak oynar, 2-kez kuralına bağlanmaz */
export const isEvent = (id: string): boolean => {
  const e = ACTS[id]

  return Boolean(e && (e.once || e.cls === 'olay'))
}

/** Baş genişliğine uygun şerit; bulunamazsa varsayılan şerit. */
export const stripFor = (id: string, kind: CharKind): string => {
  const e = ACTS[id]
  if (!e) return id

  return e.strip[kind] ?? e.strip.def
}

/** [0, 1) arası tohumlu kesir */
const frac = (seed: string): number => (hash(seed) % 10_000) / 10_000

/** döngü kareleri: giriş sonrası (pingpong ise ileri-geri), üretici ile aynı sıra */
export function loopFrames(id: string): number[] {
  const e = ACTS[id]
  const n = ACT_STRIPS[e?.strip.def ?? id]?.n ?? 1
  const intro = e?.intro ?? 0
  const seq: number[] = []
  for (let k = intro; k < n; k++) seq.push(k)
  if (e?.pingpong && seq.length > 2) for (let k = seq.length - 2; k > 0; k--) seq.push(seq[k] as number)

  return seq
}

/** olay süresi (ms): özel süreler, aksi max(1200, n/fps·1000·tekrar) */
export function evDuration(id: string): number {
  switch (id) {
    case 'handoff-baton':
      return 2000
    case 'confetti-party':
      return 1600
    case 'radio-call':
      return 3000
    case 'shield-guard':
      return 2000
    case 'queue-ticket':
      return 60_000
  }
  const e = ACTS[id]
  if (!e) return 1200
  const n = ACT_STRIPS[e.strip.def]?.n ?? 1
  const rep = typeof e.body?.count === 'number' ? e.body.count : 1

  return Math.max(1200, Math.round((n / Math.max(1, e.fps)) * 1000 * rep))
}

// ——— anahtar kelime (§3.3-2) ————————————————————————————————————

/** araç adı olan tokenlar: yalnız araç adıyla eşleşir, düzyazıda (açıklama metni) yok sayılır */
const TOOL_ONLY = new Set([
  'agent', 'task', 'edit', 'grep', 'glob', 'multiedit', 'notebookedit', 'todowrite', 'webfetch', 'websearch', 'monitor',
  'listagents', 'sendmessage', 'croncreate', 'schedulewakeup', 'pushnotification', 'senduserfile', 'workflow', 'wrap_up',
  'start_session', 'update_plan', 'run_in_background', 'find', 'loop', 'done',
])
const WORD = /[0-9a-zçğıöşüâîû]/

/** `tok` metinde sözcük sınırıyla geçiyor mu (harf/rakam dışı her şey sınırdır: _ - : / boşluk) */
function hasToken(hay: string, tok: string): boolean {
  let at = hay.indexOf(tok)
  while (at >= 0) {
    const before = at > 0 ? hay[at - 1] ?? '' : ''
    const after = hay[at + tok.length] ?? ''
    if (!WORD.test(before) && !WORD.test(after)) return true
    at = hay.indexOf(tok, at + 1)
  }

  return false
}

/**
 * Anahtar kelimeyle aday: `names` (skill adı, MCP sunucu+kısa ad, ajan türü, komut sözcüğü) her tokenla,
 * `prose` (açıklama/görev metni) yalnız ≥ 4 karakterli, araç adı olmayan, olay/ambiyans olmayan tokenlarla.
 * < 4 karakterli tokenlar (rm, ls, jq, tsc, rea, fix, bug, zip, tar) yalnız bir ad parçasına tam eşit olduğunda.
 * Birden çok aday → en yüksek öncelik; eşitlikte olasılık ağırlığıyla tohumdan.
 */
export function keywordAct(names: readonly string[], prose: string | undefined, seed: string): string | undefined {
  const nameHay = names.filter(Boolean).map(fold)
  const parts = new Set(nameHay.flatMap(n => n.split(/[^0-9a-zçğıöşüâîû]+/)).filter(Boolean))
  // 'geri çevir' (revert) çeviri değildir: düzyazıdan düşer
  const text = prose ? fold(prose).replace(/geri\s+çevir[0-9a-zçğıöşü]*/g, ' ') : ''
  const found = new Set<string>()
  for (const [tok, id] of ACT_TRIGGERS) {
    const e = ACTS[id]
    if (!e) continue
    if (tok.length < 4) {
      if (parts.has(tok) || nameHay.includes(tok)) found.add(id)
      continue
    }
    if (nameHay.some(h => hasToken(h, tok))) {
      found.add(id)
      continue
    }
    if (text && !TOOL_ONLY.has(tok) && e.cls === 'gorev' && hasToken(text, tok)) found.add(id)
  }
  // düzyazıda Türkçe/İngilizce kökler (çekimli hâlleriyle): "logoyu çiz", "bir resim çizer", "draw the icon"
  if (text) for (const [rx, id] of PROSE_STEMS) if (rx.test(text)) found.add(id)
  if (found.size === 0) return undefined
  // uzun token önce sıralı: validate-data funnel-filter'ı bulduysa yalın validate'in test-tube'u düşer (kural 6)
  if (found.has('funnel-filter') && names.concat(prose ?? '').some(s => /validate-data/i.test(s))) found.delete('test-tube')

  return byPrio([...found], seed)
}

/** manifestte tek sözcük olarak bulunmayan, görev metninde sık geçen kökler */
// İngilizce kökler tam sözcük ('logout', 'drawer' eşleşmez); Türkçe kökler çekim ekleriyle; 'geri çevir' (revert) çeviri değildir
const B = '(^|[^0-9a-zçğıöşü])'
const E = '(?![0-9a-zçğıöşü])'
const PROSE_STEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`${B}(çiz(?!elge)|logo(yu|su|lar|ları|nun|ya)?${E}|resim|resm[iİ]|illüstrasyon|(draw|draws|drawing|paint|paints|painting)${E})`), 'paint-canvas'],
  [new RegExp(`${B}(beste|melodi)`), 'music-compose'],
  [new RegExp(`${B}(?<!geri\\s)(çevir|tercüme)`), 'dictionary-translate'],
]

/** en yüksek öncelik; eşitse olasılık ağırlığıyla (tohumlu) */
function byPrio(ids: readonly string[], seed: string): string | undefined {
  let top = -Infinity
  for (const id of ids) top = Math.max(top, ACTS[id]?.prio ?? -Infinity)
  const best = ids.filter(id => (ACTS[id]?.prio ?? -Infinity) === top).sort()
  if (best.length <= 1) return best[0]
  const total = best.reduce((a, id) => a + (ACTS[id]?.prob ?? 1), 0)
  let r = frac(seed) * total
  for (const id of best) {
    r -= ACTS[id]?.prob ?? 1
    if (r < 0) return id
  }

  return best[best.length - 1]
}

// ——— araç → etkinlik (§3.4) ————————————————————————————————————

const RX = {
  image: /\.(png|jpe?g|gif|webp|bmp)$/i,
  logish: /\.log$|stack|trace|crash/i,
  memory: /MEMORY\.md|CLAUDE\.md|AGENTS\.md|[\\/]memory[\\/]/i,
  doc: /\.(md|txt|docx?|tex|rst|mdx)$/i,
  test: /\b(pytest|jest|vitest|mocha)\b|\b(npm|pnpm|yarn|bun) (run )?test\b|\bcargo test\b|\bgo test\b|\bclaude(\.exe)? plugin test\b/i,
  // ana dal refspec'in kendisi olmalı ('feature/main-fix' değil); 'cat vercel.json' ve '--dry-run' yayın değil
  deploy: /\bwrangler deploy\b|(^|[;&|]\s*)(npx\s+)?vercel(\s+(deploy|--prod)\b|\s*($|[;&|]))|\bnpm publish\b(?![^;&|]*--dry-run)|\bgit push\b[^;&|]*\s(\S+\s+)?(HEAD:|\+)?(main|master|prod|production)(?=\s|$|[;&|])/i,
  git: /\bgit (commit|merge|rebase|checkout -b|switch -c|branch|worktree|push|tag)\b|\bgh pr (create|merge)\b/i,
  tail: /\btail -f\b|Get-Content .* -Wait/i,
  compile: /\b(npm|pnpm|yarn|pip|uv|cargo) (install|i|ci|add|build)\b|\btsc\b|\bnpx .*tsc|\bcargo build\b|\bmake\b|\bdotnet build\b/i,
  archive: /\b(zip|tar|7z|Compress-Archive|robocopy)\b|\bcp -r\b/i,
  broom: /(^|[;&|]\s*)(rm|del|Remove-Item)\b|\blint --fix\b|\beslint --fix\b|\bprettier\b|\bruff format\b|\bblack\b/i,
  db: /\b(sqlite3|psql|mysql|supabase)\b/i,
  funnel: /\bjq\b|\bawk\b|\bsort\b|\buniq\b|Where-Object|Select-Object/i,
  abacus: /\bpython3? -c\b|\bbc\b|\bexpr\b/i,
  diff: /\bdiff\b|\bcmp\b|\bfc\b|Compare-Object|\bgit diff\b/i,
  ls: /^\s*(ls|tree|dir|Get-ChildItem)\b/i,
  find: /\b(find|rg|grep|Select-String)\b/i,
  curl: /\b(curl|wget|Invoke-WebRequest|iwr)\b/i,
  watch: /\bgh (pr checks|pr status|run (list|view|watch))\b|\bgit (status|log)\b/i,
  grepErr: /error|exception|traceback|panic|fail/i,
  rate: /429|rate.?limit|overloaded|529|server busy/i,
  handoff: /devret|handoff|devir/i,
}

/** iz işaretleri bu kadar yaşlıysa artık sayılmaz (eski hata, eski denetim kalıcı iz bırakmaz) */
export const RECENT_MS = 5 * 60_000

/** son 8 işaretten, son 5 dk içindeki biri koşulu sağlıyor mu */
const recent = (trail: readonly ActMark[], now: number, test: (m: ActMark) => boolean): boolean => trail.slice(-8).some(m => now - m.t <= RECENT_MS && test(m))

/** son işaretlerden koşulu taşıyan en yenisi, onu silen (`clear`) bir işaretten sonra gelmiyorsa */
function lastOn(trail: readonly ActMark[], now: number, on: (m: ActMark) => boolean, clear: (m: ActMark) => boolean): boolean {
  const list = trail.slice(-8).filter(m => now - m.t <= RECENT_MS)
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i] as ActMark
    if (clear(m)) return false
    if (on(m)) return true
  }

  return false
}
/** yakın zamanda hata var ve ardından geçen bir test onu silmedi */
const failedOn = (trail: readonly ActMark[], now: number): boolean => lastOn(trail, now, m => m.f === 1, m => m.s === 'ok')
/** denetim sürüyor: son denetim işareti, bulgu raporundan (done) sonra */
const auditOn = (trail: readonly ActMark[], now: number): boolean => lastOn(trail, now, m => m.s === 'audit' || m.s === 'security', m => m.s === 'done')

type Short = { name: string; server?: string; short: string }
function toolName(tool: string): Short {
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__')

    return { name: tool, server: parts[1] ?? '', short: parts[parts.length - 1] ?? '' }
  }

  return { name: tool, short: tool }
}

type Hit = { id?: string; mark?: Omit<ActMark, 't' | 'id'>; none?: true; force?: true }

/** Skill satırları: adı (eklenti öneki dahil) kalıba göre */
function skillHit(skill: string): Hit | undefined {
  const s = skill.toLowerCase()
  const has = (rx: RegExp) => rx.test(s)
  if (has(/security-review|claude-security:scan|security-audit/)) return { id: 'shield-guard', mark: { s: 'security' } }
  if (has(/validate-data/)) return { id: 'funnel-filter', mark: { s: 'audit' } }
  if (has(/code-review|(^|:)verify$|office-docs-qa|ux-ui-audit|accessibility-audit/)) return { id: 'checklist-audit', mark: { s: 'audit' } }
  if (has(/engineering:debug|reverse-engineer-anything|debugging-discipline/)) return { id: 'detective-hunt', mark: { s: 'debug', d: 1 } }
  if (has(/simplify|refactor/)) return { id: 'broom-cleanup', mark: { s: 'refactor' } }
  if (has(/(^|:)loop$|(^|:)schedule$/)) return { id: 'watch-lighthouse' }
  if (has(/orkestra|plan-smart-routes|system-design|architecture|write-spec/)) return { id: 'plan-blueprint' }
  if (has(/remotion|hyperframes|video-use|video-shotcraft/)) return { id: 'film-shoot' }
  if (has(/ai-image-video-studio|flux|ideogram|nano-banana/)) return { id: 'paint-canvas' }
  if (has(/ai-music-and-sound|suno/)) return { id: 'music-compose' }
  if (has(/doc-coauthoring|docx|makale|paper/)) return { id: 'quill-write' }
  if (has(/brainstorm|idea-generation/)) return { id: 'idea-bulb' }
  if (has(/data:analyze|statistical-analysis|create-viz|build-dashboard|dataviz/)) return { id: 'chart-grow' }
  if (has(/xlsx/)) return { id: 'spreadsheet-fill' }
  if (has(/translate-content|content-translation/)) return { id: 'dictionary-translate' }
  if (has(/consolidate-memory|import-memory|memory-management|(^|:)kaydet$|(^|:)devam$/)) return { id: 'memory-brain' }
  if (has(/deep-research|research-analyst|primary-source-research|literatur|literature/)) return { id: 'globe-spin' }
  if (has(/purchase-advisor|strateji-test|multi-perspective-decision-wheel/)) return { id: 'scale-compare' }

  return undefined
}

/** MCP kısa adları (sunucudan bağımsız) */
function mcpHit(t: Short): Hit | undefined {
  const s = t.short.toLowerCase()
  const server = (t.server ?? '').toLowerCase()
  if (/^(generate_image|image_fill_area|image_generative_expand)$/.test(s)) return { id: 'paint-canvas' }
  if (/^(image_vectorize|draw_svg_image)$/.test(s)) return { id: 'pixel-sketch' }
  // render bekleme: misir ek katmanı bu işaretle gelir (kural 21)
  if (/^(video_render|video_create_quick_cut|export_video)$/.test(s)) return { id: 'film-shoot', mark: { s: 'video' } }
  if (/^(media_summarize|media_enhance_speech|transcribe)$/.test(s)) return { id: 'headset-listen' }
  if (/^(execute_sql|apply_migration|list_tables)$/.test(s)) return { id: 'database-barrel' }
  if (s === 'update_formulas') return { id: 'abacus-calc' }
  if (/^(update_values|append_values)$/.test(s)) return { id: 'spreadsheet-fill' }
  if (/^(create_draft|forward)$/.test(s) || (/^(reply|send_message)$/.test(s) && /gmail|mail/.test(server))) return { id: 'mail-envelope' }
  if (server.includes('graphify')) {
    if (/^(query_graph|get_node|get_neighbors|shortest_path)$/.test(s)) return { id: 'code-read' }
    if (/^(graph_stats|god_nodes|get_community)$/.test(s)) return { id: 'map-explore' }
  }
  if (/^(create_deployment|deploy_edge_function|deploy)$/.test(s)) return { id: 'deploy-rocket' }
  if (/^(list_deployments|get_deployment|get_status|get_pr_status)$/.test(s)) return { id: 'binoculars' }
  if (/^(clean_up_worktrees|discard_kept_worktree)$/.test(s)) return { id: 'broom-cleanup' }
  if (s === 'scan_secrets') return { id: 'shield-guard', mark: { s: 'security' } }
  if (s === 'update_plan') return { id: 'plan-blueprint' }
  if (s === 'wrap_up') return undefined
  if (/^(list_sessions)$/.test(s)) return { id: 'periscope' }
  if (/^(preview_logs|read_console_messages)$/.test(s)) return { id: 'security-cam' }
  if (s === 'create_scheduled_task') return { id: 'watch-lighthouse' }
  if (s === 'start_session') return { id: 'radio-call' }
  // tarayıcı ekranı, sonra sayfa, sonra web araması
  if (/screenshot|zoom|pdf_to_image|capture/.test(s)) return { id: 'magnify-eye' }
  if (/navigate|fetch|scrape|crawl|make_request/.test(s)) return { id: 'radar-scan' }
  if (/search|consensus|brightdata|research/.test(server + ' ' + s)) return { id: 'globe-spin' }

  return undefined
}

/** Bash/PowerShell komut sınıfları (sırayla) */
function shellHit(cmd: string, bg: boolean): Hit | undefined {
  if (RX.test.test(cmd)) return { id: 'test-tube' }
  if (RX.deploy.test(cmd)) return { id: 'deploy-rocket' }
  if (RX.git.test(cmd)) return { id: 'git-branch' }
  if (bg || RX.tail.test(cmd)) return { id: 'security-cam' }
  if (RX.compile.test(cmd)) return { id: 'compile-wait' }
  if (RX.archive.test(cmd)) return { id: 'archive-boxes' }
  if (RX.broom.test(cmd)) return { id: 'broom-cleanup' }
  if (RX.db.test(cmd)) return { id: 'database-barrel' }
  if (RX.funnel.test(cmd)) return { id: 'funnel-filter' }
  if (RX.abacus.test(cmd)) return { id: 'abacus-calc' }
  if (RX.diff.test(cmd)) return { id: 'scale-compare' }
  if (RX.ls.test(cmd)) return { id: 'map-explore' }
  if (RX.find.test(cmd)) return { id: 'library-shelf' }
  if (RX.curl.test(cmd)) return { id: 'radar-scan' }
  if (RX.watch.test(cmd)) return { id: 'binoculars' }

  return undefined
}

/** Çağrı evresi: araç adı + koşul. `undefined` → anahtar kelimeye geç; `none` → aday yok (mevcut korunur). */
function callHit(f: ToolFacts, trail: readonly ActMark[], seed: string, now: number): Hit | undefined {
  const t = toolName(f.tool)
  const file = f.file ?? ''
  const failedLately = failedOn(trail, now)
  // denetim sürerken okuma/arama denetimin parçasıdır: aday yok, ama iz tazelenir (denetim kendiliğinden sönmez)
  const inAudit: Hit = { none: true, mark: { s: 'audit' } }
  switch (t.name) {
    case 'Read':
      if (RX.image.test(file)) return { id: 'magnify-eye' }
      if (RX.logish.test(file) || failedLately) return { id: 'detective-hunt', mark: { d: 1 } }
      if (auditOn(trail, now)) return inAudit

      return { id: 'code-read' }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      if (RX.memory.test(file)) return { id: 'memory-brain' }
      if ((t.name === 'Write' || t.name === 'Edit') && RX.doc.test(file)) return { id: 'quill-write' }
      if (failedLately || recent(trail, now, m => m.d === 1)) return { id: 'bug-fix' }
      if (recent(trail, now, m => m.s === 'refactor')) return { id: 'broom-cleanup' }

      return { id: 'type-fast' }
    case 'Bash':
    case 'PowerShell': {
      const cmd = f.cmd ?? ''
      if (f.external || readExternal(cmd)) return { id: 'radio-call' }

      return shellHit(cmd, Boolean(f.bg))
    }
    case 'Grep':
    case 'Glob':
    case 'LS':
      if (t.name === 'Grep' && RX.grepErr.test(f.text ?? '')) return { id: 'detective-hunt', mark: { d: 1 } }
      if (auditOn(trail, now)) return inAudit

      return { id: 'library-shelf' }
    case 'WebSearch':
      return { id: 'globe-spin' }
    case 'WebFetch':
      return { id: 'radar-scan' }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return { id: 'plan-blueprint' }
    case 'Agent':
    case 'Task':
    case 'Workflow':
      return { id: 'radio-call' }
    case 'SendMessage':
      if (RX.handoff.test(f.text ?? '')) return { id: 'handoff-baton' }

      return { id: frac(seed) < 0.85 ? 'paper-plane' : 'handoff-baton' }
    case 'ListAgents':
    case 'TaskOutput':
      return { id: 'periscope' }
    case 'Monitor':
      return { id: 'security-cam' }
    case 'CronCreate':
    case 'ScheduleWakeup':
      return { id: 'watch-lighthouse' }
    case 'PushNotification':
    case 'SendUserFile':
      return { id: 'megaphone-announce', force: true }
    case 'AskUserQuestion':
      return { id: 'coffee-break' }
    case 'ReportFindings':
      // rapor denetimi kapatır (done): ardından gelen okumalar yeniden kod okumadır
      return { id: (f.findings ?? 0) > 0 ? 'checklist-audit_fail' : 'checklist-audit', mark: { s: 'done' }, force: true }
    case 'Skill': {
      // skill'ler hep bir kez çağrılır: tanınan skill anında geçer
      const hit = f.skill ? skillHit(f.skill) : undefined
      return hit ? { ...hit, force: true } : undefined
    }
    case 'EnterWorktree':
    case 'ExitWorktree':
      return { id: 'git-branch' }
    case 'Artifact':
      return { id: 'deploy-rocket' }
  }
  if (t.server !== undefined) {
    if (t.short === 'wrap_up') return { id: !failedLately && !f.teamFailed ? 'confetti-party' : 'megaphone-announce', force: true }

    return mcpHit(t)
  }

  return undefined
}

/**
 * Bir araç olayının etkinlik adayı. Çağrı evresinde: araç adı + koşul, yoksa anahtar kelime;
 * sonuç evresinde: ret (shield-guard), 429/529 (queue-ticket), test başarısızlığı (test-tube_fail,
 * error-sparks yok), alt ajan dönüşü (handoff-baton), genel hata (error-sparks + `f`).
 * Tek seferlik ya da olay sınıfı aday `ev`, diğerleri `main` döner.
 */
export function pickActivity(f: ToolFacts, trail: readonly ActMark[], seed: string, now: number): ActPick {
  const mark: ActMark = { t: now }
  const out = (id: string | undefined, extra?: Hit['mark']): ActPick => {
    if (extra) Object.assign(mark, extra)
    if (!id) return { mark }
    mark.id = familyOf(id)

    return isEvent(id) ? { ev: id, mark } : { main: id, mark }
  }
  const t = toolName(f.tool)
  if (f.phase === 'result') {
    // izin reddi: kalkan, hata kıvılcımı yok (kural 5)
    if (f.denied) return { ev: 'shield-guard', mark }
    const shell = t.name === 'Bash' || t.name === 'PowerShell'
    const isTest = shell && RX.test.test(f.cmd ?? '')
    if (f.failed) {
      if (RX.rate.test(f.out ?? '')) return { ev: 'queue-ticket', mark }
      mark.f = 1
      // test kırıldı: varyant anında (tek koşu da yeter), kıvılcım yok (kural 6)
      if (isTest) return { main: 'test-tube_fail', mark: { ...mark, id: 'test-tube' }, force: true }

      return { ev: 'error-sparks', mark }
    }
    // geçen test eski hatayı siler (bug-fix/dedektif/megafon artık ondan beslenmez)
    if (isTest) mark.s = 'ok'
    if (t.name === 'Agent' || t.name === 'Task' || t.name === 'Workflow' || t.short === 'start_session') return { ev: 'handoff-baton', mark }

    return { mark }
  }
  const hit = callHit(f, trail, seed, now)
  if (hit?.none) {
    if (hit.mark) Object.assign(mark, hit.mark)

    return { mark, clearEv: true, keep: true }
  }
  if (hit?.id) return { ...out(hit.id, hit.mark), clearEv: true, ...(hit.force ? { force: true as const } : {}) }
  // anahtar kelime: skill adı, MCP sunucu+kısa ad, ajan türü, komut sözcüğü; düzyazı olarak açıklama
  const names: string[] = []
  if (f.skill) names.push(f.skill)
  if (t.server !== undefined) names.push(`${t.server} ${t.short}`)
  else names.push(t.name)
  if (f.agentType) names.push(f.agentType)
  const word = (f.cmd ?? '').trim().split(/\s+/)[0]
  if (word) names.push(word.replace(/^.*[\\/]/, ''))
  const kw = keywordAct(names, f.text, seed)
  const res = out(kw)
  if (kw === 'detective-hunt') mark.d = 1

  return { ...res, clearEv: true }
}

// ——— kalıcılık (§3.6) ————————————————————————————————————————

const sameFamily = (a: string, b: string): boolean => familyOf(a) === familyOf(b)

/**
 * Kardeş etkinlikler: gerçek işte dönüşümlü gelen araçlar (WebSearch↔WebFetch, Read↔Grep). Birbirini
 * onaylar (A, B → B yerleşir) ve gösterilen kardeşi yalnız tazeler (A gösterilirken tek B onu değiştirmez).
 */
const SIBLINGS: ReadonlyArray<ReadonlySet<string>> = [new Set(['globe-spin', 'radar-scan']), new Set(['code-read', 'library-shelf'])]
export const siblings = (a: string, b: string): boolean => a !== b && SIBLINGS.some(g => g.has(familyOf(a)) && g.has(familyOf(b)))

/** denetim aileleri: denetim izindeki okuma bunları tazeler */
const AUDIT_ACTS: ReadonlySet<string> = new Set(['checklist-audit', 'shield-guard', 'funnel-filter'])

const switchTo = (cur: ActState | undefined, main: string, now: number): ActState => {
  const out: ActState = { ...(cur ?? { at: now, seen: now }), id: main, at: cur?.id === main ? cur.at : now, seen: now }
  delete out.next
  delete out.nextAt

  return out
}

/**
 * 2-kez kuralı: yeni ana etkinlik ancak üst üste iki kez aday olursa geçer (titreme yok).
 * Aynı etkinlik, aynı aileden varyant (test-tube → test-tube_fail) ve güçlü sinyal (`force`) anında;
 * bekleyen adayla aynı aileden ya da kardeş aday onu onaylar; `main` yoksa değişmez.
 */
export function settleAct(cur: ActState | undefined, main: string | undefined, now: number, force = false): ActState {
  if (main === undefined) return cur ?? { at: now, seen: now }
  if (force || !cur || !cur.id || cur.id === main || sameFamily(cur.id, main)) return switchTo(cur, main, now)
  // bekleyen aday aynı aileden (test-tube → test-tube_fail) ya da kardeşse: ikinci sinyal sayılır
  if (cur.next !== undefined && (cur.next === main || sameFamily(cur.next, main) || siblings(cur.next, main))) return switchTo(cur, main, now)
  // gösterilenin kardeşi: gösterilen kalır ve tazelenir; ikinci kez gelirse geçer
  if (siblings(cur.id, main)) return { ...cur, seen: now, next: main, nextAt: now }

  return { ...cur, next: main, nextAt: now }
}

/**
 * Tek seferlik olay: aynı olay süresi içinde yeniden başlamaz; çalışan olaydan düşük öncelikli yeni olay
 * yok sayılır; eşit/yüksek olan değiştirir. Biten olay main'i geri gösterir (main ayrı alanda).
 */
export function withEv(cur: ActState, ev: string | undefined, now: number, until?: number): ActState {
  if (!ev || !ACTS[ev]) return cur
  const run = cur.ev && now < cur.ev.until ? cur.ev : undefined
  if (run) {
    if (run.id === ev) return cur
    if ((ACTS[ev]?.prio ?? 0) < (ACTS[run.id]?.prio ?? 0)) return cur
  }

  return { ...cur, ev: { id: ev, at: now, until: until ?? now + evDuration(ev) } }
}

/** Bir seçimi uygula: settle + ev + (yeni araç çağrısı) kuyruk fişini kes. */
export function applyPick(cur: ActState | undefined, p: ActPick, now: number): ActState {
  let st = settleAct(cur, p.main, now, p.force === true)
  // denetim sürüyor: gösterilen denetim tazelenir, bekleyen denetim adayı onaylanır
  if (p.keep && st.id && AUDIT_ACTS.has(familyOf(st.id))) st = { ...st, seen: now }
  else if (p.keep && st.next && AUDIT_ACTS.has(familyOf(st.next))) st = switchTo(st, st.next, now)
  if (p.clearEv && st.ev?.id === 'queue-ticket' && now < st.ev.until) {
    st = { ...st }
    delete st.ev
  }

  return withEv(st, p.ev, now)
}

/** İz: yalnız bilgi taşıyan işaretler, en çok 8, yeni sonda. */
export function pushMark(trail: readonly ActMark[] | undefined, m: ActMark): ActMark[] {
  const list = (trail ?? []).slice()
  if (m.id === undefined && m.f === undefined && m.d === undefined && m.s === undefined) return list
  const clean: ActMark = { t: m.t }
  if (m.id) clean.id = m.id
  if (m.f) clean.f = 1
  if (m.d) clean.d = 1
  if (m.s) clean.s = m.s
  list.push(clean)

  return list.slice(-8)
}

/** İş bitti: ana etkinlik silinir; başarı konfeti, hata kıvılcım (ev kalır). */
export function endAct(cur: ActState | undefined, isFailed: boolean, now: number): ActState {
  const base: ActState = { ...(cur ?? { at: now, seen: now }) }
  delete base.id
  delete base.next
  delete base.nextAt

  return withEv(base, isFailed ? 'error-sparks' : 'confetti-party', now)
}

/** İşe başlarken: dış işçi kulaklık + 3 sn telsiz; Explore haritalı/raflı; aksi görev metninden. */
export function hireAct(task: string | undefined, agentType: string | undefined, external: boolean, seed: string, now: number): ActState | undefined {
  if (external) return { id: 'headset-listen', at: now, seen: now, ev: { id: 'radio-call', at: now, until: now + evDuration('radio-call') } }
  let id: string | undefined
  if (agentType === 'Explore') id = hash(seed) % 10 < 6 ? 'map-explore' : 'library-shelf'
  else id = keywordAct(agentType ? [agentType] : [], task, seed)
  if (!id) return undefined
  if (isEvent(id)) return withEv({ at: now, seen: now }, id, now)

  return { id, at: now, seen: now }
}

// ——— çizim anı görünümü (§3.8) ——————————————————————————————————

const QUIET: ReadonlySet<Activity> = new Set<Activity>(['idle', 'waiting', 'done', 'failed', 'leaving'])
const HEADISH = new Set(['kafa', 'kafa_govde', 'goz'])
const HOLD_MS = 60_000
const COMPILE_MS = 8000
const COFFEE_MS = 2 * 60_000
const NAP_MS = 10 * 60_000
const LONG_JOB_MS = 30 * 60_000

/**
 * Çizim anında bir işçinin etkinlik görünümü: saf ve deterministik (aynı w, ctx → aynı görünüm).
 * Ana etkinlik, olay (süresi içinde), üst yük göstergesi, şapka, ek katman, etiket ve hız.
 */
export function actView(w: Worker, ctx: ActCtx): ActView {
  const now = ctx.now
  const a = w.activity
  const speed = FATIGUE_SPEED[ctx.fat]
  const view: ActView = { speed }
  if (a === 'leaving') return view
  const part = (id: string, at: number): ActPart => ({ id, strip: stripFor(id, ctx.kind), at })
  const st = w.act
  const ev = st?.ev && now >= st.ev.at && now < st.ev.until ? st.ev : undefined
  if (ev) view.ev = { ...part(ev.id, ev.at), until: ev.until }
  if (a === 'done' || a === 'failed') return view

  let main: ActPart | undefined
  let over: ActPart | undefined
  const busy = !QUIET.has(a)
  // ajanın kendi etkinliği: şu anki araç onu doğruladıysa (süresiz) ya da son 60 sn içinde doğrulandıysa.
  // Onaylanmamış yeni bir araç dakikalar önceki bayat etkinliği geri getirmez (görünüm düzeyinde titreme yok).
  const own = st?.id && a !== 'idle' && (st.seen >= w.since || now - st.seen < HOLD_MS) ? st.id : undefined
  if (own) main = part(own, st?.at ?? w.since)
  // bu aracın tanıdığı ama henüz onaylanmamış aday (uzun test, git, veritabanı komutu)
  const pending = st?.next && (st.nextAt ?? -Infinity) >= w.since && !isEvent(st.next) ? st.next : undefined

  if (ctx.isBoss) {
    const pct = ctx.ctxPct
    if ((pct !== undefined && pct >= 95) || a === 'compacting' || ctx.limitFull) {
      main = part('nap-zzz', w.since)
    } else {
      if (pct !== undefined && pct >= 85) over = part('overheat-sweat', w.since)
      // ekip çalışırken kendi işi olmayan patron gözetler (düşünürken de araç kullanırken de: aralarında gidip gelmez)
      if (!own && busy && ctx.teamBusy > 0) main = part(ctx.criticBusy ? 'checklist-audit' : 'binoculars', w.since)
      if (a === 'waiting') main = part('coffee-break', w.since)
    }
  } else {
    if (a === 'idle' && w.idleSince === undefined) {
      const quiet = now - w.since
      if (quiet >= NAP_MS) main = part('nap-zzz', w.since + NAP_MS)
      else if (quiet >= COFFEE_MS) main = part('coffee-break', w.since + COFFEE_MS)
    }
    if (a === 'waiting') main = part('coffee-break', w.since)
    if (busy && (now - w.joinedAt > LONG_JOB_MS || w.tools >= 150)) over = part('overheat-sweat', w.since)
  }
  // ön planda 8 sn'yi geçen komut (kural 15): tanındıysa (bekleyen aday bu araçtan) o gösterilir,
  // tanınmadıysa derleme; bu araç act'i doğruladıysa (seen ≥ since) hiçbiri
  if (a === 'running' && (w.tool === 'Bash' || w.tool === 'PowerShell') && w.kind !== 'external' && !(st && st.id && st.seen >= w.since) && now - w.since >= COMPILE_MS) {
    main = part(pending ?? 'compile-wait', w.since + COMPILE_MS)
  }

  // yorgunluk
  if (busy && ctx.fat >= 2 && main?.id !== 'nap-zzz') over = part('overheat-sweat', w.since)
  if (ctx.fat === 3) {
    const prio = entry(main?.id)?.prio ?? 0
    if (busy && (!main || prio < 70) && main?.id !== 'nap-zzz') {
      main = part('overheat-sweat', w.since)
      over = undefined
    } else if (!busy && main && main.id !== 'nap-zzz') {
      main = part('nap-zzz', w.since)
    }
  }
  if (main?.id === 'overheat-sweat') over = undefined
  if (over) {
    // kafa ankerli ana etkinlik varken üst gösterge binmez (olay buna bakmaz: bitişi resmi değiştirmesin)
    if (!(main && HEADISH.has(entry(main.id)?.anchor ?? ''))) view.over = over
  }
  if (main) view.main = main
  if (view.main?.id === 'detective-hunt') view.hat = true
  if (main?.id === 'film-shoot') {
    const last = (w.trail ?? []).slice(-1)[0]
    if (last?.s === 'video' && hash(`${w.id}${main.at}`) % 2 === 0) view.extra = [part('film-shoot_misir', main.at)]
  }
  // etiket yalnız ana etkinlikten: olay kendi animasyonuyla biter, bitişinde plakayı değiştirip
  // ikinci bir yeniden çizim istemez (§6.3); beklerken "Seni bekliyor" kalır
  if (a !== 'waiting' && view.main) {
    const id = view.main.id
    view.label = ctx.external && familyOf(id) === 'headset-listen' ? EXTERNAL_LABEL : ACT_LABEL[id]
  }

  return view
}

// ——— bütçe (§5) ————————————————————————————————————————————

/** etkinlik defs'i için başlangıç tavanı (karakter seti tipik 24–30 k) */
export const ACT_CAP = 20_000
/** gövdedeki bir kullanımın tahmini maliyeti */
export const ACT_USE_EST = 300
const STYLE_BASE = '.acb{transform-box:fill-box;transform-origin:50% 100%}'

function stripSymbol(key: string): string {
  const s = ACT_STRIPS[key]
  if (!s) return ''
  const w = s.n * s.fw

  return `<symbol id="ac-${key}" viewBox="0 0 ${w} ${s.fh}" width="${w}" height="${s.fh}"><image href="data:image/png;base64,${s.b64}" width="${w}" height="${s.fh}" style="image-rendering:pixelated"/></symbol>`
}

/** bir şeridin tam maliyeti: sembol + o etkinliğin CSS'i */
export function actCost(strip: string, id: string): number {
  return stripSymbol(strip).length + (ACT_CSS[id]?.length ?? 0)
}

/** şerit → etkinlik id'si (CSS'i için) */
function idOfStrip(strip: string): string {
  if (ACTS[strip]) return strip
  for (const e of Object.values(ACTS)) if (e.strip.def === strip || Object.values(e.strip).includes(strip)) return e.id

  return strip
}

/** olaylara ayrılan pay: tipik bir olay şeridi + kullanımı (ana etkinlikler olaylardan bağımsız planlanır) */
export const EV_RESERVE = 1600

/**
 * Hangi şeritler gömülür. Önce kalıcı parçalar, olaylardan bağımsız ve `cap − olay payı` içinde: patronun
 * parçaları → ana etkinlikler (öncelik azalan) → üst → mısır/şapka; eşitlikte kullanıcı sayısı azalan, sonra
 * ad (aynı girdi aynı küme: titreme yok). Sonra olaylar (patronunki önce), kalan pay ve ayrılmış payla `cap`
 * içinde. Böylece bir işçinin konfetisi başka bir işçinin prop'unu düşürmez; olaylı ve olaysız resim aynı
 * kalıcı kümeyi taşır (settled anahtar olayla değişmez). Sığmayan düşer (figür normal durumunda).
 */
export function planActs(views: ReadonlyMap<string, ActView>, cap: number): Set<string> {
  type Cand = { strip: string; id: string; rank: number; prio: number; users: Set<string> }
  const lasting = new Map<string, Cand>()
  const events = new Map<string, Cand>()
  const add = (into: Map<string, Cand>, who: string, p: ActPart | undefined, rank: number) => {
    if (!p) return
    const prio = ACTS[p.id]?.prio ?? 0
    const c = into.get(p.strip)
    if (c) {
      c.users.add(who)
      if (rank < c.rank || (rank === c.rank && prio > c.prio)) {
        c.rank = rank
        c.prio = prio
      }
    } else {
      into.set(p.strip, { strip: p.strip, id: p.id, rank, prio, users: new Set([who]) })
    }
  }
  for (const [who, v] of views) {
    const boss = who === 'boss'
    add(events, who, v.ev, boss ? 0 : 1)
    add(lasting, who, v.main, boss ? 0 : 2)
    add(lasting, who, v.over, boss ? 0 : 3)
    for (const x of v.extra ?? []) add(lasting, who, x, boss ? 0 : 4)
    if (v.hat) add(lasting, who, { id: 'detective-hunt_sapka', strip: 'detective-hunt_sapka', at: 0 }, boss ? 0 : 4)
  }
  // bir şerit hem kalıcı hem olay olarak isteniyorsa kalıcı planda sayılır (olay onu ayrıca istemez)
  for (const s of lasting.keys()) events.delete(s)
  const sorted = (m: Map<string, Cand>) => [...m.values()].sort((a, b) => a.rank - b.rank || b.prio - a.prio || b.users.size - a.users.size || (a.strip < b.strip ? -1 : a.strip > b.strip ? 1 : 0))
  const allowed = new Set<string>()
  const cssPaid = new Set<string>()
  let total = STYLE_BASE.length + 16
  const fill = (order: Cand[], ceiling: number) => {
    for (const c of order) {
      const css = cssPaid.has(c.id) ? 0 : ACT_CSS[c.id]?.length ?? 0
      const cost = stripSymbol(c.strip).length + css + c.users.size * ACT_USE_EST
      // sığmayan düşer, ondan sonrakiler de: düşenler hep en düşük öncelikliler (monoton, titremesiz)
      if (total + cost > ceiling) break
      total += cost
      allowed.add(c.strip)
      cssPaid.add(c.id)
    }
  }
  fill(sorted(lasting), cap - Math.min(EV_RESERVE, cap / 4))
  fill(sorted(events), cap)

  return allowed
}

const used = new Map<string, string>()

/** çizimde kullanılan şeridi kaydet (charDefs'teki uses gibi) */
export function actUse(strip: string, id: string): void {
  used.set(strip, id)
}

/** Yalnız kullanılan ∩ izinli şeritlerin <symbol>'leri + tek <style>; kaydı temizler. */
export function actDefs(allowed: ReadonlySet<string>): string {
  const keys = [...used.keys()].filter(k => allowed.has(k)).sort()
  const ids = new Set<string>()
  for (const k of keys) ids.add(used.get(k) ?? idOfStrip(k))
  used.clear()
  if (keys.length === 0) return ''
  let css = STYLE_BASE
  for (const id of [...ids].sort()) css += ACT_CSS[id] ?? ''

  return keys.map(stripSymbol).join('') + `<style>${css}</style>`
}

/** etkinlik ailesi (testler ve HUD için): varyantsız ana kayıtlar */
export const MAIN_ACTS: readonly string[] = Object.values(ACTS)
  .filter(e => e.role === 'ana')
  .map(e => e.id)
