// /marks, the band click and the pane, through the plugin's hooks.
import { describe, expect, mock, test } from 'claude-code/testing'
import { emptyFile } from '../hooks/lib/model'
import type { ConversationFile, Exchange, Thread } from '../types/index'
import { BAND, SESSION_START, dataPath, world } from './harness'

const th = (id: string, text: string, parent: string | null = null): Thread => ({ id, label: { text, by: 'labeller' }, parent, mergedFrom: [] })
const ex = (id: string, thread: string, gist: string): Exchange => ({
  id,
  prompts: [id],
  excerpt: id,
  thread: { id: thread, by: 'labeller' },
  gist,
  bookmarks: [],
  label: { status: 'done', model: 'haiku' },
})
const CONV: ConversationFile = {
  ...emptyFile('s1'),
  threads: [th('t1', 'Login'), th('t2', 'Docs')],
  exchanges: [ex('u1', 't1', 'found the bug'), ex('u2', 't2', 'wrote the readme'), ex('u3', 't1', 'fixed it')],
}

const PANE = {
  plugin: 'marks',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'marks',
  props: { title: 'marks', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 200, rows: 45, isFullscreen: true },
} as const

const run = (args = '') => ({ command: 'marks', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } }) as const

/** A session with CONV loaded, recording what the plugin asks of the pane. */
const setup = async ($: any, on: any) => {
  const w = world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(CONV) } })
  const opens: any[] = []
  const closes: any[] = []
  const toasts: string[] = []
  on('ui.open', (_: unknown, e: any) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: any) => {
    closes.push(e)
    return { value: undefined }
  })
  on('ui.toast', (_: unknown, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start(SESSION_START)
  return { w, opens, closes, toasts }
}

const texts = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.text)

describe('/marks', () => {
  test('is registered at session start and runs mid-turn', async ($, on) => {
    const s = await setup($, on)
    expect(s.w.commands.find(r => r.name === 'marks')).toMatchObject({ name: 'marks', immediate: true })
  })

  test('opens the pane focused, closing on Esc, 14 rows inline; leaves the model nothing', async ($, on) => {
    const s = await setup($, on)
    const r = await $.command.run(run() as any)
    expect(r.text).toBeUndefined()
    expect(s.opens).toEqual([{ id: 'marks', title: 'marks', focus: true, closeOnEscape: true, rows: 14 }])
  })

  test('any argument shows usage outside the transcript and opens nothing', async ($, on) => {
    const s = await setup($, on)
    const r = await $.command.run(run('relabel') as any)
    expect(r.text).toBeUndefined()
    expect(s.toasts).toEqual(['usage: /marks'])
    expect(s.opens).toHaveLength(0)
  })
})

describe('the pane', () => {
  test('draws the tree as Buttons, the cursor on the latest exchange when nothing was jumped to', async ($, on) => {
    await setup($, on)
    await $.command.run(run() as any)
    const ui = await $.ui.mount(PANE as any)
    expect(await texts(ui)).toEqual(['Login  2 ex', ' 1    found the bug', ' 3    fixed it', 'Docs  1 ex', ' 2    wrote the readme'])
    const focused = (await ui.findAll({ type: 'Button' })).filter((b: any) => b.props.autoFocus)
    expect(focused.map((b: any) => b.key)).toEqual(['ex:u3'])
    expect((await ui.findAll({ type: 'Text', text: /Enter jump/ })).length).toBeGreaterThan(0)
  })

  test("a denied jump keeps the pane open and shows the reason in the footer", async ($, on) => {
    // The kit cannot answer $.ui.scroll: every jump here takes the denied path.
    const s = await setup($, on)
    await $.command.run(run() as any)
    const ui = await $.ui.mount(PANE as any)
    await ui.press({ key: 'ex:u2' })
    await ui.redraw()
    expect(s.closes).toHaveLength(0)
    expect((await ui.find({ type: 'Text', text: /^Jump denied: / }))?.text).toMatch(/ui\.scroll/)
    // The jump was not remembered: the next /marks opens on the latest again.
    await $.command.run(run() as any)
    await ui.redraw()
    expect((await ui.findAll({ type: 'Button' })).filter((b: any) => b.props.autoFocus).map((b: any) => b.key)).toEqual(['ex:u3'])
    expect(await ui.find({ type: 'Text', text: /^Jump denied/ })).toBeUndefined()
  })

  test('narrow: inline placement shrinks the counts', async ($, on) => {
    await setup($, on)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'inline', bodyColumns: 100 } } as any)
    expect((await texts(ui))[0]).toBe('Login  2')
  })

  test('an empty conversation says so', async ($, on) => {
    world(on, mock)
    await $.session.start(SESSION_START)
    const ui = await $.ui.mount(PANE as any)
    expect(await ui.find({ type: 'Text', text: /No exchanges yet/ })).toBeDefined()
  })
})

describe('the band', () => {
  test("is one Button; a click opens the pane on the band's exchange", async ($, on) => {
    const s = await setup($, on)
    const band = await $.ui.mount(BAND as any)
    const buttons = await band.findAll({ type: 'Button' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.text).toBe('● Login · here #3/3 · click or /marks')
    await band.press({ key: 'band' })
    expect(s.opens).toHaveLength(1)
    const ui = await $.ui.mount(PANE as any)
    const focused = (await ui.findAll({ type: 'Button' })).filter((b: any) => b.props.autoFocus)
    expect(focused.map((b: any) => b.key)).toEqual(['ex:u3'])
    // The band's exchange draws bold in the tree.
    const row = await ui.find({ type: 'Button', key: 'ex:u3' })
    expect(JSON.stringify(row?.children)).toContain('"bold":true')
  })
})
