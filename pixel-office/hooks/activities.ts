// Pixel Office 0.9: activity animations by task type (design v5).
// A worker's latest tools, task and state map to an activity: painting, coding, bug hunting, etc.
// Pure rules: probabilities use hash(seed); the caller supplies now, with no internal clock.
// Never persist raw commands, paths or text; keep only derived markers (ActMark).
//
// Flow: tool.call -> pickActivity (candidate) -> settleAct (two-hit rule prevents flicker) + withEv
// (one-shot event) -> Worker.act/trail. At render time, actView derives duration, context, fatigue and ambience;
// planActs selects strips within budget, and actDefs emits only those used.
import type { ActMark, ActState, Activity, Worker } from '../types'
import type { CharKind } from './char-data'
import { ACTS, ACT_CSS, ACT_STRIPS, ACT_TRIGGERS, type ActEntry } from './activity-data'
import { FATIGUE_SPEED, hash, readExternal } from './logic'

export { ACTS, ACT_CSS, ACT_STRIPS, ACT_TRIGGERS }
export type { ActAnchor, ActClass, ActEntry, ActStrip } from './activity-data'

// --- Contract types ---

export type ToolFacts = {
  /** 'Read', 'Bash', 'mcp__x__generate_image', … */
  tool: string
  phase: 'call' | 'result'
  /** Path used locally to match extensions and names; never stored. */
  file?: string
  /** Bash/PowerShell command, never stored. */
  cmd?: string
  /** run_in_background */
  bg?: boolean
  /** Skill input.skill */
  skill?: string
  /** Description, summary, prompt, Agent task or Grep pattern for keywords; never stored. */
  text?: string
  agentType?: string
  failed?: boolean
  denied?: boolean
  /** First 4000 result characters, for pattern matching only. */
  out?: string
  /** ReportFindings findings.length */
  findings?: number
  /** An outside CLI command (readExternal) gives the caller radio-call. */
  external?: boolean
  /** wrap_up: a worker failed in the office, so this is not a clean finish. */
  teamFailed?: boolean
}

/** pickActivity result; named to avoid colliding with TypeScript's Pick utility. */
export type ActPick = {
  main?: string
  ev?: string
  mark: ActMark
  clearEv?: boolean
  /** Strong one-shot signal (Skill, ReportFindings, notification, wrap_up or result variant): bypass the two-hit rule. */
  force?: true
  /** This call belongs to an ongoing audit (Read/Grep in its trail): refresh the audit or confirm its pending candidate. */
  keep?: true
}

export type ActCtx = {
  now: number
  isBoss: boolean
  fat: 0 | 1 | 2 | 3
  /** Context percentage; boss only, because context belongs to the session. */
  ctxPct?: number
  /** Five-hour allowance at 100 percent. */
  limitFull: boolean
  /** Number of busy teammates, for the boss's supervision. */
  teamBusy: number
  /** A busy critic or reviewer exists, so the boss arbitrates. */
  criticBusy: boolean
  kind: CharKind
  external: boolean
}
export type ActPart = { id: string; strip: string; at: number }
export type ActView = {
  main?: ActPart
  ev?: ActPart & { until: number }
  /** Load indicator overlaid on the main activity (overheat-sweat). */
  over?: ActPart
  /** detective-hunt hat; hide the accessory above the head. */
  hat?: boolean
  /** Extra layers: film-shoot_misir. */
  extra?: ActPart[]
  /** Desk mini-panel: English, one line, at most 16 characters. */
  label?: string
  /** Fatigue multiplier for fps and body duration. */
  speed: number
}

// ——— Labels (section 7) ——————————————————————————————————————————

