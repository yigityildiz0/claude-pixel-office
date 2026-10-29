import { expect, mock, test } from 'claude-code/testing'

import type { Activity, Worker } from '../types'
import { hudSvg } from '../hooks/hud'
import { readTool, siteOf, thinkKind } from '../hooks/logic'
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

test('the office speaks English', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: 'C:/proje/app.tsx' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build the project' })
  await $.agent.spawn({ prompt: 'Scan the logs', description: 'Scan the logs', subagentType: 'Explore' })
  await clock.advance(1200)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('Claude Office')
  expect(source).toContain('Ada · Explorer')
  expect(source).toContain('started · Scan the logs')
  expect(source).toContain('read · app.tsx')
  expect(source).toContain('ran a command · Build the project')
  expect(source).not.toMatch(/[çğışöüİ]/)
  expect((await ui.find({ key: 'auto' }))?.props.label).toMatch(/Auto-compact: off/)
  await ui.unmount()
})
