// The labeller's pure parts: the prompt it is sent, the reply it reads back,
// and how a result lands in the data file. Spec "Labeller".
import type { ConversationFile, Exchange } from '../../types/index'
import { visibleThreads } from './chain'
import { currentThread } from './model'
import type { RowIndex } from './rows'

/** Python's clip() in prototype-labeller/run.py. */
const clip = (s: string, head: number, tail = 0): string =>
  s.length <= head + tail ? s : s.slice(0, head) + '\n[…]\n' + (tail ? s.slice(-tail) : '')

const MAX_TOOLS = 15

const promptOf = (ex: Exchange, index: RowIndex): string => {
  const p = index[ex.id]?.prompts ?? []
  return p.length ? p.join('\n') : ex.excerpt
}

/** The last reply text block with text, as the prototype's extractor kept it. */
const replyOf = (ex: Exchange, index: RowIndex): string => {
  const r = (index[ex.id]?.replies ?? []).filter(x => x.text.trim())
  return r.at(-1)?.text ?? ''
}

/**
 * The prompt's dynamic part for one exchange, as build() in
 * prototype-labeller/run.py: threads so far, the previous exchange, the exchange.
 * Pass the live view (liveView in chain.ts) so threads and the previous exchange are live ones.
 */
export const buildDynamic = (file: ConversationFile, index: RowIndex, exchangeId: string): string => {
  const at = file.exchanges.findIndex(x => x.id === exchangeId)
  const ex = file.exchanges[at]
  if (!ex) throw new Error(`no exchange ${exchangeId}`)
  const before = file.exchanges.slice(0, at)
  const current = currentThread(file, exchangeId)
  // On a live view (liveView in chain.ts) a thread with no exchange left is hidden.
  const visible = visibleThreads(file)
  const lines = ['## Threads so far']
  if (!visible.length) lines.push('(none yet: this is the first exchange; use new_main)')
  for (const t of visible) {
    const kind = t.parent ? `sub of ${t.parent}` : 'main'
    const gists = before
      .filter(x => x.thread?.id === t.id && x.gist)
      .map(x => x.gist)
      .slice(-2)
      .join('; ')
    const mark = t.id === current?.id ? '  <- current' : ''
    lines.push(`- ${t.id} [${kind}] "${t.label.text}": ${gists}${mark}`)
  }
  const prev = before.at(-1)
  if (prev) {
    lines.push(
      '',
      '## Previous exchange (context only)',
      `User: ${clip(promptOf(prev, index), 300)}`,
      `Claude (end of reply): ${replyOf(prev, index).slice(-1200)}`,
    )
  }
  const tools = (index[ex.id]?.tools ?? []).slice(0, MAX_TOOLS).join(', ')
  lines.push(
    '',
    '## Exchange to place',
    `User: ${clip(promptOf(ex, index), 2000)}`,
    `Claude's tool calls: ${tools || 'none'}`,
    `Claude's final reply: ${clip(replyOf(ex, index), 2000, 1000)}`,
  )
  return lines.join('\n')
}

export type Action = 'continue' | 'resume' | 'new_main' | 'new_sub'
export type AutoKind = 'branch_point' | 'landmark'

/** A labeller reply, validated and clipped. */
export type Parsed = {
  action: Action
  /** resume only */
  id?: string
  /** new_main / new_sub only */
  label?: string
  bookmarks: { kind: AutoKind; why: string }[]
  gist: string
}

export const FALLBACK: Parsed = { action: 'continue', bookmarks: [], gist: '' }

const ACTIONS: readonly string[] = ['continue', 'resume', 'new_main', 'new_sub']
const KINDS: readonly string[] = ['branch_point', 'landmark']
const LABEL_MAX = 40
const GIST_MAX = 80
const WHY_MAX = 60

const clipText = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Reads the model's reply: strips a code fence, takes the text from the first
 * `{` to the last `}`, parses and validates it. Anything unusable is FALLBACK.
 */
export const parseReply = (text: string): Parsed => {
  let s = text.trim()
  if (s.startsWith('```')) s = s.replace(/^`+/, '').replace(/^json/, '').replace(/`+$/, '')
  const from = s.indexOf('{')
  const to = s.lastIndexOf('}')
  if (from < 0 || to < from) return FALLBACK
  let v: unknown
  try {
    v = JSON.parse(s.slice(from, to + 1))
  } catch {
    return FALLBACK
  }
  if (!isObject(v) || !isObject(v.thread)) return FALLBACK
  const action = v.thread.action
  if (typeof action !== 'string' || !ACTIONS.includes(action)) return FALLBACK
  const out: Parsed = { action: action as Action, bookmarks: [], gist: clipText(v.gist, GIST_MAX) }
  if (action === 'resume' && typeof v.thread.id === 'string') out.id = v.thread.id.trim()
  if ((action === 'new_main' || action === 'new_sub') && typeof v.thread.label === 'string') out.label = clipText(v.thread.label, LABEL_MAX)
  for (const b of Array.isArray(v.bookmarks) ? v.bookmarks : []) {
    if (!isObject(b) || typeof b.kind !== 'string' || !KINDS.includes(b.kind)) continue
    if (out.bookmarks.some(x => x.kind === b.kind)) continue
    out.bookmarks.push({ kind: b.kind as AutoKind, why: clipText(b.why, WHY_MAX) })
  }
  return out
}

