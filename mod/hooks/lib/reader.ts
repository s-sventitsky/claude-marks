// The reader: one exchange's prompt and reply text in the pane (ticket 05). Pure.
import type { ThemeKey } from 'claude-code'
import type { ConversationFile, Exchange } from '../../types/index'
import { GLYPH, colorOf, type Segment } from './band'
import type { ExchangeRows } from './rows'
import { REASON } from './pane'
import { UNLABELLED, groupTree } from './tree'

export type ReaderOptions = {
  /** From the viewport; undefined while unknown. */
  fullscreen: boolean | undefined
  /** Hidden when false. Absent: all live. */
  isLive?: (x: Exchange) => boolean
  /** The gap rule's record (ChainView.unlabelled), as the tree takes it. */
  unlabelled?: readonly string[]
  /** False: before the last compaction. Absent: all reachable. */
  isReachable?: (x: Exchange) => boolean
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
  /** Position in the main thread's family (1-based) and the family's size. */
  i: number
  k: number
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
  const fam = g.family.get(t ? t.parent ?? t.id : UNLABELLED) ?? []
  const i = fam.findIndex(y => y.id === id)
  const color = t ? colorOf(file, t.id) : undefined
  let path: Segment[]
  if (!t) path = [{ text: 'Unlabelled', dim: true }]
  else {
    const main = t.parent ? file.threads.find(m => m.id === t.parent) : t
    path = [{ text: main?.label.text ?? '', color, bold: true }]
    if (t.parent) path.push({ text: ` › ${t.label.text}`, color })
  }
  const reachable = o.isReachable ? o.isReachable(x) : true
  const why = o.fullscreen === false ? REASON.mainScreen : reachable ? null : REASON.compacted
  return {
    id,
    path,
    n,
    i: i + 1,
    k: fam.length,
    reason: why ?? o.deny ?? null,
    canJump: why === null,
    prev: fam[i - 1]?.id,
    next: fam[i + 1]?.id,
    bookmarks: x.bookmarks.filter(b => !b.dismissed).map(b => ({ glyph: GLYPH[b.kind], ...(color ? { color } : {}), text: b.text })),
    prompts: o.rows?.prompts.length ? [...o.rows.prompts] : [x.excerpt],
    replies: (o.rows?.replies ?? []).map(r => r.text),
  }
}
