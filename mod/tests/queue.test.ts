import { describe, expect, test } from 'claude-code/testing'
import { afterSettle, enqueue, headStep, refill, requeue, settleLive, waiting } from '../hooks/lib/queue'
import { emptyFile } from '../hooks/lib/model'
import type { ChainView, ConversationFile, Exchange } from '../types/index'

const ex = (id: string, done = false): Exchange => ({
  id,
  prompts: [id],
  excerpt: id,
  thread: done ? { id: 't1', by: 'labeller' } : null,
  gist: '',
  bookmarks: [],
  label: done ? { status: 'done', model: 'haiku' } : { status: 'pending' },
})
const file = (...exchanges: Exchange[]): ConversationFile => ({ ...emptyFile('s1'), exchanges })

describe('labeller queue: the head', () => {
  test('an empty queue is idle', () => {
    expect(headStep(file(ex('u1')), [], [])).toEqual({ kind: 'idle' })
  })

  test('a pending, live head gets a labeller call', () => {
    expect(headStep(file(ex('u1'), ex('u2')), ['u2', 'u1'], [])).toEqual({ kind: 'label', id: 'u2' })
  })

  test('a head that is labelled already, gone from the file, or hidden by a rewind is dropped', () => {
    expect(headStep(file(ex('u1', true)), ['u1'], [])).toEqual({ kind: 'drop', id: 'u1' })
    expect(headStep(file(ex('u1')), ['gone'], [])).toEqual({ kind: 'drop', id: 'gone' })
    expect(headStep(file(ex('u1')), ['u1'], ['u1'])).toEqual({ kind: 'drop', id: 'u1' })
  })
})

describe('labeller queue: after a call', () => {
  test('a settled head leaves the queue; a retry keeps it at the head', () => {
    expect(afterSettle(['u1', 'u2'], false)).toEqual(['u2'])
    expect(afterSettle(['u1', 'u2'], true)).toEqual(['u1', 'u2'])
  })
})

describe('labeller queue: adding and waiting', () => {
  test("a finished turn's exchange joins the end once", () => {
    expect(enqueue(['u1'], 'u2')).toEqual(['u1', 'u2'])
    expect(enqueue(['u1', 'u2'], 'u1')).toEqual(['u1', 'u2'])
    expect(enqueue(['u1'], undefined)).toEqual(['u1'])
  })

  test('waiting: the queued exchanges, then the running turn’s', () => {
    expect(waiting(['u1', 'u2'], 'u3')).toEqual(['u1', 'u2', 'u3'])
    expect(waiting(['u1'], undefined)).toEqual(['u1'])
  })
})

const view = (hidden: string[], unlabelled: string[] = []): ChainView => ({ hidden, compacted: [], unlabelled })

describe('labeller queue: the gap rule on load', () => {
  test('a short unlabelled run after the last label goes ahead of what was queued', () => {
    const f = file(ex('u1', true), ex('u2'), ex('u3'), ex('u4'))
    expect(refill(f, { queue: ['u4'], running: null, hidden: [], fresh: false })).toEqual({ queue: ['u2', 'u3', 'u4'], unlabelled: [] })
  })

  test('hidden, queued and running exchanges are no gap', () => {
    const f = file(ex('u1', true), ex('u2'), ex('u3'), ex('u4'), ex('u5'))
    expect(refill(f, { queue: ['u4'], running: 'u5', hidden: ['u2'], fresh: false })).toEqual({ queue: ['u3', 'u4'], unlabelled: [] })
  })

  test('a run of more than 10, or a conversation never tracked, is left unlabelled', () => {
    const long = file(ex('u0', true), ...Array.from({ length: 11 }, (_, i) => ex(`v${i}`)))
    expect(refill(long, { queue: [], running: null, hidden: [], fresh: false }).unlabelled).toHaveLength(11)
    expect(refill(file(ex('u1'), ex('u2')), { queue: [], running: null, hidden: [], fresh: true })).toEqual({ queue: [], unlabelled: ['u1', 'u2'] })
  })
})

describe('labeller queue: back on the chain', () => {
  test('a pending exchange a rewind hid joins the end when its fork is live again, unless queued or running', () => {
    const f = file(ex('u1'), ex('u2'), ex('u3'))
    expect(requeue(f, ['u3'], null, view(['u1', 'u2']), view([]))).toEqual(['u3', 'u1', 'u2'])
    expect(requeue(f, ['u3'], 'u2', view(['u1', 'u2']), view([]))).toEqual(['u3', 'u1'])
    expect(requeue(f, [], null, view([]), view([]))).toEqual([])
  })
})

describe('labeller queue: settling on the live chain', () => {
  const answer = '{"thread":{"action":"new_main","label":"Login"},"bookmarks":[],"gist":"bug found"}'

  test('the outcome is placed against the live exchanges; the hidden ones are kept as they were', () => {
    const r = settleLive(file(ex('u1'), ex('u2')), ['u1'], 'u2', { isAnswered: true, text: answer }, 'haiku')
    expect(r.retry).toBe(false)
    expect(r.file.exchanges.map(x => x.id)).toEqual(['u1', 'u2'])
    expect(r.file.exchanges[0]?.label.status).toBe('pending')
    expect(r.file.exchanges[1]?.label.status).toBe('done')
  })

  test('an unanswered call is retried', () => {
    expect(settleLive(file(ex('u1')), [], 'u1', { isAnswered: false, reason: 'api-error' }, 'haiku').retry).toBe(true)
  })
})
