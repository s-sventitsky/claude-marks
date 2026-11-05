import { describe, expect, test } from 'claude-code/testing'
import { markerWrites } from '../hooks/lib/marker-diff'

const a = { color: 'suggestion', divider: 'Login fix' }
const b = { color: 'warning', glyph: '◆' }

describe('marker writes: only the prompt rows whose marker changed', () => {
  test('nothing sent yet: every marker is written', () => {
    const r = markerWrites(new Map(), { u1: a, u2: b })
    expect(r.writes).toEqual([
      { id: 'u1', marker: a },
      { id: 'u2', marker: b },
    ])
    expect([...r.sent.keys()]).toEqual(['u1', 'u2'])
  })

  test('an unchanged marker is not written again', () => {
    const { sent } = markerWrites(new Map(), { u1: a, u2: b })
    const r = markerWrites(sent, { u1: { ...a }, u2: b })
    expect(r.writes).toEqual([])
  })

  test('a changed marker is written with its new value', () => {
    const { sent } = markerWrites(new Map(), { u1: a })
    const r = markerWrites(sent, { u1: b })
    expect(r.writes).toEqual([{ id: 'u1', marker: b }])
  })

  test('a marker gone from the file is cleared with null and forgotten', () => {
    const { sent } = markerWrites(new Map(), { u1: a, u2: b })
    const r = markerWrites(sent, { u2: b })
    expect(r.writes).toEqual([{ id: 'u1', marker: null }])
    expect([...r.sent.keys()]).toEqual(['u2'])
    expect(markerWrites(r.sent, { u2: b }).writes).toEqual([])
  })

  test('the sent record passed in is left as it was', () => {
    const first = markerWrites(new Map(), { u1: a })
    markerWrites(first.sent, { u2: b })
    expect([...first.sent.keys()]).toEqual(['u1'])
  })
})
