// Reading the transcript file through `$`: finding it, reading it whole (one
// `$.fs.read`, or a stream through `$.process.spawn` past 4 MiB) and reading what
// was appended since. Lines go to the caller one at a time. Spec "Transcript pass".
import type { EngineInterface } from 'claude-code'
import { catCommands, gitRootOf, lineSplitter, transcriptPath } from './jsonl'

/** `$.fs.read` and `$.process.run`'s stdout both stop at 4 MiB. */
export const READ_MAX = 4 * 1024 * 1024
/** A tail read starts this far before the old end, so the cut line is one already read. */
const TAIL_SLACK = 64 * 1024

/** Finds `<config>/projects/<slug>/<sessionId>.jsonl` from the project root, else by scanning every project folder. */
export async function findTranscript($: EngineInterface, config: string, sessionId: string): Promise<string | undefined> {
  const roots = [await $.session.root().catch(() => undefined), await $.session.cwd().catch(() => undefined)]
  for (const root of roots) {
    if (!root) continue
    const path = transcriptPath(config, root, sessionId)
    if (await $.fs.exists(path)) return path
  }
  const dirs = await $.fs.list(`${config}/projects`).catch(() => [])
  for (const d of dirs) {
    if (d.kind !== 'dir') continue
    const path = `${config}/projects/${d.name}/${sessionId}.jsonl`
    if (await $.fs.exists(path)) return path
  }
  return undefined
}

type Tools = { windows: boolean; gitUsrBin: string[] }
let tools: Tools | undefined

/** Where Git for Windows' usr/bin tools are, once per module load. */
async function findTools($: EngineInterface): Promise<Tools> {
  if (tools) return tools
  const windows = (await $.env.get('OS').catch(() => undefined)) === 'Windows_NT'
  const gitUsrBin: string[] = []
  if (windows) {
    const run = await $.process.run(['git', '--exec-path'], { timeoutMs: 5000 }).catch(() => undefined)
    const root = run && run.exitCode === 0 ? gitRootOf(run.stdout) : undefined
    for (const dir of [root && `${root}/usr/bin`, 'C:/Program Files/Git/usr/bin']) {
      if (dir && !gitUsrBin.includes(dir) && (await $.fs.exists(`${dir}/cat.exe`).catch(() => false))) gitUsrBin.push(dir)
    }
  }
  tools = { windows, gitUsrBin }
  return tools
}

/** Splits a whole text into lines for `onLine`. */
const splitAll = (text: string, onLine: (line: string) => void): void => {
  const split = lineSplitter()
  split.push(text).forEach(onLine)
  split.end().forEach(onLine)
}

/** `same`: a tail read found the file the size it was, and read nothing. */
export type ReadStats = { size: number; via: 'read' | 'spawn' | 'tail' | 'same'; command?: string; pieces: number; ms: number }

/**
 * Reads the whole transcript, a line at a time into `onLine`. 4 MiB or less: one
 * `$.fs.read`. Larger: streamed through the first reader that starts (`catCommands`).
 */
export async function readTranscript($: EngineInterface, path: string, onLine: (line: string) => void): Promise<ReadStats> {
  const t0 = await $.clock.now()
  const { size } = await $.fs.stat(path)
  if (size <= READ_MAX) {
    splitAll(await $.fs.read(path), onLine)
    return { size, via: 'read', pieces: 1, ms: (await $.clock.now()) - t0 }
  }
  const t = await findTools($)
  const commands = catCommands(path, { windows: t.windows, gitCats: t.gitUsrBin.map(d => `${d}/cat.exe`) })
  let last: unknown
  for (const argv of commands) {
    const split = lineSplitter()
    let pieces = 0
    try {
      for await (const c of $.process.spawn({ argv })) {
        if (c.stream !== 'stdout') continue
        pieces++
        split.push(c.text).forEach(onLine)
      }
    } catch (err) {
      // A reader that would not start: try the next. One that failed midway already fed lines.
      if (pieces > 0) throw err
      last = err
      continue
    }
    split.end().forEach(onLine)
    return { size, via: 'spawn', command: argv[0], pieces, ms: (await $.clock.now()) - t0 }
  }
  throw last ?? new Error('no reader for ' + path)
}

/**
 * Reads what was appended since the file was `fromSize` long, a line at a time;
 * lines already read come again and the caller skips them by uuid. The same size: nothing. 4 MiB or less:
 * the whole file. Larger: `tail -c` through `$.process.run`. `reread` when only a
 * whole read will do (the file shrank, grew past 4 MiB at once, or no tail exists).
 */
export async function readTail($: EngineInterface, path: string, fromSize: number, onLine: (line: string) => void): Promise<ReadStats | 'reread'> {
  const t0 = await $.clock.now()
  const { size } = await $.fs.stat(path)
  if (size < fromSize) return 'reread'
  if (size === fromSize) return { size, via: 'same', pieces: 0, ms: (await $.clock.now()) - t0 }
  if (size <= READ_MAX) {
    splitAll(await $.fs.read(path), onLine)
    return { size, via: 'read', pieces: 1, ms: (await $.clock.now()) - t0 }
  }
  const bytes = size - fromSize + TAIL_SLACK
  if (bytes > READ_MAX) return 'reread'
  const t = await findTools($)
  const tail = t.windows ? t.gitUsrBin.map(d => `${d}/tail.exe`)[0] : 'tail'
  if (!tail) return 'reread'
  const run = await $.process.run([tail, '-c', String(bytes), path], { timeoutMs: 10_000 }).catch(() => undefined)
  if (!run || run.exitCode !== 0) return 'reread'
  // The first line is cut by the byte offset: drop it (it was read before, TAIL_SLACK back).
  splitAll(run.stdout.slice(run.stdout.indexOf('\n') + 1), onLine)
  return { size, via: 'tail', command: tail, pieces: 1, ms: (await $.clock.now()) - t0 }
}
