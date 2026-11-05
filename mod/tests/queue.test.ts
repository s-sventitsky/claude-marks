import { describe, expect, test } from 'claude-code/testing'
import { afterSettle, enqueue, headStep, waiting } from '../hooks/lib/queue'
import { emptyFile } from '../hooks/lib/model'
import type { ConversationFile, Exchange } from '../types/index'

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
