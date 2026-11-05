import { describe, expect, test } from 'claude-code/testing'
import { applyLabel, buildDynamic, parseReply, settle, type Parsed } from '../hooks/lib/labeller'
import { emptyFile } from '../hooks/lib/model'
import type { Bookmark, ConversationFile, Exchange, Thread } from '../types/index'

const FALLBACK = { action: 'continue', bookmarks: [], gist: '' }

describe('parseReply', () => {
  test('reads a plain JSON reply', () => {
    const text = '{"thread":{"action":"new_main","label":"Move tracking to Linear"},"bookmarks":[{"kind":"landmark","why":"project created"}],"gist":"Linear project created"}'
    expect(parseReply(text)).toEqual({
      action: 'new_main',
      label: 'Move tracking to Linear',
      bookmarks: [{ kind: 'landmark', why: 'project created' }],
      gist: 'Linear project created',
    })
  })

  test('strips a code fence and text around the object', () => {
    const text = '```json\nHere you go: {"thread":{"action":"resume","id":"t2"},"bookmarks":[],"gist":"back to docs"} done\n```'
    expect(parseReply(text)).toEqual({ action: 'resume', id: 't2', bookmarks: [], gist: 'back to docs' })
  })

  test('clips label to 40, gist to 80 and why to 60 chars', () => {
    const text = JSON.stringify({
      thread: { action: 'new_sub', label: 'L'.repeat(50) },
      bookmarks: [{ kind: 'branch_point', why: 'W'.repeat(70) }],
      gist: 'G'.repeat(90),
    })
    const p = parseReply(text)
    expect(p.label).toBe('L'.repeat(40))
    expect(p.gist).toBe('G'.repeat(80))
    expect(p.bookmarks[0]?.why).toBe('W'.repeat(60))
  })

  test('drops unknown bookmark kinds and duplicates of a kind', () => {
    const text = JSON.stringify({
      thread: { action: 'continue' },
      bookmarks: [
        { kind: 'manual', why: 'no' },
        { kind: 'landmark', why: 'first' },
        { kind: 'landmark', why: 'second' },
        { kind: 'branch_point', why: 'pick' },
        'junk',
      ],
      gist: 'x',
    })
    expect(parseReply(text).bookmarks).toEqual([
      { kind: 'landmark', why: 'first' },
      { kind: 'branch_point', why: 'pick' },
    ])
  })

  test('anything unusable becomes continue with no bookmarks and no gist', () => {
    expect(parseReply('')).toEqual(FALLBACK)
    expect(parseReply('no json here')).toEqual(FALLBACK)
    expect(parseReply('{"thread": {"action": "contin')).toEqual(FALLBACK)
    expect(parseReply('{"thread":{"action":"jump"},"gist":"x"}')).toEqual(FALLBACK)
    expect(parseReply('{"gist":"no thread"}')).toEqual(FALLBACK)
    expect(parseReply('[1,2]')).toEqual(FALLBACK)
  })
})

// A file and row index for the labeller: t1 main, t2 a sub of t1.
const th = (id: string, text: string, parent: string | null = null) => ({ id, label: { text, by: 'labeller' as const }, parent, mergedFrom: [] as string[] })
const ex = (id: string, thread: string | null, gist = '') => ({
  id,
  prompts: [id],
  excerpt: id,
  thread: thread ? { id: thread, by: 'labeller' as const } : null,
  gist,
  bookmarks: [] as Bookmark[],
  label: { status: thread ? ('done' as const) : ('pending' as const) },
})
const file = (threads: Thread[], exchanges: Exchange[]): ConversationFile => ({ ...emptyFile('s1'), threads, exchanges })

