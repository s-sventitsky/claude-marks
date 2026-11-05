// Ticket 07: publishes the inline markers to $.state, one family member per prompt row,
// written only when it changes (lib/marker-diff). register.tsx's UserMessage hook draws them.
import { atom, memberOf, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { ChainView, ConversationFile } from '../types/index'
import { liveFile } from './lib/chain'
import { markerWrites } from './lib/marker-diff'
import { markers } from './lib/markers'

/** Inline marker per prompt row, a family keyed by exchange id. Repeats register.tsx's. */
const markerA = atom({ plugin: 'marks', key: 'marker' } as const, null)

/** Marker members last written, by exchange id, as JSON. A reload starts empty and writes them all again. */
let sent: ReadonlyMap<string, string> = new Map()

/**
 * Writes the family member of each prompt row whose marker changed, so a label landing
 * redraws only the rows it touches (one big `conv` read would redraw every row on every write).
 * Live exchanges only (`chain`): a rewound one gets no marker and doesn't split a thread run.
 */
export async function publishMarkers($: EngineInterface, file: ConversationFile | null, chain: ChainView | null) {
  const live = liveFile(file, chain)
  const next = live ? markers(live) : {}
  const r = markerWrites(sent, next)
  sent = r.sent
  await Promise.all(r.writes.map(w => update($, memberOf(markerA, { requestId: w.id }), () => w.marker)))
}
