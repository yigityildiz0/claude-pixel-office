import { atom, read } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { ActMark, ActState, Activity, FeedItem, MascotKind, Talk, Worker } from '../types'
import {
  ACTS,
  ACT_LABEL,
  LOOP_ACTS,
  evDuration,
  isWaitLoop,
  ACT_TRIGGERS,
  EXTERNAL_LABEL,
  MAIN_ACTS,
  actDefs,
  actUse,
  actView,
  activeLoop,
  applyLoop,
  applyPick,
  classifyError,
  clearLoops,
  endAct,
  familyOf,
  globalLoopOf,
  hasConsecutiveFails,
  hireAct,
  isEvent,
  keywordAct,
  pickActivity,
  planActs,
  pruneAct,
  pushEvWithRules,
  pushMark,
  settleAct,
  siblings,
  stripFor,
  withEv,
} from '../hooks/activities'
import type { ActCtx, ActPick, ActView, ErrorSignalInput, ToolFacts } from '../hooks/activities'
import { charDefs, charKindOf, drawCharacter, hatCrop } from '../hooks/characters'
import { ellipsize, textWidth } from '../hooks/props'
import type { CharKind, CharState } from '../hooks/characters'
import { hudSvg, useHudTheme } from '../hooks/hud'
import { DESK_GEOM, MAX_DESKS, fontOu, hintOf, layoutOffice, nextHint, positionAt, route, trackMoves } from '../hooks/layout'
import type { Box, LayoutHint } from '../hooks/layout'
import { cmdKind, dayKey, dutyFor, effortLevel, effortWord, fatigue, mascotFor, mascotOf, modelLabel, modelLine, normEffort, numberedName, planOf, readCodexConfig, readExternal, readTool, resolveAddress, settleTitle, siteOf, splitEffort, talkText, thinkKind, titleFor } from '../hooks/logic'
import { hurried, restOf } from '../hooks/events'
import { CV_FAULT, CV_LOOK, CV_VIA, readSnapshot } from '../hooks/cetvel'
import { ACT_STRIPS } from '../hooks/activity-data'
import { sceneSvg } from '../hooks/scene'

const PANE = {
  plugin: 'piksel-ofis',
  component: 'Pane',
  requestId: 'piksel-ofis',
  props: {
    title: 'Piksel Ofis',
    isFocused: false,
    bodyColumns: 160,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

/** Files the engine's fs answers (a path is matched by its end, in either spelling); undefined: not there. */
type TestBody = Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>

type World = { env?: Record<string, string>; files?: Record<string, () => { text: string; mtimeMs: number } | undefined> }

/**
 * The engine's answers; `many`: each agent.spawn seats a new agent (a1, a2, …) instead of a1 again;
 * `toolResult` may answer each call by its input; `world` adds variables and files.
 */
function engine(on: Parameters<TestBody>[1], toolResult: Record<string, unknown> | ((e: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>) = {}, many = false, agents?: () => unknown[], world: World = {}) {
  const fileOf = (path: string) => {
    const p = path.replace(/\\/g, '/')
    const key = Object.keys(world.files ?? {}).find(k => p.endsWith(k))

    return key ? world.files?.[key]?.() : undefined
  }
  let spawned = 0
  on('command.register', () => ({ value: { command: 'ofis' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000, tokens: 211_000, percent: 21 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 55 }],
    },
  }))
  on('agent.list', () => ({ value: (agents ? agents() : []) as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // an answer `{ deny }` is a refused call (by you or a hook); `{ isError: true }` is a failed call
  on('tool.call', async (_, e) => {
    const r = typeof toolResult === 'function' ? await toolResult(e as unknown as Record<string, unknown>) : toolResult
    if (typeof r.deny === 'string') return { deny: r.deny } as never
    if (r.isError === true) return { isError: true, result: r.result ?? r.text ?? '', ...(typeof r.text === 'string' ? { text: r.text } : {}) } as never

    return { result: r } as never
  })
  // a message reaches anyone the office knows, and nobody by the name "Yok"
  on('session.send', (_, e) => (e.to === 'Yok' ? { isDelivered: false as const, reason: 'nobody by that name' } : { isDelivered: true as const }))
  on('session.id', () => ({ value: 'test-chat' }))
  on('env.get', (_, e) => ({ value: world.env?.[e.name] ?? (e.name === 'USERPROFILE' ? 'C:/kullanici' : undefined) }))
  on('fs.stat', (_, e) => {
    const f = fileOf(e.path)
    if (!f) throw new Error('missing')

    return { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } }
  })
  if (world.files) {
    on('fs.read', (_, e) => {
      const f = fileOf(e.path)
      if (!f) throw new Error('missing')

      return { value: f.text }
    })
  }
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: many ? `a${++spawned}` : 'a1' }))
  on('classic.Stop', () => ({}))
}

test('the boss reads, hires a worker, and the HUD and tabs show it in plain words', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/app.tsx' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build -- --verbose', description: 'Projeyi derle' })
  await $.agent.spawn({ prompt: 'Logları tara', description: 'Logları tara', subagentType: 'Explore' } as never)
  await clock.advance(1200)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const hud = await ui.find({ type: 'Svg' })
  const source = String(hud?.props.source)
  // drawn to the pane's own size less a 40 px margin: 160 cells wide, filling 60 rows
  expect(hud?.props.width).toBe(1240)
  expect(Number(hud?.props.height)).toBeGreaterThanOrEqual(60 * 17 - 64)
  // an image, not the sandboxed frame that reloads from blank on each change
  expect(hud?.props.isInteractive).toBeFalsy()
  expect(source).toContain('Piksel Ofis')
  expect(source).toContain('PATRON')
  // 0.8: a desk carries a title from its work (an Explore that scans logs is a Kâşif), never 'Ajan N'
  expect(source).toContain('Kâşif')
  expect(source).not.toContain('Ajan 1')
  expect(source).toContain('işe başladı · Logları tara')
  // a wide pane keeps the feed to its newest line (0.4); older events live in the events list
  // the feed says what was done, never the raw command
  // (the newest line here is the hire, above; the command's wording is checked in the tools test)
  expect(source).not.toContain('npm run build')

  await ui.press({ key: 'tab-ekip' })
  const row = await ui.find({ key: 'w-a1' })
  expect(row?.text).toMatch(/■ Kâşif\s+Opus 5\.5/)
  expect((await ui.find({ key: 'w-boss' }))?.text).toMatch(/Patron/)
  await ui.unmount()
})

test('a narrow pane stacks the HUD at its own width', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 50, scroll: { offset: 0, bodyRows: 30 } }, surface: 'desktop' })
  const hud = await ui.find({ type: 'Svg' })
  expect(hud?.props.width).toBe(360)
  expect(String(hud?.props.source)).toContain('viewBox="0 0 360 ')
  await ui.unmount()
})

test('a terminal draws the office as text', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Bağlam %21/ }))?.text).toMatch(/211k \/ 1\.0M\) · 5 saat %55/)
  expect((await ui.find({ type: 'Text', text: /^Patron: / }))?.text).toMatch(/Boşta/)
  await ui.unmount()
})

test('thoughts, tools and sites are read the way the office shows them', async () => {
  expect(thinkKind('First I will outline the steps, then implement.')).toBe('plan')
  expect(thinkKind('The test is failing with a TypeError, let me fix it.')).toBe('debug')
  expect(thinkKind('Renk paleti ve yerleşim tasarım için önemli.')).toBe('design')
  expect(siteOf('https://www.reddit.com/r/ClaudeAI')).toBe('reddit')
  expect(siteOf('https://youtu.be/abc')).toBe('youtube')
  expect(siteOf('https://x.com/anthropicai')).toBe('x')
  expect(readTool('WebFetch', { url: 'https://github.com/pablodelucca/pixel-agents' }).site).toBe('github')
  expect(readTool('Bash', { command: 'npm test' }).activity).toBe('running')
  expect(readTool('Bash', { command: 'rm -rf node_modules && npm ci' }).detail).not.toMatch(/rm -rf/)
  expect(readTool('Edit', { file_path: 'C:/a/b.ts' }).bubble).toBe('Düzenliyorum: b.ts')
})

test('a full office of 26 busy workers stays inside the Svg limit at every width', async () => {
  const kinds: Activity[] = ['thinking', 'reading', 'writing', 'running', 'web', 'done', 'failed', 'waiting', 'answering', 'planning']
  const now = 1_800_000_000_000
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#FBBF24', seat: -1, activity: 'delegating', bubble: 'Ada, şuna bakar mısın?', detail: '', tools: 3, tokensOut: 100, since: now, joinedAt: now },
  ]
  for (let i = 0; i < 26; i++) {
    workers.push({
      id: `agent-${i}`,
      n: i,
      name: `Çalışan ${i}`,
      role: 'Kâşif',
      task: 'Uzun bir görev açıklaması '.repeat(4),
      color: '#2DD4BF',
      seat: i,
      activity: kinds[i % kinds.length] as Activity,
      think: 'research',
      site: 'youtube',
      bubble: 'Çok uzun bir konuşma balonu metni burada duruyor ve kesilmeli',
      detail: 'ayrıntı '.repeat(20),
      tools: i,
      tokensOut: 1000 * i,
      since: now,
      joinedAt: now - (i % 2 === 0 ? 500 : 60_000),
      endedAt: i % 7 === 5 ? now - 1000 : undefined,
    })
  }
  const usage = { ctxPct: 91, ctxTokens: 910_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 80 }], at: now, history: [10, 30, 55, 91] }
  const turn = { active: true, steps: 3, turns: 2, prompt: 'Ofisi kur', model: 'claude-opus-5-5', effort: 'high' }
  const scene = sceneSvg({ workers, usage, turn, now, motion: true })
  expect(scene.svg.length).toBeLessThan(131_072)
  expect(scene.svg).toContain('+2 çalışan daha')

  const feed = Array.from({ length: 60 }, (_, i) => ({ t: now - i * 1000, who: `Çalışan ${i % 26}`, color: '#2DD4BF', kind: 'read' as const, text: `okudu · dosya-${i}.ts` }))
  const stats = { tools: { Read: 40, Bash: 12 }, hired: 26, outTokens: 50_000, inTokens: 900_000, cacheRead: 800_000, sessionStart: now - 3_600_000 }
  for (const width of [340, 600, 1000, 1600, 2400]) {
    const hud = hudSvg({ workers, feed, usage, turn, stats, now, motion: true, width, fill: 1400 })
    expect(hud.svg.length).toBeLessThan(131_072)
    expect(hud.width).toBe(width)
    expect(hud.height).toBeGreaterThan(0)
  }
})

