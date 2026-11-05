// The reader: one exchange's prompt and reply text in the pane (ticket 05). Pure.
import type { ThemeKey } from 'claude-code'
import type { ConversationFile } from '../../types/index'
import { GLYPH, colorOf, threadPath, type Segment } from './band'
import type { ViewOptions } from './model'
import type { ExchangeRows } from './rows'
import { REASON } from './pane'
import { UNLABELLED, groupTree } from './tree'

export type ReaderOptions = ViewOptions & {
  /** Why the engine refused the last jump to this exchange (`Jump denied: …`). */
  deny?: string | null
  /** The exchange's entry in the row index (the transcript pass fills it, compacted ones too). */
  rows?: ExchangeRows
}

export type ReaderBookmark = { glyph: string; color?: ThemeKey; text: string }

export type ReaderModel = {
  id: string
  /** The thread path: `Main`, `Main › Sub`, or a dim `Unlabelled`. */
  path: Segment[]
  /** The number the tree shows. */
  n: number
  /** Position in the main thread's family (1-based). */
  position: number
  /** How many exchanges the family has. */
  familySize: number
  /** Why a jump isn't possible (or was refused); null when it is. */
  reason: string | null
  /** `g` can act: fullscreen (or unknown) and after the last compaction. */
  canJump: boolean
  /** The previous / next exchange in the family: `k` / `j`. Undefined at either end. */
  prev?: string
  next?: string
  /** Bookmarks not dismissed, in the file's order. */
  bookmarks: ReaderBookmark[]
  /** The prompt texts (folded ones too); the excerpt while the index has none. */
  prompts: string[]
  /** Reply text blocks, drawn as Markdown. */
  replies: string[]
}

export const readerModel = (file: ConversationFile, id: string, o: ReaderOptions): ReaderModel | undefined => {
  const g = groupTree(file, o)
  const x = g.shown.find(y => y.id === id)
  const n = g.n.get(id)
  if (!x || n === undefined) return undefined
  const t = g.threadOf(x)
  const family = g.family.get(t ? t.parent ?? t.id : UNLABELLED) ?? []
  const i = family.findIndex(y => y.id === id)
  const color = t ? colorOf(file, t.id) : undefined
  const path: Segment[] = t && color ? threadPath(file, t, color) : [{ text: 'Unlabelled', dim: true }]
  const reachable = o.isReachable ? o.isReachable(x) : true
  const why = o.fullscreen === false ? REASON.mainScreen : reachable ? null : REASON.compacted
  return {
    id,
    path,
    n,
    position: i + 1,
    familySize: family.length,
    reason: why ?? o.deny ?? null,
    canJump: why === null,
    prev: family[i - 1]?.id,
    next: family[i + 1]?.id,
    bookmarks: x.bookmarks.filter(b => !b.dismissed).map(b => ({ glyph: GLYPH[b.kind], ...(color ? { color } : {}), text: b.text })),
    prompts: o.rows?.prompts.length ? [...o.rows.prompts] : [x.excerpt],
    replies: (o.rows?.replies ?? []).map(r => r.text),
  }
}
