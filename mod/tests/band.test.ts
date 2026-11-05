import { describe, expect, test } from 'claude-code/testing'
import { band, colorOf, statusLine, type Segment } from '../hooks/lib/band'
import { addExchange, emptyFile } from '../hooks/lib/model'
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
const text = (s: Segment[] | undefined) => s?.map(x => x.text).join('')
const HINT = 'click or /marks'
const FS = { fullscreen: true, hint: HINT }

describe('band', () => {
  test('draws nothing with no exchanges', () => {
    expect(band(emptyFile('s1'), FS)).toBeUndefined()
    expect(band(null, FS)).toBeUndefined()
  })

  test('before the first label: ○ labelling…', () => {
    const f = addExchange(emptyFile('s1'), 'u1', 'a')
    expect(text(band(f, FS))).toBe('○ labelling… · click or /marks')
  })

  test('a main thread shows its label, the latest exchange and its glyphs in the thread colour', () => {
    const f = file([th('t1', 'Login fix')], [ex('u1', 't1'), ex('u2', 't1', [{ kind: 'landmark', text: 'x' }])])
    const s = band(f, FS)
    expect(text(s)).toBe('● Login fix · here #2/2 ◇ · click or /marks')
    expect(s?.find(x => x.text === 'Login fix')).toEqual({ text: 'Login fix', color: 'suggestion', bold: true })
    expect(s?.find(x => x.text === ' ◇')?.color).toBe('suggestion')
    expect(s?.find(x => x.text.includes('here'))?.dim).toBe(true)
  })

  test('a sub-thread shows Main › Sub, in its main thread colour', () => {
    const f = file([th('t1', 'A'), th('t2', 'Docs'), th('t3', 'Side', 't2')], [ex('u1', 't1'), ex('u2', 't2'), ex('u3', 't3')])
    const s = band(f, FS)
    expect(text(s)).toBe('● Docs › Side · here #3/3 · click or /marks')
    expect(s?.filter(x => x.color).every(x => x.color === 'success')).toBe(true)
  })

  test('glyphs: manual ◆, landmark ◇, branch point ↳; dismissed ones are not drawn', () => {
    const f = file(
      [th('t1', 'A')],
      [
        ex('u1', 't1', [
          { kind: 'manual', text: 'm' },
          { kind: 'branch_point', text: 'b' },
          { kind: 'landmark', text: 'l', dismissed: true },
        ]),
      ],
    )
    expect(text(band(f, FS))).toBe('● A · here #1/1 ◆↳ · click or /marks')
  })

  test('here follows the given exchange in fullscreen; the main screen says latest', () => {
    const f = file([th('t1', 'A'), th('t2', 'B')], [ex('u1', 't1'), ex('u2', 't2')])
    expect(text(band(f, { ...FS, hereId: 'u1' }))).toBe('● A · here #1/2 · click or /marks')
    expect(text(band(f, { ...FS, hereId: 'gone' }))).toBe('● B · here #2/2 · click or /marks')
    expect(text(band(f, { fullscreen: false, hint: HINT, hereId: 'u1' }))).toBe('● B · latest #2/2 · click or /marks')
  })

  test('a pending exchange shows in the current thread', () => {
    const f = file([th('t1', 'A')], [ex('u1', 't1'), ex('u2', null)])
    expect(text(band(f, FS))).toBe('● A · here #2/2 · click or /marks')
  })

  test('the hint slot shows what it is given', () => {
    const f = file([th('t1', 'A')], [ex('u1', 't1')])
    expect(text(band(f, { ...FS, hint: 'labeller off: blocked' }))).toBe('● A · here #1/1 · labeller off: blocked')
    expect(text(band(addExchange(emptyFile('s1'), 'u1', 'a'), { ...FS, hint: 'labeller off: blocked' }))).toBe('○ labelling… · labeller off: blocked')
  })
})

describe('colorOf', () => {
  test('main threads take the palette by index, wrapping; subs take their main colour', () => {
    const mains = Array.from({ length: 9 }, (_, i) => th(`t${i + 1}`, String(i)))
    const f = file([...mains, th('t10', 'sub', 't2')], [])
    expect(mains.map(t => colorOf(f, t.id))).toEqual(['suggestion', 'success', 'warning', 'merged', 'planMode', 'autoAccept', 'ide', 'permission', 'suggestion'])
    expect(colorOf(f, 't10')).toBe('success')
  })
})

test('status line counts threads', () => {
  expect(statusLine(emptyFile('s1'))).toBe('/marks · 0 threads')
  expect(statusLine(null)).toBe('/marks · 0 threads')
  expect(statusLine(file([th('t1', 'x')], []))).toBe('/marks · 1 thread')
  expect(statusLine(file([th('t1', 'x'), th('t2', 'y')], []))).toBe('/marks · 2 threads')
})
