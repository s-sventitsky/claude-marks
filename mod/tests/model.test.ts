import { expect, test } from 'claude-code/testing'
import { excerptOf, parseFile, emptyFile, addExchange, exchangeById, liveExchanges, withExchange } from '../hooks/lib/model'
import { configDir, dataPath } from '../hooks/lib/paths'
import { toolLine, promptText, replyParts } from '../hooks/lib/rows'

test('excerpt collapses whitespace and cuts at 80 chars with an ellipsis', () => {
  expect(excerptOf('  a \n\t b  ')).toBe('a b')
  const long = 'x'.repeat(100)
  expect(excerptOf(long)).toBe('x'.repeat(79) + '…')
  expect(excerptOf('y'.repeat(80))).toBe('y'.repeat(80))
})

test('parseFile reads back what was written and rejects other shapes', () => {
  const f = addExchange(emptyFile('s1'), 'u1', 'hi')
  expect(parseFile(JSON.stringify(f), 's1')).toEqual(f)
  expect(parseFile('not json', 's1')).toBeUndefined()
  expect(parseFile(JSON.stringify({ ...f, schema: 2 }), 's1')).toBeUndefined()
  expect(parseFile(JSON.stringify(f), 's2')).toBeUndefined()
})

test('config dir: CLAUDE_CONFIG_DIR, else home/.claude, forward slashes', () => {
  expect(configDir({ CLAUDE_CONFIG_DIR: 'D:\\cfg\\', USERPROFILE: 'C:\\Users\\me' })).toBe('D:/cfg')
  expect(configDir({ USERPROFILE: 'C:\\Users\\me' })).toBe('C:/Users/me/.claude')
  expect(configDir({ HOME: '/home/me', USERPROFILE: 'C:\\Users\\me' })).toBe('/home/me/.claude')
  expect(configDir({})).toBeUndefined()
  expect(dataPath('C:/Users/me/.claude', 'abc')).toBe('C:/Users/me/.claude/claude-marks/abc.json')
})

test('tool line: name plus the first line of the main input, cut to 100', () => {
  expect(toolLine('Grep', { pattern: 'foo', path: 'src' })).toBe('Grep foo')
  expect(toolLine('Skill', { skill: 'tdd' })).toBe('Skill tdd')
  expect(toolLine('WebFetch', { url: 'https://x.y', prompt: 'p' })).toBe('WebFetch https://x.y')
  expect(toolLine('Bash', { command: 'a'.repeat(150) })).toBe('Bash ' + 'a'.repeat(100))
  expect(toolLine('TodoWrite', { todos: [] })).toBe('TodoWrite')
})

test('prompt text joins text blocks; a JSONL string passes through', () => {
  expect(promptText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  expect(promptText('plain')).toBe('plain')
})

test('withExchange replaces one exchange; unknown id or no change gives the same file back', () => {
  const f = addExchange(addExchange(emptyFile('s1'), 'u1', 'a'), 'u2', 'b')
  const g = withExchange(f, 'u2', x => ({ ...x, gist: 'g' }))
  expect(exchangeById(g, 'u2')?.gist).toBe('g')
  expect(g.exchanges[0]).toBe(f.exchanges[0])
  expect(withExchange(f, 'nope', x => ({ ...x, gist: 'g' }))).toBe(f)
  expect(withExchange(f, 'u1', x => x)).toBe(f)
})

test('liveExchanges keeps the live ones; no predicate keeps all', () => {
  const f = addExchange(addExchange(emptyFile('s1'), 'u1', 'a'), 'u2', 'b')
  expect(liveExchanges(f).map(x => x.id)).toEqual(['u1', 'u2'])
  expect(liveExchanges(f, x => x.id !== 'u1').map(x => x.id)).toEqual(['u2'])
})

test('reply parts: text blocks joined, one tool line per tool call', () => {
  expect(replyParts([{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'Read', input: { file_path: 'x.ts' } }, { type: 'text', text: 'b' }])).toEqual({
    text: 'a\nb',
    tools: ['Read x.ts'],
  })
  expect(replyParts([])).toEqual({ text: '', tools: [] })
})
