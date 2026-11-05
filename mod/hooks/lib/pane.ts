// The pane's decisions: where it opens, what Enter does, what a scroll result means. Pure.
import type { ConversationFile, Exchange, PaneView } from '../../types/index'

export const PANE_ID = 'marks'
/** Body rows asked for while the pane sits inline above the prompt. */
export const PANE_ROWS = 14
/** Below this many body columns the tree is narrow, as it is inline. */
export const NARROW_COLUMNS = 60

export const REASON = {
  compacted: 'Before the last compaction: not on screen, so the reader shows it.',
  mainScreen: 'Enter opens the reader. Jumping works in fullscreen.',
} as const

export type Enter = { kind: 'jump'; to: string } | { kind: 'reader'; id: string; reason: string }

export type EnterOptions = {
  /** From the viewport; undefined while unknown, which tries the jump. */
  fullscreen: boolean | undefined
  /** Absent: every exchange is reachable. Ticket 03's `isReachable(view, id, true)` from chain.ts. */
  isReachable?: (x: Exchange) => boolean
}

/** Enter on a row whose target is exchange `id`: jump to its anchor, or the reader with why not. */
export const enterAction = (file: ConversationFile, id: string, o: EnterOptions): Enter | undefined => {
  const x = file.exchanges.find(e => e.id === id)
  if (!x) return undefined
  if (o.fullscreen === false) return { kind: 'reader', id, reason: REASON.mainScreen }
  if (o.isReachable && !o.isReachable(x)) return { kind: 'reader', id, reason: REASON.compacted }
  return { kind: 'jump', to: x.id }
}

/** What `$.ui.scroll` answered: close and remember, or stay open with the reason. */
export const afterJump = (r: { deny?: string }): { close: true } | { close: false; note: string } =>
  r.deny ? { close: false, note: `Jump denied: ${r.deny}` } : { close: true }

/** `/marks`: the exchange last jumped to while it is still shown, else the latest live one. */
export const openTarget = (file: ConversationFile | null, lastJump: string | null | undefined, isLive?: (x: Exchange) => boolean): string | undefined => {
  const live = file ? (isLive ? file.exchanges.filter(isLive) : file.exchanges) : []
  if (lastJump && live.some(x => x.id === lastJump)) return lastJump
  return live.at(-1)?.id
}

/** A band click: the band's exchange (`here` in fullscreen, else the latest), as `band()` picks it. */
export const bandTarget = (file: ConversationFile | null, o: { fullscreen: boolean; hereId?: string | null }): string | undefined => {
  const all = file?.exchanges ?? []
  if (o.fullscreen && o.hereId && all.some(x => x.id === o.hereId)) return o.hereId
  return all.at(-1)?.id
}

/** `/marks` takes no arguments in the MVP (later `relabel`, `find`). */
export const marksUsage = (args: string): string | undefined => (args.trim() ? 'usage: /marks' : undefined)

export const isNarrow = (placement: 'dock' | 'inline', bodyColumns: number): boolean => placement === 'inline' || bodyColumns < NARROW_COLUMNS

/** One key a view draws. With a `hotkey`, a plain Button draws it as `<hotkey>: <label>`. */
export type KeyHint = { label: string; hotkey?: string; enabled: boolean }

/**
 * Every key the tree uses, drawn always (dim where inert): the ring's arrows and Tab,
 * Enter on the focused Button, `p` (the reader), Esc via closeOnEscape.
 * `a`, `v`, `/` are reserved and left unbound; left arrow is the engine's (agents list).
 */
export const treeKeys = (o: { fullscreen: boolean | undefined }): KeyHint[] => [
  { label: '↑↓ move', enabled: true },
  { label: o.fullscreen === false ? 'Enter read' : 'Enter jump', enabled: true },
  { label: 'read', hotkey: 'p', enabled: true },
  { label: 'Esc close', enabled: true },
]

/**
 * The reader's keys, each drawn always: `j`/`k` step through the family, `g` jumps,
 * `m` opens the bookmark menu (ticket 06; it acts on any shown exchange), Esc goes back to the tree. `n` stays unbound.
 */
export const readerKeys = (m: { prev?: string; next?: string; canJump: boolean }): KeyHint[] => [
  { label: 'next', hotkey: 'j', enabled: m.next !== undefined },
  { label: 'previous', hotkey: 'k', enabled: m.prev !== undefined },
  { label: 'jump', hotkey: 'g', enabled: m.canJump },
  { label: 'bookmark', hotkey: 'm', enabled: true },
  { label: 'Esc back', enabled: true },
]

/** The pane's view from a stored PaneState, read defensively (no shape tag): anything unexpected is the tree. */
export const paneView = (pane: unknown): PaneView => {
  const v = pane && typeof pane === 'object' ? (pane as { view?: unknown }).view : undefined
  if (!v || typeof v !== 'object') return { kind: 'tree' }
  const r = v as { kind?: unknown; id?: unknown; deny?: unknown; menu?: unknown }
  if (r.kind !== 'reader' || typeof r.id !== 'string') return { kind: 'tree' }
  return {
    kind: 'reader',
    id: r.id,
    ...(typeof r.deny === 'string' ? { deny: r.deny } : {}),
    ...(r.menu === 'pick' || r.menu === 'note' ? { menu: r.menu } : {}),
  }
}

/**
 * `ui.close` on the pane: the person's close (Esc, the × mark) while the reader shows is
 * refused and the tree comes back (the reader, from its bookmark menu); any other close goes through.
 */
export const onPaneClose = (view: PaneView, origin: 'plugin' | 'person' | 'unload'): 'to-tree' | 'to-reader' | 'pass' =>
  view.kind !== 'reader' || origin !== 'person' ? 'pass' : view.menu ? 'to-reader' : 'to-tree'

/**
 * `p` in the tree: the exchange of the focused row (a header's is its first exchange).
 * No row focused (the ring on a key, or not heard yet): `fallback`, the cursor's start.
 */
export const readTarget = (rows: readonly { key: string; target: string }[], focused: string | null | undefined, fallback: string | undefined): string | undefined =>
  rows.find(r => r.key === focused)?.target || fallback
