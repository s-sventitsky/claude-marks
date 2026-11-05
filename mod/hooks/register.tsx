// The only hooks module: thin adapters between engine events and the pure code in ./lib.
// Module variables hold caches only (lost on hot reload); $.state holds the view model;
// the data file on disk is the record.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { ChainView, ConversationFile, StoreIndexEntry } from '../types/index'
import { HINT, band, statusLine } from './lib/band'
import { gapRun, liveView, mergeBack, mergeTurns, turnsOf, unlabelledCount, viewOf, visibleThreads } from './lib/chain'
import { addBoundary, emptyTranscript, ingest, type Transcript } from './lib/jsonl'
import { buildDynamic, settle } from './lib/labeller'
import { emptyFile, parseFile } from './lib/model'
import { configDir, dataPath } from './lib/paths'
import { RULES } from './lib/rules'
import { promptText } from './lib/rows'
import { findTranscript, readTail, readTranscript, type ReadStats } from './lib/transcript'
import {
  onPrompt,
  onQueued,
  onResponse,
  onSubmit,
  onTurnComplete,
  onTurnStart,
  start,
  topmost,
  type ResponseBlock,
  type Tracked,
} from './lib/tracker'

/** Bump the shape tag whenever ConversationFile changes type. */
const conv = atom({ plugin: 'marks', key: 'conv' } as const, null, { shape: 'conv-1' })
const hereA = atom({ plugin: 'marks', key: 'here' } as const, null)
const offA = atom({ plugin: 'marks', key: 'labellerOff' } as const, null)
const chainA = atom({ plugin: 'marks', key: 'chain' } as const, null)

const FLUSH_MS = 1000
const SWITCH_CHECK_MS = 250
/** The labeller drain and the `here` check share one timer. */
const TICK_MS = 500
/** Hardcoded in the MVP; `label.model` stores this alias (the result names no model). */
const MODEL = 'haiku'

/** Exchange ids waiting for the labeller, conversation order. Lost on reload (ticket 03 rebuilds it). */
let queue: string[] = []
/** A labeller call is in flight. */
let busy = false
let tickTimer: Timer | null = null
/** Transcript rows (prompt and reply uuids) the render hooks last saw on screen. */
const onScreen = new Set<string>()
let lastHere: string | null = null

let tracked: Tracked | null = null
let config: string | undefined
let flushTimer: Timer | null = null
let dirty = false
let lastStatus: string | null = null
/** A conversation load in flight; steps wait for it so none applies to the old file. */
let switching: Promise<void> | null = null

// Ticket 03: the transcript pass, liveness and reachability.
/** A prompt append waits this long before the transcript tail is read for it, then retries. */
const TAIL_DELAY_MS = 250
const TAIL_RETRY_MS = 500
const TAIL_TRIES = 6
/** The loaded conversation's transcript as last read. Lost on reload; the load reads it again. */
let transcript: { sessionId: string; path?: string; t: Transcript; size: number } | null = null
/** Exchanges the gap-on-load rule left unlabelled (the band's `N unlabelled`). */
let unlabelled: string[] = []
/** The chain view last published to $.state; the labeller and the status line read it. */
let chainView: ChainView | null = null
/** Transcript reads run one at a time. */
let io: Promise<unknown> = Promise.resolve()
const serial = <T,>(work: () => Promise<T>): Promise<T> => {
  const p = io.then(work, work)
  io = p.catch(() => undefined)
  return p
}

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
  // Threads with no live exchange are hidden, so not counted.
  const text = statusLine(file && chainView ? { ...file, threads: visibleThreads(liveView(file, chainView.hidden)) } : file)
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
    const switched = tracked !== null
    if (tracked) await flush($)
    const { file, fromState } = await loadFile($, id)
    tracked = start(id, file)
    transcript = null
    unlabelled = []
    chainView = null
    if (switched) {
      // The old conversation's queue, screen rows and labeller state go with it.
      queue = []
      onScreen.clear()
      lastHere = null
      await update($, hereA, () => null)
      await update($, offA, () => null)
      await update($, chainA, () => null)
    }
    await publish($)
    // Back from $.state after a reload: a debounced write may have died with the old module.
    if (fromState && file.exchanges.length) scheduleFlush($)
    // Off the hook path: read the transcript, rebuild what it holds, refill the labeller queue.
    const fresh = file.exchanges.length === 0
    $.clock.after(0, () => void guard($, 'transcript', () => rebuild($, id, fresh)))
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

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

