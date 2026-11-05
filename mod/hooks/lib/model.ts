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

/** Appends an exchange; an id already in the file is left as it is. */
export const addExchange = (file: ConversationFile, id: string, text: string): ConversationFile =>
  file.exchanges.some(x => x.id === id) ? file : { ...file, exchanges: [...file.exchanges, newExchange(id, text)] }

/** Folds a prompt uuid into an exchange's prompts[]; unknown exchange or known uuid: unchanged. */
export const foldPrompt = (file: ConversationFile, exchangeId: string, uuid: string): ConversationFile => {
  const i = file.exchanges.findIndex(x => x.id === exchangeId)
  const ex = file.exchanges[i]
  if (!ex || ex.prompts.includes(uuid)) return file
  const exchanges = file.exchanges.slice()
  exchanges[i] = { ...ex, prompts: [...ex.prompts, uuid] }
  return { ...file, exchanges }
}

/**
 * The current thread: the thread of the latest labelled exchange, or of the
 * latest one before `beforeId` when given. Undefined when there is none.
 * Liveness (ticket 03) narrows "latest" to live exchanges.
 */
export const currentThread = (file: ConversationFile, beforeId?: string): Thread | undefined => {
  const end = beforeId === undefined ? file.exchanges.length : file.exchanges.findIndex(x => x.id === beforeId)
  for (let i = (end < 0 ? file.exchanges.length : end) - 1; i >= 0; i--) {
    const id = file.exchanges[i]?.thread?.id
    if (id) return file.threads.find(t => t.id === id)
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