test('auto compact is set from the pane, shared, and runs once past the threshold', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  const written: Record<string, string> = {}
  on('fs.write', (_, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    if (e.path in written) return { value: written[e.path] as string }
    throw new Error('missing')
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  let compacts = 0
  on('session.compact', () => {
    compacts++
    return { skip: 'test' } as never
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // the setting lives under "Ayarlar ▾" since 0.4
  await ui.press({ key: 'settings' })
  // a new chat starts with auto compact on at 80% (on purpose, as kota-bandi does; README: Varsayılan)
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/açık · %75/)
  await ui.press({ key: 'auto' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/kapalı/)
  // switching it back on keeps the threshold it had
  await ui.press({ key: 'auto' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/açık · %75/)
  await ui.press({ key: 'autoDown' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/%70/)
  // the setting lands in the shared folder, where kota-bandi reads it
  expect(Object.values(written).some(t => t.includes('"at":70'))).toBe(true)
  await ui.unmount()

  // past the threshold between turns it compacts once, not on every measurement
  const measure = (percent: number) => $.session.measure({ context: { window: 1_000_000, tokens: percent * 10_000, percent }, rateLimits: [], changed: ['context'] })
  await measure(85)
  await clock.advance(1500)
  expect(compacts).toBe(1)
  await measure(86)
  await clock.advance(1500)
  expect(compacts).toBe(1)
  // back under it, then past it again mid-reply: it waits for the turn to end
  await measure(50)
  await $.turn.start({ turnId: 't-oto', text: 'devam' } as never)
  await measure(85)
  await clock.advance(1500)
  expect(compacts).toBe(1)
  await $.turn.complete({ turnId: 't-oto', answer: '', reason: 'answer', isAborted: false, durationMs: 1000 } as never)
  await clock.advance(2000)
  expect(compacts).toBe(2)
  // kota-bandi runs it while its mark is fresh: the office leaves it to the band
  await measure(50)
  // the engine hands the path back in the platform's own spelling
  const shared = Object.keys(written).find(k => k.includes('claude-auto-compact'))?.replace(/[^\\/]+$/, '')
  written[`${shared}kota-bandi.alive`] = String(clock.now())
  await measure(85)
  await clock.advance(1500)
  expect(compacts).toBe(2)
})

test('the overview holds its frame while Claude works, then paints the news', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const first = String((await ui.find({ type: 'Svg' }))?.props.source)
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/yeni.ts' })
  await clock.advance(1500)
  // a burst of work does not redraw the picture at once
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toBe(first)
  await clock.advance(8200)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('okudu · yeni.ts')
  await ui.unmount()
})

test('an idle office draws the same picture seconds apart (the pane must not repaint for the clock hand)', async () => {
  const now = Date.parse('2026-10-28T19:40:10Z')
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#FBBF24', seat: -1, activity: 'idle', bubble: 'Kahve molası.', detail: '', tools: 0, tokensOut: 0, since: now - 400_000, joinedAt: now - 99_999 },
  ]
  const usage = { ctxPct: 21, ctxTokens: 211_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 55, resetsAt: new Date(now + 37 * 60_000).toISOString() }], at: now, history: [3, 21] }
  const turn = { active: false, steps: 0, turns: 0, prompt: '', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: {}, hired: 0, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: now - 3_600_000 }
  const shown = (at: number) => hudSvg({ workers, feed: [], usage, turn, stats, now: at, motion: true, width: 856, fill: 761 }).svg.replace(/animation:[^;"]*/g, '').replace(/ begin="[^"]*"/g, '')
  expect(shown(now + 7000)).toBe(shown(now))
})

test('the scoreboard shows today’s cost and this chat’s total together at every width, side by side where they fit', async () => {
  const now = Date.parse('2026-11-09T12:00:00Z')
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#FBBF24', seat: -1, activity: 'thinking', bubble: '', detail: '', tools: 0, tokensOut: 0, since: now - 5000, joinedAt: now - 99_999 },
  ]
  const usage = { ctxPct: 21, ctxTokens: 211_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 55 }], usd: 12.4, at: now }
  const turn = { active: true, steps: 1, turns: 6, prompt: 'Ofisi kur', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: { Read: 4 }, hired: 0, outTokens: 9000, inTokens: 0, cacheRead: 0, sessionStart: now - 3_600_000 }
  const daily = { day: dayKey(now), usd: 38.1, sessions: 3, at: now }
  // what is written on the board (not the hover title)
  const at = (svg: string, word: string) => {
    const m = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${word.replace('$', '\\$')}</text>`).exec(svg)
    return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined
  }
  for (const [width, fill] of [[340, 900], [420, 900], [700, 1200], [1200, 1100], [2000, 950]] as const) {
    const svg = hudSvg({ workers, feed: [], usage, turn, stats, now, motion: false, width, fill, daily }).svg.replace(/<title>[^<]*<\/title>/g, '')
    const today = at(svg, 'BUGÜN')
    const chat = at(svg, 'BU SOHBET') ?? at(svg, 'SOHBET')
    expect(today).toBeDefined()
    expect(chat).toBeDefined()
    expect(at(svg, '$38.10')).toBeDefined()
    expect(at(svg, '$12.40')).toBeDefined()
    if (!today || !chat) continue
    // side by side (today first) or stacked (today on top, this chat right under it)
    if (chat.y === today.y) expect(chat.x).toBeGreaterThan(today.x)
    else {
      expect(chat.y).toBeGreaterThan(today.y)
      expect(Math.abs(chat.x - today.x)).toBeLessThan(8)
    }
    // a wide board has them in one row
    if (width === 2000) expect(chat.y).toBe(today.y)
  }
})

// —— 0.6: models, mascots, outside workers and talks between the desks ——

const DESK = { ...PANE, surface: 'desktop' as const }
const TERM = { ...PANE, surface: 'terminal' as const }

test('models, mascots, duties, outside workers and messages are read the way the office shows them', async () => {
  // 1.0: four platform mascots; a model id only says the platform of a worker that carries none
  expect(mascotOf('claude-opus-5-5')).toBe('claude')
  expect(mascotOf('claude-opus-5-5', true)).toBe('boss')
  expect(mascotOf('claude-sonnet-5-5')).toBe('claude')
  expect(mascotOf('claude-haiku-4-5-20251001')).toBe('claude')
  expect(mascotOf('gpt-6.1-sol')).toBe('gpt')
  expect(mascotOf('gpt-6.1-terra')).toBe('gpt')
  expect(mascotOf('gpt-6.1-terra', true)).toBe('boss')
  expect(mascotOf('gpt-6.1-luna')).toBe('gpt')
  expect(mascotOf('gemini-3-flash-preview')).toBe('agy')
  expect(mascotOf('gemini-3-pro')).toBe('agy')
  expect(mascotOf('gpt-5.5')).toBe('gpt')
  expect(mascotOf('console-solver')).toBe('claude')
  expect(mascotOf(undefined)).toBe('claude')
  expect(mascotOf(undefined, true)).toBe('boss')

  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelLabel('gpt-6.1-terra')).toBe('GPT-6.1 Terra')
  expect(modelLabel('gemini-3-flash-preview')).toBe('Gemini 3 Flash')
  expect(modelLabel(undefined)).toBe('model okunuyor')
  expect(modelLabel('mistral-large-latest-2026')).toBe('mistral-large-latest-2026')
  expect(effortLevel('low')).toBe(1)
  expect(effortLevel('xhigh')).toBe(4)
  expect(effortLevel('max')).toBe(5)
  expect(effortLevel('12000')).toBe(3)
  expect(effortLevel(undefined)).toBe(0)

  expect(readExternal('codex.exe exec -m gpt-6.1-terra -c model_reasoning_effort=high -s read-only "Kodu incele"')).toEqual({ cli: 'codex', model: 'gpt-6.1-terra', effort: 'high', sandbox: 'read' })
  expect(readExternal('cat C:/codex-notes/a.md')).toBeUndefined()
  expect(readExternal('ls gemini')).toBeUndefined()
  expect(readExternal('cd C:/proje && codex exec --sandbox workspace-write "Hatayı düzelt -m sahte"')).toEqual({ cli: 'codex', sandbox: 'write' })
  expect(readExternal('gemini -m gemini-3-flash --approval-mode plan -p "özetle"')).toEqual({ cli: 'gemini', model: 'gemini-3-flash', sandbox: 'read' })
  expect(readExternal('& "C:/Araclar/agy.exe" --model gemini-3-pro --yolo')).toEqual({ cli: 'agy', model: 'gemini-3-pro', sandbox: 'write' })
  // the shell call reads as a job handed out, never as its command
  const bash = readTool('Bash', { command: 'codex exec -m gpt-6.1-luna -s read-only "gizli istem"', description: 'İkinci görüş' })
  expect(bash.activity).toBe('delegating')
  expect(bash.bubble).toBe('GPT-6.1 Luna işe koşuldu')
  expect(JSON.stringify(bash)).not.toMatch(/gizli|read-only/)
  expect(readTool('SendMessage', { to: 'Ada', message: 'selam' }).activity).toBe('messaging')

  expect(dutyFor({ sandbox: 'read' })).toBe('critic')
  expect(dutyFor({ sandbox: 'write' })).toBe('builder')
  expect(dutyFor({ task: 'Tasarımı eleştir' })).toBe('critic')
  expect(dutyFor({ task: 'Fikirleri değerlendir' })).toBe('evaluator')
  expect(dutyFor({ task: 'İnşa et: sahne' })).toBe('builder')
  expect(dutyFor({ type: 'Explore', task: 'Logları tara' })).toBe('explorer')
  expect(dutyFor({ type: 'Plan', task: 'Yol haritası' })).toBe('planner')
  expect(dutyFor({ task: 'Logları incele', writes: 2 })).toBe('builder')
  expect(dutyFor({ task: 'Merhaba' })).toBe('general')

  expect(talkText('Testleri de çalıştır', 'uzun metin')).toBe('Testleri de çalıştır')
  expect(talkText(undefined, '\n   C:/proje/src/app.tsx dosyasına bak\nikinci satır')).toBe('app.tsx dosyasına bak')
  expect(talkText(undefined, 'a '.repeat(80)).length).toBeLessThanOrEqual(48)

  const now = 1_800_000_000_000
  const w = (id: string, name: string, extra: Partial<Worker> = {}): Worker => ({ id, n: 0, name, role: 'Genel', task: '', color: '#fff', seat: 0, activity: 'idle', bubble: '', detail: '', tools: 0, tokensOut: 0, since: now, joinedAt: now, ...extra })
  const office = [w('boss', 'Patron'), w('a1', 'Ada'), w('a2', 'Can', { addr: ['scout', 'scout@ekip'] })]
  expect(resolveAddress(office, 'main')).toBe('boss')
  expect(resolveAddress(office, 'team-lead')).toBe('boss')
  expect(resolveAddress(office, 'ADA')).toBe('a1')
  expect(resolveAddress(office, 'a2')).toBe('a2')
  expect(resolveAddress(office, 'scout@ekip')).toBe('a2')
  expect(resolveAddress(office, 'scout')).toBe('a2')
  expect(resolveAddress(office, 'kimse')).toBe('')

  // 0.7: 'flash' is Gemini Flash only inside a Gemini name; other Claude models; an open model is no platform of its own; Antigravity
  expect(mascotOf('deepseek-v4.1-flash')).toBe('claude')
  expect(mascotOf('qwen3.8-flash-next')).toBe('claude')
  expect(mascotOf('gemini-3-flash')).toBe('agy')
  expect(mascotOf('claude-fable-5')).toBe('claude')
  expect(mascotOf('claude-fable-5', true)).toBe('boss')
  expect(mascotFor({ id: 'ext:1', model: 'deepseek-v4.1-flash', via: 'gpt' })).toBe('gpt')
  // an Antigravity run is the Antigravity mascot whatever model it runs: the model is on its panel
  expect(mascotFor({ id: 'ext:2', model: 'claude-sonnet-4-5', via: 'agy' })).toBe('agy')
  expect(mascotFor({ id: 'ext:3', model: 'claude-opus-5-5', via: 'gpt' })).toBe('gpt')
  expect(mascotFor({ id: 'boss', model: 'gpt-6.1-terra' })).toBe('boss')
  // a Claude Code loop is the orange worker whatever its model or guess; the Gemini CLI (no platform) reads off its model
  expect(mascotFor({ id: 'a1', model: 'gpt-6.1-sol', kind: 'agent' })).toBe('claude')
  expect(mascotFor({ id: 'ext:4', model: 'gemini-3-pro', kind: 'external' })).toBe('agy')
  // a model the office has no name for shows as it is; an unknown model is never a bare dash
  expect(modelLabel('glm-5.3')).toBe('glm-5.3')
  expect(modelLabel('deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
  expect(modelLabel(undefined, 'agy')).toBe('model okunuyor')
  expect(modelLabel('codex')).toBe('Codex')
  expect(readExternal('codex exec -p work -m deepseek-v4.1-flash "Kodu incele"')).toEqual({ cli: 'codex', profile: 'work', model: 'deepseek-v4.1-flash' })
  expect(readExternal('codex exec --profile=work -s read-only "x"')).toEqual({ cli: 'codex', profile: 'work', sandbox: 'read' })
  // a python helper is no outside CLI
  expect(readExternal('python C:/Araclar/yardimci.py -m glm-5.3 "özetle"')).toBeUndefined()
  expect(readExternal('cd C:/x && uv run yardimci --model qwen3.8-flash-next')).toBeUndefined()
  expect(readExternal('cat codex.md')).toBeUndefined()
  expect(readExternal('agy --model claude-sonnet-4-5 -p "incele"')).toEqual({ cli: 'agy', model: 'claude-sonnet-4-5' })
  const ext = readTool('Bash', { command: 'codex exec -p work -m gpt-6.1-sol "gizli istem"', description: 'Ara' })
  expect(ext.bubble).toBe('GPT-6.1 Sol işe koşuldu')
  expect(JSON.stringify(ext)).not.toMatch(/gizli/)
})

test('a hired worker sits at its desk as its model’s mascot, and the team list names model and duty', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Kodu incele', description: 'Kodu incele', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  const drawn = String((await ui.find({ type: 'Svg' }))?.props.source)
  // the orange worker for every Claude model (the boss wears its crown over the same sheet)
  expect(drawn).toMatch(/id="ch-turuncu-/)
  expect(drawn).not.toContain('ch-yesil-')
  expect(drawn).not.toContain('ch-mavi-')
  await ui.press({ key: 'tab-ekip' })
  expect((await ui.find({ key: 'w-a1' }))?.text).toMatch(/Denetçi\s+Opus 5\.5/)
  await ui.unmount()
})

test('an outside worker (codex in the shell) takes a desk, and nothing of its command reaches the picture', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-terra' })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  await $.tool.call({ tool: 'Bash', command: 'codex.exe exec -m gpt-6.1-terra -c model_reasoning_effort=high -s read-only "Gizli istem metni: C:/gizli/plan.md"', description: 'Kodu incele' })
  await clock.advance(3500)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('Terra')
  expect(source).toContain('GPT-6.1 Terra · yüksek · başladı')
  for (const secret of ['-s read-only', 'read-only', 'Gizli istem', 'C:/gizli', 'plan.md', 'model_reasoning_effort', 'codex.exe']) expect(source).not.toContain(secret)
  await ui.unmount()

  // the shell's background task is gone: the worker has finished and reports back
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await clock.advance(1200)
  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /^■ Dış Uzman/ }))?.text).toMatch(/Dış Uzman\s+GPT-6\.1 Terra · yüksek · /)
  expect((await term.find({ type: 'Text', text: /Patron → Dış Uzman · Kodu incele/ }))?.text).toMatch(/^✈/)
  expect((await term.find({ type: 'Text', text: /Dış Uzman → Patron/ }))?.text).toMatch(/İş bitti/)
  await term.unmount()
})

test('a message between desks is a talk: delivered it flies, undelivered it says so', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Logları tara', description: 'Logları tara', subagentType: 'Explore' } as never)
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  await $.tool.call({ tool: 'SendMessage', to: 'Kâşif', summary: 'Testleri de çalıştır', message: 'Testleri de çalıştır, sonra C:/proje/rapor.md yaz' })
  await $.session.send({ to: 'Kâşif', text: 'Testleri de çalıştır, sonra C:/proje/rapor.md yaz' } as never)
  // a message is news: the picture shows it within seconds, the paper plane flying
  await clock.advance(3500)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('→')
  expect(source).toContain('<animateMotion')
  expect(source).not.toContain('rapor.md')
  await ui.unmount()

  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /Patron → Kâşif · Testleri de çalıştır/ }))?.text).toMatch(/^✉/)
  await term.unmount()

  await $.session.send({ to: 'Yok', text: 'Kimse duymadı' } as never)
  await clock.advance(1200)
  const again = await $.ui.mount(TERM)
  expect((await again.find({ type: 'Text', text: /→ Yok/ }))?.text).toMatch(/ulaşmadı · Kimse duymadı/)
  await again.unmount()
})

test('news is painted soon: a hire after the pane opened is drawn within 3.5 seconds', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  const first = String((await ui.find({ type: 'Svg' }))?.props.source)
  await $.agent.spawn({ prompt: 'Sahneyi kur', description: 'Sahneyi kur', subagentType: 'general-purpose' } as never)
  await clock.advance(3500)
  const now = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(now).not.toBe(first)
  expect(now).toContain('işe başladı · Sahneyi kur')
  await ui.unmount()
})

test('an office of 26 workers on 10 models, talking, stays inside the Svg limit at every width', async () => {
  const now = 1_800_000_000_000
  const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6.1-luna', 'gemini-3-pro', 'gemini-3-flash', 'mistral-large', 'claude-opus-4-1']
  const kinds: Activity[] = ['thinking', 'reading', 'writing', 'running', 'web', 'done', 'idle', 'waiting', 'messaging', 'delegating']
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'delegating', bubble: 'Ada, şuna bakar mısın?', detail: '', tools: 3, tokensOut: 100, since: now, joinedAt: now, model: 'claude-opus-5-5', effort: 'xhigh' },
  ]
  for (let i = 0; i < 26; i++) {
    workers.push({
      id: i % 4 === 3 ? `ext:t${i}` : `agent-${i}`,
      n: i,
      name: `Çalışan ${i}`,
      role: i % 4 === 3 ? 'Dış işçi' : 'Kâşif',
      task: 'Uzun bir görev açıklaması '.repeat(4),
      color: '#2DD4BF',
      seat: i,
      activity: kinds[i % kinds.length] as Activity,
      think: 'research',
      bubble: 'Çok uzun bir konuşma balonu metni burada duruyor ve kesilmeli',
      detail: 'ayrıntı '.repeat(20),
      tools: i,
      tokensOut: 1000 * i,
      since: now,
      joinedAt: now - (i % 2 === 0 ? 500 : 60_000),
      endedAt: i % 7 === 5 ? now - 1000 : undefined,
      model: models[i % models.length],
      effort: ['low', 'medium', 'high', 'xhigh', 'max'][i % 5],
      kind: i % 4 === 3 ? 'external' : 'agent',
      parentId: i % 5 === 0 ? 'boss' : `agent-${i - (i % 5)}`,
      duty: (['builder', 'critic', 'evaluator', 'explorer', 'planner', 'general'] as const)[i % 6],
      idleSince: kinds[i % kinds.length] === 'idle' ? now - 30_000 : undefined,
    })
  }
  const talks: Talk[] = Array.from({ length: 40 }, (_, i) => ({
    id: `msg:${i}`,
    t: now - i * 700,
    from: i % 3 === 0 ? 'boss' : `agent-${i % 26}`,
    to: i % 5 === 0 ? '' : `agent-${(i + 7) % 26}`,
    kind: (['order', 'report', 'message'] as const)[i % 3] as Talk['kind'],
    text: 'Testleri çalıştır ve sonucu bana raporla lütfen',
    isDelivered: i % 9 !== 0,
    readAt: i % 2 === 0 ? now - 100 : undefined,
  }))
  const feed: FeedItem[] = Array.from({ length: 60 }, (_, i) => ({ t: now - i * 1000, who: `Çalışan ${i % 26}`, whoId: `agent-${i % 26}`, color: '#2DD4BF', kind: i % 2 ? ('talk' as const) : ('ext' as const), text: `GPT Terra · başladı · dosya-${i}`, to: 'Ada', toColor: '#5B8FC7', toId: 'agent-1' }))
  const usage = { ctxPct: 91, ctxTokens: 910_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 80 }], at: now, history: [10, 30, 55, 91] }
  const turn = { active: true, steps: 3, turns: 2, prompt: 'Ofisi kur', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: { Read: 40, Bash: 12 }, hired: 26, outTokens: 50_000, inTokens: 900_000, cacheRead: 800_000, sessionStart: now - 3_600_000 }
  for (const width of [340, 600, 1000, 1600, 2400]) {
    const args: Parameters<typeof hudSvg>[0] & { talks?: readonly Talk[]; lastFrameAt?: number } = { workers, feed, usage, turn, stats, now, motion: true, width, fill: 1400, talks, lastFrameAt: now - 3000 }
    const hud = hudSvg(args)
    expect(hud.svg.length).toBeLessThan(131_072)
    expect(hud.width).toBe(width)
  }
})

test('a teammate rests while it waits, asks for approval at its own desk, and comes back when resumed', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('classic.TeammateIdle', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.SubagentStop', () => ({}))
  const line = async () => {
    const term = await $.ui.mount(TERM)
    const text = (await term.find({ type: 'Text', text: /^■ Kâşif/ }))?.text ?? ''
    await term.unmount()
    return text
  }

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Logları tara', description: 'Logları tara', subagentType: 'Explore' } as never)
  await clock.advance(1200)
  await $.classic.TeammateIdle({ teammate_name: 'Kâşif', team_name: 'ekip', agent_id: 'a1' })
  await clock.advance(1200)
  expect(await line()).toMatch(/Mesaj bekliyorum/)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, agent_id: 'a1' })
  await clock.advance(1200)
  const asking = await line()
  expect(asking).toMatch(/Onay bekliyorum: Bash/)
  expect(asking).not.toMatch(/rm -rf/)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '', agent_type: 'Explore', last_assistant_message: 'Loglar temiz.' })
  await clock.advance(1200)
  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /Kâşif → Patron/ }))?.text).toMatch(/Loglar temiz/)
  await term.unmount()
  await $.agent.spawn({ prompt: '', description: 'Logları tara', subagentType: 'Explore', resume: { agentId: 'a1' } } as never)
  await clock.advance(1200)
  expect(await line()).toMatch(/Yeniden göreve döndüm/)
})

// —— 0.7: the office fills the pane, the team walks between desks, the facts live in the office's objects ——

const T0 = 1_800_000_000_000
const crew = (n: number, extra: Partial<Worker> = {}): Worker[] => [
  { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'idle', bubble: '', detail: '', tools: 0, tokensOut: 0, since: T0, joinedAt: T0 - 999_999 },
  ...Array.from({ length: n }, (_, i): Worker => ({ id: `a${i}`, n: i, name: `Ajan ${i + 1}`, role: 'Genel', task: '', color: '#5B8FC7', seat: i, activity: 'reading', bubble: '', detail: '', tools: 0, tokensOut: 0, since: T0, joinedAt: T0 - 100_000 + i * 1000, ...extra })),
]
const MATRIX: Array<[number, number]> = [[1280, 968], [856, 761], [400, 458], [340, 1400], [700, 1100], [1100, 700], [1600, 600], [2400, 1400], [600, 1400], [1920, 1000], [2400, 500], [340, 380]]
const inBox = (a: Box, z: Box): boolean => a.x >= z.x - 0.5 && a.y >= z.y - 0.5 && a.x + a.w <= z.x + z.w + 0.5 && a.y + a.h <= z.y + z.h + 0.5
const cross = (a: Box, b: Box): number => Math.min(Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)))
const ON_WALL = new Set(['sign', 'clock', 'calendar', 'scoreboard', 'window0', 'window1', 'window2', 'window3'])

test('the office fills every pane: its zones tile the scene, each object sits in its zone, and the boss desk stands out', async () => {
  const wrong: string[] = []
  for (const [W, H] of MATRIX) {
    for (const n of [0, 1, 3, 6, 12, 24, 26]) {
      const L = layoutOffice({ workers: crew(n), W, H })
      const at = `${W}x${H} n=${n}`
      const z = L.zones
      const tiles = [z.wall, z.ticker, z.boss, z.floor]
      const area = tiles.reduce((a, b) => a + b.w * b.h, 0)
      if (Math.abs(area - L.SW * L.SH) / (L.SW * L.SH) >= 0.005) wrong.push(`${at}: zones do not tile`)
      for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) if (cross(tiles[i] as Box, tiles[j] as Box) >= 0.5) wrong.push(`${at}: zones ${i} and ${j} overlap`)
      if (!inBox(z.glass, z.boss) || !inBox(z.corridor, z.floor)) wrong.push(`${at}: glass or corridor astray`)
      for (const [id, b] of Object.entries(L.objects)) {
        const zone = ON_WALL.has(id) || (id === 'whiteboard' && L.objects.calendar) ? z.wall : z.boss
        if (!b || !inBox(b, zone) || b.w <= 0 || b.h <= 0) wrong.push(`${at}: ${id} outside its zone`)
        if (b && !ON_WALL.has(id) && cross(b, L.boss.desk) >= 0.5) wrong.push(`${at}: ${id} on the boss desk`)
      }
      if (!inBox(L.boss.desk, z.boss)) wrong.push(`${at}: boss desk outside the boss zone`)
      if (L.boss.desk.w < 1.2 * DESK_GEOM[L.variant].w - 0.01) wrong.push(`${at}: boss desk too small`)
      for (const c of L.cells) if (!inBox(c.box, z.floor)) wrong.push(`${at}: cell ${c.i} off the floor`)
      if (L.cells.filter(c => c.kind === 'desk').length !== Math.min(n, MAX_DESKS)) wrong.push(`${at}: desk count`)
      if (L.cells[L.cells.length - 1]?.kind !== 'coffee') wrong.push(`${at}: the coffee corner is not last`)
      if (L.hidden !== Math.max(0, n - MAX_DESKS)) wrong.push(`${at}: hidden`)
      if (L.s >= 0.625 && L.charSize * L.s < 28) wrong.push(`${at}: characters under 28 px`)
      // walks keep to the walkways: one axis at a time, at most 8 points
      for (const c of L.cells.filter(c => c.kind === 'desk').slice(0, 3)) {
        for (const to of [L.door, L.coffee, L.boss.throne]) {
          const r = route(L, c.seat, to)
          if (r.length > 8) wrong.push(`${at}: a walk of ${r.length} points`)
          for (let i = 1; i < r.length; i++) {
            const p = r[i - 1] as [number, number]
            const q = r[i] as [number, number]
            if (Math.abs(p[0] - q[0]) > 0.5 && Math.abs(p[1] - q[1]) > 0.5) wrong.push(`${at}: a diagonal step`)
          }
        }
      }
    }
  }
  expect(wrong).toEqual([])
  // text never under its pixel floor on screen
  expect(fontOu(0.75, 10, 6) * 0.75).toBeGreaterThanOrEqual(10)
  expect(fontOu(2.5, 10, 6)).toBe(6)
  // the same input lays out the same office
  const a = layoutOffice({ workers: crew(24), W: 1280, H: 968 })
  const b = layoutOffice({ workers: crew(24), W: 1280, H: 968 })
  expect(JSON.stringify({ ...a, seats: [...a.seats], leavers: [...a.leavers] })).toBe(JSON.stringify({ ...b, seats: [...b.seats], leavers: [...b.leavers] }))
})

test('the team is packed in hire order: when one leaves the rest walk up a desk, staggered, from wherever they are', async () => {
  const six = crew(6)
  const L1 = layoutOffice({ workers: six, W: 1280, H: 968 })
  const st1 = trackMoves(undefined, L1, six, T0, 'p')
  expect(Object.keys(st1.moves)).toHaveLength(0)
  const five = six.map(w => (w.id === 'a1' ? { ...w, activity: 'leaving' as const, since: T0 + 1000 } : w))
  const L2 = layoutOffice({ workers: five, W: 1280, H: 968, hint: hintOf(L1, T0), now: T0 + 1000, spotsPx: { ...st1.spots, ...st1.leaving } })
  expect(L2.key).toBe(L1.key)
  const st2 = trackMoves(st1, L2, five, T0 + 1000, 'p')
  expect(Object.keys(st2.moves).sort()).toEqual(['a2', 'a3', 'a4', 'a5'])
  ;['a2', 'a3', 'a4', 'a5'].forEach((id, k) => {
    const m = st2.moves[id]
    expect(m?.at).toBe(T0 + 1000 + 1200 + 350 * k)
    expect(m?.dur).toBeGreaterThanOrEqual(900)
    expect(m?.dur).toBeLessThanOrEqual(4500)
    expect(m?.kind).toBe('repack')
  })
  // no gap where the leaver sat: the desks are the snake's first five cells
  expect(L2.cells.filter(c => c.kind === 'desk').map(c => c.i)).toEqual([0, 1, 2, 3, 4])
  // the leaver walks out from its own desk
  const out = L2.leavers.get('a1')
  expect(out).toBeDefined()
  expect(Math.abs((out?.[0] ?? 0) * L2.s - (st1.spots.a1?.[0] ?? -1))).toBeLessThan(0.5)
  // a new pane size walks nobody
  expect(Object.keys(trackMoves(st2, L2, five, T0 + 1500, 'q').moves)).toHaveLength(0)
  // a walk turned round mid-way starts where the walker is
  const mid = T0 + 1000 + 1200 + 600
  const four = five.map(w => (w.id === 'a2' ? { ...w, activity: 'leaving' as const, since: mid } : w))
  const L3 = layoutOffice({ workers: four, W: 1280, H: 968, hint: hintOf(L1, T0), now: mid, spotsPx: { ...st2.spots, ...st2.leaving } })
  const st3 = trackMoves(st2, L3, four, mid, 'p')
  const walking = st2.moves.a3
  expect(walking).toBeDefined()
  const here = walking ? positionAt(walking, mid) : [0, 0]
  const from = st3.moves.a3?.pts[0] ?? [-99, -99]
  expect(Math.hypot((here[0] ?? 0) - from[0], (here[1] ?? 0) - from[1])).toBeLessThan(1)
  // nobody jumps: 100 ms apart a walker moves at most 12 ou
  let jump = 0
  for (let t = mid; t < mid + 14_000; t += 100) {
    for (const m of Object.values(st3.moves)) {
      const p = positionAt(m, t)
      const q = positionAt(m, t + 100)
      jump = Math.max(jump, Math.hypot(p[0] - q[0], p[1] - q[1]) / L3.s)
    }
  }
  expect(jump).toBeLessThanOrEqual(12)
  // the boss walks to the whiteboard to plan
  const planning = six.map(w => (w.id === 'boss' ? { ...w, activity: 'planning' as const } : w))
  expect(trackMoves(st1, L1, planning, T0 + 500, 'p').moves.boss?.kind).toBe('boss')
  // a team of 5 and 6 back and forth for 20 s changes the layout at most once
  for (const [W, H] of MATRIX) {
    let hint: LayoutHint | undefined
    let last = ''
    let changes = 0
    for (let i = 0; i < 20; i++) {
      const now = T0 + i * 1000
      const L = layoutOffice({ workers: crew(i % 2 === 0 ? 5 : 6), W, H, hint, now })
      const k = `${L.topo}|${L.s}|${L.variant}|${L.cols}`
      if (last !== '' && k !== last) changes++
      last = k
      hint = nextHint(hint, L, now)
    }
    expect(changes).toBeLessThanOrEqual(1)
  }
})

test('the pane is not repainted while the team walks or a plane flies; a new talk repaints it', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, {}, true)
  on('classic.SubagentStop', () => ({}))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  const src = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  for (let i = 1; i <= 20; i++) await $.agent.spawn({ prompt: `Görev ${i}`, description: `Görev ${i}`, subagentType: 'general-purpose' } as never)
  await clock.advance(12_000)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'Bitti.' })
  // its report flies back; 40 s later it packs up and leaves, and the 19 behind it walk up a desk
  const seen: string[] = []
  for (let s = 0; s < 75; s++) {
    await clock.advance(1000)
    seen.push(await src())
  }
  const changes = seen.filter((x, i) => i > 0 && x !== seen[i - 1]).length
  // the report, the leaving, at most one more as it walks out of the door; never the walks themselves
  expect(changes).toBeGreaterThanOrEqual(2)
  expect(changes).toBeLessThanOrEqual(3)
  const before = await src()
  await $.tool.call({ tool: 'SendMessage', to: 'Asistan 2', summary: 'Sıradaki işe geç', message: 'Sıradaki işe geç' })
  await $.session.send({ to: 'Asistan 2', text: 'Sıradaki işe geç' } as never)
  await clock.advance(3500)
  expect(await src()).not.toBe(before)
  await ui.unmount()
})

test('the office tells it all: desk card, model panel, monitor, water cooler, battery and scoreboard, and never a raw command', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Kodu incele', description: 'Kodu incele', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/app.tsx', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build -- --verbose', description: 'Projeyi derle' })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('Denetçi')
  expect(source).toContain('Opus 5.5')
  expect(source).toContain('app.tsx')
  // the context in the water cooler, what is left of the 5-hour limit (55 % used) in the battery
  expect(source).toContain('%21')
  expect(source).toContain('%45')
  expect(source).toContain('TUR')
  expect(source).not.toContain('C:/proje')
  expect(source).not.toContain('npm run build')
  await ui.unmount()

  // a command reads as one white-listed word, never its arguments
  expect(cmdKind('rm -rf node_modules && npm ci')).toBe('silme')
  expect(cmdKind('npm run build -- --verbose')).toBe('npm build')
  expect(cmdKind('cd C:/proje && git commit -m "gizli mesaj"')).toBe('git commit')
  expect(cmdKind('python -m pytest tests/ -k gizli')).toBe('pytest')
  expect(cmdKind('$env:X="1"; npm test')).toBe('npm test')
  expect(cmdKind('curl -s https://gizli.example/x')).toBe('indirme')
  expect(cmdKind('./gizli-betik.sh --secret')).toBe('komut')
  expect(readTool('Read', { file_path: 'C:/proje/src/app.tsx' }).screen).toEqual({ kind: 'file-read', label: 'app.tsx' })
  expect(readTool('Bash', { command: 'npm test -- --watch' }).screen).toEqual({ kind: 'cmd', label: 'npm test' })
  expect(readTool('WebFetch', { url: 'https://github.com/x/y' }).screen).toEqual({ kind: 'site', label: 'GitHub', site: 'github' })
  expect(readTool('Glob', { pattern: 'C:/proje/**/*.ts' }).screen.label).toBe('*.ts')
  expect(planOf({ todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] })).toEqual({ done: 1, total: 3 })
  // the lower the allowance, the more tired the office
  expect(fatigue({ limits: [{ kind: 'five_hour', pct: 55 }] }, T0)).toBe(0)
  expect(fatigue({ limits: [{ kind: 'five_hour', pct: 65 }] }, T0)).toBe(1)
  expect(fatigue({ limits: [{ kind: 'five_hour', pct: 30 }, { kind: 'seven_day', pct: 85 }] }, T0)).toBe(2)
  expect(fatigue({ limits: [{ kind: 'five_hour', pct: 95 }] }, T0)).toBe(3)
})

test('character sheets fit their budget: every kind keeps its idle and every reference finds its symbol', async () => {
  const kinds: CharKind[] = ['turuncu', 'yesil', 'mavi']
  const states: CharState[] = ['idle', 'work', 'walk']
  charDefs()
  let drawn = ''
  for (const k of kinds) for (const s of states) drawn += drawCharacter(k, s, 10, 40, 46)
  const defs = charDefs(20_000)
  for (const k of kinds) expect(defs).toContain(`id="ch-${k}-idle"`)
  const ids = new Set([...defs.matchAll(/id="(ch-[^"]+)"/g)].map(m => m[1]))
  const refs = [...(drawn + defs).matchAll(/href="#(ch-[^"]+)"/g)].map(m => m[1] as string)
  expect(refs.filter(r => !ids.has(r))).toEqual([])
  expect(defs.length).toBeLessThanOrEqual(20_000 + kinds.length * 1200)
  const map: Array<[MascotKind, CharKind]> = [['boss', 'turuncu'], ['claude', 'turuncu'], ['gpt', 'yesil'], ['agy', 'mavi']]
  for (const [m, c] of map) expect(charKindOf(m)).toBe(c)
})

test('a Codex run on a profile sits as the Codex mascot whatever its model, an Antigravity run is the Antigravity mascot with its badge and its model on the panel, and other flash models are not Gemini', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-dis' })
  on('session.receive', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  await $.tool.call({ tool: 'Bash', command: 'codex exec -p work -m deepseek-v4.1-flash "Gizli istem metni"', description: 'Kodu incele' })
  await $.tool.call({ tool: 'Bash', command: 'agy --model claude-sonnet-4-5 --print "Gizli istem metni"', description: 'İkinci görüş' })
  await clock.advance(3500)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('id="ch-yesil-')
  expect(source).toContain('ch-mavi-')
  expect(source).toContain('pk-agy')
  expect(source).not.toContain('Gizli istem')
  await ui.unmount()
  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /^■ Dış Uzman\s/ }))?.text).toMatch(/deepseek-v4\.1-flash/)
  expect((await term.find({ type: 'Text', text: /^■ Dış Uzman 2/ }))?.text).toMatch(/Sonnet 4\.5 · Antigravity/)
  await term.unmount()
  // another session's message comes in from outside the office, its path cut to a file name
  await $.session.receive({ origin: { kind: 'peer' }, text: 'Rapor hazır mı? C:/gizli/yol.md' })
  await clock.advance(1200)
  const inbox = await $.ui.mount(TERM)
  expect((await inbox.find({ type: 'Text', text: /Dışarıdan → Patron/ }))?.text).toMatch(/^✉ Dışarıdan → Patron · Rapor hazır mı\? yol\.md/)
  await inbox.unmount()
  expect(mascotOf('qwen3.8-flash-next')).not.toBe('agy')
  expect(modelLabel('deepseek-v4.1-flash')).not.toMatch(/Gemini/)
})

test('when people leave, the grid is rebuilt for those who stay once the hold is over: no row of ready desks between them and the coffee', async () => {
  const nine = crew(9)
  const W = 1700
  const H = 1000
  const L1 = layoutOffice({ workers: nine, W, H, now: T0 })
  const h1 = hintOf(L1, T0)
  const six = nine.filter(w => !['a1', 'a4', 'a6'].includes(w.id))
  const cells = (L: ReturnType<typeof layoutOffice>) => L.cols * L.rows
  // within the hold the grid stays (no relayout while the leavers are still walking out)
  const held = layoutOffice({ workers: six, W, H, hint: h1, now: T0 + 5000 })
  expect(held.key).toBe(L1.key)
  // after it the grid fits the six: the same scale and desks, fewer cells, the desks the snake's first six
  const later = layoutOffice({ workers: six, W, H, hint: h1, now: T0 + 25_000 })
  expect(later.s).toBe(L1.s)
  expect(later.variant).toBe(L1.variant)
  expect(cells(later)).toBeLessThan(cells(L1))
  expect(later.cells.filter(c => c.kind === 'desk').map(c => c.i)).toEqual([0, 1, 2, 3, 4, 5])
  expect(later.cells.filter(c => c.kind === 'free').length).toBeLessThanOrEqual(Math.max(1, Math.ceil(6 / 4)))
  // and a roomy grid draws its desks (and people) larger, the boss still the largest figure
  expect(later.deskScale).toBeGreaterThanOrEqual(1)
  expect(Math.abs(later.charSize - DESK_GEOM[later.variant].charSize * later.deskScale)).toBeLessThan(0.01)
  expect(later.bossSize).toBeGreaterThan(later.charSize)
})

// —— 0.8: whole model names with their effort, titles instead of numbers, workflow agents and their outside workers ——

test('every model the three CLIs offer reads with its version and its effort; the mascot is the platform’s', async () => {
  const cases: Array<[string, string, MascotKind, string | undefined]> = [
    // Claude Code
    ['claude-opus-5-5', 'Opus 5.5', 'claude', undefined],
    ['claude-sonnet-5-5', 'Sonnet 5.5', 'claude', undefined],
    ['claude-haiku-5-5', 'Haiku 5.5', 'claude', undefined],
    ['claude-fable-5-1', 'Fable 5.1', 'claude', undefined],
    ['claude-opus-5-5[1m]', 'Opus 5.5', 'claude', undefined],
    // Codex: the version is kept, Astra is not Sol
    ['gpt-6.1-sol', 'GPT-6.1 Sol', 'gpt', undefined],
    ['gpt-6-sol', 'GPT-6 Sol', 'gpt', undefined],
    ['gpt-6.1-terra', 'GPT-6.1 Terra', 'gpt', undefined],
    ['gpt-6-luna', 'GPT-6 Luna', 'gpt', undefined],
    ['gpt-6-astra', 'GPT-6 Astra', 'gpt', undefined],
    // agy: the effort is the id's suffix, and leaves the name
    ['gemini-4-argon-medium', 'Gemini 4 Argon', 'agy', 'medium'],
    ['gemini-3.8-flash-high', 'Gemini 3.8 Flash', 'agy', 'high'],
    ['claude-opus-5-5-medium', 'Opus 5.5', 'claude', 'medium'],
    ['claude-sonnet-5-5-low', 'Sonnet 5.5', 'claude', 'low'],
    ['gpt-oss-120b', 'GPT-OSS 120B', 'gpt', undefined],
    // an open model run through a CLI: shown as it is, the effort after a colon leaves the name
    ['glm-5.3', 'glm-5.3', 'claude', undefined],
    ['deepseek-v4.1-flash', 'deepseek-v4.1-flash', 'claude', undefined],
    ['glm-5.3:high', 'glm-5.3', 'claude', 'high'],
  ]
  for (const [id, label, mascot, effort] of cases) {
    expect(modelLabel(id)).toBe(label)
    expect(mascotOf(id)).toBe(mascot)
    expect(splitEffort(id).effort).toBe(effort)
  }
  expect(modelLabel('gpt-6.1-sol')).not.toBe(modelLabel('gpt-6-sol'))
  expect(mascotFor({ id: 'ext:x', model: 'glm-5.3', via: 'gpt' })).toBe('gpt')
  // a model not known yet: never a bare dash, and the look of the family it is guessed to be
  expect(modelLabel(undefined)).toBe('model okunuyor')
  expect(mascotFor({ id: 'wf-1', guess: 'gpt-6-sol' })).toBe('claude')
  // every effort a CLI can give, in words and dots
  const efforts: Array<[unknown, string | undefined, string | undefined, number]> = [
    ['low', 'low', 'düşük', 1],
    ['medium', 'medium', 'orta', 2],
    ['high', 'high', 'yüksek', 3],
    ['xhigh', 'xhigh', 'çok yüksek', 4],
    ['max', 'max', 'en yüksek', 5],
    ['ultra', 'ultra', 'en yüksek', 5],
    ['"ultra"', 'ultra', 'en yüksek', 5],
    ['kapali', 'off', 'kapalı', 0],
    ['HIGH', 'high', 'yüksek', 3],
    [40, '40', 'orta', 2],
    ['12000', '12000', 'yüksek', 3],
    ['persistent', 'persistent', 'en yüksek', 5],
    ['banana', undefined, undefined, 0],
  ]
  for (const [raw, key, word, dots] of efforts) {
    expect(normEffort(raw)).toBe(key)
    expect(effortWord(normEffort(raw))).toBe(word)
    expect(effortLevel(normEffort(raw))).toBe(dots)
  }
  expect(modelLine('claude-sonnet-5-5', 'high')).toBe('Sonnet 5.5 · yüksek')
  expect(modelLine('gemini-3.8-flash-high', undefined)).toBe('Gemini 3.8 Flash · yüksek')
  expect(modelLine(undefined, undefined)).toBe('model okunuyor')
})

test('outside CLIs are read in every form they are run in: quoted efforts, agy suffixes, colon efforts, profiles, wrappers', async () => {
  expect(readExternal('codex exec -m gpt-6.1-sol -c model_reasoning_effort="ultra" "x"')).toEqual({ cli: 'codex', model: 'gpt-6.1-sol', effort: 'ultra' })
  expect(readExternal(`codex exec -c 'model_reasoning_effort="high"' -m gpt-6-astra x`)).toEqual({ cli: 'codex', model: 'gpt-6-astra', effort: 'high' })
  expect(readExternal('codex exec -c model="gpt-6-luna" x')).toEqual({ cli: 'codex', model: 'gpt-6-luna' })
  expect(readExternal('codex -p work exec "x"')).toEqual({ cli: 'codex', profile: 'work' })
  expect(readExternal('codex exec -p work -m glm-5.3 -c model_reasoning_effort=high -s workspace-write -C tmp --skip-git-repo-check -o o.txt "brief"')).toEqual({ cli: 'codex', profile: 'work', model: 'glm-5.3', effort: 'high', sandbox: 'write' })
  // not a job: codex's own housekeeping, a python script
  expect(readExternal('codex login')).toBeUndefined()
  expect(readExternal('python -I scripts/yardimci.py kontrol')).toBeUndefined()
  expect(readExternal('timeout 900 agy -p "brief" --model gemini-3.8-flash-high --mode plan --output-format json')).toEqual({ cli: 'agy', model: 'gemini-3.8-flash', effort: 'high', sandbox: 'read' })
  expect(readExternal(String.raw`%LOCALAPPDATA%\agy\bin\agy.exe -p "x" --model claude-opus-5-5-medium`)).toEqual({ cli: 'agy', model: 'claude-opus-5-5', effort: 'medium' })
  expect(readExternal('bash -c "agy -p x --model gemini-4-argon-low"')).toEqual({ cli: 'agy', model: 'gemini-4-argon', effort: 'low' })
  // an effort after a colon, a Turkish effort word
  expect(readExternal('codex exec --model glm-5.3:high "x"')).toEqual({ cli: 'codex', model: 'glm-5.3', effort: 'high' })
  expect(readExternal('codex exec --model deepseek-v4.1-flash --efor kapali "x"')).toEqual({ cli: 'codex', model: 'deepseek-v4.1-flash', effort: 'off' })
  expect(readExternal('cat codex_notlari.md')).toBeUndefined()
  expect(readCodexConfig('# yorum\nmodel = "gpt-6.1-terra"\nmodel_reasoning_effort = "medium"\n[profiles.x]\nmodel = "gpt-6-sol"\n')).toEqual({ model: 'gpt-6.1-terra', effort: 'medium' })
  expect(readCodexConfig('model = "glm-5.3"\nmodel_provider = "ozel"\nmodel_reasoning_effort = "high"\n')).toEqual({ model: 'glm-5.3', effort: 'high' })
})

test('a desk is titled by what its worker is given and does, held steady, numbered when it repeats', async () => {
  const at = (task: string, extra: Partial<Worker> = {}) => titleFor({ kind: 'agent', task, activity: 'thinking', ...extra })
  expect(at('Logları tara')).toBe('Kâşif')
  expect(at('Kodu incele')).toBe('Denetçi')
  expect(at('Neden çöküyor, hatayı bul')).toBe('Dedektif')
  expect(at('Testleri çalıştır')).toBe('Test Mühendisi')
  expect(at('Sahne için logo tasarımı')).toBe('Tasarımcı')
  expect(at('Mimari taslağı çıkar')).toBe('Mimar')
  expect(at('Yol haritası planı')).toBe('Planlamacı')
  expect(at('README belgesini güncelle')).toBe('Arşivci')
  expect(at('Kota maliyetini hesapla')).toBe('Muhasebeci')
  expect(at('Görev')).toBe('Asistan')
  expect(titleFor({ kind: 'agent', task: 'Görev', activity: 'thinking', type: 'Explore' })).toBe('Kâşif')
  expect(titleFor({ kind: 'external', task: 'Kodu incele', activity: 'running' })).toBe('Dış Uzman')
  expect(titleFor({ kind: 'agent', task: 'Kodu incele', activity: 'thinking' }, true)).toBe('Yedek Patron')
  // what it does: writing makes a Yazılımcı (a reviewer that starts to write too); a test run a Test Mühendisi
  expect(at('Kodu incele', { activity: 'writing', screen: { kind: 'file-write', label: 'app.ts', at: 0 } })).toBe('Yazılımcı')
  expect(at('Görev', { activity: 'running', screen: { kind: 'cmd', label: 'npm test', at: 0 } })).toBe('Test Mühendisi')
  expect(at('Görev', { activity: 'web' })).toBe('Gezgin')
  expect(at('Görev', { activity: 'messaging' })).toBe('Haberci')
  expect(at('Kodu toparla', { activity: 'writing', screen: { kind: 'file-write', label: 'app.ts', at: 0 } })).toBe('Temizlikçi')
  // steady: a new title only when it comes twice in a row
  expect(settleTitle('Kâşif', undefined, 'Yazılımcı')).toEqual({ title: 'Kâşif', next: 'Yazılımcı' })
  expect(settleTitle('Kâşif', 'Yazılımcı', 'Yazılımcı')).toEqual({ title: 'Yazılımcı' })
  expect(settleTitle('Kâşif', 'Yazılımcı', 'Kâşif')).toEqual({ title: 'Kâşif' })
  expect(settleTitle(undefined, undefined, 'Kâşif')).toEqual({ title: 'Kâşif' })
  // numbered: the smallest number free, never its own
  const office = [{ id: 'a', name: 'Yazılımcı' }, { id: 'b', name: 'Yazılımcı 2' }, { id: 'c', name: 'Kâşif' }]
  expect(numberedName('Yazılımcı', office)).toBe('Yazılımcı 3')
  expect(numberedName('Yazılımcı', office, 'b')).toBe('Yazılımcı 2')
  expect(numberedName('Dedektif', office)).toBe('Dedektif')
})

test('a workflow’s agents sit as what they run on, their own CLIs take desks under them, and the count is every desk', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1' })
  on('fs.read', () => ({ value: '' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // the boss starts a workflow whose agents run Sonnet 5.5 at high effort; no agent.spawn is seen for them
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'x', description: 'y', phases: [] }\nawait agent('a', { model: 'claude-sonnet-5-5', effort: 'high' })\nawait agent('b', { model: 'claude-sonnet-5-5', effort: 'high' })" })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/a.ts', agentId: 'wf-1' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/b.ts', agentId: 'wf-2' })
  // inside the workflow agents: an agy and two codex runs from the shell
  await $.tool.call({ tool: 'Bash', command: 'timeout 900 agy -p "brief" --model gemini-3.8-flash-high --mode plan', description: 'Gemini görüşü', agentId: 'wf-1' })
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only "x"', description: 'Sol incelemesi', agentId: 'wf-2' })
  await $.tool.call({ tool: 'Bash', command: 'codex exec --model glm-5.3:high "y"', description: 'İkinci görüş', agentId: 'wf-2' })
  await clock.advance(1200)

  const term = await $.ui.mount(TERM)
  const rows = (await term.findAll({ type: 'Text', text: /^■ / })).map(r => r.text ?? '')
  // two workflow agents, one agy, two codex desks: five at work
  expect(rows).toHaveLength(5)
  expect(rows.filter(r => /Sonnet 5\.5 · yüksek/.test(r))).toHaveLength(2)
  expect(rows.some(r => /Gemini 3\.8 Flash · yüksek · Antigravity/.test(r))).toBe(true)
  expect(rows.some(r => /GPT-6\.1 Sol · yüksek/.test(r))).toBe(true)
  expect(rows.some(r => /glm-5\.3 · yüksek/.test(r))).toBe(true)
  for (const r of rows) expect(r).not.toMatch(/Ajan \d|#\d|model okunuyor|^■ \S+(?: \S+)?\s+—/)
  // each outside run reports to the workflow agent that started it
  expect((await term.find({ type: 'Text', text: /Yedek Patron 2 → Dış Uzman 3 · İkinci görüş/ }))?.text).toMatch(/^✈/)
  await term.unmount()

  const desk = await $.ui.mount(DESK)
  const source = String((await desk.find({ type: 'Svg' }))?.props.source)
  // three platform figures: the workflow agents orange, agy the blue one, codex the green one
  expect(source).toMatch(/ch-turuncu-/)
  expect(source).toContain('ch-mavi-')
  expect(source).toContain('ch-yesil-')
  expect(source).toContain('5/5')
  await desk.unmount()
})

test('a model learned after the seat replaces the placeholder: the Agent call’s record names it', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { agentId: 'late-1', resolvedModel: 'claude-haiku-5-5' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // seated by its first tool call (before the office knew it): no model yet, never a dash
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/a.ts', agentId: 'late-2' })
  await clock.advance(1200)
  let term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /^■ Kâşif/ }))?.text).toMatch(/model okunuyor/)
  await term.unmount()
  // the Agent call's record names its agent's model
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/b.ts', agentId: 'late-1' })
  await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x' })
  await clock.advance(1200)
  term = await $.ui.mount(TERM)
  expect((await term.findAll({ type: 'Text', text: /Haiku 5\.5/ })).length).toBeGreaterThanOrEqual(1)
  await term.unmount()
})

test('a worker that left is not walked in again by a list that still says it runs', async ($, on) => {
  const clock = mock.clock(on)
  let listed: Array<{ id: string; description: string; type: string; status: string }> = []
  engine(on, {}, false, () => listed)
  on('classic.SubagentStop', () => ({}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Logları tara', description: 'Logları tara', subagentType: 'Explore' } as never)
  listed = [{ id: 'a1', description: 'Logları tara', type: 'Explore', status: 'running' }]
  await clock.advance(1200)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '', agent_type: 'Explore', last_assistant_message: 'Bitti.' })
  // the list lags: still running long after the end; the worker stays done, leaves once and is not hired again
  for (let s = 0; s < 70; s++) await clock.advance(1000)
  const term = await $.ui.mount(TERM)
  expect(await term.findAll({ type: 'Text', text: /^■ Kâşif/ })).toHaveLength(0)
  await term.unmount()
})

test('a walk in from the door is one walk on the wall clock: the same in every frame, shortened when the work starts first', async () => {
  const pts: Array<[number, number]> = [[0, 0], [100, 0], [100, 50]]
  const plan = { pts, t0: 1000, dur: 3000, turned: false }
  // no event: as planned
  expect(hurried(plan, undefined)).toBe(plan)
  // (1) the work starts mid-walk: from that point, the rest briskly; the same answer every time it is asked
  const h = hurried(plan, 2000)
  expect(h.t0).toBe(2000)
  // the 2 s left, 1.4 times as fast: never a jump
  expect(Math.round(h.dur)).toBe(Math.round(2000 / 1.4))
  expect(Math.abs((h.pts[0]?.[0] ?? 0) - 50)).toBeLessThan(1)
  expect(h.pts[h.pts.length - 1]).toEqual([100, 50])
  expect(hurried(plan, 2000)).toEqual(h)
  // never further back than the walk as planned at the same moment
  expect(h.t0 + h.dur).toBeLessThan(plan.t0 + plan.dur)
  // (2) the work starts before the walk does: the whole route, briskly
  const early = hurried(plan, 500)
  expect(early.t0).toBe(1000)
  expect(Math.round(early.dur)).toBe(Math.round(3000 / 1.4))
  expect(early.pts[0]).toEqual([0, 0])
  // (3) the work starts as it arrives: nothing to shorten
  expect(hurried(plan, 3800)).toBe(plan)
  expect(restOf(pts, 1)).toEqual([[100, 50]])
})

/** The team list's rows (terminal view). */
async function teamRows($: Parameters<TestBody>[0]): Promise<string[]> {
  const term = await $.ui.mount(TERM)
  const rows = (await term.findAll({ type: 'Text', text: /^■ / })).map(r => r.text ?? '')
  await term.unmount()

  return rows
}

test('an agent seated by its first tool call takes the spawn that lands after it, a later step updates it, and its own CLIs sit under it', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1' })
  on('fs.read', () => ({ value: '' }))
  // the model's request beneath: a step with no answer
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: null, usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // the live screen's case: the agent's tool call comes before its agent.spawn
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/a.ts', agentId: 'a1' })
  await clock.advance(1200)
  let rows = await teamRows($)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatch(/model okunuyor/)
  // the spawn lands: its model, task and title are taken, not dropped
  await $.agent.spawn({ prompt: 'Hatanın nedenini bul', description: 'Hatanın nedenini bul', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  rows = await teamRows($)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatch(/^■ Dedektif\s+Opus 5\.5/)
  // its own step names what it runs on now, with the effort
  const step = ($ as unknown as { turn: { step: (e: Record<string, unknown>) => AsyncIterable<unknown> | Promise<unknown> } }).turn.step({ turnId: 't1', index: 0, agentId: 'a1', model: 'claude-sonnet-5-5', effort: 'high', messages: [] })
  if (step && Symbol.asyncIterator in (step as object)) for await (const _ of step as AsyncIterable<unknown>) void _
  else await step
  await clock.advance(1200)
  rows = await teamRows($)
  expect(rows[0]).toMatch(/Sonnet 5\.5 · yüksek/)
  // inside it: a PowerShell-continued codex and a bash-continued agy take desks; a commit message naming codex starts nothing
  await $.tool.call({ tool: 'PowerShell', command: "codex exec `\n  -m gpt-6-astra `\n  -c model_reasoning_effort=medium 'x'", description: 'Astra görüşü', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'agy -p "x" \\\n  --model gemini-3.8-flash-high', description: 'Flash görüşü', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix; codex exec -m gpt-6-sol"', description: 'commit', agentId: 'a1' })
  await clock.advance(1200)
  rows = await teamRows($)
  expect(rows).toHaveLength(3)
  expect(rows.some(r => /^■ Dış Uzman.*GPT-6 Astra · orta/.test(r))).toBe(true)
  expect(rows.some(r => /^■ Dış Uzman.*Gemini 3\.8 Flash · yüksek/.test(r))).toBe(true)
  expect(rows.some(r => /GPT-6 Sol/.test(r))).toBe(false)
  // the scoreboard counts every desk at work
  const desk = await $.ui.mount(DESK)
  const source = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('3/3')
  expect(source).not.toContain('ch-diger-')
  await desk.unmount()
})

test('model names, aliases and efforts read whole: separators, quotes, continued lines and name parts are not mistaken', () => {
  // the Claude CLI's short names stand for its current models; a date is not a version
  expect(modelLabel('sonnet')).toBe('Sonnet 5.5')
  expect(modelLabel('opusplan')).toBe('Opus 5.5')
  expect(modelLabel('fable')).toBe('Fable 5.1')
  expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  // shown names (agy's list) keep their effort
  expect(modelLine('Gemini 3.8 Flash (High)', undefined)).toBe('Gemini 3.8 Flash · yüksek')
  expect(modelLine('Claude Opus 5.5 (Medium)', undefined)).toBe('Opus 5.5 · orta')
  // '-max' is a part of a name; a ':max' after the name is an effort
  expect(splitEffort('qwen3-max')).toEqual({ model: 'qwen3-max' })
  expect(modelLabel('qwen3-max')).toBe('qwen3-max')
  expect(modelLabel('gpt-6.1-codex-max')).toBe('GPT-6.1 Codex Max')
  expect(splitEffort('glm-5.3:max')).toEqual({ model: 'glm-5.3', effort: 'max' })
  expect(readExternal('codex exec -m qwen3-max "x"')).toEqual({ cli: 'codex', model: 'qwen3-max' })
  // Turkish words of the scale
  expect(normEffort('çok yüksek')).toBe('xhigh')
  expect(normEffort('en yuksek')).toBe('max')
  expect(effortWord('xhigh')).toBe('çok yüksek')
  // a separator stuck to the model; a quoted path with spaces; npx and wsl
  expect(readExternal('codex exec -m gpt-6-sol&& echo ok')).toEqual({ cli: 'codex', model: 'gpt-6-sol' })
  expect(readExternal('codex exec -m gpt-6.1-sol|tee out.txt')).toEqual({ cli: 'codex', model: 'gpt-6.1-sol' })
  expect(readExternal('"C:\\Program Files\\agy\\agy.exe" -p hi --model gemini-4-argon-high')).toEqual({ cli: 'agy', model: 'gemini-4-argon', effort: 'high' })
  expect(readExternal('npx @openai/codex exec -m gpt-6.1-sol')).toEqual({ cli: 'codex', model: 'gpt-6.1-sol' })
  expect(readExternal('wsl codex exec -m gpt-6.1-terra')).toEqual({ cli: 'codex', model: 'gpt-6.1-terra' })
  // continued lines (bash \, PowerShell `) are one command
  expect(readExternal('codex exec \\\n  -m gpt-6-luna \\\n  -c model_reasoning_effort=low "x"')).toEqual({ cli: 'codex', model: 'gpt-6-luna', effort: 'low' })
  expect(readExternal("codex exec `\n  -m gpt-6-astra `\n  -c model_reasoning_effort=medium 'x'")).toEqual({ cli: 'codex', model: 'gpt-6-astra', effort: 'medium' })
  // a CLI named in quoted text starts nothing; one a wrapper runs does
  expect(readExternal('git commit -m "fix; codex exec -m gpt-6-sol"')).toBeUndefined()
  expect(readExternal('echo "agy --model gemini-4-argon-high"')).toBeUndefined()
  expect(readExternal('bash -lc "codex exec -m gpt-6.1-sol"')).toEqual({ cli: 'codex', model: 'gpt-6.1-sol' })
  expect(readExternal(`powershell -Command "agy -p 'x' --model gemini-3.8-flash-high"`)).toEqual({ cli: 'agy', model: 'gemini-3.8-flash', effort: 'high' })
})

