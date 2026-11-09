import { atom, read } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { ActMark, ActState, Activity, FeedItem, MascotKind, Talk, Worker } from '../types'
import { ACTS, ACT_LABEL, ACT_TRIGGERS, EXTERNAL_LABEL, MAIN_ACTS, actDefs, actUse, actView, applyPick, endAct, familyOf, hireAct, isEvent, keywordAct, pickActivity, planActs, pushMark, settleAct, siblings, stripFor, withEv } from '../hooks/activities'
import type { ActCtx, ActPick, ActView, ToolFacts } from '../hooks/activities'
import { charBox, charDefs, charKindOf, drawCharacter, hatCrop, markOf, propUnit, seatHide, setCharScale } from '../hooks/characters'
import { CHAR_SET } from '../hooks/char-data'
import { ellipsize, textWidth } from '../hooks/props'
import type { CharKind, CharState } from '../hooks/characters'
import { hudSvg, useHudTheme } from '../hooks/hud'
import { DESK_GEOM, MAX_DESKS, fontOu, hintOf, layoutOffice, nextHint, positionAt, route, trackMoves } from '../hooks/layout'
import type { Box, LayoutHint } from '../hooks/layout'
import { cmdKind, dayKey, dutyFor, effortLevel, effortWord, fatigue, mascotFor, mascotOf, modelLabel, modelLine, normEffort, numberedName, planOf, readCodexConfig, readExternal, readTool, resolveAddress, settleTitle, siteOf, splitEffort, talkText, thinkKind, titleFor } from '../hooks/logic'
import { hurried, restOf } from '../hooks/events'
import { sceneSvg } from '../hooks/scene'

const PANE = {
  plugin: 'pixel-office',
  component: 'Pane',
  requestId: 'pixel-office',
  props: {
    title: 'Claude Office',
    isFocused: false,
    bodyColumns: 160,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

/** The engine's answers; `many`: each agent.spawn seats a new agent (a1, a2, …) instead of a1 again. */
function engine(on: Parameters<Parameters<typeof test>[1]>[1], toolResult: Record<string, unknown> = {}, many = false, agents?: () => unknown[]) {
  let spawned = 0
  on('command.register', () => ({ value: { command: 'office' } }))
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
  on('tool.call', () => ({ result: toolResult }))
  // a message reaches anyone the office knows, and nobody by the name "Missing"
  on('session.send', (_, e) => (e.to === 'Missing' ? { isDelivered: false as const, reason: 'nobody by that name' } : { isDelivered: true as const }))
  on('session.id', () => ({ value: 'test-chat' }))
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/user' : undefined }))
  on('fs.stat', () => {
    throw new Error('missing')
  })
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: many ? `a${++spawned}` : 'a1' }))
  on('classic.Stop', () => ({}))
}

test('the boss reads, hires a worker, and the HUD and tabs show it in plain words', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'C:/project/app.tsx' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build -- --verbose', description: 'Build the project' })
  await $.agent.spawn({ prompt: 'Search logs', description: 'Search logs', subagentType: 'Explore' })
  await clock.advance(1200)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const hud = await ui.find({ type: 'Svg' })
  const source = String(hud?.props.source)
  // drawn to the pane's own size less a 40 px margin: 160 cells wide, filling 60 rows
  expect(hud?.props.width).toBe(1240)
  expect(Number(hud?.props.height)).toBeGreaterThanOrEqual(60 * 17 - 64)
  // an image, not the sandboxed frame that reloads from blank on each change
  expect(hud?.props.isInteractive).toBeFalsy()
  expect(source).toContain('Claude Office')
  expect(source).toContain('BOSS')
  // 0.8: a desk carries a title from its work (an Explore scanning logs is an Explorer), never Agent N.
  expect(source).toContain('Explorer')
  expect(source).not.toContain('Agent 1')
  expect(source).toContain('started work · Search logs')
  // a wide pane keeps the feed to its newest line (0.4); older events live in the events list
  // the feed says what was done, never the raw command
  // (the newest line here is the hire, above; the command's wording is checked in the tools test)
  expect(source).not.toContain('npm run build')

  await ui.press({ key: 'tab-ekip' })
  const row = await ui.find({ key: 'w-a1' })
  expect(row?.text).toMatch(/■ Explorer\s+Opus 5\.5/)
  expect((await ui.find({ key: 'w-boss' }))?.text).toMatch(/Boss/)
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
  expect((await ui.find({ type: 'Text', text: /Context 21%/ }))?.text).toMatch(/211k \/ 1\.0M\) · 5 hour 55%/)
  expect((await ui.find({ type: 'Text', text: /^Boss: / }))?.text).toMatch(/Idle/)
  await ui.unmount()
})

test('thoughts, tools and sites are read the way the office shows them', async () => {
  expect(thinkKind('First I will outline the steps, then implement.')).toBe('plan')
  expect(thinkKind('The test is failing with a TypeError, let me fix it.')).toBe('debug')
  expect(thinkKind('Color palette and layout matter for design.')).toBe('design')
  expect(siteOf('https://www.reddit.com/r/ClaudeAI')).toBe('reddit')
  expect(siteOf('https://youtu.be/abc')).toBe('youtube')
  expect(siteOf('https://x.com/example')).toBe('x')
  expect(readTool('WebFetch', { url: 'https://github.com/pablodelucca/pixel-agents' }).site).toBe('github')
  expect(readTool('Bash', { command: 'npm test' }).activity).toBe('running')
  expect(readTool('Bash', { command: 'rm -rf node_modules && npm ci' }).detail).not.toMatch(/rm -rf/)
  expect(readTool('Edit', { file_path: 'C:/a/b.ts' }).bubble).toBe('Editing: b.ts')
})

