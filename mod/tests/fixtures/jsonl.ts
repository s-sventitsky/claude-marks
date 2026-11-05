// Builders for transcript JSONL lines, shaped like Claude Code 2.1.318 writes them
// (key order included: `parentUuid` first, `uuid` after the message, then `timestamp`).
// Synthetic text only; no real transcript content.

const T = '2026-11-05T10:00:00.000Z'
const base = (parent: string | null) => ({ parentUuid: parent, isSidechain: false })
const tail = (uuid: string) => ({ uuid, timestamp: T, userType: 'external', entrypoint: 'cli', cwd: 'C:\\demo', sessionId: 's1', version: '2.1.318' })

/** A typed prompt: `type:"user"`, origin human, string content. */
export const human = (uuid: string, parent: string | null, text: string | unknown[]) =>
  JSON.stringify({
    ...base(parent),
    type: 'user',
    message: { role: 'user', content: text },
    ...tail(uuid),
    promptId: 'p-' + uuid,
    origin: { kind: 'human' },
    promptSource: 'typed',
  })

/** A user row with other provenance: meta rows, peer messages, compact summaries. */
export const userRow = (uuid: string, parent: string | null, text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...base(parent), type: 'user', message: { role: 'user', content: text }, ...tail(uuid), ...extra })

/** A slash-command or skill wrapper row. */
export const command = (uuid: string, parent: string | null, name: string, args?: string) =>
  human(
    uuid,
    parent,
    `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` + (args === undefined ? '' : `\n<command-args>${args}</command-args>`),
  )

export const toolResult = (uuid: string, parent: string | null, toolUseId = 'tu1', out = 'ok') =>
  JSON.stringify({
    ...base(parent),
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content: out }] },
    ...tail(uuid),
    toolUseResult: { stdout: out, uuid: 'nested-not-a-row', timestamp: T },
    sourceToolAssistantUUID: parent,
  })

const assistant = (uuid: string, parent: string | null, content: unknown[]) =>
  JSON.stringify({
    ...base(parent),
    message: { model: 'claude', id: 'msg_' + uuid, type: 'message', role: 'assistant', content, stop_reason: null },
    requestId: 'req_' + uuid,
    type: 'assistant',
    ...tail(uuid),
  })

export const text = (uuid: string, parent: string | null, t: string) => assistant(uuid, parent, [{ type: 'text', text: t }])
export const thinking = (uuid: string, parent: string | null) => assistant(uuid, parent, [{ type: 'thinking', thinking: '', signature: 'x' }])
export const tool = (uuid: string, parent: string | null, name: string, input: Record<string, unknown>) =>
  assistant(uuid, parent, [{ type: 'tool_use', id: 'tu-' + uuid, name, input }])

export const attachment = (uuid: string, parent: string | null, att: Record<string, unknown>) =>
  JSON.stringify({ ...base(parent), attachment: att, type: 'attachment', ...tail(uuid) })

/** A prompt the person typed during a running turn, delivered into it. */
export const queued = (uuid: string, parent: string | null, prompt: string) =>
  attachment(uuid, parent, { type: 'queued_command', prompt, source_uuid: 'src-' + uuid, commandMode: 'prompt', origin: { kind: 'human' }, humanTurn: true })

/** A task notification delivered mid-turn: not a prompt. */
export const notification = (uuid: string, parent: string | null) =>
  attachment(uuid, parent, { type: 'queued_command', prompt: '<task-notification>done</task-notification>', commandMode: 'task-notification', origin: { kind: 'task-notification' } })

export const system = (uuid: string, parent: string | null, subtype: string) =>
  JSON.stringify({ ...base(parent), type: 'system', subtype, content: '', level: 'info', timestamp: T, uuid })

export const boundary = (uuid: string, logicalParent: string | null, preserved?: { headUuid: string; anchorUuid: string; tailUuid: string }) =>
  JSON.stringify({
    parentUuid: null,
    logicalParentUuid: logicalParent,
    isSidechain: false,
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    level: 'info',
    compactMetadata: { trigger: 'auto', preTokens: 1000, ...(preserved ? { preservedSegment: preserved } : {}) },
    uuid,
    timestamp: T,
  })

/** Rows with no uuid: they carry no chain link. */
export const meta = (type: string) => JSON.stringify({ type, sessionId: 's1', leafUuid: 'x' })

export const jsonl = (...lines: string[]) => lines.join('\n') + '\n'
