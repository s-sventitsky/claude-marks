import { describe, expect, test } from 'claude-code/testing'
import { catCommands, emptyTranscript, gitRootOf, ingest, keep, lineSplitter, slug, transcriptPath } from '../hooks/lib/jsonl'
import * as J from './fixtures/jsonl'

const read = (...lines: string[]) => {
  const t = emptyTranscript()
  for (const l of lines) ingest(t, l)
  return t
}

describe('transcript path', () => {
  test('the slug replaces every non-alphanumeric character of the root with -', () => {
    expect(slug('C:\\Projs\\claude-marks')).toBe('C--Projs-claude-marks')
    expect(slug('/home/me/my.app')).toBe('-home-me-my-app')
  })

  test('the path is <config>/projects/<slug>/<sessionId>.jsonl', () => {
    expect(transcriptPath('C:/cfg', 'C:\\Projs\\demo', 's1')).toBe('C:/cfg/projects/C--Projs-demo/s1.jsonl')
  })
})

describe('readers', () => {
  test("Git for Windows' root is three levels above git --exec-path", () => {
    expect(gitRootOf('C:/Program Files/Git/mingw64/libexec/git-core\n')).toBe('C:/Program Files/Git')
    expect(gitRootOf('C:\\Git\\mingw64\\libexec\\git-core')).toBe('C:/Git')
    expect(gitRootOf('')).toBeUndefined()
  })

  test('streaming: cat elsewhere; on Windows each Git cat.exe found, then cmd /c type with a backslash path', () => {
    expect(catCommands('/home/me/s.jsonl', { windows: false, gitCats: [] })).toEqual([['cat', '/home/me/s.jsonl']])
    expect(catCommands('C:/cfg/s.jsonl', { windows: true, gitCats: ['C:/Git/usr/bin/cat.exe'] })).toEqual([
      ['C:/Git/usr/bin/cat.exe', 'C:/cfg/s.jsonl'],
      ['cmd', '/c', 'type', 'C:\\cfg\\s.jsonl'],
    ])
  })
})

describe('line splitter', () => {
  test('joins lines cut across pieces and holds the unfinished tail', () => {
    const s = lineSplitter()
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(s.push(':2}\n\n{"c":3}')).toEqual(['{"b":2}'])
    expect(s.end()).toEqual(['{"c":3}'])
  })

  test('a line written in many small pieces comes out whole', () => {
    const s = lineSplitter()
    const line = '{"text":"' + 'x'.repeat(5000) + '"}'
    const out: string[] = []
    for (let i = 0; i < line.length; i += 7) out.push(...s.push(line.slice(i, i + 7)))
    out.push(...s.push('\n'), ...s.end())
    expect(out).toEqual([line])
  })

  test('CRLF line ends are trimmed', () => {
    const s = lineSplitter()
    expect(s.push('{"a":1}\r\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}'])
    expect(s.end()).toEqual([])
  })
})

describe('prefilter', () => {
  test('keeps user rows without tool results, assistant rows, boundaries and queued commands', () => {
    expect(keep(J.human('u1', null, 'hi'))).toBe(true)
    expect(keep(J.text('a1', 'u1', 'hello'))).toBe(true)
    expect(keep(J.boundary('b1', 'a1'))).toBe(true)
    expect(keep(J.queued('q1', 'a1', 'more'))).toBe(true)
    expect(keep(J.toolResult('r1', 'a1'))).toBe(false)
    expect(keep(J.attachment('x1', 'a1', { type: 'date' }))).toBe(false)
    expect(keep(J.system('s1', 'a1', 'turn_duration'))).toBe(false)
  })

  test('a prompt that mentions tool_result in its text is still kept', () => {
    expect(keep(J.human('u1', null, 'why is "tool_result" empty?'))).toBe(true)
  })
})

