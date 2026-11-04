// The in-memory row index: per exchange, its prompt texts, reply text rows and tool lines.
// Never persisted (no transcript text is stored); rebuilt from the transcript on load (ticket 03).

export type ReplyRow = { uuid: string; text: string }
export type ExchangeRows = { prompts: string[]; replies: ReplyRow[]; tools: string[] }
/** Keyed by exchange id. */
export type RowIndex = Record<string, ExchangeRows>

export const emptyRows = (): ExchangeRows => ({ prompts: [], replies: [], tools: [] })

const TOOL_LINE_MAX = 100
/** The input keys that name what a tool call is about, in the order they are tried. */
const MAIN_INPUT_KEYS = ['file_path', 'command', 'pattern', 'description', 'skill', 'url', 'query'] as const

/** `<name> <first line of the main input>`, the input part cut to 100 chars. */
export const toolLine = (name: string, input: unknown): string => {
  const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  for (const k of MAIN_INPUT_KEYS) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim()) {
      const first = v.trim().split('\n')[0] ?? ''
      return `${name} ${first.slice(0, TOOL_LINE_MAX)}`
    }
  }
  return name
}

/** The text of a row's content: its text blocks joined. JSONL rows may hold a plain string. */
export const promptText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => !!b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
}

/** Slash-command and local-command wrapper rows: not prompts, not jump targets. */
export const isCommandWrapper = (text: string): boolean => {
  const s = text.trimStart()
  return s.startsWith('<command-') || s.startsWith('<local-command')
}
