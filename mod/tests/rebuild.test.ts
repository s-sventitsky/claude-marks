import { describe, expect, mock, test } from 'claude-code/testing'
import type { ConversationFile } from '../types/index'
import { BAND, SESSION_START, dataPath, fileOf, prompt, world } from './harness'
import * as J from './fixtures/jsonl'

const PATH = 'C:/cfg/projects/C--Projs-demo/s1.jsonl'
const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const norm = (p: string) => p.replace(/\\/g, '/')

type Opts = { transcript?: string; data?: ConversationFile; size?: number; root?: string; projects?: string[]; spawn?: (argv: string[]) => string[] }

/** world() plus the transcript: project root, stat, folder listing, spawn and model calls. */
const setup = (on: any, opts: Opts = {}) => {
  const files: Record<string, string> = {}
  if (opts.transcript !== undefined) files[PATH] = opts.transcript
  if (opts.data) files[dataPath('s1')] = JSON.stringify(opts.data)
  const clock = mock.clock(on)
  const w = world(on, mock, { files })
  on('session.root', () => ({ value: opts.root ?? 'C:\\Projs\\demo' }))
  on('session.cwd', () => ({ value: opts.root ?? 'C:\\Projs\\demo' }))
  on('fs.stat', (_: unknown, e: any) => {
    const t = w.files.get(norm(e.path))
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: { kind: 'file', size: opts.size ?? t.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.list', () => ({ value: (opts.projects ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
  const spawned: string[][] = []
  on('process.spawn', async function* (_: unknown, e: any) {
    spawned.push([...e.argv])
    for (const text of opts.spawn?.(e.argv) ?? []) yield { stream: 'stdout', text }
    // A stand-in for a call on $ returns { value }, a stream's result included.
    return { value: { code: 0, signal: null } }
  })
  const calls: any[] = []
  on('model.complete', (_: unknown, e: any) => {
    calls.push(e)
    return { value: { isAnswered: true, text: JSON.stringify({ thread: { action: 'continue' }, bookmarks: [], gist: 'g' + calls.length }), usage } }
  })
  return { w, clock, calls, spawned, setTranscript: (t: string) => w.files.set(PATH, t) }
}

const th = { id: 't1', label: { text: 'Login', by: 'labeller' as const }, parent: null, mergedFrom: [] }
const ex = (id: string, labelled: boolean) => ({
  id,
  prompts: [id],
  excerpt: 'p ' + id,
  thread: labelled ? { id: 't1', by: 'labeller' as const } : null,
  gist: labelled ? 'gist ' + id : '',
  bookmarks: [],
  label: { status: labelled ? ('done' as const) : ('pending' as const) },
})
const data = (...xs: ReturnType<typeof ex>[]): ConversationFile => ({
  schema: 1,
  sessionId: 's1',
  threads: xs.some(x => x.thread) ? [th] : [],
  exchanges: xs,
  corrections: [],
  bookmarkStats: { landmark: { flagged: 0, dismissed: 0 }, branch_point: { flagged: 0, dismissed: 0 } },
})

/** Prompts u1..un with one reply each (a1..an), chained. */
const chat = (n: number, from = 1, parent: string | null = null) => {
  const lines: string[] = []
  let p = parent
  for (let i = from; i < from + n; i++) {
    lines.push(J.human(`u${i}`, p, `prompt ${i}`), J.text(`a${i}`, `u${i}`, `reply ${i}`))
    p = `a${i}`
  }
  return lines
}

const bandText = async ($: any, requestId = "above") => {
  const ui = await $.ui.mount({ ...BAND, requestId } as any)
  await ui.redraw()
  return (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')
}

const chainOf = (w: any) => w.state.get('chain') as { hidden: string[]; compacted: string[]; unlabelled: string[] } | undefined

describe('rebuild on load', () => {
  test('exchanges from before the mod loaded are rebuilt; a conversation it never tracked stays unlabelled', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(3)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(1500)
    expect(fileOf(s.w, 's1')?.exchanges.map(x => [x.id, x.excerpt, x.label.status])).toEqual([
      ['u1', 'prompt 1', 'pending'],
      ['u2', 'prompt 2', 'pending'],
      ['u3', 'prompt 3', 'pending'],
    ])
    expect(s.calls).toHaveLength(0)
    expect(chainOf(s.w)?.unlabelled).toEqual(['u1', 'u2', 'u3'])
    expect(await bandText($)).toBe('○ labelling… · 3 unlabelled')
  })

  test('a short gap after the last labelled exchange is queued, and the labeller reads it from the transcript', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(3)), data: data(ex('u1', true), ex('u2', false)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(600)
    expect(s.calls).toHaveLength(1)
    const dyn = s.calls[0].promptBlocks[1].text
    expect(dyn).toContain('## Previous exchange (context only)\nUser: prompt 1\nClaude (end of reply): reply 1')
    expect(dyn).toContain('## Exchange to place\nUser: prompt 2\n')
    expect(dyn).toContain("Claude's final reply: reply 2")
    await s.clock.advance(600)
    expect(s.calls).toHaveLength(2)
    expect(s.calls[1].promptBlocks[1].text).toContain('User: prompt 3\n')
    await s.clock.advance(1500)
    expect(fileOf(s.w, 's1')?.exchanges.map(x => x.label.status)).toEqual(['done', 'done', 'done'])
  })

  test('a gap over 10 stays unlabelled and the band says so', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(12)), data: data(ex('u1', true)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(1500)
    expect(s.calls).toHaveLength(0)
    expect(await bandText($)).toBe('● Login · here #12/12 · 11 unlabelled')
  })

  test('the gap record is published with the file, before the transcript pass', async ($, on) => {
    const gap = Array.from({ length: 11 }, (_, i) => ex(`u${i + 2}`, false))
    setup(on, { transcript: J.jsonl(...chat(12)), data: data(ex('u1', true), ...gap) })
    await $.session.start(SESSION_START)
    // No clock advance: the transcript pass has not run.
    const ui = await $.ui.mount({ ...BAND, component: 'Pane', requestId: 'marks', props: { title: 'marks', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 14 }, view: {} } } as any)
    const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')
    expect(texts).toContain('Unlabelled')
    expect(texts).not.toContain('…')
  })

  test('no transcript found: the tracked file is still gap-checked', async ($, on) => {
    const s = setup(on, { data: data(ex('u1', true), ex('u2', false)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(600)
    expect(s.calls).toHaveLength(1)
  })

  test('the transcript is found by scanning the project folders when the root has moved', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(1)), root: 'D:\\elsewhere', projects: ['C--Other', 'C--Projs-demo'] })
    await $.session.start(SESSION_START)
    await s.clock.advance(1500)
    expect(fileOf(s.w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1'])
  })

  test('over 4 MiB the file streams through $.process.spawn, lines cut across pieces', async ($, on) => {
    const text = J.jsonl(...chat(2))
    const s = setup(on, { transcript: text, size: 5 * 1024 * 1024, spawn: () => [text.slice(0, 50), text.slice(50, 333), text.slice(333)] })
    await $.session.start(SESSION_START)
    await s.clock.advance(1500)
    expect(s.w.logs).toEqual(['marks: transcript: spawn (cat), 5242880 bytes, 3 pieces, 0 ms'])
    expect(s.spawned).toEqual([['cat', PATH]])
    expect(fileOf(s.w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1', 'u2'])
  })
})

describe('liveness after load', () => {
  test('a prompt sent after a rewind hides the abandoned exchange once the transcript tail is read', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(2)), data: data(ex('u1', true), ex('u2', true)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(100)
    expect(await bandText($)).toBe('● Login · here #2/2 · click or /marks')
    // Rewound to before u2: the new prompt hangs off a1.
    s.setTranscript(J.jsonl(...chat(2), J.human('u3', 'a1', 'prompt 3')))
    await $.session.append(prompt('u3', 'prompt 3') as any)
    await s.clock.advance(1000)
    expect(chainOf(s.w)?.hidden).toEqual(['u2'])
    expect(await bandText($, 'above2')).toContain('#2/2')
    expect(fileOf(s.w, 's1')?.exchanges.map(x => x.id)).toEqual(['u1', 'u2', 'u3'])
  })

  test('a prompt not in the file yet is looked for again', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(2)), data: data(ex('u1', true), ex('u2', true)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(100)
    await $.session.append(prompt('u3', 'prompt 3') as any)
    await s.clock.advance(1000)
    expect(chainOf(s.w)?.hidden).toEqual([])
    s.setTranscript(J.jsonl(...chat(2), J.human('u3', 'a1', 'prompt 3')))
    await s.clock.advance(2000)
    expect(chainOf(s.w)?.hidden).toEqual(['u2'])
  })

  test('the labeller skips a rewound exchange and leaves hidden ones out of its prompt', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(2), J.human('u3', 'a1', 'prompt 3'), J.text('a3', 'u3', 'reply 3')), data: data(ex('u1', true), ex('u2', false)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(1500)
    expect(s.calls).toHaveLength(1)
    const dyn = s.calls[0].promptBlocks[1].text
    expect(dyn).toContain('## Exchange to place\nUser: prompt 3\n')
    expect(dyn).toContain('## Previous exchange (context only)\nUser: prompt 1\n')
    expect(fileOf(s.w, 's1')?.exchanges.map(x => x.label.status)).toEqual(['done', 'pending', 'done'])
  })

  test('a rewound exchange left pending is labelled once the conversation returns to its fork', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(2), J.human('u3', 'a1', 'prompt 3'), J.text('a3', 'u3', 'reply 3')), data: data(ex('u1', true), ex('u2', false)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(1500)
    expect(s.calls).toHaveLength(1)
    // Back on u2's fork: the new prompt hangs off a2.
    s.setTranscript(J.jsonl(...chat(2), J.human('u3', 'a1', 'prompt 3'), J.text('a3', 'u3', 'reply 3'), J.human('u4', 'a2', 'prompt 4')))
    await $.session.append(prompt('u4', 'prompt 4') as any)
    await s.clock.advance(2000)
    expect(chainOf(s.w)?.hidden).toEqual(['u3'])
    expect(s.calls).toHaveLength(2)
    expect(s.calls[1].promptBlocks[1].text).toContain('## Exchange to place\nUser: prompt 2\n')
    expect(fileOf(s.w, 's1')?.exchanges.find(x => x.id === 'u2')?.label.status).toBe('done')
  })

  test('a queued exchange the drain dropped while rewound is labelled when its fork is live again', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(1)), data: data(ex('u1', true)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(100)
    // u2 runs and completes; a rewind to a1 (u3) hides it before the drain gets to it.
    s.setTranscript(J.jsonl(...chat(2)))
    await $.session.append(prompt('u2', 'prompt 2') as any)
    await $.turn.start({ text: 'prompt 2', turnId: 'r2' } as any)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'r2', reason: 'answer' } as any)
    s.setTranscript(J.jsonl(...chat(2), J.human('u3', 'a1', 'prompt 3')))
    await $.session.append(prompt('u3', 'prompt 3') as any)
    await s.clock.advance(300)
    expect(chainOf(s.w)?.hidden).toEqual(['u2'])
    await s.clock.advance(1000)
    expect(s.calls).toHaveLength(0)
    s.setTranscript(J.jsonl(...chat(2), J.human('u3', 'a1', 'prompt 3'), J.human('u4', 'a2', 'prompt 4')))
    await $.session.append(prompt('u4', 'prompt 4') as any)
    await s.clock.advance(2000)
    expect(chainOf(s.w)?.hidden).toEqual(['u3'])
    expect(fileOf(s.w, 's1')?.exchanges.find(x => x.id === 'u2')?.label.status).toBe('done')
  })

  test('a live compact_boundary makes the exchanges before it unreachable', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(2)), data: data(ex('u1', true), ex('u2', true)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(100)
    expect(chainOf(s.w)?.compacted).toEqual([])
    await $.session.append({ message: { type: 'system', name: 'compact_boundary', content: [] }, door: 'notice', origin: { kind: 'engine' }, uuid: 'b1' } as any)
    expect(chainOf(s.w)?.compacted).toEqual(['u1', 'u2'])
  })

  test('a transcript with a compaction marks the exchanges before it on load', async ($, on) => {
    const s = setup(on, { transcript: J.jsonl(...chat(1), J.boundary('b1', 'a1'), ...chat(1, 2, 'b1')), data: data(ex('u1', true)) })
    await $.session.start(SESSION_START)
    await s.clock.advance(100)
    expect(chainOf(s.w)?.compacted).toEqual(['u1'])
  })
})