const logRead = ($: EngineInterface, what: string, s: ReadStats) =>
  log($, `${what}: ${s.via}${s.command ? ` (${s.command})` : ''}, ${s.size} bytes, ${s.pieces} pieces, ${s.ms} ms`)

/** Liveness and reachability of the loaded conversation, into $.state when they change. */
const publishChain = async ($: EngineInterface) => {
  const tr = transcript
  if (!tracked || !tr || tr.sessionId !== tracked.file.sessionId) return
  const view = viewOf(tr.t, tracked.file, unlabelled)
  if (JSON.stringify(view) === JSON.stringify(chainView)) return
  chainView = view
  await update($, chainA, () => view)
  showStatus($, tracked.file)
}

/**
 * The transcript pass (spec "Transcript pass"), once per conversation load, from a
 * timer: reads the JSONL, adds exchanges for prompt rows the file lacks, fills the
 * row index, publishes liveness, and refills the labeller queue by the gap rule.
 * `fresh`: the file held no exchanges when loaded (the mod never tracked it).
 */
const rebuild = ($: EngineInterface, sessionId: string, fresh: boolean) =>
  serial(async () => {
    let t: Transcript | undefined
    let path: string | undefined
    let size = 0
    if (config) {
      try {
        path = await findTranscript($, config, sessionId)
        if (path) {
          const read = emptyTranscript()
          const stats = await readTranscript($, path, line => ingest(read, line))
          logRead($, 'transcript', stats)
          t = read
          size = stats.size
        } else log($, `no transcript for ${sessionId}`)
      } catch (err) {
        log($, `transcript read failed: ${String(err)}`)
      }
    }
    while (switching) await switching
    if (tracked?.file.sessionId !== sessionId) return
    transcript = { sessionId, path: t ? path : undefined, t: t ?? emptyTranscript(), size }
    await commit($, cur => {
      const next = t ? { ...cur, ...mergeTurns(cur.file, cur.index, turnsOf(t)) } : cur
      // Queued and running exchanges are tracked already: they are no gap.
      const running = cur.turn.exchangeId ? [cur.turn.exchangeId] : []
      const skip = [...(t ? viewOf(t, next.file, []).hidden : []), ...queue, ...running]
      const gap = gapRun(next.file, skip, fresh)
      unlabelled = gap.left
      queue = [...gap.queue, ...queue]
      return next
    })
    await publishChain($)
  })

/**
 * Decision 5 (rewinds): an append carries no parentUuid, so after each prompt append
 * the transcript's tail is read to place the prompt on its chain, and liveness is
 * recomputed. A prompt not written yet is looked for again, up to TAIL_TRIES times.
 */
const placePrompt = ($: EngineInterface, uuid: string, tries = 1): Promise<void> =>
  serial(async () => {
    const tr = transcript
    if (!tr?.path || tracked?.file.sessionId !== tr.sessionId) return
    const { t, path } = tr
    const r = await readTail($, path, tr.size, line => ingest(t, line))
    const stats = r === 'reread' ? await readTranscript($, path, line => ingest(t, line)) : r
    tr.size = stats.size
    if (!t.pos.has(uuid)) {
      if (tries < TAIL_TRIES) $.clock.after(TAIL_RETRY_MS, () => void guard($, 'tail', () => placePrompt($, uuid, tries + 1)))
      return
    }
    if (stats.via !== 'read') logRead($, 'tail', stats)
    await commit($, cur => (cur.file.sessionId === tr.sessionId ? { ...cur, ...mergeTurns(cur.file, cur.index, turnsOf(t)) } : cur))
    await publishChain($)
  })

/**
 * One labeller step, from the timer: the head of the queue gets one call, and its
 * outcome lands in the data file. Never runs inside a turn's dispatch, and never
 * two at once (`busy`), so each call sees the labels before it.
 */
