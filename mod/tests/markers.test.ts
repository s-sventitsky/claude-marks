import { describe, expect, test } from 'claude-code/testing'
import { dividerLine, markers } from '../hooks/lib/markers'
import { emptyFile } from '../hooks/lib/model'
import type { ConversationFile, Exchange, Thread } from '../types/index'

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
const file = (threads: Thread[], exchanges: Exchange[]): ConversationFile => ({ ...emptyFile('s1'), threads, exchanges })

describe('markers: which exchanges get a divider', () => {
  test('none before any label', () => {
    expect(markers(file([], [ex('u1', null), ex('u2', null)]))).toEqual({})
  })

  test('the first labelled exchange opens its thread; the rest of the thread gets nothing', () => {
    const f = file([th('t1', 'Login fix')], [ex('u1', 't1'), ex('u2', 't1')])
    expect(markers(f)).toEqual({ u1: { color: 'suggestion', divider: 'Login fix' } })
  })

  test('a change of thread draws a divider in the new thread colour', () => {
    const f = file([th('t1', 'Login fix'), th('t2', 'Docs')], [ex('u1', 't1'), ex('u2', 't2'), ex('u3', 't1')])
    expect(markers(f)).toEqual({
      u1: { color: 'suggestion', divider: 'Login fix' },
      u2: { color: 'success', divider: 'Docs' },
      u3: { color: 'suggestion', divider: 'Login fix' },
    })
  })

  test('a sub-thread divider reads └ label, in its main thread colour', () => {
    const f = file([th('t1', 'Login fix'), th('t2', 'Docs'), th('t3', 'Retry', 't1')], [ex('u1', 't2'), ex('u2', 't3')])
    expect(markers(f).u2).toEqual({ color: 'suggestion', divider: '└ Retry' })
  })

  test('an unlabelled exchange between two of one thread does not split it', () => {
    const f = file([th('t1', 'Login fix')], [ex('u1', 't1'), ex('u2', null), ex('u3', 't1')])
    expect(markers(f)).toEqual({ u1: { color: 'suggestion', divider: 'Login fix' } })
  })
})

describe('markers: prompt glyph', () => {
  test('the first bookmark glyph, in the thread colour, with or without a divider', () => {
    const f = file(
      [th('t1', 'Login fix')],
      [ex('u1', 't1', [{ kind: 'landmark', text: 'x' }]), ex('u2', 't1', [{ kind: 'branch_point', text: 'y' }, { kind: 'landmark', text: 'z' }])],
    )
    expect(markers(f)).toEqual({
      u1: { color: 'suggestion', divider: 'Login fix', glyph: '◇' },
      u2: { color: 'suggestion', glyph: '↳' },
    })
  })

  test('a dismissed bookmark shows no glyph', () => {
    const f = file([th('t1', 'A')], [ex('u1', 't1'), ex('u2', 't1', [{ kind: 'landmark', text: 'x', dismissed: true }, { kind: 'manual', text: 'm' }])])
    expect(markers(f).u2).toEqual({ color: 'suggestion', glyph: '◆' })
  })

  test('an unlabelled exchange with a manual bookmark takes the current thread colour', () => {
    const f = file([th('t1', 'A'), th('t2', 'B')], [ex('u1', 't1'), ex('u2', 't2'), ex('u3', null, [{ kind: 'manual', text: 'm' }])])
    expect(markers(f).u3).toEqual({ color: 'success', glyph: '◆' })
  })
})

describe('dividerLine', () => {
  test('── label ─── filling the row less one column', () => {
    expect(dividerLine('Login fix', 20)).toBe('── Login fix ──────')
    expect(dividerLine('└ Retry', 16)).toBe('── └ Retry ────')
  })

  test('a label too long for the row is cut with an ellipsis', () => {
    expect(dividerLine('A very long thread label', 12)).toBe('── A very…')
  })
})
