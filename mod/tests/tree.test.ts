import { describe, expect, test } from 'claude-code/testing'
import { emptyFile } from '../hooks/lib/model'
import { layoutTree, type TreeOptions, type TreeRow } from '../hooks/lib/tree'
import type { ConversationFile, Exchange, Thread } from '../types/index'

const th = (id: string, text: string, parent: string | null = null): Thread => ({ id, label: { text, by: 'labeller' }, parent, mergedFrom: [] })
const ex = (id: string, thread: string | null, gist = `gist ${id}`, bookmarks: Exchange['bookmarks'] = []): Exchange => ({
  id,
  prompts: [id],
  excerpt: `excerpt ${id}`,
  thread: thread ? { id: thread, by: 'labeller' } : null,
  gist: thread ? gist : '',
  bookmarks,
  label: { status: thread ? 'done' : 'pending' },
})
const file = (threads: Thread[], exchanges: Exchange[]): ConversationFile => ({ ...emptyFile('s1'), threads, exchanges })
const line = (r: TreeRow) => r.segments.map(s => s.text).join('')
const lines = (rows: TreeRow[]) => rows.map(line)
const WIDE: TreeOptions = { columns: 60, narrow: false }

describe('tree layout', () => {
  test('main threads in order of their first exchange, each followed by its exchanges', () => {
    const f = file([th('t1', 'Login'), th('t2', 'Docs')], [ex('a', 't2'), ex('b', 't1'), ex('c', 't2')])
    expect(lines(layoutTree(f, WIDE))).toEqual([
      'Docs  2 ex',
      ' 1    gist a',
      ' 3    gist c',
      'Login  1 ex',
      ' 2    gist b',
    ])
  })

  test('a sub-thread header goes before its first exchange; its exchanges are indented wherever they fall', () => {
    const f = file(
      [th('t1', 'Login'), th('t2', 'Cookie bug', 't1')],
      [ex('a', 't1'), ex('b', 't2'), ex('c', 't1'), ex('d', 't2')],
    )
    expect(lines(layoutTree(f, WIDE))).toEqual([
      'Login  4 ex',
      ' 1    gist a',
      ' └ Cookie bug  2 ex',
      '    2    gist b',
      ' 3    gist c',
      '    4    gist d',
    ])
  })

  test('header counts: exchanges, then bookmarks by kind (◆ ◇ ↳), dismissed left out; a main counts its family', () => {
    const f = file(
      [th('t1', 'Login'), th('t2', 'Cookie bug', 't1')],
      [
        ex('a', 't1', 'g', [{ kind: 'landmark', text: '' }, { kind: 'branch_point', text: '' }]),
        ex('b', 't2', 'g', [{ kind: 'manual', text: '' }, { kind: 'landmark', text: '' }]),
        ex('c', 't1', 'g', [{ kind: 'landmark', text: '', dismissed: true }]),
      ],
    )
    const rows = layoutTree(f, WIDE)
    expect(line(rows[0] as TreeRow)).toBe('Login  3 ex  ◆1 ◇2 ↳1')
    expect(line(rows[2] as TreeRow)).toBe(' └ Cookie bug  1 ex  ◆1 ◇1')
  })

  test('narrow: counts shrink to the exchange count', () => {
    const f = file([th('t1', 'Login'), th('t2', 'Cookie bug', 't1')], [ex('a', 't1', 'g', [{ kind: 'landmark', text: '' }]), ex('b', 't2')])
    const rows = layoutTree(f, { columns: 40, narrow: true })
    expect(line(rows[0] as TreeRow)).toBe('Login  2')
    expect(line(rows[2] as TreeRow)).toBe(' └ Cookie bug  1')
  })

  test('headers draw bold in the thread colour (a sub takes its main colour, not bold); counts dim', () => {
    const f = file([th('t1', 'Login'), th('t2', 'Docs'), th('t3', 'Sub', 't2')], [ex('a', 't1'), ex('b', 't2'), ex('c', 't3')])
    const rows = layoutTree(f, WIDE)
    const docs = rows.find(r => r.key === 'th:t2') as TreeRow
    expect(docs.segments[0]).toEqual({ text: 'Docs', color: 'success', bold: true })
    expect(docs.segments[1]?.dim).toBe(true)
    const sub = rows.find(r => r.key === 'th:t3') as TreeRow
    expect(sub.kind).toBe('sub')
    expect(sub.segments[0]).toEqual({ text: ' └ Sub', color: 'success' })
  })

  test('a header targets its first exchange', () => {
    const f = file([th('t1', 'Login'), th('t2', 'Sub', 't1')], [ex('a', 't1'), ex('b', 't2'), ex('c', 't2')])
    const rows = layoutTree(f, WIDE)
    expect(rows.find(r => r.key === 'th:t1')?.target).toBe('a')
    expect(rows.find(r => r.key === 'th:t2')?.target).toBe('b')
    expect(rows.find(r => r.key === 'ex:c')?.target).toBe('c')
  })
})

