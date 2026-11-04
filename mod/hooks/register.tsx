// The only hooks module: thin adapters between engine events and the pure code in ./lib.
// Module variables hold caches only (lost on hot reload); $.state holds the view model;
// the data file on disk is the record.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { ConversationFile, StoreIndexEntry } from '../types/index'
import { bandLine, statusLine } from './lib/band'
import { emptyFile, parseFile } from './lib/model'
import { configDir, dataPath } from './lib/paths'
import { promptText } from './lib/rows'
import { onPrompt, onQueued, onResponse, onSubmit, onTurnComplete, onTurnStart, start, type ResponseBlock, type Tracked } from './lib/tracker'

/** Bump the shape tag whenever ConversationFile changes type. */
const conv = atom({ plugin: 'marks', key: 'conv' } as const, null, { shape: 'conv-1' })

const FLUSH_MS = 1000
const SWITCH_CHECK_MS = 250

let tracked: Tracked | null = null
let config: string | undefined
let flushTimer: Timer | null = null
let dirty = false
let lastStatus: string | null = null
/** A conversation load in flight; steps wait for it so none applies to the old file. */
let switching: Promise<void> | null = null

const log = ($: EngineInterface, text: string) => $.ui.log(`marks: ${text}`, { to: 'debug' })

const readConfig = async ($: EngineInterface) =>
  configDir({
    CLAUDE_CONFIG_DIR: await $.env.get('CLAUDE_CONFIG_DIR'),
    HOME: await $.env.get('HOME'),
    USERPROFILE: await $.env.get('USERPROFILE'),
  })

/** $.state first (it survives a hot reload and may be newer than the file), then the file, else empty. */
const loadFile = async ($: EngineInterface, sessionId: string): Promise<{ file: ConversationFile; fromState: boolean }> => {
  const held = await read($, conv)
  if (held && held.sessionId === sessionId) return { file: held, fromState: true }
  if (config) {
    const path = dataPath(config, sessionId)
    const text = (await $.fs.exists(path)) ? await $.fs.read(path).catch(() => undefined) : undefined
    const parsed = typeof text === 'string' ? parseFile(text, sessionId) : undefined
    if (parsed) return { file: parsed, fromState: false }
  }
  return { file: emptyFile(sessionId), fromState: false }
}

const showStatus = ($: EngineInterface, file: ConversationFile | null) => {
  const text = statusLine(file)
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

const publish = async ($: EngineInterface) => {
  const file = tracked?.file ?? null
  await update($, conv, () => file)
  showStatus($, file)
}

const flush = async ($: EngineInterface) => {
  flushTimer?.cancel()
  flushTimer = null
  if (!dirty || !tracked || !config) return
  dirty = false
  const file = tracked.file
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

const scheduleFlush = ($: EngineInterface) => {
  dirty = true
  flushTimer?.cancel()
  flushTimer = $.clock.after(FLUSH_MS, () => void flush($))
}

/**
 * Makes `tracked` the conversation `$.session.id()` names. A mismatch is a switch
 * (`/clear`, in-session `/resume`): flush the old file, load or start the new one.
 */
const sync = async ($: EngineInterface): Promise<void> => {
  const id = await $.session.id()
  while (switching) await switching
  if (tracked && tracked.file.sessionId === id) return
  switching = (async () => {
    if (tracked) await flush($)
    const { file, fromState } = await loadFile($, id)
    tracked = start(id, file)
    await publish($)
    // Back from $.state after a reload: a debounced write may have died with the old module.
    if (fromState && file.exchanges.length) scheduleFlush($)
  })()
  try {
    await switching
  } finally {
    switching = null
  }
}

/**
 * Applies a tracker step to the current conversation; a changed file is mirrored
 * to $.state and written back debounced. `check` first looks for a conversation
 * switch (session start and prompt appends). Without it the step applies at once,
 * so events keep their order.
 */
const commit = async ($: EngineInterface, fn: (t: Tracked) => Tracked, check = false) => {
  if (check || !tracked) await sync($)
  while (switching) await switching
  const before = tracked
  if (!before) return
  const after = fn(before)
  tracked = after
  if (after.file !== before.file) {
    await publish($)
    scheduleFlush($)
  }
}

const guard = async ($: EngineInterface, what: string, work: () => Promise<void>) => {
  try {
    await work()
  } catch (err) {
    log($, `${what} failed: ${String(err)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    lastStatus = null
    await guard($, 'session.start', async () => {
      config = await readConfig($)
      await sync($)
      showStatus($, tracked?.file ?? null)
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await guard($, 'session.end', () => flush($))
    const r = await next(e)
    // `/clear` changes the id with no session.start; look again once the engine has moved on.
    if (e.reason === 'clear' || e.reason === 'resume') $.clock.after(SWITCH_CHECK_MS, () => void guard($, 'switch', async () => void (await sync($))))
    return r
  })

  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    await guard($, `append ${e.door}`, async () => {
      if (e.door === 'prompt' && e.origin.kind === 'composer' && !e.message.isMeta) {
        const text = promptText(e.message.content)
        await commit($, t => onPrompt(t, e.uuid, text), true)
      } else if (e.door === 'response' && e.message.type === 'assistant' && !e.message.isMeta) {
        await commit($, t => onResponse(t, e.uuid, e.message.content as unknown as readonly ResponseBlock[]))
      } else if (e.message.name === 'queued_command') {
        log($, `queued_command door=${e.door} type=${e.message.type} origin=${e.origin.kind}`)
        await commit($, t => onQueued(t, e.uuid))
      }
    })
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    await guard($, 'prompt.submit', () =>
      commit($, t =>
        onSubmit(t, {
          text: e.text,
          command: e.command,
          isComposer: e.origin?.kind === 'composer',
          duringTurn: e.turnId !== undefined,
        }),
      ),
    )
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await guard($, 'turn.start', () => commit($, onTurnStart))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await guard($, 'turn.complete', () => commit($, onTurnComplete))
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const line = bandLine(await read($, conv))
    if (!line) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" width={e.props.bodyColumns}>
        <Text>{line}</Text>
      </Box>
    )
  })
}