export const ACT_LABEL: Readonly<Record<string, string>> = {
  'paint-canvas': 'Painting',
  'pixel-sketch': 'Pixel sketching',
  'quill-write': 'Writing text',
  'music-compose': 'Composing',
  'film-shoot': 'Filming',
  'idea-bulb': 'Got an idea',
  'type-fast': 'Coding',
  'bug-fix': 'Fixing a bug',
  'compile-wait': 'Compiling',
  'code-read': 'Reading code',
  'test-tube': 'Running tests',
  'test-tube_fail': 'Tests failed',
  'plan-blueprint': 'Drawing a plan',
  'globe-spin': 'Searching web',
  'radar-scan': 'Scanning a page',
  'library-shelf': 'Finding files',
  'map-explore': 'Exploring',
  'spreadsheet-fill': 'Filling a table',
  'database-barrel': 'Using database',
  'funnel-filter': 'Filtering data',
  'scale-compare': 'Comparing',
  'git-branch': 'Working in Git',
  'coffee-break': 'Coffee break',
  'overheat-sweat': 'Overheating',
  'queue-ticket': 'Queued',
  'magnify-eye': 'Inspecting image',
  'dictionary-translate': 'Translating',
  binoculars: 'Watching',
  periscope: 'Watching team',
  'security-cam': 'Watching process',
  'watch-lighthouse': 'On watch',
  'checklist-audit': 'Auditing',
  'checklist-audit_fail': 'Writing findings',
  'detective-hunt': 'Bug hunting',
  'radio-call': 'Calling an agent',
  'paper-plane': 'Sending message',
  'mail-envelope': 'Writing email',
  'megaphone-announce': 'Announcing',
  'headset-listen': 'Listening',
  'handoff-baton': 'Handoff',
  'chart-grow': 'Charting',
  'abacus-calc': 'Calculating',
  'deploy-rocket': 'Deploying',
  'archive-boxes': 'Archiving',
  'memory-brain': 'Saving memory',
  'shield-guard': 'Security scan',
  'broom-cleanup': 'Cleaning up',
  'nap-zzz': 'Napping',
  'error-sparks': 'Hit an error',
  'confetti-party': 'Celebrating',
}
/** Headset label for outside workers. */
export const EXTERNAL_LABEL = 'On outside line'

// --- Small helpers ---

/** Turkish text folding, matching the generator: dotted and ASCII capital I become lowercase i. */
export const fold = (s: string): string => s.replace(/[İI]/g, 'i').toLowerCase()

const entry = (id: string | undefined): ActEntry | undefined => (id ? ACTS[id] : undefined)

/** Base entry of a variant (test-tube_fail -> test-tube); other entries return themselves. */
export const familyOf = (id: string): string => {
  const e = ACTS[id]

  return e && e.role === 'varyant' && e.of ? e.of : id
}

/** One-shot or event-class entries play as ev, without the two-hit rule. */
export const isEvent = (id: string): boolean => {
  const e = ACTS[id]

  return Boolean(e && (e.once || e.cls === 'olay'))
}

/** Strip matching the head width; fall back to the default strip. */
export const stripFor = (id: string, kind: CharKind): string => {
  const e = ACTS[id]
  if (!e) return id

  return e.strip[kind] ?? e.strip.def
}

/** Seeded fraction in [0, 1). */
const frac = (seed: string): number => (hash(seed) % 10_000) / 10_000

/** Loop frames after the intro, forward and back for pingpong; same order as the generator. */
export function loopFrames(id: string): number[] {
  const e = ACTS[id]
  const n = ACT_STRIPS[e?.strip.def ?? id]?.n ?? 1
  const intro = e?.intro ?? 0
  const seq: number[] = []
  for (let k = intro; k < n; k++) seq.push(k)
  if (e?.pingpong && seq.length > 2) for (let k = seq.length - 2; k > 0; k--) seq.push(seq[k] as number)

  return seq
}

/** Event duration in ms: explicit overrides, otherwise max(1200, n/fps * 1000 * repeat). */
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

// ——— Keywords (section 3.3-2) ————————————————————————————————————

/** Tool-name tokens match tool names only; ignore them in descriptive prose. */
const TOOL_ONLY = new Set([
  'agent', 'task', 'edit', 'grep', 'glob', 'multiedit', 'notebookedit', 'todowrite', 'webfetch', 'websearch', 'monitor',
  'listagents', 'sendmessage', 'croncreate', 'schedulewakeup', 'pushnotification', 'senduserfile', 'workflow', 'wrap_up',
  'start_session', 'update_plan', 'run_in_background', 'find', 'loop', 'done',
])
const WORD = /[0-9a-zçğıöşüâîû]/

/** Whether tok occurs at word boundaries; nonletters and nondigits, including _ - : / and spaces, are boundaries. */
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

