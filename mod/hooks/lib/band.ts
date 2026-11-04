// What the band above the prompt and the status line say. Pure.
import type { ConversationFile } from '../../types/index'

/**
 * The band's one line, or undefined to draw nothing. Ticket 01: `#n/N` for the
 * latest exchange. Liveness (ticket 03) and thread labels (ticket 02) extend it.
 */
export const bandLine = (file: ConversationFile | null): string | undefined => {
  const n = file?.exchanges.length ?? 0
  return n === 0 ? undefined : `#${n}/${n}`
}

/** The status-line hint: `/marks · N threads`. */
export const statusLine = (file: ConversationFile | null): string => {
  const n = file?.threads.length ?? 0
  return `/marks · ${n} ${n === 1 ? 'thread' : 'threads'}`
}
