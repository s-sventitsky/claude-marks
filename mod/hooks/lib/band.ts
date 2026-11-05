// What the band above the prompt and the status line say. Pure.
import type { ThemeKey } from 'claude-code'
import type { BookmarkKind, ConversationFile, Exchange } from '../../types/index'
import { currentThread } from './model'

/** Main threads take these by index among main threads, wrapping. Spec "UI". */
export const PALETTE: readonly ThemeKey[] = ['suggestion', 'success', 'warning', 'merged', 'planMode', 'autoAccept', 'ide', 'permission']

export const GLYPH: Record<BookmarkKind, string> = { manual: '◆', landmark: '◇', branch_point: '↳' }

export const HINT = 'click or /marks'

/** A thread's colour: its main thread's palette slot. */
export const colorOf = (file: ConversationFile, threadId: string): ThemeKey => {
  const t = file.threads.find(x => x.id === threadId)
  const mainId = t?.parent ?? threadId
  const i = file.threads.filter(x => x.parent === null).findIndex(x => x.id === mainId)
  return PALETTE[Math.max(i, 0) % PALETTE.length] as ThemeKey
}

/** The exchange's bookmark glyphs, dismissed ones left out. */
export const glyphs = (ex: Exchange): string =>
  ex.bookmarks
    .filter(b => !b.dismissed)
    .map(b => GLYPH[b.kind])
    .join('')

export type Segment = { text: string; color?: ThemeKey; bold?: true; dim?: true }

export type BandOptions = {
  /** Fullscreen: `here` names the exchange at the top of the viewport. Else `latest`. */
  fullscreen: boolean
  /** The exchange on screen, fullscreen only; unknown or absent means the latest. */
  hereId?: string | null
  /** `click or /marks`, or what replaces it (`labeller off: <reason>`, `N unlabelled`). */
  hint: string
}

/**
 * The band's line as coloured segments: `● Main › Sub · here #n/N ◇ · hint`.
 * `○ labelling… · hint` before the first label; undefined (draw nothing) with no exchanges.
 * N counts all exchanges until liveness lands (ticket 03).
 */
export const band = (file: ConversationFile | null, o: BandOptions): Segment[] | undefined => {
  const all = file?.exchanges ?? []
  if (!file || !all.length) return undefined
  const hint: Segment = { text: ` · ${o.hint}`, dim: true }
  const at = o.fullscreen && o.hereId ? all.findIndex(x => x.id === o.hereId) : -1
  const i = at >= 0 ? at : all.length - 1
  const ex = all[i] as Exchange
  const tid = ex.thread?.id ?? currentThread(file, ex.id)?.id ?? currentThread(file)?.id
  const thread = file.threads.find(t => t.id === tid)
  if (!thread) return [{ text: '○ labelling…', dim: true }, hint]
  const color = colorOf(file, thread.id)
  const main = thread.parent ? file.threads.find(t => t.id === thread.parent) : thread
  const out: Segment[] = [
    { text: '● ', color },
    { text: main?.label.text ?? '', color, bold: true },
  ]
  if (thread.parent) out.push({ text: ` › ${thread.label.text}`, color })
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