const drain = async ($: EngineInterface) => {
  if (busy) return
  busy = true
  try {
    await sync($) // decision 2: a switch is also looked for on the timer tick
    if (await read($, offA)) return
    const t = tracked
    const id = queue[0]
    if (!t || id === undefined) return
    const ex = t.file.exchanges.find(x => x.id === id)
    // Live exchanges only: a rewound one waits (pending) in case the conversation returns to it.
    const hidden = chainView?.hidden ?? []
    if (!ex || ex.label.status === 'done' || hidden.includes(id)) {
      queue.shift()
      return
    }
    const sessionId = t.file.sessionId
    let result
    try {
      result = await $.model.complete({
        model: MODEL,
        effort: 'low',
        prompt: [{ text: RULES, cache: true }, { text: buildDynamic(liveView(t.file, hidden), t.index, id) }],
        maxTokens: 400,
        timeoutMs: 15_000,
      })
    } catch (err) {
      // The engine refused to send it (a blocked model): stop for this conversation.
      const reason = reasonOf(err)
      log($, `labeller off: ${reason}`)
      await update($, offA, () => reason)
      return
    }
    // A switch while the call ran cleared the queue; this result belongs to no one.
    if (tracked?.file.sessionId !== sessionId || queue[0] !== id) return
    if (!result.isAnswered) log($, `labeller ${id}: ${result.reason}`)
    let retry = false
    await commit($, cur => {
      // Placed against the live chain (current thread, threads), then put back whole.
      const view = liveView(cur.file, hidden)
      const s = settle(view, id, result, MODEL)
      retry = s.retry
      return { ...cur, file: view === cur.file ? s.file : mergeBack(cur.file, s.file) }
    })
    if (!retry) queue.shift()
  } finally {
    busy = false
  }
}

/** Fullscreen `here`: the topmost exchange the render hooks saw on screen, into $.state on change. */
const updateHere = async ($: EngineInterface) => {
  if (!tracked || !onScreen.size) return
  const id = topmost(tracked, onScreen) ?? null
  if (id === null || id === lastHere) return
  lastHere = id
  await update($, hereA, () => id)
}

const tick = ($: EngineInterface) => {
  void guard($, 'here', () => updateHere($))
  void guard($, 'labeller', () => drain($))
}

/** Render hooks note which rows are on screen; `null` is off screen, absent says nothing. */
const noteOnScreen = (requestId: string, seen: unknown) => {
  if (requestId === 'placeholder') return
  if (seen) onScreen.add(requestId)
  else if (seen === null) onScreen.delete(requestId)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    lastStatus = null
    await guard($, 'session.start', async () => {
      config = await readConfig($)
      await sync($)
      showStatus($, tracked?.file ?? null)
    })
    // session.start can run again without a reload (in-session /resume): one timer only.
    tickTimer?.cancel()
    tickTimer = $.clock.every(TICK_MS, () => tick($))
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
        // A rewind shows only in the file: place the prompt on its chain from the transcript's tail.
        $.clock.after(TAIL_DELAY_MS, () => void guard($, 'tail', () => placePrompt($, e.uuid)))
      } else if (e.message.type === 'system' && e.message.name === 'compact_boundary') {
        // Decision 6: matched on name; everything before it is now out of the transcript's reach.
        if (transcript && transcript.sessionId === tracked?.file.sessionId) addBoundary(transcript.t, e.uuid)
        await publishChain($)
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
    if (e.agentId !== undefined) return r
    // Queue the turn's exchange for the labeller; the timer makes the call, never this dispatch.
    await guard($, 'turn.complete', () =>
      commit($, t => {
        const id = t.turn.exchangeId
        if (id && !queue.includes(id)) queue.push(id)
        return onTurnComplete(t)
      }),
    )
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const file = await read($, conv)
    const hereId = await read($, hereA)
    const off = await read($, offA)
    const chain = await read($, chainA)
    const left = unlabelledCount(file, chain)
    const segments = band(file && chain ? liveView(file, chain.hidden) : file, {
      fullscreen: e.viewport?.isFullscreen === true,
      hereId,
      hint: off ? `labeller off: ${off}` : left ? `${left} unlabelled` : HINT,
    })
    if (!segments) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" width={e.props.bodyColumns}>
        {segments.map(s => (
          <Text color={s.color} bold={s.bold} dimColor={s.dim} wrap="truncate">
            {s.text}
          </Text>
        ))}
      </Box>
    )
  })

  // `here`: these only note which rows are on screen; the timer does the rest.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    noteOnScreen(e.requestId, e.props.onScreen)
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    noteOnScreen(e.requestId, e.props.onScreen)
    return next(e)
  })
}
