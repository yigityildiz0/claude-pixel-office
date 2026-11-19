// Piksel Ofis 0.9: iş türüne göre etkinlik animasyonları (tasarım v5).
// Bir işçinin son araçları/görevi/durumu → etkinlik (resim çiziyor, kod yazıyor, dedektif avında…).
// Bu dosya saftır: rastgelelik yok (her "olasılık" hash(seed) ile), saat yok (now dışarıdan gelir).
// Ham komut, yol ya da metin hiçbir zaman kalıcı duruma yazılmaz; yalnız türetilmiş işaretler (ActMark).
//
// Akış: tool.call → pickActivity (aday) → settleAct (2-kez kuralı: titreme yok) + withEv (tek seferlik
// olay) → Worker.act/trail. Çizim anında actView süre/bağlam/yorgunluk/ambiyansı türetir, planActs
// bütçeye göre hangi şeritlerin gömüleceğini seçer, actDefs yalnız kullanılanları yazar.
import type { ActLoop, ActMark, ActState, Activity, FaultCode, Worker } from '../types'
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
  /** Cetvel'in doğrulanmış model isteği hata türü; araç çıktısından türetilmez. */
  apiFault?: 'rate_limit'
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
  /** En dolu kullanım penceresi (kullanılmış yüzde); ölçüm yoksa uyarı türetilmez. */
  limitPct?: number
  /** 5 saatlik hak %100 */
  limitFull: boolean
  /** meşgul ekip üyesi sayısı (patronun gözetlemesi için) */
  teamBusy: number
  /** meşgul bir denetçi/kontrolcü var (patron hakemlik yapar) */
  criticBusy: boolean
  /** ofis genelinde süren küresel kilit/ağ döngüsü (varsa tüm çalışanlara yansır) */
  globalLoop?: ActLoop
  kind: CharKind
  external: boolean
}
export type ActPart = { id: string; strip: string; at: number }
export type ActView = {
  main?: ActPart
  ev?: ActPart & { until: number }
  /** üst: ana etkinliğin üstüne binen yük göstergesi (overheat-sweat) */
  over?: ActPart
  /** detective-hunt şapkası (başın üstüne oturur) */
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
  'giris-gerek': 'Giriş gerekli',
  'kota-haftalik': 'Haftalık kota',
  'kota-oturum': 'Kota doldu',
  iptal: 'Durduruldu',
  'izin-bekle': 'İzin bekliyor',
  'izin-onay': 'Onaylandı',
  'asiri-yuk-529': 'Aşırı yük',
  'asiri-yuk-durdu': 'Yükten durdu',
  'ag-kopuk': 'Ağ koptu',
  'zaman-asimi': 'Zaman aşımı',
  'baglam-asildi': 'Bağlam taştı',
  'sonsuz-dongu': 'Tekrar döngüsü',
  sikistirma: 'Sıkıştırıyor',
  'hata-serisi': 'Tekrarlı hata',
  toparlandi: 'Toparlandı',
  // 1.2: katalog ikinci dilim
  'soru-bekle': 'Cevap bekliyor',
  'sunucu-500': 'Sunucu hatası',
  'derleme-hata': 'Derleme kırıldı',
  'komut-zaman-asimi': 'Komut zaman aştı',
  'alt-ajan-yok': 'Alt ajan dönmedi',
  'alt-ajan-dustu': 'Hatayla düştü',
  'kredi-bitti': 'Kredi bitti',
  'cok-buyuk-413': 'İstek çok büyük',
  'cikti-siniri': 'Çıktı sınırı',
  'hesap-kilit': 'Hesap kilitli',
  'kota-devam': 'Kota yenilendi',
  'kota-devam-yok': 'Alarm kurulamadı',
  'akis-yarim': 'Yanıt yarım',
  sertifika: 'Mühür geçersiz',
  'baglam-uyari': 'Bağlam doluyor',
  'model-reddi': 'Bunu yapamam',
  'model-yok': 'Yanlış kapı',
  'gecersiz-istek': 'Form geri döndü',
  'model-gecis': 'Model değişti',
  'arac-cozulemedi': 'Kablo düğüm',
  'uzun-dusunme': 'Derin düşünüyor',
  'kural-engeli': 'Kural engelledi',
  'mcp-kopuk': 'Araç hattı koptu',
  'komut-hata': 'Komut durdu',
  'test-kirik': 'Deney kırıldı',
  'dosya-yok': 'Raf boş',
  'disk-dolu': 'Arşiv dolu',
  'git-catisma': 'Dallar düğüm',
  'isci-coktu': 'Hat koptu',
  'kota-az': 'Kota azalıyor',
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

/** karakter türünün şeridi (sonsuz-dongu: turuncu → _turuncu, yesil → _yesil, mavi → _mavi), yoksa ortak şerit */
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
    case 'kota-devam':
    case 'disk-dolu':
    case 'git-catisma':
      return 2500
    case 'akis-yarim':
    case 'gecersiz-istek':
    case 'arac-cozulemedi':
    case 'dosya-yok':
      return 1800
    case 'kural-engeli':
      return 1500
    case 'komut-hata':
      return 1000
    case 'kota-devam-yok':
    case 'sertifika':
    case 'model-reddi':
    case 'model-yok':
    case 'model-gecis':
    case 'mcp-kopuk':
    case 'test-kirik':
    case 'isci-coktu':
      return 2000
    case 'baglam-uyari':
    case 'kota-az':
    case 'uzun-dusunme':
      return 180_000
    case 'handoff-baton':
    case 'shield-guard':
      return 2000
    case 'confetti-party':
      return 1600
    case 'radio-call':
      return 3000
    case 'iptal':
      return 1500
    case 'error-sparks':
      return 1200
    case 'baglam-asildi':
    case 'cikti-siniri':
      return 2500
    case 'sunucu-500':
    case 'derleme-hata':
    case 'komut-zaman-asimi':
      return 2000
    case 'alt-ajan-dustu':
    case 'cok-buyuk-413':
      return 2200
    case 'izin-onay':
      return 600
    case 'asiri-yuk-durdu':
      return 1800
    case 'toparlandi':
      return 1400
    case 'queue-ticket':
    case 'asiri-yuk-529':
    case 'hata-serisi':
      return 60_000
    case 'zaman-asimi':
      return 20_000
    case 'sikistirma':
      return 30_000
    case 'ag-kopuk':
    case 'sonsuz-dongu':
      return 180_000
    case 'giris-gerek':
    case 'kota-haftalik':
    case 'kota-oturum':
    case 'kredi-bitti':
    case 'izin-bekle':
    case 'soru-bekle':
    case 'alt-ajan-yok':
      return 1_800_000
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
  rate429: /\b429\b|rate.?limit|too many requests|exhausted your capacity/i,
  overloaded: /repeated 529|high load|overloaded_error|\b529\b/i,
  ctxOver: /prompt is too long|context.?window.?exceeded|maximum context length|context_length_exceeded/i,
  net: /unable to connect|socket is closed|connection lost|stream disconnected|econnreset|econnrefused|enotfound|etimedout|network unreachable|network error/i,
  timeout: /timed out|no response from api|stream idle timeout|\btimeout\b/i,
  weekly: /\bweekly\b|7[- ]?day|seven_day|haftalık/i,
  sessionLim: /session limit|5[- ]?hour|five_hour|oturum kot/i,
  vagueUsage: /usage limit/i,
  auth: /authentication_failed|cloud_credential_error|auth_storage_failure|please run \/login|oauth token (expired|revoked)|exceeded retry limit.*401|\b401\b.*unauth/i,
  // 1.2: yalnız API/oturum kaynağının metninde okunur (kural 11)
  billing: /billing_error|credit balance is too low|insufficient (credit|credits|balance|funds)|spend(ing)? limit (reached|exceeded)|\b402\b.*payment/i,
  tooLarge: /request_too_large|request too large|image was too large|image (exceeds|is too large)|\b413\b/i,
  http500: /api error:?\s*50\d\b|internal server error|\bapi_error\b/i,
  // bildirim türü (kanca alanı): soru, girdi ya da MCP form isteği
  askNote: /^(idle_prompt|agent_needs_input|elicitation_dialog|elicitation_url_dialog)$/i,
  // kabukta derleme/tip denetimi komutu: bir aşamanın *başındaki* araç (çıktı değil; 'cat tsc.json' derleme değil)
  buildHead: /^(?:cargo (build|check|clippy)\b|tsc(\.cmd|\.exe)?(?![\w.-])|(npm|pnpm|yarn|bun) (run )?(build|typecheck|type-check)(?![\w.-])|vite build\b|next build\b|dotnet build\b|msbuild(\.exe)?(?![\w.-])|go (build|vet)\b|gradlew?(\.bat)? (build|assemble|compile\w*)\b|mvnw? (compile|package|install)\b|cmake --build\b|make(\.exe)?(?![\w.-])|claude(\.exe)? plugin validate\b)/i,
  // derlemeden sonra gelip kendi başına düşmeyen aşamalar (süzgeç, arama, yankı): hata yine derlemenindir
  buildFollower: /^(grep|egrep|fgrep|rg|findstr|Select-String|sls|tail|head|Select-Object|select|tee|Tee-Object|Out-String|Out-Host|Out-Null|more|less|sort|uniq|wc|echo|Write-Host|Write-Output|printf|true)$/i,
  grepCmd: /\b(grep|egrep|fgrep|rg|findstr|Select-String)\b/i,
  grepFatal: /\b(enoent|eacces|no such file|permission denied|syntax error|invalid option|unrecognized|exit code [2-9]|exit code \d{2,}|timed out)\b/i,
  handoff: /devret|handoff|devir/i,
}

