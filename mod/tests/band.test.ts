import { expect, test } from 'claude-code/testing'
import { bandLine, statusLine } from '../hooks/lib/band'
import { addExchange, emptyFile } from '../hooks/lib/model'

test('band draws nothing with no exchanges', () => {
  expect(bandLine(emptyFile('s1'))).toBeUndefined()
  expect(bandLine(null)).toBeUndefined()
})

test('band shows the latest exchange as #n/N', () => {
  let f = addExchange(emptyFile('s1'), 'u1', 'a')
  f = addExchange(f, 'u2', 'b')
  f = addExchange(f, 'u3', 'c')
  expect(bandLine(f)).toBe('#3/3')
})

test('status line counts threads', () => {
  expect(statusLine(emptyFile('s1'))).toBe('/marks · 0 threads')
  expect(statusLine(null)).toBe('/marks · 0 threads')
  const one = { ...emptyFile('s1'), threads: [{ id: 't1', label: { text: 'x', by: 'labeller' as const }, parent: null, mergedFrom: [] }] }
  expect(statusLine(one)).toBe('/marks · 1 thread')
})
