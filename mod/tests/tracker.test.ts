import { expect, test, describe } from 'claude-code/testing'
import { start, onPrompt, onTurnStart, onTurnComplete, onResponse, onSubmit, onQueued, type Tracked } from '../hooks/lib/tracker'

const ids = (t: Tracked) => t.file.exchanges.map(x => x.id)

describe('tracker: composer prompts', () => {
  test('each prompt between turns is its own exchange', () => {
    let t = start('s1')
    t = onPrompt(t, 'u1', 'first')
    t = onTurnStart(t)
    t = onTurnComplete(t)
    t = onPrompt(t, 'u2', 'second')
    expect(ids(t)).toEqual(['u1', 'u2'])
    expect(t.file.exchanges[1]?.excerpt).toBe('second')
  })

  test('the turn may start before the prompt row is appended', () => {
    let t = start('s1')
    t = onTurnStart(t)
    t = onPrompt(t, 'u1', 'first')
    t = onTurnComplete(t)
    expect(ids(t)).toEqual(['u1'])
  })

  test('a prompt appended while the turn runs folds into its exchange', () => {
    let t = start('s1')
    t = onPrompt(t, 'u1', 'first')
    t = onTurnStart(t)
    t = onPrompt(t, 'u2', 'also this')
    t = onTurnComplete(t)
    expect(ids(t)).toEqual(['u1'])
    expect(t.file.exchanges[0]?.prompts).toEqual(['u1', 'u2'])
    expect(t.index['u1']?.prompts).toEqual(['first', 'also this'])
  })

  test('slash-command wrapper rows are not prompts', () => {
    let t = start('s1')
    t = onPrompt(t, 'c1', '<command-name>/model</command-name>')
    t = onPrompt(t, 'c2', '<local-command-stdout>ok</local-command-stdout>')
    expect(ids(t)).toEqual([])
  })
})

describe('tracker: prompts typed mid-turn and delivered as queued_command', () => {
  test('folds a delivered prompt the person typed during the turn, with its typed text', () => {
    let t = start('s1')
    t = onPrompt(t, 'u1', 'first')
    t = onTurnStart(t)
    t = onSubmit(t, { text: 'and the tests', isComposer: true, duringTurn: true })
    t = onQueued(t, 'q1')
    t = onTurnComplete(t)
    expect(t.file.exchanges[0]?.prompts).toEqual(['u1', 'q1'])
    expect(t.index['u1']?.prompts).toEqual(['first', 'and the tests'])
  })

  test('ignores a queued_command nobody typed (a notification)', () => {
    let t = start('s1')
    t = onPrompt(t, 'u1', 'first')
    t = onTurnStart(t)
    t = onQueued(t, 'q1')
    expect(t.file.exchanges[0]?.prompts).toEqual(['u1'])
  })
})

describe('tracker: reply rows', () => {
  test('reply text rows and tool lines go to the running exchange', () => {
    let t = start('s1')
    t = onPrompt(t, 'u1', 'first')
    t = onTurnStart(t)
    t = onResponse(t, 'r1', [{ type: 'text', text: 'Looking.' }])
    t = onResponse(t, 'r2', [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:/a/b.ts' } }])
    t = onResponse(t, 'r3', [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test\nmore', description: 'run' } }])
    t = onResponse(t, 'r4', [{ type: 'text', text: 'Done.' }])
    expect(t.index['u1']).toEqual({
      prompts: ['first'],
      replies: [{ uuid: 'r1', text: 'Looking.' }, { uuid: 'r4', text: 'Done.' }],
      tools: ['Read C:/a/b.ts', 'Bash npm test'],
    })
  })

  test('reply rows with no turn exchange are dropped', () => {
    let t = start('s1')
    t = onResponse(t, 'r1', [{ type: 'text', text: 'stray' }])
    expect(t.index).toEqual({})
  })
})

describe('tracker: turns with no composer prompt', () => {
  test('a slash or skill turn anchors on its first reply text row with the command line', () => {
    let t = start('s1')
    t = onSubmit(t, { text: '/review the diff', command: { name: 'review', args: 'the diff' }, isComposer: true, duringTurn: false })
    t = onTurnStart(t)
    t = onResponse(t, 'r1', [{ type: 'tool_use', name: 'Bash', input: { command: 'git diff' } }])
    t = onResponse(t, 'r2', [{ type: 'text', text: 'The diff adds...' }])
    t = onTurnComplete(t)
    expect(ids(t)).toEqual(['r2'])
    expect(t.file.exchanges[0]?.excerpt).toBe('/review the diff')
    expect(t.index['r2']).toEqual({ prompts: ['/review the diff'], replies: [{ uuid: 'r2', text: 'The diff adds...' }], tools: ['Bash git diff'] })
  })

  test('a slash turn with no reply text is skipped', () => {
    let t = start('s1')
    t = onSubmit(t, { text: '/x', command: { name: 'x', args: '' }, isComposer: true, duringTurn: false })
    t = onTurnStart(t)
    t = onResponse(t, 'r1', [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }])
    t = onTurnComplete(t)
    expect(ids(t)).toEqual([])
  })

  test('a turn with neither a prompt nor a command makes no exchange', () => {
    let t = start('s1')
    t = onTurnStart(t)
    t = onResponse(t, 'r1', [{ type: 'text', text: 'continuing' }])
    expect(ids(t)).toEqual([])
  })

  test('a command whose turn never starts does not anchor a later turn', () => {
    let t = start('s1')
    t = onSubmit(t, { text: '/marks', command: { name: 'marks', args: '' }, isComposer: true, duringTurn: false })
    t = onPrompt(t, 'u1', 'real prompt')
    t = onTurnStart(t)
    t = onResponse(t, 'r1', [{ type: 'text', text: 'ok' }])
    t = onTurnComplete(t)
    expect(ids(t)).toEqual(['u1'])
    expect(t.file.exchanges[0]?.excerpt).toBe('real prompt')
  })
})