/**
 * Tırnak içi metni boşaltır (komut değildir). Kabuğun kendi kaçışıyla: Bash'te `\"`, PowerShell'de `` `" ``
 * ve `''`; PowerShell'de ters bölü kaçış değildir (`"C:\dir\"` orada biter).
 */
export function stripQuotes(cmd: string, tool?: string): string {
  return tool === 'PowerShell' ? cmd.replace(/"(?:[^"`]|`.)*"|'(?:[^']|'')*'/g, '""') : cmd.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
}

/** Komutun aşamaları (boru, zincir, satır), tırnak içi atlanmış. */
function stagesOf(cmd: string, tool?: string): string[] {
  return stripQuotes(cmd, tool)
    .split(/\|\|?|&&|;|\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Aşamanın önek ayıklanmış hali: ortam ataması, sudo/npx/& gibi önekler ve başındaki yol atılır. */
function stageCore(stage: string): string {
  const words = stage.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] as string) || /^(sudo|command|xargs|nice|time|&|npx|-y|--yes)$/i.test(words[i] as string))) i++
  const rest = words.slice(i)
  if (rest.length === 0) return ''
  rest[0] = (rest[0] as string).replace(/^.*[\\/]/, '')

  return rest.join(' ')
}

/** Aşamanın aracının adı (yol ve .exe atılmış). */
const headOf = (stage: string): string => (stageCore(stage).split(' ')[0] ?? '').replace(/\.exe$/i, '')

/** Komutun son süreci (boru/zincirin sonu; tırnak içi atlanır) bir arama aracı mı? Çıkış kodu ondan gelir. */
function lastStageIsGrep(cmd: string, tool?: string): boolean {
  const stages = stagesOf(cmd, tool)
  const head = headOf(stages[stages.length - 1] ?? '')

  return RX.grepCmd.test(head) && /^(grep|egrep|fgrep|rg|findstr|Select-String)$/i.test(head)
}

/**
 * Başarısız kabuk komutu bir derleme mi (#36)? Bir aşama derleme aracıyla *başlamalı* ve ondan sonra yalnız
 * kendi başına düşmeyen aşamalar (süzgeç, arama, yankı) gelmeli: `cargo build && ./app` düştüğünde hatanın
 * kimin olduğu bilinmez, derleme sayılmaz. Test çalıştıran komut kendi şişesini gösterir (1.0 kural 6).
 */
export function isBuildCmd(cmd: string, tool?: string): boolean {
  const stages = stagesOf(cmd, tool)
  if (stages.length === 0 || stages.some(s => RX.test.test(s))) return false
  let at = -1
  for (let i = stages.length - 1; i >= 0; i--) {
    if (RX.buildHead.test(stageCore(stages[i] as string))) {
      at = i
      break
    }
  }
  if (at < 0) return false

  return stages.slice(at + 1).every(s => RX.buildFollower.test(headOf(s)))
}

