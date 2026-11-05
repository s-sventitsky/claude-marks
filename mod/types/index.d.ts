// The claude-marks data model and its $.state contract.
// ConversationFile is the on-disk shape (<config>/claude-marks/<sessionId>.json), spec.md "Data file".
// Later tickets extend these types; they should not reshape them. A change to a stored
// value's type must bump the atom's shape tag in hooks/register.tsx.
// The contract must be self-contained (validate refuses imports); `Shaped` resolves
// inside the `declare module 'claude-code'` block below.

export type By = 'labeller' | 'user'

export type Thread = {
  /** Minted by the mod: "t1", "t2", ...; never reused. */
  id: string
  label: { text: string; by: By }
  /** null = main thread. */
  parent: string | null
  /** Ids redirected here (merges). The MVP always writes []. */
  mergedFrom: string[]
}

export type BookmarkKind = 'manual' | 'branch_point' | 'landmark'

export type Bookmark = {
  /** At most one per kind per exchange. */
  kind: BookmarkKind
  /** Manual only: a reply text row uuid; absent = the prompt row. */
  row?: string
  /** Manual: note, else ~80 chars of the message, else the gist. Auto: the labeller's `why`. */
  text: string
  dismissed?: true
}

export type LabelStatus = 'pending' | 'done' | 'failed'

export type Exchange = {
  /** Uuid of the turn's first prompt row (or first reply text row for a slash/skill turn): anchor and jump target. */
  id: string
  /** Uuids of prompts folded into the turn, id included. */
  prompts: string[]
  /** First ~80 chars of the prompt, whitespace collapsed. */
  excerpt: string
  /** null = unlabelled. */
  thread: { id: string; by: By } | null
  gist: string
  bookmarks: Bookmark[]
  /** `model` is the alias the labeller call asked for ('haiku'). */
  label: { status: LabelStatus; model?: string; tries?: number }
  // never stored: live, reachable (recomputed on load and after each append)
}

export type Correction =
  | { kind: 'bookmark_add'; exchange: string; row?: string; at: string }
  | { kind: 'bookmark_dismiss'; exchange: string; bookmark: 'branch_point' | 'landmark'; at: string }
  | { kind: 'rename' | 'move' | 'merge' | 'reparent'; at: string; [field: string]: unknown }

export type BookmarkStat = { flagged: number; dismissed: number }

export type ConversationFile = {
  schema: 1
  sessionId: string
  threads: Thread[]
  /** Conversation order. */
  exchanges: Exchange[]
  /** Newest 10 only. */
  corrections: Correction[]
  bookmarkStats: {
    landmark: BookmarkStat
    branch_point: BookmarkStat
  }
}

/**
 * Liveness and reachability of the loaded conversation's exchanges, recomputed from
 * the transcript on load and after each relevant append; never stored in the file.
 * Ids the transcript doesn't know yet (appended since the last read) are in no list:
 * live and after the last compaction. Read it through `isLive` / `isReachable` in
 * hooks/lib/chain.ts.
 */
export type ChainView = {
  /** Exchanges off the active parentUuid chain (a rewind left them): kept, hidden. */
  hidden: string[]
  /** Exchanges before the last compact_boundary: the transcript can't jump to them. */
  compacted: string[]
  /** Exchanges the gap-on-load rule left unlabelled (the band's `N unlabelled`). */
  unlabelled: string[]
}

/**
 * What the pane shows: the tree, or the reader on one exchange (ticket 05).
 * `deny`: the engine refused the last jump to it (`Jump denied: …`); dropped on j/k.
 */
export type PaneView = { kind: 'tree' } | { kind: 'reader'; id: string; deny?: string }

/**
 * The pane's state (tickets 04, 05). No shape tag: a value stored by an older build
 * (ticket 04 had `note` and no `view`) is read through `paneView` in hooks/lib/pane.ts.
 */
export type PaneState = {
  /** The exchange the cursor starts on when the tree shows (on open, and back from the reader). */
  target: string | null
  /** The exchange Enter last jumped to (this session); `/marks` reopens on it. */
  lastJump: string | null
  /** Tree or reader. Reset to the tree on each open. */
  view: PaneView
}

/**
 * Inline marker on one exchange's prompt row (ticket 07), a $.state family member keyed by
 * the exchange id. `color` is a theme key; `divider` is the text between the dashes
 * (`label`, or `└ label` for a sub-thread); `glyph` replaces the prompt's `>`.
 */
export type Marker = { color: string; divider?: string; glyph?: string }

/** One entry of the $.store index, keyed by sessionId. The store never holds the data itself. */
export type StoreIndexEntry = { file: string; updatedAt: string }

declare module 'claude-code' {
  interface PluginState {
    marks: {
      /** The loaded conversation's data file, mirrored. null before the first load. */
      conv: Shaped<ConversationFile | null>
      /** Fullscreen: the exchange at the top of the viewport (its id); null = the latest. */
      here: string | null
      /** Why the labeller stopped for this conversation (the engine refused its call); null = running. */
      labellerOff: string | null
      /** Liveness and reachability (ticket 03); null before the first transcript read. */
      chain: ChainView | null
      /** The pane: cursor target, last jump, tree or reader. */
      pane: PaneState
      /** Inline marker per prompt row (exchange id); null = none. Written only when it changes. */
      marker: StateFamily<Marker | null>
      /** The session's mode (ticket 08): true fullscreen, false the main screen, null not heard yet. Set once. */
      fullscreen: boolean | null
    }
  }
}
