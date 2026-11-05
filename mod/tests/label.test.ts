import { describe, expect, mock, test } from 'claude-code/testing'
import { RULES } from '../hooks/lib/rules'
import { BAND, SESSION_START, fileOf, mirrored, prompt, replyText, world } from './harness'

const turn = (id: string) => ({ text: '', turnId: id })
const done = (id: string) => ({ answer: 'x', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' }) as const
const label = (action: string, extra: Record<string, unknown> = {}, gist = 'g') =>
  JSON.stringify({ thread: { action, ...extra }, bookmarks: [], gist })
const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

type Call = { e: any; resolve: (v: unknown) => void }

/** A fake $.model.complete: each call waits until the test answers it. */
const model = (on: any) => {
  const calls: Call[] = []
  on('model.complete', (_: unknown, e: any) => new Promise(resolve => calls.push({ e, resolve: v => resolve({ value: v }) })))
  return {
    calls,
    answer: (i: number, text: string) => calls[i]?.resolve({ isAnswered: true, text, usage }),
    fail: (i: number, reason: 'api-error' | 'empty-reply' | 'aborted') =>
      calls[i]?.resolve(reason === 'api-error' ? { isAnswered: false, reason, status: 500, error: 'server_error', usage } : { isAnswered: false, reason, usage }),
  }
}

/** One whole turn: prompt, reply text, complete. */
const exchange = async ($: any, n: number) => {
  await $.session.append(prompt(`u${n}`, `prompt ${n}`) as any)
  await $.turn.start(turn(`T${n}`))
  await $.session.append(replyText(`r${n}`, `reply ${n}`) as any)
  await $.turn.complete(done(`T${n}`))
}

const bandText = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')

describe('labeller drain', () => {
  test('turn.complete only queues; the timer makes the call with the rules first and cached', async ($, on) => {
    const clock = mock.clock(on)
    world(on, mock)
    const m = model(on)
    await $.session.start(SESSION_START)
    await exchange($, 1)
    expect(m.calls).toHaveLength(0)
    await clock.advance(600)
    expect(m.calls).toHaveLength(1)
    const e = m.calls[0]?.e
    expect(e.model).toBe('haiku')
    expect(e.effort).toBe('low')
    expect(e.maxTokens).toBe(400)
    expect(e.timeoutMs).toBe(15000)
    expect(e.system).toBeUndefined()
    expect(e.promptBlocks).toHaveLength(2)
    expect(e.promptBlocks[0]).toEqual({ text: RULES, cache: true })
    expect(e.promptBlocks[1].cache).toBeUndefined()
    expect(e.promptBlocks[1].text).toContain('## Exchange to place\nUser: prompt 1\n')
    expect(e.promptBlocks[1].text).toContain("Claude's final reply: reply 1")
  })

  test('the answer lands in the file, $.state and the band; the status line stays empty', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    const m = model(on)
    await $.session.start(SESSION_START)
    const ui = await $.ui.mount(BAND as any)
    await exchange($, 1)
    await ui.redraw()
    expect(await bandText(ui)).toBe('○ labelling… · click or /marks')
    await clock.advance(600)
    m.answer(0, JSON.stringify({ thread: { action: 'new_main', label: 'Login fix' }, bookmarks: [{ kind: 'landmark', why: 'fix agreed' }], gist: 'bug found' }))
    await clock.advance(1500)
    expect(fileOf(w, 's1')?.threads).toEqual([{ id: 't1', label: { text: 'Login fix', by: 'labeller' }, parent: null, mergedFrom: [] }])
    expect(fileOf(w, 's1')?.exchanges[0]).toMatchObject({
      thread: { id: 't1', by: 'labeller' },
      gist: 'bug found',
      bookmarks: [{ kind: 'landmark', text: 'fix agreed' }],
      label: { status: 'done', model: 'haiku' },
    })
    expect(fileOf(w, 's1')?.bookmarkStats.landmark.flagged).toBe(1)
    expect(mirrored(w)?.threads).toHaveLength(1)
    await ui.redraw()
    expect(await bandText(ui)).toBe('● Login fix · here #1/1 ◇ · 1 thread · click or /marks')
    expect((await ui.find({ type: 'Text', text: 'Login fix' }))?.props.color).toBe('suggestion')
    expect(w.status).toEqual([])
    await ui.unmount()
  })

  test('one call at a time, in conversation order', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    const m = model(on)
    await $.session.start(SESSION_START)
    await exchange($, 1)
    await exchange($, 2)
    await clock.advance(600)
    await clock.advance(600)
    expect(m.calls).toHaveLength(1)
    expect(m.calls[0]?.e.promptBlocks[1].text).toContain('User: prompt 1\n')
    m.answer(0, label('new_main', { label: 'A' }))
    await clock.advance(600)
    expect(m.calls).toHaveLength(2)
    expect(m.calls[1]?.e.promptBlocks[1].text).toContain('- t1 [main] "A": g  <- current')
    m.answer(1, label('new_sub', { label: 'B' }))
    await clock.advance(1500)
    expect(fileOf(w, 's1')?.threads.map(t => [t.id, t.parent])).toEqual([
      ['t1', null],
      ['t2', 't1'],
    ])
  })

  test('an unanswered call is retried once on the next drain, then left on continue', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    const m = model(on)
    await $.session.start(SESSION_START)
    await exchange($, 1)
    await clock.advance(600)
    m.answer(0, label('new_main', { label: 'A' }))
    await exchange($, 2)
    await clock.advance(600)
    m.fail(1, 'api-error')
    await clock.advance(600)
    expect(mirrored(w)?.exchanges[1]?.label).toEqual({ status: 'failed', tries: 1 })
    expect(m.calls).toHaveLength(3)
    m.fail(2, 'aborted')
    await clock.advance(1500)
    expect(m.calls).toHaveLength(3)
    expect(fileOf(w, 's1')?.exchanges[1]).toMatchObject({ thread: { id: 't1' }, label: { status: 'failed', tries: 2 } })
  })

  test('a call the engine refuses stops the drain and the band says labeller off', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    let calls = 0
    on('model.complete', () => {
      calls++
      return { deny: 'haiku is not allowed' }
    })
    await $.session.start(SESSION_START)
    const ui = await $.ui.mount(BAND as any)
    await exchange($, 1)
    await clock.advance(600)
    await exchange($, 2)
    await clock.advance(1500)
    expect(calls).toBe(1)
    expect(fileOf(w, 's1')?.exchanges.map(x => x.label.status)).toEqual(['pending', 'pending'])
    await ui.redraw()
    expect(await bandText(ui)).toMatch(/^○ labelling… · labeller off: .*haiku is not allowed/)
    await ui.unmount()
  })

  test('a conversation switch seen on the timer tick drops the old queue', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    const m = model(on)
    await $.session.start(SESSION_START)
    await exchange($, 1)
    await exchange($, 2)
    w.sessionId.current = 's2' // /clear: no session.start, no prompt yet
    await clock.advance(1500)
    expect(m.calls).toHaveLength(0)
    expect(mirrored(w)?.sessionId).toBe('s2')
    expect(fileOf(w, 's1')?.exchanges.map(x => x.label.status)).toEqual(['pending', 'pending'])
  })

  test('a result that comes back after a switch is dropped', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    const m = model(on)
    await $.session.start(SESSION_START)
    await exchange($, 1)
    await exchange($, 2)
    await clock.advance(600)
    w.sessionId.current = 's2'
    await $.session.append(prompt('v1', 'in s2') as any)
    m.answer(0, label('new_main', { label: 'A' }))
    await clock.advance(1500)
    expect(m.calls).toHaveLength(1)
    expect(fileOf(w, 's1')?.threads).toEqual([])
    expect(fileOf(w, 's2')?.threads).toEqual([])
  })
})