/** Next `tN`: one past every id ever minted, merged ones included, so none is reused. */
const mintId = (file: ConversationFile): string => {
  let max = 0
  for (const t of file.threads) {
    for (const id of [t.id, ...t.mergedFrom]) {
      const m = /^t(\d+)$/.exec(id)
      if (m) max = Math.max(max, Number(m[1]))
    }
  }
  return `t${max + 1}`
}

/** A thread id resolved through every thread's mergedFrom; undefined when unknown. */
const resolveThread = (file: ConversationFile, id: string | undefined): string | undefined =>
  id === undefined ? undefined : file.threads.find(t => t.id === id || t.mergedFrom.includes(id))?.id

const withExchange = (file: ConversationFile, id: string, fn: (x: Exchange) => Exchange): ConversationFile => ({
  ...file,
  exchanges: file.exchanges.map(x => (x.id === id ? fn(x) : x)),
})

/**
 * Applies a labeller result to one exchange (spec "Applying it"): places it in a
 * thread (minting one for new_*), adds auto bookmarks, sets gist and label status.
 * A thread set `by: 'user'` stays as it is.
 */
export const applyLabel = (file: ConversationFile, exchangeId: string, p: Parsed, model: string): ConversationFile => {
  const ex = file.exchanges.find(x => x.id === exchangeId)
  if (!ex) return file
  let threads = file.threads
  let threadId: string
  if (ex.thread?.by === 'user') {
    threadId = ex.thread.id
  } else {
    const current = currentThread(file, exchangeId)
    const resumed = p.action === 'resume' ? resolveThread(file, p.id) : undefined
    const action: Action = !current ? 'new_main' : p.action === 'resume' && !resumed ? 'continue' : p.action
    if (action === 'new_main' || action === 'new_sub') {
      threadId = mintId(file)
      const text = (p.label || p.gist || ex.excerpt).slice(0, LABEL_MAX)
      const parent = action === 'new_sub' && current ? (current.parent ?? current.id) : null
      threads = [...threads, { id: threadId, label: { text, by: 'labeller' }, parent, mergedFrom: [] }]
    } else {
      threadId = resumed ?? (current as NonNullable<typeof current>).id
    }
  }
  const bookmarks = ex.bookmarks.slice()
  const stats = { landmark: { ...file.bookmarkStats.landmark }, branch_point: { ...file.bookmarkStats.branch_point } }
  for (const b of p.bookmarks) {
    if (bookmarks.some(x => x.kind === b.kind)) continue
    bookmarks.push({ kind: b.kind, text: b.why })
    stats[b.kind].flagged++
  }
  return withExchange({ ...file, threads, bookmarkStats: stats }, exchangeId, x => ({
    ...x,
    thread: x.thread?.by === 'user' ? x.thread : { id: threadId, by: 'labeller' },
    gist: p.gist,
    bookmarks,
    label: { status: 'done', model },
  }))
}

/** How many calls an exchange gets: the first and one retry. */
const MAX_TRIES = 2

/**
 * One call's outcome for one exchange. An answer is parsed and applied. An
 * unanswered call marks the exchange failed and asks for one retry; after the
 * retry it is left on continue, still marked failed.
 */
export const settle = (
  file: ConversationFile,
  exchangeId: string,
  result: { isAnswered: true; text: string } | { isAnswered: false; reason: string },
  model: string,
): { file: ConversationFile; retry: boolean } => {
  if (result.isAnswered) return { file: applyLabel(file, exchangeId, parseReply(result.text), model), retry: false }
  const ex = file.exchanges.find(x => x.id === exchangeId)
  if (!ex) return { file, retry: false }
  const tries = (ex.label.tries ?? 0) + 1
  if (tries < MAX_TRIES) return { file: withExchange(file, exchangeId, x => ({ ...x, label: { status: 'failed', tries } })), retry: true }
  const placed = applyLabel(file, exchangeId, FALLBACK, model)
  return { file: withExchange(placed, exchangeId, x => ({ ...x, label: { status: 'failed', model, tries } })), retry: false }
}