/** Keyword candidates: names (skill, MCP server and short name, agent type or command word) accept all tokens. Prose accepts only task tokens of at least four characters that are not tool names. Shorter tokens (rm, ls, jq, tsc, rea, fix, bug, zip, tar) must equal a name part. Choose highest priority, breaking ties by seeded probability weight. */
export function keywordAct(names: readonly string[], prose: string | undefined, seed: string): string | undefined {
  const nameHay = names.filter(Boolean).map(fold)
  const parts = new Set(nameHay.flatMap(n => n.split(/[^0-9a-zçğıöşüâîû]+/)).filter(Boolean))
  // Exclude the Turkish phrase for reverting; it does not mean translation.
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
  // Turkish and English prose stems, including inflections, such as draw the icon.
  if (text) for (const [rx, id] of PROSE_STEMS) if (rx.test(text)) found.add(id)
  if (found.size === 0) return undefined
  // Longest token wins: validate-data selects funnel-filter and removes the plain validate test-tube match (rule 6).
  if (found.has('funnel-filter') && names.concat(prose ?? '').some(s => /validate-data/i.test(s))) found.delete('test-tube')

  return byPrio([...found], seed)
}

/** Common task-text stems that do not appear as single words in the manifest. */
// English stems match whole words, excluding logout and drawer; Turkish aliases accept inflections and exclude the phrase for reverting.
const B = '(^|[^0-9a-zçğıöşü])'
const E = '(?![0-9a-zçğıöşü])'
const PROSE_STEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`${B}(çiz(?!elge)|logo(yu|su|lar|ları|nun|ya)?${E}|resim|resm[iİ]|illüstrasyon|(draw|draws|drawing|paint|paints|painting)${E})`), 'paint-canvas'],
  [new RegExp(`${B}(beste|melodi)`), 'music-compose'],
  [new RegExp(`${B}(?<!geri\\s)(çevir|tercüme)`), 'dictionary-translate'],
]

/** Highest priority, breaking ties by seeded probability weight. */
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

// --- Tool -> activity (section 3.4) ---

const RX = {
  image: /\.(png|jpe?g|gif|webp|bmp)$/i,
  logish: /\.log$|stack|trace|crash/i,
  memory: /MEMORY\.md|CLAUDE\.md|AGENTS\.md|[\\/]memory[\\/]/i,
  doc: /\.(md|txt|docx?|tex|rst|mdx)$/i,
  test: /\b(pytest|jest|vitest|mocha)\b|\b(npm|pnpm|yarn|bun) (run )?test\b|\bcargo test\b|\bgo test\b|\bclaude(\.exe)? plugin test\b/i,
  // The refspec itself must name the main branch, excluding feature/main-fix; reading vercel.json and dry runs are not deployments.
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

/** Expire trail markers after this age so old errors and audits do not leave permanent traces. */
export const RECENT_MS = 5 * 60_000

/** Whether one of the last eight markers within five minutes satisfies the predicate. */
const recent = (trail: readonly ActMark[], now: number, test: (m: ActMark) => boolean): boolean => trail.slice(-8).some(m => now - m.t <= RECENT_MS && test(m))

/** The newest matching marker is active unless a newer clear marker cancels it. */
function lastOn(trail: readonly ActMark[], now: number, on: (m: ActMark) => boolean, clear: (m: ActMark) => boolean): boolean {
  const list = trail.slice(-8).filter(m => now - m.t <= RECENT_MS)
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i] as ActMark
    if (clear(m)) return false
    if (on(m)) return true
  }

  return false
}
/** A recent failure without a later passing test to clear it. */
const failedOn = (trail: readonly ActMark[], now: number): boolean => lastOn(trail, now, m => m.f === 1, m => m.s === 'ok')
/** Audit ongoing: the latest audit marker follows the findings report (done). */
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

/** Skill names, including the plugin prefix, matched by pattern. */
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

/** MCP short names, independent of the server. */
function mcpHit(t: Short): Hit | undefined {
  const s = t.short.toLowerCase()
  const server = (t.server ?? '').toLowerCase()
  if (/^(generate_image|image_fill_area|image_generative_expand)$/.test(s)) return { id: 'paint-canvas' }
  if (/^(image_vectorize|draw_svg_image)$/.test(s)) return { id: 'pixel-sketch' }
  // Waiting for a render: this marker enables the popcorn extra layer (rule 21).
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
  // Browser screenshot first, then page, then web search.
  if (/screenshot|zoom|pdf_to_image|capture/.test(s)) return { id: 'magnify-eye' }
  if (/navigate|fetch|scrape|crawl|make_request/.test(s)) return { id: 'radar-scan' }
  if (/search|consensus|brightdata|research/.test(server + ' ' + s)) return { id: 'globe-spin' }

  return undefined
}

