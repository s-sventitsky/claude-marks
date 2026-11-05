// Ticket 03: reading the loaded conversation's transcript for the transcript pass (whole,
// once per load) and for tail placement (what was appended since). register.tsx folds the
// rows into the file; this module only reads.
import type { EngineInterface } from 'claude-code'
import { emptyTranscript, ingest, type Transcript } from './lib/jsonl'
import { findTranscript, readTail, readTranscript, type ReadStats } from './lib/transcript'
import { log } from './log'

/** A conversation's transcript as last read. `path` is absent when none was read (`t` is then empty). */
export type LoadedTranscript = { sessionId: string; path?: string; t: Transcript; size: number }

/** One debug line on how a read went. */
export function logRead($: EngineInterface, what: string, s: ReadStats) {
  log($, `${what}: ${s.via}${s.command ? ` (${s.command})` : ''}, ${s.size} bytes, ${s.pieces} pieces, ${s.ms} ms`)
}

/** Finds and reads the whole transcript. Not found, or the read failed: an empty one, logged. */
export async function readWhole($: EngineInterface, config: string | undefined, sessionId: string): Promise<LoadedTranscript> {
  if (config) {
    try {
      const path = await findTranscript($, config, sessionId)
      if (path) {
        const t = emptyTranscript()
        const stats = await readTranscript($, path, line => ingest(t, line))
        logRead($, 'transcript', stats)
        return { sessionId, path, t, size: stats.size }
      }
      log($, `no transcript for ${sessionId}`)
    } catch (err) {
      log($, `transcript read failed: ${String(err)}`)
    }
  }
  return { sessionId, t: emptyTranscript(), size: 0 }
}

/** Reads what was appended to `tr`'s file since its last read into `tr.t` (the whole file again when the tail can't be trusted). */
export async function readNew($: EngineInterface, tr: LoadedTranscript & { path: string }): Promise<ReadStats> {
  const r = await readTail($, tr.path, tr.size, line => ingest(tr.t, line))
  const stats = r === 'reread' ? await readTranscript($, tr.path, line => ingest(tr.t, line)) : r
  tr.size = stats.size
  return stats
}