describe('buildDynamic', () => {
  test('first exchange: no threads yet, no previous exchange', () => {
    const f = file([], [ex('u1', null)])
    const index = { u1: { prompts: ['fix the login bug'], replies: [{ uuid: 'r1', text: 'Looking.' }, { uuid: 'r2', text: 'Done.' }], tools: [] } }
    expect(buildDynamic(f, index, 'u1')).toBe(
      [
        '## Threads so far',
        '(none yet: this is the first exchange; use new_main)',
        '',
        '## Exchange to place',
        'User: fix the login bug',
        "Claude's tool calls: none",
        "Claude's final reply: Done.",
      ].join('\n'),
    )
  })

  test('threads with their last 2 gists, the current one marked, and the previous exchange', () => {
    const f = file(
      [th('t1', 'Login fix'), th('t2', 'Token TTL', 't1')],
      [ex('u1', 't1', 'bug found'), ex('u2', 't1', 'fix written'), ex('u3', 't2', 'TTL is 1h'), ex('u4', 't1', 'tests pass'), ex('u5', null)],
    )
    const index = {
      u4: { prompts: ['run the tests'], replies: [{ uuid: 'r4', text: 'All green.' }], tools: [] },
      u5: { prompts: ['commit it', 'and push'], replies: [{ uuid: 'r5', text: 'Pushed.' }], tools: ['Bash git commit -m x', 'Bash git push'] },
    }
    expect(buildDynamic(f, index, 'u5')).toBe(
      [
        '## Threads so far',
        '- t1 [main] "Login fix": fix written; tests pass  <- current',
        '- t2 [sub of t1] "Token TTL": TTL is 1h',
        '',
        '## Previous exchange (context only)',
        'User: run the tests',
        'Claude (end of reply): All green.',
        '',
        '## Exchange to place',
        'User: commit it\nand push',
        "Claude's tool calls: Bash git commit -m x, Bash git push",
        "Claude's final reply: Pushed.",
      ].join('\n'),
    )
  })

  test('clips: prompt 2000, previous prompt 300, previous reply last 1200, reply head 2000 + tail 1000, 15 tools', () => {
    const f = file([th('t1', 'A')], [ex('u1', 't1', 'g'), ex('u2', null)])
    const prevReply = 'p'.repeat(1000) + 'q'.repeat(1200)
    const reply = 'h'.repeat(2000) + 'm'.repeat(500) + 't'.repeat(1000)
    const index = {
      u1: { prompts: ['a'.repeat(400)], replies: [{ uuid: 'r1', text: prevReply }], tools: [] },
      u2: { prompts: ['b'.repeat(2100)], replies: [{ uuid: 'r2', text: reply }], tools: Array.from({ length: 20 }, (_, i) => `Read f${i}`) },
    }
    const out = buildDynamic(f, index, 'u2').split('\n')
    expect(out).toContain('User: ' + 'a'.repeat(300))
    expect(out).toContain('[…]')
    expect(out).toContain('Claude (end of reply): ' + 'q'.repeat(1200))
    expect(out).toContain('User: ' + 'b'.repeat(2000))
    expect(out).toContain("Claude's final reply: " + 'h'.repeat(2000))
    expect(out.at(-1)).toBe('t'.repeat(1000))
    expect(out.find(l => l.startsWith("Claude's tool calls:"))).toBe("Claude's tool calls: " + Array.from({ length: 15 }, (_, i) => `Read f${i}`).join(', '))
  })

  test('on a live view, threads with no exchange are left out; a main thread stays while a sub of it has one', () => {
    // t3 and its sub t4 lost their exchanges to a rewind; t1 has none left but its sub t2 does.
    const f = file([th('t1', 'A'), th('t2', 'B', 't1'), th('t3', 'C'), th('t4', 'D', 't3')], [ex('u2', 't2', 'b'), ex('u5', null)])
    const lines = buildDynamic(f, {}, 'u5').split('\n')
    expect(lines.slice(0, 3)).toEqual(['## Threads so far', '- t1 [main] "A": ', '- t2 [sub of t1] "B": b  <- current'])
    expect(buildDynamic(file([th('t1', 'A')], [ex('u5', null)]), {}, 'u5')).toContain('(none yet: this is the first exchange; use new_main)')
  })

  test('an exchange missing from the row index falls back to its excerpt and an empty reply', () => {
    const f = file([], [ex('u1', null)])
    expect(buildDynamic(f, {}, 'u1')).toContain('User: u1\n')
  })
})

const reply = (p: Partial<Parsed> & { action: Parsed['action'] }): Parsed => ({ bookmarks: [], gist: '', ...p })
const exOf = (f: ConversationFile, id: string) => f.exchanges.find(x => x.id === id)