/** Bash/PowerShell command classes, in order. */
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

/** Call phase: tool name plus condition. undefined falls through to keywords; none keeps the current activity without a candidate. */
function callHit(f: ToolFacts, trail: readonly ActMark[], seed: string, now: number): Hit | undefined {
  const t = toolName(f.tool)
  const file = f.file ?? ''
  const failedLately = failedOn(trail, now)
  // During an audit, reading and searching refresh its trail without a new candidate, so it does not expire by itself.
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
      // A report closes the audit (done); later reads become code reading again.
      return { id: (f.findings ?? 0) > 0 ? 'checklist-audit_fail' : 'checklist-audit', mark: { s: 'done' }, force: true }
    case 'Skill': {
      // Skills are normally called once: recognized skills take effect immediately.
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

/** Activity candidate for a tool event. Calls use tool and conditions, falling back to keywords. Results handle denial (shield-guard), 429/529 (queue-ticket), failed tests (test-tube_fail without sparks), agent returns (handoff-baton), and general errors (error-sparks plus f). One-shot and event-class candidates return ev; others return main. */
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
    // Permission denial: shield without error sparks (rule 5).
    if (f.denied) return { ev: 'shield-guard', mark }
    const shell = t.name === 'Bash' || t.name === 'PowerShell'
    const isTest = shell && RX.test.test(f.cmd ?? '')
    if (f.failed) {
      if (RX.rate.test(f.out ?? '')) return { ev: 'queue-ticket', mark }
      mark.f = 1
      // Failed test: apply the variant immediately, even after a single run, without sparks (rule 6).
      if (isTest) return { main: 'test-tube_fail', mark: { ...mark, id: 'test-tube' }, force: true }

      return { ev: 'error-sparks', mark }
    }
    // Passing tests clear the old failure, so bug-fix, detective and megaphone no longer inherit it.
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
  // Keywords from skill names, MCP server and short name, agent types and command words; descriptions supply prose.
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

// --- Persistence (section 3.6) ---

const sameFamily = (a: string, b: string): boolean => familyOf(a) === familyOf(b)

/** Sibling activities alternate in real work (WebSearch/WebFetch, Read/Grep). They confirm each other (A, B settles B), but a single sibling only refreshes the displayed activity. */
const SIBLINGS: ReadonlyArray<ReadonlySet<string>> = [new Set(['globe-spin', 'radar-scan']), new Set(['code-read', 'library-shelf'])]
export const siblings = (a: string, b: string): boolean => a !== b && SIBLINGS.some(g => g.has(familyOf(a)) && g.has(familyOf(b)))

/** Audit families refreshed by reads in the audit trail. */
const AUDIT_ACTS: ReadonlySet<string> = new Set(['checklist-audit', 'shield-guard', 'funnel-filter'])

const switchTo = (cur: ActState | undefined, main: string, now: number): ActState => {
  const out: ActState = { ...(cur ?? { at: now, seen: now }), id: main, at: cur?.id === main ? cur.at : now, seen: now }
  delete out.next
  delete out.nextAt

  return out
}

/** Two-hit rule: a new main activity needs two consecutive nominations. The current activity, a same-family variant and a force signal apply immediately. A sibling or same-family pending candidate confirms it. No main leaves it unchanged. */
export function settleAct(cur: ActState | undefined, main: string | undefined, now: number, force = false): ActState {
  if (main === undefined) return cur ?? { at: now, seen: now }
  if (force || !cur || !cur.id || cur.id === main || sameFamily(cur.id, main)) return switchTo(cur, main, now)
  // A pending same-family variant or sibling counts as the second signal.
  if (cur.next !== undefined && (cur.next === main || sameFamily(cur.next, main) || siblings(cur.next, main))) return switchTo(cur, main, now)
  // A sibling of the displayed activity refreshes it; a second occurrence takes over.
  if (siblings(cur.id, main)) return { ...cur, seen: now, next: main, nextAt: now }

  return { ...cur, next: main, nextAt: now }
}

/** One-shot event: do not restart it during its duration. Ignore a lower-priority event; equal or higher priority replaces it. Once finished, the separate main activity becomes visible again. */
export function withEv(cur: ActState, ev: string | undefined, now: number, until?: number): ActState {
  if (!ev || !ACTS[ev]) return cur
  const run = cur.ev && now < cur.ev.until ? cur.ev : undefined
  if (run) {
    if (run.id === ev) return cur
    if ((ACTS[ev]?.prio ?? 0) < (ACTS[run.id]?.prio ?? 0)) return cur
  }

  return { ...cur, ev: { id: ev, at: now, until: until ?? now + evDuration(ev) } }
}

/** Apply a pick: settle, event, and cancel the queue ticket on a new tool call. */
export function applyPick(cur: ActState | undefined, p: ActPick, now: number): ActState {
  let st = settleAct(cur, p.main, now, p.force === true)
  // Ongoing audit: refresh the displayed audit and confirm its pending candidate.
  if (p.keep && st.id && AUDIT_ACTS.has(familyOf(st.id))) st = { ...st, seen: now }
  else if (p.keep && st.next && AUDIT_ACTS.has(familyOf(st.next))) st = switchTo(st, st.next, now)
  if (p.clearEv && st.ev?.id === 'queue-ticket' && now < st.ev.until) {
    st = { ...st }
    delete st.ev
  }

  return withEv(st, p.ev, now)
}

/** Trail: informative markers only, at most eight, newest last. */
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

/** Work finished: clear main; success leaves confetti, failure leaves sparks as ev. */
export function endAct(cur: ActState | undefined, isFailed: boolean, now: number): ActState {
  const base: ActState = { ...(cur ?? { at: now, seen: now }) }
  delete base.id
  delete base.next
  delete base.nextAt

  return withEv(base, isFailed ? 'error-sparks' : 'confetti-party', now)
}

/** Starting work: outside worker headset and three-second radio call; Explore uses map or shelf; otherwise read the task text. */
export function hireAct(task: string | undefined, agentType: string | undefined, external: boolean, seed: string, now: number): ActState | undefined {
  if (external) return { id: 'headset-listen', at: now, seen: now, ev: { id: 'radio-call', at: now, until: now + evDuration('radio-call') } }
  let id: string | undefined
  if (agentType === 'Explore') id = hash(seed) % 10 < 6 ? 'map-explore' : 'library-shelf'
  else id = keywordAct(agentType ? [agentType] : [], task, seed)
  if (!id) return undefined
  if (isEvent(id)) return withEv({ at: now, seen: now }, id, now)

  return { id, at: now, seen: now }
}

// --- Render-time view (section 3.8) ---

const QUIET: ReadonlySet<Activity> = new Set<Activity>(['idle', 'waiting', 'done', 'failed', 'leaving'])
const HEADISH = new Set(['kafa', 'kafa_govde', 'goz'])
const HOLD_MS = 60_000
const COMPILE_MS = 8000
const COFFEE_MS = 2 * 60_000
const NAP_MS = 10 * 60_000
const LONG_JOB_MS = 30 * 60_000

/** A worker's render-time activity view, pure and deterministic for the same worker and context. Main activity, active event, load overlay, hat, extra layers, label and speed. */
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
  // A worker's activity is valid while confirmed by the current tool, or within 60 seconds of its last confirmation.
  // An unconfirmed new tool cannot revive a stale activity from minutes ago, preventing view-level flicker.
  const own = st?.id && a !== 'idle' && (st.seen >= w.since || now - st.seen < HOLD_MS) ? st.id : undefined
  if (own) main = part(own, st?.at ?? w.since)
  // Candidate recognized for this tool but still unconfirmed: a long test, Git or database command.
  const pending = st?.next && (st.nextAt ?? -Infinity) >= w.since && !isEvent(st.next) ? st.next : undefined

  if (ctx.isBoss) {
    const pct = ctx.ctxPct
    if ((pct !== undefined && pct >= 95) || a === 'compacting' || ctx.limitFull) {
      main = part('nap-zzz', w.since)
    } else {
      if (pct !== undefined && pct >= 85) over = part('overheat-sweat', w.since)
      // A boss with no task of its own supervises the busy team, both while thinking and using tools, without oscillation.
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
  // Foreground command lasting over eight seconds (rule 15): display its recognized pending candidate;
  // otherwise show compilation, unless this tool confirmed act (seen >= since).
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
    // Do not overlay the load indicator on a head-anchored main activity. Events do not affect this, so finishing one does not change the picture.
    if (!(main && HEADISH.has(entry(main.id)?.anchor ?? ''))) view.over = over
  }
  if (main) view.main = main
  if (view.main?.id === 'detective-hunt') view.hat = true
  if (main?.id === 'film-shoot') {
    const last = (w.trail ?? []).slice(-1)[0]
    if (last?.s === 'video' && hash(`${w.id}${main.at}`) % 2 === 0) view.extra = [part('film-shoot_misir', main.at)]
  }
  // The label comes only from main; an event finishes through its own animation without changing the plate
  // or requesting another redraw (section 6.3). Waiting retains Waiting for you.
  if (a !== 'waiting' && view.main) {
    const id = view.main.id
    view.label = ctx.external && familyOf(id) === 'headset-listen' ? EXTERNAL_LABEL : ACT_LABEL[id]
  }

  return view
}

// --- Budget (section 5) ---

/** Initial ceiling for activity defs; the character set typically uses 24-30k. */
export const ACT_CAP = 20_000
/** Estimated cost of one use in the drawing body. */
export const ACT_USE_EST = 300
const STYLE_BASE = '.acb{transform-box:fill-box;transform-origin:50% 100%}'

function stripSymbol(key: string): string {
  const s = ACT_STRIPS[key]
  if (!s) return ''
  const w = s.n * s.fw

  return `<symbol id="ac-${key}" viewBox="0 0 ${w} ${s.fh}" width="${w}" height="${s.fh}"><image href="data:image/png;base64,${s.b64}" width="${w}" height="${s.fh}" style="image-rendering:pixelated"/></symbol>`
}

/** Full strip cost: symbol plus that activity's CSS. */
export function actCost(strip: string, id: string): number {
  return stripSymbol(strip).length + (ACT_CSS[id]?.length ?? 0)
}

/** Strip -> activity id, for its CSS. */
function idOfStrip(strip: string): string {
  if (ACTS[strip]) return strip
  for (const e of Object.values(ACTS)) if (e.strip.def === strip || Object.values(e.strip).includes(strip)) return e.id

  return strip
}

/** Event reserve: one typical event strip and use; main activities are planned independently. */
export const EV_RESERVE = 1600

/** Select embedded strips. First plan persistent parts within cap minus event reserve: boss parts, main activities by descending priority, overlays, popcorn and hats. Break ties by descending user count, then name for determinism. Then fit events, boss first, into the remaining and reserved budget up to cap. Confetti cannot displace another worker's prop; event and no-event drawings retain the same persistent set and settled key. Omitted parts leave the figure in its normal state. */
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
  // A strip requested as both persistent and event belongs to the persistent plan, without a duplicate event request.
  for (const s of lasting.keys()) events.delete(s)
  const sorted = (m: Map<string, Cand>) => [...m.values()].sort((a, b) => a.rank - b.rank || b.prio - a.prio || b.users.size - a.users.size || (a.strip < b.strip ? -1 : a.strip > b.strip ? 1 : 0))
  const allowed = new Set<string>()
  const cssPaid = new Set<string>()
  let total = STYLE_BASE.length + 16
  const fill = (order: Cand[], ceiling: number) => {
    for (const c of order) {
      const css = cssPaid.has(c.id) ? 0 : ACT_CSS[c.id]?.length ?? 0
      const cost = stripSymbol(c.strip).length + css + c.users.size * ACT_USE_EST
      // Omit the first strip that does not fit and all later ones, always dropping the lowest priorities monotonically without flicker.
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

/** Record a strip used in the drawing, like uses in charDefs. */
export function actUse(strip: string, id: string): void {
  used.set(strip, id)
}

/** Symbols for used and allowed strips only, plus one style element; clear the usage registry. */
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

/** Activity families for tests and HUD: base entries without variants. */
export const MAIN_ACTS: readonly string[] = Object.values(ACTS)
  .filter(e => e.role === 'ana')
  .map(e => e.id)