/**
 * grep / findstr / rg eşleşme bulamadığında (çıkış 1) hata sayılmaz (katalog #33). Yalnız komutun son
 * süreci arama aracıysa ve çıktıda "Exit code 1" / "eşleşme yok" dışında hiçbir şey yoksa; gerçek hata
 * metni taşıyan çıktı (FAIL satırı, derleme hatası) ya da başka bir son süreç hata sayılır.
 */
export function isGrepEmpty(tool: string, cmd?: string, out?: string): boolean {
  const clean = (out ?? '').trim()
  if (clean && RX.grepFatal.test(clean)) return false
  const body = clean
    .replace(/^exit code 1\b[:.]?/i, '')
    .replace(/\b(no matches( found)?|0 matches( found)?|nothing found)\b[.!]?/gi, '')
    .trim()
  if (tool === 'Grep') return body === ''
  if ((tool === 'Bash' || tool === 'PowerShell') && lastStageIsGrep(cmd ?? '', tool)) return body === ''

  return false
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
      if (f.apiFault === 'rate_limit') return { ev: 'queue-ticket', mark }
      const out = f.out ?? ''
      if (isGrepEmpty(t.name, f.cmd, out)) return { mark }
      // 1.0 sırası korunur: araç çıktısındaki "timeout", "ECONNREFUSED" gibi sözcükler API arızası değildir
      // (kırık test kırık testtir); ağ, zaman aşımı ve bağlam döngüleri yalnız API kaynaklı sinyalden gelir
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

const LOCK_LOOPS: ReadonlySet<string> = new Set(['giris-gerek', 'hesap-kilit', 'kota-haftalik', 'kota-oturum', 'kredi-bitti'])
const API_LOOPS: ReadonlySet<string> = new Set(['queue-ticket', 'asiri-yuk-529', 'ag-kopuk', 'zaman-asimi'])
const TOOL_LOOPS: ReadonlySet<string> = new Set(['izin-bekle', 'soru-bekle', 'sikistirma', 'sonsuz-dongu', 'hata-serisi'])
/** süresiz bekleme döngüleri: çözülme sinyaline dek sürer, 30 dk sonra uyuklamaya iner (kural 6) */
const WAIT_LOOPS: ReadonlySet<string> = new Set(['giris-gerek', 'hesap-kilit', 'kota-haftalik', 'kota-oturum', 'kredi-bitti', 'izin-bekle', 'soru-bekle', 'alt-ajan-yok'])

/**
 * Döngü olarak (ActLoop) oynayan her senaryo: süresince ana etkinliğin yerine geçer. Geri kalan olay
 * kayıtları olay katmanında (ev) tek seferlik oynar. Tek seferlik/döngü tablosu bundan üretilir.
 */
export const LOOP_ACTS: ReadonlySet<string> = new Set([...LOCK_LOOPS, ...API_LOOPS, ...TOOL_LOOPS, ...WAIT_LOOPS, 'baglam-asildi', 'baglam-uyari', 'kota-az', 'uzun-dusunme'])
/** süresiz bekleme döngüsü mü (TTL yok, 30 dk sonra uyuklama) */
export const isWaitLoop = (id: string): boolean => WAIT_LOOPS.has(id)

/** Özgün olan genel olanı ve üst engel alt engeli bastırır (katalog kural 4 & #12, #41). */
const SUPPRESSES: Readonly<Record<string, ReadonlySet<string>>> = {
  'giris-gerek': new Set(['queue-ticket', 'asiri-yuk-529', 'ag-kopuk', 'zaman-asimi']),
  'hesap-kilit': new Set(['queue-ticket', 'asiri-yuk-529', 'ag-kopuk', 'zaman-asimi']),
  'kota-haftalik': new Set(['kota-oturum', 'queue-ticket', 'asiri-yuk-529', 'ag-kopuk', 'zaman-asimi']),
  'kota-oturum': new Set(['queue-ticket', 'asiri-yuk-529', 'ag-kopuk', 'zaman-asimi']),
  'kredi-bitti': new Set(['queue-ticket', 'asiri-yuk-529', 'ag-kopuk', 'zaman-asimi']),
  'ag-kopuk': new Set(['queue-ticket', 'asiri-yuk-529', 'zaman-asimi']),
  'sonsuz-dongu': new Set(['hata-serisi']),
}

const isSuppressedBy = (loops: readonly ActLoop[], id: string): boolean =>
  loops.some(l => l.id !== id && (SUPPRESSES[l.id]?.has(id) ?? false))

/** Süresi dolmamış en öncelikli döngü (eşitlikte en yeni kazanır; bastırma kuralları uygulanır). */
export function activeLoop(cur: ActState | undefined, now: number): ActLoop | undefined {
  const list = (cur?.loops ?? []).filter(l => l.until === undefined || now < l.until)
  if (list.length === 0) return undefined
  const unmasked = list.filter(l => !isSuppressedBy(list, l.id))
  const pool = unmasked.length > 0 ? unmasked : list
  let best: ActLoop | undefined
  for (const l of pool) {
    const lp = ACTS[l.id]?.prio ?? 0
    const bp = best ? (ACTS[best.id]?.prio ?? 0) : -1
    if (!best || lp > bp || (lp === bp && l.at >= best.at)) best = l
  }

  return best
}

/** Tüm ofis içindeki en öncelikli küresel döngü (kural 7). */
export function globalLoopOf(workers: readonly Worker[], now: number): ActLoop | undefined {
  const globals: ActLoop[] = []
  for (const w of workers) {
    for (const l of w.act?.loops ?? []) {
      if (l.global && (l.until === undefined || now < l.until)) globals.push(l)
    }
  }
  if (globals.length === 0) return undefined
  const unmasked = globals.filter(l => !isSuppressedBy(globals, l.id))
  const pool = unmasked.length > 0 ? unmasked : globals
  let best: ActLoop | undefined
  for (const l of pool) {
    const lp = ACTS[l.id]?.prio ?? 0
    const bp = best ? (ACTS[best.id]?.prio ?? 0) : -1
    if (!best || lp > bp || (lp === bp && l.at >= best.at)) best = l
  }

  return best
}

/** Süresi dolan tek seferlik olayı kuyruktan yürütür ve biten döngüleri (TTL) temizler. */
export function pruneAct(cur: ActState | undefined, now: number): { state: ActState; expired: ActLoop[] } {
  const base: ActState = cur ? { ...cur } : { at: now, seen: now }
  const expired: ActLoop[] = []
  if (base.loops && base.loops.length > 0) {
    const kept: ActLoop[] = []
    for (const l of base.loops) {
      if (l.until !== undefined && now >= l.until) expired.push(l)
      else kept.push(l)
    }
    if (kept.length > 0) base.loops = kept
    else delete base.loops
  }
  if (base.ev && now >= base.ev.until) delete base.ev
  if (!base.ev && base.evQ && base.evQ.length > 0 && !base.loops?.some(l => l.id === 'sikistirma')) {
    const top = activeLoop(base, now)
    const eligible = base.evQ.filter(e => !top || (ACTS[top.id]?.prio ?? 0) < 80 || e.prio >= 60 || e.id === 'kota-devam-yok')
    const [head, ...rest] = eligible
    if (rest.length > 0) base.evQ = rest
    else delete base.evQ
    if (head && ACTS[head.id]) {
      base.ev = { id: head.id, at: now, until: now + evDuration(head.id) }
      base.cd = { ...(base.cd ?? {}), [head.id]: now }
    }
  }
  if (base.cd) {
    const nextCd: Record<string, number> = {}
    for (const [k, t] of Object.entries(base.cd)) if (now - t < 300_000) nextCd[k] = t
    if (Object.keys(nextCd).length > 0) base.cd = nextCd
    else delete base.cd
  }
  // #9 aşırı yük döngüsü TTL sonunda "durdu" tek seferliğiyle kapanır
  if (expired.some(l => l.id === 'asiri-yuk-529') && (!base.ev || (ACTS[base.ev.id]?.prio ?? 0) <= (ACTS['asiri-yuk-durdu']?.prio ?? 75))) {
    base.ev = { id: 'asiri-yuk-durdu', at: now, until: now + evDuration('asiri-yuk-durdu') }
  }

  return { state: base, expired }
}

/** Yeni döngü uygular (kural 1 & 4 & 6): alttakiler duraklar, üsttekiler bastırır, beklemeye 30 dk lowAt konur. */
export function applyLoop(cur: ActState | undefined, loop: ActLoop, now: number): ActState {
  const { state } = pruneAct(cur, now)
  const existing = state.loops ?? []
  // Farklı engeller saklanır: üstteki çözülünce alttaki kendi TTL'si içinde yeniden görünür.
  const filtered = existing.filter(l => l.id !== loop.id)
  const prev = existing.find(l => l.id === loop.id)
  const isWait = WAIT_LOOPS.has(loop.id)
  const nextLoop: ActLoop = {
    ...loop,
    at: prev ? prev.at : loop.at,
    until: isWait ? undefined : (loop.until ?? now + evDuration(loop.id)),
    lowAt: isWait ? (prev?.lowAt ?? now + 1_800_000) : loop.lowAt,
    ...(loop.id === 'queue-ticket' ? { tries: (prev?.tries ?? 0) + (loop.tries ?? 1) } : {}),
  }

  return { ...state, loops: [...filtered, nextLoop] }
}

/** Belirtilen döngüleri ya da sınıfı ('api' | 'tool' | 'lock' | 'all') kapatır; uygunsa Toparlanma (#50) üretir. */
export function clearLoops(
  cur: ActState | undefined,
  target: readonly string[] | 'api' | 'tool' | 'lock' | 'all',
  now: number,
  playRecovery = false,
): { state: ActState; closed: ActLoop[] } {
  const { state } = pruneAct(cur, now)
  const list = state.loops ?? []
  if (list.length === 0) return { state, closed: [] }
  const match = (id: string) =>
    target === 'all'
      ? true
      : target === 'api'
        ? API_LOOPS.has(id)
        : target === 'tool'
          ? TOOL_LOOPS.has(id)
          : target === 'lock'
            ? LOCK_LOOPS.has(id)
            : target.includes(id)
  const kept: ActLoop[] = []
  const closed: ActLoop[] = []
  for (const l of list) {
    if (match(l.id)) closed.push(l)
    else kept.push(l)
  }
  const out: ActState = { ...state }
  if (kept.length > 0) out.loops = kept
  else delete out.loops

  if (playRecovery && closed.length > 0) {
    const needsRecovery = closed.some(l => LOCK_LOOPS.has(l.id) || (ACTS[l.id]?.prio ?? 0) >= 60)
    const alreadyCelebrating = (out.ev?.id === 'confetti-party' || out.ev?.id === 'kota-devam') && now < out.ev.until
    if (needsRecovery && !alreadyCelebrating) {
      return { state: withEv(out, 'toparlandi', now), closed }
    }
  }

  return { state: out, closed }
}

/**
 * Son izlerde ardışık başarısızlık (f === 1) sayısı eşiğe ulaştı mı (#34). Çağrı izleri (sonucu olmayan,
 * yalnız etkinlik adı taşıyan işaretler) seriyi kesmez; başarısızlık olmayan bir sonuç işareti keser.
 * (Canlı yolda iz her başarıyı yazmadığından seri bellekte de sayılır: register `failStreak`.)
 */
export function hasConsecutiveFails(trail: readonly ActMark[] | undefined, min = 3): boolean {
  if (!trail || trail.length < min) return false
  let streak = 0
  for (let i = trail.length - 1; i >= 0; i--) {
    const m = trail[i] as ActMark
    if (m.f === 1) {
      streak++
      if (streak >= min) return true
    } else if (m.s !== undefined) {
      break
    }
  }

  return false
}

/**
 * Bir senaryonun TEK SEFERLİK olarak oynarken kullandığı bant (katalog bölüm 2). Katalog bir senaryoya
 * eski bir ana etkinliği ödünç verdiğinde (#29 izin reddi → kalkan) olay kendi bandıyla sıralanır;
 * aynı etkinliğin ana etkinlik önceliği (0.9 çakışma kuralları) değişmez.
 */
const EV_BAND: Readonly<Record<string, number>> = { 'shield-guard': 60 }
const evPrio = (id: string): number => EV_BAND[id] ?? ACTS[id]?.prio ?? 0

/**
 * Tek seferlik olay: aynı olay süresi içinde yeniden başlamaz; çalışan olaydan eşit/yüksek öncelikli yeni
 * olay hemen geçer, düşük öncelikli olay kuyruğa (en çok 2 öğe) alınır. Ana döngü bandı >= 80 ise bandı < 60
 * olan tek seferlik atlanır (kural 2).
 */
export function withEv(cur: ActState, ev: string | undefined, now: number, until?: number, exempt = false): ActState {
  if (!ev || !ACTS[ev]) return cur
  const ePrio = evPrio(ev)
  const loop = activeLoop(cur, now)
  if (!exempt && ev !== 'kota-devam-yok' && loop && (ACTS[loop.id]?.prio ?? 0) >= 80 && ePrio < 60) return cur
  if (loop?.id === 'sikistirma' && ev !== 'toparlandi') {
    const q = (cur.evQ ?? []).filter(x => x.id !== ev).concat({ id: ev, prio: ePrio }).sort((a, b) => b.prio - a.prio)
    return { ...cur, evQ: q.slice(0, 2) }
  }
  const run = cur.ev && now < cur.ev.until ? cur.ev : undefined
  if (run) {
    if (run.id === ev) return cur
    const runPrio = evPrio(run.id)
    if (ePrio < runPrio) {
      const q = (cur.evQ ?? []).filter(x => x.id !== ev).concat({ id: ev, prio: ePrio })
      q.sort((a, b) => b.prio - a.prio)
      return { ...cur, evQ: q.slice(0, 2) }
    }
  }
  const nextQ = cur.evQ?.filter(x => x.id !== ev)
  const { evQ: _queue, ...base } = cur

  return {
    ...base,
    ...(nextQ && nextQ.length > 0 ? { evQ: nextQ } : {}),
    ev: { id: ev, at: now, until: until ?? now + evDuration(ev) },
  }
}

/**
 * Hata/olay tek seferliğini kurallara göre uygular: cooldown (araç hatası 6 sn, diğer 8 sn),
 * üst döngü baskılaması (#34/#41 varken tekil kıvılcım atlanır, bant >= 80 iken < 60 atlanır),
 * ve hata fırtınasında (10 sn içinde >= 5 hata) #34 döngüsüne yükseltme (kural 2 & 3).
 */
/** Araç hatasının tek seferlikleri (#31 genel, #36 derleme, #40 komut zaman aşımı): seri (#34) hepsini kapsar. */
export const TOOL_ERR_EVS: ReadonlySet<string> = new Set(['error-sparks', 'derleme-hata', 'komut-zaman-asimi', 'komut-hata', 'test-kirik', 'kural-engeli', 'mcp-kopuk', 'dosya-yok', 'disk-dolu', 'git-catisma', 'isci-coktu'])

export function pushEvWithRules(
  cur: ActState | undefined,
  evId: string,
  now: number,
  opts: { globalLoop?: ActLoop; bypassCooldown?: boolean; exempt?: boolean; storm?: boolean } = {},
): ActState {
  const { state } = pruneAct(cur, now)
  if (!ACTS[evId]) return state
  const wLoop = activeLoop(state, now)
  const gLoop = opts.globalLoop && (opts.globalLoop.until === undefined || now < opts.globalLoop.until) ? opts.globalLoop : undefined
  const topLoop = !wLoop ? gLoop : !gLoop ? wLoop : (ACTS[wLoop.id]?.prio ?? 0) >= (ACTS[gLoop.id]?.prio ?? 0) ? wLoop : gLoop

  // Fırtına (10 sn'de 5+ hata): tek tek kıvılcım yerine #34 döngüsüne yüksel
  if (opts.storm && TOOL_ERR_EVS.has(evId)) {
    return applyLoop(state, { id: 'hata-serisi', at: now, until: now + 60_000 }, now)
  }
  // #34 veya #41 sürerken araç hatasının tekil gösterisi (#31/#36/#40) atlanır
  if (TOOL_ERR_EVS.has(evId) && (wLoop?.id === 'hata-serisi' || wLoop?.id === 'sonsuz-dongu')) {
    return state
  }
  if (!opts.exempt && evId !== 'kota-devam-yok' && topLoop && (ACTS[topLoop.id]?.prio ?? 0) >= 80 && evPrio(evId) < 60) {
    return state
  }
  if (!opts.bypassCooldown) {
    const cdMs = evId === 'disk-dolu' ? 300_000 : evId === 'error-sparks' || evId === 'komut-hata' ? 6000 : evId === 'iptal' || evId === 'toparlandi' || evId === 'izin-onay' || evId === 'asiri-yuk-durdu' ? 0 : 8000
    const last = state.cd?.[evId]
    if (cdMs > 0 && last !== undefined && now - last < cdMs) return state
  }
  const next = withEv(state, evId, now, undefined, opts.exempt)
  if (next === state) return state

  return { ...next, cd: { ...(next.cd ?? {}), [evId]: now } }
}

export type ErrorSignalInput = {
  source: 'StopFailure' | 'PostToolUseFailure' | 'PermissionDenied' | 'Notification' | 'PreCompact' | 'PostCompact' | 'PermissionRequest' | 'TurnComplete' | 'TurnStep' | 'ToolCall' | 'Cetvel'
  code?: string
  tool?: string
  cmd?: string
  text?: string
  isInterrupt?: boolean
  trigger?: 'auto' | 'manual'
  /** kabuk komutu kendi süre sınırına dayandı (çağrı süresi ≥ timeout): yapısal sinyal, metin değil (#40) */
  timedOut?: boolean
  fivePct?: number
  weekPct?: number
  resetsAt?: number
  /** Araç motorunun yapısal hata kodu; serbest çıktı metninden çıkarılmaz. */
  toolCode?: string
  exitCode?: number
  hookBlocked?: boolean
}

export type ErrorClassification = {
  id: string
  fault?: FaultCode
  kind: 'loop' | 'ev'
  prio: number
  global?: boolean
  mode?: 'auto' | 'manual'
  resetAt?: number
  bubble?: string
}

/** Ham olay/çıkış girdisinden katalog kurallarına (kural 4, 8, 11) göre senaryoyu sınıflandırır. */
export function classifyError(inp: ErrorSignalInput): ErrorClassification | undefined {
  const txt = inp.text ?? ''
  // 1. Kural 8: İptal (#42) en önce, hata sayılmaz
  if (inp.isInterrupt || (inp.source === 'TurnComplete' && inp.code === 'aborted')) {
    return { id: 'iptal', fault: 'iptal', kind: 'ev', prio: 88, bubble: 'Durduruldu' }
  }
  // 2. İzin reddi (#29)
  if (inp.source === 'PermissionDenied' || (inp.source === 'Cetvel' && inp.code === 'izin_reddi')) {
    return { id: 'shield-guard', fault: 'izin-red', kind: 'ev', prio: 60, bubble: 'İzin verilmedi' }
  }
  // Kural 11: metin desenleri yalnız API/oturum kaynağında (StopFailure, Notification, Cetvel'in model isteği
  // arızası) okunur. Sıradan araç çıktısı ("401 Unauthorized" dönen curl, "src/app.ts:429:12", "timeout"
  // özelliği, "rate limiter test", yerel veritabanının ECONNREFUSED'u) API arızası değildir: genel araç hatasıdır.
  const api = inp.source === 'StopFailure' || inp.source === 'Notification' || inp.source === 'Cetvel'
  const apiTxt = api ? txt : ''
  const apiCode = api ? inp.code : undefined
  if (inp.source === 'Notification' && inp.code === 'quota_auto_resume_fired') return { id: 'kota-devam', fault: 'kota-devam', kind: 'ev', prio: 90, bubble: 'Yeniden iş başı!' }
  if (inp.source === 'Notification' && (inp.code === 'quota_auto_resume_stale' || inp.code === 'quota_auto_resume_disabled')) return { id: 'kota-devam-yok', fault: 'kota-devam-yok', kind: 'ev', prio: 55, bubble: 'Alarm kurulamadı' }
  if (apiCode === 'account_on_hold' || apiCode === 'oauth_org_not_allowed' || /organization has disabled|account (?:is )?on hold/i.test(apiTxt)) return { id: 'hesap-kilit', fault: 'hesap-kilit', kind: 'loop', prio: 97, global: true, bubble: 'Hesap kilitli' }
  if (/response above may be incomplete|connection lost mid-response/i.test(apiTxt)) return { id: 'akis-yarim', fault: 'akis-yarim', kind: 'ev', prio: 45, bubble: 'Yanıt yarım kaldı' }
  if (/ssl certificate verification failed|unable to get local issuer certificate|proxy refused/i.test(apiTxt)) return { id: 'sertifika', fault: 'sertifika', kind: 'ev', prio: 50, bubble: 'Mühür geçersiz' }
  if (/unable to respond.*usage policy|safeguards flagged|output blocked by content filtering/i.test(apiTxt)) return { id: 'model-reddi', fault: 'model-reddi', kind: 'ev', prio: 58, bubble: 'Bunu yapamam' }
  if (apiCode === 'model_not_found') return { id: 'model-yok', fault: 'model-yok', kind: 'ev', prio: 56, bubble: 'Yanlış kapı' }
  if (/tool call could not be parsed|tool_call_parse_error/i.test(apiTxt)) return { id: 'arac-cozulemedi', fault: 'arac-cozulemedi', kind: 'ev', prio: 46, bubble: 'Kablo düğüm oldu' }
  // Dosya/sistem/araç hataları: API hata akışı veya motorun yapısal kodu; sıradan araç çıktısı okunmaz.
  if (inp.toolCode === 'ENOSPC' || /\bENOSPC\b|no space left|temp filesystem is full/i.test(apiTxt)) return { id: 'disk-dolu', fault: 'disk-dolu', kind: 'ev', prio: 59, bubble: 'Arşiv dolu' }
  if (inp.hookBlocked || inp.toolCode === 'hook_blocked' || /pretooluse.*(?:blocked|exit (?:code )?2)|blocked by.*hook/i.test(apiTxt)) return { id: 'kural-engeli', fault: 'kural-engeli', kind: 'ev', prio: 47, bubble: 'Kural engelledi' }
  if ((inp.tool?.startsWith('mcp__') && ['connection_closed', 'tool_disabled', 'tool_not_found'].includes(inp.toolCode ?? '')) || /mcp server.*(?:connection closed|is disabled)|no such tool available/i.test(apiTxt)) return { id: 'mcp-kopuk', fault: 'mcp-kopuk', kind: 'ev', prio: 51, bubble: 'Araç hattı koptu' }
  if (inp.toolCode === 'ENOENT' || /no such file|\bENOENT\b|file does not exist/i.test(apiTxt)) return { id: 'dosya-yok', fault: 'dosya-yok', kind: 'ev', prio: 44, bubble: 'Raf boş' }
  // 3. Kural 11 (#57296 yanlış-pozitif koruması): "prompt is too long" rate_limit maskeli gelse bile bağlam aşımıdır!
  if (RX.ctxOver.test(apiTxt) || (inp.source === 'TurnStep' && inp.code === 'model_context_window_exceeded')) {
    // her yoldan aynı görünüm: su sebili 2,5 sn taşar (kısa, sınırlı döngü; ardından #19 sıkıştırma beklenir)
    return { id: 'baglam-asildi', fault: 'baglam-asildi', kind: 'loop', prio: 68, bubble: 'Taştı!' }
  }
  // 3b. İstek / görsel çok büyük (#16, API 413): özgün olan genel geçersiz isteği bastırır
  if (RX.tooLarge.test(apiTxt)) {
    return { id: 'cok-buyuk-413', fault: 'cok-buyuk-413', kind: 'ev', prio: 52, bubble: 'Sığmadı!' }
  }
  // 3c. Çıktı sınırı aşıldı (#20): kesin kod
  if (apiCode === 'max_output_tokens') {
    return { id: 'cikti-siniri', fault: 'cikti-siniri', kind: 'ev', prio: 48, bubble: 'Çıktı sınırı doldu' }
  }
  // 4. Giriş / kimlik (#4)
  if (apiCode === 'authentication_failed' || apiCode === 'cloud_credential_error' || apiCode === 'auth_storage_failure' || RX.auth.test(apiTxt)) {
    return { id: 'giris-gerek', fault: 'giris-gerek', kind: 'loop', prio: 98, global: true, bubble: 'Giriş gerek' }
  }
  // 4b. Kredi / harcama limiti bitti (#3): küresel kilit, yeni başarılı yanıtla açılır
  if (apiCode === 'billing_error' || RX.billing.test(apiTxt)) {
    return { id: 'kredi-bitti', fault: 'kredi-bitti', kind: 'loop', prio: 94, global: true, bubble: 'Kasa boş' }
  }
  // 5. Kota kilitleri (#2 haftalık > #1 oturum; kullanım ölçeriyle doğrulamalı kural 11)
  if (api && (inp.code === 'rate_limit' || inp.source === 'StopFailure')) {
    if (RX.weekly.test(txt) && (inp.weekPct === undefined ? true : inp.weekPct >= 90)) {
      return { id: 'kota-haftalik', fault: 'kota-haftalik', kind: 'loop', prio: 97, global: true, resetAt: inp.resetsAt, bubble: 'Haftalık kota doldu' }
    }
    if (RX.sessionLim.test(txt) && (inp.fivePct === undefined ? true : inp.fivePct >= 90)) {
      return { id: 'kota-oturum', fault: 'kota-oturum', kind: 'loop', prio: 96, global: true, resetAt: inp.resetsAt, bubble: 'Kota doldu' }
    }
    if (RX.vagueUsage.test(txt) && inp.fivePct !== undefined && inp.fivePct >= 90) {
      return { id: 'kota-oturum', fault: 'kota-oturum', kind: 'loop', prio: 96, global: true, resetAt: inp.resetsAt, bubble: 'Kota doldu' }
    }
  }
  // 6. Ağ bağlantısı koptu (#12): #8/#9/#11'i bastırır
  if (RX.net.test(apiTxt)) {
    return { id: 'ag-kopuk', fault: 'ag-kopuk', kind: 'loop', prio: 74, global: inp.source === 'StopFailure', bubble: 'Bağlantı koptu' }
  }
  // 7. 529 aşırı yük (#9): 500'ü bastırır
  if (apiCode === 'overloaded' || RX.overloaded.test(apiTxt)) {
    return { id: 'asiri-yuk-529', fault: 'asiri-yuk-529', kind: 'loop', prio: 75, global: inp.source === 'StopFailure', bubble: 'Çok kalabalık' }
  }
  // 8. 429 geçici hız sınırı (#8)
  if (apiCode === 'rate_limit' || RX.rate429.test(apiTxt)) {
    return { id: 'queue-ticket', fault: 'hiz-429', kind: 'loop', prio: 76, bubble: 'Sırada bekliyor' }
  }
  // 9. İstek zaman aşımı (#11)
  if (RX.timeout.test(apiTxt)) {
    return { id: 'zaman-asimi', fault: 'zaman-asimi', kind: 'loop', prio: 72, bubble: 'Zaman aşımı' }
  }
  // 9b. Sunucu hatası 500 (#10): 529, ağ ve zaman aşımı daha özgündür (yukarıda)
  if (apiCode === 'server_error' || RX.http500.test(apiTxt)) {
    return { id: 'sunucu-500', fault: 'sunucu-500', kind: 'ev', prio: 62, bubble: 'Sunucu hata verdi' }
  }
  // 10. İzin bekleniyor (#27) / Oto-sıkıştırma (#19)
  if (inp.source === 'PermissionRequest' || (inp.source === 'Notification' && /permission/i.test(inp.code ?? ''))) {
    return { id: 'izin-bekle', fault: 'izin-bekle', kind: 'loop', prio: 85, bubble: 'İzin bekliyor' }
  }
  // #28 kullanıcıdan girdi bekleniyor: yalnız kanca bildirim türüyle (kesin sinyal); izin (#27) üstündür
  if (inp.source === 'Notification' && RX.askNote.test(inp.code ?? '')) {
    return { id: 'soru-bekle', fault: 'soru-bekle', kind: 'loop', prio: 83, bubble: 'Cevabını bekliyorum' }
  }
  if (inp.source === 'PreCompact') {
    return { id: 'sikistirma', fault: 'sikistirma', kind: 'loop', prio: 66, mode: inp.trigger ?? 'auto', bubble: 'Sıkıştırıyor' }
  }
  if (apiCode === 'invalid_request') return { id: 'gecersiz-istek', fault: 'gecersiz-istek', kind: 'ev', prio: 54, bubble: 'Form geri döndü' }
  // 11. Grep çıkış 1 hata değil; genel araç hatası (#31)
  if (inp.tool && (inp.exitCode === undefined || inp.exitCode === 1) && isGrepEmpty(inp.tool, inp.cmd, txt)) return undefined
  if (inp.source === 'PostToolUseFailure' || inp.source === 'ToolCall') {
    // Araç hatalarında çıktı metnine bakılmaz (kural 11): komut zaman aşımı çağrı süresinden (#40), derleme
    // hatası çalıştırılan komutun türünden (#36) bilinir. Kırık test kendi şişesini gösterir (1.0 kural 6).
    const shell = inp.tool === 'Bash' || inp.tool === 'PowerShell'
    if (shell && inp.timedOut) return { id: 'komut-zaman-asimi', fault: 'komut-zaman-asimi', kind: 'ev', prio: 57, bubble: 'Komut zaman aştı' }
    const stages = stagesOf(inp.cmd ?? '', inp.tool).map(stageCore)
    if (shell && readExternal(inp.cmd ?? '') && (inp.exitCode === undefined || inp.exitCode !== 0)) return { id: 'isci-coktu', fault: 'isci-coktu', kind: 'ev', prio: 59, bubble: 'Hat koptu' }
    if (shell && stages.some(s => RX.test.test(s)) && stages.every(s => RX.test.test(s) || RX.buildHead.test(s) || /^(cd|Set-Location)\b/i.test(s) || RX.buildFollower.test(headOf(s)))) return { id: 'test-kirik', fault: 'test-kirik', kind: 'ev', prio: 53, bubble: 'Test kırıldı' }
    if (shell && stages.some(s => /^git (?:merge|rebase)\b/i.test(s)) && stages.every(s => /^git (?:merge|rebase)\b/i.test(s) || /^(cd|Set-Location)\b/i.test(s) || RX.buildFollower.test(headOf(s)))) return { id: 'git-catisma', fault: 'git-catisma', kind: 'ev', prio: 49, bubble: 'Dallar düğüm oldu' }
    // (tırnak içi metin komut değildir: echo "cargo build" ya da bir commit iletisi derleme sayılmaz)
    if (shell && isBuildCmd(inp.cmd ?? '', inp.tool)) return { id: 'derleme-hata', fault: 'derleme-hata', kind: 'ev', prio: 53, bubble: 'Derleme kırıldı' }
    if (shell && inp.exitCode !== undefined && inp.exitCode !== 0) return { id: 'komut-hata', fault: 'komut-hata', kind: 'ev', prio: 42, bubble: 'Komut durdu' }
  }
  if (inp.source === 'PostToolUseFailure' || inp.source === 'ToolCall' || inp.source === 'Cetvel') {
    return { id: 'error-sparks', fault: 'arac-hata', kind: 'ev', prio: 50 }
  }

  return undefined
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

/** İş bitti: ana etkinlik silinir; başarı konfeti, hata kıvılcım (ev kalır); durdurulan iş sessiz biter (olay yok). */
export function endAct(cur: ActState | undefined, isFailed: boolean, now: number, quiet = false): ActState {
  const base: ActState = { ...(cur ?? { at: now, seen: now }) }
  delete base.id
  delete base.next
  delete base.nextAt
  if (quiet) return base

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
  let speed = FATIGUE_SPEED[ctx.fat]
  const view: ActView = { speed }
  if (a === 'leaving') return view
  const part = (id: string, at: number): ActPart => ({ id, strip: stripFor(id, ctx.kind), at })
  const st = pruneAct(w.act, now).state
  const ev = st.ev && now >= st.ev.at && now < st.ev.until ? st.ev : undefined
  if (ev) view.ev = { ...part(ev.id, ev.at), until: ev.until }

  const wLoop = activeLoop(st, now)
  const gLoop = ctx.globalLoop && (ctx.globalLoop.until === undefined || now < ctx.globalLoop.until) ? ctx.globalLoop : undefined
  const activeGrp = [wLoop, gLoop].filter((x): x is ActLoop => x !== undefined)
  // Ölçüme bağlı ambiyans: çözülme doğrudan ölçümden gelir, eski bir döngü kopyası kalmaz.
  if (ctx.isBoss && ctx.ctxPct !== undefined && ctx.ctxPct >= 90) activeGrp.push({ id: 'baglam-uyari', at: w.since })
  if (ctx.limitPct !== undefined && ctx.limitPct >= 90 && ctx.limitPct < 100) activeGrp.push({ id: 'kota-az', at: w.since })
  if (a === 'thinking' && w.streamAt !== undefined && now - Math.max(w.since, w.streamAt) >= 30_000) activeGrp.push({ id: 'uzun-dusunme', at: w.since + 30_000 })
  const unmasked = activeGrp.filter(l => !isSuppressedBy(activeGrp, l.id))
  const loopPool = unmasked.length > 0 ? unmasked : activeGrp
  const loop = loopPool.sort((x, y) => (ACTS[y.id]?.prio ?? 0) - (ACTS[x.id]?.prio ?? 0) || y.at - x.at)[0]

  if (a === 'done' || a === 'failed') return view

  let main: ActPart | undefined
  let over: ActPart | undefined
  let extra: ActPart[] | undefined
  const busy = !QUIET.has(a)

  if (loop) {
    if (loop.lowAt !== undefined && now >= loop.lowAt) {
      main = part('nap-zzz', loop.lowAt)
      view.label = ACT_LABEL['nap-zzz']
    } else if (loop.id === 'hata-serisi') {
      main = part('hata-serisi', loop.at)
      over = part('overheat-sweat', loop.at)
      view.label = ACT_LABEL['hata-serisi']
    } else if (loop.id === 'sonsuz-dongu') {
      main = part('sonsuz-dongu', loop.at)
      extra = [part('sonsuz-dongu_on', loop.at)]
      view.label = ACT_LABEL['sonsuz-dongu']
    } else if (loop.id === 'uzun-dusunme' && now - w.since >= 180_000) {
      main = part('coffee-break', w.since + 180_000)
      view.label = ACT_LABEL['uzun-dusunme']
    } else {
      main = part(loop.id, loop.at)
      view.label = ACT_LABEL[loop.id]
      if (loop.id === 'sikistirma' && loop.mode === 'manual') {
        speed *= 0.7
        view.speed = speed
      }
    }
    if (main) view.main = main
    if (over) view.over = over
    if (extra) view.extra = extra

    return view
  }

  // ajanın kendi etkinliği: şu anki araç onu doğruladıysa (süresiz) ya da son 60 sn içinde doğrulandıysa.
  // Onaylanmamış yeni bir araç dakikalar önceki bayat etkinliği geri getirmez (görünüm düzeyinde titreme yok).
  const own = st.id && a !== 'idle' && (st.seen >= w.since || now - st.seen < HOLD_MS) ? st.id : undefined
  if (own) main = part(own, st.at)
  // bu aracın tanıdığı ama henüz onaylanmamış aday (uzun test, git, veritabanı komutu)
  const pending = st.next && (st.nextAt ?? -Infinity) >= w.since && !isEvent(st.next) ? st.next : undefined

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
  if (a === 'running' && (w.tool === 'Bash' || w.tool === 'PowerShell') && w.kind !== 'external' && !(st.id && st.seen >= w.since) && now - w.since >= COMPILE_MS) {
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
  const body = s.svg
    ? `<g shape-rendering="crispEdges">${s.svg}</g>`
    : `<image href="data:image/png;base64,${s.b64 ?? ''}" width="${w}" height="${s.fh}" style="image-rendering:pixelated"/>`

  return `<symbol id="ac-${key}" viewBox="0 0 ${w} ${s.fh}" width="${w}" height="${s.fh}">${body}</symbol>`
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
  // bir kayıt başka bir etkinliğin gövde hareketini ödünç alabilir (kota-oturum → acb-nap-zzz): onun
  // @keyframes'i de yazılır, yoksa gövde kıpırdamaz
  const cssIds = new Set<string>()
  for (const id of ids) {
    cssIds.add(id)
    const borrowed = ACTS[id]?.body?.name.replace(/^acb-/, '')
    if (borrowed && borrowed !== id && ACT_CSS[borrowed]) cssIds.add(borrowed)
  }
  let css = STYLE_BASE
  for (const id of [...cssIds].sort()) css += ACT_CSS[id] ?? ''

  return keys.map(stripSymbol).join('') + `<style>${css}</style>`
}

/** etkinlik ailesi (testler ve HUD için): varyantsız ana kayıtlar */
export const MAIN_ACTS: readonly string[] = Object.values(ACTS)
  .filter(e => e.role === 'ana')
  .map(e => e.id)
