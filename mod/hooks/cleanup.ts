// Deletes data files and $.store index entries not written for KEEP_DAYS, once per module
// load, at session start. The rules are lib/cleanup.ts's.
import type { EngineInterface } from 'claude-code'
import { deleteCommands, KEEP_DAYS, staleIndex, staleSessions } from './lib/cleanup'
import { dataPath } from './lib/paths'
import { log } from './log'

let done = false

export async function cleanUp($: EngineInterface, config: string, current: string): Promise<void> {
  if (done) return
  done = true
  const now = await $.clock.now()
  const listing = await $.fs.list(`${config}/claude-marks`).catch(() => [])
  const ids = staleSessions(listing, now, current)
  const windows = (await $.env.get('OS').catch(() => undefined)) === 'Windows_NT'
  let deleted = 0
  for (const argv of deleteCommands(ids.map(id => dataPath(config, id)), windows)) {
    const r = await $.process.run(argv, { timeoutMs: 10_000 }).catch((err: unknown) => ({ exitCode: -1, stderr: String(err) }))
    if (r.exitCode === 0) deleted += argv.length - (windows ? 6 : 3)
    else log($, `cleanup: ${argv[0]} exited ${r.exitCode}: ${String(r.stderr).slice(0, 200)}`)
  }
  const keys = await $.store.keys().catch(() => [] as string[])
  const index: [string, unknown][] = []
  for (const k of keys) index.push([k, await $.store.get(k).catch(() => undefined)])
  const gone = new Set([...ids, ...staleIndex(index, now, current)])
  for (const k of gone) if (keys.includes(k)) await $.store.delete(k).catch(() => undefined)
  if (ids.length || gone.size) log($, `cleanup: ${deleted}/${ids.length} data files and ${gone.size} index entries older than ${KEEP_DAYS} days`)
}