describe('ingest', () => {
  test('every row with a uuid is linked to its parent, in file order; rows without one are skipped', () => {
    const t = read(
      J.human('u1', null, 'hi'),
      J.meta('last-prompt'),
      J.attachment('x1', 'u1', { type: 'date' }),
      J.thinking('a1', 'x1'),
      J.tool('a2', 'a1', 'Read', { file_path: 'a.ts' }),
      J.toolResult('r1', 'a2'),
      J.text('a3', 'r1', 'done'),
    )
    expect(t.order).toEqual(['u1', 'x1', 'a1', 'a2', 'r1', 'a3'])
    expect([...t.parent]).toEqual([
      ['u1', null],
      ['x1', 'u1'],
      ['a1', 'x1'],
      ['a2', 'a1'],
      ['r1', 'a2'],
      ['a3', 'r1'],
    ])
    expect(t.newest).toBe('a3')
  })

  test('the row at the end that is not user or assistant is not the newest', () => {
    const t = read(J.human('u1', null, 'hi'), J.text('a1', 'u1', 'yo'), J.system('s1', 'a1', 'away_summary'))
    expect(t.newest).toBe('a1')
  })

  test('human prompts, typed mid-turn prompts, commands and reply rows are classified', () => {
    const t = read(
      J.human('u1', null, 'fix the bug'),
      J.human('u2', 'u1', [{ type: 'text', text: 'see image' }, { type: 'image', source: {} }]),
      J.queued('q1', 'u2', 'also this'),
      J.command('c1', 'q1', 'review', 'src'),
      J.command('c2', 'c1', 'plain'),
      J.tool('a1', 'c2', 'Bash', { command: 'ls -la\nmore' }),
      J.text('a2', 'a1', 'the answer'),
    )
    expect(t.rows.get('u1')).toEqual({ kind: 'prompt', text: 'fix the bug' })
    expect(t.rows.get('u2')).toEqual({ kind: 'prompt', text: 'see image' })
    expect(t.rows.get('q1')).toEqual({ kind: 'queued', text: 'also this' })
    expect(t.rows.get('c1')).toEqual({ kind: 'command', text: '/review src' })
    expect(t.rows.get('c2')).toEqual({ kind: 'command', text: '/plain' })
    expect(t.rows.get('a1')).toEqual({ kind: 'reply', text: '', tools: ['Bash ls -la'] })
    expect(t.rows.get('a2')).toEqual({ kind: 'reply', text: 'the answer', tools: [] })
  })

  test('a bare /command row from an older build (no origin) is a command, not a prompt', () => {
    const t = read(J.userRow('c1', null, '/compact'), J.userRow('c2', 'c1', '/review src now'), J.human('u1', 'c2', '/not a command but typed'))
    expect(t.rows.get('c1')).toEqual({ kind: 'command', text: '/compact' })
    expect(t.rows.get('c2')).toEqual({ kind: 'command', text: '/review src now' })
    expect(t.rows.get('u1')).toEqual({ kind: 'prompt', text: '/not a command but typed' })
  })

  test('rows nobody typed start a turn of their own; meta rows and summaries are links only', () => {
    const t = read(
      J.human('u1', null, 'hi'),
      J.userRow('m1', 'u1', 'skill body', { isMeta: true }),
      J.userRow('p1', 'm1', 'report', { isMeta: true, origin: { kind: 'peer' } }),
      J.userRow('n1', 'p1', '<task-notification>x</task-notification>', { origin: { kind: 'task-notification' } }),
      J.userRow('b1', 'n1', '<bash-input>ls</bash-input>', { origin: { kind: 'human' } }),
      J.userRow('s1', 'b1', 'summary', { isCompactSummary: true }),
      J.userRow('l1', 's1', '<local-command-stdout>ok</local-command-stdout>'),
      J.notification('q1', 'l1'),
      J.thinking('a1', 'q1'),
    )
    expect(t.rows.get('m1')).toBeUndefined()
    expect(t.rows.get('p1')).toEqual({ kind: 'turn' })
    expect(t.rows.get('n1')).toEqual({ kind: 'turn' })
    expect(t.rows.get('b1')).toEqual({ kind: 'turn' })
    expect(t.rows.get('s1')).toBeUndefined()
    expect(t.rows.get('l1')).toBeUndefined()
    expect(t.rows.get('q1')).toBeUndefined()
    expect(t.rows.get('a1')).toBeUndefined()
    expect(t.order).toHaveLength(9)
  })

  test('a compact boundary links through logicalParentUuid and is remembered', () => {
    const t = read(J.human('u1', null, 'hi'), J.text('a1', 'u1', 'yo'), J.boundary('b1', 'a1'), J.userRow('s1', 'b1', 'sum', { isCompactSummary: true }))
    expect(t.parent.get('b1')).toBe('a1')
    expect(t.rows.get('b1')).toEqual({ kind: 'boundary' })
    expect(t.boundaries).toEqual(['b1'])
  })

  test('sidechain rows, broken lines and rows seen before are skipped', () => {
    const side = JSON.stringify({ parentUuid: 'u1', isSidechain: true, type: 'assistant', message: { content: [] }, uuid: 'sc1' })
    const t = read(J.human('u1', null, 'hi'), side, '{"parentUuid":"u1","trunc', J.human('u1', null, 'again'))
    expect(t.order).toEqual(['u1'])
    expect(t.rows.get('u1')).toEqual({ kind: 'prompt', text: 'hi' })
  })

  test('a tool result row is linked by its own uuid, not one nested in its record', () => {
    const t = read(J.human('u1', null, 'hi'), J.tool('a1', 'u1', 'Read', {}), J.toolResult('r1', 'a1'))
    expect(t.order).toEqual(['u1', 'a1', 'r1'])
    expect(t.parent.get('r1')).toBe('a1')
  })
})