describe('here', () => {
  const userMessage = (uuid: string, onScreen: unknown) => ({
    plugin: 'marks',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: uuid,
    props: { text: 'x', origin: { kind: 'composer' }, isExpanded: false, onScreen },
    viewport: { columns: 200, rows: 45, isFullscreen: true },
  })
  const assistantMessage = (uuid: string, onScreen: unknown) => ({
    plugin: 'marks',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: uuid,
    props: { onScreen },
    viewport: { columns: 200, rows: 45, isFullscreen: true },
  })

  test('in fullscreen the band follows the topmost exchange on screen', async ($, on) => {
    const clock = mock.clock(on)
    world(on, mock)
    const m = model(on)
    await $.session.start(SESSION_START)
    await exchange($, 1)
    await clock.advance(600)
    m.answer(0, label('new_main', { label: 'A' }))
    await exchange($, 2)
    await clock.advance(600)
    m.answer(1, label('new_main', { label: 'B' }))
    await clock.advance(600)
    const band = await $.ui.mount(BAND as any)
    expect(await bandText(band)).toBe('● B · here #2/2 · 2 threads · click or /marks')
    const r1 = await $.ui.mount(assistantMessage('r1', { first: 3, last: 5, of: 6 }) as any)
    const u2 = await $.ui.mount(userMessage('u2', { first: 0, last: 2, of: 3 }) as any)
    await clock.advance(600)
    await band.redraw()
    expect(await bandText(band)).toBe('● A · here #1/2 · 2 threads · click or /marks')
    await r1.redraw({ onScreen: null } as any)
    await clock.advance(600)
    await band.redraw()
    expect(await bandText(band)).toBe('● B · here #2/2 · 2 threads · click or /marks')
    await Promise.all([band.unmount(), r1.unmount(), u2.unmount()])
  })
})
