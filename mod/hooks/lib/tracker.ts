// Turns the live stream of main-session events into exchanges and the row index.
// Pure: each function takes the tracked state and returns the next one.
import type { ConversationFile } from '../../types/index'
import { addExchange, emptyFile, foldPrompt } from './model'
import { emptyRows, isCommandWrapper, toolLine, type ExchangeRows, type RowIndex } from './rows'

export type Turn = {
  /** Between a main `turn.start` and its `turn.complete`. */
  running: boolean
  /** The exchange this turn adds to; null until its prompt (or anchor) arrives. */
  exchangeId: string | null
  /** The slash command or skill line submitted for the next turn, used when it has no composer prompt. */
  command: string | null
  /** Texts the person typed during the running turn, waiting for their queued_command delivery. */
  typed: string[]
  /** Tool lines of an anchorless turn seen before its first reply text row. */
  orphanTools: string[]
}

export type Tracked = { file: ConversationFile; index: RowIndex; turn: Turn }

export const idleTurn = (): Turn => ({ running: false, exchangeId: null, command: null, typed: [], orphanTools: [] })

export const start = (sessionId: string, file: ConversationFile = emptyFile(sessionId)): Tracked => ({
  file,
  index: {},
  turn: idleTurn(),
})

export type ResponseBlock = { type: string; text?: string; name?: string; input?: unknown }

export type Submit = {
  text: string
  command?: { name: string; args: string }
  /** origin.kind === 'composer' */
  isComposer: boolean
  /** `turnId` was set: typed over (or delivered into) a running turn. */
  duringTurn: boolean
}

const withRows = (index: RowIndex, id: string, fn: (r: ExchangeRows) => ExchangeRows): RowIndex => ({
  ...index,
  [id]: fn(index[id] ?? emptyRows()),
})

const fold = (t: Tracked, exchangeId: string, uuid: string, text: string): Tracked => ({
  ...t,
  file: foldPrompt(t.file, exchangeId, uuid),
  index: withRows(t.index, exchangeId, r => ({ ...r, prompts: [...r.prompts, text] })),
})

/** A composer prompt row (`session.append` door `prompt`, main session). */
export const onPrompt = (t: Tracked, uuid: string, text: string): Tracked => {
  if (isCommandWrapper(text)) return t
  const { turn } = t
  if (turn.running && turn.exchangeId) return fold(t, turn.exchangeId, uuid, text)
  return {
    file: addExchange(t.file, uuid, text),
    index: withRows(t.index, uuid, r => ({ ...r, prompts: [text] })),
    turn: { ...turn, exchangeId: uuid, command: null },
  }
}

/** A `prompt.submit` on the main session: a command line, or text typed over a running turn. */
export const onSubmit = (t: Tracked, s: Submit): Tracked => {
  if (!s.isComposer) return t
  if (s.command) {
    if (t.turn.running) return t
    const line = `/${s.command.name}${s.command.args ? ' ' + s.command.args : ''}`
    return { ...t, turn: { ...t.turn, command: line } }
  }
  if (s.duringTurn && t.turn.running) return { ...t, turn: { ...t.turn, typed: [...t.turn.typed, s.text] } }
  return t
}

/** A `queued_command` attachment row: a typed prompt delivered into the running turn. */
export const onQueued = (t: Tracked, uuid: string): Tracked => {
  const { turn } = t
  const [text, ...rest] = turn.typed
  if (!turn.running || !turn.exchangeId || text === undefined) return t
  const next = fold(t, turn.exchangeId, uuid, text)
  return { ...next, turn: { ...next.turn, typed: rest } }
}

/** The exchange a transcript row belongs to: a prompt it folded, its anchor, or one of its reply text rows. */
export const exchangeOfRow = (t: Tracked, uuid: string): string | undefined =>
  t.file.exchanges.find(x => x.prompts.includes(uuid) || x.id === uuid)?.id ??
  Object.keys(t.index).find(id => t.index[id]?.replies.some(r => r.uuid === uuid))

/** Of the rows on screen, the exchange that comes first in the conversation. */
export const topmost = (t: Tracked, rows: Iterable<string>): string | undefined => {
  let best: { id: string; at: number } | undefined
  for (const row of rows) {
    const id = exchangeOfRow(t, row)
    const at = id === undefined ? -1 : t.file.exchanges.findIndex(x => x.id === id)
    if (id !== undefined && at >= 0 && (!best || at < best.at)) best = { id, at }
  }
  return best?.id
}

export const onTurnStart =(t: Tracked): Tracked => ({ ...t, turn: { ...t.turn, running: true } })

export const onTurnComplete = (t: Tracked): Tracked => ({ ...t, turn: idleTurn() })

/** A response row (`session.append` door `response`, main session): reply text and tool lines. */
export const onResponse = (t: Tracked, uuid: string, blocks: readonly ResponseBlock[]): Tracked => {
  const text = blocks
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
  const tools = blocks.filter(b => b.type === 'tool_use' && typeof b.name === 'string').map(b => toolLine(b.name as string, b.input))
  let next = t
  if (!next.turn.exchangeId && next.turn.running && next.turn.command && text.trim()) {
    const id = uuid
    next = {
      file: addExchange(next.file, id, next.turn.command),
      index: withRows(next.index, id, r => ({ ...r, prompts: [t.turn.command as string], tools: [...t.turn.orphanTools] })),
      turn: { ...next.turn, exchangeId: id, orphanTools: [] },
    }
  }
  const exId = next.turn.exchangeId
  if (!exId) {
    if (next.turn.running && next.turn.command && tools.length) {
      return { ...next, turn: { ...next.turn, orphanTools: [...next.turn.orphanTools, ...tools] } }
    }
    return next
  }
  return {
    ...next,
    index: withRows(next.index, exId, r => ({
      ...r,
      replies: text.trim() ? [...r.replies, { uuid, text }] : r.replies,
      tools: [...r.tools, ...tools],
    })),
  }
}