test('ten desks on ten models keep their plates at 1700×1000, 2400×1400 and 700×1200: the whole model on every desk (a long one on two lines), nothing cut', () => {
  const models: Array<[string, string | undefined, Worker['via']?]> = [
    ['claude-opus-5-5', 'medium'], ['claude-sonnet-5-5', 'high'], ['gpt-6.1-sol', 'xhigh'], ['gpt-6-sol', 'high'], ['gpt-6.1-terra', 'high'],
    ['gpt-6-luna', 'low'], ['gpt-6-astra', 'medium'], ['gemini-4-argon-high', undefined, 'agy'], ['gemini-3.8-flash-high', undefined, 'agy'], ['claude-fable-5-1', 'max'],
  ]
  const workers = crew(10).map((w, i) => {
    const m = models[i - 1]
    if (i === 0 || !m) return w

    return { ...w, model: m[0], effort: m[1], via: m[2], kind: m[2] ? ('external' as const) : ('agent' as const), activity: 'writing' as Activity, screen: { kind: 'file-write' as const, label: 'scene.ts', at: T0 } }
  })
  for (const [W, H] of [[1700, 1000], [2400, 1400], [700, 1200]] as Array<[number, number]>) {
    const L = layoutOffice({ workers, W, H, now: T0 })
    expect(`${W}x${H} ${L.variant}`).not.toBe(`${W}x${H} mini`)
    const usage = { ctxPct: 20, ctxTokens: 200_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 40 }], at: T0, history: [10, 20] }
    const svg = hudSvg({ workers, usage, turn: { active: true, steps: 1, turns: 1, prompt: 'x', model: 'claude-sonnet-5-5', effort: 'high' }, now: T0, motion: true, width: W, fill: H, feed: [], stats: { tools: {}, hired: 0, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: T0, done: 0, failed: 0, reports: 0, messages: 0, inbound: 0 } }).svg
    const text = svg.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<[^>]+>/g, '')
    for (const line of ['Opus 5.5', 'Sonnet 5.5', 'GPT-6.1 Sol', 'GPT-6 Sol', 'GPT-6.1 Terra', 'GPT-6 Luna', 'GPT-6 Astra', 'Gemini 4 Argon', 'Gemini 3.8 Flash', 'Fable 5.1']) {
      // whole on one line, or broken at its last word onto the next line ('Gemini 3.8' / 'Flash · yüksek'): never cut
      const at = line.lastIndexOf(' ')
      const whole = text.includes(line) || text.includes(`${line.slice(0, at)}${line.slice(at + 1)} · `)
      expect(`${W}x${H} ${line} ${whole}`).toBe(`${W}x${H} ${line} true`)
    }
    expect(text).not.toMatch(/(?:Opus|Sonnet|GPT|Gemini|Fable)[^<·]{0,12}…/)
  }
})

test('a drawing’s desks read as one set: one plate size, one title size, the state on every plate or on none, and the scoreboard keeps AJAN', () => {
  const models: Array<[string, string | undefined, Worker['via']?]> = [
    ['claude-opus-5-5', 'medium'], ['claude-sonnet-5-5', 'high'], ['gpt-6.1-sol', 'xhigh'], ['gpt-6-sol', 'high'], ['gpt-6.1-terra', 'high'],
    ['gpt-6-luna', 'low'], ['gpt-6-astra', 'medium'], ['gemini-4-argon-high', undefined, 'agy'], ['gemini-3.8-flash-high', undefined, 'agy'], ['claude-fable-5-1', 'max'],
  ]
  const titles = ['Yazılımcı', 'Dedektif', 'Dış Uzman', 'Dış Uzman 2', 'Dış Uzman 3', 'Dış Uzman 4', 'Dış Uzman 5', 'Dış Uzman 6', 'Dış Uzman 7', 'Test Mühendisi']
  const workers = crew(10).map((w, i) => {
    const m = models[i - 1]
    if (i === 0 || !m) return w
    return { ...w, name: titles[i - 1] as string, model: m[0], effort: m[1], via: m[2], kind: m[2] ? ('external' as const) : ('agent' as const), activity: 'writing' as Activity, screen: { kind: 'file-write' as const, label: 'scene.ts', at: T0 } }
  })
  const usage = { ctxPct: 20, ctxTokens: 200_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 40 }], at: T0, history: [10, 20] }
  for (const [W, H] of [[1700, 1000], [2400, 1400], [700, 1200]] as Array<[number, number]>) {
    const svg = hudSvg({ workers, usage, turn: { active: true, steps: 1, turns: 6, prompt: 'x', model: 'claude-haiku-5-5', effort: 'low' }, now: T0, motion: true, width: W, fill: H, daily: { day: '2026-11-08', usd: 38.1, sessions: 4, at: T0 }, stats: { tools: { Read: 60 }, hired: 10, outTokens: 1, inTokens: 1, cacheRead: 0, sessionStart: T0 - 3_600_000, done: 0, failed: 0, reports: 0, messages: 0, inbound: 0 }, feed: [] } as Parameters<typeof hudSvg>[0]).svg
    const texts = [...svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)].map(m => ({ fs: m[1] as string, t: (m[2] as string).replace(/<[^>]+>/g, '') }))
    const plates = texts.filter(x => /^(Opus|Sonnet|GPT|Gemini|Fable)/.test(x.t) && !/·.*·/.test(x.t))
    expect(`${W}x${H} plates ${plates.length >= 10}`).toBe(`${W}x${H} plates true`)
    expect(`${W}x${H} plate sizes ${new Set(plates.map(p => p.fs)).size}`).toBe(`${W}x${H} plate sizes 1`)
    const named = texts.filter(x => titles.includes(x.t))
    expect(`${W}x${H} title sizes ${new Set(named.map(p => p.fs)).size <= 1}`).toBe(`${W}x${H} title sizes true`)
    const told = (svg.replace(/<title>[\s\S]*?<\/title>/g, '').match(/Yazıyor|Komut çalıştırıyor/g) ?? []).length
    expect(`${W}x${H} state ${told === 0 || told >= 10}`).toBe(`${W}x${H} state true`)
    const board = svg.replace(/<[^>]+>/g, '')
    expect(`${W}x${H} ${board.includes('AJAN')} ${board.includes('10/10')}`).toBe(`${W}x${H} true true`)
  }
})

test('a short file name loses its extension before it is cut, and a figure can still carry a mark on its sheet', () => {
  expect(ellipsize('scene.ts', textWidth('scene', 8) + 0.5, 8)).toBe('scene')
  expect(ellipsize('scene.ts', textWidth('scene.ts', 8) + 0.5, 8)).toBe('scene.ts')
  const plain = drawCharacter(charKindOf('claude'), 'work', 50, 80, 30)
  const marked = drawCharacter(charKindOf('claude'), 'work', 50, 80, 30, { mark: 'book' })
  expect(marked.length).toBeGreaterThan(plain.length)
  expect(marked).toContain('#F5EBDD')
  expect(drawCharacter(charKindOf('gpt'), 'work', 50, 80, 30, { mark: 'star' })).toContain('#FDE68A')
})

// —— 0.9: etkinlik animasyonları (activities.ts): araç → etkinlik, çakışma kuralları, titreme yok, bütçe ——

const N9 = 1_900_000_000_000
type Want = { main?: string; ev?: string }
const callOf = (tool: string, extra: Partial<ToolFacts> = {}, trail: ActMark[] = [], seed = 'tu-1'): ActPick => pickActivity({ tool, phase: 'call', ...extra }, trail, seed, N9)
const resultOf = (tool: string, extra: Partial<ToolFacts> = {}): ActPick => pickActivity({ tool, phase: 'result', ...extra }, [], 'tu-1', N9)
const got = (p: ActPick): Want => ({ ...(p.main ? { main: p.main } : {}), ...(p.ev ? { ev: p.ev } : {}) })
const FAIL: ActMark[] = [{ t: N9 - 1000, f: 1 }]
const AUDIT: ActMark[] = [{ t: N9 - 1000, id: 'checklist-audit', s: 'audit' }]
const worker9 = (extra: Partial<Worker> = {}): Worker => ({ id: 'a1', n: 0, name: 'Yazılımcı', role: 'Genel', task: '', color: '#5B8FC7', seat: 0, activity: 'writing', bubble: '', detail: '', tools: 3, tokensOut: 0, since: N9 - 2000, joinedAt: N9 - 60_000, ...extra })
const ctx9 = (extra: Partial<ActCtx> = {}): ActCtx => ({ now: N9, isBoss: false, fat: 0, limitFull: false, teamBusy: 0, criticBusy: false, kind: 'turuncu', external: false, ...extra })

test('0.9: every row of the tool table picks its activity (call and result)', () => {
  const rows: Array<[string, Partial<ToolFacts>, ActMark[], Want]> = [
    ['Read', { file: 'C:/p/logo.PNG' }, [], { main: 'magnify-eye' }],
    ['Read', { file: 'C:/p/app.ts' }, [], { main: 'code-read' }],
    ['Read', { file: 'C:/p/server.log' }, [], { main: 'detective-hunt' }],
    ['Read', { file: 'C:/p/app.ts' }, FAIL, { main: 'detective-hunt' }],
    ['Read', { file: 'C:/p/app.ts' }, AUDIT, {}],
    ['Write', { file: 'C:/Users/x/.claude/MEMORY.md' }, [], { main: 'memory-brain' }],
    ['Edit', { file: 'C:/Users/x/notes/memory/Kararlar.md' }, [], { main: 'memory-brain' }],
    ['Write', { file: 'C:/p/notlar.md' }, [], { main: 'quill-write' }],
    ['Write', { file: 'C:/p/x.ts' }, [], { main: 'type-fast' }],
    ['Edit', { file: 'C:/p/x.ts' }, FAIL, { main: 'bug-fix' }],
    ['Edit', { file: 'C:/p/x.ts' }, [{ t: N9, s: 'refactor' }], { main: 'broom-cleanup' }],
    ['MultiEdit', { file: 'C:/p/notes.md' }, [], { main: 'type-fast' }],
    ['Bash', { cmd: 'cd app && npm test' }, [], { main: 'test-tube' }],
    ['Bash', { cmd: 'claude.exe plugin test C:/mod' }, [], { main: 'test-tube' }],
    ['Bash', { cmd: 'git push origin main' }, [], { ev: 'deploy-rocket' }],
    ['Bash', { cmd: 'npx wrangler deploy' }, [], { ev: 'deploy-rocket' }],
    ['Bash', { cmd: 'git push origin feat/etkinlik' }, [], { main: 'git-branch' }],
    ['Bash', { cmd: 'git commit -m "x"' }, [], { main: 'git-branch' }],
    ['Bash', { cmd: 'npm run dev', bg: true }, [], { main: 'security-cam' }],
    ['PowerShell', { cmd: 'Get-Content app.log -Wait' }, [], { main: 'security-cam' }],
    ['Bash', { cmd: 'npm install' }, [], { main: 'compile-wait' }],
    ['Bash', { cmd: 'npx -y -p typescript@5.9.3 tsc -p tsconfig.json --noEmit' }, [], { main: 'compile-wait' }],
    ['Bash', { cmd: 'zip -r yedek.zip src' }, [], { ev: 'archive-boxes' }],
    ['Bash', { cmd: 'rm -rf build' }, [], { main: 'broom-cleanup' }],
    ['Bash', { cmd: 'sqlite3 veri.db ".tables"' }, [], { main: 'database-barrel' }],
    ['Bash', { cmd: 'cat a.json | jq .x' }, [], { main: 'funnel-filter' }],
    ['Bash', { cmd: 'python -c "print(2**10)"' }, [], { main: 'abacus-calc' }],
    ['Bash', { cmd: 'diff a.txt b.txt' }, [], { main: 'scale-compare' }],
    ['Bash', { cmd: 'ls -la src' }, [], { main: 'map-explore' }],
    ['Bash', { cmd: 'rg "useState" src' }, [], { main: 'library-shelf' }],
    ['Bash', { cmd: 'curl -s https://example.com' }, [], { main: 'radar-scan' }],
    ['Bash', { cmd: 'gh pr checks 12' }, [], { main: 'binoculars' }],
    ['Bash', { cmd: 'node scripts/x.js', text: 'Betiği çalıştır' }, [], {}],
    ['Bash', { cmd: 'codex exec -m gpt-6.1-terra "incele"', external: true }, [], { main: 'radio-call' }],
    ['Grep', { text: 'TypeError|exception' }, [], { main: 'detective-hunt' }],
    ['Grep', { text: 'useState' }, [], { main: 'library-shelf' }],
    ['Glob', {}, [], { main: 'library-shelf' }],
    ['WebSearch', {}, [], { main: 'globe-spin' }],
    ['WebFetch', {}, [], { main: 'radar-scan' }],
    ['TodoWrite', {}, [], { main: 'plan-blueprint' }],
    ['mcp__ccd_turn__update_plan', {}, [], { main: 'plan-blueprint' }],
    ['Agent', { agentType: 'Explore' }, [], { main: 'radio-call' }],
    ['SendMessage', { text: 'Devir teslim: işi sana bırakıyorum' }, [], { ev: 'handoff-baton' }],
    ['ListAgents', {}, [], { main: 'periscope' }],
    ['TaskOutput', {}, [], { main: 'periscope' }],
    ['Monitor', {}, [], { main: 'security-cam' }],
    ['CronCreate', {}, [], { main: 'watch-lighthouse' }],
    ['PushNotification', {}, [], { main: 'megaphone-announce' }],
    ['mcp__ccd_turn__wrap_up', {}, [], { ev: 'confetti-party' }],
    ['mcp__ccd_turn__wrap_up', {}, FAIL, { main: 'megaphone-announce' }],
    ['mcp__ccd_turn__wrap_up', { teamFailed: true }, [], { main: 'megaphone-announce' }],
    ['AskUserQuestion', {}, [], { main: 'coffee-break' }],
    ['ReportFindings', { findings: 0 }, [], { main: 'checklist-audit' }],
    ['ReportFindings', { findings: 3 }, [], { main: 'checklist-audit_fail' }],
    ['Skill', { skill: 'security-review' }, [], { main: 'shield-guard' }],
    ['Skill', { skill: 'code-review' }, [], { main: 'checklist-audit' }],
    ['Skill', { skill: 'engineering:debug' }, [], { main: 'detective-hunt' }],
    ['Skill', { skill: 'simplify' }, [], { main: 'broom-cleanup' }],
    ['Skill', { skill: 'orkestra' }, [], { main: 'plan-blueprint' }],
    ['Skill', { skill: 'remotion-render' }, [], { main: 'film-shoot' }],
    ['Skill', { skill: 'ai-image-video-studio' }, [], { main: 'paint-canvas' }],
    ['Skill', { skill: 'social-media-skills:suno' }, [], { main: 'music-compose' }],
    ['Skill', { skill: 'doc-coauthoring' }, [], { main: 'quill-write' }],
    ['Skill', { skill: 'product-management:brainstorm' }, [], { ev: 'idea-bulb' }],
    ['Skill', { skill: 'data:analyze' }, [], { main: 'chart-grow' }],
    ['Skill', { skill: 'anthropic-skills:xlsx' }, [], { main: 'spreadsheet-fill' }],
    ['Skill', { skill: 'searchfit-seo:translate-content' }, [], { main: 'dictionary-translate' }],
    ['Skill', { skill: 'kaydet' }, [], { main: 'memory-brain' }],
    ['Skill', { skill: 'anthropic-skills:deep-research' }, [], { main: 'globe-spin' }],
    ['Skill', { skill: 'purchase-advisor' }, [], { main: 'scale-compare' }],
    ['Skill', { skill: 'loop' }, [], { main: 'watch-lighthouse' }],
    ['Skill', { skill: 'data:validate-data' }, [], { main: 'funnel-filter' }],
    ['mcp__addf8f95__generate_image', {}, [], { main: 'paint-canvas' }],
    ['mcp__93b881b1__image_vectorize', {}, [], { main: 'pixel-sketch' }],
    ['mcp__93b881b1__video_render', {}, [], { main: 'film-shoot' }],
    ['mcp__93b881b1__media_summarize', {}, [], { main: 'headset-listen' }],
    ['mcp__28368e36__execute_sql', {}, [], { main: 'database-barrel' }],
    ['mcp__11768cdc__update_values', {}, [], { main: 'spreadsheet-fill' }],
    ['mcp__11768cdc__update_formulas', {}, [], { main: 'abacus-calc' }],
    ['mcp__c6881e93__create_draft', {}, [], { ev: 'mail-envelope' }],
    ['mcp__graphify__query_graph', {}, [], { main: 'code-read' }],
    ['mcp__graphify__god_nodes', {}, [], { main: 'map-explore' }],
    ['mcp__3f12b239__create_deployment', {}, [], { ev: 'deploy-rocket' }],
    ['mcp__3f12b239__list_deployments', {}, [], { main: 'binoculars' }],
    ['mcp__ccd_host__clean_up_worktrees', {}, [], { main: 'broom-cleanup' }],
    ['mcp__plugin-authoring__scan_secrets', {}, [], { main: 'shield-guard' }],
    ['mcp__plugin_playwright_playwright__browser_take_screenshot', {}, [], { main: 'magnify-eye' }],
    ['mcp__Claude_Browser__navigate', {}, [], { main: 'radar-scan' }],
    ['mcp__plugin_bio-research_consensus__search', {}, [], { main: 'globe-spin' }],
    ['EnterWorktree', {}, [], { main: 'git-branch' }],
    ['Artifact', {}, [], { ev: 'deploy-rocket' }],
  ]
  for (const [tool, extra, trail, want] of rows) expect([tool, extra, got(callOf(tool, extra, trail))]).toEqual([tool, extra, want])
  // sonuç evresi: alt ajan dönüşü, ret, 429, test kırığı, genel hata
  expect(got(resultOf('Agent'))).toEqual({ ev: 'handoff-baton' })
  expect(got(resultOf('Bash', { cmd: 'ls', denied: true, failed: true }))).toEqual({ ev: 'shield-guard' })
  expect(got(resultOf('WebFetch', { failed: true, out: 'HTTP 429 Too Many Requests' }))).toEqual({ ev: 'error-sparks' })
  expect(got(resultOf('Bash', { cmd: 'npm test', failed: true }))).toEqual({ main: 'test-tube_fail' })
  const err = resultOf('Bash', { cmd: 'node x.js', failed: true })
  expect(got(err)).toEqual({ ev: 'error-sparks' })
  expect(err.mark.f).toBe(1)
  expect(got(resultOf('Read', {}))).toEqual({})
  // SendMessage: %85 kâğıt uçak, kalanı bayrak; tohumla sabit, ikisi birden asla
  const planes = Array.from({ length: 200 }, (_, i) => callOf('SendMessage', { text: 'Testler bitti' }, [], `msg-${i}`).ev)
  expect(planes.every(e => e === 'paper-plane' || e === 'handoff-baton')).toBe(true)
  const share = planes.filter(e => e === 'paper-plane').length / planes.length
  expect(share).toBeGreaterThan(0.7)
  expect(share).toBeLessThan(0.97)
  expect(callOf('SendMessage', {}, [], 'msg-7').ev).toBe(callOf('SendMessage', {}, [], 'msg-7').ev)
})

test('0.9: keywords read skills, MCP names, agent types and task text; short tokens only as whole names', () => {
  expect(hireAct('Ana sayfa için logoyu çiz', 'general-purpose', false, 'a1', N9)?.id).toBe('paint-canvas')
  expect(hireAct('Bu metni İngilizceye çevir', undefined, false, 'a1', N9)?.id).toBe('dictionary-translate')
  expect(callOf('Skill', { skill: 'anthropic-skills:ai-image-video-studio' }).main).toBe('paint-canvas')
  // düzyazıdaki "form" rm'i, "detail" ls'i, "task"/"agent" telsizi tetiklemez
  expect(keywordAct(['Bash'], 'fill the form and show the detail of the task for the agent', 's')).toBeUndefined()
  expect(keywordAct(['rm'], undefined, 's')).toBe('broom-cleanup')
  expect(keywordAct(['rmdir'], undefined, 's')).toBeUndefined()
  // olay sınıfı düzyazıdan gelmez ("exception" metinde kıvılcım çıkarmaz)
  expect(keywordAct([], 'handle the exception path', 's')).toBeUndefined()
  // aynı öncelik (70): olasılık ağırlığıyla, tohumla sabit; iki aday da çıkabilir
  const pair = new Set(Array.from({ length: 40 }, (_, i) => keywordAct(['suno generate_image'], undefined, `s${i}`)))
  expect([...pair].sort()).toEqual(['music-compose', 'paint-canvas'])
  expect(keywordAct(['suno generate_image'], undefined, 'x')).toBe(keywordAct(['suno generate_image'], undefined, 'x'))
  // Explore ajanı: %60 harita, %40 raf, tohumla sabit
  const ex = Array.from({ length: 100 }, (_, i) => hireAct('Kodu tara', 'Explore', false, `e${i}`, N9)?.id)
  expect([...new Set(ex)].sort()).toEqual(['library-shelf', 'map-explore'])
  expect(hireAct('Kodu tara', 'Explore', false, 'e3', N9)?.id).toBe(hireAct('Kodu tara', 'Explore', false, 'e3', N9)?.id)
  // varyant ve katmanların kendi tetiği yok
  expect(ACT_TRIGGERS.some(([, id]) => /_fail|_sapka|_misir/.test(id))).toBe(false)
  expect(ACT_TRIGGERS.every(([tok]) => tok.length > 0 && tok.length < 40 && !tok.includes('('))).toBe(true)
})

