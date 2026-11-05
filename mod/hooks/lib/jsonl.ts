// Reading the transcript JSONL: where it is, splitting streamed text into lines,
// and filing each row into a Transcript (chain links plus the rows the mod reads).
// Pure: no `$`. The Transcript is a cache in a module variable, so it is built in place.
import { isCommandWrapper, promptText, toolLine } from './rows'

/**
 * What the mod keeps of a row it reads:
 * - `prompt`: a typed prompt, an exchange's anchor.
 * - `queued`: a prompt typed during a running turn and delivered into it.
 * - `command`: a slash-command or skill wrapper; the turn anchors on its first reply text row.
 * - `turn`: a user row nobody typed (task notification, peer message, bash input); its turn has no exchange.
 * - `reply`: an assistant row with text or tool calls.
 * - `boundary`: a compact_boundary.
 */
export type Row =
  | { kind: 'prompt' | 'queued' | 'command'; text: string }
  | { kind: 'turn' }
  | { kind: 'reply'; text: string; tools: string[] }
  | { kind: 'boundary' }

export type Transcript = {
  /** Uuids of main-session rows, file order. */
  order: string[]
  pos: Map<string, number>
  /** A row's parentUuid (a boundary's logicalParentUuid); undefined: not known yet. */
  parent: Map<string, string | null | undefined>
  /** The rows the mod reads, by uuid. */
  rows: Map<string, Row>
  /** The last user or assistant row: where the active chain ends. */
  newest?: string
  /** compact_boundary uuids, file order. */
  boundaries: string[]
}

export const emptyTranscript = (): Transcript => ({ order: [], pos: new Map(), parent: new Map(), rows: new Map(), boundaries: [] })

/** The project folder's name: the root with every non-alphanumeric character replaced by `-`. */
export const slug = (root: string): string => root.replace(/[^A-Za-z0-9]/g, '-')

export const transcriptPath = (config: string, root: string, sessionId: string): string => `${config}/projects/${slug(root)}/${sessionId}.jsonl`

/** Git for Windows' install root from `git --exec-path` (`<root>/mingw64/libexec/git-core`). */
export const gitRootOf = (execPath: string): string | undefined => {
  const parts = execPath.trim().replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length > 3 ? parts.slice(0, -3).join('/') : undefined
}

/**
 * The commands that stream a file to stdout, in the order to try them: `cat` on
 * macOS and Linux; on Windows each Git for Windows `usr/bin/cat.exe` found, then
 * `cmd /c type` (always there, but it writes in tiny pieces).
 */
export const catCommands = (path: string, o: { windows: boolean; gitCats: readonly string[] }): string[][] =>
  o.windows ? [...o.gitCats.map(cat => [cat, path]), ['cmd', '/c', 'type', path.replace(/\//g, '\\')]] : [['cat', path]]

/** Splits streamed text into lines; a line cut across pieces is held until it ends. Empty lines are dropped. */
export const lineSplitter = () => {
  // The unfinished line's pieces, joined only once its end arrives: `cmd /c type`
  // writes a 1 MB line in hundreds of pieces, and re-joining each time is quadratic.
  let held: string[] = []
  const out = (parts: string[]) => parts.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter(l => l.length > 0)
  return {
    push(text: string): string[] {
      const nl = text.indexOf('\n')
      if (nl < 0) {
        held.push(text)
        return []
      }
      const parts = text.split('\n')
      parts[0] = held.join('') + parts[0]
      held = [parts.pop() ?? '']
      return out(parts)
    },
    end(): string[] {
      const last = held.join('')
      held = []
      return out([last])
    },
  }
}

/** Rows worth a JSON.parse: user rows without tool results, assistant rows, boundaries, queued commands. */
export const keep = (line: string): boolean =>
  (line.includes('"type":"user"') && !line.includes('"tool_result"')) ||
  line.includes('"type":"assistant"') ||
  line.includes('"compact_boundary"') ||
  line.includes('"queued_command"')

// Links of the rows not parsed whole: the top-level parentUuid opens the line, and the
// row's own uuid sits beside its timestamp. A line that matches neither is parsed.
const PARENT = /^\{"parentUuid":(?:null|"([^"]+)")/
const UUID = /"uuid":"([^"]+)","timestamp"|"timestamp":"[^"]*","uuid":"([^"]+)"/

const COMMAND = /<command-name>\/?([^<]+)<\/command-name>/
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/
const BARE_COMMAND = /^\/[A-Za-z][\w:-]*(\s|$)/

type Json = Record<string, any>

