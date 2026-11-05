// Manual bookmarks (ticket 06): `/mark [#n] [note]` and the reader's `m` menu. Pure.
import type { Bookmark, ConversationFile, Correction, Exchange } from '../../types/index'
import { GLYPH } from './band'
import { exchangeById, excerptOf, liveExchanges, withExchange, type IsLive } from './model'
import type { ExchangeRows } from './rows'

export const MARK_USAGE = 'usage: /mark [#n] [note]'
export const NO_EXCHANGE = '/mark: no exchange to bookmark yet'

/** `/mark`'s arguments: the target exchange (`latest`, or the tree's number n) and the note. */
export type MarkArgs = { target: 'latest' | number; note?: string }

/** Parses the text after `/mark`. A first word starting with `#` must be `#<n>`, n ≥ 1; else undefined (usage). */
export const parseMark = (args: string): MarkArgs | undefined => {
  const s = args.trim()
  if (!s.startsWith('#')) return s ? { target: 'latest', note: s } : { target: 'latest' }
  const match = /^#(\d+)(?:\s+([\s\S]*))?$/.exec(s)
  const n = match ? Number(match[1]) : 0
  if (!match || !Number.isSafeInteger(n) || n < 1) return undefined
  const note = match[2]?.trim()
  return note ? { target: n, note } : { target: n }
}

/** What `/mark` bookmarks: the exchange, its tree number, the reply text row (absent = the prompt row), the text. */
export type MarkPlan = { exchange: string; n: number; row?: string; text: string }

export type MarkOptions = {
  /** The row index entry of an exchange (prompt texts, reply text rows). */
  rowsOf: (id: string) => ExchangeRows | undefined
  /** Hidden when false, as the tree counts. Absent: all live. */
  isLive?: IsLive
}

/** `{ row }` when the bookmark sits on a reply row; `{}` on the prompt row (no `row` key stored). */
const onRow = (row: string | undefined): { row?: string } => (row === undefined ? {} : { row })

/**
 * A bookmark's text without a note: ~80 chars of the message (the reply text block it
 * sits on, else the prompt; the excerpt while the index has no prompt), else the gist.
 */
export const fallbackText = (x: Exchange, rows: ExchangeRows | undefined, row?: string): string => {
  const message = row !== undefined ? rows?.replies.find(r => r.uuid === row)?.text ?? '' : rows?.prompts[0] ?? x.excerpt
  return excerptOf(message) || (row === undefined ? x.excerpt : '') || x.gist
}

/**
 * `/mark`'s target. No `#n`: the latest live exchange, on Claude's latest reply text block
 * (the prompt row while it has none). `#n`: the tree's exchange n, on its prompt row.
 */
export const planMark = (file: ConversationFile, a: MarkArgs, o: MarkOptions): MarkPlan | { error: string } => {
  const live = liveExchanges(file, o.isLive)
  if (!live.length) return { error: NO_EXCHANGE }
  const n = a.target === 'latest' ? live.length : a.target
  const x = live[n - 1]
  if (!x) return { error: MARK_USAGE }
  const rows = o.rowsOf(x.id)
  const row = a.target === 'latest' ? rows?.replies.at(-1)?.uuid : undefined
  const text = a.note ?? fallbackText(x, rows, row)
  return { exchange: x.id, n, ...onRow(row), text }
}

/** `corrections[]` keeps the newest this many. */
export const CORRECTIONS_MAX = 10

/** The exchange's manual bookmark, if it has one. */
export const manualOf = (x: Exchange): Bookmark | undefined => x.bookmarks.find(b => b.kind === 'manual')

/**
 * Puts the exchange's one manual bookmark on `row` (absent = the prompt row), replacing
 * any it had, first in its list so its glyph leads; logs a `bookmark_add` (newest 10 kept).
 */
export const setManual = (file: ConversationFile, id: string, b: { row?: string; text: string }, at: string): ConversationFile => {
  const next = withExchange(file, id, x => {
    const mark: Bookmark = { kind: 'manual', ...onRow(b.row), text: b.text }
    return { ...x, bookmarks: [mark, ...x.bookmarks.filter(k => k.kind !== 'manual')] }
  })
  if (next === file) return file
  const add: Correction = { kind: 'bookmark_add', exchange: id, ...onRow(b.row), at }
  return { ...next, corrections: [...next.corrections, add].slice(-CORRECTIONS_MAX) }
}

/** Drops the exchange's manual bookmark. Not a correction kind: nothing is logged. */
export const removeManual = (file: ConversationFile, id: string): ConversationFile =>
  withExchange(file, id, x => (manualOf(x) ? { ...x, bookmarks: x.bookmarks.filter(k => k.kind !== 'manual') } : x))

