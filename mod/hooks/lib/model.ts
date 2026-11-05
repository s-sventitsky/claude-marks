// Pure operations on the conversation data file. No `$`, no engine values.
import type { ConversationFile, Exchange, Thread } from '../../types/index'

export const EXCERPT_MAX = 80

/** First ~80 chars of a prompt, whitespace collapsed; an ellipsis marks a cut. */
export const excerptOf = (text: string, max = EXCERPT_MAX): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= max ? one : one.slice(0, max - 1) + '…'
}

export const emptyFile = (sessionId: string): ConversationFile => ({
  schema: 1,
  sessionId,
  threads: [],
  exchanges: [],
  corrections: [],
  bookmarkStats: {
    landmark: { flagged: 0, dismissed: 0 },
    branch_point: { flagged: 0, dismissed: 0 },
  },
})

export const newExchange = (id: string, text: string): Exchange => ({
  id,
  prompts: [id],
  excerpt: excerptOf(text),
  thread: null,
  gist: '',
  bookmarks: [],
  label: { status: 'pending' },
})

export const exchangeById = (file: ConversationFile, id: string): Exchange | undefined => file.exchanges.find(x => x.id === id)

export const threadById = (file: ConversationFile, id: string): Thread | undefined => file.threads.find(t => t.id === id)

/** A thread's main thread: itself, or its parent. */
export const mainOf = (file: ConversationFile, t: Thread): Thread | undefined => (t.parent === null ? t : threadById(file, t.parent))

/** Hidden when false. Absent: all live. Ticket 03's `isLive(view, id)` from chain.ts. */
export type IsLive = (x: Exchange) => boolean

/**
 * What the transcript knows about each exchange, as the tree, the reader and Enter take it.
 * Every part is optional: absent, every exchange is live, reachable and labelled or pending.
 */
export type ChainOptions = {
  isLive?: IsLive
  /** False: before the last compaction (and every row on the main screen). Absent: all reachable. */
  isReachable?: (x: Exchange) => boolean
  /** The gap rule's record (ChainView.unlabelled): exchanges the load left unlabelled. */
  unlabelled?: readonly string[]
}

/** ChainOptions plus the mode, as the reader and Enter take them. */
export type ViewOptions = ChainOptions & {
  /** From the viewport: true fullscreen, false the main screen, undefined while unknown. */
  fullscreen: boolean | undefined
}

/** The live exchanges, conversation order. */
export const liveExchanges = (file: ConversationFile, isLive?: IsLive): Exchange[] => (isLive ? file.exchanges.filter(isLive) : file.exchanges)

/** Replaces exchange `id` with `fn` of it; an unknown id, or `fn` returning it unchanged: the same file. */
export const withExchange = (file: ConversationFile, id: string, fn: (x: Exchange) => Exchange): ConversationFile => {
  const i = file.exchanges.findIndex(x => x.id === id)
  const x = file.exchanges[i]
  if (!x) return file
  const next = fn(x)
  if (next === x) return file
  const exchanges = file.exchanges.slice()
  exchanges[i] = next
  return { ...file, exchanges }
}

/** Appends an exchange; an id already in the file is left as it is. */
export const addExchange = (file: ConversationFile, id: string, text: string): ConversationFile =>
  exchangeById(file, id) ? file : { ...file, exchanges: [...file.exchanges, newExchange(id, text)] }

/** Folds a prompt uuid into an exchange's prompts[]; unknown exchange or known uuid: unchanged. */
export const foldPrompt = (file: ConversationFile, exchangeId: string, uuid: string): ConversationFile =>
  withExchange(file, exchangeId, x => (x.prompts.includes(uuid) ? x : { ...x, prompts: [...x.prompts, uuid] }))

/**
 * The current thread: the thread of the latest labelled exchange, or of the
 * latest one before `beforeId` when given. Undefined when there is none.
 * Pass a live view (liveView in chain.ts) to get the latest live one.
 */
export const currentThread = (file: ConversationFile, beforeId?: string): Thread | undefined => {
  const end = beforeId === undefined ? file.exchanges.length : file.exchanges.findIndex(x => x.id === beforeId)
  for (let i = (end < 0 ? file.exchanges.length : end) - 1; i >= 0; i--) {
    const id = file.exchanges[i]?.thread?.id
    if (id) return threadById(file, id)
  }
  return undefined
}

/**
 * Parses a data file's text. Anything that is not a schema-1 file for this
 * session reads as absent, so the caller starts empty rather than crash.
 */
export const parseFile = (text: string, sessionId: string): ConversationFile | undefined => {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return undefined
  }
  const f = v as Partial<ConversationFile> | null
  if (!f || f.schema !== 1 || f.sessionId !== sessionId || !Array.isArray(f.exchanges)) return undefined
  const empty = emptyFile(sessionId)
  return {
    ...empty,
    ...f,
    threads: Array.isArray(f.threads) ? f.threads : [],
    corrections: Array.isArray(f.corrections) ? f.corrections : [],
    bookmarkStats: { ...empty.bookmarkStats, ...(f.bookmarkStats ?? {}) },
  } as ConversationFile
}
