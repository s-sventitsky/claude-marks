import { describe, expect, test } from 'claude-code/testing'
import type { ConversationFile } from '../types/index'
import { gapRun, isLive, isReachable, liveSet, liveView, mergeBack, mergeTurns, turnsOf, unlabelledCount, viewOf, visibleThreads } from '../hooks/lib/chain'
import { addBoundary, emptyTranscript, ingest } from '../hooks/lib/jsonl'
import { addExchange, emptyFile } from '../hooks/lib/model'
import * as J from './fixtures/jsonl'

const read = (...lines: string[]) => {
  const t = emptyTranscript()
  for (const l of lines) ingest(t, l)
  return t
}

const sorted = (s: Set<string>) => [...s].sort()

describe('liveSet', () => {
  test('walks parentUuid back from the newest row', () => {
    const t = read(J.human('u1', null, 'a'), J.text('a1', 'u1', 'x'), J.human('u2', 'a1', 'b'), J.text('a2', 'u2', 'y'))
    expect(sorted(liveSet(t))).toEqual(['a1', 'a2', 'u1', 'u2'])
  })

  test('a rewind leaves the abandoned branch off the chain', () => {
    const t = read(
      J.human('u1', null, 'a'),
      J.text('a1', 'u1', 'x'),
      J.human('u2', 'a1', 'first try'),
      J.text('a2', 'u2', 'y'),
      J.human('u3', 'a1', 'second try'),
      J.text('a3', 'u3', 'z'),
    )
    expect(sorted(liveSet(t))).toEqual(['a1', 'a3', 'u1', 'u3'])
  })

  test('a parent that is not in the file continues at the previous row', () => {
    const t = read(J.human('u1', null, 'a'), J.text('a1', 'u1', 'x'), J.human('u2', 'never-written', 'b'), J.text('a2', 'u2', 'y'))
    expect(sorted(liveSet(t))).toEqual(['a1', 'a2', 'u1', 'u2'])
  })

  test('a boundary continues through logicalParentUuid; one pointing forward continues at the previous row', () => {
    const back = read(J.human('u1', null, 'a'), J.text('a1', 'u1', 'x'), J.boundary('b1', 'a1'), J.userRow('s1', 'b1', 'sum', { isCompactSummary: true }), J.human('u2', 's1', 'b'))
    expect(liveSet(back).has('u1')).toBe(true)
    const forward = read(J.human('u1', null, 'a'), J.text('a1', 'u1', 'x'), J.boundary('b1', 's1'), J.userRow('s1', 'b1', 'sum', { isCompactSummary: true }), J.human('u2', 's1', 'b'))
    expect(sorted(liveSet(forward))).toEqual(['a1', 'b1', 's1', 'u1', 'u2'])
  })

  test('a boundary seen live, before the file has it, links to the row before it', () => {
    const t = read(J.human('u1', null, 'a'), J.text('a1', 'u1', 'x'))
    addBoundary(t, 'b1')
    ingest(t, J.human('u2', 'b1', 'b'))
    expect(sorted(liveSet(t))).toEqual(['a1', 'b1', 'u1', 'u2'])
  })

  test('an empty transcript has nothing live', () => {
    expect(liveSet(emptyTranscript()).size).toBe(0)
  })
})