test('0.9: the 22 conflict rules decide between candidates', () => {
  // 1 code-review: denetim; denetim sürerken Read/Grep aday üretmez
  const cr = callOf('Skill', { skill: 'code-review' })
  expect(got(cr)).toEqual({ main: 'checklist-audit' })
  expect(got(callOf('Read', { file: 'a.ts' }, [cr.mark]))).toEqual({})
  expect(got(callOf('Grep', { text: 'foo' }, [cr.mark]))).toEqual({})
  // 2 güvenlik denetimi kalkanla
  expect(callOf('Skill', { skill: 'security-review' }).main).toBe('shield-guard')
  // 3 agent: çağrı telsiz (main), dönüş bayrak (ev), main değişmez
  let st = applyPick(undefined, callOf('Agent'), N9)
  st = applyPick(st, resultOf('Agent'), N9 + 5000)
  expect(st.id).toBe('radio-call')
  expect(st.ev?.id).toBe('handoff-baton')
  expect(st.ev && st.ev.until - st.ev.at).toBe(2000)
  // 4 devret → yalnız bayrak
  expect(got(callOf('SendMessage', { text: 'handoff: sende' }))).toEqual({ ev: 'handoff-baton' })
  // 5 izin reddi: kalkan, kıvılcım yok
  expect(got(resultOf('Edit', { denied: true, failed: true }))).toEqual({ ev: 'shield-guard' })
  // 6 test kırığı: varyant, kıvılcım yok; validate-data süzgeç, yalın validate test
  expect(got(resultOf('Bash', { cmd: 'pytest -q', failed: true }))).toEqual({ main: 'test-tube_fail' })
  expect(keywordAct([], 'run validate-data on the csv', 's')).toBe('funnel-filter')
  expect(keywordAct([], 'please validate it', 's')).toBe('test-tube')
  // 7 denetim sonucu
  expect(callOf('ReportFindings', { findings: 2 }).main).toBe('checklist-audit_fail')
  // 8 debug: araştırma dedektif, sonraki Edit hata onarımı, gevşek Edit kod
  const dbg = callOf('Skill', { skill: 'engineering:debug' })
  expect(dbg.main).toBe('detective-hunt')
  expect(callOf('Edit', { file: 'a.ts' }, [dbg.mark]).main).toBe('bug-fix')
  expect(callOf('Edit', { file: 'a.ts' }).main).toBe('type-fast')
  // 9 düzenleme sırası: hafıza > metin > hata > temizlik > kod
  expect(callOf('Edit', { file: 'C:/x/CLAUDE.md' }, FAIL).main).toBe('memory-brain')
  expect(callOf('Write', { file: 'rapor.docx' }, FAIL).main).toBe('quill-write')
  expect(callOf('Edit', { file: 'a.ts' }, [...FAIL, { t: N9, s: 'refactor' }]).main).toBe('bug-fix')
  // 10 okuma: görsel, kaynak, dizin
  expect(callOf('Read', { file: 'a.jpg' }).main).toBe('magnify-eye')
  expect(callOf('Bash', { cmd: 'tree src' }).main).toBe('map-explore')
  // 11 graphify
  expect(callOf('mcp__graphify__get_neighbors').main).toBe('code-read')
  expect(callOf('mcp__graphify__graph_stats').main).toBe('map-explore')
  // 12 git push: ana dal roket, diğer dal git
  expect(got(callOf('Bash', { cmd: 'git push -u origin release-notes' }))).toEqual({ main: 'git-branch' })
  expect(got(callOf('Bash', { cmd: 'git push origin HEAD:production' }))).toEqual({ ev: 'deploy-rocket' })
  // 13 worktree
  expect(callOf('EnterWorktree').main).toBe('git-branch')
  expect(callOf('mcp__ccd_host__discard_kept_worktree').main).toBe('broom-cleanup')
  // 14 arşiv / temizlik
  expect(callOf('Bash', { cmd: 'tar czf a.tgz src' }).ev).toBe('archive-boxes')
  expect(callOf('Bash', { cmd: 'npx eslint --fix src' }).main).toBe('broom-cleanup')
  // 15 arka plan kamera; ön planda tanınmayan 8 sn sonra derleme
  expect(callOf('Bash', { cmd: 'node server.js', bg: true }).main).toBe('security-cam')
  const slow = worker9({ activity: 'running', tool: 'Bash', since: N9 - 9000, act: { id: 'code-read', at: N9 - 20_000, seen: N9 - 20_000 } })
  expect(actView(slow, ctx9()).main?.id).toBe('compile-wait')
  expect(actView({ ...slow, since: N9 - 3000 }, ctx9()).main?.id).toBe('code-read')
  // 16 wrap_up: temiz konfeti, kirli megafon
  expect(callOf('mcp__ccd_turn__wrap_up').ev).toBe('confetti-party')
  expect(callOf('mcp__ccd_turn__wrap_up', {}, FAIL).main).toBe('megaphone-announce')
  // 17 hız sınırı: kısa 429 fiş (bir sonraki çağrı keser), 5 saatlik hak dolu patron uyur
  let q = applyPick(undefined, resultOf('WebSearch', { failed: true, out: '529 overloaded' }), N9)
  expect(q.ev?.id).toBe('error-sparks')
  q = applyPick(q, callOf('WebSearch'), N9 + 4000)
  expect(q.ev?.id).toBe('error-sparks')
  const boss = worker9({ id: 'boss', activity: 'thinking' })
  expect(actView(boss, ctx9({ isBoss: true, limitFull: true })).main?.id).toBe('nap-zzz')
  // 18 masada boşta: 0–2 dk yok, 2–10 dk kahve, ≥ 10 dk uyku
  const idle = (ms: number) => actView(worker9({ activity: 'idle', since: N9 - ms }), ctx9()).main?.id
  expect(idle(60_000)).toBeUndefined()
  expect(idle(3 * 60_000)).toBe('coffee-break')
  expect(idle(12 * 60_000)).toBe('nap-zzz')
  // 19 bağlam yükü yalnız patronda
  expect(actView(boss, ctx9({ isBoss: true, ctxPct: 88 })).over?.id).toBe('overheat-sweat')
  expect(actView(boss, ctx9({ isBoss: true, ctxPct: 97 })).main?.id).toBe('baglam-uyari')
  expect(actView(worker9(), ctx9({ ctxPct: 97 })).main?.id).not.toBe('nap-zzz')
  // 20 hata: kıvılcım + iz; ardından log okuması dedektif
  const sp = resultOf('Bash', { cmd: 'node x.js', failed: true })
  expect(sp.ev).toBe('error-sparks')
  expect(callOf('Read', { file: 'a.ts' }, pushMark([], sp.mark)).main).toBe('detective-hunt')
  // 21 video: misir yalnız render beklemesiyle ve hash(w.id+at) çiftken
  const film = (id: string, s?: ActMark['s']) => actView(worker9({ id, activity: 'running', tool: 'mcp__x__video_render', act: { id: 'film-shoot', at: N9 - 1000, seen: N9 - 1000 }, trail: [{ t: N9 - 1000, id: 'film-shoot', ...(s ? { s } : {}) }] }), ctx9())
  const ids = Array.from({ length: 12 }, (_, i) => `v${i}`)
  expect(ids.some(i => film(i, 'video').extra?.[0]?.id === 'film-shoot_misir')).toBe(true)
  expect(ids.some(i => film(i, 'video').extra === undefined)).toBe(true)
  expect(ids.every(i => film(i).extra === undefined)).toBe(true)
  expect(callOf('mcp__x__video_render').mark.s).toBe('video')
  // 22 varyant anında; şapka dedektifle
  const tt = applyPick(applyPick(undefined, callOf('Bash', { cmd: 'npm test' }), N9), resultOf('Bash', { cmd: 'npm test', failed: true }), N9 + 100)
  expect(tt.id).toBe('test-tube_fail')
  expect(actView(worker9({ activity: 'reading', act: { id: 'detective-hunt', at: N9, seen: N9 } }), ctx9()).hat).toBe(true)
})

test('0.9: no flicker: a new activity needs two calls in a row, a variant is at once, a one-off leaves the main alone', () => {
  const seq = (tools: Array<[string, Partial<ToolFacts>]>) => {
    let st: ActState | undefined
    let trail: ActMark[] = []
    const shown: Array<string | undefined> = []
    tools.forEach(([tool, extra], i) => {
      const p = pickActivity({ tool, phase: 'call', ...extra }, trail, `t${i}`, N9 + i * 1000)
      st = applyPick(st, p, N9 + i * 1000)
      trail = pushMark(trail, p.mark)
      shown.push(st.id)
    })
    return { shown, st: st as ActState | undefined, trail }
  }
  const RD: [string, Partial<ToolFacts>] = ['Read', { file: 'a.ts' }]
  const ED: [string, Partial<ToolFacts>] = ['Edit', { file: 'a.ts' }]
  expect(seq([RD, ED, RD, ED, RD, ED]).shown).toEqual(['code-read', 'code-read', 'code-read', 'code-read', 'code-read', 'code-read'])
  expect(seq([RD, ED, ED]).shown).toEqual(['code-read', 'code-read', 'type-fast'])
  // başlangıç anı yalnız etkinlik değişince yenilenir
  const held = seq([RD, RD, RD]).st
  expect(held?.at).toBe(N9)
  expect(held?.seen).toBe(N9 + 2000)
  // varyant anında
  expect(settleAct({ id: 'test-tube', at: N9, seen: N9 }, 'test-tube_fail', N9 + 1).id).toBe('test-tube_fail')
  // olay main'i değiştirmez, bitince main görünür; aynı olay süresi içinde yeniden başlamaz
  let st: ActState = { id: 'type-fast', at: N9, seen: N9 }
  st = withEv(st, 'error-sparks', N9 + 100)
  const at = st.ev?.at
  st = withEv(st, 'error-sparks', N9 + 500)
  expect(st.ev?.at).toBe(at)
  expect(st.id).toBe('type-fast')
  // düşük öncelikli olay çalışanı kesmez
  expect(withEv(st, 'archive-boxes', N9 + 600).ev?.id).toBe('error-sparks')
  const w = worker9({ act: st, since: N9 })
  expect(actView(w, ctx9({ now: N9 + 300 })).ev?.id).toBe('error-sparks')
  const after = actView(w, ctx9({ now: (st.ev?.until ?? 0) + 1 }))
  expect(after.ev).toBeUndefined()
  expect(after.main?.id).toBe('type-fast')
  // 60 sn tutma: düşünürken eski main 60 sn sonra düşer
  expect(actView(worker9({ activity: 'thinking', act: { id: 'type-fast', at: N9 - 30_000, seen: N9 - 30_000 } }), ctx9()).main?.id).toBe('type-fast')
  expect(actView(worker9({ activity: 'thinking', act: { id: 'type-fast', at: N9 - 90_000, seen: N9 - 90_000 } }), ctx9()).main).toBeUndefined()
  // bitiş: main silinir, konfeti kalır
  const end = endAct({ id: 'type-fast', at: N9, seen: N9 }, false, N9 + 10)
  expect(end.id).toBeUndefined()
  expect(end.ev?.id).toBe('confetti-party')
  // bir ofis, etkinlikli işçilerle, 3 sn arayla aynı resmi çizer (animasyon zamanları dışında)
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'thinking', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9 - 5000, joinedAt: N9 - 999_999, act: { id: 'plan-blueprint', at: N9 - 5000, seen: N9 - 5000 } },
    worker9({ id: 'a1', activity: 'writing', tool: 'Edit', act: { id: 'type-fast', at: N9 - 4000, seen: N9 - 4000 } }),
    worker9({ id: 'a2', n: 1, seat: 1, activity: 'reading', tool: 'Read', act: { id: 'detective-hunt', at: N9 - 4000, seen: N9 - 4000 } }),
    worker9({ id: 'a3', n: 2, seat: 2, activity: 'running', tool: 'Bash', act: { id: 'test-tube', at: N9 - 4000, seen: N9 - 4000 } }),
  ]
  const usage = { ctxPct: 30, ctxTokens: 300_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 20 }], at: N9, history: [30] }
  const turn = { active: true, steps: 3, turns: 1, prompt: 'x', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: {}, hired: 3, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: N9 - 3_600_000 }
  const shown = (t: number) => hudSvg({ workers, feed: [], usage, turn, stats, now: t, motion: true, width: 1280, fill: 968 }).svg.replace(/animation(?:-delay)?:[^;"]*/g, '').replace(/ begin="[^"]*"/g, '')
  // (the first draw carries symbols other tests registered: warm up once)
  shown(N9 - 1000)
  expect(shown(N9 + 3000)).toBe(shown(N9))
})

test('0.9: the budget: 26 workers on 26 activities stay inside the Svg limit, every strip used is defined, the lowest go first', () => {
  const acts = MAIN_ACTS.filter(id => !isEvent(id) && ACTS[id]?.cls !== 'ambiyans').slice(0, 26)
  expect(acts).toHaveLength(26)
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'planning', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9 - 5000, joinedAt: N9 - 999_999, model: 'claude-opus-5-5', act: { id: 'plan-blueprint', at: N9 - 5000, seen: N9 - 5000 } },
  ]
  const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gemini-3-pro', 'gemini-3-flash', 'glm-5.3', 'mistral-large']
  acts.forEach((id, i) => {
    workers.push(worker9({ id: `w${i}`, n: i, seat: i, name: `Çalışan ${i}`, activity: 'running', tool: 'Edit', model: models[i % models.length], since: N9 - 1000, act: { id, at: N9 - 1000, seen: N9 - 1000, ...(i % 5 === 0 ? { ev: { id: 'confetti-party', at: N9 - 200, until: N9 + 1400 } } : {}) } }))
  })
  const usage = { ctxPct: 50, ctxTokens: 500_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 40 }], at: N9, history: [50] }
  const turn = { active: true, steps: 3, turns: 1, prompt: 'x', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: { Edit: 30 }, hired: 26, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: N9 - 3_600_000 }
  for (const theme of ['dark', 'light'] as const) {
    useHudTheme(theme)
    for (const width of [420, 856, 1280, 2400]) {
      const svg = hudSvg({ workers, feed: [], usage, turn, stats, now: N9, motion: true, width, fill: 1000 }).svg
      expect(svg.length).toBeLessThanOrEqual(128_000)
      for (const m of svg.matchAll(/href="#(ac-[^"]+)"/g)) expect([m[1], svg.includes(`id="${m[1]}"`)]).toEqual([m[1], true])
    }
  }
  useHudTheme('dark')
  // plan: patronunki kalır, düşenler kalanlardan düşük öncelikli, aynı girdi aynı küme
  const views = new Map<string, ActView>()
  for (const w of workers) views.set(w.id, actView(w, ctx9({ isBoss: w.id === 'boss', kind: 'turuncu' })))
  const cap = 9000
  const kept = planActs(views, cap)
  expect(kept.has('plan-blueprint')).toBe(true)
  expect([...planActs(views, cap)].sort()).toEqual([...kept].sort())
  const mainPrio = (keep: boolean) => [...views].filter(([who, v]) => who !== 'boss' && v.main && !v.ev && kept.has(v.main.strip) === keep).map(([, v]) => ACTS[v.main?.id ?? '']?.prio ?? 0)
  const dropped = mainPrio(false)
  expect(dropped.length).toBeGreaterThan(0)
  expect(Math.max(...dropped)).toBeLessThanOrEqual(Math.min(...mainPrio(true)))
  // defs: yalnız kullanılan ∩ izinli, sınır içinde; kayıt sonra boşalır
  actDefs(new Set())
  for (const s of kept) actUse(s, s)
  actUse('nap-zzz', 'nap-zzz')
  const defs = actDefs(kept)
  expect(defs).not.toContain('id="ac-nap-zzz"')
  expect(defs.length).toBeLessThanOrEqual(cap + 200)
  expect(actDefs(kept)).toBe('')
})

test('0.9: conditions: an outside worker on the line, idle desks, tired office, the hat crops no figure', () => {
  // dış işçi: kulaklık + 3 sn telsiz; sonra "Dış hatta"
  const ext = hireAct('Kodu incele', undefined, true, 'ext:1', N9) as ActState
  expect(ext.id).toBe('headset-listen')
  expect(ext.ev).toEqual({ id: 'radio-call', at: N9, until: N9 + 3000 })
  const xw = worker9({ id: 'ext:1', kind: 'external', activity: 'running', tool: 'Bash', act: ext, since: N9 })
  const during = actView(xw, ctx9({ kind: 'yesil', external: true, now: N9 + 1000 }))
  expect(during.main?.strip).toBe('headset-listen')
  expect(during.ev?.id).toBe('radio-call')
  expect(during.label).toBe('Dış hatta')
  expect(actView(xw, ctx9({ kind: 'yesil', external: true, now: N9 + 4000 })).label).toBe('Dış hatta')
  // üç karakter aynı boyda: kulaklık şeridi ortak
  for (const kind of ['turuncu', 'yesil', 'mavi'] as const) expect(stripFor('headset-listen', kind)).toBe('headset-listen')
  // uzun dış işte bile tanınmayan Bash derlemeye dönmez (kulaklık kalır)
  expect(actView({ ...xw, since: N9 - 60_000 }, ctx9({ kind: 'yesil', external: true })).main?.id).toBe('headset-listen')
  // yorgunluk: hız düşer; bitkin ofiste düşük öncelikli iş terler, boşta uyur, yüksek öncelikli kalır
  const busy = worker9({ act: { id: 'type-fast', at: N9, seen: N9 } })
  expect(actView(busy, ctx9({ fat: 1 })).speed).toBe(0.85)
  expect(actView(busy, ctx9({ fat: 2 })).over?.id).toBe('overheat-sweat')
  const tired = actView(busy, ctx9({ fat: 3 }))
  expect(tired.main?.id).toBe('overheat-sweat')
  expect(tired.over).toBeUndefined()
  expect(tired.speed).toBe(0.5)
  expect(actView(worker9({ act: { id: 'paint-canvas', at: N9, seen: N9 } }), ctx9({ fat: 3 })).main?.id).toBe('paint-canvas')
  expect(actView(worker9({ activity: 'idle', since: N9 - 3 * 60_000 }), ctx9({ fat: 3 })).main?.id).toBe('nap-zzz')
  // kafa ankerli bir şey varken üst gösterge binmez
  expect(actView(worker9({ act: { id: 'memory-brain', at: N9, seen: N9 } }), ctx9({ fat: 2 })).over).toBeUndefined()
  // uzun iş: 30 dk ya da 150 araç
  expect(actView(worker9({ joinedAt: N9 - 31 * 60_000 }), ctx9()).over?.id).toBe('overheat-sweat')
  // patron: ekip çalışırken gözetler, denetçi varken hakemlik; beklerken kahve
  const boss = worker9({ id: 'boss', activity: 'delegating' })
  expect(actView(boss, ctx9({ isBoss: true, teamBusy: 3 })).main?.id).toBe('binoculars')
  expect(actView(boss, ctx9({ isBoss: true, teamBusy: 3, criticBusy: true })).main?.id).toBe('checklist-audit')
  expect(actView({ ...boss, activity: 'waiting' }, ctx9({ isBoss: true })).main?.id).toBe('coffee-break')
  expect(actView({ ...boss, activity: 'idle' }, ctx9({ isBoss: true })).main).toBeUndefined()
  // şapka başın üstüne oturur: hiçbir figür kırpılmaz
  for (const kind of ['turuncu', 'yesil', 'mavi'] as const) expect(hatCrop(kind)).toBeUndefined()
})

test('0.9: labels are short Turkish single lines, one per activity; the desk plate says what the worker does', () => {
  const labels = Object.values(ACT_LABEL)
  expect(new Set(labels).size).toBe(labels.length)
  for (const l of [...labels, EXTERNAL_LABEL]) {
    expect([l, l.length <= 16, /\n/.test(l)]).toEqual([l, true, false])
  }
  for (const e of Object.values(ACTS)) if (e.role === 'ana' || e.role === 'varyant') expect([e.id, typeof ACT_LABEL[e.id]]).toEqual([e.id, 'string'])
  expect(actView(worker9({ activity: 'waiting', act: { id: 'type-fast', at: N9, seen: N9 } }), ctx9()).label).toBeUndefined()
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'idle', bubble: '', detail: '', tools: 0, tokensOut: 0, since: N9, joinedAt: N9 - 999_999 },
    worker9({ id: 'a1', activity: 'writing', tool: 'Edit', act: { id: 'type-fast', at: N9 - 1000, seen: N9 - 1000 } }),
    worker9({ id: 'a2', n: 1, seat: 1, name: 'Kâşif', activity: 'waiting', act: { id: 'type-fast', at: N9 - 1000, seen: N9 - 1000 } }),
  ]
  const usage = { ctxPct: 30, ctxTokens: 300_000, ctxWindow: 1_000_000, limits: [], at: N9, history: [30] }
  const turn = { active: true, steps: 1, turns: 1, prompt: 'x', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: {}, hired: 2, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: N9 - 3_600_000 }
  const svg = hudSvg({ workers, feed: [], usage, turn, stats, now: N9, motion: true, width: 1600, fill: 1000 }).svg
  expect(svg).toContain('Kod yazıyor')
  expect(svg).toContain('Seni bekliyor')
})

test('0.9: stress: 26 workers × 200 seeded steps never throw, never flicker, keep 8 marks and no raw command or path', () => {
  let seed = 42
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const steps: Array<Partial<ToolFacts> & { tool: string }> = [
    { tool: 'Read', file: 'C:/gizli/proje/app.ts' }, { tool: 'Read', file: 'C:/gizli/ekran.png' }, { tool: 'Edit', file: 'C:/gizli/proje/app.ts' },
    { tool: 'Write', file: 'C:/gizli/README.md' }, { tool: 'Bash', cmd: 'git push origin main' }, { tool: 'Bash', cmd: 'npm test' },
    { tool: 'Bash', cmd: 'rm -rf C:/gizli/build' }, { tool: 'Grep', text: 'error' }, { tool: 'WebSearch' }, { tool: 'Agent' },
    { tool: 'SendMessage', text: 'Gizli plan: git push' }, { tool: 'Skill', skill: 'code-review' }, { tool: 'mcp__x__generate_image' },
    { tool: 'TodoWrite' }, { tool: 'Bash', cmd: 'node C:/gizli/x.ts' }, { tool: 'AskUserQuestion' },
  ]
  for (let k = 0; k < 26; k++) {
    let st: ActState | undefined
    let trail: ActMark[] = []
    let last: string | undefined
    let prevCand: string | undefined
    let cands = 0
    let changes = 0
    let forced = 0
    for (let i = 0; i < 200; i++) {
      const s = steps[Math.floor(rnd() * steps.length)] as ToolFacts
      const now = N9 + i * 1500
      const phase = rnd() < 0.3 ? 'result' : 'call'
      const p = pickActivity({ ...s, phase, failed: phase === 'result' && rnd() < 0.3 }, trail, `w${k}-${i}`, now)
      st = applyPick(st, p, now)
      trail = pushMark(trail, p.mark)
      expect(trail.length).toBeLessThanOrEqual(8)
      if (p.main !== undefined) {
        if (prevCand !== undefined && p.main !== prevCand) cands++
        // a change is confirmed by two candidates in a row (of one family, or siblings), is a variant of the
        // shown one, or is a strong one-off signal (a skill, a report, a broken test)
        if (st.id !== last && last !== undefined) {
          changes++
          if (p.force) forced++
          const twice = prevCand !== undefined && (p.main === prevCand || familyOf(p.main) === familyOf(prevCand) || siblings(p.main, prevCand))
          expect([p.main, last, prevCand, twice || familyOf(p.main) === familyOf(last) || p.force === true]).toEqual([p.main, last, prevCand, true])
        }
        prevCand = p.main
      }
      last = st.id
      const view = actView(worker9({ id: `w${k}`, act: st, trail, activity: (['reading', 'writing', 'running', 'thinking', 'idle'] as const)[i % 5], since: now - 500 }), ctx9({ now: now + 200, fat: (i % 4) as 0 | 1 | 2 | 3 }))
      expect(view.speed).toBeGreaterThan(0)
    }
    expect(changes).toBeLessThanOrEqual(cands + forced + 1)
    const json = JSON.stringify({ act: st, trail })
    expect(/[\\/]|\.ts\b|git push|gizli/.test(json)).toBe(false)
  }
})

// —— 0.9 son düzeltme: tek seferlik güçlü sinyaller, görünüm titremesi, bekleyen komut, olay bütçesi, kardeşler, sönen iz ——

/** a run of calls (and results) for one worker: each step's state and view as drawn right after it */
function run9(steps: Array<{ f: Partial<ToolFacts> & { tool: string }; phase?: 'call' | 'result'; dt?: number; activity?: Activity }>, opts: { boss?: boolean; teamBusy?: number; start?: ActState } = {}) {
  let st: ActState | undefined = opts.start
  let trail: ActMark[] = []
  let t = N9
  const shown: Array<string | undefined> = []
  steps.forEach((s, i) => {
    t += s.dt ?? 1000
    const p = pickActivity({ phase: s.phase ?? 'call', ...s.f }, trail, `s${i}`, t)
    st = applyPick(st, p, t)
    trail = pushMark(trail, p.mark)
    const w = worker9({ id: opts.boss ? 'boss' : 'a1', act: st, trail, activity: s.activity ?? 'reading', since: s.phase === 'result' ? t - 500 : t })
    shown.push(actView(w, ctx9({ now: t + 100, isBoss: opts.boss === true, teamBusy: opts.teamBusy ?? 0 })).main?.id)
  })
  return { st: st as ActState | undefined, trail, shown, t }
}

test('0.9: one strong signal is enough: a broken test after edits, a review skill, a report, a notice', () => {
  const ED = { f: { tool: 'Edit', file: 'a.ts' }, activity: 'writing' as const }
  // Edit, Edit, npm test (call), the result fails: Test kırıldı (the test was only a pending candidate)
  const t1 = run9([ED, ED, { f: { tool: 'Bash', cmd: 'npm test' }, activity: 'running' }, { f: { tool: 'Bash', cmd: 'npm test', failed: true, out: '1 failed' }, phase: 'result', activity: 'thinking' }])
  expect(t1.st?.id).toBe('test-tube_fail')
  expect(t1.shown[3]).toBe('test-tube_fail')
  // a code review called once, then reads: the audit at once, kept fresh by the reads (no stale 'Kod yazıyor')
  const rv = run9([ED, ED, { f: { tool: 'Skill', skill: 'code-review' }, activity: 'running' }, ...Array.from({ length: 5 }, () => ({ f: { tool: 'Read', file: 'b.ts' }, dt: 30_000 }))])
  expect(rv.shown.slice(2)).toEqual(['checklist-audit', 'checklist-audit', 'checklist-audit', 'checklist-audit', 'checklist-audit', 'checklist-audit'])
  // a security review: the shield, also kept through its reads
  expect(run9([ED, ED, { f: { tool: 'Skill', skill: 'security-review' } }, { f: { tool: 'Grep', text: 'token' } }]).shown.slice(2)).toEqual(['shield-guard', 'shield-guard'])
  // findings reported: at once; the report ends the audit, reads are code reading again
  const rf = run9([{ f: { tool: 'Skill', skill: 'code-review' } }, { f: { tool: 'ReportFindings', findings: 2 } }, { f: { tool: 'Read', file: 'c.ts' } }, { f: { tool: 'Read', file: 'c.ts' } }])
  expect(rf.shown).toEqual(['checklist-audit', 'checklist-audit_fail', 'checklist-audit_fail', 'code-read'])
  // a notice once: the megaphone
  expect(run9([ED, ED, { f: { tool: 'PushNotification' } }]).shown[2]).toBe('megaphone-announce')
  // after a failure, wrap_up announces (once) instead of celebrating
  expect(pickActivity({ tool: 'mcp__ccd_turn__wrap_up', phase: 'call' }, FAIL, 's', N9).main).toBe('megaphone-announce')
})

test('0.9: no flicker in the view: a new unconfirmed tool does not bring back an old activity; the boss keeps one watch', () => {
  // a stale main (confirmed 3 min ago) is not shown under a new tool that has not confirmed it
  const stale = worker9({ activity: 'reading', since: N9, act: { id: 'radio-call', at: N9 - 200_000, seen: N9 - 180_000, next: 'code-read', nextAt: N9 } })
  expect(actView(stale, ctx9()).main).toBeUndefined()
  // the boss: two hires, then reads, task outputs, greps and thinking for two minutes: one change at most
  const steps: Parameters<typeof run9>[0] = [{ f: { tool: 'Agent' }, activity: 'delegating' }, { f: { tool: 'Agent' }, activity: 'delegating' }]
  const cycle: Array<[string, Activity]> = [['Read', 'reading'], ['TaskOutput', 'reading'], ['Grep', 'reading'], ['Read', 'thinking']]
  for (let i = 0; i < 12; i++) {
    const [tool, activity] = cycle[i % cycle.length] as [string, Activity]
    steps.push({ f: { tool, file: 'x.ts' }, activity, dt: 10_000 })
  }
  const b = run9(steps, { boss: true, teamBusy: 3 })
  const after = b.shown.slice(1)
  const flips = after.filter((id, i) => i > 0 && id !== after[i - 1]).length
  expect(flips).toBeLessThanOrEqual(1)
  expect(after[0]).toBe('radio-call')
  // with nothing of its own for a minute it watches the team, thinking or using a tool alike
  const idleBoss = (activity: Activity) => worker9({ id: 'boss', activity, since: N9, act: { id: 'radio-call', at: N9 - 120_000, seen: N9 - 90_000, next: 'periscope', nextAt: N9 } })
  for (const a of ['thinking', 'reading', 'running'] as const) expect([a, actView(idleBoss(a), ctx9({ isBoss: true, teamBusy: 2 })).main?.id]).toEqual([a, 'binoculars'])
})

test('0.9: a recognized long command is not called a build; Web and reading tools that alternate settle as one', () => {
  // npm test once, still running after 9 s: the test tube (its own candidate), never 'Derleniyor'
  const st = run9([{ f: { tool: 'Edit', file: 'a.ts' } }, { f: { tool: 'Edit', file: 'a.ts' } }, { f: { tool: 'Bash', cmd: 'npm test' }, activity: 'running' }]).st as ActState
  const w = worker9({ activity: 'running', tool: 'Bash', since: N9 + 3000, act: st })
  expect(actView(w, ctx9({ now: N9 + 3000 + 9000 })).main?.id).toBe('test-tube')
  // an unknown command still shows the build wait
  const u = run9([{ f: { tool: 'Edit', file: 'a.ts' } }, { f: { tool: 'Edit', file: 'a.ts' } }, { f: { tool: 'Bash', cmd: 'node x.js' }, activity: 'running' }]).st as ActState
  expect(actView(worker9({ activity: 'running', tool: 'Bash', since: N9 + 3000, act: u }), ctx9({ now: N9 + 12_000 })).main?.id).toBe('compile-wait')
  // WebSearch, WebFetch, WebSearch…: the web settles on the second call and stays
  const web = run9([{ f: { tool: 'Edit', file: 'a.ts' } }, { f: { tool: 'Edit', file: 'a.ts' } }, ...Array.from({ length: 6 }, (_, i) => ({ f: { tool: i % 2 ? 'WebFetch' : 'WebSearch' }, activity: 'web' as const }))])
  expect(web.shown.slice(3)).toEqual(['radar-scan', 'radar-scan', 'radar-scan', 'radar-scan', 'radar-scan'])
  // Read, Grep, Read, Grep: reading stays, the shelf does not blink
  const rg = run9([{ f: { tool: 'Read', file: 'a.ts' } }, ...Array.from({ length: 6 }, (_, i) => ({ f: i % 2 ? { tool: 'Read', file: 'a.ts' } : { tool: 'Grep', text: 'x' } }))])
  expect(new Set(rg.shown)).toEqual(new Set(['code-read']))
  expect(siblings('globe-spin', 'radar-scan')).toBe(true)
  expect(siblings('code-read', 'type-fast')).toBe(false)
})

test('0.9: marks fade: an old failure or one a passing test cleared does not make every edit a bug fix', () => {
  const old: ActMark[] = [{ t: N9 - 6 * 60_000, f: 1 }]
  expect(pickActivity({ tool: 'Edit', phase: 'call', file: 'a.ts' }, old, 's', N9).main).toBe('type-fast')
  expect(pickActivity({ tool: 'Edit', phase: 'call', file: 'a.ts' }, FAIL, 's', N9).main).toBe('bug-fix')
  const pass = pickActivity({ tool: 'Bash', phase: 'result', cmd: 'npm test' }, [], 's', N9)
  expect(pass.mark.s).toBe('ok')
  const cleared = pushMark(FAIL, pass.mark)
  expect(pickActivity({ tool: 'Edit', phase: 'call', file: 'a.ts' }, cleared, 's', N9 + 10).main).toBe('type-fast')
  expect(pickActivity({ tool: 'Read', phase: 'call', file: 'a.ts' }, cleared, 's', N9 + 10).main).toBe('code-read')
  expect(pickActivity({ tool: 'mcp__ccd_turn__wrap_up', phase: 'call' }, cleared, 's', N9 + 10).ev).toBe('confetti-party')
  // an audit five minutes old is over
  expect(pickActivity({ tool: 'Read', phase: 'call', file: 'a.ts' }, [{ t: N9 - 6 * 60_000, s: 'audit' }], 's', N9).main).toBe('code-read')
})

