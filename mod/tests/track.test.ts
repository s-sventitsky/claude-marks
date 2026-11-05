import { expect, test, mock, describe } from 'claude-code/testing'
import { emptyFile, addExchange } from '../hooks/lib/model'
import { BAND, SESSION_START, dataPath, fileOf, mirrored, prompt, queued, replyText, toolUse, world } from './harness'

const turn = (id: string) => ({ text: '', turnId: id })
const done = (id: string) => ({ answer: 'x', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' }) as const

describe('exchanges from composer prompts', () => {
  test('a composer prompt becomes a pending exchange in the data file', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', '  fix   the\nlogin bug  ') as any)
    await clock.advance(1500)
    const f = fileOf(w, 's1')
    expect(f?.schema).toBe(1)
    expect(f?.sessionId).toBe('s1')
    expect(f?.exchanges).toEqual([
      { id: 'u1', prompts: ['u1'], excerpt: 'fix the login bug', thread: null, gist: '', bookmarks: [], label: { status: 'pending' } },
    ])
    expect(f?.threads).toEqual([])
    expect(f?.corrections).toEqual([])
    expect(f?.bookmarkStats).toEqual({ landmark: { flagged: 0, dismissed: 0 }, branch_point: { flagged: 0, dismissed: 0 } })
  })

  test('prompts from subagents, meta rows and non-composer origins are not exchanges', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.session.append(prompt('a1', 'sub', { agentId: 'ag1' }) as any)
    await $.session.append(prompt('m1', 'meta', { message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: 'meta' }] } }) as any)
    await $.session.append(prompt('n1', 'notify', { origin: { kind: 'task-notification' } }) as any)
    await $.session.append(prompt('u1', 'real') as any)
    await clock.advance(1500)
    expect(fileOf(w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1'])
  })

  test('a prompt appended while a turn runs folds into its exchange', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'first') as any)
    await $.turn.start(turn('T1'))
    await $.session.append(prompt('u2', 'more') as any)
    await $.turn.complete(done('T1'))
    await $.session.append(prompt('u3', 'next') as any)
    await clock.advance(1500)
    const f = fileOf(w, 's1')
    expect(f?.exchanges.map(x => [x.id, x.prompts])).toEqual([
      ['u1', ['u1', 'u2']],
      ['u3', ['u3']],
    ])
  })

  test('a prompt typed over a running turn and delivered as queued_command folds in', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'first') as any)
    await $.turn.start(turn('T1'))
    await $.prompt.submit({ text: 'also', turnId: 'T1', wait: false, origin: { kind: 'composer' } } as any)
    await $.session.append(queued('q1', 'also') as any)
    await $.turn.complete(done('T1'))
    await clock.advance(1500)
    expect(fileOf(w, 's1')?.exchanges[0]?.prompts).toEqual(['u1', 'q1'])
  })

  test('a slash-command turn anchors on its first reply text row', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.prompt.submit({ text: '/review the diff', command: { name: 'review', args: 'the diff' }, wait: false, origin: { kind: 'composer' } } as any)
    await $.turn.start(turn('T1'))
    await $.session.append(toolUse('r1', 'Bash', { command: 'git diff' }) as any)
    await $.session.append(replyText('r2', 'Here is the review') as any)
    await $.turn.complete(done('T1'))
    await clock.advance(1500)
    expect(fileOf(w, 's1')?.exchanges.map(x => [x.id, x.excerpt])).toEqual([['r2', '/review the diff']])
  })
})

