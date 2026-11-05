import { describe, expect, test } from 'claude-code/testing'
import { emptyFile } from '../hooks/lib/model'
import { REASON } from '../hooks/lib/pane'
import { readerModel, type ReaderOptions } from '../hooks/lib/reader'
import type { ExchangeRows } from '../hooks/lib/rows'
import type { ConversationFile, Exchange, Thread } from '../types/index'

const th = (id: string, text: string, parent: string | null = null): Thread => ({ id, label: { text, by: 'labeller' }, parent, mergedFrom: [] })
const ex = (id: string, thread: string | null, bookmarks: Exchange['bookmarks'] = []): Exchange => ({
  id,
  prompts: [id],
  excerpt: `excerpt ${id}`,
  thread: thread ? { id: thread, by: 'labeller' } : null,
  gist: thread ? `gist ${id}` : '',
  bookmarks,
  label: { status: thread ? 'done' : 'pending' },
})
const file = (threads: Thread[], exchanges: Exchange[]): ConversationFile => ({ ...emptyFile('s1'), threads, exchanges })
const FS: ReaderOptions = { fullscreen: true }

// Login (t1) with sub Cookie bug (t2); Docs (t3) in between.
const F = file(
  [th('t1', 'Login'), th('t2', 'Cookie bug', 't1'), th('t3', 'Docs')],
  [ex('a', 't1'), ex('b', 't3'), ex('c', 't2'), ex('d', 't1'), ex('e', 't3')],
)

describe('reader header', () => {
  test('a main thread: its label in its colour, #n among live exchanges, i of k over the family', () => {
    const m = readerModel(F, 'd', FS)
    expect(m?.path).toEqual([{ text: 'Login', color: 'suggestion', bold: true }])
    expect(m?.n).toBe(4)
    expect(m?.i).toBe(3)
    expect(m?.k).toBe(3)
  })

  test('a sub-thread: `Main › Sub`, counted over the main thread family (main plus subs, tree order)', () => {
    const m = readerModel(F, 'c', FS)
    expect(m?.path).toEqual([
      { text: 'Login', color: 'suggestion', bold: true },
      { text: ' › Cookie bug', color: 'suggestion' },
    ])
    expect([m?.n, m?.i, m?.k]).toEqual([3, 2, 3])
  })

  test('the second main thread takes the next colour', () => {
    expect(readerModel(F, 'e', FS)?.path).toEqual([{ text: 'Docs', color: 'success', bold: true }])
  })

  test('an exchange not in the file, or hidden by a rewind, has no reader', () => {
    expect(readerModel(F, 'zz', FS)).toBeUndefined()
    expect(readerModel(F, 'c', { ...FS, isLive: x => x.id !== 'c' })).toBeUndefined()
  })

  test('hidden exchanges are not counted in #n nor in the family', () => {
    const m = readerModel(F, 'd', { ...FS, isLive: x => x.id !== 'a' })
    expect([m?.n, m?.i, m?.k]).toEqual([3, 2, 2])
  })

  test('the Unlabelled group: a dim `Unlabelled` path, counted over the group', () => {
    const xs = Array.from({ length: 12 }, (_, i) => ex(`u${i}`, null))
    const f = file([th('t1', 'Login')], [ex('a', 't1'), ...xs, ex('z', 't1')])
    const m = readerModel(f, 'u3', FS)
    expect(m?.path).toEqual([{ text: 'Unlabelled', dim: true }])
    expect([m?.n, m?.i, m?.k]).toEqual([5, 4, 12])
  })
})

describe('reader reason and keys', () => {
  test('reachable in fullscreen: no reason, g can jump', () => {
    const m = readerModel(F, 'a', FS)
    expect(m?.reason).toBeNull()
    expect(m?.canJump).toBe(true)
  })

  test('unreachable: the compaction sentence, g inert', () => {
    const m = readerModel(F, 'a', { ...FS, isReachable: () => false })
    expect(m?.reason).toBe('Before the last compaction: not on screen, so the reader shows it.')
    expect(m?.canJump).toBe(false)
  })

  test('main screen: the main-screen sentence, g inert', () => {
    const m = readerModel(F, 'a', { fullscreen: false })
    expect(m?.reason).toBe(REASON.mainScreen)
    expect(m?.canJump).toBe(false)
  })

  test('a denied jump: the deny text is the reason; g stays live to try again', () => {
    const m = readerModel(F, 'a', { ...FS, deny: 'Jump denied: busy' })
    expect(m?.reason).toBe('Jump denied: busy')
    expect(m?.canJump).toBe(true)
  })

  test('j/k step through the family in tree order, sub-thread included; none past either end', () => {
    expect([readerModel(F, 'a', FS)?.prev, readerModel(F, 'a', FS)?.next]).toEqual([undefined, 'c'])
    expect([readerModel(F, 'c', FS)?.prev, readerModel(F, 'c', FS)?.next]).toEqual(['a', 'd'])
    expect([readerModel(F, 'd', FS)?.prev, readerModel(F, 'd', FS)?.next]).toEqual(['c', undefined])
  })

  test('j/k skip hidden exchanges', () => {
    expect(readerModel(F, 'a', { ...FS, isLive: x => x.id !== 'c' })?.next).toBe('d')
  })
})

describe('reader body', () => {
  test("the exchange's bookmarks, glyph first in the thread's colour, dismissed ones left out", () => {
    const f = file(
      [th('t1', 'Login'), th('t2', 'Docs')],
      [
        ex('a', 't1'),
        ex('b', 't2', [
          { kind: 'manual', text: 'chose JSON schema' },
          { kind: 'landmark', text: 'settled the format', dismissed: true },
          { kind: 'branch_point', text: 'three options' },
        ]),
      ],
    )
    expect(readerModel(f, 'b', FS)?.bookmarks).toEqual([
      { glyph: '◆', color: 'success', text: 'chose JSON schema' },
      { glyph: '↳', color: 'success', text: 'three options' },
    ])
    expect(readerModel(f, 'a', FS)?.bookmarks).toEqual([])
  })

  test('prompt and reply text blocks come from the row index (pre-compaction exchanges included)', () => {
    const rows: ExchangeRows = {
      prompts: ['why does login fail?', 'and on mobile?'],
      replies: [
        { uuid: 'r1', text: 'Looking at it.' },
        { uuid: 'r2', text: '**Found** it.' },
      ],
      tools: ['Read src/login.ts'],
    }
    const m = readerModel(F, 'a', { ...FS, isReachable: () => false, rows })
    expect(m?.prompts).toEqual(['why does login fail?', 'and on mobile?'])
    expect(m?.replies).toEqual(['Looking at it.', '**Found** it.'])
  })

  test('no index entry yet: the excerpt stands for the prompt, no reply blocks', () => {
    const m = readerModel(F, 'a', FS)
    expect(m?.prompts).toEqual(['excerpt a'])
    expect(m?.replies).toEqual([])
  })
})