test('0.9: words: deploy only to a main branch, a real vercel deploy or a real publish; prose stems are whole words', () => {
  const sh = (cmd: string) => pickActivity({ tool: 'Bash', phase: 'call', cmd }, [], 's', N9)
  expect(sh('git push origin main').ev).toBe('deploy-rocket')
  expect(sh('git push -u origin HEAD:master').ev).toBe('deploy-rocket')
  expect(sh('git push -u origin feature/main-fix').main).toBe('git-branch')
  expect(sh('cat vercel.json').ev).toBeUndefined()
  expect(sh('vercel --prod').ev).toBe('deploy-rocket')
  expect(sh('npm publish --dry-run').ev).toBeUndefined()
  expect(sh('npm publish').ev).toBe('deploy-rocket')
  expect(keywordAct([], 'logout akışını düzelt', 's')).not.toBe('paint-canvas')
  expect(keywordAct([], 'drawer bileşenini taşı', 's')).not.toBe('paint-canvas')
  expect(keywordAct([], 'logoyu çiz', 's')).toBe('paint-canvas')
  expect(keywordAct([], 'draw the icon', 's')).toBe('paint-canvas')
  expect(keywordAct([], 'son değişikliği geri çevir', 's')).not.toBe('dictionary-translate')
  expect(keywordAct([], 'metni İngilizceye çevir', 's')).toBe('dictionary-translate')
})

test('0.9: an event does not cost another worker its prop: the settled picture is the same with and without it', () => {
  const acts = MAIN_ACTS.filter(id => !isEvent(id) && ACTS[id]?.cls !== 'ambiyans').slice(0, 26)
  const make = (ev: boolean): Worker[] => [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'planning', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9 - 5000, joinedAt: N9 - 999_999, model: 'claude-opus-5-5', act: { id: 'plan-blueprint', at: N9 - 5000, seen: N9 - 5000 } },
    ...acts.map((id, i) =>
      worker9({ id: `w${i}`, n: i, seat: i, name: `Çalışan ${i}`, activity: 'running', tool: 'Edit', since: N9 - 1000, act: { id, at: N9 - 1000, seen: N9 - 1000, ...(ev && i < 3 ? { ev: { id: ['deploy-rocket', 'confetti-party', 'error-sparks'][i] as string, at: N9 - 200, until: N9 + 1400 } } : {}) } }),
    ),
  ]
  const views = (ws: Worker[]) => new Map(ws.map(w => [w.id, actView(w, ctx9({ isBoss: w.id === 'boss' }))] as const))
  // the lasting strips are planned apart from the events
  const lastingOf = (ws: Worker[]) => {
    const kept = planActs(views(ws), 20_000)
    const ev = new Set(ws.map(w => w.act?.ev?.id).filter((x): x is string => typeof x === 'string'))
    return [...kept].filter(s => !ev.has(s)).sort()
  }
  expect(lastingOf(make(true))).toEqual(lastingOf(make(false)))
  const usage = { ctxPct: 50, ctxTokens: 500_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 40 }], at: N9, history: [50] }
  const turn = { active: true, steps: 3, turns: 1, prompt: 'x', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: { Edit: 30 }, hired: 26, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: N9 - 3_600_000 }
  const key = (ws: Worker[], width: number) => hudSvg({ workers: ws, feed: [], usage, turn, stats, now: N9, motion: true, width, fill: 1000, settled: true } as Parameters<typeof hudSvg>[0]).svg.replace(/animation(?:-delay)?:[^;"]*/g, '').replace(/ begin="[^"]*"/g, '')
  key(make(false), 1280)
  for (const width of [856, 1280, 2400]) expect(key(make(true), width) === key(make(false), width)).toBe(true)
})

test('0.9: the desk says what is done in visible text, under the plate when the plate has no room', () => {
  const models = ['deepseek-v4.1-flash', 'gpt-6.1-sol', 'gemini-3-flash', 'gpt-6.1-luna', 'gpt-6.1-terra', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5', 'claude-opus-5-5']
  const ids = ['quill-write', 'type-fast', 'globe-spin', 'paint-canvas', 'plan-blueprint', 'code-read', 'test-tube', 'library-shelf', 'checklist-audit']
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'thinking', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9 - 5000, joinedAt: N9 - 999_999, model: 'claude-opus-5-5' },
    ...ids.map((id, i) => worker9({ id: `w${i}`, n: i, seat: i, name: `Çalışan ${i}`, model: models[i], activity: 'writing', tool: 'Edit', since: N9 - 1000, act: { id, at: N9 - 1000, seen: N9 - 1000 } })),
  ]
  const usage = { ctxPct: 30, ctxTokens: 300_000, ctxWindow: 1_000_000, limits: [], at: N9, history: [30] }
  const turn = { active: true, steps: 1, turns: 1, prompt: 'x', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: {}, hired: 9, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: N9 - 3_600_000 }
  for (const [width, fill] of [[1700, 1000], [1400, 800], [2400, 1400]] as const) {
    const svg = hudSvg({ workers, feed: [], usage, turn, stats, now: N9, motion: true, width, fill }).svg
    // visible text only (a tooltip's <title> does not count)
    const visible = [...svg.matchAll(/<text[^>]*>([^<]*(?:<tspan[^>]*>[^<]*<\/tspan>[^<]*)*)<\/text>/g)].map(m => m[1]?.replace(/<[^>]+>/g, '') ?? '')
    const said = ids.filter(id => visible.some(t => t.includes(ACT_LABEL[id] as string)))
    expect([width, said.length]).toEqual([width, ids.length])
  }
})

test('0.9: the office keeps activities from real calls: the plate says what is done, nothing of the command or the path is drawn', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  const src = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  await $.agent.spawn({ prompt: 'Kodu tara', description: 'Kodu tara', subagentType: 'Explore' } as never)
  await clock.advance(3500)
  // an Explore hire maps or shelves from its first frame
  expect(/Proje geziyor|Dosya arıyor/.test(await src())).toBe(true)
  for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'Edit', file_path: 'C:/gizli/proje/app.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  // a settled change is painted within the 15 s check
  await clock.advance(16_000)
  expect(await src()).toContain('Kod yazıyor')
  for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'Bash', command: 'git push origin gizli-dal', description: 'Gizli dalı gönder', agentId: 'a1' })
  await clock.advance(16_000)
  const source = await src()
  expect(source).toContain('Git işinde')
  for (const secret of ['C:/gizli', 'gizli-dal', 'git push']) expect(source).not.toContain(secret)
  await ui.unmount()
})

// —— 1.0: durdurulan işler masadan kalkar, Cetvel'in dış ajanları oturur, dört platform maskotu ——

test('1.0: a stopped workflow leaves its desks at once and neutral, and a resumed run is shown once', async ($, on) => {
  const clock = mock.clock(on)
  engine(
    on,
    e =>
      e.tool === 'Workflow'
        ? { status: 'async_launched', taskId: e.resumeFromRunId ? 'wt-2' : 'wt-1', runId: 'wf_r1' }
        : e.tool === 'TaskStop'
          ? { message: 'durdu', task_id: 'wt-1', task_type: 'local_workflow' }
          : {},
    true,
  )

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'x', description: 'y', phases: [] }\nawait agent('a')\nawait agent('b')" })
  await $.agent.spawn({ prompt: 'Sahneyi yaz', description: 'Sahneyi yaz', subagentType: 'general-purpose', workflow: { runId: 'wf_r1', agentIndex: 1 } } as never)
  await $.agent.spawn({ prompt: 'Testleri yaz', description: 'Testleri yaz', subagentType: 'general-purpose', workflow: { runId: 'wf_r1', agentIndex: 2 } } as never)
  // a stalled agent's retry: seated by its first call (no spawn is raised for it), bound to the live run
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/a.ts', agentId: 'wf-retry' })
  await clock.advance(1200)
  expect(await teamRows($)).toHaveLength(3)

  // TaskStop names the run's task: every desk of the run stops at once, neutral (not a failure)
  await $.tool.call({ tool: 'TaskStop', task_id: 'wt-1' })
  await clock.advance(1200)
  let rows = await teamRows($)
  expect(rows).toHaveLength(3)
  for (const r of rows) expect(r).toMatch(/— Durduruldu$/)
  for (const r of rows) expect(r).not.toMatch(/yarım kaldı|hata/)

  // the run resumes (same run id, its agent() calls counted again): the new agents take the stopped desks
  await $.tool.call({ tool: 'Workflow', scriptPath: 'C:/proje/wf.js', resumeFromRunId: 'wf_r1' })
  await $.agent.spawn({ prompt: 'Sahneyi yaz', description: 'Sahneyi yaz', subagentType: 'general-purpose', workflow: { runId: 'wf_r1', agentIndex: 1 } } as never)
  await $.agent.spawn({ prompt: 'Testleri yaz', description: 'Testleri yaz', subagentType: 'general-purpose', workflow: { runId: 'wf_r1', agentIndex: 2 } } as never)
  await clock.advance(1200)
  rows = await teamRows($)
  expect(rows.filter(r => !/Durduruldu/.test(r))).toHaveLength(2)
  // each agent() call once: one desk per title, never two of the same run side by side
  expect(new Set(rows.filter(r => !/Durduruldu/.test(r)).map(r => r.split('  ')[0])).size).toBe(2)
  // the stopped retry walks out; the two live desks stay
  await clock.advance(20_000)
  rows = await teamRows($)
  expect(rows).toHaveLength(2)
  for (const r of rows) expect(r).not.toMatch(/Durduruldu/)
})

test('1.0: a killed, an interrupted and a stalled agent leave; a workflow stopped from the app leaves with its task', async ($, on) => {
  const clock = mock.clock(on)
  let listed: unknown[] = []
  engine(on, e => (e.tool === 'Workflow' ? { status: 'async_launched', taskId: 'wt-9', runId: 'wf_r9' } : {}), true, () => listed)
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Logları tara', description: 'Logları tara', subagentType: 'Explore' } as never)
  await $.agent.spawn({ prompt: 'Kodu incele', description: 'Kodu incele', subagentType: 'general-purpose' } as never)
  listed = [{ id: 'a1', type: 'Explore', description: 'Logları tara', status: 'running' }]
  await clock.advance(2500)
  expect(await teamRows($)).toHaveLength(2)
  // the list says killed (TaskStop by name, the stop button); the other's turn was interrupted
  listed = [{ id: 'a1', type: 'Explore', description: 'Logları tara', status: 'killed' }]
  await $.turn.complete({ turnId: 't-a2', agentId: 'a2', answer: '', reason: 'aborted', isAborted: true, durationMs: 10 } as never)
  await clock.advance(2500)
  let rows = await teamRows($)
  expect(rows).toHaveLength(2)
  for (const r of rows) expect(r).toMatch(/— Durduruldu$/)
  await clock.advance(20_000)
  expect(await teamRows($)).toHaveLength(0)

  // a workflow's agent whose task the app stopped: the background list shows it live, then not at all
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'x', description: 'y', phases: [] }\nawait agent('a')" })
  await $.agent.spawn({ prompt: 'Raporu yaz', description: 'Raporu yaz', subagentType: 'general-purpose', workflow: { runId: 'wf_r9', agentIndex: 1 } } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'wt-9', type: 'workflow', status: 'running', description: 'x' }] } as never)
  await clock.advance(1200)
  expect(await teamRows($)).toHaveLength(1)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  await clock.advance(1200)
  expect((await teamRows($))[0]).toMatch(/— Görev kapandı$/)
  await clock.advance(20_000)
  expect(await teamRows($)).toHaveLength(0)

  // an agent no list knows, with no call open, quiet for a quarter of an hour, has stalled: it leaves
  await $.agent.spawn({ prompt: 'Belgeyi oku', description: 'Belgeyi oku', subagentType: 'general-purpose' } as never)
  await clock.advance(5 * 60_000)
  expect(await teamRows($)).toHaveLength(1)
  await clock.advance(10 * 60_000)
  await clock.advance(6000)
  expect((await teamRows($))[0]).toMatch(/— Sessiz kaldım, çıkıyorum$/)
  await clock.advance(20_000)
  expect(await teamRows($)).toHaveLength(0)
})

/** Cetvel's file as it writes it: `ajanlar` in its own field names, times as UTC ISO. */
function cetvelFile(t0: number, seq: number, agents: Array<Record<string, unknown>>): string {
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')

  return JSON.stringify({
    surum: 1,
    zaman: iso(t0),
    sira: seq,
    kaynaklar: { codex: { durum: 'izleniyor', ajan: 2 } },
    ajanlar: agents.map(a => ({ derinlik: 0, son_etkinlik: iso(t0), sayilar: { arac: 3, arac_hatasi: 0, alt_ajan: 0 }, ...a })),
  })
}

test('1.0: Cetvel’s ajanlar.json seats Codex and Antigravity agents and their subagents under them; one run seen twice is one desk', async ($, on) => {
  const T = Date.UTC(2026, 10, 16, 9, 0, 0)
  const clock = mock.clock(on, { now: T })
  let snap: { text: string; mtimeMs: number } | undefined
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-cx' }, false, undefined, {
    env: { LOCALAPPDATA: 'C:\\Users\\kisi\\AppData\\Local' },
    files: { 'Cetvel/ajanlar.json': () => snap },
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // this chat runs codex from the shell: a desk from the shell call, as before
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6.1-terra -c model_reasoning_effort=high "Gizli istem metni"', description: 'İnceleme', run_in_background: true })
  await clock.advance(1200)
  expect(await teamRows($)).toHaveLength(1)

  const cx = 'cx-00000000000000a1'
  const cxSub = 'cx-00000000000000a2'
  const ag = 'ag-00000000000000b1'
  const ev = 'ag-00000000000000c1'
  const evSub = 'ag-00000000000000c2'
  const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const first = [
    // the same codex run Cetvel sees: it joins the shell call's desk
    { kimlik: cx, platform: 'codex', ad: 'inceleme', model: 'gpt-6.1-terra', efor: 'high', durum: 'calisiyor', etkinlik: 'okuma', baslama: iso(T + 1000) },
    { kimlik: cxSub, platform: 'codex', ebeveyn: cx, derinlik: 1, ad: 'research', model: 'gpt-6.1-luna', efor: 'medium', durum: 'calisiyor', etkinlik: 'test', baslama: iso(T + 1500) },
    // Antigravity running a Claude model: the Antigravity mascot, the model on its panel
    { kimlik: ag, platform: 'antigravity', ad: 'Tasarım', model: 'claude-sonnet-5-5', durum: 'calisiyor', etkinlik: 'yazma', baslama: iso(T - 600_000) },
    // a second Antigravity agent on an open model, with a subagent of its own
    { kimlik: ev, platform: 'antigravity', ad: 'suru', model: 'glm-5.3', efor: 'high', durum: 'calisiyor', etkinlik: 'web', baslama: iso(T - 300_000) },
    { kimlik: evSub, platform: 'antigravity', ebeveyn: ev, derinlik: 1, ad: 'arastirma', model: 'deepseek-v4.1-flash', durum: 'calisiyor', etkinlik: 'arama', baslama: iso(T - 200_000) },
    // what Cetvel cannot vouch for is dropped: a path for a name (the agent stays, nameless), a raw id, an unknown platform
    { kimlik: 'cx-0000000000000bad', platform: 'codex', ad: 'C:\\Users\\kisi\\gizli', durum: 'calisiyor' },
    { kimlik: 'ham-kimlik', platform: 'codex', ad: 'x', durum: 'calisiyor' },
    { kimlik: 'cx-00000000000000a9', platform: 'baska', ad: 'x', durum: 'calisiyor' },
  ]
  snap = { text: cetvelFile(T + 2000, 1, first), mtimeMs: T + 2000 }
  await clock.advance(3500)
  let rows = await teamRows($)
  // the shell's desk (joined by Cetvel's run), its subagent, two Antigravity agents, a subagent and the nameless one;
  // a raw id and an unknown platform drop
  expect(rows).toHaveLength(6)
  expect(rows.join(' | ')).not.toMatch(/gizli|kisi|ham-kimlik/)
  expect(rows.filter(r => /GPT-6\.1 Terra · yüksek/.test(r))).toHaveLength(1)
  expect(rows.some(r => /GPT-6\.1 Luna · orta/.test(r))).toBe(true)
  expect(rows.some(r => /Sonnet 5\.5 · Antigravity/.test(r))).toBe(true)
  expect(rows.some(r => /glm-5\.3 · yüksek/.test(r))).toBe(true)
  expect(rows.some(r => /deepseek-v4\.1-flash/.test(r))).toBe(true)
  // Cetvel's activities as the office's own: a test run, a written file, a web step
  expect(rows.some(r => /Test koşuyor/.test(r))).toBe(true)
  expect(rows.some(r => /Kod yazıyor/.test(r))).toBe(true)
  expect(rows.some(r => /Webde arıyor/.test(r))).toBe(true)
  // the subagents get their job from their parent's desk
  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /→ Dış Uzman \d · research/ }))?.text).toMatch(/^✈ Dış Uzman → /)
  await term.unmount()
  const desk = await $.ui.mount(DESK)
  const source = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('ch-yesil-')
  expect(source).toContain('ch-mavi-')
  for (const secret of ['Gizli istem', 'gizli', 'ham-kimlik', 'kisi', cx]) expect(source).not.toContain(secret)
  await desk.unmount()

  // the next write: a 429 on the second Antigravity agent's subagent, codex's subagent done, the first Antigravity agent stopped
  const second = first.slice(0, 5).map(a =>
    a.kimlik === evSub ? { ...a, durum: 'hata', hata_turu: '429', son_etkinlik: iso(T + 6000) } : a.kimlik === cxSub ? { ...a, durum: 'bitti', son_etkinlik: iso(T + 6000) } : a.kimlik === ag ? { ...a, durum: 'iptal', son_etkinlik: iso(T + 6000) } : a,
  )
  snap = { text: cetvelFile(T + 6000, 2, second), mtimeMs: T + 6000 }
  await clock.advance(3500)
  rows = await teamRows($)
  expect(rows.some(r => /deepseek-v4\.1-flash.*— Hız sınırı: sırada bekliyorum$/.test(r))).toBe(true)
  expect(rows.some(r => /Sonnet 5\.5 · Antigravity.*— Durduruldu$/.test(r))).toBe(true)
  const fault = await $.ui.mount(DESK)
  // the catalog's 429 plays as the nearest reaction the office has: the queue ticket
  expect(String((await fault.find({ type: 'Svg' }))?.props.source)).toContain('ac-queue-ticket')
  await fault.unmount()

  // Cetvel stops writing (its file goes): its own desks leave; the shell's desk is the shell's
  snap = undefined
  await clock.advance(3500)
  // (the finished ones walk out once their time at the coffee is over)
  await clock.advance(60_000)
  rows = await teamRows($)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatch(/GPT-6\.1 Terra/)
})

test('1.0: with no Cetvel file the shell call path is the whole story, and Cetvel’s fields are read safely', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-agy' }, false, undefined, { env: { LOCALAPPDATA: 'C:/Users/kisi/AppData/Local' }, files: {} })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'agy -p "Gizli istem" --mode plan', description: 'İkinci görüş', run_in_background: true })
  await clock.advance(4000)
  let rows = await teamRows($)
  expect(rows).toHaveLength(1)
  // agy names no model: it is not guessed; the platform says itself
  expect(rows[0]).toMatch(/^■ Dış Uzman\s+model okunuyor · Antigravity/)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await clock.advance(1200)
  rows = await teamRows($)
  expect(rows[0]).toMatch(/model okunuyor · Antigravity · Bitirdi/)

  // the reader keeps only what it can vouch for
  expect(readSnapshot('{yarım')).toBeUndefined()
  expect(readSnapshot(JSON.stringify({ surum: 1, sira: 3, zaman: '2026-11-16T09:00:00Z', ajanlar: 'x' }))).toBeUndefined()
  const snap = readSnapshot(
    JSON.stringify({
      surum: 1,
      sira: 7,
      zaman: '2026-11-16T09:00:00Z',
      ajanlar: [
        { kimlik: 'ag-00000000000000b1', platform: 'antigravity', ad: 'lütfen şu dosyayı okuyup bana özetle', model: '/etc/passwd', efor: 'high', durum: 'calisiyor', etkinlik: 'rm -rf /', hata_turu: 'yeni', son_etkinlik: '2026-11-16T09:00:00Z', derinlik: 0, sayilar: { arac: 2, arac_hatasi: 1 } },
      ],
    }),
  )
  expect(snap?.seq).toBe(7)
  expect(snap?.agents).toHaveLength(1)
  const a = snap?.agents[0]
  expect(a?.name).toBe('')
  expect(a?.model).toBeUndefined()
  expect(a?.activity).toBe('bilinmiyor')
  expect(a?.fault).toBe('bilinmiyor')
  expect(a?.effort).toBe('high')
  // the three platforms map to the three mascots; each fault to the catalog's trigger and the nearest reaction
  expect(Object.entries(CV_VIA).map(([p, via]) => `${p}:${mascotFor({ id: 'cv:x', via, kind: 'external' })}`)).toEqual(['codex:gpt', 'antigravity:agy', 'claude_dis:claude'])
  const react = (f: keyof typeof CV_FAULT) => got(pickActivity({ ...CV_FAULT[f].facts, phase: 'result' }, [], 'tu-1', N9))
  expect(CV_FAULT['429'].code).toBe('hiz-429')
  expect(react('429').ev).toBe('queue-ticket')
  expect(CV_FAULT.izin_reddi.code).toBe('izin-red')
  expect(react('izin_reddi').ev).toBe('shield-guard')
  expect(react('arac_hatasi').ev).toBe('error-sparks')
  // every Cetvel activity is an activity the office has, in Turkish
  for (const [k, look] of Object.entries(CV_LOOK)) expect(`${k} ${typeof look.bubble === 'string' && /^[A-ZÇĞİÖŞÜ]/.test(look.bubble)}`).toBe(`${k} true`)
})

