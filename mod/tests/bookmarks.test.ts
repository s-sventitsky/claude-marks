// Manual bookmarks (ticket 06): `/mark` arguments, add/move/remove, the text fallback,
// the corrections list and the reader's menu. Pure.
import { describe, expect, test } from 'claude-code/testing'
import {
  MARK_USAGE,
  NO_EXCHANGE,
  WHOLE,
  menuValue,
  rowOfMenuValue,
  anchorOf,
  heldValue,
  markLine,
  markMenu,
  menuKey,
  menuTarget,
  noteKey,
  noteManual,
  parseMark,
  pickMark,
  planMark,
  removeManual,
  runMark,
  setManual,
} from '../hooks/lib/bookmarks'
import { emptyFile } from '../hooks/lib/model'
import type { ExchangeRows } from '../hooks/lib/rows'
import type { Bookmark, ConversationFile, Exchange } from '../types/index'

const ex = (id: string, o: Partial<Exchange> = {}): Exchange => ({
  id,
  prompts: [id],
  excerpt: `excerpt ${id}`,
  thread: { id: 't1', by: 'labeller' },
  gist: `gist ${id}`,
  bookmarks: [],
  label: { status: 'done' },
  ...o,
})
const file = (exchanges: Exchange[]): ConversationFile => ({ ...emptyFile('s1'), threads: [{ id: 't1', label: { text: 'Main', by: 'labeller' }, parent: null, mergedFrom: [] }], exchanges })
const rows = (prompt: string, ...replies: [string, string][]): ExchangeRows => ({ prompts: [prompt], replies: replies.map(([uuid, text]) => ({ uuid, text })), tools: [] })
const LONG = 'word '.repeat(40)

describe('/mark arguments', () => {
  test('nothing: the latest exchange, no note', () => {
    expect(parseMark('')).toEqual({ target: 'latest' })
    expect(parseMark('   ')).toEqual({ target: 'latest' })
  })

  test('a note alone: the latest exchange, the whole line trimmed as the note', () => {
    expect(parseMark('  chose JSON  schema ')).toEqual({ target: 'latest', note: 'chose JSON  schema' })
  })

  test('#n: that exchange, the rest of the line the note', () => {
    expect(parseMark('#14')).toEqual({ target: 14 })
    expect(parseMark('#14 chose JSON schema')).toEqual({ target: 14, note: 'chose JSON schema' })
    expect(parseMark(' #3   ')).toEqual({ target: 3 })
  })

  test('a bad #n is usage', () => {
    for (const bad of ['#', '#0', '#x', '#3x note', '#-2', '#1.5'])
      expect(parseMark(bad)).toBeUndefined()
    expect(MARK_USAGE).toBe('usage: /mark [#n] [note]')
  })

  test('a # later in the note is just text', () => {
    expect(parseMark('see #12 too')).toEqual({ target: 'latest', note: 'see #12 too' })
  })
})

describe('/mark target and text', () => {
  const F = file([ex('a'), ex('b'), ex('c')])
  const R: Record<string, ExchangeRows> = {
    a: rows('first prompt', ['ra1', 'first reply']),
    b: rows('second   prompt', ['rb1', 'looking'], ['rb2', 'chose  JSON\nschema']),
    c: rows('third prompt'),
  }
  const rowsOf = (id: string) => R[id]
  const hideB = (x: Exchange) => x.id !== 'b'

  test("no target: the latest live exchange, on Claude's latest reply text block; text is ~80 chars of it", () => {
    const G = file([ex('a'), ex('b')])
    expect(planMark(G, { target: 'latest' }, { rowsOf })).toEqual({ exchange: 'b', n: 2, row: 'rb2', text: 'chose JSON schema' })
  })

  test('no target, no reply text yet: the prompt row, text from the prompt', () => {
    expect(planMark(F, { target: 'latest' }, { rowsOf })).toEqual({ exchange: 'c', n: 3, text: 'third prompt' })
  })

  test('#n counts live exchanges as the tree does, anchored on the prompt row', () => {
    expect(planMark(F, { target: 2 }, { rowsOf })).toEqual({ exchange: 'b', n: 2, text: 'second prompt' })
    expect(planMark(F, { target: 2 }, { rowsOf, isLive: hideB })).toEqual({ exchange: 'c', n: 2, text: 'third prompt' })
  })

  test('a note is the text', () => {
    expect(planMark(F, { target: 1, note: 'the bug' }, { rowsOf })).toMatchObject({ exchange: 'a', text: 'the bug' })
  })

  test('the message is cut to ~80 chars, whitespace collapsed', () => {
    const G = file([ex('a')])
    const p = planMark(G, { target: 1 }, { rowsOf: () => rows(LONG) })
    expect('text' in p && p.text.length).toBe(80)
    expect('text' in p && p.text.endsWith('…')).toBe(true)
  })

  test('no message text: the excerpt for a prompt row, else the gist', () => {
    expect(planMark(F, { target: 1 }, { rowsOf: () => undefined })).toMatchObject({ text: 'excerpt a' })
    const G = file([ex('a', { excerpt: '' })])
    expect(planMark(G, { target: 1 }, { rowsOf: () => rows('  ') })).toMatchObject({ text: 'gist a' })
  })

  test('#n past the live count is usage; no exchange at all says so', () => {
    expect(planMark(F, { target: 4 }, { rowsOf })).toEqual({ error: MARK_USAGE })
    expect(planMark(F, { target: 3 }, { rowsOf, isLive: hideB })).toEqual({ error: MARK_USAGE })
    expect(planMark(file([]), { target: 'latest' }, { rowsOf })).toEqual({ error: NO_EXCHANGE })
  })

  test('the reply line', () => {
    expect(markLine(14, 'chose JSON schema')).toBe('◆ #14 "chose JSON schema"')
  })
})

