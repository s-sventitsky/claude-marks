// /marks, the band click and the pane, through the plugin's hooks.
import { describe, expect, mock, test } from 'claude-code/testing'
import { emptyFile } from '../hooks/lib/model'
import type { ConversationFile, Exchange, Thread } from '../types/index'
import { BAND, SESSION_START, dataPath, prompt, replyText, world } from './harness'

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

/** The tree's rows (headers and exchanges), not its key Buttons. */
const texts = async (ui: any) =>
  (await ui.findAll({ type: 'Button' })).filter((b: any) => /^(ex|th):/.test(b.key)).map((b: any) => b.text)
const header = async (ui: any) => (await ui.find({ type: 'Text', text: / in thread$/ }))?.text

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

  test('a denied jump keeps the pane open and opens the reader with the deny text', async ($, on) => {
    // The kit cannot answer $.ui.scroll: every jump here takes the denied path.
    const s = await setup($, on)
    await $.command.run(run() as any)
    const ui = await $.ui.mount(PANE as any)
    await ui.press({ key: 'ex:u2' })
    await ui.redraw()
    expect(s.closes).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: ' · #2 · 1 of 1 in thread' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Jump denied: / }))?.text).toMatch(/ui\.scroll/)
    // g stays live: the person may try again.
    expect((await ui.find({ type: 'Button', key: 'key:g' }))?.props.dimColor).toBeUndefined()
    // The jump was not remembered: the next /marks opens the tree on the latest again.
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

describe('the reader', () => {
  test("p opens the reader on the cursor's exchange: header, then j/k through the family", async ($, on) => {
    await setup($, on)
    await $.command.run(run() as any)
    const ui = await $.ui.mount(PANE as any)
    await ui.press({ key: 'key:p' })
    await ui.redraw()
    // u3 is Login's second exchange: #3 overall, 2 of 2 in the family.
    expect(await header(ui)).toBe(' · #3 · 2 of 2 in thread')
    expect(await ui.find({ type: 'Text', text: 'Login' })).toBeDefined()
    expect(await texts(ui)).toEqual([])
    // j is dim and inert at the family's end.
    expect((await ui.find({ type: 'Button', key: 'key:j' }))?.props.dimColor).toBe(true)
    await ui.press({ key: 'key:j' })
    await ui.redraw()
    expect(await header(ui)).toBe(' · #3 · 2 of 2 in thread')
    await ui.press({ key: 'key:k' })
    await ui.redraw()
    expect(await header(ui)).toBe(' · #1 · 1 of 2 in thread')
    expect((await ui.find({ type: 'Button', key: 'key:k' }))?.props.dimColor).toBe(true)
  })

  test('the prompt and reply text come from the row index; the reply as Markdown', async ($, on) => {
    world(on, mock)
    await $.session.start(SESSION_START)
    await $.turn.start({ text: 'why', turnId: 't1' } as any)
    await $.session.append(prompt('u1', 'why does login fail?') as any)
    await $.session.append(replyText('r1', 'It was **the cookie**.') as any)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as any)
    const ui = await $.ui.mount(PANE as any)
    await ui.press({ key: 'key:p' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: 'why does login fail?' })).toBeDefined()
    expect((await ui.findAll({ type: 'Markdown' })).map((m: any) => m.props.text)).toEqual(['It was **the cookie**.'])
    // Not labelled yet: the Unlabelled section is its family.
    expect(await ui.find({ type: 'Text', text: 'Unlabelled' })).toBeDefined()
  })

  test('main screen: Enter opens the reader with the reason; g is dim and inert', async ($, on) => {
    const s = await setup($, on)
    const MAIN = { ...PANE, viewport: { ...PANE.viewport, isFullscreen: false } }
    const ui = await $.ui.mount(MAIN as any)
    await ui.press({ key: 'ex:u1' })
    await ui.redraw()
    expect(await header(ui)).toBe(' · #1 · 1 of 2 in thread')
    expect(await ui.find({ type: 'Text', text: 'Enter opens the reader. Jumping works in fullscreen.' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'key:g' }))?.props.dimColor).toBe(true)
    await ui.press({ key: 'key:g' })
    await ui.redraw()
    expect(await header(ui)).toBe(' · #1 · 1 of 2 in thread')
    expect(s.closes).toHaveLength(0)
  })

  test('p reads the row the ring moved onto', async ($, on) => {
    on('ui.focus', () => ({}))
    await setup($, on)
    await $.command.run(run() as any)
    const ui = await $.ui.mount(PANE as any)
    // The engine moves the ring as the person presses the arrows; `p` reads that row.
    await ($.ui as any).focus({ component: 'Pane', requestId: 'marks', element: 'ex:u2', origin: { kind: 'person' } })
    await ui.press({ key: 'key:p' })
    await ui.redraw()
    expect(await header(ui)).toBe(' · #2 · 1 of 1 in thread')
  })

  test('m is drawn and live (ticket 06); n is unbound', async ($, on) => {
    await setup($, on)
    await $.command.run(run() as any)
    const ui = await $.ui.mount(PANE as any)
    await ui.press({ key: 'key:p' })
    await ui.redraw()
    const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.hotkey)
    expect(keys).toEqual(['j', 'k', 'g', 'm'])
    expect((await ui.find({ type: 'Button', key: 'key:m' }))?.props.dimColor).toBeUndefined()
  })

  test('/marks while the reader shows opens the tree again', async ($, on) => {
    await setup($, on)
    await $.command.run(run() as any)
    const ui = await $.ui.mount(PANE as any)
    await ui.press({ key: 'key:p' })
    await $.command.run(run() as any)
    await ui.redraw()
    expect(await header(ui)).toBeUndefined()
    expect((await texts(ui)).length).toBe(5)
  })
})

describe('the band', () => {
  test("is one Button; a click opens the pane on the band's exchange", async ($, on) => {
    const s = await setup($, on)
    const band = await $.ui.mount(BAND as any)
    const buttons = await band.findAll({ type: 'Button' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.text).toBe('● Login · here #3/3 · 2 threads · click or /marks')
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
