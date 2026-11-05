// What the band above the prompt and the status line say. Pure.
import type { ThemeKey } from 'claude-code'
import type { BookmarkKind, ConversationFile, Exchange, Thread } from '../../types/index'
import { currentThread, mainOf, threadById } from './model'

/** Main threads take these by index among main threads, wrapping. Spec "UI". */
export const PALETTE: readonly ThemeKey[] = ['suggestion', 'success', 'warning', 'merged', 'planMode', 'autoAccept', 'ide', 'permission']

export const GLYPH: Record<BookmarkKind, string> = { manual: '◆', landmark: '◇', branch_point: '↳' }

export const HINT = 'click or /marks'

/** A thread's colour: its main thread's palette slot. */
export const colorOf = (file: ConversationFile, threadId: string): ThemeKey => {
  const mainId = threadById(file, threadId)?.parent ?? threadId
  const i = file.threads.filter(x => x.parent === null).findIndex(x => x.id === mainId)
  return PALETTE[Math.max(i, 0) % PALETTE.length] as ThemeKey
}

/** The exchange's bookmark glyphs, dismissed ones left out; the first `max` when given. */
export const glyphs = (ex: Exchange, max?: number): string =>
  ex.bookmarks
    .filter(b => !b.dismissed)
    .slice(0, max)
    .map(b => GLYPH[b.kind])
    .join('')

export type Segment = { text: string; color?: ThemeKey; bold?: true; dim?: true }

/** A thread's path as segments: its main thread's label (bold), then ` › <sub label>` for a sub-thread. */
export const threadPath = (file: ConversationFile, t: Thread, color: ThemeKey): Segment[] => {
  const out: Segment[] = [{ text: mainOf(file, t)?.label.text ?? '', color, bold: true }]
  if (t.parent) out.push({ text: ` › ${t.label.text}`, color })
  return out
}

/** Which exchange the band is on. */
export type Here = {
  /** Fullscreen: `here` names the exchange at the top of the viewport. Else `latest`. */
  fullscreen: boolean
  /** The exchange on screen, fullscreen only; unknown or absent means the latest. */
  hereId?: string | null
}

/** The band's exchange as an index into `exchanges`: `here` in fullscreen while known, else the latest; -1 with none. */
export const bandIndex = (exchanges: readonly Exchange[], o: Here): number => {
  const at = o.fullscreen && o.hereId ? exchanges.findIndex(x => x.id === o.hereId) : -1
  return at >= 0 ? at : exchanges.length - 1
}

export type BandOptions = Here & {
  /** `click or /marks`, or what replaces it (`labeller off: <reason>`, `N unlabelled`). */
  hint: string
}

/**
 * The band's line as coloured segments: `● Main › Sub · here #n/N ◇ · hint`.
 * `○ labelling… · hint` before the first label; undefined (draw nothing) with no exchanges.
 * Callers pass the live view (liveView in chain.ts), so N counts live exchanges.
 */
export const band = (file: ConversationFile | null, o: BandOptions): Segment[] | undefined => {
  const all = file?.exchanges ?? []
  if (!file || !all.length) return undefined
  const hint: Segment = { text: ` · ${o.hint}`, dim: true }
  const i = bandIndex(all, o)
  const ex = all[i] as Exchange
  const tid = ex.thread?.id ?? currentThread(file, ex.id)?.id ?? currentThread(file)?.id
  const thread = tid === undefined ? undefined : threadById(file, tid)
  if (!thread) return [{ text: '○ labelling…', dim: true }, hint]
  const color = colorOf(file, thread.id)
  const out: Segment[] = [{ text: '● ', color }, ...threadPath(file, thread, color)]
  out.push({ text: ` · ${o.fullscreen ? 'here' : 'latest'} #${i + 1}/${all.length}`, dim: true })
  const g = glyphs(ex)
  if (g) out.push({ text: ` ${g}`, color })
  out.push(hint)
  return out
}

/** The status-line hint: `/marks · N threads`. */
export const statusLine = (file: ConversationFile | null): string => {
  const n = file?.threads.length ?? 0
  return `/marks · ${n} ${n === 1 ? 'thread' : 'threads'}`
}