/** The reader's note after a pick: replaces the manual bookmark's text; empty means no note (text kept). */
export const noteManual = (file: ConversationFile, id: string, note: string): ConversationFile => {
  const text = note.trim()
  if (!text) return file
  return withExchange(file, id, x => {
    const manual = manualOf(x)
    return manual ? { ...x, bookmarks: x.bookmarks.map(k => (k === manual ? { ...manual, text } : k)) } : x
  })
}

/** The menu value of "the whole exchange" (the prompt row); a reply block's is `row:<uuid>`. */
export const WHOLE = 'whole'
const ROW = 'row:'
/** The menu value of reply row `row`, or of the whole exchange when absent. */
export const menuValue = (row: string | undefined): string => (row === undefined ? WHOLE : ROW + row)
/** The reply row a menu value names; undefined for the whole exchange. */
export const rowOfMenuValue = (value: string): string | undefined => (value.startsWith(ROW) ? value.slice(ROW.length) : undefined)
const MENU_TEXT_MAX = 60

/**
 * Where the exchange's manual bookmark sits, as a menu value: its reply row while the
 * index knows that row, else the whole exchange (a row that can't be found falls back
 * to the prompt row). Undefined without a manual bookmark.
 */
export const heldValue = (x: Exchange, rows: ExchangeRows | undefined): string | undefined => {
  const manual = manualOf(x)
  if (!manual) return undefined
  const row = manual.row
  return menuValue(row !== undefined && rows?.replies.some(r => r.uuid === row) ? row : undefined)
}

const MENU = 'mark:menu:'
const NOTE = 'mark:note:'
/** The `m` menu's `Select` key for exchange `id`: the file changes in a `ui.select` hook, which reads the id back. */
export const menuKey = (id: string): string => MENU + id
/** The note `Input`'s key for exchange `id`. */
export const noteKey = (id: string): string => NOTE + id
/** Which menu element a `ui.select` / `ui.input` reached, and for which exchange. */
export const menuTarget = (element: string): { kind: 'pick' | 'note'; id: string } | undefined => {
  const kind = element.startsWith(MENU) ? 'pick' : element.startsWith(NOTE) ? 'note' : undefined
  const id = element.slice(MENU.length)
  return kind && id ? { kind, id } : undefined
}

/** Where a jump to the exchange's manual bookmark goes: its reply row while the index knows it, else the prompt row. */
export const anchorOf = (x: Exchange, rows: ExchangeRows | undefined): string => {
  const held = heldValue(x, rows)
  return (held === undefined ? undefined : rowOfMenuValue(held)) ?? x.id
}

/** The reader's `m` menu: each reply text block (first ~60 chars), then the whole exchange; ◆ on the one holding the bookmark. */
export const markMenu = (x: Exchange, rows: ExchangeRows | undefined): { value: string; label: string }[] => {
  const held = heldValue(x, rows)
  const entry = (value: string, text: string) => ({ value, label: `${value === held ? GLYPH.manual : ' '} ${text}` })
  return [...(rows?.replies ?? []).map(r => entry(menuValue(r.uuid), excerptOf(r.text, MENU_TEXT_MAX))), entry(menuValue(undefined), 'the whole exchange')]
}

/**
 * A pick in the `m` menu. The entry holding the bookmark: removed. Any other: the
 * bookmark moves there with the fallback text (logged as an add), and a note is asked for.
 */
export const pickMark = (file: ConversationFile, id: string, value: string, rows: ExchangeRows | undefined, at: string): { file: ConversationFile; askNote: boolean } => {
  const x = exchangeById(file, id)
  if (!x) return { file, askNote: false }
  if (value === heldValue(x, rows)) return { file: removeManual(file, id), askNote: false }
  const row = rowOfMenuValue(value)
  return { file: setManual(file, id, { ...onRow(row), text: fallbackText(x, rows, row) }, at), askNote: true }
}

/** `/mark`'s confirmation: `◆ #14 "chose JSON schema"`. */
export const markLine = (n: number, text: string): string => `${GLYPH.manual} #${n} "${text}"`

/** `/mark <args>` on the loaded file: the file after it, and the one line to show (the confirmation, or usage). */
export const runMark = (file: ConversationFile, args: string, o: MarkOptions, at: string): { file: ConversationFile; say: string } => {
  const a = parseMark(args)
  if (!a) return { file, say: MARK_USAGE }
  const plan = planMark(file, a, o)
  if ('error' in plan) return { file, say: plan.error }
  return { file: setManual(file, plan.exchange, { ...onRow(plan.row), text: plan.text }, at), say: markLine(plan.n, plan.text) }
}
