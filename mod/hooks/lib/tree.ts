// The pane's tree as rows of styled text: threads, sub-threads and exchanges. Pure.
import type { BookmarkKind, ConversationFile, Exchange, Thread } from '../../types/index'
import { GLYPH, colorOf, type Segment } from './band'

export type TreeOptions = {
  /** Body columns the rows must fit in. */
  columns: number
  /** Inline, or under 60 body columns: counts shrink to `<k>`. */
  narrow: boolean
  /** The exchange Enter last jumped to: its row has `›`. */
  lastJump?: string | null
  /** The band's exchange: its row draws bold. */
  bandId?: string | null
  /** Unreachable rows draw dim (and every row on the main screen). Absent: all reachable. */
  isReachable?: (x: Exchange) => boolean
  /** Hidden when false. Absent: all live. Ticket 03's `isLive(view, id)` from chain.ts. */
  isLive?: (x: Exchange) => boolean
  /**
   * The gap rule's record (ChainView.unlabelled): exchanges the load left unlabelled.
   * Given, every other unlabelled exchange is pending. Absent: pendingIds' run rule.
   */
  unlabelled?: readonly string[]
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

/** The first two live bookmark glyphs. */
const glyphs = (x: Exchange): string =>
  x.bookmarks
    .filter(b => !b.dismissed)
    .slice(0, SLOT)
    .map(b => GLYPH[b.kind])
    .join('')

/** A trailing unlabelled run this long or shorter is queued for the labeller; longer waits. Spec "Gaps on load". */
export const GAP_MAX = 10

/**
 * Unlabelled exchanges the labeller will still label: the run after the last
 * labelled one, when it is 10 or shorter. The rest of the unlabelled ones are
 * the Unlabelled group. Used when the gap rule's record (`TreeOptions.unlabelled`) isn't given.
 */
export const pendingIds = (live: readonly Exchange[]): Set<string> => {
  let i = live.length
  while (i > 0 && live[i - 1]?.thread === null) i--
  const run = live.slice(i)
  return new Set(run.length <= GAP_MAX ? run.map(x => x.id) : [])
}

const UNLABELLED = 'unlabelled'

/** `<k> ex  ◆1 ◇3 ↳1`, or `<k>` when narrow. */
const counts = (xs: readonly Exchange[], narrow: boolean): string => {
  if (narrow) return String(xs.length)
  const c: Record<BookmarkKind, number> = { manual: 0, landmark: 0, branch_point: 0 }
  for (const x of xs) for (const b of x.bookmarks) if (!b.dismissed) c[b.kind]++
  const marks = KINDS.filter(k => c[k]).map(k => `${GLYPH[k]}${c[k]}`)
  return [`${xs.length} ex`, ...(marks.length ? [marks.join(' ')] : [])].join('  ')
}

export const layoutTree = (file: ConversationFile, o: TreeOptions): TreeRow[] => {
  const shown = o.isLive ? file.exchanges.filter(o.isLive) : file.exchanges
  const n = new Map(shown.map((x, i) => [x.id, i + 1]))
  const digits = String(shown.length).length
  const threads = new Map(file.threads.map(t => [t.id, t]))
  const left = o.unlabelled
  const pending = left ? new Set(shown.filter(x => !x.thread && !left.includes(x.id)).map(x => x.id)) : pendingIds(shown)
  // The current thread: that of the latest live labelled exchange. Pending ones show in it.
  let current: Thread | undefined
  for (let i = shown.length - 1; i >= 0 && !current; i--) {
    const id = shown[i]?.thread?.id
    if (id) current = threads.get(id)
  }
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

  const header = (t: Thread, xs: readonly Exchange[]): TreeRow => {
    const sub = t.parent !== null
    const color = colorOf(file, t.id)
    const meta = `  ${counts(xs, o.narrow)}`
    const room = o.columns - meta.length
    const label: Segment = sub ? { text: ` └ ${fit(t.label.text, room - 3)}`, color } : { text: fit(t.label.text, room), color, bold: true }
    return { key: `th:${t.id}`, kind: sub ? 'sub' : 'main', target: xs[0]?.id ?? '', segments: [label, { text: meta, dim: true }] }
  }

  const exRow = (x: Exchange, indent: string): TreeRow => {
    const jumped = o.lastJump === x.id
    const prefix = `${indent}${jumped ? '›' : ' '}${String(n.get(x.id)).padStart(digits)} `
    const segs: Segment[] = [jumped ? { text: prefix, bold: true } : { text: prefix, dim: true }]
    const g = pending.has(x.id) ? '…' : glyphs(x)
    if (pending.has(x.id)) segs.push({ text: g, dim: true })
    else if (g) segs.push({ text: g, color: colorOf(file, (x.thread as { id: string }).id) })
    if (g.length < SLOT) segs.push({ text: ' '.repeat(SLOT - g.length) })
    const text = ` ${fit(x.gist || x.excerpt, o.columns - prefix.length - SLOT - 1)}`
    segs.push(o.bandId === x.id ? { text, bold: true } : { text })
    return { key: `ex:${x.id}`, kind: 'exchange', target: x.id, segments: o.isReachable && !o.isReachable(x) ? segs.map(s => ({ ...s, dim: true })) : segs }
  }

  const rows: TreeRow[] = []
  for (const m of order) {
    const xs = family.get(m) ?? []
    if (m === UNLABELLED) {
      const meta = `  ${xs.length}`
      rows.push({ key: `th:${UNLABELLED}`, kind: 'unlabelled', target: xs[0]?.id ?? '', segments: [{ text: fit('Unlabelled', o.columns - meta.length), dim: true }, { text: meta, dim: true }] })
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