const userRow = (r: Json): Row | undefined => {
  const content = r.message?.content
  if (Array.isArray(content) && content.some((b: Json) => b?.type === 'tool_result')) return undefined
  const origin: string | undefined = r.origin?.kind
  if (origin !== undefined && origin !== 'human') return { kind: 'turn' }
  if (r.isMeta || r.isCompactSummary) return undefined
  const text = promptText(content)
  if (isCommandWrapper(text)) {
    const name = COMMAND.exec(text)?.[1]?.trim()
    if (!name) return undefined
    const args = ARGS.exec(text)?.[1]?.trim()
    return { kind: 'command', text: `/${name}${args ? ' ' + args : ''}` }
  }
  if (text.trimStart().startsWith('<')) return { kind: 'turn' }
  // Older builds kept a typed local command (`/compact`) as a plain row with no origin.
  if (origin === undefined && BARE_COMMAND.test(text)) return { kind: 'command', text: text.trim() }
  return text.trim() ? { kind: 'prompt', text } : undefined
}

const assistantRow = (r: Json): Row | undefined => {
  const blocks: Json[] = Array.isArray(r.message?.content) ? r.message.content : []
  const text = blocks
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
  const tools = blocks.filter(b => b?.type === 'tool_use' && typeof b.name === 'string').map(b => toolLine(b.name, b.input))
  return text.trim() || tools.length ? { kind: 'reply', text: text.trim() ? text : '', tools } : undefined
}

const rowOf = (r: Json): Row | undefined => {
  if (r.type === 'user') return userRow(r)
  if (r.type === 'assistant' && !r.isMeta) return assistantRow(r)
  if (r.type === 'system' && r.subtype === 'compact_boundary') return { kind: 'boundary' }
  const a = r.attachment
  if (r.type === 'attachment' && a?.type === 'queued_command' && a.commandMode === 'prompt' && (a.origin?.kind ?? 'human') === 'human') {
    const text = promptText(a.prompt)
    return text.trim() ? { kind: 'queued', text } : undefined
  }
  return undefined
}

const link = (t: Transcript, uuid: string, parent: string | null, isConversation: boolean) => {
  if (t.pos.has(uuid)) {
    // Known only from a live append (a boundary): its link arrives with the file.
    if (t.parent.get(uuid) === undefined) t.parent.set(uuid, parent)
    return false
  }
  t.pos.set(uuid, t.order.length)
  t.order.push(uuid)
  t.parent.set(uuid, parent)
  if (isConversation) t.newest = uuid
  return true
}

const parseLine = (line: string): Json | undefined => {
  try {
    const v = JSON.parse(line)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined
  } catch {
    return undefined
  }
}

const ingestParsed = (t: Transcript, r: Json) => {
  if (typeof r.uuid !== 'string' || r.isSidechain === true) return
  const isBoundary = r.type === 'system' && r.subtype === 'compact_boundary'
  const parent = (isBoundary ? r.logicalParentUuid : r.parentUuid) ?? null
  if (!link(t, r.uuid, typeof parent === 'string' ? parent : null, r.type === 'user' || r.type === 'assistant')) return
  const row = rowOf(r)
  if (!row) return
  t.rows.set(r.uuid, row)
  if (row.kind === 'boundary') t.boundaries.push(r.uuid)
}

/** Files one JSONL line into the transcript. A row seen before (by uuid) is left as it was. */
export const ingest = (t: Transcript, line: string): void => {
  // A re-read sees old rows again: skip a known one before parsing it.
  const seen = UUID.exec(line)
  const known = seen?.[1] ?? seen?.[2]
  if (known !== undefined && t.pos.has(known) && t.parent.get(known) !== undefined) return
  if (keep(line)) {
    const r = parseLine(line)
    if (r) ingestParsed(t, r)
    return
  }
  if (line.includes('"isSidechain":true')) return
  const p = PARENT.exec(line)
  const u = p ? UUID.exec(line) : null
  const uuid = u?.[1] ?? u?.[2]
  if (p && uuid) {
    link(t, uuid, p[1] ?? null, line.includes('"type":"user"'))
    return
  }
  if (!line.includes('"uuid"')) return
  const r = parseLine(line)
  if (r) ingestParsed(t, r)
}

/** A compact_boundary seen live (session.append): placed at the end, its link left to the next read. */
export const addBoundary = (t: Transcript, uuid: string): void => {
  if (t.pos.has(uuid)) return
  t.pos.set(uuid, t.order.length)
  t.order.push(uuid)
  t.parent.set(uuid, undefined)
  t.rows.set(uuid, { kind: 'boundary' })
  t.boundaries.push(uuid)
}
