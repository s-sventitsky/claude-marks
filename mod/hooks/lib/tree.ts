// The pane's tree as rows of styled text: threads, sub-threads and exchanges. Pure.
import type { BookmarkKind, ConversationFile, Exchange, Thread } from '../../types/index'
import { GLYPH, colorOf, glyphs, type Segment } from './band'
import { currentThread, liveExchanges, type ChainOptions } from './model'
import { exchangeKey, threadKey } from './pane'

/**
 * ChainOptions as the tree takes them. `unlabelled`: the exchanges the gap rule left are
 * the Unlabelled section; every other unlabelled one is pending. Absent: none left.
 */
export type TreeOptions = ChainOptions & {
  /** Body columns the rows must fit in. */
  columns: number
  /** Inline, or under 60 body columns: counts shrink to `<k>`. */
  narrow: boolean
  /** The exchange Enter last jumped to: its row has `›`. */
  lastJump?: string | null
  /** The band's exchange: its row draws bold. */
  bandId?: string | null
}

export type TreeRow = {
  /** Unique, stable Button key: `th:<thread id>`, `th:unlabelled` or `ex:<exchange id>`. */
  key: string
  kind: 'main' | 'sub' | 'unlabelled' | 'exchange'
  /** The exchange Enter acts on: the row's own, or a header's first exchange. */
  target: string
  segments: Segment[]
}

/** One line, cut to `w` columns with an ellipsis. */
export const fit = (text: string, w: number): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= w ? one : one.slice(0, Math.max(0, w - 1)) + '…'
}

const KINDS: readonly BookmarkKind[] = ['manual', 'landmark', 'branch_point']
/** Columns of the glyph slot: up to two glyphs. */
const SLOT = 2

/** The family key of the Unlabelled section. */
export const UNLABELLED = 'unlabelled'

/** `<k> ex  ◆1 ◇3 ↳1`, or `<k>` when narrow. */
const counts = (xs: readonly Exchange[], narrow: boolean): string => {
  if (narrow) return String(xs.length)
  const c: Record<BookmarkKind, number> = { manual: 0, landmark: 0, branch_point: 0 }
  for (const x of xs) for (const b of x.bookmarks) if (!b.dismissed) c[b.kind]++
  const marks = KINDS.filter(k => c[k]).map(k => `${GLYPH[k]}${c[k]}`)
  return [`${xs.length} ex`, ...(marks.length ? [marks.join(' ')] : [])].join('  ')
}

/** How the tree lays out live exchanges: numbers, each one's thread, families in order. */
export type TreeLayout = {
  /** Live exchanges, conversation order. */
  shown: Exchange[]
  /** 1-based position among live exchanges: the number the tree shows. */
  n: Map<string, number>
  /** Unlabelled exchanges the labeller will still label (`…`); they show in the current thread. */
  pending: Set<string>
  /** The thread an exchange shows in: its own, the current one while pending, else none (Unlabelled). */
  threadOf: (x: Exchange) => Thread | undefined
  /** Family keys (a main thread's id, or UNLABELLED) in order of their first exchange. */
  order: string[]
  /** A main thread's and its subs' exchanges, in conversation order (tree order). */
  family: Map<string, Exchange[]>
  /** Each thread's own exchanges. */
  own: Map<string, Exchange[]>
}

export const layoutFamilies = (file: ConversationFile, o: Pick<TreeOptions, 'isLive' | 'unlabelled'>): TreeLayout => {
  const shown = liveExchanges(file, o.isLive)
  const n = new Map(shown.map((x, i) => [x.id, i + 1]))
  const threads = new Map(file.threads.map(t => [t.id, t]))
  // The gap rule (chain.ts gapRun) decides; the tree only reads its record.
  const left = new Set(o.unlabelled ?? [])
  const pending = new Set(shown.filter(x => !x.thread && !left.has(x.id)).map(x => x.id))
  // Pending ones show in the current thread: that of the latest live labelled exchange.
  const current = currentThread({ ...file, exchanges: shown })
  const threadOf = (x: Exchange) => (x.thread ? threads.get(x.thread.id) : pending.has(x.id) ? current : undefined)

  // Families (a main thread and its subs) in order of their first exchange.
  const order: string[] = []
  const family = new Map<string, Exchange[]>()
  const own = new Map<string, Exchange[]>()
  for (const x of shown) {
    const t = threadOf(x)
    const m = t ? t.parent ?? t.id : UNLABELLED
    if (!family.has(m)) {
      order.push(m)
      family.set(m, [])
    }
    family.get(m)?.push(x)
    if (!t) continue
    if (!own.has(t.id)) own.set(t.id, [])
    own.get(t.id)?.push(x)
  }
  return { shown, n, pending, threadOf, order, family, own }
}

export const layoutTree = (file: ConversationFile, o: TreeOptions): TreeRow[] => {
  const { shown, n, pending, threadOf, order, family, own } = layoutFamilies(file, o)
  const digits = String(shown.length).length
  const threads = new Map(file.threads.map(t => [t.id, t]))

  const header = (t: Thread, xs: readonly Exchange[]): TreeRow => {
    const sub = t.parent !== null
    const color = colorOf(file, t.id)
    const meta = `  ${counts(xs, o.narrow)}`
    const room = o.columns - meta.length
    const label: Segment = sub ? { text: ` └ ${fit(t.label.text, room - 3)}`, color } : { text: fit(t.label.text, room), color, bold: true }
    return { key: threadKey(t.id), kind: sub ? 'sub' : 'main', target: xs[0]?.id ?? '', segments: [label, { text: meta, dim: true }] }
  }

  const exRow = (x: Exchange, indent: string): TreeRow => {
    const jumped = o.lastJump === x.id
    const prefix = `${indent}${jumped ? '›' : ' '}${String(n.get(x.id)).padStart(digits)} `
    const segs: Segment[] = [jumped ? { text: prefix, bold: true } : { text: prefix, dim: true }]
    const g = pending.has(x.id) ? '…' : glyphs(x, SLOT)
    if (pending.has(x.id)) segs.push({ text: g, dim: true })
    else if (g) segs.push(x.thread ? { text: g, color: colorOf(file, x.thread.id) } : { text: g, dim: true })
    if (g.length < SLOT) segs.push({ text: ' '.repeat(SLOT - g.length) })
    const text = ` ${fit(x.gist || x.excerpt, o.columns - prefix.length - SLOT - 1)}`
    segs.push(o.bandId === x.id ? { text, bold: true } : { text })
    return { key: exchangeKey(x.id), kind: 'exchange', target: x.id, segments: o.isReachable && !o.isReachable(x) ? segs.map(s => ({ ...s, dim: true })) : segs }
  }

  const rows: TreeRow[] = []
  for (const m of order) {
    const xs = family.get(m) ?? []
    if (m === UNLABELLED) {
      const meta = `  ${xs.length}`
      rows.push({ key: threadKey(UNLABELLED), kind: 'unlabelled', target: xs[0]?.id ?? '', segments: [{ text: fit('Unlabelled', o.columns - meta.length), dim: true }, { text: meta, dim: true }] })
      for (const x of xs) rows.push(exRow(x, ''))
      continue
    }
    rows.push(header(threads.get(m) as Thread, xs))
    const seen = new Set<string>()
    for (const x of xs) {
      const t = threadOf(x) as Thread
      if (t.parent !== null && !seen.has(t.id)) {
        seen.add(t.id)
        rows.push(header(t, own.get(t.id) ?? []))
      }
      rows.push(exRow(x, t.parent !== null ? '   ' : ''))
    }
  }
  return rows
}