describe('applyLabel', () => {
  test('the first exchange starts main thread t1 whatever the action, labelled with the gist or the excerpt', () => {
    const f0 = file([], [ex('u1', null)])
    const a = applyLabel(f0, 'u1', reply({ action: 'continue', gist: 'login bug found' }), 'haiku')
    expect(a.threads).toEqual([th('t1', 'login bug found')])
    expect(exOf(a, 'u1')).toMatchObject({ thread: { id: 't1', by: 'labeller' }, gist: 'login bug found', label: { status: 'done', model: 'haiku' } })
    const b = applyLabel(f0, 'u1', reply({ action: 'new_sub', label: 'Side' }), 'haiku')
    expect(b.threads).toEqual([th('t1', 'Side')])
    const c = applyLabel(f0, 'u1', reply({ action: 'resume', id: 't9' }), 'haiku')
    expect(c.threads).toEqual([th('t1', 'u1')])
  })

  test('continue places the exchange in the current thread', () => {
    const f0 = file([th('t1', 'A'), th('t2', 'B')], [ex('u1', 't1'), ex('u2', 't2'), ex('u3', null)])
    const f = applyLabel(f0, 'u3', reply({ action: 'continue', gist: 'more B' }), 'haiku')
    expect(exOf(f, 'u3')?.thread).toEqual({ id: 't2', by: 'labeller' })
    expect(f.threads).toHaveLength(2)
  })

  test('new_main mints the next id, never reusing one, even one merged away', () => {
    const f0 = file([{ ...th('t1', 'A'), mergedFrom: ['t2'] }], [ex('u1', 't1'), ex('u2', null)])
    const f = applyLabel(f0, 'u2', reply({ action: 'new_main', label: 'Docs cleanup' }), 'haiku')
    expect(f.threads.at(-1)).toEqual(th('t3', 'Docs cleanup'))
    expect(exOf(f, 'u2')?.thread?.id).toBe('t3')
  })

  test('new_sub nests under the current main thread, also when the current thread is a sub', () => {
    const f0 = file([th('t1', 'A'), th('t2', 'A side', 't1')], [ex('u1', 't1'), ex('u2', 't2'), ex('u3', null)])
    const f = applyLabel(f0, 'u3', reply({ action: 'new_sub', label: 'Other side' }), 'haiku')
    expect(f.threads.at(-1)).toEqual(th('t3', 'Other side', 't1'))
  })

  test('resume resolves through mergedFrom; an unknown id continues', () => {
    const f0 = file([{ ...th('t1', 'A'), mergedFrom: ['t3'] }, th('t2', 'B')], [ex('u1', 't1'), ex('u2', 't2'), ex('u3', null)])
    expect(exOf(applyLabel(f0, 'u3', reply({ action: 'resume', id: 't3' }), 'haiku'), 'u3')?.thread?.id).toBe('t1')
    expect(exOf(applyLabel(f0, 'u3', reply({ action: 'resume', id: 't1' }), 'haiku'), 'u3')?.thread?.id).toBe('t1')
    expect(exOf(applyLabel(f0, 'u3', reply({ action: 'resume', id: 't7' }), 'haiku'), 'u3')?.thread?.id).toBe('t2')
    expect(exOf(applyLabel(f0, 'u3', reply({ action: 'resume' }), 'haiku'), 'u3')?.thread?.id).toBe('t2')
  })

  test('resume to a known thread resumes it with no current thread (a live view after a rewind)', () => {
    const f0 = file([th('t1', 'A'), th('t2', 'B')], [ex('u3', null)])
    const f = applyLabel(f0, 'u3', reply({ action: 'resume', id: 't1' }), 'haiku')
    expect(exOf(f, 'u3')?.thread?.id).toBe('t1')
    expect(f.threads).toHaveLength(2)
  })

  test('bookmarks: one per kind, none over a dismissed one, each added one counted', () => {
    const target: Exchange = {
      ...ex('u2', null),
      bookmarks: [
        { kind: 'manual', text: 'mine' },
        { kind: 'landmark', text: 'old', dismissed: true },
      ],
    }
    const f0 = file([th('t1', 'A')], [ex('u1', 't1'), target])
    const f = applyLabel(
      f0,
      'u2',
      reply({ action: 'continue', bookmarks: [{ kind: 'landmark', why: 'plan agreed' }, { kind: 'branch_point', why: 'three options' }] }),
      'haiku',
    )
    expect(exOf(f, 'u2')?.bookmarks).toEqual([
      { kind: 'manual', text: 'mine' },
      { kind: 'landmark', text: 'old', dismissed: true },
      { kind: 'branch_point', text: 'three options' },
    ])
    expect(f.bookmarkStats).toEqual({ landmark: { flagged: 0, dismissed: 0 }, branch_point: { flagged: 1, dismissed: 0 } })
    const again = applyLabel(f, 'u2', reply({ action: 'continue', bookmarks: [{ kind: 'branch_point', why: 'again' }] }), 'haiku')
    expect(exOf(again, 'u2')?.bookmarks).toHaveLength(3)
    expect(again.bookmarkStats.branch_point.flagged).toBe(1)
  })

  test("a thread set by the user is never overwritten, and no thread is minted for it", () => {
    const target: Exchange = { ...ex('u2', null), thread: { id: 't1', by: 'user' } }
    const f0 = file([th('t1', 'A'), th('t2', 'B')], [ex('u1', 't2'), target])
    const f = applyLabel(f0, 'u2', reply({ action: 'new_main', label: 'C', gist: 'g' }), 'haiku')
    expect(exOf(f, 'u2')?.thread).toEqual({ id: 't1', by: 'user' })
    expect(exOf(f, 'u2')?.gist).toBe('g')
    expect(f.threads).toHaveLength(2)
  })
})

