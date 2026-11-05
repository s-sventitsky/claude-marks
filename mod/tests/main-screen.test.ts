// Ticket 08: the main screen (isFullscreen false), the whole path through the plugin's hooks.
import { describe, expect, mock, test } from 'claude-code/testing'
import { emptyFile } from '../hooks/lib/model'
import type { ConversationFile, Exchange, Thread } from '../types/index'
import { BAND, SESSION_START, dataPath, world } from './harness'

const th = (id: string, text: string, parent: string | null = null): Thread => ({ id, label: { text, by: 'labeller' }, parent, mergedFrom: [] })
const ex = (id: string, thread: string, gist: string, bookmarks: Exchange['bookmarks'] = []): Exchange => ({
  id,
  prompts: [id],
  excerpt: id,
  thread: { id: thread, by: 'labeller' },
  gist,
  bookmarks,
  label: { status: 'done', model: 'haiku' },
})
const CONV: ConversationFile = {
  ...emptyFile('s1'),
  threads: [th('t1', 'Login'), th('t2', 'Docs')],
  exchanges: [ex('u1', 't1', 'found the bug'), ex('u2', 't2', 'wrote the readme', [{ kind: 'landmark', text: 'x' }]), ex('u3', 't1', 'fixed it')],
}

const MAIN_SENTENCE = 'Enter opens the reader. Jumping works in fullscreen.'

/** A Pane drawing; `isFullscreen` left out means the viewport doesn't say. */
const pane = (isFullscreen?: boolean) => ({
  plugin: 'marks',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'marks',
  props: { title: 'marks', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 14 }, view: {} },
  viewport: isFullscreen === undefined ? { columns: 100, rows: 30 } : { columns: 100, rows: 30, isFullscreen },
})
const band = (isFullscreen?: boolean) => ({
  ...BAND,
  viewport: isFullscreen === undefined ? { columns: 200, rows: 45 } : { columns: 200, rows: 45, isFullscreen },
})
const userRow = (uuid: string, isFullscreen?: boolean) => ({
  plugin: 'marks',
  surface: 'terminal',
  component: 'UserMessage',
  requestId: uuid,
  props: { text: 'x', origin: { kind: 'composer' }, isExpanded: false, onScreen: { first: 0, last: 3, of: 4 } },
  viewport: isFullscreen === undefined ? { columns: 30, rows: 45 } : { columns: 30, rows: 45, isFullscreen },
})
const marks = (isFullscreen: boolean) => ({ command: 'marks', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 100 } }) as const

const setup = async ($: any, on: any) => {
  const clock = mock.clock(on)
  const w = world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(CONV) } })
  const closes: any[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_: unknown, e: any) => {
    closes.push(e)
    return { value: undefined }
  })
  await $.session.start(SESSION_START)
  return { w, clock, closes }
}

const exRows = async (ui: any) => (await ui.findAll({ type: 'Button' })).filter((b: any) => /^ex:/.test(b.key))
const texts = (b: any): any[] => (b.children ?? []).filter((c: any) => c?.type === 'Text')
const header = async (ui: any) => (await ui.find({ type: 'Text', text: / in thread$/ }))?.text
const overlays = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((b: any) => b.props.position === 'absolute')

describe('main screen', () => {
  test('/marks there fixes the mode: every exchange dim, the standing footer, Enter reads', async ($, on) => {
    await setup($, on)
    await $.command.run(marks(false) as any)
    // The pane's own viewport doesn't say; the mode /marks reported holds.
    const ui = await $.ui.mount(pane() as any)
    const rows = await exRows(ui)
    expect(rows.map((b: any) => b.key)).toEqual(['ex:u1', 'ex:u3', 'ex:u2'])
    for (const r of rows) expect(texts(r).every((t: any) => t.props?.dimColor === true)).toBe(true)
    expect(await ui.find({ type: 'Text', text: MAIN_SENTENCE })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Enter read' })).toBeDefined()
  })

  test('fullscreen has no such footer', async ($, on) => {
    await setup($, on)
    await $.command.run(marks(true) as any)
    const ui = await $.ui.mount(pane(true) as any)
    expect(await ui.find({ type: 'Text', text: MAIN_SENTENCE })).toBeUndefined()
    expect(texts((await exRows(ui))[0]).some((t: any) => t.props?.dimColor !== true)).toBe(true)
  })

  test("the band shows the latest exchange's thread as latest #n/N", async ($, on) => {
    await setup($, on)
    const ui = await $.ui.mount(band(false) as any)
    expect((await ui.find({ type: 'Button', key: 'band' }))?.text).toBe('● Login · latest #3/3 · click or /marks')
  })

  test('while the mode is unknown the band says here', async ($, on) => {
    await setup($, on)
    const ui = await $.ui.mount(band() as any)
    expect((await ui.find({ type: 'Button', key: 'band' }))?.text).toBe('● Login · here #3/3 · click or /marks')
  })

  test('a drawing that reports the main screen fixes the mode for drawings that do not say', async ($, on) => {
    const s = await setup($, on)
    const first = await $.ui.mount(band(false) as any)
    await s.clock.advance(600)
    await first.unmount()
    const ui = await $.ui.mount(band() as any)
    expect((await ui.find({ type: 'Button', key: 'band' }))?.text).toBe('● Login · latest #3/3 · click or /marks')
    const p = await $.ui.mount(pane() as any)
    expect(await p.find({ type: 'Text', text: MAIN_SENTENCE })).toBeDefined()
  })

  test('the mode stays fixed for the session: a later report of fullscreen changes nothing', async ($, on) => {
    await setup($, on)
    await $.command.run(marks(false) as any)
    await $.command.run(marks(true) as any)
    const ui = await $.ui.mount(pane(true) as any)
    expect(await ui.find({ type: 'Text', text: MAIN_SENTENCE })).toBeDefined()
    await ui.unmount()
    const b = await $.ui.mount(band(true) as any)
    expect((await b.find({ type: 'Button', key: 'band' }))?.text).toContain('latest #3/3')
  })

  test('Enter opens the reader with the reason; g is dim and does nothing', async ($, on) => {
    const s = await setup($, on)
    await $.command.run(marks(false) as any)
    const ui = await $.ui.mount(pane() as any)
    await ui.press({ key: 'ex:u3' })
    await ui.redraw()
    expect(await header(ui)).toBe(' · #3 · 2 of 2 in thread')
    expect(await ui.find({ type: 'Text', text: MAIN_SENTENCE })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'key:g' }))?.props.dimColor).toBe(true)
    await ui.press({ key: 'key:g' })
    await ui.redraw()
    expect(await header(ui)).toBe(' · #3 · 2 of 2 in thread')
    expect(await ui.find({ type: 'Text', text: /^Jump denied/ })).toBeUndefined()
    expect(s.closes).toHaveLength(0)
  })

  test('no inline dividers or prompt glyphs, even on a row whose viewport does not say', async ($, on) => {
    await setup($, on)
    await $.command.run(marks(false) as any)
    // u2 opens Docs (a divider) and carries a landmark (a glyph) in fullscreen.
    for (const r of [userRow('u2', false), userRow('u2')]) {
      const ui = await $.ui.mount(r as any)
      expect(await overlays(ui)).toHaveLength(0)
      await ui.unmount()
    }
  })
})
