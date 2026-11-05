// Ticket 06: `/mark` and the reader's `m` menu, through the plugin's hooks.
import { describe, expect, mock, test } from 'claude-code/testing'
import { emptyFile } from '../hooks/lib/model'
import type { ConversationFile, Exchange, Thread } from '../types/index'
import { SESSION_START, dataPath, fileOf, mirrored, prompt, replyText, world } from './harness'

const th = (id: string, text: string): Thread => ({ id, label: { text, by: 'labeller' }, parent: null, mergedFrom: [] })
const ex = (id: string, gist: string): Exchange => ({
  id,
  prompts: [id],
  excerpt: `prompt ${id}`,
  thread: { id: 't1', by: 'labeller' },
  gist,
  bookmarks: [],
  label: { status: 'done', model: 'haiku' },
})
const CONV: ConversationFile = { ...emptyFile('s1'), threads: [th('t1', 'Login')], exchanges: [ex('u1', 'found the bug'), ex('u2', 'wrote the fix')] }

const pane = (isFullscreen = true) => ({
  plugin: 'marks',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'marks',
  props: { title: 'marks', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 200, rows: 45, isFullscreen },
})
const cmd = (command: string, args = '', isFullscreen = true) => ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 200 } }) as any

/** CONV loaded, then a live turn u3 with two reply text blocks. */
const setup = async ($: any, on: any) => {
  const clock = mock.clock(on)
  const w = world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(CONV) } })
  const toasts: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start(SESSION_START)
  await $.turn.start({ text: 'why', turnId: 'T' })
  await $.session.append(prompt('u3', 'why does the cookie expire?'))
  await $.session.append(replyText('r3a', 'Looking at the session store first.'))
  await $.session.append(replyText('r3b', 'The cookie had   no Max-Age.'))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'T', reason: 'answer' })
  return { w, clock, toasts }
}

const exOf = (w: any, id: string) => mirrored(w)?.exchanges.find(x => x.id === id)

describe('/mark', () => {
  test('is registered at session start and runs mid-turn', async ($, on) => {
    const s = await setup($, on)
    expect(s.w.commands.find(r => r.name === 'mark')).toMatchObject({ name: 'mark', immediate: true })
  })

  test("no target: Claude's latest reply text block in the latest exchange; confirms outside the transcript", async ($, on) => {
    const s = await setup($, on)
    const r = await $.command.run(cmd('mark'))
    expect(r.text).toBeUndefined()
    expect(s.toasts).toEqual(['◆ #3 "The cookie had no Max-Age."'])
    expect(exOf(s.w, 'u3')?.bookmarks).toEqual([{ kind: 'manual', row: 'r3b', text: 'The cookie had no Max-Age.' }])
    expect(mirrored(s.w)?.corrections).toEqual([{ kind: 'bookmark_add', exchange: 'u3', row: 'r3b', at: expect.any(String) }])
    // Written back to the data file, debounced.
    await s.clock.advance(1500)
    expect(fileOf(s.w, 's1')?.exchanges.find(x => x.id === 'u3')?.bookmarks[0]?.kind).toBe('manual')
  })

  test('#n with a note: that exchange on its prompt row; a second /mark replaces it; ◆ shows in the tree', async ($, on) => {
    const s = await setup($, on)
    await $.command.run(cmd('mark', '#1 chose JSON schema'))
    await $.command.run(cmd('mark', '#1 start here'))
    expect(s.toasts).toEqual(['◆ #1 "chose JSON schema"', '◆ #1 "start here"'])
    expect(exOf(s.w, 'u1')?.bookmarks).toEqual([{ kind: 'manual', text: 'start here' }])
    expect(mirrored(s.w)?.corrections).toHaveLength(2)
    const ui = await $.ui.mount(pane() as any)
    expect((await ui.find({ type: 'Button', key: 'ex:u1' }))?.text).toContain('◆')
  })

  test('a bad #n prints usage and changes nothing', async ($, on) => {
    const s = await setup($, on)
    await $.command.run(cmd('mark', '#9'))
    await $.command.run(cmd('mark', '#x note'))
    expect(s.toasts).toEqual(['usage: /mark [#n] [note]', 'usage: /mark [#n] [note]'])
    expect(mirrored(s.w)?.corrections).toEqual([])
  })
})