describe('settle: one call outcome', () => {
  const answered = (text: string) => ({ isAnswered: true as const, text, usage: {} as any })
  const unanswered = (reason: 'api-error' | 'empty-reply' | 'aborted') => ({ isAnswered: false as const, reason, usage: {} as any }) as any

  test('an answer is parsed and applied', () => {
    const f0 = file([], [ex('u1', null)])
    const r = settle(f0, 'u1', answered('{"thread":{"action":"new_main","label":"Login"},"bookmarks":[],"gist":"bug found"}'), 'haiku')
    expect(r.retry).toBe(false)
    expect(r.file.threads).toEqual([th('t1', 'Login')])
    expect(exOf(r.file, 'u1')?.label).toEqual({ status: 'done', model: 'haiku' })
  })

  test('an unusable answer continues with no bookmarks', () => {
    const f0 = file([th('t1', 'A')], [ex('u1', 't1'), ex('u2', null)])
    const r = settle(f0, 'u2', answered('sorry, no JSON'), 'haiku')
    expect(r.retry).toBe(false)
    expect(exOf(r.file, 'u2')).toMatchObject({ thread: { id: 't1' }, gist: '', bookmarks: [], label: { status: 'done' } })
  })

  test('unanswered: failed and retried once, then left on continue', () => {
    for (const reason of ['api-error', 'empty-reply', 'aborted'] as const) {
      const f0 = file([th('t1', 'A')], [ex('u1', 't1'), ex('u2', null)])
      const first = settle(f0, 'u2', unanswered(reason), 'haiku')
      expect(first.retry).toBe(true)
      expect(exOf(first.file, 'u2')).toMatchObject({ thread: null, label: { status: 'failed', tries: 1 } })
      const second = settle(first.file, 'u2', unanswered(reason), 'haiku')
      expect(second.retry).toBe(false)
      expect(exOf(second.file, 'u2')).toMatchObject({ thread: { id: 't1', by: 'labeller' }, bookmarks: [], label: { status: 'failed', tries: 2 } })
    }
  })

  test('a retry that is answered lands as done', () => {
    const f0 = file([th('t1', 'A')], [ex('u1', 't1'), ex('u2', null)])
    const first = settle(f0, 'u2', unanswered('api-error'), 'haiku')
    const second = settle(first.file, 'u2', answered('{"thread":{"action":"continue"},"gist":"ok"}'), 'haiku')
    expect(exOf(second.file, 'u2')).toMatchObject({ thread: { id: 't1' }, gist: 'ok', label: { status: 'done', model: 'haiku' } })
  })
})
