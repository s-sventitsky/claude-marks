// The data file on disk (the record) and its $.store index entry: loading a conversation's
// file, and writing it back debounced after each change.
import { atom, read } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'
import type { ConversationFile, StoreIndexEntry } from '../types/index'
import { emptyFile, parseFile } from './lib/model'
import { dataPath } from './lib/paths'
import { log } from './log'

/** Repeats register.tsx's; bump the shape tag with it. */
const fileA = atom({ plugin: 'marks', key: 'conv' } as const, null, { shape: 'conv-1' })

const FLUSH_MS = 1000

/** The file to write when the debounce fires: the loaded conversation, and the config dir. */
export type Pending = () => { file: ConversationFile | null; config: string | undefined }

let flushTimer: Timer | null = null
let dirty = false

/** $.state first (it survives a hot reload and may be newer than the file), then the file, else empty. */
export async function loadFile(
  $: EngineInterface,
  config: string | undefined,
  sessionId: string,
): Promise<{ file: ConversationFile; fromState: boolean }> {
  const held = await read($, fileA)
  if (held && held.sessionId === sessionId) return { file: held, fromState: true }
  if (config) {
    const path = dataPath(config, sessionId)
    const text = (await $.fs.exists(path)) ? await $.fs.read(path).catch(() => undefined) : undefined
    const parsed = typeof text === 'string' ? parseFile(text, sessionId) : undefined
    if (parsed) return { file: parsed, fromState: false }
  }
  return { file: emptyFile(sessionId), fromState: false }
}

/** Writes `file` and its index entry now if a change is waiting; a failed write stays waiting. */
export async function flush($: EngineInterface, file: ConversationFile | null, config: string | undefined) {
  flushTimer?.cancel()
  flushTimer = null
  if (!dirty || !file || !config) return
  dirty = false
  const path = dataPath(config, file.sessionId)
  try {
    await $.fs.write(path, JSON.stringify(file))
    const entry: StoreIndexEntry = { file: path, updatedAt: new Date(await $.clock.now()).toISOString() }
    await $.store.set(file.sessionId, entry)
  } catch (err) {
    dirty = true
    log($, `write failed: ${String(err)}`)
  }
}

/** Notes a change and (re)starts the debounce; when it fires, writes what `pending` names then. */
export function scheduleFlush($: EngineInterface, pending: Pending) {
  dirty = true
  flushTimer?.cancel()
  flushTimer = $.clock.after(FLUSH_MS, () => {
    const p = pending()
    void flush($, p.file, p.config)
  })
}