describe('/mark end to end', () => {
  const AT = '2026-11-05T10:00:00.000Z'
  const F = file([ex('a'), ex('b')])
  const rowsOf = (id: string) => (id === 'b' ? rows('p', ['rb', 'the answer']) : undefined)

  test('bookmarks, logs the add, and confirms', () => {
    const r = runMark(F, '', { rowsOf }, AT)
    expect(r.say).toBe('◆ #2 "the answer"')
    expect(r.file.exchanges[1]?.bookmarks).toEqual([{ kind: 'manual', row: 'rb', text: 'the answer' }])
    expect(r.file.corrections).toEqual([{ kind: 'bookmark_add', exchange: 'b', row: 'rb', at: AT }])
  })

  test('#n with a note', () => {
    const r = runMark(F, '#1 start here', { rowsOf }, AT)
    expect(r.say).toBe('◆ #1 "start here"')
    expect(r.file.exchanges[0]?.bookmarks).toEqual([{ kind: 'manual', text: 'start here' }])
  })

  test('bad input changes nothing and says why', () => {
    expect(runMark(F, '#7', { rowsOf }, AT)).toEqual({ file: F, say: MARK_USAGE })
    expect(runMark(F, '#x', { rowsOf }, AT)).toEqual({ file: F, say: MARK_USAGE })
    expect(runMark(file([]), '', { rowsOf }, AT)).toEqual({ file: file([]), say: NO_EXCHANGE })
  })
})

describe('add, replace, remove', () => {
  const AT = '2026-11-05T10:00:00.000Z'
  const landmark: Bookmark = { kind: 'landmark', text: 'why' }
  const F = file([ex('a', { bookmarks: [landmark] }), ex('b')])
  const bm = (f: ConversationFile, id: string) => f.exchanges.find(x => x.id === id)?.bookmarks

  test('adds a manual bookmark first (its glyph leads), auto ones kept; logs a bookmark_add', () => {
    const f = setManual(F, 'a', { row: 'r1', text: 'note' }, AT)
    expect(bm(f, 'a')).toEqual([{ kind: 'manual', row: 'r1', text: 'note' }, landmark])
    expect(f.corrections).toEqual([{ kind: 'bookmark_add', exchange: 'a', row: 'r1', at: AT }])
    expect(F.exchanges[0]?.bookmarks).toEqual([landmark])
  })

  test('on the prompt row: no row field, in the bookmark or the correction', () => {
    const f = setManual(F, 'b', { text: 't' }, AT)
    expect(bm(f, 'b')).toEqual([{ kind: 'manual', text: 't' }])
    expect(f.corrections).toEqual([{ kind: 'bookmark_add', exchange: 'b', at: AT }])
  })

  test('one manual bookmark per exchange: a second one replaces it, and logs again', () => {
    const f = setManual(setManual(F, 'a', { row: 'r1', text: 'one' }, AT), 'a', { text: 'two' }, AT)
    expect(bm(f, 'a')).toEqual([{ kind: 'manual', text: 'two' }, landmark])
    expect(f.corrections).toHaveLength(2)
  })

  test('the corrections list keeps the newest 10', () => {
    let f: ConversationFile = { ...F, corrections: [{ kind: 'rename', at: 'old' }] }
    for (let i = 0; i < 12; i++) f = setManual(f, 'b', { text: String(i) }, `t${i}`)
    expect(f.corrections).toHaveLength(10)
    expect(f.corrections[0]?.at).toBe('t2')
    expect(f.corrections[9]?.at).toBe('t11')
  })

  test('an unknown exchange leaves the file as it is', () => {
    expect(setManual(F, 'zz', { text: 't' }, AT)).toBe(F)
    expect(removeManual(F, 'zz')).toBe(F)
  })

  test('remove drops only the manual bookmark and logs nothing', () => {
    const f = removeManual(setManual(F, 'a', { text: 't' }, AT), 'a')
    expect(bm(f, 'a')).toEqual([landmark])
    expect(f.corrections).toHaveLength(1)
    expect(removeManual(F, 'a')).toBe(F)
  })

  test('a note replaces the text; an empty one keeps it (no note)', () => {
    const f = setManual(F, 'b', { row: 'r', text: 'fallback' }, AT)
    expect(bm(noteManual(f, 'b', '  chose JSON  '), 'b')).toEqual([{ kind: 'manual', row: 'r', text: 'chose JSON' }])
    expect(noteManual(f, 'b', '   ')).toBe(f)
    expect(noteManual(F, 'b', 'x')).toBe(F)
  })
})