describe('data file, $.state and $.store', () => {
  test('the file is mirrored in $.state at once and written back debounced', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'one') as any)
    expect((mirrored(w))?.exchanges.map((x: any) => x.id)).toEqual(['u1'])
    await clock.advance(600)
    await $.session.append(prompt('u2', 'two') as any)
    await clock.advance(600)
    expect(w.writes).toEqual([])
    await clock.advance(500)
    expect(w.writes).toEqual([dataPath('s1')])
    expect(fileOf(w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1', 'u2'])
  })

  test('$.store holds only the { sessionId: { file, updatedAt } } index', async ($, on) => {
    const clock = mock.clock(on, { now: Date.UTC(2026, 10, 4, 12) })
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'one') as any)
    await clock.advance(1500)
    expect([...w.store.keys()]).toEqual(['s1'])
    const entry = w.store.get('s1') as any
    expect(entry.file.replace(/\\/g, '/')).toBe(dataPath('s1'))
    expect(entry.updatedAt).toBe('2026-11-04T12:00:01.000Z')
  })

  test('an existing file loads on session start', async ($, on) => {
    mock.clock(on)
    const old = addExchange(emptyFile('s1'), 'u0', 'earlier')
    const w = world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(old) } })
    await $.session.start(SESSION_START)
    expect((mirrored(w))?.exchanges.map((x: any) => x.id)).toEqual(['u0'])
  })

  test('a file for another session or schema is ignored', async ($, on) => {
    mock.clock(on)
    const w = world(on, mock, { files: { [dataPath('s1')]: JSON.stringify({ ...emptyFile('other'), schema: 1 }) } })
    await $.session.start(SESSION_START)
    expect(mirrored(w)).toEqual(emptyFile('s1'))
  })

  test('hot reload keeps the data held in $.state, even when the file lags', async ($, on) => {
    const clock = mock.clock(on)
    const held = addExchange(addExchange(emptyFile('s1'), 'u1', 'a'), 'u2', 'b')
    const lagging = addExchange(emptyFile('s1'), 'u1', 'a')
    const w = world(on, mock, { files: { [dataPath('s1')]: JSON.stringify(lagging) } })
    // What the reloaded module finds in $.state, written by the module before the reload.
    // Answered once (the load), then the kit's own state takes over.
    let reloaded = false
    on('state.get', (_: unknown, e: any, next: any) => {
      if (reloaded) return next(e)
      reloaded = true
      return { value: { value: { shape: 'conv-1', value: held }, version: 0 } }
    })
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u3', 'c') as any)
    await clock.advance(1500)
    expect(w.logs).toEqual([])
    expect(fileOf(w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1', 'u2', 'u3'])
  })
})

describe('conversation switches', () => {
  test('a new session id on a prompt append flushes the old file and loads the new one', async ($, on) => {
    const clock = mock.clock(on)
    const other = addExchange(emptyFile('s2'), 'v1', 'from before')
    const w = world(on, mock, { files: { [dataPath('s2')]: JSON.stringify(other) } })
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'in s1') as any)
    w.sessionId.current = 's2' // /clear or /resume, no session.start
    await $.session.append(prompt('v2', 'in s2') as any)
    expect(fileOf(w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1'])
    await clock.advance(1500)
    expect(fileOf(w, 's2')?.exchanges.map(x => x.id)).toEqual(['v1', 'v2'])
    expect((mirrored(w))?.sessionId).toBe('s2')
  })

  test('/clear: session.end flushes now, and the switch is picked up without a prompt', async ($, on) => {
    const clock = mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'in s1') as any)
    w.sessionId.current = 's3'
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: undefined } as any)
    expect(fileOf(w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1'])
    await clock.advance(300)
    expect(mirrored(w)).toEqual(emptyFile('s3'))
  })

  test('a session.start under a new id (in-session /resume) switches', async ($, on) => {
    mock.clock(on)
    const other = addExchange(emptyFile('s2'), 'v1', 'x')
    const w = world(on, mock, { files: { [dataPath('s2')]: JSON.stringify(other) } })
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'in s1') as any)
    w.sessionId.current = 's2'
    await $.session.start(SESSION_START)
    expect(fileOf(w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1'])
    expect((mirrored(w))?.exchanges.map((x: any) => x.id)).toEqual(['v1'])
  })
})

describe('band and status line', () => {
  test('the band draws nothing with no exchanges, then labelling… until a label lands', async ($, on) => {
    mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    const ui = await $.ui.mount(BAND as any)
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
    await $.session.append(prompt('u1', 'one') as any)
    await $.session.append(prompt('u2', 'two') as any)
    await ui.redraw()
    expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')).toBe('○ labelling… · click or /marks')
    await ui.unmount()
  })

  test('the status line reads /marks · 0 threads, set once', async ($, on) => {
    mock.clock(on)
    const w = world(on, mock)
    await $.session.start(SESSION_START)
    await $.session.append(prompt('u1', 'one') as any)
    expect(w.status).toEqual(['/marks · 0 threads'])
  })
})
