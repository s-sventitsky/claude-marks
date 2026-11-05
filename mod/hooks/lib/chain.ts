// Liveness, reachability and the turns of a transcript, and how they meet the
// data file. Spec "Liveness and reachability", "Exchanges", "Labeller" (Gaps on load). Pure.
import type { ChainView, ConversationFile, Exchange, Thread } from '../../types/index'
import type { Transcript } from './jsonl'
import { foldPrompt, newExchange } from './model'
import { emptyRows, type ExchangeRows, type ReplyRow, type RowIndex } from './rows'

/**
 * The row a walk goes to from `uuid`. The parentUuid (a boundary's logicalParentUuid),
 * unless the file can't place it: a parent the file never wrote (the engine links rows
 * to ones it doesn't keep), one that comes later in the file, or a boundary with none.
 * Those continue at the row before in the file. Undefined at a root.
 */
export const stepBack = (t: Transcript, uuid: string): string | undefined => {
  const i = t.pos.get(uuid)
  if (i === undefined) return undefined
  const p = t.parent.get(uuid)
  const isBoundary = t.rows.get(uuid)?.kind === 'boundary'
  if (p === null && !isBoundary) return undefined
  const at = p == null ? undefined : t.pos.get(p)
  if (at !== undefined && at < i) return p as string
  return i > 0 ? t.order[i - 1] : undefined
}

/** The active chain: every row walked back from the newest user or assistant row. */
export const liveSet = (t: Transcript): Set<string> => {
  const live = new Set<string>()
  let u = t.newest
  while (u !== undefined && !live.has(u)) {
    live.add(u)
    u = stepBack(t, u)
  }
  return live
}

/** One exchange as the transcript has it. */
export type Turn = { id: string; prompts: { uuid: string; text: string }[]; replies: ReplyRow[]; tools: string[] }

type Owner = { turn: Turn } | { command: { text: string; tools: string[] } } | null

/**
 * The transcript's exchanges, file order: one per typed prompt, holding the prompts
 * folded into it and the reply rows under it. A row belongs to the turn of the row it
 * walks back to, so both branches of a rewind keep their own replies. A command turn
 * anchors on its first reply text row; replies to a turn nobody typed belong to none.
 */
export const turnsOf = (t: Transcript): Turn[] => {
  const turns: Turn[] = []
  const owner = new Map<string, Owner>()
  for (const u of t.order) {
    const back = stepBack(t, u)
    const up: Owner = back === undefined ? null : (owner.get(back) ?? null)
    const row = t.rows.get(u)
    let mine: Owner = up
    if (row?.kind === 'prompt') {
      const turn: Turn = { id: u, prompts: [{ uuid: u, text: row.text }], replies: [], tools: [] }
      turns.push(turn)
      mine = { turn }
    } else if (row?.kind === 'command') {
      mine = { command: { text: row.text, tools: [] } }
    } else if (row?.kind === 'turn') {
      mine = null
    } else if (row?.kind === 'queued') {
      if (up && 'turn' in up) up.turn.prompts.push({ uuid: u, text: row.text })
    } else if (row?.kind === 'reply') {
      if (up && 'turn' in up) {
        if (row.text) up.turn.replies.push({ uuid: u, text: row.text })
        up.turn.tools.push(...row.tools)
      } else if (up && 'command' in up) {
        if (row.text) {
          const turn: Turn = { id: u, prompts: [{ uuid: u, text: up.command.text }], replies: [{ uuid: u, text: row.text }], tools: [...up.command.tools, ...row.tools] }
          turns.push(turn)
          mine = { turn }
        } else {
          up.command.tools.push(...row.tools)
        }
      }
    }
    owner.set(u, mine)
  }
  return turns
}

const mergeRows = (live: ExchangeRows | undefined, turn: Turn): ExchangeRows => {
  const read: ExchangeRows = { ...emptyRows(), prompts: turn.prompts.map(p => p.text), replies: turn.replies, tools: turn.tools }
  if (!live) return read
  const seen = new Set(read.replies.map(r => r.uuid))
  return {
    prompts: live.prompts.length ? live.prompts : read.prompts,
    replies: [...read.replies, ...live.replies.filter(r => !seen.has(r.uuid))],
    tools: read.tools.length >= live.tools.length ? read.tools : live.tools,
  }
}

/**
 * Brings the transcript's turns into the file and the row index. A turn not in the
 * file becomes a pending exchange, placed after the turn before it (so in transcript
 * order around the exchanges already there); one in the file gains any folded prompts
 * it lacks; one whose anchor another exchange folded is skipped. The index gets the
 * read rows plus any live reply rows the read did not see.
 */
