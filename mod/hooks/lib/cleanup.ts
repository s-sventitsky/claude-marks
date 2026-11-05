// Which data files and index entries are old enough to delete, and the commands that delete
// the files. Pure: the adapter (cleanup.ts beside register.tsx) lists, runs and deletes.

/** A data file not written for longer than this is deleted at a session start. */
export const KEEP_DAYS = 14
const DAY_MS = 86_400_000
/** Paths per delete command: well under cmd's 8191-character line. */
export const DELETE_BATCH = 40

/** `<session id>.json`, the only files the mod writes there. */
const DATA_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i

export type DirEntry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }

const tooOld = (at: number, now: number) => now - at > KEEP_DAYS * DAY_MS

/** Session ids whose data file was last written more than KEEP_DAYS ago, never `current`. */
export const staleSessions = (entries: readonly DirEntry[], now: number, current: string): string[] =>
  entries.flatMap(e => {
    const id = e.kind === 'file' ? DATA_FILE.exec(e.name)?.[1] : undefined
    return id && id !== current && e.mtimeMs > 0 && tooOld(e.mtimeMs, now) ? [id] : []
  })

/** $.store index keys whose `updatedAt` is more than KEEP_DAYS old, never `current`. */
export const staleIndex = (entries: readonly [string, unknown][], now: number, current: string): string[] =>
  entries.flatMap(([key, v]) => {
    const at = typeof v === 'object' && v !== null ? Date.parse(String((v as { updatedAt?: unknown }).updatedAt)) : NaN
    return key !== current && Number.isFinite(at) && tooOld(at, now) ? [key] : []
  })

/** `cmd /c del` on Windows (backslash paths), else `rm -f`; DELETE_BATCH paths a command. */
export const deleteCommands = (paths: readonly string[], windows: boolean): string[][] => {
  const out: string[][] = []
  for (let i = 0; i < paths.length; i += DELETE_BATCH) {
    const batch = paths.slice(i, i + DELETE_BATCH)
    out.push(windows ? ['cmd', '/d', '/c', 'del', '/f', '/q', ...batch.map(p => p.replace(/\//g, '\\'))] : ['rm', '-f', '--', ...batch])
  }
  return out
}
