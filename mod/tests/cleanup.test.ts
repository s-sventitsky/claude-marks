import { describe, expect, mock, test } from 'claude-code/testing'
import { DELETE_BATCH, deleteCommands, staleIndex, staleSessions } from '../hooks/lib/cleanup'
import { CONFIG, SESSION_START, world } from './harness'

const DAY = 86_400_000
const NOW = 100 * DAY
const ID = (n: number) => `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`
const entry = (name: string, ageDays: number, kind: 'file' | 'dir' | 'other' = 'file') => ({ name, kind, size: 1, mtimeMs: kind === 'file' ? NOW - ageDays * DAY : 0, isLink: false })

describe('which data files go', () => {
  test('a data file last written more than 14 days ago goes; 14 days or less stays', () => {
    const list = [entry(`${ID(1)}.json`, 15), entry(`${ID(2)}.json`, 14), entry(`${ID(3)}.json`, 1)]
    expect(staleSessions(list, NOW, 'other')).toEqual([ID(1)])
  })

  test('the current conversation stays, however old its file', () => {
    expect(staleSessions([entry(`${ID(1)}.json`, 30)], NOW, ID(1))).toEqual([])
  })

  test('only files named <session id>.json go: not folders, links or other names', () => {
    const list = [entry('notes.json', 30), entry(`${ID(1)}.json.tmp`, 30), entry(ID(2), 30, 'dir'), entry(`${ID(3)}.json`, 30, 'other')]
    expect(staleSessions(list, NOW, 'other')).toEqual([])
  })

  test('index entries older than 14 days go, the current one and unreadable ones stay', () => {
    const at = (ageDays: number) => ({ file: 'x', updatedAt: new Date(NOW - ageDays * DAY).toISOString() })
    const index: [string, unknown][] = [
      [ID(1), at(20)],
      [ID(2), at(2)],
      [ID(3), at(40)],
      ['junk', 'not an entry'],
    ]
    expect(staleIndex(index, NOW, ID(3))).toEqual([ID(1)])
  })
})

describe('the delete command', () => {
  test('Windows: cmd del with backslash paths; elsewhere rm -f', () => {
    expect(deleteCommands(['C:/cfg/claude-marks/a.json'], true)).toEqual([['cmd', '/d', '/c', 'del', '/f', '/q', 'C:\\cfg\\claude-marks\\a.json']])
    expect(deleteCommands(['/home/u/.claude/claude-marks/a.json'], false)).toEqual([['rm', '-f', '--', '/home/u/.claude/claude-marks/a.json']])
  })

  test(`paths go in batches of ${DELETE_BATCH}, so a command line stays short`, () => {
    const paths = Array.from({ length: DELETE_BATCH + 1 }, (_, i) => `/d/${i}.json`)
    expect(deleteCommands(paths, false).map(c => c.length - 3)).toEqual([DELETE_BATCH, 1])
    expect(deleteCommands([], false)).toEqual([])
  })
})

describe('cleanup at session start', () => {
  test('deletes data files and index entries older than 14 days, keeps the rest and the current one', async ($, on) => {
    mock.clock(on, { now: NOW })
    const w = world(on, mock, { sessionId: ID(9), env: { OS: 'Windows_NT' } })
    const dir = `${CONFIG}/claude-marks`
    const listing = [entry(`${ID(1)}.json`, 20), entry(`${ID(2)}.json`, 3), entry(`${ID(9)}.json`, 50)]
    on('fs.list', (_: unknown, e: any) => ({ value: e.path.replace(/\\/g, '/') === dir ? listing : [] }))
    const runs: string[][] = []
    on('process.run', (_: unknown, e: any) => {
      runs.push([...e.argv])
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    w.store.set(ID(1), { file: `${dir}/${ID(1)}.json`, updatedAt: new Date(NOW - 20 * DAY).toISOString() })
    w.store.set(ID(4), { file: `${dir}/${ID(4)}.json`, updatedAt: new Date(NOW - 30 * DAY).toISOString() })
    w.store.set(ID(2), { file: `${dir}/${ID(2)}.json`, updatedAt: new Date(NOW - 3 * DAY).toISOString() })
    await $.session.start(SESSION_START)
    const dels = runs.filter(a => a.includes('del'))
    expect(dels).toEqual([['cmd', '/d', '/c', 'del', '/f', '/q', `C:\\cfg\\claude-marks\\${ID(1)}.json`]])
    expect([...w.store.keys()].sort()).toEqual([ID(2)])
  })
})