/** A Cetvel that writes in step with the test's clock: `at` is now, `put` writes a snapshot of now, `wait` lets time pass. */
function cetvelClock(clock: { advance: (ms: number) => Promise<unknown> }, T: number, seq: number) {
  const box: { at: number; snap?: { text: string; mtimeMs: number } } = { at: T }

  return {
    box,
    iso: (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    put: (agents: Array<Record<string, unknown>>) => {
      box.snap = { text: cetvelFile(box.at, ++seq, agents), mtimeMs: box.at }
    },
    wait: async (ms: number) => {
      await clock.advance(ms)
      box.at += ms
    },
  }
}

test('1.0.1: a Cetvel agent sits again on a new turn and after Cetvel comes back; old, stalled ones do not sit; codex on an open model is still Codex', async ($, on) => {
  const T = Date.UTC(2026, 10, 17, 9, 0, 0)
  const clock = mock.clock(on, { now: T })
  const cv = cetvelClock(clock, T, 500)
  const { iso, put, wait } = cv
  engine(on, {}, false, undefined, { env: { LOCALAPPDATA: 'C:/Users/kisi/AppData/Local' }, files: { 'Cetvel/ajanlar.json': () => cv.box.snap } })
  const X = (status: string) => ({ kimlik: 'cx-0000000000001a01', platform: 'codex', ad: 'sohbet', model: 'gpt-6.1-terra', durum: status, etkinlik: 'okuma', baslama: iso(T - 30_000), son_etkinlik: iso(cv.box.at) })
  const G = () => ({ kimlik: 'cx-0000000000001a02', platform: 'codex', ad: 'suru', model: 'glm-5.3', efor: 'high', durum: 'calisiyor', etkinlik: 'web', baslama: iso(T - 20_000), son_etkinlik: iso(cv.box.at) })
  const Q = (last: number, act = 'dusunme') => ({ kimlik: 'cx-0000000000001a04', platform: 'codex', ad: 'sessiz', model: 'gpt-6.1-sol', durum: 'calisiyor', etkinlik: act, baslama: iso(last), son_etkinlik: iso(last) })
  // Cetvel keeps two hours: a codex run that stalled and an Antigravity one waiting, both 100 minutes quiet
  const ghosts = [
    { kimlik: 'cx-0000000000001a03', platform: 'codex', ad: 'eski', model: 'gpt-6.1-luna', durum: 'askida', baslama: iso(T - 7_000_000), son_etkinlik: iso(T - 6_000_000) },
    { kimlik: 'ag-0000000000001b01', platform: 'antigravity', ad: 'eski2', durum: 'bekliyor', baslama: iso(T - 7_000_000), son_etkinlik: iso(T - 6_000_000) },
  ]

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  put([X('calisiyor'), G(), ...ghosts])
  await wait(3500)
  let rows = await teamRows($)
  // the two at work sit; the old stalled and waiting ones do not
  expect(rows).toHaveLength(2)
  expect(rows.join(' | ')).not.toMatch(/Yanıt gelmiyor|Seni bekliyor|Luna/)
  // codex on an open model is Codex's: the platform picks the figure, never the model
  const desk = await $.ui.mount(DESK)
  const deskSrc = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(deskSrc).toContain('ch-yesil-')
  expect(deskSrc).not.toContain('ch-mavi-')
  await desk.unmount()

  // the turn ends: done, its desk walks out; Cetvel drops it a minute later
  put([X('bitti'), G(), ...ghosts])
  await wait(3500)
  expect((await teamRows($)).some(r => /GPT-6\.1 Terra.*Bitirdi/.test(r))).toBe(true)
  for (let k = 0; k < 5; k++) {
    await wait(30_000)
    put([G(), ...ghosts])
  }
  await wait(3500)
  rows = await teamRows($)
  expect(rows).toHaveLength(1)
  // three minutes on, the same session takes a new prompt: the same id, at work again, sits at once
  put([X('calisiyor'), G(), ...ghosts])
  await wait(3500)
  rows = await teamRows($)
  expect(rows).toHaveLength(2)
  expect(rows.filter(r => /GPT-6\.1 Terra/.test(r))).toHaveLength(1)

  // the machine sleeps: no write for over 90 s, Cetvel's desks go ('Hat kapandı') and walk out
  const quietAt = cv.box.at
  put([X('calisiyor'), G(), Q(quietAt)])
  await wait(3500)
  expect(await teamRows($)).toHaveLength(3)
  await wait(100_000)
  await wait(20_000)
  expect(await teamRows($)).toHaveLength(0)
  // Cetvel is back: the agents with an event since sit again; one that did nothing since waits for its next event
  put([X('calisiyor'), G(), Q(quietAt)])
  await wait(3500)
  rows = await teamRows($)
  expect(rows).toHaveLength(2)
  expect(rows.join(' | ')).not.toMatch(/Sol/)
  put([X('calisiyor'), G(), Q(cv.box.at, 'yazma')])
  await wait(4500)
  expect(await teamRows($)).toHaveLength(3)
  cv.box.snap = undefined
  await wait(3500)
})

test('1.0.1: a stopped outside run stays out though Cetvel still lists it; a resumed codex run is one desk; a refused TaskStop stops nothing', async ($, on) => {
  const T = Date.UTC(2026, 10, 17, 12, 0, 0)
  const clock = mock.clock(on, { now: T })
  const cv = cetvelClock(clock, T, 900)
  const { iso, put, wait } = cv
  let refuse = false
  let listed: unknown[] = []
  engine(
    on,
    e =>
      e.tool === 'TaskStop'
        ? refuse
          ? { deny: 'reddedildi' }
          : { message: 'durdu', task_id: e.task_id }
        : e.tool === 'Bash'
          ? { stdout: '', stderr: '', interrupted: false, backgroundTaskId: /resume/.test(String(e.command)) ? 'bg-rs' : 'bg-st' }
          : {},
    false,
    () => listed,
    { env: { LOCALAPPDATA: 'C:/Users/kisi/AppData/Local' }, files: { 'Cetvel/ajanlar.json': () => cv.box.snap } },
  )

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // a codex run in the background, which Cetvel sees too: one desk
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6.1-terra "Gizli istem"', description: 'İnceleme', run_in_background: true })
  const started = cv.box.at
  await wait(3000)
  const lastSeen = cv.box.at
  const ST = (status: string, last = lastSeen) => ({ kimlik: 'cx-0000000000002a01', platform: 'codex', ad: 'inceleme', model: 'gpt-6.1-terra', durum: status, etkinlik: 'okuma', baslama: iso(started + 1000), son_etkinlik: iso(last) })
  put([ST('calisiyor')])
  await wait(3500)
  expect(await teamRows($)).toHaveLength(1)

  // stopped from this chat: the desk leaves; the killed process writes no end, so Cetvel still lists it at work
  // (with its last steps before the stop, read late)
  await wait(20_000)
  const stopAt = cv.box.at
  await $.tool.call({ tool: 'TaskStop', task_id: 'bg-st' })
  await wait(1200)
  expect((await teamRows($))[0]).toMatch(/— Durduruldu$/)
  await wait(20_000)
  expect(await teamRows($)).toHaveLength(0)
  put([ST('calisiyor', stopAt - 1000)])
  await wait(4500)
  expect(await teamRows($)).toHaveLength(0)
  put([ST('calisiyor')])
  await wait(3500)
  expect(await teamRows($)).toHaveLength(0)
  // ten minutes on Cetvel calls it stalled: it stays out
  for (let k = 1; k <= 11; k++) {
    await wait(60_000)
    put([ST(k >= 10 ? 'askida' : 'calisiyor', stopAt - 1000)])
  }
  await wait(3500)
  expect(await teamRows($)).toHaveLength(0)

  // codex exec resume: the session began long ago, its new events come with this call: one desk, not two
  await $.tool.call({ tool: 'Bash', command: 'codex exec resume --last "devam"', description: 'Devam', run_in_background: true })
  const R = cv.box.at
  await wait(1200)
  expect(await teamRows($)).toHaveLength(1)
  await wait(2000)
  put([
    ST('askida', stopAt - 1000),
    { kimlik: 'cx-0000000000002a02', platform: 'codex', ad: 'devam', model: 'gpt-6.1-terra', durum: 'calisiyor', etkinlik: 'okuma', baslama: iso(R - 600_000), son_etkinlik: iso(cv.box.at) },
    // another terminal's codex, quiet since before this call: a desk of its own
    { kimlik: 'cx-0000000000002a03', platform: 'codex', ad: 'baska', model: 'gpt-6.1-luna', durum: 'calisiyor', etkinlik: 'dusunme', baslama: iso(R - 1_800_000), son_etkinlik: iso(R - 60_000) },
  ])
  await wait(3500)
  const rows = await teamRows($)
  expect(rows).toHaveLength(2)
  expect(rows.filter(r => /GPT-6\.1 Terra/.test(r))).toHaveLength(1)
  expect(rows.filter(r => /GPT-6\.1 Luna/.test(r))).toHaveLength(1)
  cv.box.snap = undefined
  await wait(3500)
  await wait(30_000)

  // a TaskStop that is refused stopped nothing: the agent goes on at its desk
  await $.agent.spawn({ prompt: 'Kodu incele', description: 'Kodu incele', subagentType: 'general-purpose' } as never)
  listed = [{ id: 'a1', type: 'general-purpose', description: 'Kodu incele', status: 'running' }]
  await wait(2500)
  refuse = true
  await $.tool.call({ tool: 'TaskStop', task_id: 'a1' })
  await wait(10_000)
  const a1 = (await teamRows($)).filter(r => !/GPT/.test(r))
  expect(a1).toHaveLength(1)
  expect(a1[0]).not.toMatch(/Durduruldu|Çıkıyor/)
})

test('1.0.1: a stopped agent that works again and then finishes stays its full time as done; a Cetvel-joined shell desk keeps its time limit once Cetvel lets it go', async ($, on) => {
  const T = Date.UTC(2026, 10, 17, 15, 0, 0)
  const clock = mock.clock(on, { now: T })
  const cv = cetvelClock(clock, T, 1300)
  const { iso, put, wait } = cv
  engine(on, e => (e.tool === 'TaskStop' ? { message: 'durdu', task_id: e.task_id } : e.tool === 'Bash' ? { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-tt' } : {}), false, undefined, {
    env: { LOCALAPPDATA: 'C:/Users/kisi/AppData/Local' },
    files: { 'Cetvel/ajanlar.json': () => cv.box.snap },
  })
  on('classic.SubagentStop', () => ({}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Belgeyi oku', description: 'Belgeyi oku', subagentType: 'general-purpose' } as never)
  await wait(1200)
  await $.tool.call({ tool: 'TaskStop', task_id: 'a1' })
  await wait(1200)
  expect((await teamRows($))[0]).toMatch(/— Durduruldu$/)
  // it calls a tool before it is out: at work again, then it finishes normally
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/a.md', agentId: 'a1' } as never)
  await wait(1200)
  await $.classic.SubagentStop({ agent_id: 'a1', last_assistant_message: 'Bitti' } as never)
  await wait(10_000)
  const row = (await teamRows($))[0]
  // it ends as done, not stopped: its full time at the desk (and the coffee corner counts it)
  expect(row).toMatch(/Bitirdi/)
  expect(row).not.toMatch(/Çıkıyor|Durduruldu/)
  await wait(60_000)
  expect(await teamRows($)).toHaveLength(0)

  // a background codex joined to Cetvel's agent: past the shell's 30 minutes it stays while Cetvel lists it at work,
  // and once Cetvel is gone the time limit holds again
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6.1-terra "x"', description: 'Uzun iş', run_in_background: true })
  const started = cv.box.at
  for (let k = 0; k <= 32; k++) {
    await wait(60_000)
    put([{ kimlik: 'cx-0000000000003a01', platform: 'codex', ad: 'uzun', model: 'gpt-6.1-terra', durum: 'calisiyor', etkinlik: 'komut', baslama: iso(started), son_etkinlik: iso(cv.box.at) }])
  }
  await wait(3500)
  let rows = await teamRows($)
  expect(rows).toHaveLength(1)
  expect(rows[0]).not.toMatch(/Süre doldu/)
  cv.box.snap = undefined
  await wait(10_000)
  rows = await teamRows($)
  expect(rows[0] ?? '').toMatch(/Süre doldu|Çıkıyor/)
})

/**
 * 1.1: the office's workers as the plugin stored them. The test's `$` has no state noun of its own, so a
 * small inline plugin reads the value (any plugin may read any plugin's state) and answers it as the
 * output of a slash command of its own.
 */
const OKUYUCU = {
  name: 'ofis-okuyucu',
  register(on: (event: 'command.run', match: { command: string }, hook: ($: { state: { get: (ref: { plugin: 'piksel-ofis'; key: 'workers' }) => Promise<{ value?: unknown }> } }) => unknown) => unknown) {
    on('command.run', { command: 'ofis-okuyucu' }, async $ => {
      const held = await $.state.get({ plugin: 'piksel-ofis', key: 'workers' })

      return { text: JSON.stringify(held.value ?? null) }
    })
  },
} as never

async function storedWorkers($: { command: { run: (e: never) => Promise<unknown> } }): Promise<Worker[]> {
  const got = ((await ($.command.run as (e: unknown) => Promise<unknown>)({ command: 'ofis-okuyucu', args: '' })) as { text?: string }).text
  const v = JSON.parse(got ?? 'null') as unknown
  // an atom given a shape keeps { shape, value }
  if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { value?: unknown }).value)) return (v as { value: Worker[] }).value

  return Array.isArray(v) ? (v as Worker[]) : []
}

// —— 1.1: hata ve aksilik animasyonları (katalog #1, #2, #4, #8, #9, #11, #12, #18, #19, #27, #29, #31, #34, #41, #42, #50) ——

test('1.1: error classification, cooldown, queue max-2, prio-50 error-sparks, grep exit 1 and #57296 false-positive guard', () => {
  expect(ACTS['error-sparks']?.prio).toBe(50)
  expect(ACTS.iptal?.once).toBe(true)
  expect(ACTS['izin-onay']?.once).toBe(true)
  expect(ACTS['toparlandi']?.once).toBe(true)
  expect(ACTS['baglam-asildi']?.once).toBe(true)
  expect(ACTS['asiri-yuk-durdu']?.once).toBe(true)

  // Kural 11 (#57296): rate_limit maskeli gelse de "prompt is too long" bağlam aşımıdır (#18)
  expect(classifyError({ source: 'StopFailure', code: 'rate_limit', text: 'Prompt is too long for context', fivePct: 99 })?.id).toBe('baglam-asildi')
  // Kural 11: belirsiz kullanım uyarısı %90 altındaysa kota kilidi açmaz
  expect(classifyError({ source: 'StopFailure', code: 'rate_limit', text: 'usage limit approaching', fivePct: 45 })?.id).toBe('queue-ticket')
  expect(classifyError({ source: 'StopFailure', code: 'rate_limit', text: 'usage limit reached', fivePct: 95 })?.id).toBe('kota-oturum')
  expect(classifyError({ source: 'StopFailure', code: 'rate_limit', text: 'weekly quota exhausted', weekPct: 100 })?.id).toBe('kota-haftalik')
  // Grep çıkış 1 (eşleşme yok) hata animasyonu tetiklemez
  expect(classifyError({ source: 'PostToolUseFailure', tool: 'Grep', text: 'Exit code 1: 0 matches found' })).toBeUndefined()
  expect(pickActivity({ tool: 'Bash', phase: 'result', cmd: 'grep needle src/', failed: true, out: 'Exit code 1' }, [], 'tu-g1', N9).ev).toBeUndefined()
  // Kural 8: iptal hata değildir
  expect(classifyError({ source: 'PostToolUseFailure', tool: 'Bash', isInterrupt: true, text: 'Error' })?.id).toBe('iptal')

  // Kural 2: 6 sn cooldown, kuyruk en fazla 2, prio >= 80 döngüde < 60 tek seferlik atlanır
  let st: ActState = { id: 'type-fast', at: N9, seen: N9 }
  st = pushEvWithRules(st, 'error-sparks', N9 + 100)
  expect(st.ev?.id).toBe('error-sparks')
  // Aynı olay cooldown içinde yok sayılır
  const cdSkip = pushEvWithRules({ ...st, ev: undefined }, 'error-sparks', N9 + 2000)
  expect(cdSkip.ev).toBeUndefined()
  // Cooldown geçince (6 sn) yeniden çalar
  const cdOk = pushEvWithRules({ ...st, ev: undefined }, 'error-sparks', N9 + 6200)
  expect(cdOk.ev?.id).toBe('error-sparks')

  // Kuyruk: yüksek olay (confetti-party 85) varken alt olaylar kuyruğa alınır, en çok 2 tutulur
  let qSt: ActState = withEv({ id: 'type-fast', at: N9, seen: N9 }, 'confetti-party', N9 + 100)
  qSt = withEv(qSt, 'baglam-asildi', N9 + 120)
  qSt = withEv(qSt, 'shield-guard', N9 + 140)
  qSt = withEv(qSt, 'error-sparks', N9 + 160)
  expect(qSt.ev?.id).toBe('confetti-party')
  expect((qSt.evQ ?? []).length).toBeLessThanOrEqual(2)
  const afterQ = pruneAct(qSt, (qSt.ev?.until ?? N9) + 1).state
  expect(afterQ.ev?.id).toBe('baglam-asildi')

  // Prio >= 80 döngü (#27 izin-bekle prio 85) etkinken prio 50 kıvılcım atlanır
  const locked = applyLoop({ id: 'type-fast', at: N9, seen: N9 }, { id: 'izin-bekle', at: N9 }, N9)
  expect(pushEvWithRules(locked, 'error-sparks', N9 + 500).ev).toBeUndefined()
})

test('1.1: conflict suppression, #34 error storm, #41 4-mascot wheel & lowAt sleepy escalation', () => {
  // Bastırma kuralları: #12 ağ > #8/#9/#11; #2 haftalık > #1 oturum; #4 giriş > hepsi
  let st = applyLoop(undefined, { id: 'queue-ticket', at: N9 }, N9)
  st = applyLoop(st, { id: 'zaman-asimi', at: N9 + 50 }, N9 + 50)
  st = applyLoop(st, { id: 'ag-kopuk', at: N9 + 100 }, N9 + 100)
  expect(activeLoop(st, N9 + 150)?.id).toBe('ag-kopuk')
  // #12 varken yeni #8 bastırılır
  st = applyLoop(st, { id: 'queue-ticket', at: N9 + 200 }, N9 + 200)
  expect(activeLoop(st, N9 + 250)?.id).toBe('ag-kopuk')

  // #2 haftalık > #1 oturum; #4 giriş > #2
  let kSt = applyLoop(undefined, { id: 'kota-oturum', at: N9, global: true }, N9)
  kSt = applyLoop(kSt, { id: 'kota-haftalik', at: N9 + 10, global: true }, N9 + 10)
  expect(activeLoop(kSt, N9 + 20)?.id).toBe('kota-haftalik')
  kSt = applyLoop(kSt, { id: 'giris-gerek', at: N9 + 30, global: true }, N9 + 30)
  expect(activeLoop(kSt, N9 + 40)?.id).toBe('giris-gerek')

  // #34 hata fırtınası ve ardışık 3 hata; #41 sonsuz-döngü > #34; çözülünce #50 toparlanma
  expect(hasConsecutiveFails([{ t: N9, f: 1 }, { t: N9 + 1, f: 1 }, { t: N9 + 2, f: 1 }], 3)).toBe(true)
  expect(hasConsecutiveFails([{ t: N9, f: 1 }, { t: N9 + 1, s: 'ok' }, { t: N9 + 2, f: 1 }], 3)).toBe(false)
  let eSt = pushEvWithRules({ id: 'type-fast', at: N9, seen: N9 }, 'error-sparks', N9 + 10, { storm: true })
  expect(activeLoop(eSt, N9 + 20)?.id).toBe('hata-serisi')
  const v34 = actView(worker9({ act: eSt }), ctx9({ now: N9 + 20 }))
  expect(v34.main?.id).toBe('hata-serisi')
  expect(v34.over?.id).toBe('overheat-sweat')

  // #41 sonsuz döngü #34'ü bastırır ve 3 karakterin çark şeridini üretir
  const wheelSt = applyLoop(eSt, { id: 'sonsuz-dongu', at: N9 + 30 }, N9 + 30)
  expect(activeLoop(wheelSt, N9 + 40)?.id).toBe('sonsuz-dongu')
  for (const kind of ['turuncu', 'yesil', 'mavi'] as const) {
    const v = actView(worker9({ act: wheelSt }), ctx9({ now: N9 + 40, kind }))
    expect(v.main?.id).toBe('sonsuz-dongu')
    expect(v.extra?.[0]?.id).toBe('sonsuz-dongu_on')
    expect(stripFor('sonsuz-dongu', kind)).toBe(`sonsuz-dongu_${kind}`)
  }
  const recovered = clearLoops(wheelSt, ['sonsuz-dongu'], N9 + 1000, true)
  expect(recovered.closed.some(l => l.id === 'sonsuz-dongu')).toBe(true)
  expect(recovered.state.ev?.id).toBe('toparlandi')

  // #27 izin-bekle 30 dk (lowAt) sonra düşük enerji uyku pozuna (nap-zzz) geçer
  const waitSt = applyLoop(undefined, { id: 'izin-bekle', at: N9 }, N9)
  expect(actView(worker9({ activity: 'waiting', act: waitSt }), ctx9({ now: N9 + 60_000 })).main?.id).toBe('izin-bekle')
  expect(actView(worker9({ activity: 'waiting', act: waitSt }), ctx9({ now: N9 + 1_805_000 })).main?.id).toBe('nap-zzz')

  // #9 aşırı yük döngüsü TTL sonunda "durdu" tek seferliğine düşer; elle sıkıştırma hızı *0.7 düşürür
  const overSt = applyLoop(undefined, { id: 'asiri-yuk-529', at: N9 }, N9)
  const afterOver = pruneAct(overSt, N9 + 65_000).state
  expect(activeLoop(afterOver, N9 + 65_000)).toBeUndefined()
  expect(afterOver.ev?.id).toBe('asiri-yuk-durdu')
  const compSt = applyLoop(undefined, { id: 'sikistirma', at: N9, mode: 'manual' }, N9)
  expect(actView(worker9({ act: compSt }), ctx9({ now: N9 + 100 })).speed).toBeLessThan(1)
})

test('1.1: live TEK return-to-previous (#31), grep exit 1 silence, #27/#29 approval lifecycle and neutral #42 cancel', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  let failNext = false
  let grepEmpty = false
  engine(on, e => {
    if (e.tool === 'Grep' && grepEmpty) return { isError: true, text: 'Exit code 1' }
    if (failNext) return { isError: true, result: 'failed' }
    return {}
  })
  for (const k of ['PermissionRequest', 'PermissionDenied', 'PostToolUseFailure'] as const) (on as unknown as (event: string, hook: () => unknown) => void)(`classic.${k}`, () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Kodla', description: 'Kodla', subagentType: 'general-purpose' } as never)
  // 2 Edit çağrısı → main 'type-fast' yerleşir
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proje/a.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proje/b.ts', old_string: 'c', new_string: 'd', agentId: 'a1' })
  await clock.advance(1200)

  const readAct = async (id: string) => (await storedWorkers($)).find(w => w.id === id)?.act

  // #31 genel araç hatası: TEK kıvılcım oynar, main ('type-fast') korunur, sonra eski etkinliğe döner
  failNext = true
  await $.tool.call({ tool: 'Bash', command: 'node C:/gizli/script.js', agentId: 'a1' })
  await clock.advance(1200)
  const duringSpark = await readAct('a1')
  expect(duringSpark?.ev?.id).toBe('error-sparks')
  expect(duringSpark?.id).toBe('type-fast')
  await clock.advance(7000)
  const ui = await $.ui.mount(DESK)
  const svgAfter = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svgAfter).not.toContain('C:/gizli/script.js')
  expect(svgAfter).toContain('ac-type-fast')
  await ui.unmount()

  // Grep exit 1 hata kıvılcımı üretmez (cooldown da geçmişken)
  grepEmpty = true
  const grepAt = clock.now()
  await $.tool.call({ tool: 'Grep', pattern: 'missing', agentId: 'a1' })
  await clock.advance(1200)
  // (the spark that played before stays in the record, spent: no new one starts for the empty grep)
  const afterGrep = (await readAct('a1'))?.ev
  expect(afterGrep?.id === 'error-sparks' && afterGrep.at >= grepAt).toBe(false)

  // #27 izin bekle + #29 izin reddi (shield-guard) + #27 onaylandı (izin-onay)
  failNext = false
  grepEmpty = false
  await classic.PermissionRequest?.({ hook_event_name: 'PermissionRequest', agent_id: 'a1', tool_name: 'Bash', tool_input: {} })
  await clock.advance(1200)
  expect(activeLoop(await readAct('a1'), clock.now())?.id).toBe('izin-bekle')
  await classic.PermissionDenied?.({ hook_event_name: 'PermissionDenied', agent_id: 'a1', tool_name: 'Bash', tool_use_id: 'tu-den1', tool_input: {}, reason: 'secret rule' })
  await clock.advance(1200)
  const afterDen = await readAct('a1')
  expect(activeLoop(afterDen, clock.now())).toBeUndefined()
  expect(afterDen?.ev?.id).toBe('shield-guard')

  // Yeni izin bekle → kullanıcı onaylayınca tool.call başlangıcında izin-onay çalar
  await classic.PermissionRequest?.({ hook_event_name: 'PermissionRequest', agent_id: 'a1', tool_name: 'Bash', tool_input: {} })
  await clock.advance(1200)
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proje/c.ts', old_string: 'e', new_string: 'f', agentId: 'a1' })
  await clock.advance(1200)
  expect((await readAct('a1'))?.ev?.id).toBe('izin-onay')

  // #42 iptal: StopFailure değil turn abort/PostToolUseFailure(is_interrupt) nötr durdurur ve açık döngüleri kapatır
  await classic.PostToolUseFailure?.({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_use_id: 'tu-int', tool_input: {}, error: 'Interrupted by user', is_interrupt: true })
  await clock.advance(1200)
  expect((await readAct('a1'))?.ev?.id).toBe('iptal')
})

test('1.1: global locks (#1, #2, #4, #12), Rule 7 boss-only bubble, #41 5-repeat wheel, #18/#19/#50, motion=false & privacy', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  for (const k of ['StopFailure', 'PreCompact', 'PostCompact', 'Notification'] as const) (on as unknown as (event: string, hook: () => unknown) => void)(`classic.${k}`, () => ({}))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.step', async function* () {
    return { turnId: 't-ctx', index: 0, answer: '', toolUses: [], stopReason: 'model_context_window_exceeded', usage: null }
  })
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'İncele', description: 'İncele', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)

  // #41 sonsuz döngü: aynı araç + aynı girdi arka arkaya 5 kez → hamster çarkı; farklı çağrı → #50 toparlanma
  for (let i = 0; i < 5; i++) {
    await $.tool.call({ tool: 'Bash', command: 'npm test -- --secret-arg', agentId: 'a1' })
  }
  await clock.advance(1200)
  const wLoop = (await storedWorkers($)).find(w => w.id === 'a1')
  expect(activeLoop(wLoop?.act, clock.now())?.id).toBe('sonsuz-dongu')
  const desk = await $.ui.mount(DESK)
  const srcWheel = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(srcWheel).toContain('ac-sonsuz-dongu_turuncu')
  expect(srcWheel).toContain('ac-sonsuz-dongu_on')
  expect(srcWheel).not.toContain('--secret-arg')
  await $.tool.call({ tool: 'Edit', file_path: 'C:/proje/fix.ts', old_string: 'g', new_string: 'h', agentId: 'a1' })
  await clock.advance(1200)
  expect((await storedWorkers($)).find(w => w.id === 'a1')?.act?.ev?.id).toBe('toparlandi')

  // #12 ağ bağlantısı koptu (#9 üzerine gelirse #12 bastırır)
  await classic.StopFailure?.({ hook_event_name: 'StopFailure', error: 'server_error', error_details: 'ECONNRESET tcp socket dropped C:/Users/secret' })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())?.id).toBe('ag-kopuk')
  // the picture is held steady and news is painted within 3.5 s (1.0): wait for that frame
  await clock.advance(2600)
  const srcNet = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(srcNet).toContain('Bağlantı koptu')
  expect(srcNet).not.toContain('C:/Users/secret')
  await classic.StopFailure?.({ hook_event_name: 'StopFailure', error: 'overloaded', error_details: '529 overloaded' })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())?.id).toBe('ag-kopuk')

  // #1 oturum kotası + #2 haftalık kota (Rule 7: yalnızca patron balonu; #2 çözülünce #50)
  await $.session.measure({ context: { window: 1_000_000, tokens: 700_000, percent: 70 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date((clock.now()) + 3_600_000).toISOString() }], changed: ['rateLimits'] })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())?.id).toBe('kota-oturum')
  await $.session.measure({ context: { window: 1_000_000, tokens: 700_000, percent: 70 }, rateLimits: [{ kind: 'seven_day', percentUsed: 100 }], changed: ['rateLimits'] })
  await clock.advance(1200)
  // the picture is held steady and news is painted within 3.5 s (1.0): wait for that frame
  await clock.advance(2600)
  const srcWeek = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(globalLoopOf(await storedWorkers($), clock.now())?.id).toBe('kota-haftalik')
  expect(srcWeek).toContain('Haftalık kota doldu')
  expect(srcWeek).toContain('BİTTİ')
  // Limit düşünce kilit çözülür
  await $.session.measure({ context: { window: 1_000_000, tokens: 700_000, percent: 70 }, rateLimits: [{ kind: 'five_hour', percentUsed: 20 }, { kind: 'seven_day', percentUsed: 30 }], changed: ['rateLimits'] })
  await clock.advance(1200)
  expect((await storedWorkers($)).find(w => w.id === 'boss')?.act?.loops?.some(l => l.id === 'kota-oturum' || l.id === 'kota-haftalik')).toBe(false)
  // Alttaki ağ döngüsü saklanmıştı; API'nin başarılı Stop sinyali onu da kapatır.
  await classic.Stop?.({ hook_event_name: 'Stop', stop_hook_active: false })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())).toBeUndefined()

  // #4 giriş gerekli (auth_storage_failure) → auth_success toparlar
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'auth_storage_failure', message: 'secret_oauth_token_123' })
  await clock.advance(1200)
  // the picture is held steady and news is painted within 3.5 s (1.0): wait for that frame
  await clock.advance(2600)
  const srcAuth = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(srcAuth).toContain('Giriş gerekli')
  expect(srcAuth).not.toContain('secret_oauth_token_123')
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'auth_success', message: 'ok' })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())).toBeUndefined()

  // #18 bağlam aşıldı (turn.step) → #19 PreCompact → #50 PostCompact
  const stepCall = ($ as unknown as { turn: { step: (e: Record<string, unknown>) => AsyncIterable<unknown> | Promise<unknown> } }).turn.step({ turnId: 't-ctx', index: 0, model: 'claude-opus-5-5', messages: [] })
  if (stepCall && Symbol.asyncIterator in (stepCall as object)) for await (const _ of stepCall as AsyncIterable<unknown>) void _
  else await stepCall
  await clock.advance(1200)
  expect(activeLoop((await storedWorkers($)).find(w => w.id === 'boss')?.act, clock.now())?.id).toBe('baglam-asildi')
  await classic.PreCompact?.({ hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null })
  await clock.advance(1200)
  expect(activeLoop((await storedWorkers($)).find(w => w.id === 'boss')?.act, clock.now())?.id).toBe('sikistirma')
  await classic.PostCompact?.({ hook_event_name: 'PostCompact', trigger: 'auto', compact_summary: 'done' })
  await clock.advance(1200)
  expect(activeLoop((await storedWorkers($)).find(w => w.id === 'boss')?.act, clock.now())).toBeUndefined()

  // motion: false (prefers-reduced-motion / hareket kapalı) statik ve SVG bütçesi altında çizilir
  const stillScene = sceneSvg({ workers: await storedWorkers($), usage: { ctxPct: 96, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 100 }], at: clock.now(), history: [96] }, turn: { active: false, steps: 0, turns: 1 }, now: clock.now(), motion: false })
  expect(stillScene.svg).toContain('class="still"')
  expect(stillScene.svg.length).toBeLessThan(131_072)
  await desk.unmount()
})

test('1.1: Cetvel 6 fault kinds and all-4-mascot hamster wheel SVG budget check', () => {
  // Cetvel 6 hata türü doğru sınıflandırılır
  const expected: Array<[keyof typeof CV_FAULT, string]> = [
    ['429', 'queue-ticket'],
    ['zaman_asimi', 'zaman-asimi'],
    ['izin_reddi', 'shield-guard'],
    ['arac_hatasi', 'error-sparks'],
    ['baglam_asimi', 'baglam-asildi'],
    ['ag', 'ag-kopuk'],
  ]
  for (const [k, actId] of expected) {
    const cls = classifyError({ source: 'Cetvel', code: k, text: CV_FAULT[k].facts.out })
    expect(cls?.id).toBe(actId)
  }

  // 3 karakter (#41 hamster çarkı + ekstra hatalar) tek sahnede bütçe sınırını aşmaz
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'running', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9, joinedAt: N9 - 60_000, model: 'claude-opus-5-5', act: applyLoop(undefined, { id: 'sonsuz-dongu', at: N9 }, N9) },
    worker9({ id: 'w-cx', n: 0, seat: 0, model: 'gpt-6.1-terra', via: 'gpt', act: applyLoop(undefined, { id: 'sonsuz-dongu', at: N9 }, N9) }),
    worker9({ id: 'w-ag', n: 1, seat: 1, model: 'gemini-4-argon-high', via: 'agy', act: applyLoop(undefined, { id: 'sonsuz-dongu', at: N9 }, N9) }),
    worker9({ id: 'w-cx2', n: 2, seat: 2, model: 'glm-5.3', via: 'gpt', act: applyLoop(undefined, { id: 'sonsuz-dongu', at: N9 }, N9) }),
    worker9({ id: 'w-net', n: 3, seat: 3, model: 'claude-sonnet-5-5', act: applyLoop(undefined, { id: 'ag-kopuk', at: N9 }, N9) }),
  ]
  const out = sceneSvg({ workers, usage: { ctxPct: 92, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 85 }], at: N9, history: [92] }, turn: { active: true, steps: 2, turns: 1 }, now: N9, motion: true })
  expect(out.svg.length).toBeLessThan(131_072)
  expect(out.svg).toContain('ac-sonsuz-dongu_turuncu')
  expect(out.svg).toContain('ac-sonsuz-dongu_yesil')
  expect(out.svg).toContain('ac-sonsuz-dongu_mavi')
  expect(out.svg).toContain('ac-sonsuz-dongu_on')
})

// —— 1.1 düzeltmeleri: yanlış-pozitifler (araç çıktısı API arızası değildir), dar grep muafiyeti, #34 sayımı,
// patronun aynalanmış izin beklemesi, #41 yoklama koruması, Codex ailesinin çarkı ve piksel şeritler ——

test('1.1 fix: tool output is never a login lock, a 429/529, a timeout or a network outage; a broken test keeps its flask; the grep exemption is narrow', () => {
  // #4 and #8/#9/#11/#12/#18 read text only from an API source: the same words in a tool's output are a plain tool error
  const noisy = [
    'HTTP/1.1 401 Unauthorized',
    'please run /login to continue',
    "src/app.ts:429:12 - error TS2304: Cannot find name 'x'.",
    'src/b.ts:529:3 - error TS1005',
    "Property 'timeout' does not exist on type 'Opts'",
    'rate limiter test failed',
    'connect ECONNREFUSED 127.0.0.1:5432',
    'Request timed out after 5s',
    'Prompt is too long',
  ]
  for (const text of noisy) {
    for (const source of ['PostToolUseFailure', 'ToolCall'] as const) {
      const cls = classifyError({ source, tool: 'Bash', cmd: 'npm run check', text })
      expect(cls?.id).toBe('error-sparks')
      expect(cls?.global).toBeUndefined()
    }
  }
  // from the API the same patterns still mean what they say
  expect(classifyError({ source: 'StopFailure', text: 'Please run /login' })?.id).toBe('giris-gerek')
  expect(classifyError({ source: 'StopFailure', code: 'server_error', text: 'Request timed out' })?.id).toBe('zaman-asimi')
  expect(classifyError({ source: 'StopFailure', code: 'server_error', text: 'connect ECONNREFUSED' })?.id).toBe('ag-kopuk')
  expect(classifyError({ source: 'Notification', code: 'auth_error', text: 'OAuth token expired' })?.id).toBe('giris-gerek')
  // 1.0 order: a test run that times out is a broken test (the flask), not an API timeout
  const jest = pickActivity({ tool: 'Bash', phase: 'result', cmd: 'npx jest', failed: true, out: 'Exceeded timeout of 5000 ms for a test' }, [], 'tu-j', N9)
  expect(jest.main).toBe('test-tube_fail')
  expect(jest.ev).toBeUndefined()
  for (const out of ['connect ECONNREFUSED 127.0.0.1:5432', "Property 'timeout' does not exist"]) {
    expect(pickActivity({ tool: 'Bash', phase: 'result', cmd: 'node seed.js', failed: true, out }, [], 'tu-n', N9).ev).toBe('error-sparks')
  }

  // #33: only an empty search is silent — the last process is the search tool and nothing but its exit 1 came back
  const g = (cmd: string, text: string) => classifyError({ source: 'PostToolUseFailure', tool: 'Bash', cmd, text })?.id
  expect(g('npm test 2>&1 | grep -v noise', 'Exit code 1\nFAIL src/a.test.ts\n expected 1 got 2')).toBe('test-kirik')
  expect(g('git commit -m "fix grep bug"', 'Exit code 1')).toBe('error-sparks')
  // (a failed build whose last stage is a search is a broken build of 1.2, #36: never silent)
  expect(g('cargo build && rg foo', 'Exit code 1\nerror: build failed')).toBe('derleme-hata')
  expect(g('grep -r x .', 'Exit code 2\ngrep: y: No such file or directory')).toBe('error-sparks')
  expect(g('rg needle src', 'Exit code 1')).toBeUndefined()
  expect(g('cat log.txt | grep -i "ERROR"', 'Exit code 1')).toBeUndefined()
  expect(classifyError({ source: 'PostToolUseFailure', tool: 'Grep', text: 'Exit code 1: 0 matches found' })).toBeUndefined()

  // #34: a call's mark between two failures does not break the streak; a result that is not a failure does
  expect(hasConsecutiveFails([{ t: 1, id: 'code-read' }, { t: 2, f: 1 }, { t: 3, id: 'code-read' }, { t: 4, f: 1, id: 'test-tube' }, { t: 5, id: 'type-fast' }, { t: 6, f: 1 }], 3)).toBe(true)
  expect(hasConsecutiveFails([{ t: 2, f: 1 }, { t: 3, s: 'ok' }, { t: 4, f: 1 }, { t: 5, id: 'type-fast' }, { t: 6, f: 1 }], 3)).toBe(false)

  // #41: each figure runs its own colored wheel; the wheels are pixel PNG like every strip
  for (const kind of ['turuncu', 'yesil', 'mavi'] as const) expect(stripFor('sonsuz-dongu', kind)).toBe(`sonsuz-dongu_${kind}`)
  for (const key of ['sonsuz-dongu_turuncu', 'sonsuz-dongu_yesil', 'sonsuz-dongu_mavi']) {
    expect(ACT_STRIPS[key]?.b64?.startsWith('iVBORw0KGgo')).toBe(true)
    expect(ACT_STRIPS[key]?.svg).toBeUndefined()
  }
})

