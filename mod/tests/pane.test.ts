import { describe, expect, test } from 'claude-code/testing'
import { emptyFile } from '../hooks/lib/model'
import { REASON, afterJump, bandTarget, enterAction, isNarrow, marksUsage, openTarget, treeKeys } from '../hooks/lib/pane'
import type { ConversationFile, Exchange } from '../types/index'

const ex = (id: string): Exchange => ({
  id,
  prompts: [id],
  excerpt: id,
  thread: { id: 't1', by: 'labeller' },
  gist: '',
  bookmarks: [],
  label: { status: 'done' },
})
const file = (...ids: string[]): ConversationFile => ({
  ...emptyFile('s1'),
  threads: [{ id: 't1', label: { text: 'A', by: 'labeller' }, parent: null, mergedFrom: [] }],
  exchanges: ids.map(ex),
})

describe('Enter on a row', () => {
  test('reachable in fullscreen: jump to the exchange anchor', () => {
    expect(enterAction(file('a', 'b'), 'b', { fullscreen: true })).toEqual({ kind: 'jump', to: 'b' })
  })

  test('fullscreen unknown (no viewport yet): still try the jump; the engine has the last word', () => {
    expect(enterAction(file('a'), 'a', { fullscreen: undefined })).toEqual({ kind: 'jump', to: 'a' })
  })

  test('unreachable: the reader with the compaction reason', () => {
    expect(enterAction(file('a'), 'a', { fullscreen: true, isReachable: () => false })).toEqual({ kind: 'reader', id: 'a', reason: REASON.compacted })
  })

  test('main screen: the reader with the main-screen line', () => {
    expect(enterAction(file('a'), 'a', { fullscreen: false })).toEqual({ kind: 'reader', id: 'a', reason: REASON.mainScreen })
    expect(REASON.mainScreen).toBe('Enter opens the reader. Jumping works in fullscreen.')
    expect(REASON.compacted).toBe('Before the last compaction: not on screen, so the reader shows it.')
  })

  test('an exchange no longer in the file does nothing', () => {
    expect(enterAction(file('a'), 'gone', { fullscreen: true })).toBeUndefined()
  })
})

describe('after the scroll', () => {
  test('moved: close the pane and remember the jump', () => {
    expect(afterJump({})).toEqual({ close: true })
  })

  test('denied: keep the pane open and say why', () => {
    expect(afterJump({ deny: 'not person-initiated' })).toEqual({ close: false, note: 'Jump denied: not person-initiated' })
  })
})

describe('where the pane opens', () => {
  test('/marks: the exchange last jumped to', () => {
    expect(openTarget(file('a', 'b', 'c'), 'b')).toBe('b')
  })

  test('/marks with no jump this session, or one gone from the file: the latest', () => {
    expect(openTarget(file('a', 'b', 'c'), null)).toBe('c')
    expect(openTarget(file('a', 'b'), 'gone')).toBe('b')
  })

  test('only live exchanges count', () => {
    const live = (x: Exchange) => x.id !== 'c'
    expect(openTarget(file('a', 'b', 'c'), 'c', live)).toBe('b')
    expect(openTarget(file('a', 'b', 'c'), null, live)).toBe('b')
  })

  test('nothing to open on in an empty conversation', () => {
    expect(openTarget(emptyFile('s1'), null)).toBeUndefined()
    expect(openTarget(null, null)).toBeUndefined()
  })

  test("a band click: the band's exchange, here in fullscreen, else the latest", () => {
    const f = file('a', 'b', 'c')
    expect(bandTarget(f, { fullscreen: true, hereId: 'a' })).toBe('a')
    expect(bandTarget(f, { fullscreen: false, hereId: 'a' })).toBe('c')
    expect(bandTarget(f, { fullscreen: true, hereId: 'gone' })).toBe('c')
    expect(bandTarget(f, { fullscreen: true, hereId: null })).toBe('c')
  })
})

describe('/marks arguments and layout', () => {
  test('any argument prints usage; none opens', () => {
    expect(marksUsage('')).toBeUndefined()
    expect(marksUsage('   ')).toBeUndefined()
    expect(marksUsage('relabel')).toBe('usage: /marks')
  })

  test('narrow: inline, or under 60 body columns', () => {
    expect(isNarrow('inline', 100)).toBe(true)
    expect(isNarrow('dock', 59)).toBe(true)
    expect(isNarrow('dock', 60)).toBe(false)
  })

  test('the tree draws every key it uses; a, v, / and left stay unbound', () => {
    const keys = treeKeys({ fullscreen: true })
    expect(keys.map(k => k.label)).toEqual(['↑↓ move', 'Enter jump', 'Esc close'])
    expect(keys.map(k => k.hotkey).filter(Boolean)).toEqual([])
  })

  test('on the main screen Enter reads instead of jumping', () => {
    expect(treeKeys({ fullscreen: false }).map(k => k.label)).toContain('Enter read')
  })
})
