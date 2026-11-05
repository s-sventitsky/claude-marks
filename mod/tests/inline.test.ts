import { describe, expect, mock, test } from 'claude-code/testing'
import { emptyFile } from '../hooks/lib/model'
import type { ConversationFile, Exchange, Thread } from '../types/index'
import { SESSION_START, dataPath, prompt, replyText, world } from './harness'

const th = (id: string, text: string, parent: string | null = null): Thread => ({ id, label: { text, by: 'labeller' }, parent, mergedFrom: [] })
const ex = (id: string, thread: string | null, bookmarks: Exchange['bookmarks'] = []): Exchange => ({
  id,
  prompts: [id],
  excerpt: id,
  thread: thread ? { id: thread, by: 'labeller' } : null,
  gist: '',
  bookmarks,
  label: { status: thread ? 'done' : 'pending' },
})
const seeded = (threads: Thread[], exchanges: Exchange[]): ConversationFile => ({ ...emptyFile('s1'), threads, exchanges })
const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const row = (uuid: string, o: { isExpanded?: boolean; isFullscreen?: boolean; columns?: number } = {}) => ({
  plugin: 'marks',
  surface: 'terminal',
  component: 'UserMessage',
  requestId: uuid,
  props: { text: 'x', origin: { kind: 'composer' }, isExpanded: o.isExpanded ?? false, onScreen: { first: 0, last: 3, of: 4 } },
  viewport: { columns: o.columns ?? 30, rows: 45, isFullscreen: o.isFullscreen ?? true },
})

/** The absolutely placed overlay Boxes the hook drew over the engine's row, with their text. */
const overlays = async (ui: any) =>
  (await ui.findAll({ type: 'Box' }))
    .filter((b: any) => b.props.position === 'absolute')
    .map((b: any) => ({ top: b.props.top, left: b.props.left, text: b.text, color: (b.children[0] as any)?.props?.color }))

const TWO_THREADS = seeded(
  [th('t1', 'Login fix'), th('t2', 'Retry', 't1')],
  [ex('u1', 't1'), ex('u2', 't1', [{ kind: 'landmark', text: 'x' }]), ex('u3', 't2', [{ kind: 'branch_point', text: 'y' }])],
)

describe('inline markers on prompt rows', () => {
  test('a thread change draws a divider over the spacer row (top 0), the glyph over > (top 1), the row kept', async ($, on) => {
    mock.clock(on)
    world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(TWO_THREADS) } })
    await $.session.start(SESSION_START)
    const ui = await $.ui.mount(row('u3') as any)
    expect(await overlays(ui)).toEqual([
      { top: 0, left: 0, text: '── └ Retry ──────────────────', color: 'suggestion' },
      { top: 1, left: 0, text: '↳', color: 'suggestion' },
    ])
    // The engine's own row is still the first child, laid out as before.
    const drawn: any = await ui.drawn()
    expect(drawn.props.flexDirection).toBe('column')
    expect(drawn.children[0]).toMatchObject({ type: 'Box' })
    await ui.unmount()
  })

  test('a row inside a thread run gets only its glyph; a plain one is drawn as the engine draws it', async ($, on) => {
    mock.clock(on)
    world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(TWO_THREADS) } })
    await $.session.start(SESSION_START)
    const u2 = await $.ui.mount(row('u2') as any)
    expect((await overlays(u2)).map((o: any) => [o.top, o.text])).toEqual([[1, '◇']])
    const u1 = await $.ui.mount(row('u1') as any)
    expect((await overlays(u1)).map((o: any) => [o.top, o.text.slice(0, 12)])).toEqual([[0, '── Login fix']])
    await u1.unmount()
    await u2.unmount()
  })

  test('no markers outside fullscreen, on an expanded row, a placeholder row or a row of no exchange', async ($, on) => {
    mock.clock(on)
    world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(TWO_THREADS) } })
    await $.session.start(SESSION_START)
    for (const r of [row('u3', { isFullscreen: false }), row('u3', { isExpanded: true }), row('placeholder'), row('other')]) {
      const ui = await $.ui.mount(r as any)
      expect(await overlays(ui)).toEqual([])
      expect(((await ui.drawn()) as any).props?.flexDirection).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a row drawn before its label lands gets its marker when the label lands', async ($, on) => {
    const clock = mock.clock(on)
    world(on, mock)
    const calls: ((v: unknown) => void)[] = []
    on('model.complete', () => new Promise<any>(resolve => calls.push(v => resolve({ value: v }))))
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'fix login') as any)
    await $.turn.start({ text: '', turnId: 'T1' })
    await $.session.append(replyText('r1', 'done') as any)
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 'T1', reason: 'answer' })
    const ui = await $.ui.mount(row('u1') as any)
    expect(await overlays(ui)).toEqual([])
    await clock.advance(600)
    calls[0]?.({
      isAnswered: true,
      usage,
      text: JSON.stringify({ thread: { action: 'new_main', label: 'Login fix' }, bookmarks: [{ kind: 'landmark', why: 'w' }], gist: 'g' }),
    })
    await clock.advance(600)
    // No ui.redraw(): the hook read the row's marker from $.state, so the write redraws it.
    expect((await overlays(ui)).map((o: any) => [o.top, o.text.slice(0, 12)])).toEqual([
      [0, '── Login fix'],
      [1, '◇'],
    ])
    await ui.unmount()
  })

  test('a conversation switch clears the markers of the old rows', async ($, on) => {
    mock.clock(on)
    const w = world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(TWO_THREADS) } })
    await $.session.start(SESSION_START)
    const ui = await $.ui.mount(row('u3') as any)
    expect(await overlays(ui)).toHaveLength(2)
    w.sessionId.current = 's2'
    await $.session.append(prompt('v1', 'in s2') as any)
    expect(await overlays(ui)).toEqual([])
    await ui.unmount()
  })
})