test('1.1 fix: live — no lock from a 401 curl, #34 counts each failure once, an approved agent ends the boss mirrored wait, polling is no loop', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  let fail: string | undefined
  engine(on, () => (fail !== undefined ? { isError: true, text: fail } : {}))
  for (const k of ['PermissionRequest', 'PostToolUseFailure', 'StopFailure', 'Notification'] as const) (on as unknown as (event: string, hook: () => unknown) => void)(`classic.${k}`, () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const call = (input: Record<string, unknown>) => $.tool.call(input as never)
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)
  const loopOf = async (id: string) => activeLoop((await one(id))?.act, clock.now())?.id

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Kodla', description: 'Kodla', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)

  // a 401 in a curl's output and a compiler's line 429 are tool errors: no office lock, no queue
  fail = 'HTTP/1.1 401 Unauthorized'
  await call({ tool: 'Bash', command: 'curl -f https://api.example.com/me', agentId: 'a1' })
  await clock.advance(1200)
  fail = "src/app.ts:429:12 - error TS2304: Cannot find name 'x'."
  await call({ tool: 'Bash', command: 'npx tsc', agentId: 'a1' })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())).toBeUndefined()
  expect(await loopOf('a1')).toBeUndefined()
  // (the compiler's failure is the broken build of 1.2, #36: known by its command, never by its text)
  expect((await one('a1'))?.fault).toBe('derleme-hata')

  // a login failure an agent's turn reports locks the office through the boss alone, and auth_success opens it
  await classic.StopFailure?.({ hook_event_name: 'StopFailure', agent_id: 'a1', error: 'authentication_failed', error_details: 'secret-token-1' })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())?.id).toBe('giris-gerek')
  expect((await one('a1'))?.act?.loops?.some(l => l.id === 'giris-gerek') ?? false).toBe(false)
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'auth_success', message: 'ok' })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())).toBeUndefined()

  // #34 through tool.call alone: the call marks between failures do not hide them; a success resets the count
  fail = undefined
  await call({ tool: 'Edit', file_path: 'C:/proje/a.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  await clock.advance(1200)
  fail = 'Error: boom'
  for (const [i, f] of ['a.js', 'b.js', 'c.js'].entries()) {
    await call({ tool: 'Bash', command: `node ${f}`, agentId: 'a1' })
    await clock.advance(1200)
    expect(await loopOf('a1')).toBe(i < 2 ? undefined : 'hata-serisi')
  }
  fail = undefined
  await call({ tool: 'Edit', file_path: 'C:/proje/b.ts', old_string: 'c', new_string: 'd', agentId: 'a1' })
  await clock.advance(1200)
  expect(await loopOf('a1')).toBeUndefined()

  // PostToolUseFailure before the call's own result: one failure, one mark, one count
  fail = 'Error: boom'
  const okAt = clock.now()
  for (const [i, tu] of ['tu-p1', 'tu-p2', 'tu-p3'].entries()) {
    await classic.PostToolUseFailure?.({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_use_id: tu, tool_input: { command: `node p${i}.js` }, error: 'Error: boom' })
    await call({ tool: 'Bash', tool_use_id: tu, command: `node p${i}.js`, agentId: 'a1' })
    await clock.advance(1200)
    const w = await one('a1')
    expect((w?.trail ?? []).filter(m => m.f === 1 && m.t >= okAt)).toHaveLength(i + 1)
    expect(activeLoop(w?.act, clock.now())?.id).toBe(i < 2 ? undefined : 'hata-serisi')
  }

  // a broken test shows its flask, no sparks (1.0 rule 6)
  fail = undefined
  await call({ tool: 'Edit', file_path: 'C:/proje/c.ts', old_string: 'e', new_string: 'f', agentId: 'a1' })
  await clock.advance(8000)
  fail = 'FAIL src/a.test.ts\n expected 1 got 2'
  const testAt = clock.now()
  await call({ tool: 'Bash', command: 'npm test', agentId: 'a1' })
  await clock.advance(1200)
  const broken = (await one('a1'))?.act
  expect(broken?.ev?.id).toBe('test-kirik')
  expect(broken?.id).not.toBe('test-tube_fail')
  expect(broken?.ev?.id === 'error-sparks' && broken.ev.at >= testAt).toBe(false)

  // #27: the boss mirrors an agent's prompt (Notification names no agent); the agent's approval ends both waits
  fail = undefined
  await classic.PermissionRequest?.({ hook_event_name: 'PermissionRequest', agent_id: 'a1', tool_name: 'Bash', tool_input: {} })
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' })
  await clock.advance(1200)
  expect(await loopOf('boss')).toBe('izin-bekle')
  await call({ tool: 'Edit', file_path: 'C:/proje/d.ts', old_string: 'g', new_string: 'h', agentId: 'a1' })
  await clock.advance(1200)
  expect(await loopOf('a1')).toBeUndefined()
  expect(await loopOf('boss')).toBeUndefined()
  // the boss's own ask waits for the boss's own answer, whatever an agent does meanwhile
  await classic.PermissionRequest?.({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} })
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' })
  await classic.PermissionRequest?.({ hook_event_name: 'PermissionRequest', agent_id: 'a1', tool_name: 'Bash', tool_input: {} })
  await clock.advance(1200)
  await call({ tool: 'Edit', file_path: 'C:/proje/e.ts', old_string: 'i', new_string: 'j', agentId: 'a1' })
  await clock.advance(1200)
  expect(await loopOf('boss')).toBe('izin-bekle')
  await call({ tool: 'Bash', command: 'ls' })
  await clock.advance(1200)
  expect(await loopOf('boss')).toBeUndefined()

  // #41: waiting on the same background task or sleeping again and again is not a loop; the same real call is
  for (let i = 0; i < 6; i++) await call({ tool: 'TaskOutput', task_id: 'bg-1', block: true, agentId: 'a1' })
  for (let i = 0; i < 6; i++) await call({ tool: 'Bash', command: 'sleep 30', agentId: 'a1' })
  await clock.advance(1200)
  expect(await loopOf('a1')).toBeUndefined()
  for (let i = 0; i < 5; i++) await call({ tool: 'Bash', command: 'npm run build', agentId: 'a1' })
  await clock.advance(1200)
  expect(await loopOf('a1')).toBe('sonsuz-dongu')

  // nothing raw reached the stored office
  const stored = JSON.stringify(await storedWorkers($))
  expect(stored).not.toContain('secret-token-1')
  expect(stored).not.toContain('api.example.com')
})

// —— 1.2: üç kat iç içe alt ajan (Claude ve Cetvel kaynaklı) ——

const KONUSMA = {
  name: 'ofis-konusma',
  register(on: (event: 'command.run', match: { command: string }, hook: ($: { state: { get: (ref: { plugin: 'piksel-ofis'; key: 'talks' }) => Promise<{ value?: unknown }> } }) => unknown) => unknown) {
    on('command.run', { command: 'ofis-konusma' }, async $ => {
      const held = await $.state.get({ plugin: 'piksel-ofis', key: 'talks' })

      return { text: JSON.stringify(held.value ?? null) }
    })
  },
} as never

async function storedTalks($: { command: { run: (e: never) => Promise<unknown> } }): Promise<Talk[]> {
  const got = ((await ($.command.run as (e: unknown) => Promise<unknown>)({ command: 'ofis-konusma', args: '' })) as { text?: string }).text
  const v = JSON.parse(got ?? 'null') as unknown
  if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { value?: unknown }).value)) return (v as { value: Talk[] }).value

  return Array.isArray(v) ? (v as Talk[]) : []
}

const said = (talks: readonly Talk[], kind: Talk['kind'], from: string, to: string): boolean => talks.some(t => t.kind === kind && t.from === from && t.to === to)

test('1.2: three levels of Claude subagents: each sits under the one that started it, reports climb the chain, a stop at the top takes only its live branch', { plugins: [OKUYUCU, KONUSMA] }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on, e => (e.tool === 'TaskStop' ? { message: 'durdu', task_id: e.task_id } : {}), true)
  on('classic.SubagentStop', () => ({}))
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Projeyi incele', description: 'Projeyi incele', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  await $.agent.spawn({ prompt: 'Testleri tara', description: 'Testleri tara', subagentType: 'general-purpose', parentAgentId: 'a1' } as never)
  await clock.advance(1200)
  // the third level's first tool call lands before its spawn (the live screen's order): the spawn still puts it under its parent
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/log.txt', agentId: 'a3' })
  await $.agent.spawn({ prompt: 'Logları oku', description: 'Logları oku', subagentType: 'Explore', parentAgentId: 'a2' } as never)
  await clock.advance(1200)

  let ws = await storedWorkers($)
  expect(ws.filter(w => w.id !== 'boss')).toHaveLength(3)
  expect(ws.find(w => w.id === 'a1')?.parentId).toBe('boss')
  expect(ws.find(w => w.id === 'a2')?.parentId).toBe('a1')
  expect(ws.find(w => w.id === 'a3')?.parentId).toBe('a2')
  // two deputies, numbered; the order each calls out names the desk by its title now (not the one it had when hired)
  const a1 = ws.find(w => w.id === 'a1') as Worker
  const a2 = ws.find(w => w.id === 'a2') as Worker
  expect(a1.name).toBe('Yedek Patron')
  expect(a2.name).toBe('Yedek Patron 2')
  expect(a1.bubble.startsWith('Yedek Patron 2, ')).toBe(true)
  let talks = await storedTalks($)
  expect(said(talks, 'order', 'boss', 'a1') && said(talks, 'order', 'a1', 'a2') && said(talks, 'order', 'a2', 'a3')).toBe(true)
  const term = await $.ui.mount(TERM)
  const lines = (await term.findAll({ type: 'Text', text: /^✈ / })).map(r => r.text ?? '')
  expect(lines).toContain('✈ Patron → Yedek Patron · Projeyi incele')
  expect(lines).toContain('✈ Yedek Patron → Yedek Patron 2 · Testleri tara')
  expect(lines.some(l => /^✈ Yedek Patron 2 → \S+ · Logları oku$/.test(l))).toBe(true)
  await term.unmount()
  const desk = await $.ui.mount(DESK)
  expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('3/3')
  await desk.unmount()

  // the deepest one finishes: its report goes to its own parent, which takes the baton
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a3', agent_transcript_path: '', agent_type: 'Explore', last_assistant_message: 'Loglar temiz.' } as never)
  await clock.advance(1200)
  talks = await storedTalks($)
  expect(said(talks, 'report', 'a3', 'a2')).toBe(true)
  expect((await one('a2'))?.act?.ev?.id).toBe('handoff-baton')
  expect((await one('a3'))?.activity).toBe('done')
  // then the middle one: to the top deputy
  await clock.advance(3000)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a2', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'Testler tamam.' } as never)
  await clock.advance(1200)
  talks = await storedTalks($)
  expect(said(talks, 'report', 'a2', 'a1')).toBe(true)
  expect((await one('a1'))?.act?.ev?.id).toBe('handoff-baton')

  // the top deputy starts another; a stop of the top deputy takes it and its live child, not the finished ones
  await $.agent.spawn({ prompt: 'Raporu yaz', description: 'Raporu yaz', subagentType: 'general-purpose', parentAgentId: 'a1' } as never)
  await clock.advance(1200)
  expect((await one('a4'))?.parentId).toBe('a1')
  await $.tool.call({ tool: 'TaskStop', task_id: 'a1' })
  await clock.advance(1200)
  ws = await storedWorkers($)
  for (const id of ['a1', 'a4']) {
    const w = ws.find(x => x.id === id)
    expect(w?.stopped).toBe(1)
    expect(w?.bubble).toBe('Durduruldu')
    expect(w?.act?.ev?.id === 'error-sparks').toBe(false)
  }
  for (const id of ['a2', 'a3']) expect(ws.find(x => x.id === id)?.stopped).toBeUndefined()
})

test('1.2: three levels from Cetvel: a Claude agent’s codex and its subagents nest under it, an Antigravity team nests on its own, a stopped branch comes back top-down', { plugins: [OKUYUCU, KONUSMA] }, async ($, on) => {
  const T = Date.UTC(2026, 10, 18, 9, 0, 0)
  const clock = mock.clock(on, { now: T })
  const cv = cetvelClock(clock, T, 4000)
  const { iso, put, wait } = cv
  let listed: unknown[] = []
  engine(on, e => (e.tool === 'TaskStop' ? { message: 'durdu', task_id: e.task_id } : e.tool === 'Bash' ? { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-ic' } : {}), true, () => listed, {
    env: { LOCALAPPDATA: 'C:/Users/kisi/AppData/Local' },
    files: { 'Cetvel/ajanlar.json': () => cv.box.snap },
  })
  const desks = async () => (await storedWorkers($)).filter(w => w.id !== 'boss')
  const byCv = (ws: readonly Worker[], k: string) => ws.find(w => w.cv === k && w.activity !== 'leaving')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Kodu incele', description: 'Kodu incele', subagentType: 'general-purpose' } as never)
  listed = [{ id: 'a1', type: 'general-purpose', description: 'Kodu incele', status: 'running' }]
  await wait(1200)
  // the Claude agent runs codex from its shell; Cetvel sees that codex, its subagent and the subagent's own
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6.1-terra "Gizli istem"', description: 'Codex incelemesi', run_in_background: true, agentId: 'a1' })
  const started = cv.box.at
  await wait(1500)
  const CX = 'cx-0000000000004a01'
  const CX1 = 'cx-0000000000004a02'
  const CX2 = 'cx-0000000000004a03'
  const AG = 'ag-0000000000004c01'
  const AG1 = 'ag-0000000000004c02'
  const AG2 = 'ag-0000000000004c03'
  const at = (k: string, extra: Record<string, unknown> = {}) => {
    const base: Record<string, Record<string, unknown>> = {
      [CX]: { platform: 'codex', ad: 'inceleme', model: 'gpt-6.1-terra', etkinlik: 'okuma', baslama: iso(started + 1000) },
      [CX1]: { platform: 'codex', ebeveyn: CX, derinlik: 1, ad: 'alt', model: 'gpt-6.1-luna', etkinlik: 'okuma', baslama: iso(started + 1500) },
      [CX2]: { platform: 'codex', ebeveyn: CX1, derinlik: 2, ad: 'torun', model: 'gpt-6.1-sol', etkinlik: 'test', baslama: iso(started + 1800) },
      [AG]: { platform: 'antigravity', ad: 'suru', model: 'glm-5.3', etkinlik: 'web', baslama: iso(T - 100_000) },
      [AG1]: { platform: 'antigravity', ebeveyn: AG, derinlik: 1, ad: 'arastirma', model: 'deepseek-v4.1-flash', etkinlik: 'arama', baslama: iso(T - 90_000) },
      [AG2]: { platform: 'antigravity', ebeveyn: AG1, derinlik: 2, ad: 'ozet', model: 'glm-5.3', etkinlik: 'yazma', baslama: iso(T - 80_000) },
    }

    return { kimlik: k, durum: 'calisiyor', son_etkinlik: iso(cv.box.at), ...base[k], ...extra }
  }
  // the file lists the deepest first: parents still sit first
  put([at(AG2), at(CX2), at(AG1), at(CX1), at(AG), at(CX)])
  await wait(4500)

  let ws = await desks()
  expect(ws).toHaveLength(7)
  const shell = byCv(ws, CX) as Worker
  expect(shell.id.startsWith('ext:')).toBe(true)
  expect(shell.parentId).toBe('a1')
  expect(byCv(ws, CX1)?.parentId).toBe(shell.id)
  expect(byCv(ws, CX2)?.parentId).toBe(byCv(ws, CX1)?.id)
  expect(byCv(ws, AG)?.parentId).toBe('boss')
  expect(byCv(ws, AG1)?.parentId).toBe(byCv(ws, AG)?.id)
  expect(byCv(ws, AG2)?.parentId).toBe(byCv(ws, AG1)?.id)
  let talks = await storedTalks($)
  for (const [p, c] of [[CX, CX1], [CX1, CX2], [AG, AG1], [AG1, AG2]] as const) expect(said(talks, 'order', byCv(ws, p)?.id as string, byCv(ws, c)?.id as string)).toBe(true)
  const desk = await $.ui.mount(DESK)
  const source = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('7/7')
  expect(source).toContain('ch-yesil-')
  expect(source).toContain('ch-mavi-')
  for (const secret of ['Gizli istem', 'kisi', CX, AG2]) expect(source).not.toContain(secret)
  await desk.unmount()

  // the deepest codex finishes: its report goes to its parent's desk
  put([at(AG2), at(CX2, { durum: 'bitti' }), at(AG1), at(CX1), at(AG), at(CX)])
  await wait(3500)
  talks = await storedTalks($)
  ws = await desks()
  expect(said(talks, 'report', byCv(ws, CX2)?.id as string, byCv(ws, CX1)?.id as string)).toBe(true)
  expect(byCv(ws, CX2)?.activity).toBe('done')

  // the Claude agent is stopped: its codex desk and the live subagent stop with it, neutral; the Antigravity team works on
  await $.tool.call({ tool: 'TaskStop', task_id: 'a1' })
  await wait(1200)
  ws = await desks()
  for (const k of [CX, CX1]) {
    expect(byCv(ws, k)?.stopped).toBe(1)
    expect(byCv(ws, k)?.bubble).toBe('Durduruldu')
  }
  expect(ws.find(w => w.id === 'a1')?.stopped).toBe(1)
  expect(byCv(ws, CX2)?.stopped).toBeUndefined()
  for (const k of [AG, AG1, AG2]) expect(byCv(ws, k)?.endedAt).toBeUndefined()
  // Cetvel writes the stopped codex's subagent on again: while the desk above it is the stopped one, it stays stopped
  put([at(AG2), at(CX2, { durum: 'bitti' }), at(AG1), at(CX1, { etkinlik: 'yazma' }), at(AG), at(CX)])
  await wait(3500)
  ws = await desks()
  expect(byCv(ws, CX1)?.stopped).toBe(1)
  expect(byCv(ws, CX1)?.bubble).toBe('Durduruldu')
  for (const k of [AG, AG1, AG2]) expect(byCv(ws, k)?.endedAt).toBeUndefined()
})

test('1.2: a Cetvel subagent seen before its parent sits under the boss, and moves under its parent once the parent sits down', { plugins: [OKUYUCU, KONUSMA] }, async ($, on) => {
  const T = Date.UTC(2026, 10, 18, 11, 0, 0)
  const clock = mock.clock(on, { now: T })
  const cv = cetvelClock(clock, T, 5000)
  const { iso, put, wait } = cv
  engine(on, {}, true, undefined, { env: { LOCALAPPDATA: 'C:/Users/kisi/AppData/Local' }, files: { 'Cetvel/ajanlar.json': () => cv.box.snap } })
  const AG = 'ag-0000000000005b01'
  const AG1 = 'ag-0000000000005b02'
  const AG2 = 'ag-0000000000005b03'
  const desks = async () => (await storedWorkers($)).filter(w => w.id !== 'boss')
  const byCv = (ws: readonly Worker[], k: string) => ws.find(w => w.cv === k && w.activity !== 'leaving')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await wait(1000)
  // the top agent has been quiet for a quarter of an hour (no desk), its subagent and grandchild are at work
  const quiet = iso(T - 15 * 60_000)
  const row = (k: string, extra: Record<string, unknown>) => ({ kimlik: k, platform: 'antigravity', model: 'gemini-3.8-flash-high', durum: 'calisiyor', etkinlik: 'okuma', baslama: iso(T - 20 * 60_000), son_etkinlik: iso(cv.box.at), ...extra })
  put([row(AG, { ad: 'tasarim', son_etkinlik: quiet }), row(AG1, { ebeveyn: AG, derinlik: 1, ad: 'alt' }), row(AG2, { ebeveyn: AG1, derinlik: 2, ad: 'torun' })])
  await wait(4500)
  let ws = await desks()
  expect(ws).toHaveLength(2)
  expect(byCv(ws, AG1)?.parentId).toBe('boss')
  expect(byCv(ws, AG2)?.parentId).toBe(byCv(ws, AG1)?.id)
  // the top agent speaks again: it sits, and its branch is under it
  put([row(AG, { ad: 'tasarim' }), row(AG1, { ebeveyn: AG, derinlik: 1, ad: 'alt' }), row(AG2, { ebeveyn: AG1, derinlik: 2, ad: 'torun' })])
  await wait(3500)
  ws = await desks()
  expect(ws).toHaveLength(3)
  expect(byCv(ws, AG)?.parentId).toBe('boss')
  expect(byCv(ws, AG1)?.parentId).toBe(byCv(ws, AG)?.id)
  expect(byCv(ws, AG2)?.parentId).toBe(byCv(ws, AG1)?.id)
})

// —— 1.2: hata kataloğu ikinci dilim (#3, #10, #16, #20, #28, #36, #40, #44, #45) ve tek seferlik/döngü tutarlılığı ——

const SLICE2 = ['soru-bekle', 'sunucu-500', 'derleme-hata', 'komut-zaman-asimi', 'alt-ajan-yok', 'alt-ajan-dustu', 'kredi-bitti', 'cok-buyuk-413', 'cikti-siniri'] as const

test('1.2: the second slice is read from its own signal: hook codes and API text, a shell call’s time and command, never a tool’s output', () => {
  const c = (inp: Parameters<typeof classifyError>[0]) => classifyError(inp)
  // #10 500: the code or the API's own words; 529, the network and a timeout stay the more specific ones
  expect(c({ source: 'StopFailure', code: 'server_error', text: '' })).toMatchObject({ id: 'sunucu-500', kind: 'ev', prio: 62 })
  expect(c({ source: 'StopFailure', code: 'unknown', text: 'API Error: 500 Internal server error' })?.id).toBe('sunucu-500')
  expect(c({ source: 'StopFailure', code: 'server_error', text: 'Repeated 529 Overloaded' })?.id).toBe('asiri-yuk-529')
  expect(c({ source: 'StopFailure', code: 'server_error', text: 'Request timed out' })?.id).toBe('zaman-asimi')
  // #3 billing: a global lock above the queues, under a login (#4 98 > #3 94)
  expect(c({ source: 'StopFailure', code: 'billing_error', text: '' })).toMatchObject({ id: 'kredi-bitti', kind: 'loop', prio: 94, global: true })
  expect(c({ source: 'StopFailure', code: 'unknown', text: 'Credit balance is too low' })?.id).toBe('kredi-bitti')
  // #16 413 and #18: the specific beats the general invalid request; #18 is one short loop on every path
  expect(c({ source: 'StopFailure', code: 'invalid_request', text: 'Request too large (max 32MB)' })).toMatchObject({ id: 'cok-buyuk-413', kind: 'ev', prio: 52 })
  expect(c({ source: 'StopFailure', code: 'invalid_request', text: 'Image was too large' })?.id).toBe('cok-buyuk-413')
  expect(c({ source: 'StopFailure', code: 'invalid_request', text: 'Prompt is too long' })).toMatchObject({ id: 'baglam-asildi', kind: 'loop' })
  // #20: the exact code
  expect(c({ source: 'StopFailure', code: 'max_output_tokens', text: '' })).toMatchObject({ id: 'cikti-siniri', kind: 'ev', prio: 48 })
  // #28: the notification's own type (an approval stays #27); words in a message do not ask
  for (const nt of ['idle_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog']) expect(c({ source: 'Notification', code: nt })).toMatchObject({ id: 'soru-bekle', kind: 'loop', prio: 83 })
  expect(c({ source: 'Notification', code: 'permission_prompt' })?.id).toBe('izin-bekle')
  expect(c({ source: 'Notification', code: 'other', text: 'Claude needs your input: idle_prompt elicitation' })).toBeUndefined()
  // #40: a shell call that ran to its own limit (its time, not its text); #36: a build command that failed
  expect(c({ source: 'PostToolUseFailure', tool: 'Bash', cmd: 'npm run e2e', text: 'boom', timedOut: true })).toMatchObject({ id: 'komut-zaman-asimi', kind: 'ev', prio: 57 })
  expect(c({ source: 'PostToolUseFailure', tool: 'Read', text: 'boom', timedOut: true })?.id).toBe('error-sparks')
  expect(c({ source: 'ToolCall', tool: 'Bash', cmd: 'cargo build --release', text: 'boom', timedOut: true })?.id).toBe('komut-zaman-asimi')
  for (const cmd of ['cargo build', 'npx tsc --noEmit', 'npm run build', 'pnpm typecheck', 'dotnet build', 'go vet ./...', 'make -j8']) {
    expect(c({ source: 'PostToolUseFailure', tool: 'Bash', cmd, text: 'x' })).toMatchObject({ id: 'derleme-hata', kind: 'ev', prio: 53 })
  }
  // a test run keeps its flask (1.0 rule 6); a build's output that names a 429, a timeout or a login is still the broken build
  expect(c({ source: 'PostToolUseFailure', tool: 'Bash', cmd: 'cargo test', text: 'x' })?.id).toBe('test-kirik')
  for (const text of ['src/a.ts:429:3 error', 'Request timed out', 'Please run /login', 'Credit balance is too low', 'Request too large', 'API Error: 500']) {
    expect(c({ source: 'ToolCall', tool: 'Bash', cmd: 'npm run build', text })?.id).toBe('derleme-hata')
    expect(c({ source: 'PostToolUseFailure', tool: 'Bash', cmd: 'node seed.js', text })?.id).toBe('error-sparks')
  }
  // a command that only mentions a build word is no build: an echo, a grep, a commit message
  for (const cmd of ['echo "cargo build failed"', 'git commit -m "fix npm run build"', "rg 'tsc' src"]) expect(c({ source: 'PostToolUseFailure', tool: 'Bash', cmd, text: 'x' })?.id).toBe('error-sparks')

  // conflicts: an approval (85) over a question (83); a billing lock hides the queues; a weekly lock (97) over billing (94)
  let st = applyLoop(undefined, { id: 'soru-bekle', at: N9 }, N9)
  st = applyLoop(st, { id: 'izin-bekle', at: N9 + 10 }, N9 + 10)
  expect(activeLoop(st, N9 + 20)?.id).toBe('izin-bekle')
  st = clearLoops(st, ['izin-bekle'], N9 + 30).state
  expect(activeLoop(st, N9 + 40)?.id).toBe('soru-bekle')
  let lock = applyLoop(undefined, { id: 'queue-ticket', at: N9 }, N9)
  lock = applyLoop(lock, { id: 'kredi-bitti', at: N9 + 1, global: true }, N9 + 1)
  expect(lock.loops?.map(l => l.id)).toEqual(['queue-ticket', 'kredi-bitti'])
  expect(activeLoop(lock, N9 + 1)?.id).toBe('kredi-bitti')
  expect(activeLoop(applyLoop(lock, { id: 'kota-haftalik', at: N9 + 2 }, N9 + 2), N9 + 3)?.id).toBe('kota-haftalik')
  // waits have no end of their own (30 min on they doze); the one-offs have the catalog's length
  for (const id of ['soru-bekle', 'kredi-bitti', 'alt-ajan-yok']) {
    expect(isWaitLoop(id)).toBe(true)
    const w = applyLoop(undefined, { id, at: N9 }, N9).loops?.[0]
    expect(w?.until).toBeUndefined()
    expect(w?.lowAt).toBe(N9 + 1_800_000)
  }
  expect([evDuration('sunucu-500'), evDuration('derleme-hata'), evDuration('komut-zaman-asimi'), evDuration('alt-ajan-dustu'), evDuration('cok-buyuk-413'), evDuration('cikti-siniri'), evDuration('baglam-asildi')]).toEqual([2000, 2000, 2000, 2200, 2200, 2500, 2500])
})

test('1.2: the second slice’s strips are pixel PNGs in the office’s size, every entry has a short Turkish label, and no one-off loops on', () => {
  for (const id of SLICE2) {
    const e = ACTS[id]
    expect(e).toBeDefined()
    const label = ACT_LABEL[id] ?? ''
    expect(label.length > 0 && label.length <= 16).toBe(true)
    const s = ACT_STRIPS[e?.strip.def ?? '']
    expect(s?.b64?.startsWith('iVBORw0KGgo')).toBe(true)
    expect(s?.svg).toBeUndefined()
    expect((s?.fw ?? 99) <= 40 && (s?.fh ?? 99) <= 40 && (s?.n ?? 0) >= 4).toBe(true)
  }
  // #44 looks through the periscope the office already has
  expect(ACTS['alt-ajan-yok']?.strip.def).toBe('periscope')
  // TEK: the strip plays once and the body stops; DÖNGÜ: it runs while the state lasts
  for (const e of Object.values(ACTS)) {
    if (e.once) expect(e.body?.count === 'infinite').toBe(false)
    // a one-off that is drawn as a loop stays short (the exit walk never becomes a loop)
    if (e.once && LOOP_ACTS.has(e.id)) expect(evDuration(e.id)).toBeLessThanOrEqual(10_000)
    // an olay that is not a one-off plays as a loop (no loop is left without its loop path)
    if (e.cls === 'olay' && !e.once && e.role === 'ana') expect(LOOP_ACTS.has(e.id)).toBe(true)
  }
  for (const id of ['sunucu-500', 'derleme-hata', 'komut-zaman-asimi', 'alt-ajan-dustu', 'cok-buyuk-413', 'cikti-siniri']) {
    expect(ACTS[id]?.once).toBe(true)
    expect(LOOP_ACTS.has(id)).toBe(false)
  }
  for (const id of ['soru-bekle', 'kredi-bitti', 'alt-ajan-yok']) {
    expect(ACTS[id]?.once).toBe(false)
    expect(LOOP_ACTS.has(id)).toBe(true)
  }
  // a borrowed body motion brings its keyframes along (the quota sleeper used to stand still)
  const st = applyLoop(undefined, { id: 'kota-oturum', at: N9, global: true }, N9)
  const boss: Worker = { id: 'boss', n: -1, name: 'Patron', role: 'Patron', task: '', color: '#D97757', seat: -1, activity: 'idle', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9, joinedAt: N9 - 60_000, model: 'claude-opus-5-5', act: st }
  const usage = { ctxPct: 40, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 100 }], at: N9, history: [40] }
  const out = sceneSvg({ workers: [boss, worker9({ id: 'w1', n: 0, seat: 0, model: 'claude-sonnet-5-5' })], usage, turn: { active: false, steps: 0, turns: 1 }, now: N9, motion: true })
  expect(out.svg).toContain('@keyframes acb-nap-zzz')
  expect(out.svg.length).toBeLessThan(131_072)
  // #44's periscope plays its own ping-pong frames under its own name
  const look = sceneSvg({ workers: [{ ...boss, act: undefined }, worker9({ id: 'w1', n: 0, seat: 0, model: 'claude-sonnet-5-5', act: applyLoop(undefined, { id: 'alt-ajan-yok', at: N9 }, N9) })], usage: { ...usage, limits: [{ kind: 'five_hour', pct: 10 }] }, turn: { active: false, steps: 0, turns: 1 }, now: N9, motion: true })
  expect(look.svg).toContain('ac-periscope')
  expect(look.svg).toContain('@keyframes acf-alt-ajan-yok')
  expect(look.svg).toContain('@keyframes acb-alt-ajan-yok')
})

test('1.2: live — a question waits until the next prompt, billing locks the office until an answer, a 500, a cut-off answer and a too-big request play once', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  for (const k of ['StopFailure', 'Notification', 'PermissionRequest'] as const) (on as unknown as (event: string, hook: () => unknown) => void)(`classic.${k}`, () => ({}))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: (e as { turnId?: string }).turnId ?? 't-q' }) as never)
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const boss = async () => (await storedWorkers($)).find(w => w.id === 'boss')
  // the pane is looked at when there is news (its frame is held a moment, then painted)
  const svgNow = async () => {
    const desk = await $.ui.mount(DESK)
    await clock.advance(3600)
    const src = String((await desk.find({ type: 'Svg' }))?.props.source)
    await desk.unmount()
    return src
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // #28: an idle prompt; the boss waits with its question mark; the next prompt answers it
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })
  await clock.advance(1200)
  expect(activeLoop((await boss())?.act, clock.now())?.id).toBe('soru-bekle')
  let src = await svgNow()
  expect(src).toContain('ac-soru-bekle')
  expect(src).toContain('Cevabını bekliyorum')
  // an approval asked meanwhile is the louder one, and its words stay
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'x' })
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog', message: 'x' })
  await clock.advance(1200)
  expect(activeLoop((await boss())?.act, clock.now())?.id).toBe('izin-bekle')
  expect((await boss())?.bubble).toBe('Onayını bekliyorum!')
  await $.turn.start({ turnId: 't-q', text: 'devam' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/a.ts' })
  await clock.advance(1200)
  expect((await boss())?.act?.loops?.some(l => l.id === 'soru-bekle' || l.id === 'izin-bekle') ?? false).toBe(false)

  // #3: billing locks the whole office through the boss; every desk shows the empty piggy bank; an answer opens it
  await $.agent.spawn({ prompt: 'Kodla', description: 'Kodla', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  await classic.StopFailure?.({ hook_event_name: 'StopFailure', error: 'billing_error', error_details: 'Credit balance is too low secret-acct-77' })
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())?.id).toBe('kredi-bitti')
  src = await svgNow()
  expect(src).toContain('ac-kredi-bitti')
  expect(src).toContain('Kasa boş')
  expect(src).not.toContain('secret-acct-77')
  await $.turn.complete({ turnId: 't-q', answer: 'tamam', reason: 'answer', isAborted: false, durationMs: 1000 } as never)
  await clock.advance(1200)
  expect(globalLoopOf(await storedWorkers($), clock.now())).toBeUndefined()
  expect((await boss())?.act?.ev?.id).toBe('toparlandi')

  // #10, #20, #16 on the boss: each plays once and is gone
  for (const [error, details, id] of [
    ['server_error', 'API Error: 500 secret-500', 'sunucu-500'],
    ['max_output_tokens', '', 'cikti-siniri'],
    ['invalid_request', 'Request too large secret-413', 'cok-buyuk-413'],
  ] as const) {
    await clock.advance(9000)
    await classic.StopFailure?.({ hook_event_name: 'StopFailure', error, error_details: details })
    await clock.advance(1000)
    const b = await boss()
    expect(b?.act?.ev?.id).toBe(id)
    expect(b?.fault).toBe(id)
    expect(activeLoop(b?.act, clock.now())).toBeUndefined()
    await clock.advance(3000)
    expect(pruneAct((await boss())?.act, clock.now()).state.ev?.id === id).toBe(false)
  }
  const stored = JSON.stringify(await storedWorkers($))
  for (const secret of ['secret-500', 'secret-413', 'secret-acct-77']) expect(stored).not.toContain(secret)
})