export const mergeTurns = (file: ConversationFile, index: RowIndex, turns: readonly Turn[]): { file: ConversationFile; index: RowIndex } => {
  let out = file
  const nextIndex: RowIndex = { ...index }
  let prev: string | undefined
  for (const turn of turns) {
    const folded = out.exchanges.find(x => x.id !== turn.id && x.prompts.includes(turn.id))
    if (folded) continue
    const at = out.exchanges.findIndex(x => x.id === turn.id)
    if (at < 0) {
      const ex = newExchange(turn.id, turn.prompts[0]?.text ?? '')
      const after = prev === undefined ? -1 : out.exchanges.findIndex(x => x.id === prev)
      const exchanges = out.exchanges.slice()
      exchanges.splice(after + 1, 0, ex)
      out = { ...out, exchanges }
    }
    for (const p of turn.prompts) out = foldPrompt(out, turn.id, p.uuid)
    nextIndex[turn.id] = mergeRows(index[turn.id], turn)
    prev = turn.id
  }
  return { file: out, index: nextIndex }
}

/** Liveness and reachability of the file's exchanges against the transcript. */
export const viewOf = (t: Transcript, file: ConversationFile, unlabelled: readonly string[]): ChainView => {
  const live = liveSet(t)
  const last = t.boundaries.at(-1)
  const cut = last === undefined ? -1 : (t.pos.get(last) ?? -1)
  const hidden: string[] = []
  const compacted: string[] = []
  for (const x of file.exchanges) {
    const at = t.pos.get(x.id)
    if (at === undefined) continue
    if (!live.has(x.id)) hidden.push(x.id)
    if (at < cut) compacted.push(x.id)
  }
  return { hidden, compacted, unlabelled: [...unlabelled] }
}

/** Off the active chain only when the view says so; an exchange it doesn't know is live. */
export const isLive = (view: ChainView | null | undefined, id: string): boolean => !view?.hidden.includes(id)

/** The transcript can jump to it: fullscreen, and after the last compaction. */
export const isReachable = (view: ChainView | null | undefined, id: string, fullscreen: boolean): boolean =>
  fullscreen && !view?.compacted.includes(id)

/** Most unlabelled exchanges the load queues; a longer run waits. */
export const GAP_MAX = 10

/**
 * Gaps on load: the run of unlabelled live exchanges after the last labelled one.
 * 10 or fewer are queued, conversation order. A longer run, or exchanges in a
 * conversation the mod never tracked (`fresh`: the file had none before this read),
 * are left unlabelled.
 */
export const gapRun = (file: ConversationFile, hidden: readonly string[], fresh: boolean): { queue: string[]; left: string[] } => {
  const live = file.exchanges.filter(x => !hidden.includes(x.id))
  let last = -1
  live.forEach((x, i) => {
    if (x.thread) last = i
  })
  const run = live
    .slice(last + 1)
    .filter(x => !x.thread)
    .map(x => x.id)
  if (!run.length) return { queue: [], left: [] }
  if ((last < 0 && fresh) || run.length > GAP_MAX) return { queue: [], left: run }
  return { queue: run, left: [] }
}

/** The file as the live chain sees it: hidden exchanges dropped, threads all kept (their colours hold). */
export const liveView = (file: ConversationFile, hidden: readonly string[]): ConversationFile =>
  hidden.length ? { ...file, exchanges: file.exchanges.filter(x => !hidden.includes(x.id)) } : file

/**
 * The threads to show for a (live view of a) file: those with an exchange in it, and a
 * main thread while one of its sub-threads has one. File order.
 */
export const visibleThreads = (file: ConversationFile): Thread[] => {
  const used = new Set(file.exchanges.map(x => x.thread?.id).filter((id): id is string => !!id))
  return file.threads.filter(t => used.has(t.id) || (!t.parent && file.threads.some(s => s.parent === t.id && used.has(s.id))))
}

/** Puts a changed live view back into the whole file: its exchanges by id, its threads and stats. */
export const mergeBack = (file: ConversationFile, view: ConversationFile): ConversationFile => {
  const byId = new Map<string, Exchange>(view.exchanges.map(x => [x.id, x]))
  return {
    ...file,
    threads: view.threads,
    corrections: view.corrections,
    bookmarkStats: view.bookmarkStats,
    exchanges: file.exchanges.map(x => byId.get(x.id) ?? x),
  }
}

/** The band's `N unlabelled`: exchanges the load left unlabelled that are still live and unlabelled. */
export const unlabelledCount = (file: ConversationFile | null, view: ChainView | null): number => {
  if (!file || !view) return 0
  return view.unlabelled.filter(id => isLive(view, id) && file.exchanges.some(x => x.id === id && !x.thread)).length
}
