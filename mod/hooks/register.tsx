// The hooks module's entry: wiring between engine events and the pure code in ./lib, with
// thin adapters beside it (persist, markers, pass, labeller, pane, mode, cleanup).
// Module variables hold caches only (lost on hot reload); $.state holds the view model;
// the data file on disk is the record.
import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { ChainView, ConversationFile } from '../types/index'
import { HINT, band, statusLine } from './lib/band'
import { anchorSince, gapRun, isLive, liveFile, liveView, mergeTurns, turnsOf, unlabelledCount, viewOf, visibleThreads } from './lib/chain'
import { addBoundary, emptyTranscript } from './lib/jsonl'
import { dividerLine } from './lib/markers'
import { afterSettle, enqueue, headStep, refill, requeue, settleLive } from './lib/queue'
import { fixMode, noteMode, readMode } from './mode'
import { NO_EXCHANGE, menuTarget, noteManual, pickMark, runMark } from './lib/bookmarks'
import { PANE_ID } from './lib/pane'
import { openFromBand, registerMarksCommand, registerPane } from './pane'
import { configDir } from './lib/paths'
import { cleanUp } from './cleanup'
import { promptText } from './lib/rows'
import { MODEL, askLabeller } from './labeller'
import { log, reasonOf } from './log'
import { publishMarkers } from './markers'
import { logRead, readNew, readWhole, type LoadedTranscript } from './pass'
import { flush as flushFile, loadFile, scheduleFlush as markDirty } from './persist'
import {
  exchangeOfRow,
  onAnchor,
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

/** The data file, mirrored (`marks.conv`). Bump the shape tag whenever ConversationFile changes type, here and in pane.tsx and persist.ts, which repeat it. */
const fileA = atom({ plugin: 'marks', key: 'conv' } as const, null, { shape: 'conv-1' })
const hereA = atom({ plugin: 'marks', key: 'here' } as const, null)
const offA = atom({ plugin: 'marks', key: 'labellerOff' } as const, null)
const chainA = atom({ plugin: 'marks', key: 'chain' } as const, null)
/** Inline marker per prompt row, a family keyed by exchange id (ticket 07). */
const markerA = atom({ plugin: 'marks', key: 'marker' } as const, null)

const SWITCH_CHECK_MS = 250
/** The labeller drain and the `here` check share one timer. */
const TICK_MS = 500

/** Exchange ids waiting for the labeller, conversation order. Lost on reload; the transcript pass refills it (gap rule). */
let queue: string[] = []
/** A labeller call is in flight. */
let busy = false
let tickTimer: Timer | null = null
/** Transcript rows (prompt and reply uuids) the render hooks last saw on screen. */
const onScreen = new Set<string>()
let lastHere: string | null = null

let tracked: Tracked | null = null
let config: string | undefined
let lastStatus: string | null = null
/** A conversation load in flight; steps wait for it so none applies to the old file. */
let switching: Promise<void> | null = null

// Ticket 03: the transcript pass, liveness and reachability.
/** A prompt append waits this long before the transcript tail is read for it, then retries. */
const TAIL_DELAY_MS = 250
const TAIL_RETRY_MS = 500
const TAIL_TRIES = 6
/** The loaded conversation's transcript as last read. Lost on reload; the load reads it again. */
let transcript: LoadedTranscript | null = null
/** Exchanges the gap-on-load rule left unlabelled (the band's `N unlabelled`). */
let unlabelled: string[] = []
/** The chain view last published to $.state; the labeller and the status line read it. */
let chainView: ChainView | null = null
// Live tracking from the transcript: a managed plugin above the mod can send `session.append`
// past it, so the turn events and the timer read the tail too (ticket 01 Comments).
/** While a turn runs, the timer reads the tail every this many ticks. */
const FOLLOW_TICKS = 4
let ticks = 0
/** Rows the transcript held when the last turn ended: the running turn's rows come after. */
let turnFrom = 0
/** Counts main turn starts, so a late look for an ended turn's exchange stops once the next starts. */
let turnCount = 0
/** Transcript reads run one at a time. */
let io: Promise<unknown> = Promise.resolve()
const serial = <T,>(work: () => Promise<T>): Promise<T> => {
  const p = io.then(work, work)
  io = p.catch(() => undefined)
  return p
}

const readConfig = async ($: EngineInterface) =>
  configDir({
    CLAUDE_CONFIG_DIR: await $.env.get('CLAUDE_CONFIG_DIR'),
    HOME: await $.env.get('HOME'),
    USERPROFILE: await $.env.get('USERPROFILE'),
  })

const showStatus = ($: EngineInterface, file: ConversationFile | null) => {
  // Threads with no live exchange are hidden, so not counted.
  const text = statusLine(file && chainView ? { ...file, threads: visibleThreads(liveFile(file, chainView)) } : file)
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

const publish = async ($: EngineInterface) => {
  const file = tracked?.file ?? null
  await update($, fileA, () => file)
  await publishMarkers($, file, chainView)
  showStatus($, file)
}

const flush = ($: EngineInterface) => flushFile($, tracked?.file ?? null, config)

const scheduleFlush = ($: EngineInterface) => markDirty($, () => ({ file: tracked?.file ?? null, config }))

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
    const { file, fromState } = await loadFile($, config, id)
    tracked = start(file)
    transcript = null
    turnFrom = 0
    // P5: the gap rule's record from the file alone until the transcript pass redoes it.
    const fresh = file.exchanges.length === 0
    unlabelled = gapRun(file, [], fresh).left
    chainView = null
    if (switched) {
      // The old conversation's queue, screen rows and labeller state go with it.
      queue = []
      onScreen.clear()
      lastHere = null
      await update($, hereA, () => null)
      await update($, offA, () => null)
    }
    // The record before the file: a drawing never sees the file without it.
    await publishChain($)
    await publish($)
    // Back from $.state after a reload: a debounced write may have died with the old module.
    if (fromState && file.exchanges.length) scheduleFlush($)
    // Off the hook path: read the transcript, rebuild what it holds, refill the labeller queue.
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

/** Ticket 06: a bookmark change to the loaded conversation's file, mirrored and written back as every change. */
const editFile = ($: EngineInterface, fn: (file: ConversationFile) => ConversationFile) =>
  commit($, t => {
    const file = fn(t.file)
    return file === t.file ? t : { ...t, file }
  })

const isoNow = async ($: EngineInterface) => new Date(await $.clock.now()).toISOString()

/** The row index entry of an exchange (prompt texts, reply text rows). */
const rowsOf = (id: string) => tracked?.index[id]

const guard = async ($: EngineInterface, what: string, work: () => Promise<void>) => {
  try {
    await work()
  } catch (err) {
    log($, `${what} failed: ${String(err)}`)
  }
}

/** Liveness and reachability of the loaded conversation, into $.state when they change. */
const publishChain = async ($: EngineInterface) => {
  if (!tracked) return
  // Before the transcript pass (or with no transcript): nothing hidden or compacted yet.
  const t = transcript?.sessionId === tracked.file.sessionId ? transcript.t : emptyTranscript()
  const view = viewOf(t, tracked.file, unlabelled)
  if (JSON.stringify(view) === JSON.stringify(chainView)) return
  // P1: exchanges a rewind hid while they waited go back to the labeller once their fork is live again.
  queue = requeue(tracked.file, queue, tracked.turn.exchangeId, chainView, view)
  chainView = view
  await update($, chainA, () => view)
  await publishMarkers($, tracked.file, chainView)
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
    const loaded = await readWhole($, config, sessionId)
    while (switching) await switching
    if (tracked?.file.sessionId !== sessionId) return
    transcript = loaded
    // No transcript read: nothing to merge, nothing hidden.
    const t = loaded.path !== undefined ? loaded.t : undefined
    await commit($, cur => {
      const next = t ? { ...cur, ...mergeTurns(cur.file, cur.index, turnsOf(t)) } : cur
      const hidden = t ? viewOf(t, next.file, []).hidden : []
      const r = refill(next.file, { queue, running: cur.turn.exchangeId, hidden, fresh })
      unlabelled = r.unlabelled
      queue = r.queue
      return next
    })
    // A turn running now began inside what was read: its anchor is looked for from the start.
    if (!tracked?.turn.running) turnFrom = loaded.t.order.length
    await publishChain($)
  })

/**
 * Reads what the loaded transcript gained and brings its turns into the file and the row
 * index (mergeTurns, deduped by uuid), then publishes liveness. With `from`: the exchange
 * of the turn begun after row `from` (anchorSince), made the running turn's when no live
 * prompt append named one. Runs inside `serial`. Undefined: no transcript loaded.
 */
const readTailIn = async ($: EngineInterface, from?: number): Promise<{ t: LoadedTranscript; exchange: string | null | undefined } | undefined> => {
  const loaded = transcript
  const path = loaded?.path
  if (!loaded || path === undefined || tracked?.file.sessionId !== loaded.sessionId) return undefined
  const stats = await readNew($, loaded, path)
  if (stats.via !== 'read' && stats.via !== 'same') logRead($, 'tail', stats)
  const anchor = from === undefined ? undefined : anchorSince(loaded.t, from)
  let exchange: string | null | undefined = anchor
  await commit($, cur => {
    if (cur.file.sessionId !== loaded.sessionId) return cur
    const next = stats.via === 'same' ? cur : { ...cur, ...mergeTurns(cur.file, cur.index, turnsOf(loaded.t)) }
    if (!anchor) return next
    exchange = exchangeOfRow(next, anchor) ?? null
    return exchange ? onAnchor(next, exchange) : next
  })
  if (stats.via !== 'same') await publishChain($)
  return { t: loaded, exchange }
}

/**
 * Decision 5 (rewinds): an append carries no parentUuid, so after each prompt append
 * the transcript's tail is read to place the prompt on its chain, and liveness is
 * recomputed. A prompt not written yet is looked for again, up to TAIL_TRIES times.
 */
const placePrompt = ($: EngineInterface, uuid: string, tries = 1): Promise<void> =>
  serial(async () => {
    const r = await readTailIn($)
    if (r && !r.t.t.pos.has(uuid) && tries < TAIL_TRIES) $.clock.after(TAIL_RETRY_MS, () => void guard($, 'tail', () => placePrompt($, uuid, tries + 1)))
  })

/** The tail read on its own, for the turn events and the timer: the exchange of the turn begun after row `from`. */
const follow = ($: EngineInterface, from?: number) => serial(async () => (await readTailIn($, from))?.exchange)

/** turn.start: the new prompt row should be on disk; until the running turn has an exchange, look again. */
const followStart = async ($: EngineInterface, turn: number, tries = 1): Promise<void> => {
  if (turn !== turnCount || !tracked?.turn.running || tracked.turn.exchangeId) return
  await follow($, turnFrom)
  if (tracked?.turn.running && !tracked.turn.exchangeId && tries < TAIL_TRIES)
    $.clock.after(TAIL_RETRY_MS, () => void guard($, 'tail', () => followStart($, turn, tries + 1)))
}

/** An ended turn whose exchange the tail did not show yet: look again and queue it, until the next turn starts. */
const followEnded = async ($: EngineInterface, turn: number, from: number, tries = 1): Promise<void> => {
  if (turn !== turnCount) return
  const id = await follow($, from)
  if (id) queue = enqueue(queue, id)
  else if (tries < TAIL_TRIES) $.clock.after(TAIL_RETRY_MS, () => void guard($, 'tail', () => followEnded($, turn, from, tries + 1)))
}

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
    // The labeller reads the row index: bring in reply rows written since the turn ended.
    if (queue.length) await follow($)
    const t = tracked
    if (!t) return
    // Live exchanges only: a rewound one waits (pending) in case the conversation returns to it.
    const hidden = chainView?.hidden ?? []
    const step = headStep(t.file, queue, hidden)
    if (step.kind === 'drop') queue = queue.slice(1)
    if (step.kind !== 'label') return
    const { id } = step
    const sessionId = t.file.sessionId
    let result
    try {
      result = await askLabeller($, liveView(t.file, hidden), t.index, id)
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
      const s = settleLive(cur.file, hidden, id, result, MODEL)
      retry = s.retry
      return { ...cur, file: s.file }
    })
    queue = afterSettle(queue, retry)
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
  void guard($, 'mode', () => fixMode($))
  void guard($, 'here', () => updateHere($))
  void guard($, 'labeller', () => drain($))
  // The safety net for a withheld session.append: a running turn's rows, every 2 s.
  if (++ticks % FOLLOW_TICKS === 0 && tracked?.turn.running) void guard($, 'tail', async () => void (await follow($, turnFrom)))
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
      await registerMarksCommand($)
      // Ticket 06. `immediate`: it works while a turn runs (decision 11).
      await $.command
        .register({ name: 'mark', description: 'Bookmark the latest reply, or exchange #n: /mark [#n] [note]', immediate: true })
        .catch(err => log($, `register /mark: ${reasonOf(err)}`))
      await sync($)
      showStatus($, tracked?.file ?? null)
      if (config) await cleanUp($, config, await $.session.id())
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
      // The fast path. A row the tail read has brought in already is not applied twice.
      const known = transcript?.sessionId === tracked?.file.sessionId && transcript?.t.pos.has(e.uuid)
      if (known && e.message.name !== 'compact_boundary') return
      if (e.door === 'prompt' && e.origin.kind === 'composer' && !e.message.isMeta) {
        const text = promptText(e.message.content)
        await commit($, t => onPrompt(t, e.uuid, text), true)
        // A rewind shows only in the file: place the prompt on its chain from the transcript's tail.
        $.clock.after(TAIL_DELAY_MS, () => void guard($, 'tail', () => placePrompt($, e.uuid)))
      } else if (e.message.type === 'system' && e.message.name === 'compact_boundary') {
        // Decision 6: matched on name; everything before it is now out of the transcript's reach.
        log($, `compact_boundary door=${e.door}`)
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
    if (e.agentId === undefined) {
      const turn = ++turnCount
      await guard($, 'turn.start', () => commit($, onTurnStart))
      // Off the hook path: the prompt row from the transcript, when no prompt append names the exchange.
      $.clock.after(0, () => void guard($, 'tail', () => followStart($, turn)))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    // The tail first, so the exchange has its reply rows (and its id, with no prompt append);
    // then queue it for the labeller. The timer makes the call, never this dispatch.
    await guard($, 'turn.complete', async () => {
      const from = turnFrom
      await follow($, from)
      let id: string | null = null
      await commit($, t => {
        id = t.turn.exchangeId
        queue = enqueue(queue, id)
        return onTurnComplete(t)
      })
      if (transcript && transcript.sessionId === tracked?.file.sessionId) turnFrom = transcript.t.order.length
      const turn = turnCount
      if (!id) $.clock.after(TAIL_RETRY_MS, () => void guard($, 'tail', () => followEnded($, turn, from)))
    })
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    noteMode(e.viewport?.isFullscreen)
    if (e.props.hasSurvey) return next(e)
    // Unknown mode reads as fullscreen: the band says `here` (ticket 08).
    const fullscreen = (await readMode($, e.viewport?.isFullscreen)) !== false
    const file = await read($, fileA)
    const hereId = await read($, hereA)
    const off = await read($, offA)
    const chain = await read($, chainA)
    const left = unlabelledCount(file, chain)
    const live = liveFile(file, chain)
    const segments = band(live, {
      fullscreen,
      hereId,
      hint: off ? `labeller off: ${off}` : left ? `${left} unlabelled` : HINT,
    })
    if (!segments) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    // The whole band is one Button: a click opens the pane on the band's exchange (ticket 04).
    return (
      <Box flexDirection="row" width={e.props.bodyColumns}>
        <Button key="band" plain onPress={() => openFromBand($, live, { fullscreen, hereId })}>
          {segments.map(s => (
            <Text color={s.color} bold={s.bold} dimColor={s.dim} wrap="truncate">
              {s.text}
            </Text>
          ))}
        </Button>
      </Box>
    )
  })

  // `here`: these note which rows are on screen; the timer does the rest.
  // UserMessage also draws the inline markers (ticket 07): absolute Boxes over the engine's
  // row, so nothing moves; the divider over the blank spacer row 0, the glyph over `>` on row 1.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    noteOnScreen(e.requestId, e.props.onScreen)
    noteMode(e.viewport?.isFullscreen)
    // No markers on the main screen (ticket 08): its scrollback is frozen before labels land.
    if (e.requestId === 'placeholder' || e.props.isExpanded || e.props.origin.kind !== 'composer' || !e.viewport) return next(e)
    if ((await readMode($, e.viewport?.isFullscreen)) !== true) return next(e)
    // Read before drawing: the row redraws when its marker is written (a label landing).
    const marker = await read($, memberOf(markerA, e))
    const inner = await next(e)
    if (!marker) return inner
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {inner}
        {marker.divider !== undefined ? (
          <Box position="absolute" top={0} left={0}>
            <Text color={marker.color} wrap="truncate">
              {dividerLine(marker.divider, e.viewport.columns)}
            </Text>
          </Box>
        ) : null}
        {marker.glyph !== undefined ? (
          <Box position="absolute" top={1} left={0}>
            <Text color={marker.color}>{marker.glyph}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    noteOnScreen(e.requestId, e.props.onScreen)
    noteMode(e.viewport?.isFullscreen)
    return next(e)
  })

  // Ticket 06: `/mark` and the reader's bookmark menu. The file changes here, where `commit`
  // is: past an import `$` may only flow into function declarations. Returns no text: a
  // command's text is a transcript row the model reads, so the line goes to a toast (decision 9).
  on('command.run', { command: 'mark' }, async ($, e) => {
    await fixMode($, e.presentation?.isFullscreen)
    await sync($)
    const at = await isoNow($)
    // No conversation loaded: the edit never runs, so nothing to bookmark.
    let say = NO_EXCHANGE
    await editFile($, file => {
      const r = runMark(file, e.args, { rowsOf, isLive: x => isLive(chainView, x.id) }, at)
      say = r.say
      return r.file
    })
    $.ui.toast(say)
    return {}
  })

  // A pick in the reader's `m` menu, or its note, lands in the file before the pane's own
  // handler (the bottom of the chain) switches the view.
  on('ui.select', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const target = menuTarget(e.element)
    if (target?.kind === 'pick') {
      const at = await isoNow($)
      await guard($, 'bookmark menu', () => editFile($, f => pickMark(f, target.id, e.value, rowsOf(target.id), at).file))
    }
    return next(e)
  })
  on('ui.input', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const target = menuTarget(e.element)
    if (target?.kind === 'note' && e.kind === 'submit') await guard($, 'bookmark note', () => editFile($, f => noteManual(f, target.id, e.value)))
    return next(e)
  })

  registerPane(on, rowsOf)
}
