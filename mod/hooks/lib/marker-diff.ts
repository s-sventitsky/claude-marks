// Which inline markers to write to $.state: only the prompt rows whose marker changed, so a
// label landing redraws only the rows it touches. Pure.
import type { Marker } from '../../types/index'

/** One family member write: the exchange's new marker, or null to clear it. */
export type MarkerWrite = { id: string; marker: Marker | null }

/**
 * The writes that take the published markers to `next`. `sent` is what was written last, by
 * exchange id, as JSON; the result's `sent` is what it will be after these writes (a new map).
 */
export const markerWrites = (
  sent: ReadonlyMap<string, string>,
  next: Readonly<Record<string, Marker>>,
): { writes: MarkerWrite[]; sent: Map<string, string> } => {
  const after = new Map(sent)
  const writes: MarkerWrite[] = []
  for (const [id, marker] of Object.entries(next)) {
    const json = JSON.stringify(marker)
    if (after.get(id) === json) continue
    after.set(id, json)
    writes.push({ id, marker })
  }
  for (const id of sent.keys()) {
    if (id in next) continue
    after.delete(id)
    writes.push({ id, marker: null })
  }
  return { writes, sent: after }
}