describe('tree exchange rows', () => {
  const f = file(
    [th('t1', 'Login')],
    [
      ex('a', 't1', 'first', [{ kind: 'landmark', text: '' }, { kind: 'branch_point', text: '' }, { kind: 'manual', text: '' }]),
      ex('b', 't1', ''),
      ex('c', 't1', 'third'),
    ],
  )
  const row = (rows: TreeRow[], id: string) => rows.find(r => r.key === `ex:${id}`) as TreeRow

  test('up to two glyphs in the thread colour, in the glyph slot', () => {
    const r = row(layoutTree(f, WIDE), 'a')
    expect(line(r)).toBe(' 1 ◇↳ first')
    expect(r.segments.find(s => s.text === '◇↳')?.color).toBe('suggestion')
  })

  test('an exchange with no gist shows its excerpt', () => {
    expect(line(row(layoutTree(f, WIDE), 'b'))).toBe(' 2    excerpt b')
  })

  test('the last-jumped exchange has ›, the others a space', () => {
    const rows = layoutTree(f, { ...WIDE, lastJump: 'c' })
    expect(line(row(rows, 'c'))).toBe('›3    third')
    expect(line(row(rows, 'a'))).toStartWith(' 1')
  })

  test("the band's exchange draws bold", () => {
    const rows = layoutTree(f, { ...WIDE, bandId: 'c' })
    expect(row(rows, 'c').segments.at(-1)).toEqual({ text: ' third', bold: true })
    expect(row(rows, 'a').segments.at(-1)?.bold).toBeUndefined()
  })

  test('unreachable exchanges draw dim, every segment', () => {
    const rows = layoutTree(f, { ...WIDE, isReachable: x => x.id !== 'b' })
    expect(row(rows, 'b').segments.every(s => s.dim)).toBe(true)
    expect(row(rows, 'c').segments.at(-1)?.dim).toBeUndefined()
  })

  test('the text is cut to fit the body columns, an ellipsis marking the cut', () => {
    const g = file([th('t1', 'A very long thread label indeed')], [ex('a', 't1', 'a gist that is much too long to fit in the pane')])
    const rows = layoutTree(g, { columns: 20, narrow: true })
    expect(rows.map(line)).toEqual(['A very long thre…  1', ' 1    a gist that i…'])
    expect(rows.every(r => line(r).length <= 20)).toBe(true)
  })
})

const nulls = (prefix: string, k: number) => Array.from({ length: k }, (_, i) => ex(`${prefix}${i + 1}`, null))

describe('tree liveness, pending and Unlabelled', () => {
  test('non-live exchanges are hidden, numbers count live ones, a thread with none live is hidden', () => {
    const f = file([th('t1', 'Login'), th('t2', 'Dead fork')], [ex('a', 't1'), ex('x', 't2'), ex('b', 't1')])
    expect(lines(layoutTree(f, { ...WIDE, isLive: x => x.id !== 'x' }))).toEqual(['Login  2 ex', ' 1    gist a', ' 2    gist b'])
  })

  test('a pending exchange shows in the current thread with a dim … in the glyph slot and its excerpt', () => {
    const f = file([th('t1', 'Login'), th('t2', 'Sub', 't1')], [ex('a', 't1'), ex('b', 't2'), ex('c', null)])
    const rows = layoutTree(f, WIDE)
    expect(lines(rows)).toEqual(['Login  3 ex', ' 1    gist a', ' └ Sub  2 ex', '    2    gist b', '    3 …  excerpt c'])
    expect(rows.at(-1)?.segments.find(s => s.text === '…')?.dim).toBe(true)
  })

  test('with no labelled exchange yet, pending exchanges form the Unlabelled group, still with …', () => {
    const f = file([], [ex('a', null), ex('b', null)])
    expect(lines(layoutTree(f, WIDE))).toEqual(['Unlabelled  2', ' 1 …  excerpt a', ' 2 …  excerpt b'])
  })

  test('a run of more than 10 unlabelled exchanges is a dim Unlabelled group, placed by its first exchange', () => {
    const f = file([th('t1', 'Login'), th('t2', 'Docs')], [ex('a', 't1'), ...nulls('n', 11), ex('z', 't2')])
    const rows = layoutTree(f, WIDE)
    expect(lines(rows).filter(l => !l.startsWith(' '))).toEqual(['Login  1 ex', 'Unlabelled  11', 'Docs  1 ex'])
    const head = rows.find(r => r.key === 'th:unlabelled') as TreeRow
    expect(head.kind).toBe('unlabelled')
    expect(head.target).toBe('n1')
    expect(head.segments.every(s => s.dim)).toBe(true)
    expect(line(rows.find(r => r.key === 'ex:n1') as TreeRow)).toBe('  2    excerpt n1')
  })

  test('a trailing run of more than 10 is unlabelled too, not pending', () => {
    const f = file([th('t1', 'Login')], [ex('a', 't1'), ...nulls('n', 11)])
    const rows = layoutTree(f, WIDE)
    expect(lines(rows).slice(0, 3)).toEqual(['Login  1 ex', '  1    gist a', 'Unlabelled  11'])
    expect(rows.some(r => line(r).includes('…'))).toBe(false)
  })
})

describe('tree build cost', () => {
  test('600 exchanges over 40 threads lay out in well under a frame', () => {
    const threads = Array.from({ length: 40 }, (_, i) => th(`t${i + 1}`, `Thread ${i + 1}`, i % 4 ? `t${i - (i % 4) + 1}` : null))
    const exchanges = Array.from({ length: 600 }, (_, i) =>
      ex(`u${i}`, `t${(i % 40) + 1}`, `gist number ${i} with some words`, i % 7 ? [] : [{ kind: 'landmark', text: '' }]),
    )
    const f = file(threads, exchanges)
    const opts: TreeOptions = { ...WIDE, lastJump: 'u300', bandId: 'u599', isLive: () => true, isReachable: x => x.id !== 'u1' }
    layoutTree(f, opts)
    const runs = 20
    const t0 = Date.now()
    for (let i = 0; i < runs; i++) layoutTree(f, opts)
    const ms = (Date.now() - t0) / runs
    expect(layoutTree(f, opts)).toHaveLength(640)
    expect(ms).toBeLessThan(10)
  })
})