describe('turnsOf', () => {
  test('one turn per typed prompt, with its reply text rows and tool lines', () => {
    const t = read(
      J.human('u1', null, 'fix it'),
      J.attachment('x1', 'u1', { type: 'date' }),
      J.tool('a1', 'x1', 'Read', { file_path: 'a.ts' }),
      J.toolResult('r1', 'a1'),
      J.text('a2', 'r1', 'looked'),
      J.text('a3', 'a2', 'fixed'),
      J.human('u2', 'a3', 'thanks'),
    )
    expect(turnsOf(t)).toEqual([
      {
        id: 'u1',
        prompts: [{ uuid: 'u1', text: 'fix it' }],
        replies: [
          { uuid: 'a2', text: 'looked' },
          { uuid: 'a3', text: 'fixed' },
        ],
        tools: ['Read a.ts'],
      },
      { id: 'u2', prompts: [{ uuid: 'u2', text: 'thanks' }], replies: [], tools: [] },
    ])
  })

  test('a prompt typed mid-turn folds into the running turn', () => {
    const t = read(J.human('u1', null, 'go'), J.text('a1', 'u1', 'working'), J.queued('q1', 'a1', 'and also'), J.text('a2', 'q1', 'done both'))
    const [turn] = turnsOf(t)
    expect(turn?.prompts).toEqual([
      { uuid: 'u1', text: 'go' },
      { uuid: 'q1', text: 'and also' },
    ])
    expect(turn?.replies.map(r => r.uuid)).toEqual(['a1', 'a2'])
  })

  test('a command turn anchors on its first reply text row, with the command line as its prompt', () => {
    const t = read(
      J.command('c1', null, 'review', 'src'),
      J.userRow('m1', 'c1', 'skill body', { isMeta: true }),
      J.tool('a1', 'm1', 'Grep', { pattern: 'todo' }),
      J.toolResult('r1', 'a1'),
      J.text('a2', 'r1', 'found two'),
      J.tool('a3', 'a2', 'Read', { file_path: 'b.ts' }),
    )
    expect(turnsOf(t)).toEqual([
      { id: 'a2', prompts: [{ uuid: 'a2', text: '/review src' }], replies: [{ uuid: 'a2', text: 'found two' }], tools: ['Grep todo', 'Read b.ts'] },
    ])
  })

  test('a command turn with no reply text makes no turn', () => {
    const t = read(J.command('c1', null, 'clear'), J.userRow('l1', 'c1', '<local-command-stdout></local-command-stdout>'), J.human('u1', 'l1', 'hi'))
    expect(turnsOf(t).map(x => x.id)).toEqual(['u1'])
  })

  test('replies to a turn nobody typed belong to no exchange', () => {
    const t = read(
      J.human('u1', null, 'go'),
      J.text('a1', 'u1', 'ok'),
      J.userRow('n1', 'a1', '<task-notification/>', { origin: { kind: 'task-notification' } }),
      J.text('a2', 'n1', 'noted'),
    )
    expect(turnsOf(t)[0]?.replies.map(r => r.uuid)).toEqual(['a1'])
  })

  test('a turn carries on through a compaction in the middle of it', () => {
    const t = read(J.human('u1', null, 'go'), J.text('a1', 'u1', 'part one'), J.boundary('b1', 'a1'), J.userRow('s1', 'b1', 'sum', { isCompactSummary: true }), J.text('a2', 's1', 'part two'))
    expect(turnsOf(t)[0]?.replies.map(r => r.uuid)).toEqual(['a1', 'a2'])
  })

  test('both branches of a rewind are turns, in file order', () => {
    const t = read(J.human('u1', null, 'a'), J.text('a1', 'u1', 'x'), J.human('u2', 'a1', 'b'), J.human('u3', 'a1', 'c'))
    expect(turnsOf(t).map(x => x.id)).toEqual(['u1', 'u2', 'u3'])
  })
})

const file = (...ids: string[]): ConversationFile => ids.reduce((f, id) => addExchange(f, id, 'p ' + id), emptyFile('s1'))

const labelled = (f: ConversationFile, ...ids: string[]): ConversationFile => ({
  ...f,
  threads: f.threads.length ? f.threads : [{ id: 't1', label: { text: 'T', by: 'labeller' }, parent: null, mergedFrom: [] }],
  exchanges: f.exchanges.map(x => (ids.includes(x.id) ? { ...x, thread: { id: 't1', by: 'labeller' }, label: { status: 'done' } } : x)),
})

describe('mergeTurns', () => {
  test('turns not in the file become pending exchanges, in transcript order around the ones there', () => {
    const t = read(J.human('u1', null, 'one'), J.human('u2', 'u1', 'two'), J.human('u3', 'u2', 'three'))
    const { file: f, index } = mergeTurns(file('u2', 'live'), {}, turnsOf(t))
    expect(f.exchanges.map(x => x.id)).toEqual(['u1', 'u2', 'u3', 'live'])
    expect(f.exchanges[0]).toEqual({ id: 'u1', prompts: ['u1'], excerpt: 'one', thread: null, gist: '', bookmarks: [], label: { status: 'pending' } })
    expect(index.u3).toEqual({ prompts: ['three'], replies: [], tools: [] })
  })

  test('an exchange already there keeps its data and gains folded prompts; a folded prompt is no new exchange', () => {
    const t = read(J.human('u1', null, 'one'), J.queued('q1', 'u1', 'more'), J.human('u2', 'q1', 'two'))
    const start = labelled({ ...file('u1'), exchanges: file('u1').exchanges.map(x => ({ ...x, prompts: ['u1', 'u2'] })) }, 'u1')
    const { file: f } = mergeTurns(start, {}, turnsOf(t))
    expect(f.exchanges).toHaveLength(1)
    expect(f.exchanges[0]?.prompts).toEqual(['u1', 'u2', 'q1'])
    expect(f.exchanges[0]?.thread).toEqual({ id: 't1', by: 'labeller' })
  })

  test('the row index keeps live reply rows the read did not see', () => {
    const t = read(J.human('u1', null, 'one'), J.text('a1', 'u1', 'x'))
    const live = { u1: { prompts: ['one'], replies: [{ uuid: 'a1', text: 'x' }, { uuid: 'a2', text: 'y' }], tools: ['Bash ls'] } }
    const { index } = mergeTurns(file('u1'), live, turnsOf(t))
    expect(index.u1).toEqual({ prompts: ['one'], replies: [{ uuid: 'a1', text: 'x' }, { uuid: 'a2', text: 'y' }], tools: ['Bash ls'] })
  })

  test('nothing new: the same file comes back', () => {
    const t = read(J.human('u1', null, 'one'))
    const f = file('u1')
    expect(mergeTurns(f, {}, turnsOf(t)).file).toBe(f)
  })
})