describe("the reader's m menu", () => {
  const AT = '2026-11-05T10:00:00.000Z'
  const R = rows('the prompt', ['r1', 'Looking at the login flow first, then the cookie handling and the session store.'], ['r2', 'Fixed.'])
  const marked = (row?: string) => ex('a', { bookmarks: [row ? { kind: 'manual', row, text: 'n' } : { kind: 'manual', text: 'n' }] })

  test('the reply text blocks (first ~60 chars) and the whole exchange', () => {
    expect(markMenu(ex('a'), R)).toEqual([
      { value: 'row:r1', label: '  Looking at the login flow first, then the cookie handling a…' },
      { value: 'row:r2', label: '  Fixed.' },
      { value: WHOLE, label: '  the whole exchange' },
    ])
  })

  test('the entry holding the manual bookmark shows ◆', () => {
    expect(markMenu(marked('r2'), R).map(o => o.label.slice(0, 2))).toEqual(['  ', '◆ ', '  '])
    expect(markMenu(marked(), R).at(-1)?.label).toBe('◆ the whole exchange')
  })

  test("a bookmark whose row can't be found sits on the whole exchange (the prompt row)", () => {
    expect(markMenu(marked('gone'), R).at(-1)?.label).toBe('◆ the whole exchange')
    expect(markMenu(marked('r1'), undefined)).toEqual([{ value: WHOLE, label: '◆ the whole exchange' }])
  })

  test('picking the holder removes the bookmark; no note asked', () => {
    const p = pickMark(file([marked('r2')]), 'a', 'row:r2', R, AT)
    expect(p.askNote).toBe(false)
    expect(p.file.exchanges[0]?.bookmarks).toEqual([])
    expect(p.file.corrections).toEqual([])
  })

  test('picking another entry moves the bookmark there with the fallback text, logs it, and asks for a note', () => {
    const p = pickMark(file([marked('r2')]), 'a', 'row:r1', R, AT)
    expect(p.askNote).toBe(true)
    expect(p.file.exchanges[0]?.bookmarks).toEqual([{ kind: 'manual', row: 'r1', text: 'Looking at the login flow first, then the cookie handling and the session store.' }])
    expect(p.file.corrections).toEqual([{ kind: 'bookmark_add', exchange: 'a', row: 'r1', at: AT }])
    const w = pickMark(file([ex('a')]), 'a', WHOLE, R, AT)
    expect(w.file.exchanges[0]?.bookmarks).toEqual([{ kind: 'manual', text: 'the prompt' }])
  })

  test("the menu's and the note field's keys carry the exchange; anything else is not theirs", () => {
    expect(menuKey('u1')).toBe('mark:menu:u1')
    expect(noteKey('u1')).toBe('mark:note:u1')
    expect(menuTarget(menuKey('a:b'))).toEqual({ kind: 'pick', id: 'a:b' })
    expect(menuTarget(noteKey('u1'))).toEqual({ kind: 'note', id: 'u1' })
    expect(menuTarget('mark:menu:')).toBeUndefined()
    expect(menuTarget('ex:u1')).toBeUndefined()
  })

  test('heldValue: the menu value holding the bookmark, as a pick compares it', () => {
    expect(heldValue(marked('r2'), R)).toBe('row:r2')
    expect(heldValue(marked('gone'), R)).toBe(WHOLE)
    expect(heldValue(ex('a'), R)).toBeUndefined()
  })

  test('the jump anchor: the bookmark row while the index knows it, else the prompt row', () => {
    expect(anchorOf(marked('r2'), R)).toBe('r2')
    expect(anchorOf(marked('gone'), R)).toBe('a')
    expect(anchorOf(marked('r2'), undefined)).toBe('a')
    expect(anchorOf(marked(), R)).toBe('a')
    expect(anchorOf(ex('a'), R)).toBe('a')
  })
})

describe('menu values', () => {
  test('a reply row and the whole exchange round-trip', () => {
    expect(menuValue('r1')).toBe('row:r1')
    expect(rowOfMenuValue(menuValue('r1'))).toBe('r1')
    expect(menuValue(undefined)).toBe(WHOLE)
    expect(rowOfMenuValue(WHOLE)).toBeUndefined()
  })
})