test('1.2: live — a subagent whose turn ends in an API error drops with a puff, tells its parent, and a later stop does not make it a success', { plugins: [OKUYUCU, KONUSMA] }, async ($, on) => {
  const clock = mock.clock(on)
  let listed: unknown[] = []
  engine(on, {}, true, () => listed)
  for (const k of ['StopFailure', 'SubagentStop'] as const) (on as unknown as (event: string, hook: () => unknown) => void)(`classic.${k}`, () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // #45: a1 → its own a2; a2's turn ends in a 500: the mishap, then the puff; a2 is down (failed) and a1 hears it
  await $.agent.spawn({ prompt: 'İncele', description: 'İncele', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: 'Alt iş', description: 'Alt iş', subagentType: 'general-purpose', parentAgentId: 'a1' } as never)
  listed = [{ id: 'a1', type: 'general-purpose', description: 'İncele', status: 'running' }, { id: 'a2', type: 'general-purpose', description: 'Alt iş', status: 'running' }]
  await clock.advance(1200)
  await classic.StopFailure?.({ hook_event_name: 'StopFailure', agent_id: 'a2', error: 'server_error', error_details: 'API Error: 500 secret-sub' })
  await clock.advance(1000)
  let a2 = await one('a2')
  expect(a2?.activity).toBe('failed')
  expect(a2?.endedAt).toBeDefined()
  expect(a2?.fault).toBe('alt-ajan-dustu')
  expect(a2?.bubble).toBe('Hatayla düştüm')
  expect(a2?.act?.ev?.id).toBe('sunucu-500')
  expect(a2?.act?.evQ?.map(x => x.id)).toContain('alt-ajan-dustu')
  expect(globalLoopOf(await storedWorkers($), clock.now())).toBeUndefined()
  expect((await storedTalks($)).some(t => t.kind === 'report' && t.from === 'a2' && t.to === 'a1' && t.text === 'Hatayla düştüm')).toBe(true)
  await clock.advance(2400)
  a2 = await one('a2')
  expect(pruneAct(a2?.act, clock.now()).state.ev?.id).toBe('alt-ajan-dustu')
  // its later SubagentStop does not make it a success
  await classic.SubagentStop?.({ hook_event_name: 'SubagentStop', stop_hook_active: false, agent_id: 'a2', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'API Error: 500' })
  await clock.advance(1200)
  expect((await one('a2'))?.activity).toBe('failed')
  expect(JSON.stringify(await storedWorkers($))).not.toContain('secret-sub')
})

test('1.2: live — a quiet subagent is looked for through the periscope until every quiet one speaks or ends', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  let listed: unknown[] = []
  engine(on, {}, true, () => listed)
  on('classic.SubagentStop', () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)
  const loopOf = async (id: string) => activeLoop((await one(id))?.act, clock.now())?.id

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Birinci', description: 'Birinci', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: 'İkinci', description: 'İkinci', subagentType: 'general-purpose' } as never)
  listed = [{ id: 'a1', type: 'general-purpose', description: 'Birinci', status: 'running' }, { id: 'a2', type: 'general-purpose', description: 'İkinci', status: 'running' }]
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/a.ts', agentId: 'a1' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/b.ts', agentId: 'a2' })
  // #44: no sign for two minutes is not yet a worry; past three the boss looks for them
  await clock.advance(2 * 60_000)
  expect(await loopOf('boss')).toBeUndefined()
  await clock.advance(70_000)
  expect(await loopOf('boss')).toBe('alt-ajan-yok')
  expect((await one('boss'))?.bubble).toBe('Alt ajandan ses yok…')
  const desk = await $.ui.mount(DESK)
  await clock.advance(3600)
  const src = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(src).toContain('ac-periscope')
  expect(src).toContain('acf-alt-ajan-yok')
  await desk.unmount()
  // one speaks: the other is still quiet, the look goes on; the other ends: the look ends (no celebration of its own)
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/c.ts', agentId: 'a1' })
  await clock.advance(4500)
  expect(await loopOf('boss')).toBe('alt-ajan-yok')
  await classic.SubagentStop?.({ hook_event_name: 'SubagentStop', stop_hook_active: false, agent_id: 'a2', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'Bitti' })
  await clock.advance(4500)
  expect(await loopOf('boss')).toBeUndefined()
  expect((await one('boss'))?.act?.ev?.id === 'toparlandi').toBe(false)
})

test('1.2: live — a failed build shows its broken monitor, a shell call that ran to its own limit the hourglass, a fast failure neither', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('classic.PostToolUseFailure', () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Derle', description: 'Derle', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  // #36: known by the command (cargo build), never by its output
  await classic.PostToolUseFailure?.({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_use_id: 'tu-b1', tool_input: { command: 'cargo build' }, error: 'error[E0425]: secret-build' })
  await clock.advance(1000)
  expect((await one('a1'))?.act?.ev?.id).toBe('derleme-hata')
  expect((await one('a1'))?.fault).toBe('derleme-hata')
  await clock.advance(9000)
  // #40: the hook's duration reached the call's own timeout
  await classic.PostToolUseFailure?.({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_use_id: 'tu-b2', tool_input: { command: 'npm run e2e', timeout: 60_000 }, error: 'x', duration_ms: 60_100 })
  await clock.advance(1000)
  expect((await one('a1'))?.act?.ev?.id).toBe('komut-zaman-asimi')
  expect((await one('a1'))?.fault).toBe('komut-zaman-asimi')
  await clock.advance(9000)
  // the same command failing fast is a plain tool error (the third failure in a row: #34's series, not the hourglass)
  await classic.PostToolUseFailure?.({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_use_id: 'tu-b3', tool_input: { command: 'npm run e2e', timeout: 60_000 }, error: 'x', duration_ms: 3000 })
  await clock.advance(1000)
  const a1 = await one('a1')
  expect(a1?.fault).toBe('arac-hata')
  expect(activeLoop(a1?.act, clock.now())?.id).toBe('hata-serisi')
  expect(JSON.stringify(await storedWorkers($))).not.toContain('secret-build')
})

test('1.2 fix: a build is known by the stage that ran last (and only its own followers after it), each shell by its own quoting', () => {
  const c = (cmd: string, tool = 'Bash') => classifyError({ source: 'PostToolUseFailure', tool, cmd, text: 'x' })?.id
  // the app after a good build failed: whose failure it is cannot be told, so it is no broken build
  expect(c('cargo build && ./target/debug/app --kotu-arguman')).toBe('error-sparks')
  expect(c('npm run build && npm run lint')).toBe('error-sparks')
  // a file named after a tool is no tool
  expect(c('cat src/tsc.json')).toBe('error-sparks')
  expect(c('Get-Content makefile.txt', 'PowerShell')).toBe('error-sparks')
  // the build is the last real stage: a cd before it, a filter or a search after it
  expect(c('cd proje && cargo build')).toBe('derleme-hata')
  expect(c('cargo build 2>&1 | tail -n 20')).toBe('derleme-hata')
  expect(c('npx tsc --noEmit | Select-Object -First 30', 'PowerShell')).toBe('derleme-hata')
  expect(c('& C:/araclar/claude.exe plugin validate .', 'PowerShell')).toBe('derleme-hata')
  expect(c('./gradlew build')).toBe('derleme-hata')
  // PowerShell: a backslash is no escape ("C:\dir\" ends there); the build after it is seen
  expect(c('Write-Host "C:\\dir\\"; cargo build; Write-Host "bitti"', 'PowerShell')).toBe('derleme-hata')
  // a test run keeps its flask, wherever it is in the chain
  expect(c('cargo build && cargo test')).toBe('test-kirik')
})

test('1.2 fix: live — a run of broken builds climbs to #34 like any tool error', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('classic.PostToolUseFailure', () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Derle', description: 'Derle', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  for (const [i, tu] of ['tu-d1', 'tu-d2', 'tu-d3', 'tu-d4'].entries()) {
    await classic.PostToolUseFailure?.({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_use_id: tu, tool_input: { command: 'cargo build' }, error: 'error[E0425]' })
    await clock.advance(1500)
    const w = await one('a1')
    expect(activeLoop(w?.act, clock.now())?.id).toBe(i < 2 ? undefined : 'hata-serisi')
    if (i < 2) expect(w?.act?.ev?.id).toBe('derleme-hata')
  }
})

test('1.2 fix: live — #40 needs the whole limit: a small timeout is no excuse, a near miss of the default is a plain failure', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  on('classic.PostToolUseFailure', () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)
  const fail = async (tu: string, input: Record<string, unknown>, extra: Record<string, unknown>) => {
    await clock.advance(9000)
    await classic.PostToolUseFailure?.({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_use_id: tu, tool_input: input, error: 'x', ...extra })
    await clock.advance(1200)
    return (await one('a1'))?.fault
  }
  // a success between failures keeps #34 out of the way
  const ok = async () => {
    await $.tool.call({ tool: 'Read', file_path: 'C:/proje/a.ts', agentId: 'a1' })
    await clock.advance(1200)
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Kontrol', description: 'Kontrol', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  // timeout 2000, refused after 900 ms: no hourglass (the old 1500 ms margin made it one)
  expect(await fail('tu-t1', { command: 'curl http://localhost:9/x', timeout: 2000 }, { duration_ms: 900 })).toBe('arac-hata')
  await ok()
  // the same call that did run its 2 s: the hourglass
  expect(await fail('tu-t2', { command: 'curl http://localhost:9/x', timeout: 2000 }, { duration_ms: 2010 })).toBe('komut-zaman-asimi')
  await ok()
  // the default 120 s, a real failure at 119 s: a plain failure
  expect(await fail('tu-t3', { command: 'npm run e2e' }, { duration_ms: 119_000 })).toBe('arac-hata')
  await ok()
  // a limit under a second cannot be told from a fast failure
  expect(await fail('tu-t4', { command: 'sleep 5', timeout: 500 }, { duration_ms: 600 })).toBe('arac-hata')
})

test('1.2 fix: live — #40 without the hook duration: the call own start says it, and the call result does not count it again', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  // the shell call runs its whole 60 s; the failure hook (no duration_ms) arrives before the call returns
  engine(on, async ev => {
    if (ev.tool !== 'Bash') return {}
    await clock.advance(60_050)
    await classic.PostToolUseFailure?.({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_use_id: ev.tool_use_id, tool_input: { command: ev.command, timeout: ev.timeout }, error: 'x' })
    return { isError: true, text: 'x' }
  })
  on('classic.PostToolUseFailure', () => ({}))
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Uzun', description: 'Uzun', subagentType: 'general-purpose' } as never)
  await clock.advance(1200)
  const at = clock.now()
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu-n1', command: 'npm run e2e', timeout: 60_000, agentId: 'a1' } as never)
  await clock.advance(1200)
  const w = await one('a1')
  expect(w?.fault).toBe('komut-zaman-asimi')
  expect((w?.trail ?? []).filter(m => m.f === 1 && m.t >= at)).toHaveLength(1)
})

test('1.2 fix: live — #44 a parent whose helper works is not quiet; the helper silence is what its parent looks for', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  let listed: unknown[] = []
  engine(on, {}, true, () => listed)
  const one = async (id: string) => (await storedWorkers($)).find(w => w.id === id)
  const loopOf = async (id: string) => activeLoop((await one(id))?.act, clock.now())?.id

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // boss → a1 → a2: a1 hands its job to a2 and says nothing more; a2 works for twelve minutes
  await $.agent.spawn({ prompt: 'Üst iş', description: 'Üst iş', subagentType: 'general-purpose' } as never)
  await $.agent.spawn({ prompt: 'Alt iş', description: 'Alt iş', subagentType: 'general-purpose', parentAgentId: 'a1' } as never)
  listed = [
    { id: 'a1', type: 'general-purpose', description: 'Üst iş', status: 'running' },
    { id: 'a2', type: 'general-purpose', description: 'Alt iş', status: 'running', parentId: 'a1' },
  ]
  await clock.advance(1200)
  for (let i = 0; i < 12; i++) {
    await $.tool.call({ tool: 'Read', file_path: `C:/proje/${i}.ts`, agentId: 'a2' })
    await clock.advance(60_000)
    expect(await loopOf('boss')).toBeUndefined()
    expect(await loopOf('a1')).toBeUndefined()
  }
  // a2 goes quiet: its parent a1 looks for it, not the boss
  await clock.advance(4 * 60_000)
  expect(await loopOf('a1')).toBe('alt-ajan-yok')
  expect(await loopOf('boss')).toBeUndefined()
})

// Her yeni/eksik K/T senaryosu: gerçek sinyal sınıflandırması, bant ve önceki işe dönüş.
const KALAN_SINYALLER: Array<[number, string, number, ErrorSignalInput]> = [
  [5, 'hesap-kilit', 97, { source: 'StopFailure', code: 'account_on_hold' }],
  [6, 'kota-devam', 90, { source: 'Notification', code: 'quota_auto_resume_fired' }],
  [7, 'kota-devam-yok', 55, { source: 'Notification', code: 'quota_auto_resume_disabled' }],
  [11, 'zaman-asimi', 72, { source: 'StopFailure', code: 'unknown', text: 'Stream idle timeout' }],
  [13, 'akis-yarim', 45, { source: 'StopFailure', text: 'Connection lost mid-response' }],
  [14, 'sertifika', 50, { source: 'StopFailure', text: 'SSL certificate verification failed' }],
  [21, 'model-reddi', 58, { source: 'StopFailure', code: 'invalid_request', text: 'Output blocked by content filtering' }],
  [22, 'model-yok', 56, { source: 'StopFailure', code: 'model_not_found' }],
  [23, 'gecersiz-istek', 54, { source: 'StopFailure', code: 'invalid_request' }],
  [25, 'arac-cozulemedi', 46, { source: 'StopFailure', text: "The model's tool call could not be parsed (retry also failed)" }],
  [29, 'shield-guard', 60, { source: 'PermissionDenied' }],
  [30, 'kural-engeli', 47, { source: 'PostToolUseFailure', hookBlocked: true, tool: 'Read' }],
  [32, 'mcp-kopuk', 51, { source: 'PostToolUseFailure', tool: 'mcp__ornek__oku', toolCode: 'connection_closed' }],
  [33, 'komut-hata', 42, { source: 'ToolCall', tool: 'Bash', cmd: 'node gorev.js', exitCode: 2 }],
  [35, 'test-kirik', 53, { source: 'PostToolUseFailure', tool: 'Bash', cmd: 'cargo test' }],
  [37, 'dosya-yok', 44, { source: 'PostToolUseFailure', tool: 'Read', toolCode: 'ENOENT' }],
  [38, 'disk-dolu', 59, { source: 'ToolCall', tool: 'Write', toolCode: 'ENOSPC' }],
  [39, 'git-catisma', 49, { source: 'ToolCall', tool: 'Bash', cmd: 'git merge ozellik', exitCode: 1 }],
  [47, 'isci-coktu', 59, { source: 'PostToolUseFailure', tool: 'Bash', cmd: 'codex exec "iş"', exitCode: 1 }],
]
for (const [no, id, prio, signal] of KALAN_SINYALLER) {
  test(`1.3: #${no} ${id} tetiklenir, bandı doğrudur ve önceki işe döner`, () => {
    const cls = classifyError(signal)
    expect(cls?.id).toBe(id)
    expect(cls?.prio).toBe(prio)
    const before: ActState = { id: 'type-fast', at: N9, seen: N9 }
    const st = cls?.kind === 'loop' ? applyLoop(before, { id, at: N9 }, N9) : pushEvWithRules(before, id, N9)
    if (cls?.kind === 'loop') {
      expect(activeLoop(st, N9)?.id).toBe(id)
      if (id === 'hesap-kilit') expect(st.loops?.[0]?.lowAt).toBe(N9 + 1_800_000)
      const after = clearLoops(st, [id], N9 + 100, false).state
      expect(activeLoop(after, N9 + 100)).toBeUndefined()
      expect(after.id).toBe('type-fast')
    } else {
      expect(st.ev?.id).toBe(id)
      const after = pruneAct(st, N9 + evDuration(id) + 1).state
      expect(after.ev).toBeUndefined()
      expect(after.id).toBe('type-fast')
    }
    const wait = applyLoop(before, { id: 'izin-bekle', at: N9 }, N9)
    if (prio < 60 && no !== 7) expect(pushEvWithRules(wait, id, N9 + 1).ev).toBeUndefined()
    if (no === 7) expect(pushEvWithRules(wait, id, N9 + 1).ev?.id).toBe(id)
  })
}

test('1.3: #17 bağlam uyarısı eşikte başlar, ölçüm düşünce söner; üst engel kazanır', () => {
  const w = worker9({ activity: 'writing', act: { id: 'type-fast', at: N9, seen: N9 } })
  const view = (pct: number) => actView(w, ctx9({ isBoss: true, ctxPct: pct }))
  expect(view(89).main?.id).toBe('type-fast')
  expect(view(90).main?.id).toBe('baglam-uyari')
  expect(view(99).main?.id).toBe('baglam-uyari')
  expect(view(40).main?.id).toBe('type-fast')
  expect(actView({ ...w, act: applyLoop(w.act, { id: 'sikistirma', at: N9 }, N9) }, ctx9({ isBoss: true, ctxPct: 99 })).main?.id).toBe('sikistirma')
})

test('1.3: #26 uzun düşünme 30 saniye sessizlikte döner, üç dakikada kahve olur; akış/araç/durum bitirir', () => {
  const w = worker9({ activity: 'thinking', since: N9, streamAt: N9, act: { id: 'type-fast', at: N9, seen: N9 } })
  expect(actView(w, ctx9({ now: N9 + 29_999 })).main?.id).toBe('type-fast')
  expect(actView(w, ctx9({ now: N9 + 30_000 })).main?.id).toBe('uzun-dusunme')
  expect(actView(w, ctx9({ now: N9 + 180_000 })).main?.id).toBe('coffee-break')
  expect(actView({ ...w, streamAt: N9 + 20_000 }, ctx9({ now: N9 + 31_000 })).main?.id).not.toBe('uzun-dusunme')
  expect(actView({ ...w, activity: 'running' }, ctx9({ now: N9 + 31_000 })).main?.id).not.toBe('uzun-dusunme')
  expect(actView({ ...w, streamAt: undefined }, ctx9({ now: N9 + 31_000 })).main?.id).not.toBe('uzun-dusunme')
  expect(actView({ ...w, act: applyLoop(w.act, { id: 'izin-bekle', at: N9 }, N9) }, ctx9({ now: N9 + 31_000 })).main?.id).toBe('izin-bekle')
})

test('1.3: #49 kota az uyarısı ölçüme bağlıdır, yüzde 90 altına inince biter ve kilide yenilir', () => {
  const w = worker9({ activity: 'writing', act: { id: 'type-fast', at: N9, seen: N9 } })
  const view = (pct?: number) => actView(w, ctx9({ limitPct: pct }))
  expect(view().main?.id).toBe('type-fast')
  expect(view(89).main?.id).toBe('type-fast')
  expect(view(90).main?.id).toBe('kota-az')
  expect(view(99).main?.id).toBe('kota-az')
  expect(view(10).main?.id).toBe('type-fast')
  expect(actView(w, ctx9({ limitPct: 99, globalLoop: { id: 'kota-oturum', at: N9 } })).main?.id).toBe('kota-oturum')
})

test('1.3: #34 tekrarlı hatada tekil olaylar bastırılır, #41 üstündür ve çözülünce saklanan döngü döner', () => {
  const st = pushEvWithRules(undefined, 'test-kirik', N9, { storm: true })
  expect(activeLoop(st, N9)?.id).toBe('hata-serisi')
  expect(pushEvWithRules(st, 'komut-hata', N9 + 1).ev).toBeUndefined()
  const upper = applyLoop(st, { id: 'sonsuz-dongu', at: N9 + 10 }, N9 + 10)
  expect(activeLoop(upper, N9 + 10)?.id).toBe('sonsuz-dongu')
  expect(activeLoop(clearLoops(upper, ['sonsuz-dongu'], N9 + 100).state, N9 + 100)?.id).toBe('hata-serisi')
  expect(activeLoop(clearLoops(st, ['hata-serisi'], N9 + 100).state, N9 + 100)).toBeUndefined()
})

test('1.3: #50 toparlanma bir kez çalar; kota devam kutlaması ayrıca toparlanma üretmez', () => {
  const locked = applyLoop({ id: 'type-fast', at: N9, seen: N9 }, { id: 'giris-gerek', at: N9 }, N9)
  const cleared = clearLoops(locked, 'lock', N9 + 10, true).state
  expect(cleared.ev?.id).toBe('toparlandi')
  expect(pruneAct(cleared, N9 + 2000).state.ev).toBeUndefined()
  expect(clearLoops(pruneAct(cleared, N9 + 2000).state, 'lock', N9 + 2001, true).state.ev).toBeUndefined()
  const celebrating = pushEvWithRules(locked, 'kota-devam', N9 + 1)
  expect(clearLoops(celebrating, 'lock', N9 + 2, true).state.ev?.id).toBe('kota-devam')
})

test('1.3: sıkıştırma kuyruğu çözülmeye dek bekler; disk dolu beş dakika, komut altı saniye susar', () => {
  const compact = applyLoop(undefined, { id: 'sikistirma', at: N9 }, N9)
  const queued = pushEvWithRules(compact, 'disk-dolu', N9 + 1)
  expect(queued.ev).toBeUndefined()
  expect(queued.evQ?.[0]?.id).toBe('disk-dolu')
  expect(pruneAct(queued, N9 + 5000).state.ev).toBeUndefined()
  const released = pruneAct(clearLoops(queued, ['sikistirma'], N9 + 5001).state, N9 + 5002).state
  expect(released.ev?.id).toBe('disk-dolu')
  expect(pushEvWithRules({ ...released, ev: undefined }, 'disk-dolu', N9 + 120_000).ev).toBeUndefined()
  expect(pushEvWithRules({ ...released, ev: undefined }, 'disk-dolu', N9 + 300_002).ev).toBeUndefined()
  expect(pushEvWithRules({ ...released, ev: undefined }, 'disk-dolu', N9 + 305_002).ev?.id).toBe('disk-dolu')
  const cmd = pushEvWithRules(undefined, 'komut-hata', N9)
  expect(pushEvWithRules({ ...cmd, ev: undefined }, 'komut-hata', N9 + 5999).ev).toBeUndefined()
  expect(pushEvWithRules({ ...cmd, ev: undefined }, 'komut-hata', N9 + 6000).ev?.id).toBe('komut-hata')
})

test('1.3: yeni desenler sıradan araç çıktısında tetiklenmez; yapısal kodlar özgündür', () => {
  for (const [, id, , signal] of KALAN_SINYALLER.filter(([, , , s]) => s.text)) {
    for (const source of ['ToolCall', 'PostToolUseFailure', 'TurnStep'] as const) {
      expect(classifyError({ source, tool: 'Read', text: signal.text })?.id).not.toBe(id)
    }
  }
  for (const text of ['ENOSPC', 'ENOENT', 'MCP server x connection closed', 'CONFLICT <<<<<<<', 'blocked by hook', 'fallback to flash']) {
    expect(classifyError({ source: 'ToolCall', tool: 'Read', text })?.id).toBe('error-sparks')
  }
  expect(classifyError({ source: 'StopFailure', code: 'invalid_request', text: 'Request too large' })?.id).toBe('cok-buyuk-413')
  expect(classifyError({ source: 'StopFailure', code: 'invalid_request', text: 'Prompt is too long' })?.id).toBe('baglam-asildi')
  expect(classifyError({ source: 'PostToolUseFailure', tool: 'Bash', cmd: 'echo "cargo test"', text: 'x' })?.id).toBe('error-sparks')
  expect(classifyError({ source: 'PostToolUseFailure', tool: 'Bash', cmd: 'rg needle .', exitCode: 2 })?.id).toBe('komut-hata')
  expect(classifyError({ source: 'PostToolUseFailure', tool: 'Bash', cmd: 'rg needle .', exitCode: 1 })).toBeUndefined()
})

test('1.3: yeni şeritler üç karakterde yerleşir; karma 26 masa ve hareketsiz görünüm SVG bütçesindedir', () => {
  const ids = KALAN_SINYALLER.map(([, id]) => id).concat(['baglam-uyari', 'kota-az', 'uzun-dusunme', 'model-gecis'])
  for (const kind of ['turuncu', 'yesil', 'mavi'] as const) {
    for (const id of ids) {
      const s = ACT_STRIPS[stripFor(id, kind)]
      expect([id, kind, Boolean(s?.b64 || s?.svg)]).toEqual([id, kind, true])
      if (id !== 'shield-guard' && id !== 'zaman-asimi') expect([id, Boolean(s?.b64)]).toEqual([id, true])
      expect(ACTS[id]?.ao[kind]?.length).toBe(2)
    }
  }
  const workers = crew(25).map((w, i) => ({ ...w, activity: 'writing' as Activity, act: pushEvWithRules(w.act, ids[i % ids.length]!, N9) }))
  for (const motion of [true, false]) {
    const scene = sceneSvg({ workers, usage: { ctxWindow: 1_000_000, limits: [], at: N9, history: [] }, turn: { active: true, steps: 1, turns: 1 }, now: N9 + 100, motion })
    expect(scene.svg.length).toBeLessThan(131_072)
    const defined = new Set([...scene.svg.matchAll(/id="(ac-[^"]+)"/g)].map(m => m[1]))
    for (const ref of scene.svg.matchAll(/href="#(ac-[^"]+)"/g)) expect(defined.has(ref[1])).toBe(true)
    if (!motion) {
      expect(scene.svg).toContain('class="still"')
      expect(scene.svg).toContain('.still *{animation:none!important}')
      expect(scene.svg).not.toMatch(/animation:acb-/)
    }
  }
})

test('1.3: live #6/#7 kota bildirimleri kilidi çözer/korur; #24 model değişimi bir kez çalar', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  for (const event of ['Notification', 'StopFailure', 'PostModelSwitch']) (on as unknown as (name: string, hook: () => unknown) => void)(`classic.${event}`, () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const boss = async () => (await storedWorkers($)).find(w => w.id === 'boss')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await classic.StopFailure?.({ hook_event_name: 'StopFailure', error: 'billing_error' })
  await clock.advance(1100)
  expect(activeLoop((await boss())?.act, clock.now())?.id).toBe('kredi-bitti')
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'quota_auto_resume_stale', message: 'secret' })
  await clock.advance(1100)
  expect((await boss())?.act?.ev?.id).toBe('kota-devam-yok')
  expect(activeLoop((await boss())?.act, clock.now())?.id).toBe('kredi-bitti')
  await classic.Notification?.({ hook_event_name: 'Notification', notification_type: 'quota_auto_resume_fired' })
  await clock.advance(1100)
  expect(activeLoop((await boss())?.act, clock.now())).toBeUndefined()
  expect((await boss())?.act?.ev?.id).toBe('kota-devam')
  await clock.advance(3000)
  expect((await boss())?.act?.ev?.id === 'toparlandi').toBe(false)
  await classic.PostModelSwitch?.({ hook_event_name: 'PostModelSwitch' })
  await clock.advance(1100)
  expect((await boss())?.act?.ev?.id).toBe('model-gecis')
  await clock.advance(2100)
  expect(actView((await boss())!, ctx9({ now: clock.now(), isBoss: true })).ev).toBeUndefined()
  expect(JSON.stringify(await storedWorkers($))).not.toContain('secret')
})

test('1.3: live yapısal araç hataları, tek test olayı ve #34 başarıda kapanır; API engeli başka masadaki başarıyla çözülür', { plugins: [OKUYUCU] }, async ($, on) => {
  const clock = mock.clock(on)
  let result: Record<string, unknown> = {}
  engine(on, () => result)
  on('classic.StopFailure', () => ({}))
  const classic = $.classic as unknown as Record<string, (e: unknown) => Promise<unknown>>
  const one = async () => (await storedWorkers($)).find(w => w.id === 'a1')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Kontrol', description: 'Kontrol', subagentType: 'general-purpose' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'x.ts', old_string: '', new_string: 'x', agentId: 'a1' })
  await clock.advance(1100)
  const previous = (await one())?.act?.id
  result = { isError: true, result: { error_code: 'ENOSPC' } }
  await $.tool.call({ tool: 'Write', file_path: 'x.ts', content: 'x', agentId: 'a1' })
  await clock.advance(1100)
  expect((await one())?.act?.ev?.id).toBe('disk-dolu')
  result = {}
  await $.tool.call({ tool: 'Read', file_path: 'x.ts', agentId: 'a1' })
  await clock.advance(9000)
  result = { isError: true, text: 'ENOSPC secret-output' }
  await $.tool.call({ tool: 'Bash', command: 'cargo test', agentId: 'a1' })
  await clock.advance(1100)
  expect((await one())?.act?.ev?.id).toBe('test-kirik')
  expect((await one())?.act?.id).not.toBe('test-tube_fail')
  await clock.advance(2100)
  expect(actView((await one())!, ctx9({ now: clock.now() })).ev).toBeUndefined()
  expect((await one())?.act?.id).toBe(previous)
  for (let i = 0; i < 2; i++) {
    await $.tool.call({ tool: 'Bash', command: `node task${i}.js`, agentId: 'a1' })
    await clock.advance(1100)
  }
  expect(activeLoop((await one())?.act, clock.now())?.id).toBe('hata-serisi')
  result = {}
  await $.tool.call({ tool: 'Read', file_path: 'y.ts', agentId: 'a1' })
  await clock.advance(1100)
  expect(activeLoop((await one())?.act, clock.now())).toBeUndefined()
  await classic.StopFailure?.({ hook_event_name: 'StopFailure', error: 'unknown', error_details: 'Unable to connect' })
  await clock.advance(1100)
  expect(globalLoopOf(await storedWorkers($), clock.now())?.id).toBe('ag-kopuk')
  await $.tool.call({ tool: 'Read', file_path: 'z.ts', agentId: 'a1' })
  await clock.advance(1100)
  expect(globalLoopOf(await storedWorkers($), clock.now())).toBeUndefined()
  expect(JSON.stringify(await storedWorkers($))).not.toContain('secret-output')
})
