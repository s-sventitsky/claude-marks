// Shared fake engine bottoms for the plugin-level tests.
import type { ConversationFile } from '../types/index'

export const SESSION_START = { cwd: 'C:/Projs/demo', surface: 'terminal', isInteractive: true } as const
export const CONFIG = 'C:/cfg'

// The engine hands fs hooks the platform's spelling (backslashes on Windows).
const norm = (p: string) => p.replace(/\\/g, '/')

export type World = {
  files: Map<string, string>
  status: (string | undefined)[]
  writes: string[]
  /** What the plugin logged to the debug log. */
  logs: string[]
  sessionId: { current: string }
  /** The plugin's $.store, in memory. */
  store: Map<string, unknown>
  /** The last value the plugin set under each $.state key (shaped values as stored). */
  state: Map<string, unknown>
}

/** The conversation file the plugin last mirrored into $.state. */
export const mirrored = (w: World): ConversationFile | null | undefined => {
  const v = w.state.get('conv') as any
  return v && typeof v === 'object' && 'shape' in v ? v.value : v
}

// Wires the hooks a session start needs: env, session id, fs in memory, status capture, store.
export const world = (on: any, mock: any, opts: { sessionId?: string; files?: Record<string, string> } = {}): World => {
  const w: World = {
    files: new Map(Object.entries(opts.files ?? {})),
    status: [],
    writes: [],
    logs: [],
    store: new Map(),
    state: new Map(),
    sessionId: { current: opts.sessionId ?? 's1' },
  }
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG })
  on('store.get', (_: unknown, e: any) => ({ value: w.store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  // Observe what the plugin mirrors into $.state; the kit's own state lies beneath.
  on('state.set', (_: unknown, e: any, next: any) => {
    w.state.set(e.key, e.value)
    return next(e)
  })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: unknown, e: any) => ({ sessionId: e.sessionId }))
  // Stands for the engine's own drawing beneath the plugins.
  on('ui.render', () => h('Box', null))
  on('session.id', () => ({ value: w.sessionId.current }))
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  on('fs.exists', (_: unknown, e: any) => ({ value: w.files.has(norm(e.path)) }))
  on('fs.read', (_: unknown, e: any) => {
    const t = w.files.get(norm(e.path))
    if (t === undefined) throw new Error('ENOENT ' + e.path)
    return { value: t }
  })
  on('fs.write', (_: unknown, e: any) => {
    w.files.set(norm(e.path), e.text)
    w.writes.push(norm(e.path))
    return { value: undefined }
  })
  on('ui.status', (_: unknown, e: any) => {
    w.status.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_: unknown, e: any) => {
    w.logs.push(String(e.text ?? e.value ?? JSON.stringify(e)))
    return { value: undefined }
  })
  return w
}

export const dataPath = (sessionId: string) => `${CONFIG}/claude-marks/${sessionId}.json`

export const fileOf = (w: World, sessionId: string): ConversationFile | undefined => {
  const t = w.files.get(dataPath(sessionId))
  return t === undefined ? undefined : JSON.parse(t)
}

export const prompt = (uuid: string, text: string, extra: Record<string, unknown> = {}) => ({
  message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
  door: 'prompt',
  origin: { kind: 'composer' },
  uuid,
  ...extra,
})

export const replyText = (uuid: string, text: string) => ({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  door: 'response',
  origin: { kind: 'model', model: 'claude' },
  uuid,
})

export const toolUse = (uuid: string, name: string, input: Record<string, unknown>) => ({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id: 'tu-' + uuid, name, input }] },
  door: 'response',
  origin: { kind: 'model', model: 'claude' },
  uuid,
})

export const queued = (uuid: string, text: string) => ({
  message: { type: 'attachment', name: 'queued_command', content: [{ type: 'text', text }] },
  door: 'attachment',
  origin: { kind: 'composer' },
  uuid,
})

export const BAND = {
  plugin: 'marks',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'above',
  props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 120, scroll: { offset: 0, bodyRows: 5 }, view: {} },
  viewport: { columns: 200, rows: 45, isFullscreen: true },
} as const
