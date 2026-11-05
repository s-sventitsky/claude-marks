// Inline markers on transcript prompt rows: thread dividers and prompt glyphs. Pure.
// Spec "Inline markers".
import type { ConversationFile } from '../../types/index'
import { GLYPH, colorOf } from './band'
import type { Marker } from '../../types/index'

export type { Marker }

/**
 * The marker of each exchange that carries one, by exchange id (its prompt row uuid).
 * A divider sits on the first exchange of a thread run: where the thread differs from
 * the nearest earlier labelled exchange's (unlabelled ones in between do not split a run).
 * The glyph is the first bookmark not dismissed.
 * TODO(03): walk live exchanges only once liveness lands; every exchange counts as live.
 */
export const markers = (file: ConversationFile): Record<string, Marker> => {
  const out: Record<string, Marker> = {}
  let prev: string | undefined
  for (const ex of file.exchanges) {
    const tid = ex.thread?.id
    const thread = tid ? file.threads.find(t => t.id === tid) : undefined
    const opens = thread !== undefined && thread.id !== prev
    if (tid) prev = tid
    const b = ex.bookmarks.find(x => !x.dismissed)
    if (!opens && !b) continue
    const m: Marker = { color: colorOf(file, tid ?? prev ?? '') }
    if (opens) m.divider = thread.parent ? `└ ${thread.label.text}` : thread.label.text
    if (b) m.glyph = GLYPH[b.kind]
    out[ex.id] = m
  }
  return out
}

/** `── <text> ───` filling `cols - 1` columns; a head too long is cut with an ellipsis. */
export const dividerLine = (text: string, cols: number): string => {
  const w = Math.max(1, cols - 1)
  const head = `── ${text} `
  if (head.length > w) return head.slice(0, w - 1).trimEnd() + '…'
  return head + '─'.repeat(w - head.length)
}
