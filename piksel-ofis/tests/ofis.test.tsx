import { expect, mock, test } from 'claude-code/testing'

import type { Activity, Worker } from '../types'
import { hudSvg } from '../hooks/hud'
import { readTool, siteOf, thinkKind } from '../hooks/logic'
import { sceneSvg } from '../hooks/scene'

const PANE = {
  plugin: 'piksel-ofis',
  component: 'Pane',
  requestId: 'piksel-ofis',
  props: {
    title: 'Claude Ofis',
    isFocused: false,
    bodyColumns: 160,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
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
  on('agent.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('session.id', () => ({ value: 'test-chat' }))
  on('env.get', (_, e) => ({ value: e.name === 'USERPROFILE' ? 'C:/kullanici' : undefined }))
  on('fs.stat', () => {
    throw new Error('missing')
  })
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
}

test('the boss reads, hires a worker, and the HUD and tabs show it in plain words', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/app.tsx' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build -- --verbose', description: 'Projeyi derle' })
  await $.agent.spawn({ prompt: 'Logları tara', description: 'Logları tara', subagentType: 'Explore' })
  await clock.advance(1200)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const hud = await ui.find({ type: 'Svg' })
  const source = String(hud?.props.source)
  // drawn to the pane's own size: 160 cells wide, filling 60 rows
  expect(hud?.props.width).toBe(1280)
  expect(Number(hud?.props.height)).toBeGreaterThanOrEqual(60 * 17 - 64)
  expect(source).toContain('Claude Ofis')
  expect(source).toContain('PATRON')
  expect(source).toContain('Ada · Kâşif')
  expect(source).toContain('işe başladı · Logları tara')
  expect(source).toContain('okudu · app.tsx')
  // the feed says what was done, never the raw command
  expect(source).toContain('komut çalıştırdı · Projeyi derle')
  expect(source).not.toContain('npm run build')

  await ui.press({ key: 'tab-ekip' })
  const row = await ui.find({ key: 'w-a1' })
  expect(row?.text).toMatch(/Ada/)
  expect(row?.text).toMatch(/Kâşif/)
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
  expect(hud?.props.width).toBe(400)
  expect(String(hud?.props.source)).toContain('viewBox="0 0 400 ')
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
  let compacts = 0
  on('session.compact', () => {
    compacts++
    return { value: {} }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(1200)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/kapalı/)
  await ui.press({ key: 'auto' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/açık · %80/)
  await ui.press({ key: 'autoDown' })
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/%75/)
  // the setting lands in the shared folder, where kota-bandi reads it
  expect(Object.values(written).some(t => t.includes('"at":75'))).toBe(true)
  await ui.unmount()
})