describe('viewOf', () => {
  test('hidden: exchanges the transcript knows that are off the active chain; unknown ones stay live', () => {
    const t = read(J.human('u1', null, 'a'), J.text('a1', 'u1', 'x'), J.human('u2', 'a1', 'old'), J.human('u3', 'a1', 'new'))
    const v = viewOf(t, file('u1', 'u2', 'u3', 'fresh'), [])
    expect(v.hidden).toEqual(['u2'])
    expect(isLive(v, 'u2')).toBe(false)
    expect(isLive(v, 'u3')).toBe(true)
    expect(isLive(v, 'fresh')).toBe(true)
  })

  test('compacted: exchanges before the last boundary; reachable means fullscreen and not compacted', () => {
    const t = read(
      J.human('u1', null, 'a'),
      J.boundary('b1', 'u1'),
      J.human('u2', 'b1', 'b'),
      J.boundary('b2', 'u2'),
      J.human('u3', 'b2', 'c'),
    )
    const v = viewOf(t, file('u1', 'u2', 'u3', 'fresh'), [])
    expect(v.compacted).toEqual(['u1', 'u2'])
    expect(isReachable(v, 'u2', true)).toBe(false)
    expect(isReachable(v, 'u3', true)).toBe(true)
    expect(isReachable(v, 'fresh', true)).toBe(true)
    expect(isReachable(v, 'u3', false)).toBe(false)
  })

  test('a live boundary makes everything before it unreachable', () => {
    const t = read(J.human('u1', null, 'a'))
    addBoundary(t, 'b1')
    expect(viewOf(t, file('u1'), []).compacted).toEqual(['u1'])
  })

  test('carries the unlabelled ids it is given', () => {
    expect(viewOf(emptyTranscript(), file('u1'), ['u1']).unlabelled).toEqual(['u1'])
  })
})

describe('gapRun', () => {
  const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `u${i + from}`)

  test('10 or fewer unlabelled live exchanges after the last labelled one are queued', () => {
    const f = labelled(file(...ids(13)), 'u1', 'u2', 'u3')
    expect(gapRun(f, [], false)).toEqual({ queue: ids(10, 4), left: [] })
  })

  test('a longer run stays unlabelled', () => {
    const f = labelled(file(...ids(14)), 'u1', 'u2', 'u3')
    expect(gapRun(f, [], false)).toEqual({ queue: [], left: ids(11, 4) })
  })

  test('hidden exchanges are left out of the run', () => {
    const f = labelled(file(...ids(14)), 'u1')
    expect(gapRun(f, ['u5', 'u6', 'u7'], false)).toEqual({ queue: ['u2', 'u3', 'u4', ...ids(7, 8)], left: [] })
  })

  test('a conversation the mod never tracked stays unlabelled, however short', () => {
    expect(gapRun(file('u1', 'u2'), [], true)).toEqual({ queue: [], left: ['u1', 'u2'] })
  })

  test('tracked exchanges never labelled yet (a reload before the first label) are queued', () => {
    expect(gapRun(file('u1', 'u2'), [], false)).toEqual({ queue: ['u1', 'u2'], left: [] })
  })

  test('nothing after the last labelled one: nothing to do', () => {
    expect(gapRun(labelled(file('u1'), 'u1'), [], false)).toEqual({ queue: [], left: [] })
  })
})

describe('liveView and mergeBack', () => {
  test('the view drops hidden exchanges and keeps every thread', () => {
    const f = labelled(file('u1', 'u2', 'u3'), 'u1', 'u2')
    const v = liveView(f, ['u2'])
    expect(v.exchanges.map(x => x.id)).toEqual(['u1', 'u3'])
    expect(v.threads).toBe(f.threads)
    expect(liveView(f, [])).toBe(f)
  })

  test('mergeBack puts a changed view back without losing the hidden exchanges', () => {
    const f = file('u1', 'u2', 'u3')
    const v = labelled(liveView(f, ['u2']), 'u3')
    const back = mergeBack(f, v)
    expect(back.exchanges.map(x => [x.id, x.thread?.id ?? null])).toEqual([
      ['u1', null],
      ['u2', null],
      ['u3', 't1'],
    ])
    expect(back.threads).toBe(v.threads)
  })
})

test('visibleThreads: threads with an exchange, and a main thread while a sub of it has one', () => {
  const th = (id: string, parent: string | null = null) => ({ id, label: { text: id, by: 'labeller' as const }, parent, mergedFrom: [] })
  const f = { ...labelled(file('u1'), 'u1'), threads: [th('t0'), th('t1', 't0'), th('t2'), th('t3', 't2')] }
  const onT1 = { ...f, exchanges: f.exchanges.map(x => ({ ...x, thread: { id: 't1', by: 'labeller' as const } })) }
  expect(visibleThreads(onT1).map(t => t.id)).toEqual(['t0', 't1'])
})

test('unlabelledCount: the left ones still live and still unlabelled', () => {
  const f = labelled(file('u1', 'u2', 'u3', 'u4'), 'u3')
  expect(unlabelledCount(f, { hidden: ['u2'], compacted: [], unlabelled: ['u1', 'u2', 'u3'] })).toBe(1)
  expect(unlabelledCount(f, null)).toBe(0)
})