/** The reader on the latest exchange (u3), its `m` menu open. */
const openMenu = async ($: any, isFullscreen = true) => {
  await $.command.run(cmd('marks', '', isFullscreen))
  const ui = await $.ui.mount(pane(isFullscreen) as any)
  await ui.press({ key: 'key:p' })
  await ui.redraw()
  await ui.press({ key: 'key:m' })
  await ui.redraw()
  return ui
}
const options = async (ui: any) => (await ui.find({ type: 'Select', key: 'mark:menu:u3' }))?.props.options

describe("the reader's m", () => {
  test('opens a Select of the reply text blocks and the whole exchange', async ($, on) => {
    await setup($, on)
    const ui = await openMenu($)
    expect(await options(ui)).toEqual([
      { value: 'row:r3a', label: '  Looking at the session store first.' },
      { value: 'row:r3b', label: '  The cookie had no Max-Age.' },
      { value: 'whole', label: '  the whole exchange' },
    ])
  })

  test('a pick moves the bookmark there and asks for a note; the note becomes its text', async ($, on) => {
    const s = await setup($, on)
    const ui = await openMenu($)
    await ui.select({ key: 'mark:menu:u3', value: 'row:r3a' })
    await ui.redraw()
    expect(exOf(s.w, 'u3')?.bookmarks).toEqual([{ kind: 'manual', row: 'r3a', text: 'Looking at the session store first.' }])
    expect(mirrored(s.w)?.corrections).toEqual([{ kind: 'bookmark_add', exchange: 'u3', row: 'r3a', at: expect.any(String) }])
    expect(await ui.find({ type: 'Select' })).toBeUndefined()
    await ui.input({ key: 'mark:note:u3', text: '  the store  ' })
    await ui.redraw()
    expect(exOf(s.w, 'u3')?.bookmarks).toEqual([{ kind: 'manual', row: 'r3a', text: 'the store' }])
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    // The reader lists it, glyph first.
    expect(await ui.find({ type: 'Text', text: 'the store' })).toBeDefined()
  })

  test('Enter on an empty note means no note: the text stays the message', async ($, on) => {
    const s = await setup($, on)
    const ui = await openMenu($)
    await ui.select({ key: 'mark:menu:u3', value: 'whole' })
    await ui.redraw()
    await ui.input({ key: 'mark:note:u3', text: '' })
    expect(exOf(s.w, 'u3')?.bookmarks).toEqual([{ kind: 'manual', text: 'why does the cookie expire?' }])
  })

  test('the entry holding the bookmark shows ◆, and choosing it removes the bookmark', async ($, on) => {
    const s = await setup($, on)
    await $.command.run(cmd('mark'))
    const ui = await openMenu($)
    expect((await options(ui))?.map((o: any) => o.label.slice(0, 1))).toEqual([' ', '◆', ' '])
    await ui.select({ key: 'mark:menu:u3', value: 'row:r3b' })
    await ui.redraw()
    expect(exOf(s.w, 'u3')?.bookmarks).toEqual([])
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    expect(mirrored(s.w)?.corrections).toHaveLength(1)
  })

  test("the manual bookmark's line in the reader is a jump to its row (the kit denies it: the reader stays)", async ($, on) => {
    await setup($, on)
    await $.command.run(cmd('mark'))
    const ui = await openMenu($)
    await ui.press({ key: 'mark:jump' })
    await ui.redraw()
    expect((await ui.find({ type: 'Text', text: /^Jump denied: / }))?.text).toBeDefined()
  })
})

describe('main screen (ticket 08)', () => {
  test('/mark and the reader’s m work as in fullscreen', async ($, on) => {
    const s = await setup($, on)
    await $.command.run(cmd('mark', '#2', false))
    expect(s.toasts).toEqual(['◆ #2 "prompt u2"'])
    expect(exOf(s.w, 'u2')?.bookmarks).toEqual([{ kind: 'manual', text: 'prompt u2' }])
    const ui = await openMenu($, false)
    expect(await ui.find({ type: 'Text', text: 'Enter opens the reader. Jumping works in fullscreen.' })).toBeDefined()
    await ui.select({ key: 'mark:menu:u3', value: 'row:r3b' })
    await ui.redraw()
    await ui.input({ key: 'mark:note:u3', text: 'no Max-Age' })
    expect(exOf(s.w, 'u3')?.bookmarks).toEqual([{ kind: 'manual', row: 'r3b', text: 'no Max-Age' }])
    // Nothing jumps on the main screen: the bookmark line is plain text, not a Button.
    await ui.redraw()
    expect(await ui.find({ type: 'Button', key: 'mark:jump' })).toBeUndefined()
  })
})