test('a full office of 26 busy workers stays inside the Svg limit at every width', async () => {
  const kinds: Activity[] = ['thinking', 'reading', 'writing', 'running', 'web', 'done', 'failed', 'waiting', 'answering', 'planning']
  const now = 1_800_000_000_000
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#FBBF24', seat: -1, activity: 'delegating', bubble: 'Ada, could you look at this?', detail: '', tools: 3, tokensOut: 100, since: now, joinedAt: now },
  ]
  for (let i = 0; i < 26; i++) {
    workers.push({
      id: `agent-${i}`,
      n: i,
      name: `Worker ${i}`,
      role: 'Explorer',
      task: 'A long task description '.repeat(4),
      color: '#2DD4BF',
      seat: i,
      activity: kinds[i % kinds.length] as Activity,
      think: 'research',
      site: 'youtube',
      bubble: 'A very long speech bubble text that needs to be shortened',
      detail: 'detail '.repeat(20),
      tools: i,
      tokensOut: 1000 * i,
      since: now,
      joinedAt: now - (i % 2 === 0 ? 500 : 60_000),
      endedAt: i % 7 === 5 ? now - 1000 : undefined,
    })
  }
  const usage = { ctxPct: 91, ctxTokens: 910_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 80 }], at: now, history: [10, 30, 55, 91] }
  const turn = { active: true, steps: 3, turns: 2, prompt: 'Set up the office', model: 'claude-opus-5-5', effort: 'high' }
  const scene = sceneSvg({ workers, usage, turn, now, motion: true })
  expect(scene.svg.length).toBeLessThan(131_072)
  expect(scene.svg).toContain('+2 more workers')

  const feed = Array.from({ length: 60 }, (_, i) => ({ t: now - i * 1000, who: `Worker ${i % 26}`, color: '#2DD4BF', kind: 'read' as const, text: `read · file-${i}.ts` }))
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
  let compacts = 0
  on('session.compact', () => {
    compacts++
    return { value: {} }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // the setting lives under "Settings ▾" since 0.4
  await ui.press({ key: 'settings' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/off/)
  await ui.press({ key: 'auto' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/on · 80%/)
  await ui.press({ key: 'autoDown' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/75%/)
  // the setting lands in the shared folder, where a shared usage band reads it
  expect(Object.values(written).some(t => t.includes('"at":75'))).toBe(true)
  await ui.unmount()
})

test('the overview holds its frame while Claude works, then paints the news', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const first = String((await ui.find({ type: 'Svg' }))?.props.source)
  await $.tool.call({ tool: 'Read', file_path: 'C:/project/new.ts' })
  await clock.advance(1500)
  // a burst of work does not redraw the picture at once
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toBe(first)
  await clock.advance(8200)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('read · new.ts')
  await ui.unmount()
})

test('an idle office draws the same picture seconds apart (the pane must not repaint for the clock hand)', async () => {
  const now = Date.parse('2026-10-28T19:40:10Z')
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#FBBF24', seat: -1, activity: 'idle', bubble: 'Coffee break.', detail: '', tools: 0, tokensOut: 0, since: now - 400_000, joinedAt: now - 99_999 },
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
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#FBBF24', seat: -1, activity: 'thinking', bubble: '', detail: '', tools: 0, tokensOut: 0, since: now - 5000, joinedAt: now - 99_999 },
  ]
  const usage = { ctxPct: 21, ctxTokens: 211_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 55 }], usd: 12.4, at: now }
  const turn = { active: true, steps: 1, turns: 6, prompt: 'Set up the office', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: { Read: 4 }, hired: 0, outTokens: 9000, inTokens: 0, cacheRead: 0, sessionStart: now - 3_600_000 }
  const daily = { day: dayKey(now), usd: 38.1, sessions: 3, at: now }
  // what is written on the board (not the hover title)
  const at = (svg: string, word: string) => {
    const m = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${word.replace('$', '\\$')}</text>`).exec(svg)
    return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined
  }
  for (const [width, fill] of [[340, 900], [420, 900], [700, 1200], [1200, 1100], [2000, 950]] as const) {
    const svg = hudSvg({ workers, feed: [], usage, turn, stats, now, motion: false, width, fill, daily }).svg.replace(/<title>[^<]*<\/title>/g, '')
    const today = at(svg, 'TODAY')
    const chat = at(svg, 'THIS CHAT') ?? at(svg, 'CHAT')
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
  expect(mascotOf('claude-opus-5-5')).toBe('opus')
  expect(mascotOf('claude-opus-5-5', true)).toBe('boss')
  expect(mascotOf('claude-sonnet-5-5')).toBe('sonnet')
  expect(mascotOf('claude-haiku-4-5-20251001')).toBe('haiku')
  expect(mascotOf('gpt-6.1-sol')).toBe('sol')
  expect(mascotOf('gpt-6.1-terra')).toBe('terra')
  expect(mascotOf('gpt-6.1-terra', true)).toBe('terra')
  expect(mascotOf('gpt-6.1-luna')).toBe('luna')
  expect(mascotOf('gemini-3-flash-preview')).toBe('flash')
  expect(mascotOf('gemini-3-pro')).toBe('argon')
  expect(mascotOf('gpt-5.5')).toBe('sol')
  expect(mascotOf('console-solver')).toBe('other')
  expect(mascotOf(undefined)).toBe('other')
  expect(mascotOf(undefined, true)).toBe('boss')

  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelLabel('gpt-6.1-terra')).toBe('GPT-6.1 Terra')
  expect(modelLabel('gemini-3-flash-preview')).toBe('Gemini 3 Flash')
  expect(modelLabel(undefined)).toBe('reading model')
  expect(modelLabel('mistral-large-latest-2026')).toBe('mistral-large-latest-2026')
  expect(effortLevel('low')).toBe(1)
  expect(effortLevel('xhigh')).toBe(4)
  expect(effortLevel('max')).toBe(5)
  expect(effortLevel('12000')).toBe(3)
  expect(effortLevel(undefined)).toBe(0)

  expect(readExternal('codex.exe exec -m gpt-6.1-terra -c model_reasoning_effort=high -s read-only "Review the code"')).toEqual({ cli: 'codex', model: 'gpt-6.1-terra', effort: 'high', sandbox: 'read' })
  expect(readExternal('cat C:/codex-notes/a.md')).toBeUndefined()
  expect(readExternal('ls gemini')).toBeUndefined()
  expect(readExternal('cd C:/project && codex exec --sandbox workspace-write "Fix the bug -m fake"')).toEqual({ cli: 'codex', sandbox: 'write' })
  expect(readExternal('gemini -m gemini-3-flash --approval-mode plan -p "summarize"')).toEqual({ cli: 'gemini', model: 'gemini-3-flash', sandbox: 'read' })
  expect(readExternal('& "C:/Tools/agy.exe" --model gemini-3-pro --yolo')).toEqual({ cli: 'agy', model: 'gemini-3-pro', sandbox: 'write' })
  // the shell call reads as a job handed out, never as its command
  const bash = readTool('Bash', { command: 'codex exec -m gpt-6.1-luna -s read-only "private prompt"', description: 'Second opinion' })
  expect(bash.activity).toBe('delegating')
  expect(bash.bubble).toBe('GPT-6.1 Luna put to work')
  expect(JSON.stringify(bash)).not.toMatch(/private|read-only/)
  expect(readTool('SendMessage', { to: 'Ada', message: 'hello' }).activity).toBe('messaging')

  expect(dutyFor({ sandbox: 'read' })).toBe('critic')
  expect(dutyFor({ sandbox: 'write' })).toBe('builder')
  expect(dutyFor({ task: 'Review the design' })).toBe('critic')
  expect(dutyFor({ task: 'Evaluate the ideas' })).toBe('evaluator')
  expect(dutyFor({ task: 'Build the scene' })).toBe('builder')
  expect(dutyFor({ type: 'Explore', task: 'Search logs' })).toBe('explorer')
  expect(dutyFor({ type: 'Plan', task: 'Roadmap' })).toBe('planner')
  expect(dutyFor({ task: 'Review the logs', writes: 2 })).toBe('builder')
  expect(dutyFor({ task: 'Hello' })).toBe('general')

  expect(talkText('Run the tests too', 'long text')).toBe('Run the tests too')
  expect(talkText(undefined, '\n   C:/project/src/app.tsx review\nsecond line')).toBe('app.tsx review')
  expect(talkText(undefined, 'a '.repeat(80)).length).toBeLessThanOrEqual(48)

  const now = 1_800_000_000_000
  const w = (id: string, name: string, extra: Partial<Worker> = {}): Worker => ({ id, n: 0, name, role: 'General', task: '', color: '#fff', seat: 0, activity: 'idle', bubble: '', detail: '', tools: 0, tokensOut: 0, since: now, joinedAt: now, ...extra })
  const office = [w('boss', 'Boss'), w('a1', 'Ada'), w('a2', 'Can', { addr: ['scout', 'scout@team'] })]
  expect(resolveAddress(office, 'main')).toBe('boss')
  expect(resolveAddress(office, 'team-lead')).toBe('boss')
  expect(resolveAddress(office, 'ADA')).toBe('a1')
  expect(resolveAddress(office, 'a2')).toBe('a2')
  expect(resolveAddress(office, 'scout@team')).toBe('a2')
  expect(resolveAddress(office, 'scout')).toBe('a2')
  expect(resolveAddress(office, 'nobody')).toBe('')

  // 0.7: 'flash' is Gemini Flash only inside a Gemini name; other Claude models; EVREN by its profile or helper; Antigravity
  expect(mascotOf('deepseek-v4.1-flash')).toBe('other')
  expect(mascotOf('qwen3.8-flash-next')).toBe('other')
  expect(mascotOf('gemini-3-flash')).toBe('flash')
  expect(mascotOf('claude-fable-5')).toBe('fable')
  expect(mascotOf('claude-fable-5', true)).toBe('boss')
  expect(mascotFor({ id: 'ext:1', model: 'deepseek-v4.1-flash', via: 'evren' })).toBe('evren')
  expect(mascotFor({ id: 'ext:2', model: 'claude-sonnet-4-5', via: 'agy' })).toBe('sonnet')
  expect(mascotFor({ id: 'boss', model: 'claude-opus-5-5' })).toBe('boss')
  expect(modelLabel('deepseek-v4.1-flash')).toBe('DeepSeek V4.1 Flash')
  expect(modelLabel('glm-5.3')).toBe('GLM-5.3')
  expect(modelLabel('qwen3.8-flash-next')).toBe('Qwen 3.8 Flash')
  expect(modelLabel('mimo-v2-flash')).toBe('MiMo')
  expect(modelLabel('gemma-4-31b')).toBe('Gemma 4')
  expect(modelLabel(undefined, 'evren')).toBe('EVREN')
  expect(modelLabel('evren')).toBe('EVREN')
  expect(readExternal('codex exec -p evren -m deepseek-v4.1-flash "Review the code"')).toEqual({ cli: 'codex', profile: 'evren', model: 'deepseek-v4.1-flash' })
  expect(readExternal('codex exec --profile=evren -s read-only "x"')).toEqual({ cli: 'codex', profile: 'evren', sandbox: 'read' })
  expect(readExternal('python C:/Tools/evren_suru.py -m glm-5.3 "summarize"')).toEqual({ cli: 'evren', model: 'glm-5.3' })
  expect(readExternal('cd C:/x && uv run evren_suru --model qwen3.8-flash-next')).toEqual({ cli: 'evren', model: 'qwen3.8-flash-next' })
  expect(readExternal('evren_suru.py -m mimo-v2-flash')).toEqual({ cli: 'evren', model: 'mimo-v2-flash' })
  expect(readExternal('cat evren_suru.py')).toBeUndefined()
  expect(readExternal('agy --model claude-sonnet-4-5 -p "review"')).toEqual({ cli: 'agy', model: 'claude-sonnet-4-5' })
  const evren = readTool('Bash', { command: 'codex exec -p evren -m glm-5.3 "private prompt"', description: 'Search' })
  expect(evren.bubble).toBe('EVREN put to work')
  expect(JSON.stringify(evren)).not.toMatch(/private|glm/)
})

test('a hired worker sits at its desk as its model’s mascot, and the team list names model and duty', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Review the code', description: 'Review the code', subagentType: 'general-purpose' })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('id="ch-pofu-opus-')
  await ui.press({ key: 'tab-ekip' })
  expect((await ui.find({ key: 'w-a1' }))?.text).toMatch(/Auditor\s+Opus 5\.5/)
  await ui.unmount()
})

test('an outside worker (codex in the shell) takes a desk, and nothing of its command reaches the picture', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-terra' })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  await $.tool.call({ tool: 'Bash', command: 'codex.exe exec -m gpt-6.1-terra -c model_reasoning_effort=high -s read-only "Private prompt text: C:/private/plan.md"', description: 'Review the code' })
  await clock.advance(3500)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('Terra')
  expect(source).toContain('GPT-6.1 Terra · high · started')
  for (const secret of ['-s read-only', 'read-only', 'Private prompt', 'C:/private', 'plan.md', 'model_reasoning_effort', 'codex.exe']) expect(source).not.toContain(secret)
  await ui.unmount()

  // the shell's background task is gone: the worker has finished and reports back
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await clock.advance(1200)
  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /^■ Outside Expert/ }))?.text).toMatch(/Outside Expert\s+GPT-6\.1 Terra · high · /)
  expect((await term.find({ type: 'Text', text: /Boss → Outside Expert · Review the code/ }))?.text).toMatch(/^✈/)
  expect((await term.find({ type: 'Text', text: /Outside Expert → Boss/ }))?.text).toMatch(/Done/)
  await term.unmount()
})

test('a message between desks is a talk: delivered it flies, undelivered it says so', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Search logs', description: 'Search logs', subagentType: 'Explore' })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  await $.tool.call({ tool: 'SendMessage', to: 'Explorer', summary: 'Run the tests too', message: 'Run the tests too, then write C:/project/report.md' })
  await $.session.send({ to: 'Explorer', text: 'Run the tests too, then write C:/project/report.md' })
  // a message is news: the picture shows it within seconds, the paper plane flying
  await clock.advance(3500)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('→')
  expect(source).toContain('<animateMotion')
  expect(source).not.toContain('report.md')
  await ui.unmount()

  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /Boss → Explorer · Run the tests too/ }))?.text).toMatch(/^✉/)
  await term.unmount()

  await $.session.send({ to: 'Missing', text: 'Nobody heard' })
  await clock.advance(1200)
  const again = await $.ui.mount(TERM)
  expect((await again.find({ type: 'Text', text: /→ Missing/ }))?.text).toMatch(/not delivered · Nobody heard/)
  await again.unmount()
})

test('news is painted soon: a hire after the pane opened is drawn within 3.5 seconds', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  const first = String((await ui.find({ type: 'Svg' }))?.props.source)
  await $.agent.spawn({ prompt: 'Build the scene', description: 'Build the scene', subagentType: 'general-purpose' })
  await clock.advance(3500)
  const now = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(now).not.toBe(first)
  expect(now).toContain('started work · Build the scene')
  await ui.unmount()
})

test('an office of 26 workers on 10 models, talking, stays inside the Svg limit at every width', async () => {
  const now = 1_800_000_000_000
  const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6.1-luna', 'gemini-3-pro', 'gemini-3-flash', 'mistral-large', 'claude-opus-4-1']
  const kinds: Activity[] = ['thinking', 'reading', 'writing', 'running', 'web', 'done', 'idle', 'waiting', 'messaging', 'delegating']
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#D97757', seat: -1, activity: 'delegating', bubble: 'Ada, could you look at this?', detail: '', tools: 3, tokensOut: 100, since: now, joinedAt: now, model: 'claude-opus-5-5', effort: 'xhigh' },
  ]
  for (let i = 0; i < 26; i++) {
    workers.push({
      id: i % 4 === 3 ? `ext:t${i}` : `agent-${i}`,
      n: i,
      name: `Worker ${i}`,
      role: i % 4 === 3 ? 'Outside worker' : 'Explorer',
      task: 'A long task description '.repeat(4),
      color: '#2DD4BF',
      seat: i,
      activity: kinds[i % kinds.length] as Activity,
      think: 'research',
      bubble: 'A very long speech bubble text that needs to be shortened',
      detail: 'detail '.repeat(20),
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
    text: 'Run the tests and report the result to me please',
    isDelivered: i % 9 !== 0,
    readAt: i % 2 === 0 ? now - 100 : undefined,
  }))
  const feed: FeedItem[] = Array.from({ length: 60 }, (_, i) => ({ t: now - i * 1000, who: `Worker ${i % 26}`, whoId: `agent-${i % 26}`, color: '#2DD4BF', kind: i % 2 ? ('talk' as const) : ('ext' as const), text: `GPT Terra · started · file-${i}`, to: 'Ada', toColor: '#5B8FC7', toId: 'agent-1' }))
  const usage = { ctxPct: 91, ctxTokens: 910_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 80 }], at: now, history: [10, 30, 55, 91] }
  const turn = { active: true, steps: 3, turns: 2, prompt: 'Set up the office', model: 'claude-opus-5-5', effort: 'high' }
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
    const text = (await term.find({ type: 'Text', text: /^■ Explorer/ }))?.text ?? ''
    await term.unmount()
    return text
  }

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Search logs', description: 'Search logs', subagentType: 'Explore' })
  await clock.advance(1200)
  await $.classic.TeammateIdle({ teammate_name: 'Explorer', team_name: 'ekip', agent_id: 'a1' })
  await clock.advance(1200)
  expect(await line()).toMatch(/Waiting for a message/)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, agent_id: 'a1' })
  await clock.advance(1200)
  const asking = await line()
  expect(asking).toMatch(/Waiting for approval: Bash/)
  expect(asking).not.toMatch(/rm -rf/)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '', agent_type: 'Explore', last_assistant_message: 'Logs are clean.' })
  await clock.advance(1200)
  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /Explorer → Boss/ }))?.text).toMatch(/Logs are clean/)
  await term.unmount()
  await $.agent.spawn({ prompt: '', description: 'Search logs', subagentType: 'Explore', resume: { agentId: 'a1' } })
  await clock.advance(1200)
  expect(await line()).toMatch(/Back on the task/)
})

// —— 0.7: the office fills the pane, the team walks between desks, the facts live in the office's objects ——

const T0 = 1_800_000_000_000
const crew = (n: number, extra: Partial<Worker> = {}): Worker[] => [
  { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#D97757', seat: -1, activity: 'idle', bubble: '', detail: '', tools: 0, tokensOut: 0, since: T0, joinedAt: T0 - 999_999 },
  ...Array.from({ length: n }, (_, i): Worker => ({ id: `a${i}`, n: i, name: `Agent ${i + 1}`, role: 'General', task: '', color: '#5B8FC7', seat: i, activity: 'reading', bubble: '', detail: '', tools: 0, tokensOut: 0, since: T0, joinedAt: T0 - 100_000 + i * 1000, ...extra })),
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
  for (let i = 1; i <= 20; i++) await $.agent.spawn({ prompt: `Task ${i}`, description: `Task ${i}`, subagentType: 'general-purpose' })
  await clock.advance(12_000)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '', agent_type: 'general-purpose', last_assistant_message: 'Done.' })
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
  await $.tool.call({ tool: 'SendMessage', to: 'Assistant 2', summary: 'Move to the next task', message: 'Move to the next task' })
  await $.session.send({ to: 'Assistant 2', text: 'Move to the next task' })
  await clock.advance(3500)
  expect(await src()).not.toBe(before)
  await ui.unmount()
})

test('the office tells it all: desk card, model panel, monitor, water cooler, battery and scoreboard, and never a raw command', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Review the code', description: 'Review the code', subagentType: 'general-purpose' })
  await clock.advance(1200)
  await $.tool.call({ tool: 'Read', file_path: 'C:/project/app.tsx', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build -- --verbose', description: 'Build the project' })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('Auditor')
  expect(source).toContain('Opus 5.5')
  expect(source).toContain('app.tsx')
  // the context in the water cooler, what is left of the 5-hour limit (55 % used) in the battery
  expect(source).toContain('21%')
  expect(source).toContain('45%')
  expect(source).toContain('TURN')
  expect(source).not.toContain('C:/project')
  expect(source).not.toContain('npm run build')
  await ui.unmount()

  // a command reads as one white-listed word, never its arguments
  expect(cmdKind('rm -rf node_modules && npm ci')).toBe('delete')
  expect(cmdKind('npm run build -- --verbose')).toBe('npm build')
  expect(cmdKind('cd C:/project && git commit -m "private messages"')).toBe('git commit')
  expect(cmdKind('python -m pytest tests/ -k private')).toBe('pytest')
  expect(cmdKind('$env:X="1"; npm test')).toBe('npm test')
  expect(cmdKind('curl -s https://private.example/x')).toBe('download')
  expect(cmdKind('./private-script.sh --secret')).toBe('command')
  expect(readTool('Read', { file_path: 'C:/project/src/app.tsx' }).screen).toEqual({ kind: 'file-read', label: 'app.tsx' })
  expect(readTool('Bash', { command: 'npm test -- --watch' }).screen).toEqual({ kind: 'cmd', label: 'npm test' })
  expect(readTool('WebFetch', { url: 'https://github.com/x/y' }).screen).toEqual({ kind: 'site', label: 'GitHub', site: 'github' })
  expect(readTool('Glob', { pattern: 'C:/project/**/*.ts' }).screen.label).toBe('*.ts')
  expect(planOf({ todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] })).toEqual({ done: 1, total: 3 })
  // the lower the allowance, the more tired the office
  expect(fatigue({ limits: [{ kind: 'five_hour', pct: 55 }] }, T0)).toBe(0)
  expect(fatigue({ limits: [{ kind: 'five_hour', pct: 65 }] }, T0)).toBe(1)
  expect(fatigue({ limits: [{ kind: 'five_hour', pct: 30 }, { kind: 'seven_day', pct: 85 }] }, T0)).toBe(2)
  expect(fatigue({ limits: [{ kind: 'five_hour', pct: 95 }] }, T0)).toBe(3)
})

test('character sheets fit their budget: every kind keeps its idle and every reference finds its symbol', async () => {
  const kinds: CharKind[] = ['pofu', 'pofu-opus', 'pofu-sonnet', 'pofu-haiku', 'pofu-boss', 'dunya', 'gunes', 'ay', 'yildiz', 'kristal', 'evren', 'diger']
  setCharScale(1)
  const deskRows: Record<CharKind, number> = { pofu: 29, 'pofu-opus': 29, 'pofu-sonnet': 29, 'pofu-haiku': 30, 'pofu-boss': 29, gunes: 29, dunya: 29, ay: 29, yildiz: 30, kristal: 29, evren: 28, diger: 29 }
  for (const kind of kinds) {
    const sheet = CHAR_SET[kind]
    expect([sheet.w, sheet.h, sheet.scale]).toEqual([36, 34, 2])
    expect(propUnit(kind, 43)).toBe(1)
    expect(seatHide(kind, 43)).toBe((sheet.ay - deskRows[kind]) * 2)
    expect(charBox(kind, 43).bodyH).toBe((sheet.ay - sheet.fig.top) * 2)
  }
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
  const map: Array<[MascotKind, CharKind]> = [['boss', 'pofu-boss'], ['opus', 'pofu-opus'], ['sonnet', 'pofu-sonnet'], ['haiku', 'pofu-haiku'], ['claude', 'pofu'], ['sol', 'gunes'], ['terra', 'dunya'], ['luna', 'ay'], ['flash', 'yildiz'], ['argon', 'kristal'], ['evren', 'evren'], ['other', 'diger']]
  for (const [m, c] of map) expect(charKindOf(m)).toBe(c)
})

test('EVREN sits as itself whatever its model, an Antigravity run keeps its model character with a badge, and other flash models are not Gemini', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-dis' })
  on('session.receive', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount(DESK)
  await $.tool.call({ tool: 'Bash', command: 'codex exec -p evren -m deepseek-v4.1-flash "Private prompt text"', description: 'Review the code' })
  await $.tool.call({ tool: 'Bash', command: 'agy --model claude-sonnet-4-5 --print "Private prompt text"', description: 'Second opinion' })
  await clock.advance(3500)
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('id="ch-evren-')
  expect(source).toContain('ch-pofu-sonnet-')
  expect(source).not.toContain('ch-yildiz-')
  expect(source).not.toContain('Private prompt')
  await ui.unmount()
  const term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /^■ Outside Expert\s/ }))?.text).toMatch(/DeepSeek V4\.1 Flash/)
  expect((await term.find({ type: 'Text', text: /^■ Outside Expert 2/ }))?.text).toMatch(/Sonnet 4\.5 · Antigravity/)
  await term.unmount()
  // another session's message comes in from outside the office, its path cut to a file name
  await $.session.receive({ origin: { kind: 'peer' }, text: 'Is the report ready? C:/private/path.md' })
  await clock.advance(1200)
  const inbox = await $.ui.mount(TERM)
  expect((await inbox.find({ type: 'Text', text: /Outside → Boss/ }))?.text).toMatch(/^✉ Outside → Boss · Is the report ready\? path\.md/)
  await inbox.unmount()
  expect(mascotOf('qwen3.8-flash-next')).not.toBe('flash')
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

test('every model the three CLIs and EVREN offer reads with its version, its effort and its own mascot', async () => {
  const cases: Array<[string, string, MascotKind, string | undefined]> = [
    // Claude Code
    ['claude-opus-5-5', 'Opus 5.5', 'opus', undefined],
    ['claude-sonnet-5-5', 'Sonnet 5.5', 'sonnet', undefined],
    ['claude-haiku-5-5', 'Haiku 5.5', 'haiku', undefined],
    ['claude-fable-5-1', 'Fable 5.1', 'fable', undefined],
    ['claude-opus-5-5[1m]', 'Opus 5.5', 'opus', undefined],
    // Codex: the version is kept, Astra is not Sol
    ['gpt-6.1-sol', 'GPT-6.1 Sol', 'sol', undefined],
    ['gpt-6-sol', 'GPT-6 Sol', 'sol', undefined],
    ['gpt-6.1-terra', 'GPT-6.1 Terra', 'terra', undefined],
    ['gpt-6-luna', 'GPT-6 Luna', 'luna', undefined],
    ['gpt-6-astra', 'GPT-6 Astra', 'astra', undefined],
    // agy: the effort is the id's suffix, and leaves the name
    ['gemini-4-argon-medium', 'Gemini 4 Argon', 'argon', 'medium'],
    ['gemini-3.8-flash-high', 'Gemini 3.8 Flash', 'flash', 'high'],
    ['claude-opus-5-5-medium', 'Opus 5.5', 'opus', 'medium'],
    ['claude-sonnet-5-5-low', 'Sonnet 5.5', 'sonnet', 'low'],
    ['gpt-oss-120b', 'GPT-OSS 120B', 'other', undefined],
    // EVREN
    ['glm-5.3', 'GLM-5.3', 'other', undefined],
    ['deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'other', undefined],
    ['glm-5.3:high', 'GLM-5.3', 'other', 'high'],
  ]
  for (const [id, label, mascot, effort] of cases) {
    expect(modelLabel(id)).toBe(label)
    expect(mascotOf(id)).toBe(mascot)
    expect(splitEffort(id).effort).toBe(effort)
  }
  expect(modelLabel('gpt-6.1-sol')).not.toBe(modelLabel('gpt-6-sol'))
  expect(mascotFor({ id: 'ext:x', model: 'glm-5.3', via: 'evren' })).toBe('evren')
  // a model not known yet: never a bare dash, and the look of the family it is guessed to be
  expect(modelLabel(undefined)).toBe('reading model')
  expect(mascotFor({ id: 'wf-1', guess: 'claude-sonnet-5-5' })).toBe('sonnet')
  // every effort a CLI can give, in words and dots
  const efforts: Array<[unknown, string | undefined, string | undefined, number]> = [
    ['low', 'low', 'low', 1],
    ['medium', 'medium', 'medium', 2],
    ['high', 'high', 'high', 3],
    ['xhigh', 'xhigh', 'very high', 4],
    ['max', 'max', 'highest', 5],
    ['ultra', 'ultra', 'highest', 5],
    ['"ultra"', 'ultra', 'highest', 5],
    ['off', 'off', 'off', 0],
    ['HIGH', 'high', 'high', 3],
    [40, '40', 'medium', 2],
    ['12000', '12000', 'high', 3],
    ['persistent', 'persistent', 'highest', 5],
    ['banana', undefined, undefined, 0],
  ]
  for (const [raw, key, word, dots] of efforts) {
    expect(normEffort(raw)).toBe(key)
    expect(effortWord(normEffort(raw))).toBe(word)
    expect(effortLevel(normEffort(raw))).toBe(dots)
  }
  expect(modelLine('claude-sonnet-5-5', 'high')).toBe('Sonnet 5.5 · high')
  expect(modelLine('gemini-3.8-flash-high', undefined)).toBe('Gemini 3.8 Flash · high')
  expect(modelLine(undefined, undefined)).toBe('reading model')
})

test('outside CLIs are read in every form they are run in: quoted efforts, agy suffixes, EVREN swarms, the dated helper, wrappers', async () => {
  expect(readExternal('codex exec -m gpt-6.1-sol -c model_reasoning_effort="ultra" "x"')).toEqual({ cli: 'codex', model: 'gpt-6.1-sol', effort: 'ultra' })
  expect(readExternal(`codex exec -c 'model_reasoning_effort="high"' -m gpt-6-astra x`)).toEqual({ cli: 'codex', model: 'gpt-6-astra', effort: 'high' })
  expect(readExternal('codex exec -c model="gpt-6-luna" x')).toEqual({ cli: 'codex', model: 'gpt-6-luna' })
  expect(readExternal('codex -p evren exec "x"')).toEqual({ cli: 'codex', profile: 'evren' })
  expect(readExternal('codex exec -p evren -m glm-5.3 -c model_reasoning_effort=high -s workspace-write -C tmp --skip-git-repo-check -o o.txt "brief"')).toEqual({ cli: 'codex', profile: 'evren', model: 'glm-5.3', effort: 'high', sandbox: 'write' })
  // not a job: codex's own housekeeping, the helper's chores
  expect(readExternal('codex login')).toBeUndefined()
  expect(readExternal('python -I scripts/2026-11-08_claude_evren_suru.py help')).toBeUndefined()
  expect(readExternal('timeout 900 agy -p "brief" --model gemini-3.8-flash-high --mode plan --output-format json')).toEqual({ cli: 'agy', model: 'gemini-3.8-flash', effort: 'high', sandbox: 'read' })
  expect(readExternal(String.raw`%LOCALAPPDATA%\agy\bin\agy.exe -p "x" --model claude-opus-5-5-medium`)).toEqual({ cli: 'agy', model: 'claude-opus-5-5', effort: 'medium' })
  expect(readExternal('bash -c "agy -p x --model gemini-4-argon-low"')).toEqual({ cli: 'agy', model: 'gemini-4-argon', effort: 'low' })
  expect(readExternal('python -I scripts/2026-11-08_claude_evren_suru.py --veri genel --model glm-5.3:high,deepseek-v4.1-flash:high --istem a.txt')).toEqual({
    cli: 'evren',
    model: 'glm-5.3',
    effort: 'high',
    models: [
      { model: 'glm-5.3', effort: 'high' },
      { model: 'deepseek-v4.1-flash', effort: 'high' },
    ],
  })
  expect(readExternal('python -I C:/Tools/2026-11-08_claude_evren_suru.py --model deepseek-v4.1-flash --effort off --istem a.txt')).toEqual({ cli: 'evren', model: 'deepseek-v4.1-flash', effort: 'off' })
  expect(readExternal('cat 2026-11-08_claude_evren_suru.py')).toBeUndefined()
  expect(readCodexConfig('# yorum\nmodel = "gpt-6.1-terra"\nmodel_reasoning_effort = "medium"\n[profiles.x]\nmodel = "gpt-6-sol"\n')).toEqual({ model: 'gpt-6.1-terra', effort: 'medium' })
  expect(readCodexConfig('model = "glm-5.3"\nmodel_provider = "evren"\nmodel_reasoning_effort = "high"\n')).toEqual({ model: 'glm-5.3', effort: 'high' })
})

test('a desk is titled by what its worker is given and does, held steady, numbered when it repeats', async () => {
  const at = (task: string, extra: Partial<Worker> = {}) => titleFor({ kind: 'agent', task, activity: 'thinking', ...extra })
  expect(at('Search logs')).toBe('Explorer')
  expect(at('Review the code')).toBe('Auditor')
  expect(at('Find the bug causing the crash')).toBe('Detective')
  expect(at('Run the tests')).toBe('Test Engineer')
  expect(at('Logo design for the scene')).toBe('Designer')
  expect(at('Outline the architecture')).toBe('Architect')
  expect(at('Roadmap plan')).toBe('Planner')
  expect(at('Update the README')).toBe('Archivist')
  expect(at('Calculate usage cost')).toBe('Accountant')
  expect(at('Task')).toBe('Assistant')
  expect(titleFor({ kind: 'agent', task: 'Task', activity: 'thinking', type: 'Explore' })).toBe('Explorer')
  expect(titleFor({ kind: 'external', task: 'Review the code', activity: 'running' })).toBe('Outside Expert')
  expect(titleFor({ kind: 'agent', task: 'Review the code', activity: 'thinking' }, true)).toBe('Deputy Boss')
  // Current work: writing makes a Developer, even for a reviewer; running tests makes a Test Engineer.
  expect(at('Review the code', { activity: 'writing', screen: { kind: 'file-write', label: 'app.ts', at: 0 } })).toBe('Developer')
  expect(at('Task', { activity: 'running', screen: { kind: 'cmd', label: 'npm test', at: 0 } })).toBe('Test Engineer')
  expect(at('Task', { activity: 'web' })).toBe('Web Explorer')
  expect(at('Task', { activity: 'messaging' })).toBe('Messenger')
  expect(at('Refactor the code', { activity: 'writing', screen: { kind: 'file-write', label: 'app.ts', at: 0 } })).toBe('Cleaner')
  // steady: a new title only when it comes twice in a row
  expect(settleTitle('Explorer', undefined, 'Developer')).toEqual({ title: 'Explorer', next: 'Developer' })
  expect(settleTitle('Explorer', 'Developer', 'Developer')).toEqual({ title: 'Developer' })
  expect(settleTitle('Explorer', 'Developer', 'Explorer')).toEqual({ title: 'Explorer' })
  expect(settleTitle(undefined, undefined, 'Explorer')).toEqual({ title: 'Explorer' })
  // numbered: the smallest number free, never its own
  const office = [{ id: 'a', name: 'Developer' }, { id: 'b', name: 'Developer 2' }, { id: 'c', name: 'Explorer' }]
  expect(numberedName('Developer', office)).toBe('Developer 3')
  expect(numberedName('Developer', office, 'b')).toBe('Developer 2')
  expect(numberedName('Detective', office)).toBe('Detective')
})

test('a workflow’s agents sit as what they run on, their own CLIs take desks under them, and the count is every desk', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1' })
  on('fs.read', () => ({ value: '' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // the boss starts a workflow whose agents run Sonnet 5.5 at high effort; no agent.spawn is seen for them
  await $.tool.call({ tool: 'Workflow', script: "export const meta = { name: 'x', description: 'y', phases: [] }\nawait agent('a', { model: 'claude-sonnet-5-5', effort: 'high' })\nawait agent('b', { model: 'claude-sonnet-5-5', effort: 'high' })" })
  await $.tool.call({ tool: 'Read', file_path: 'C:/project/a.ts', agentId: 'wf-1' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/project/b.ts', agentId: 'wf-2' })
  // inside the workflow agents: an agy, a codex and an EVREN swarm run from the shell
  await $.tool.call({ tool: 'Bash', command: 'timeout 900 agy -p "brief" --model gemini-3.8-flash-high --mode plan', description: 'Gemini opinion', agentId: 'wf-1' })
  await $.tool.call({ tool: 'Bash', command: 'codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only "x"', description: 'Sol review', agentId: 'wf-2' })
  await $.tool.call({ tool: 'Bash', command: 'python -I scripts/2026-11-08_claude_evren_suru.py --veri genel --model glm-5.3:high,deepseek-v4.1-flash:high --istem a.txt', description: 'EVREN swarm', agentId: 'wf-2' })
  await clock.advance(1200)

  const term = await $.ui.mount(TERM)
  const rows = (await term.findAll({ type: 'Text', text: /^■ / })).map(r => r.text ?? '')
  // two workflow agents, one agy, one codex, two EVREN desks: six at work
  expect(rows).toHaveLength(6)
  expect(rows.filter(r => /Sonnet 5\.5 · high/.test(r))).toHaveLength(2)
  expect(rows.some(r => /Gemini 3\.8 Flash · high · Antigravity/.test(r))).toBe(true)
  expect(rows.some(r => /GPT-6\.1 Sol · high/.test(r))).toBe(true)
  expect(rows.some(r => /GLM-5\.3 · high/.test(r))).toBe(true)
  expect(rows.some(r => /DeepSeek V4\.1 Flash · high/.test(r))).toBe(true)
  for (const r of rows) expect(r).not.toMatch(/Agent \d|#\d|reading model|^■ \S+(?: \S+)?\s+—/)
  // each outside run reports to the workflow agent that started it
  expect((await term.find({ type: 'Text', text: /Deputy Boss 2 → Outside Expert 4 · EVREN swarm/ }))?.text).toMatch(/^✈/)
  await term.unmount()

  const desk = await $.ui.mount(DESK)
  const source = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('ch-pofu-sonnet-')
  expect(source).toContain('ch-yildiz-')
  expect(source).toContain('ch-evren-')
  expect(source).not.toContain('ch-diger-')
  expect(source).toContain('6/6')
  await desk.unmount()
})

test('a model learned after the seat replaces the placeholder: the Agent call’s record names it', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { agentId: 'late-1', resolvedModel: 'claude-haiku-5-5' })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // seated by its first tool call (before the office knew it): no model yet, never a dash
  await $.tool.call({ tool: 'Read', file_path: 'C:/project/a.ts', agentId: 'late-2' })
  await clock.advance(1200)
  let term = await $.ui.mount(TERM)
  expect((await term.find({ type: 'Text', text: /^■ Explorer/ }))?.text).toMatch(/reading model/)
  await term.unmount()
  // the Agent call's record names its agent's model
  await $.tool.call({ tool: 'Read', file_path: 'C:/project/b.ts', agentId: 'late-1' })
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
  await $.agent.spawn({ prompt: 'Search logs', description: 'Search logs', subagentType: 'Explore' })
  listed = [{ id: 'a1', description: 'Search logs', type: 'Explore', status: 'running' }]
  await clock.advance(1200)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '', agent_type: 'Explore', last_assistant_message: 'Done.' })
  // the list lags: still running long after the end; the worker stays done, leaves once and is not hired again
  for (let s = 0; s < 70; s++) await clock.advance(1000)
  const term = await $.ui.mount(TERM)
  expect(await term.findAll({ type: 'Text', text: /^■ Explorer/ })).toHaveLength(0)
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
async function teamRows($: Parameters<Parameters<typeof test>[1]>[0]): Promise<string[]> {
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
    return { turnId: 't1', index: 0, answer: '', toolUses: [] }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // the live screen's case: the agent's tool call comes before its agent.spawn
  await $.tool.call({ tool: 'Read', file_path: 'C:/project/a.ts', agentId: 'a1' })
  await clock.advance(1200)
  let rows = await teamRows($)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatch(/reading model/)
  // the spawn lands: its model, task and title are taken, not dropped
  await $.agent.spawn({ prompt: 'Find the cause of the bug', description: 'Find the cause of the bug', subagentType: 'general-purpose' })
  await clock.advance(1200)
  rows = await teamRows($)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatch(/^■ Detective\s+Opus 5\.5/)
  // its own step names what it runs on now, with the effort
  const step = ($ as unknown as { turn: { step: (e: Record<string, unknown>) => AsyncIterable<unknown> | Promise<unknown> } }).turn.step({ turnId: 't1', index: 0, agentId: 'a1', model: 'claude-sonnet-5-5', effort: 'high', messages: [] })
  if (step && Symbol.asyncIterator in (step as object)) for await (const _ of step as AsyncIterable<unknown>) void _
  else await step
  await clock.advance(1200)
  rows = await teamRows($)
  expect(rows[0]).toMatch(/Sonnet 5\.5 · high/)
  // inside it: a PowerShell-continued codex and a bash-continued agy take desks; a commit message naming codex starts nothing
  await $.tool.call({ tool: 'PowerShell', command: "codex exec `\n  -m gpt-6-astra `\n  -c model_reasoning_effort=medium 'x'", description: 'Astra opinion', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'agy -p "x" \\\n  --model gemini-3.8-flash-high', description: 'Flash opinion', agentId: 'a1' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix; codex exec -m gpt-6-sol"', description: 'commit', agentId: 'a1' })
  await clock.advance(1200)
  rows = await teamRows($)
  expect(rows).toHaveLength(3)
  expect(rows.some(r => /^■ Outside Expert.*GPT-6 Astra · medium/.test(r))).toBe(true)
  expect(rows.some(r => /^■ Outside Expert.*Gemini 3\.8 Flash · high/.test(r))).toBe(true)
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
  expect(modelLine('Gemini 3.8 Flash (High)', undefined)).toBe('Gemini 3.8 Flash · high')
  expect(modelLine('Claude Opus 5.5 (Medium)', undefined)).toBe('Opus 5.5 · medium')
  // '-max' is a part of a name; EVREN's ':max' is an effort
  expect(splitEffort('qwen3-max')).toEqual({ model: 'qwen3-max' })
  expect(modelLabel('qwen3-max')).toBe('Qwen 3 Max')
  expect(modelLabel('gpt-6.1-codex-max')).toBe('GPT-6.1 Codex Max')
  expect(splitEffort('glm-5.3:max')).toEqual({ model: 'glm-5.3', effort: 'max' })
  expect(readExternal('uv run evren_suru.py -m qwen3-max "x"')).toEqual({ cli: 'evren', model: 'qwen3-max' })
  // English words of the scale
  expect(normEffort('very high')).toBe('xhigh')
  expect(normEffort('highest')).toBe('max')
  expect(effortWord('xhigh')).toBe('very high')
  // a separator stuck to the model; a quoted path with spaces; npx and wsl
  expect(readExternal('codex exec -m gpt-6-sol&& echo ok')).toEqual({ cli: 'codex', model: 'gpt-6-sol' })
  expect(readExternal('codex exec -m gpt-6.1-sol|tee out.txt')).toEqual({ cli: 'codex', model: 'gpt-6.1-sol' })
  expect(readExternal('"C:\\Program Files\\agy\\agy.exe" -p hi --model gemini-4-argon-high')).toEqual({ cli: 'agy', model: 'gemini-4-argon', effort: 'high' })
  expect(readExternal('npx codex exec -m gpt-6.1-sol')).toEqual({ cli: 'codex', model: 'gpt-6.1-sol' })
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
    const svg = hudSvg({ workers, usage, turn: { active: true, steps: 1, turns: 1, prompt: 'x', model: 'claude-sonnet-5-5', effort: 'high' }, now: T0, motion: true, width: W, fill: H }).svg
    const text = svg.replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<[^>]+>/g, '')
    for (const line of ['Opus 5.5', 'Sonnet 5.5', 'GPT-6.1 Sol', 'GPT-6 Sol', 'GPT-6.1 Terra', 'GPT-6 Luna', 'GPT-6 Astra', 'Gemini 4 Argon', 'Gemini 3.8 Flash', 'Fable 5.1']) {
      // Whole on one line or wrapped at the last word (Gemini 3.8 / Flash with high effort), never cropped.
      const at = line.lastIndexOf(' ')
      const whole = text.includes(line) || text.includes(`${line.slice(0, at)}${line.slice(at + 1)} · `)
      expect(`${W}x${H} ${line} ${whole}`).toBe(`${W}x${H} ${line} true`)
    }
    expect(text).not.toMatch(/(?:Opus|Sonnet|GPT|Gemini|Fable)[^<·]{0,12}…/)
  }
})

test('a drawing’s desks read as one set: one plate size, one title size, the state on every plate or on none, and the scoreboard keeps AGENT', () => {
  const models: Array<[string, string | undefined, Worker['via']?]> = [
    ['claude-opus-5-5', 'medium'], ['claude-sonnet-5-5', 'high'], ['gpt-6.1-sol', 'xhigh'], ['gpt-6-sol', 'high'], ['gpt-6.1-terra', 'high'],
    ['gpt-6-luna', 'low'], ['gpt-6-astra', 'medium'], ['gemini-4-argon-high', undefined, 'agy'], ['gemini-3.8-flash-high', undefined, 'agy'], ['claude-fable-5-1', 'max'],
  ]
  const titles = ['Developer', 'Detective', 'Outside Expert', 'Outside Expert 2', 'Outside Expert 3', 'Outside Expert 4', 'Outside Expert 5', 'Outside Expert 6', 'Outside Expert 7', 'Test Engineer']
  const workers = crew(10).map((w, i) => {
    const m = models[i - 1]
    if (i === 0 || !m) return w
    return { ...w, name: titles[i - 1] as string, model: m[0], effort: m[1], via: m[2], kind: m[2] ? ('external' as const) : ('agent' as const), activity: 'writing' as Activity, screen: { kind: 'file-write' as const, label: 'scene.ts', at: T0 } }
  })
  const usage = { ctxPct: 20, ctxTokens: 200_000, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: 40 }], at: T0, history: [10, 20] }
  for (const [W, H] of [[1700, 1000], [2400, 1400], [700, 1200]] as Array<[number, number]>) {
    const svg = hudSvg({ workers, usage, turn: { active: true, steps: 1, turns: 6, prompt: 'x', model: 'claude-haiku-5-5', effort: 'low' }, now: T0, motion: true, width: W, fill: H, daily: { day: '2026-11-08', usd: 38.1, sessions: 4, at: T0 }, stats: { tools: { Read: 60 }, hired: 10, outTokens: 1, inTokens: 1, cacheRead: 0, sessionStart: T0 - 3_600_000, done: 0, failed: 0, reports: 0, messages: 0, inbound: 0 } } as Parameters<typeof hudSvg>[0]).svg
    const texts = [...svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)].map(m => ({ fs: m[1] as string, t: (m[2] as string).replace(/<[^>]+>/g, '') }))
    const plates = texts.filter(x => /^(Opus|Sonnet|GPT|Gemini|Fable)/.test(x.t) && !/·.*·/.test(x.t))
    expect(`${W}x${H} plates ${plates.length >= 10}`).toBe(`${W}x${H} plates true`)
    expect(`${W}x${H} plate sizes ${new Set(plates.map(p => p.fs)).size}`).toBe(`${W}x${H} plate sizes 1`)
    const named = texts.filter(x => titles.includes(x.t))
    expect(`${W}x${H} title sizes ${new Set(named.map(p => p.fs)).size <= 1}`).toBe(`${W}x${H} title sizes true`)
    const told = (svg.replace(/<title>[\s\S]*?<\/title>/g, '').match(/Writing|Running command/g) ?? []).length
    expect(`${W}x${H} state ${told === 0 || told >= 10}`).toBe(`${W}x${H} state true`)
    const board = svg.replace(/<[^>]+>/g, '')
    expect(`${W}x${H} ${board.includes('AGENT')} ${board.includes('10/10')}`).toBe(`${W}x${H} true true`)
  }
})

test('a short file name loses its extension before it is cut, and Fable and Astra carry their own mark on a shared sheet', () => {
  expect(ellipsize('scene.ts', textWidth('scene', 8) + 0.5, 8)).toBe('scene')
  expect(ellipsize('scene.ts', textWidth('scene.ts', 8) + 0.5, 8)).toBe('scene.ts')
  expect(markOf('fable')).toBe('book')
  expect(markOf('astra')).toBe('star')
  expect(markOf('opus')).toBeUndefined()
  expect(markOf('sol')).toBeUndefined()
  const plain = drawCharacter(charKindOf('fable'), 'work', 50, 80, 30)
  const marked = drawCharacter(charKindOf('fable'), 'work', 50, 80, 30, { mark: 'book' })
  expect(marked.length).toBeGreaterThan(plain.length)
  expect(marked).toContain('#F5EBDD')
  expect(drawCharacter(charKindOf('astra'), 'work', 50, 80, 30, { mark: 'star' })).toContain('#FDE68A')
})

// --- 0.9 activity animations: tool mapping, conflict rules, stable transitions and budget ---

const N9 = 1_900_000_000_000
type Want = { main?: string; ev?: string }
const callOf = (tool: string, extra: Partial<ToolFacts> = {}, trail: ActMark[] = [], seed = 'tu-1'): ActPick => pickActivity({ tool, phase: 'call', ...extra }, trail, seed, N9)
const resultOf = (tool: string, extra: Partial<ToolFacts> = {}): ActPick => pickActivity({ tool, phase: 'result', ...extra }, [], 'tu-1', N9)
const got = (p: ActPick): Want => ({ ...(p.main ? { main: p.main } : {}), ...(p.ev ? { ev: p.ev } : {}) })
const FAIL: ActMark[] = [{ t: N9 - 1000, f: 1 }]
const AUDIT: ActMark[] = [{ t: N9 - 1000, id: 'checklist-audit', s: 'audit' }]
const worker9 = (extra: Partial<Worker> = {}): Worker => ({ id: 'a1', n: 0, name: 'Developer', role: 'General', task: '', color: '#5B8FC7', seat: 0, activity: 'writing', bubble: '', detail: '', tools: 3, tokensOut: 0, since: N9 - 2000, joinedAt: N9 - 60_000, ...extra })
const ctx9 = (extra: Partial<ActCtx> = {}): ActCtx => ({ now: N9, isBoss: false, fat: 0, limitFull: false, teamBusy: 0, criticBusy: false, kind: 'pofu', external: false, ...extra })

test('0.9: every row of the tool table picks its activity (call and result)', () => {
  const rows: Array<[string, Partial<ToolFacts>, ActMark[], Want]> = [
    ['Read', { file: 'C:/p/logo.PNG' }, [], { main: 'magnify-eye' }],
    ['Read', { file: 'C:/p/app.ts' }, [], { main: 'code-read' }],
    ['Read', { file: 'C:/p/server.log' }, [], { main: 'detective-hunt' }],
    ['Read', { file: 'C:/p/app.ts' }, FAIL, { main: 'detective-hunt' }],
    ['Read', { file: 'C:/p/app.ts' }, AUDIT, {}],
    ['Write', { file: 'C:/project/.claude/MEMORY.md' }, [], { main: 'memory-brain' }],
    ['Edit', { file: 'C:/project/memory/Decisions.md' }, [], { main: 'memory-brain' }],
    ['Write', { file: 'C:/p/notes.md' }, [], { main: 'quill-write' }],
    ['Write', { file: 'C:/p/x.ts' }, [], { main: 'type-fast' }],
    ['Edit', { file: 'C:/p/x.ts' }, FAIL, { main: 'bug-fix' }],
    ['Edit', { file: 'C:/p/x.ts' }, [{ t: N9, s: 'refactor' }], { main: 'broom-cleanup' }],
    ['MultiEdit', { file: 'C:/p/notes.md' }, [], { main: 'type-fast' }],
    ['Bash', { cmd: 'cd app && npm test' }, [], { main: 'test-tube' }],
    ['Bash', { cmd: 'claude.exe plugin test C:/mod' }, [], { main: 'test-tube' }],
    ['Bash', { cmd: 'git push origin main' }, [], { ev: 'deploy-rocket' }],
    ['Bash', { cmd: 'npx wrangler deploy' }, [], { ev: 'deploy-rocket' }],
    ['Bash', { cmd: 'git push origin feat/activity' }, [], { main: 'git-branch' }],
    ['Bash', { cmd: 'git commit -m "x"' }, [], { main: 'git-branch' }],
    ['Bash', { cmd: 'npm run dev', bg: true }, [], { main: 'security-cam' }],
    ['PowerShell', { cmd: 'Get-Content app.log -Wait' }, [], { main: 'security-cam' }],
    ['Bash', { cmd: 'npm install' }, [], { main: 'compile-wait' }],
    ['Bash', { cmd: 'npx -y -p typescript@5.9.3 tsc -p tsconfig.json --noEmit' }, [], { main: 'compile-wait' }],
    ['Bash', { cmd: 'zip -r backup.zip src' }, [], { ev: 'archive-boxes' }],
    ['Bash', { cmd: 'rm -rf build' }, [], { main: 'broom-cleanup' }],
    ['Bash', { cmd: 'sqlite3 data.db ".tables"' }, [], { main: 'database-barrel' }],
    ['Bash', { cmd: 'cat a.json | jq .x' }, [], { main: 'funnel-filter' }],
    ['Bash', { cmd: 'python -c "print(2**10)"' }, [], { main: 'abacus-calc' }],
    ['Bash', { cmd: 'diff a.txt b.txt' }, [], { main: 'scale-compare' }],
    ['Bash', { cmd: 'ls -la src' }, [], { main: 'map-explore' }],
    ['Bash', { cmd: 'rg "useState" src' }, [], { main: 'library-shelf' }],
    ['Bash', { cmd: 'curl -s https://example.com' }, [], { main: 'radar-scan' }],
    ['Bash', { cmd: 'gh pr checks 12' }, [], { main: 'binoculars' }],
    ['Bash', { cmd: 'node scripts/x.js', text: 'Run the script' }, [], {}],
    ['Bash', { cmd: 'codex exec -m gpt-6.1-terra "review"', external: true }, [], { main: 'radio-call' }],
    ['Grep', { text: 'TypeError|exception' }, [], { main: 'detective-hunt' }],
    ['Grep', { text: 'useState' }, [], { main: 'library-shelf' }],
    ['Glob', {}, [], { main: 'library-shelf' }],
    ['WebSearch', {}, [], { main: 'globe-spin' }],
    ['WebFetch', {}, [], { main: 'radar-scan' }],
    ['TodoWrite', {}, [], { main: 'plan-blueprint' }],
    ['mcp__ccd_turn__update_plan', {}, [], { main: 'plan-blueprint' }],
    ['Agent', { agentType: 'Explore' }, [], { main: 'radio-call' }],
    ['SendMessage', { text: 'Handoff: leaving the task to you' }, [], { ev: 'handoff-baton' }],
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
    ['Skill', { skill: 'system-design' }, [], { main: 'plan-blueprint' }],
    ['Skill', { skill: 'remotion-render' }, [], { main: 'film-shoot' }],
    ['Skill', { skill: 'ai-image-video-studio' }, [], { main: 'paint-canvas' }],
    ['Skill', { skill: 'social-media-skills:suno' }, [], { main: 'music-compose' }],
    ['Skill', { skill: 'doc-coauthoring' }, [], { main: 'quill-write' }],
    ['Skill', { skill: 'product-management:brainstorm' }, [], { ev: 'idea-bulb' }],
    ['Skill', { skill: 'data:analyze' }, [], { main: 'chart-grow' }],
    ['Skill', { skill: 'sample-skills:xlsx' }, [], { main: 'spreadsheet-fill' }],
    ['Skill', { skill: 'searchfit-seo:translate-content' }, [], { main: 'dictionary-translate' }],
    ['Skill', { skill: 'consolidate-memory' }, [], { main: 'memory-brain' }],
    ['Skill', { skill: 'sample-skills:deep-research' }, [], { main: 'globe-spin' }],
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
  // Result phase: agent return, denial, 429, failed tests and general errors.
  expect(got(resultOf('Agent'))).toEqual({ ev: 'handoff-baton' })
  expect(got(resultOf('Bash', { cmd: 'ls', denied: true, failed: true }))).toEqual({ ev: 'shield-guard' })
  expect(got(resultOf('WebFetch', { failed: true, out: 'HTTP 429 Too Many Requests' }))).toEqual({ ev: 'queue-ticket' })
  expect(got(resultOf('Bash', { cmd: 'npm test', failed: true }))).toEqual({ main: 'test-tube_fail' })
  const err = resultOf('Bash', { cmd: 'node x.js', failed: true })
  expect(got(err)).toEqual({ ev: 'error-sparks' })
  expect(err.mark.f).toBe(1)
  expect(got(resultOf('Read', {}))).toEqual({})
  // SendMessage: 85 percent paper plane, otherwise flag; deterministic by seed, never both.
  const planes = Array.from({ length: 200 }, (_, i) => callOf('SendMessage', { text: 'Tests finished' }, [], `msg-${i}`).ev)
  expect(planes.every(e => e === 'paper-plane' || e === 'handoff-baton')).toBe(true)
  const share = planes.filter(e => e === 'paper-plane').length / planes.length
  expect(share).toBeGreaterThan(0.7)
  expect(share).toBeLessThan(0.97)
  expect(callOf('SendMessage', {}, [], 'msg-7').ev).toBe(callOf('SendMessage', {}, [], 'msg-7').ev)
})

test('0.9: keywords read skills, MCP names, agent types and task text; short tokens only as whole names', () => {
  expect(hireAct('Draw the logo for the home page', 'general-purpose', false, 'a1', N9)?.id).toBe('paint-canvas')
  expect(hireAct('Translate this text into English', undefined, false, 'a1', N9)?.id).toBe('dictionary-translate')
  expect(callOf('Skill', { skill: 'sample-skills:ai-image-video-studio' }).main).toBe('paint-canvas')
  // Prose form does not trigger rm, detail does not trigger ls, and task/agent do not trigger radio calls.
  expect(keywordAct(['Bash'], 'fill the form and show the detail of the task for the agent', 's')).toBeUndefined()
  expect(keywordAct(['rm'], undefined, 's')).toBe('broom-cleanup')
  expect(keywordAct(['rmdir'], undefined, 's')).toBeUndefined()
  // Prose cannot trigger event-class activities; exception text does not create sparks.
  expect(keywordAct([], 'handle the exception path', 's')).toBeUndefined()
  // Equal priority (70): seeded probability weight, deterministic, with both candidates reachable.
  const pair = new Set(Array.from({ length: 40 }, (_, i) => keywordAct(['suno generate_image'], undefined, `s${i}`)))
  expect([...pair].sort()).toEqual(['music-compose', 'paint-canvas'])
  expect(keywordAct(['suno generate_image'], undefined, 'x')).toBe(keywordAct(['suno generate_image'], undefined, 'x'))
  // Explore agent: 60 percent map, 40 percent shelf, deterministic by seed.
  const ex = Array.from({ length: 100 }, (_, i) => hireAct('Explore the code', 'Explore', false, `e${i}`, N9)?.id)
  expect([...new Set(ex)].sort()).toEqual(['library-shelf', 'map-explore'])
  expect(hireAct('Explore the code', 'Explore', false, 'e3', N9)?.id).toBe(hireAct('Explore the code', 'Explore', false, 'e3', N9)?.id)
  // Variants and layers have no triggers of their own.
  expect(ACT_TRIGGERS.some(([, id]) => /_fail|_sapka|_misir/.test(id))).toBe(false)
  expect(ACT_TRIGGERS.every(([tok]) => tok.length > 0 && tok.length < 40 && !tok.includes('('))).toBe(true)
})

test('0.9: the 22 conflict rules decide between candidates', () => {
  // 1 code-review starts an audit; Read/Grep produce no new candidate while it continues.
  const cr = callOf('Skill', { skill: 'code-review' })
  expect(got(cr)).toEqual({ main: 'checklist-audit' })
  expect(got(callOf('Read', { file: 'a.ts' }, [cr.mark]))).toEqual({})
  expect(got(callOf('Grep', { text: 'foo' }, [cr.mark]))).toEqual({})
  // 2 Security audit with shield.
  expect(callOf('Skill', { skill: 'security-review' }).main).toBe('shield-guard')
  // 3 Agent call uses radio (main), return uses flag (ev), leaving main unchanged.
  let st = applyPick(undefined, callOf('Agent'), N9)
  st = applyPick(st, resultOf('Agent'), N9 + 5000)
  expect(st.id).toBe('radio-call')
  expect(st.ev?.id).toBe('handoff-baton')
  expect(st.ev && st.ev.until - st.ev.at).toBe(2000)
  // 4 Handoff yields only a flag.
  expect(got(callOf('SendMessage', { text: 'handoff: over to you' }))).toEqual({ ev: 'handoff-baton' })
  // 5 Permission denial: shield, no sparks.
  expect(got(resultOf('Edit', { denied: true, failed: true }))).toEqual({ ev: 'shield-guard' })
  // 6 Failed tests: variant without sparks; validate-data filters, plain validate tests.
  expect(got(resultOf('Bash', { cmd: 'pytest -q', failed: true }))).toEqual({ main: 'test-tube_fail' })
  expect(keywordAct([], 'run validate-data on the csv', 's')).toBe('funnel-filter')
  expect(keywordAct([], 'please validate it', 's')).toBe('test-tube')
  // 7 denetim sonucu
  expect(callOf('ReportFindings', { findings: 2 }).main).toBe('checklist-audit_fail')
  // 8 Debug: investigation uses detective, then Edit fixes bugs; unrelated Edit codes.
  const dbg = callOf('Skill', { skill: 'engineering:debug' })
  expect(dbg.main).toBe('detective-hunt')
  expect(callOf('Edit', { file: 'a.ts' }, [dbg.mark]).main).toBe('bug-fix')
  expect(callOf('Edit', { file: 'a.ts' }).main).toBe('type-fast')
  // 9 Edit precedence: memory > prose > bug > cleanup > code.
  expect(callOf('Edit', { file: 'C:/x/CLAUDE.md' }, FAIL).main).toBe('memory-brain')
  expect(callOf('Write', { file: 'report.docx' }, FAIL).main).toBe('quill-write')
  expect(callOf('Edit', { file: 'a.ts' }, [...FAIL, { t: N9, s: 'refactor' }]).main).toBe('bug-fix')
  // 10 Reading: image, source, directory.
  expect(callOf('Read', { file: 'a.jpg' }).main).toBe('magnify-eye')
  expect(callOf('Bash', { cmd: 'tree src' }).main).toBe('map-explore')
  // 11 graphify
  expect(callOf('mcp__graphify__get_neighbors').main).toBe('code-read')
  expect(callOf('mcp__graphify__graph_stats').main).toBe('map-explore')
  // 12 Git push: main branch launches rocket, other branches use Git.
  expect(got(callOf('Bash', { cmd: 'git push -u origin release-notes' }))).toEqual({ main: 'git-branch' })
  expect(got(callOf('Bash', { cmd: 'git push origin HEAD:production' }))).toEqual({ ev: 'deploy-rocket' })
  // 13 worktree
  expect(callOf('EnterWorktree').main).toBe('git-branch')
  expect(callOf('mcp__ccd_host__discard_kept_worktree').main).toBe('broom-cleanup')
  // 14 Archive and cleanup.
  expect(callOf('Bash', { cmd: 'tar czf a.tgz src' }).ev).toBe('archive-boxes')
  expect(callOf('Bash', { cmd: 'npx eslint --fix src' }).main).toBe('broom-cleanup')
  // 15 Background uses camera; unknown foreground command compiles after eight seconds.
  expect(callOf('Bash', { cmd: 'node server.js', bg: true }).main).toBe('security-cam')
  const slow = worker9({ activity: 'running', tool: 'Bash', since: N9 - 9000, act: { id: 'code-read', at: N9 - 20_000, seen: N9 - 20_000 } })
  expect(actView(slow, ctx9()).main?.id).toBe('compile-wait')
  expect(actView({ ...slow, since: N9 - 3000 }, ctx9()).main?.id).toBe('code-read')
  // 16 wrap_up: temiz konfeti, kirli megafon
  expect(callOf('mcp__ccd_turn__wrap_up').ev).toBe('confetti-party')
  expect(callOf('mcp__ccd_turn__wrap_up', {}, FAIL).main).toBe('megaphone-announce')
  // 17 Rate limit: short 429 gives a queue ticket canceled by the next call; boss sleeps at a full five-hour limit.
  let q = applyPick(undefined, resultOf('WebSearch', { failed: true, out: '529 overloaded' }), N9)
  expect(q.ev?.id).toBe('queue-ticket')
  q = applyPick(q, callOf('WebSearch'), N9 + 4000)
  expect(q.ev).toBeUndefined()
  const boss = worker9({ id: 'boss', activity: 'thinking' })
  expect(actView(boss, ctx9({ isBoss: true, limitFull: true })).main?.id).toBe('nap-zzz')
  // 18 Idle at desk: nothing for 0-2 minutes, coffee for 2-10, sleep at 10 or more.
  const idle = (ms: number) => actView(worker9({ activity: 'idle', since: N9 - ms }), ctx9()).main?.id
  expect(idle(60_000)).toBeUndefined()
  expect(idle(3 * 60_000)).toBe('coffee-break')
  expect(idle(12 * 60_000)).toBe('nap-zzz')
  // 19 Context load affects only the boss.
  expect(actView(boss, ctx9({ isBoss: true, ctxPct: 88 })).over?.id).toBe('overheat-sweat')
  expect(actView(boss, ctx9({ isBoss: true, ctxPct: 97 })).main?.id).toBe('nap-zzz')
  expect(actView(worker9(), ctx9({ ctxPct: 97 })).main?.id).not.toBe('nap-zzz')
  // 20 Error: sparks and trail; a later log read investigates.
  const sp = resultOf('Bash', { cmd: 'node x.js', failed: true })
  expect(sp.ev).toBe('error-sparks')
  expect(callOf('Read', { file: 'a.ts' }, pushMark([], sp.mark)).main).toBe('detective-hunt')
  // 21 Video: popcorn only while waiting for a render and when hash(worker id + time) is even.
  const film = (id: string, s?: ActMark['s']) => actView(worker9({ id, activity: 'running', tool: 'mcp__x__video_render', act: { id: 'film-shoot', at: N9 - 1000, seen: N9 - 1000 }, trail: [{ t: N9 - 1000, id: 'film-shoot', ...(s ? { s } : {}) }] }), ctx9())
  const ids = Array.from({ length: 12 }, (_, i) => `v${i}`)
  expect(ids.some(i => film(i, 'video').extra?.[0]?.id === 'film-shoot_misir')).toBe(true)
  expect(ids.some(i => film(i, 'video').extra === undefined)).toBe(true)
  expect(ids.every(i => film(i).extra === undefined)).toBe(true)
  expect(callOf('mcp__x__video_render').mark.s).toBe('video')
  // 22 Variant applies immediately; detective wears a hat.
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
  // Start time changes only when the activity changes.
  const held = seq([RD, RD, RD]).st
  expect(held?.at).toBe(N9)
  expect(held?.seen).toBe(N9 + 2000)
  // Variant applies immediately.
  expect(settleAct({ id: 'test-tube', at: N9, seen: N9 }, 'test-tube_fail', N9 + 1).id).toBe('test-tube_fail')
  // Event does not change main; main reappears afterward. The same event cannot restart within its duration.
  let st: ActState = { id: 'type-fast', at: N9, seen: N9 }
  st = withEv(st, 'error-sparks', N9 + 100)
  const at = st.ev?.at
  st = withEv(st, 'error-sparks', N9 + 500)
  expect(st.ev?.at).toBe(at)
  expect(st.id).toBe('type-fast')
  // Lower-priority events do not interrupt a running one.
  expect(withEv(st, 'archive-boxes', N9 + 600).ev?.id).toBe('error-sparks')
  const w = worker9({ act: st, since: N9 })
  expect(actView(w, ctx9({ now: N9 + 300 })).ev?.id).toBe('error-sparks')
  const after = actView(w, ctx9({ now: (st.ev?.until ?? 0) + 1 }))
  expect(after.ev).toBeUndefined()
  expect(after.main?.id).toBe('type-fast')
  // 60-second hold: an old main drops after 60 seconds while thinking.
  expect(actView(worker9({ activity: 'thinking', act: { id: 'type-fast', at: N9 - 30_000, seen: N9 - 30_000 } }), ctx9()).main?.id).toBe('type-fast')
  expect(actView(worker9({ activity: 'thinking', act: { id: 'type-fast', at: N9 - 90_000, seen: N9 - 90_000 } }), ctx9()).main).toBeUndefined()
  // Finish clears main and retains confetti.
  const end = endAct({ id: 'type-fast', at: N9, seen: N9 }, false, N9 + 10)
  expect(end.id).toBeUndefined()
  expect(end.ev?.id).toBe('confetti-party')
  // An office with active workers renders the same picture three seconds apart, excluding animation times.
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#D97757', seat: -1, activity: 'thinking', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9 - 5000, joinedAt: N9 - 999_999, act: { id: 'plan-blueprint', at: N9 - 5000, seen: N9 - 5000 } },
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
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#D97757', seat: -1, activity: 'planning', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9 - 5000, joinedAt: N9 - 999_999, model: 'claude-opus-5-5', act: { id: 'plan-blueprint', at: N9 - 5000, seen: N9 - 5000 } },
  ]
  const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gemini-3-pro', 'gemini-3-flash', 'glm-5.3', 'mistral-large']
  acts.forEach((id, i) => {
    workers.push(worker9({ id: `w${i}`, n: i, seat: i, name: `Worker ${i}`, activity: 'running', tool: 'Edit', model: models[i % models.length], since: N9 - 1000, act: { id, at: N9 - 1000, seen: N9 - 1000, ...(i % 5 === 0 ? { ev: { id: 'confetti-party', at: N9 - 200, until: N9 + 1400 } } : {}) } }))
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
  // Plan: preserve boss props, omit priorities no higher than retained ones, and return the same set for the same input.
  const views = new Map<string, ActView>()
  for (const w of workers) views.set(w.id, actView(w, ctx9({ isBoss: w.id === 'boss', kind: 'pofu' })))
  const cap = 9000
  const kept = planActs(views, cap)
  expect(kept.has('plan-blueprint')).toBe(true)
  expect([...planActs(views, cap)].sort()).toEqual([...kept].sort())
  const mainPrio = (keep: boolean) => [...views].filter(([who, v]) => who !== 'boss' && v.main && !v.ev && kept.has(v.main.strip) === keep).map(([, v]) => ACTS[v.main?.id ?? '']?.prio ?? 0)
  const dropped = mainPrio(false)
  expect(dropped.length).toBeGreaterThan(0)
  expect(Math.max(...dropped)).toBeLessThanOrEqual(Math.min(...mainPrio(true)))
  // Defs: only used and allowed strips within the ceiling; clear the registry afterward.
  actDefs(new Set())
  for (const s of kept) actUse(s, s)
  actUse('nap-zzz', 'nap-zzz')
  const defs = actDefs(kept)
  expect(defs).not.toContain('id="ac-nap-zzz"')
  expect(defs.length).toBeLessThanOrEqual(cap + 200)
  expect(actDefs(kept)).toBe('')
})

test('0.9: conditions: an outside worker on the line, idle desks, tired office, the hat only crops head accessories', () => {
  // Outside worker: family headset and three-second radio call; then On outside line.
  const ext = hireAct('Review the code', undefined, true, 'ext:1', N9) as ActState
  expect(ext.id).toBe('headset-listen')
  expect(ext.ev).toEqual({ id: 'radio-call', at: N9, until: N9 + 3000 })
  const xw = worker9({ id: 'ext:1', kind: 'external', activity: 'running', tool: 'Bash', act: ext, since: N9 })
  const during = actView(xw, ctx9({ kind: 'dunya', external: true, now: N9 + 1000 }))
  expect(during.main?.strip).toBe('headset-listen')
  expect(during.ev?.id).toBe('radio-call')
  expect(during.label).toBe('On outside line')
  expect(actView(xw, ctx9({ kind: 'dunya', external: true, now: N9 + 4000 })).label).toBe('On outside line')
  expect(stripFor('headset-listen', 'gunes')).toBe('headset-listen_l')
  expect(stripFor('headset-listen', 'kristal')).toBe('headset-listen')
  expect(stripFor('headset-listen', 'evren')).toBe('headset-listen_evren')
  expect(stripFor('headset-listen', 'pofu-opus')).toBe('headset-listen_l')
  for (const [kind, strip] of [['pofu', 'headset-listen_l'], ['pofu-sonnet', 'headset-listen_l'], ['pofu-haiku', 'headset-listen_s'], ['pofu-boss', 'headset-listen_l'], ['ay', 'headset-listen_l'], ['yildiz', 'headset-listen_l'], ['diger', 'headset-listen_l']] as const) expect(stripFor('headset-listen', kind)).toBe(strip)
  // Even a long outside job keeps its headset instead of changing unknown Bash activity to compilation.
  expect(actView({ ...xw, since: N9 - 60_000 }, ctx9({ kind: 'dunya', external: true })).main?.id).toBe('headset-listen')
  // Fatigue reduces speed; an exhausted office sweats on low-priority work and sleeps when idle, retaining high-priority work.
  const busy = worker9({ act: { id: 'type-fast', at: N9, seen: N9 } })
  expect(actView(busy, ctx9({ fat: 1 })).speed).toBe(0.85)
  expect(actView(busy, ctx9({ fat: 2 })).over?.id).toBe('overheat-sweat')
  const tired = actView(busy, ctx9({ fat: 3 }))
  expect(tired.main?.id).toBe('overheat-sweat')
  expect(tired.over).toBeUndefined()
  expect(tired.speed).toBe(0.5)
  expect(actView(worker9({ act: { id: 'paint-canvas', at: N9, seen: N9 } }), ctx9({ fat: 3 })).main?.id).toBe('paint-canvas')
  expect(actView(worker9({ activity: 'idle', since: N9 - 3 * 60_000 }), ctx9({ fat: 3 })).main?.id).toBe('nap-zzz')
  // Do not add an overlay when a head-anchored activity is present.
  expect(actView(worker9({ act: { id: 'memory-brain', at: N9, seen: N9 } }), ctx9({ fat: 2 })).over).toBeUndefined()
  // Long job: 30 minutes or 150 tool calls.
  expect(actView(worker9({ joinedAt: N9 - 31 * 60_000 }), ctx9()).over?.id).toBe('overheat-sweat')
  // Boss supervises a working team, arbitrates with a critic and drinks coffee while waiting.
  const boss = worker9({ id: 'boss', activity: 'delegating' })
  expect(actView(boss, ctx9({ isBoss: true, teamBusy: 3 })).main?.id).toBe('binoculars')
  expect(actView(boss, ctx9({ isBoss: true, teamBusy: 3, criticBusy: true })).main?.id).toBe('checklist-audit')
  expect(actView({ ...boss, activity: 'waiting' }, ctx9({ isBoss: true })).main?.id).toBe('coffee-break')
  expect(actView({ ...boss, activity: 'idle' }, ctx9({ isBoss: true })).main).toBeUndefined()
  // Hat crops the accessory above the head while preserving the face and plain heads.
  expect(hatCrop('pofu-sonnet')).toBe(18)
  expect(hatCrop('pofu-haiku')).toBe(18)
  expect(hatCrop('pofu-boss')).toBe(15)
  expect(hatCrop('pofu')).toBeUndefined()
  expect(hatCrop('pofu-opus')).toBeUndefined()
  expect(hatCrop('dunya')).toBeUndefined()
})

test('0.9: labels are short English single lines, one per activity; the desk plate says what the worker does', () => {
  const labels = Object.values(ACT_LABEL)
  expect(new Set(labels).size).toBe(labels.length)
  for (const l of [...labels, EXTERNAL_LABEL]) {
    expect([l, l.length <= 16, /\n/.test(l)]).toEqual([l, true, false])
  }
  for (const e of Object.values(ACTS)) if (e.role === 'ana' || e.role === 'varyant') expect([e.id, typeof ACT_LABEL[e.id]]).toEqual([e.id, 'string'])
  expect(actView(worker9({ activity: 'waiting', act: { id: 'type-fast', at: N9, seen: N9 } }), ctx9()).label).toBeUndefined()
  const workers: Worker[] = [
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#D97757', seat: -1, activity: 'idle', bubble: '', detail: '', tools: 0, tokensOut: 0, since: N9, joinedAt: N9 - 999_999 },
    worker9({ id: 'a1', activity: 'writing', tool: 'Edit', act: { id: 'type-fast', at: N9 - 1000, seen: N9 - 1000 } }),
    worker9({ id: 'a2', n: 1, seat: 1, name: 'Explorer', activity: 'waiting', act: { id: 'type-fast', at: N9 - 1000, seen: N9 - 1000 } }),
  ]
  const usage = { ctxPct: 30, ctxTokens: 300_000, ctxWindow: 1_000_000, limits: [], at: N9, history: [30] }
  const turn = { active: true, steps: 1, turns: 1, prompt: 'x', model: 'claude-opus-5-5', effort: 'high' }
  const stats = { tools: {}, hired: 2, outTokens: 0, inTokens: 0, cacheRead: 0, sessionStart: N9 - 3_600_000 }
  const svg = hudSvg({ workers, feed: [], usage, turn, stats, now: N9, motion: true, width: 1600, fill: 1000 }).svg
  expect(svg).toContain('Coding')
  expect(svg).toContain('Waiting for you')
})

test('0.9: stress: 26 workers × 200 seeded steps never throw, never flicker, keep 8 marks and no raw command or path', () => {
  let seed = 42
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const steps: Array<Partial<ToolFacts> & { tool: string }> = [
    { tool: 'Read', file: 'C:/private/project/app.ts' }, { tool: 'Read', file: 'C:/private/ekran.png' }, { tool: 'Edit', file: 'C:/private/project/app.ts' },
    { tool: 'Write', file: 'C:/private/README.md' }, { tool: 'Bash', cmd: 'git push origin main' }, { tool: 'Bash', cmd: 'npm test' },
    { tool: 'Bash', cmd: 'rm -rf C:/private/build' }, { tool: 'Grep', text: 'error' }, { tool: 'WebSearch' }, { tool: 'Agent' },
    { tool: 'SendMessage', text: 'Private plan: git push' }, { tool: 'Skill', skill: 'code-review' }, { tool: 'mcp__x__generate_image' },
    { tool: 'TodoWrite' }, { tool: 'Bash', cmd: 'node C:/private/x.ts' }, { tool: 'AskUserQuestion' },
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
    expect(/[\\/]|\.ts\b|git push|private/.test(json)).toBe(false)
  }
})

// --- 0.9 final fixes: strong one-shot signals, stable views, pending commands, event budgets, siblings and expiring trails ---

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
  // Edit, Edit, npm test call, failed result: Tests failed, although the test was only a pending candidate.
  const t1 = run9([ED, ED, { f: { tool: 'Bash', cmd: 'npm test' }, activity: 'running' }, { f: { tool: 'Bash', cmd: 'npm test', failed: true, out: '1 failed' }, phase: 'result', activity: 'thinking' }])
  expect(t1.st?.id).toBe('test-tube_fail')
  expect(t1.shown[3]).toBe('test-tube_fail')
  // A code review called once starts an audit immediately; later reads refresh it without stale Coding activity.
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
  // npm test once, still running after 9 s: the test tube (its own candidate), never 'Compiling'
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
  expect(keywordAct([], 'Fix the logout flow', 's')).not.toBe('paint-canvas')
  expect(keywordAct([], 'Move the drawer component', 's')).not.toBe('paint-canvas')
  expect(keywordAct([], 'Draw the logo', 's')).toBe('paint-canvas')
  expect(keywordAct([], 'draw the icon', 's')).toBe('paint-canvas')
  expect(keywordAct([], 'Revert the last change', 's')).not.toBe('dictionary-translate')
  expect(keywordAct([], 'Translate the text into English', 's')).toBe('dictionary-translate')
})

test('0.9: an event does not cost another worker its prop: the settled picture is the same with and without it', () => {
  const acts = MAIN_ACTS.filter(id => !isEvent(id) && ACTS[id]?.cls !== 'ambiyans').slice(0, 26)
  const make = (ev: boolean): Worker[] => [
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#D97757', seat: -1, activity: 'planning', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9 - 5000, joinedAt: N9 - 999_999, model: 'claude-opus-5-5', act: { id: 'plan-blueprint', at: N9 - 5000, seen: N9 - 5000 } },
    ...acts.map((id, i) =>
      worker9({ id: `w${i}`, n: i, seat: i, name: `Worker ${i}`, activity: 'running', tool: 'Edit', since: N9 - 1000, act: { id, at: N9 - 1000, seen: N9 - 1000, ...(ev && i < 3 ? { ev: { id: ['deploy-rocket', 'confetti-party', 'error-sparks'][i] as string, at: N9 - 200, until: N9 + 1400 } } : {}) } }),
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
    { id: 'boss', n: -1, name: 'Boss', role: 'Boss', task: '', color: '#D97757', seat: -1, activity: 'thinking', bubble: '', detail: '', tools: 4, tokensOut: 0, since: N9 - 5000, joinedAt: N9 - 999_999, model: 'claude-opus-5-5' },
    ...ids.map((id, i) => worker9({ id: `w${i}`, n: i, seat: i, name: `Worker ${i}`, model: models[i], activity: 'writing', tool: 'Edit', since: N9 - 1000, act: { id, at: N9 - 1000, seen: N9 - 1000 } })),
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
  await $.agent.spawn({ prompt: 'Explore the code', description: 'Explore the code', subagentType: 'Explore' })
  await clock.advance(3500)
  // an Explore hire maps or shelves from its first frame
  expect(/Exploring|Finding files/.test(await src())).toBe(true)
  for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'Edit', file_path: 'C:/private/project/app.ts', old_string: 'a', new_string: 'b', agentId: 'a1' })
  // a settled change is painted within the 15 s check
  await clock.advance(16_000)
  expect(await src()).toContain('Coding')
  for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'Bash', command: 'git push origin private-dal', description: 'Push the private branch', agentId: 'a1' })
  await clock.advance(16_000)
  const source = await src()
  expect(source).toContain('Working in Git')
  for (const secret of ['C:/private', 'private-dal', 'git push']) expect(source).not.toContain(secret)
  await ui.unmount()
})
