// The pane (tickets 04, 05): `/marks`, the tree drawn as Buttons, Enter's jump, and the
// reader on one exchange. Thin adapters over lib/tree, lib/reader and lib/pane;
// register.tsx wires them in with registerPane(on, rowsOf).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { ChainView, ConversationFile, Exchange, PaneState, PaneView } from '../types/index'
import { isLive, isReachable } from './lib/chain'
import {
  PANE_ID,
  PANE_ROWS,
  afterJump,
  bandTarget,
  enterAction,
  isNarrow,
  marksUsage,
  onPaneClose,
  openTarget,
  paneView,
  readTarget,
  readerKeys,
  treeKeys,
  type KeyHint,
} from './lib/pane'
import { readerModel } from './lib/reader'
import type { ExchangeRows } from './lib/rows'
import { layoutTree } from './lib/tree'

const paneA = atom({ plugin: 'marks', key: 'pane' } as const, { target: null, lastJump: null, view: { kind: 'tree' } } as PaneState)
// The engine's scan wants each atom a module reads as a const of that file: these two
// repeat register.tsx's. Keep the shape tag in step with it.
const conv = atom({ plugin: 'marks', key: 'conv' } as const, null, { shape: 'conv-1' })
const hereA = atom({ plugin: 'marks', key: 'here' } as const, null)
const chainA = atom({ plugin: 'marks', key: 'chain' } as const, null)

/** Retaking the keys after a refused Esc waits this long, so the refusal lands first. */
const RETAKE_MS = 30
const TREE: PaneView = { kind: 'tree' }

/** The last tree row (`ex:` or `th:` key) the ring moved onto; `p` reads its exchange. Lost on reload. */
let focusedRow: string | null = null

/** The row index entry of an exchange (register.tsx's `tracked.index`, not in $.state). */
export type RowsOf = (id: string) => ExchangeRows | undefined

/** Liveness and reachability (ticket 03) as the tree's and Enter's predicates. A null view: all live and reachable. */
const liveOf = (chain: ChainView | null) => (x: Exchange) => isLive(chain, x.id)
const reachOf = (chain: ChainView | null, fullscreen: boolean) => (x: Exchange) => isReachable(chain, x.id, fullscreen)

function log($: EngineInterface, text: string) {
  $.ui.log(`marks: ${text}`, { to: 'debug' })
}
const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Moves the ring onto `key`; the kit cannot answer, so a rejection is only logged. */
async function focusOn($: EngineInterface, key: string) {
  const f = await $.ui.focus({ requestId: PANE_ID, key }).catch(err => ({ deny: reasonOf(err) }))
  if (f.deny) log($, `focus ${key}: ${f.deny}`)
}

/** Opens (or re-focuses) the pane on the tree, its cursor on exchange `target`. */
export async function openPane($: EngineInterface, target: string | undefined) {
  focusedRow = null
  await update($, paneA, p => ({ ...p, target: target ?? null, view: TREE }))
  const r = await $.ui.open({ id: PANE_ID, title: 'marks', focus: true, closeOnEscape: true, rows: PANE_ROWS })
  if (!r.isPlaced) {
    log($, `pane not placed: ${r.reason}`)
    return
  }
  if (!target) return
  // autoFocus covers a fresh pane; these move the ring and the window on one already open.
  // The kit cannot answer either call, so a rejection is only logged.
  const key = `ex:${target}`
  const f = await $.ui.focus({ requestId: PANE_ID, key }).catch(err => ({ deny: reasonOf(err) }))
  const s = await $.ui.scroll({ in: PANE_ID, to: { key }, block: 'center' }).catch(err => ({ deny: reasonOf(err) }))
  if (f.deny || s.deny) log($, `open on ${target}: focus ${f.deny ?? 'ok'}, scroll ${s.deny ?? 'ok'}`)
}

/** Opens the pane on the band's exchange (a band click). */
export async function openFromBand($: EngineInterface, file: ConversationFile | null, o: { fullscreen: boolean; hereId: string | null }) {
  await openPane($, bandTarget(file, o))
}

/** The reader on exchange `id`; `deny` when the engine refused a jump to it. The ring goes to its first key. */
async function showReader($: EngineInterface, id: string, deny?: string) {
  const view: PaneView = deny ? { kind: 'reader', id, deny } : { kind: 'reader', id }
  await update($, paneA, p => ({ ...p, view }))
  await focusOn($, 'key:j')
}

/** Back to the tree, cursor on exchange `id`. */
async function showTree($: EngineInterface, id: string) {
  focusedRow = `ex:${id}`
  await update($, paneA, p => ({ ...p, target: id, view: TREE }))
}

/**
 * Enter on a row, or `g` in the reader: scroll the transcript to the anchor inside the
 * press (a transcript row moves only while answering the person's input), then close
 * and remember. Unreachable, the main screen, or a denied jump: the reader instead.
 */
async function enter($: EngineInterface, id: string, fullscreen: boolean | undefined) {
  const file = await read($, conv)
  const act = file && enterAction(file, id, { fullscreen, isReachable: reachOf(await read($, chainA), true) })
  if (!act) return
  // The reader works out the reason itself (lib/reader), from the same facts.
  if (act.kind === 'reader') return showReader($, act.id)
  const r = await $.ui.scroll({ to: { requestId: act.to }, block: 'start' }).catch(err => ({ deny: reasonOf(err) }))
  const out = afterJump(r)
  if (!out.close) return showReader($, act.to, out.note)
  await $.ui.close({ id: PANE_ID }).catch(err => log($, `close after jump: ${reasonOf(err)}`))
  await update($, paneA, p => ({ ...p, lastJump: act.to, view: TREE }))
}

/** Registers `/marks`; called from register.tsx's session.start (one unmatched hook per event). */
export async function registerMarksCommand($: EngineInterface) {
  await $.command
    .register({ name: 'marks', description: 'Open the thread tree and jump to an exchange', immediate: true })
    .catch(err => log($, `register /marks: ${reasonOf(err)}`))
}

export function registerPane(on: On, rowsOf: RowsOf) {
  // Returns no text: a command's text is a transcript row the model reads.
  // Usage goes to a toast for the same reason (decision 9).
  on('command.run', { command: 'marks' }, async ($, e) => {
    const usage = marksUsage(e.args)
    if (usage) {
      $.ui.toast(usage)
      return {}
    }
    const pane = await read($, paneA)
    await openPane($, openTarget(await read($, conv), pane.lastJump, liveOf(await read($, chainA))))
    return {}
  })

  // Esc (closeOnEscape) and the × mark in the reader go back to the tree, the pane kept open.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE_ID) return next(e)
    const view = paneView(await read($, paneA))
    if (onPaneClose(view, e.origin.kind) === 'pass' || view.kind !== 'reader') return next(e)
    await showTree($, view.id)
    // Esc already handed the keys to the prompt; once the refusal lands, take them back.
    // An open id is not re-created: open re-delivers the focus request.
    $.clock.after(RETAKE_MS, async () => {
      const r = await $.ui.open({ id: PANE_ID, title: 'marks', focus: true, closeOnEscape: true, rows: PANE_ROWS }).catch(err => ({ isPlaced: false, reason: reasonOf(err) }))
      if (!r.isPlaced) log($, `back to tree: not placed (${'reason' in r ? r.reason : ''})`)
      await focusOn($, `ex:${view.id}`)
    })
    // Answering without next keeps the pane open (person and plugin closes, never unload).
    return { value: undefined }
  })

  // Which tree row holds the ring, for `p`. Keys and engine stops leave the last row standing.
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const r = await next(e)
    if (!r.deny && e.element && /^(ex|th):/.test(e.element)) focusedRow = e.element
    return r
  })

  on('ui.render', { component: 'Pane', requestId: 'marks' }, async ($, e) => {
    const file = await read($, conv)
    const pane = await read($, paneA)
    const hereId = await read($, hereA)
    const chain = await read($, chainA)
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const fullscreen = e.viewport?.isFullscreen
    const W = e.props.bodyColumns
    const isLiveX = liveOf(chain)
    // Unknown viewport (undefined) counts as fullscreen, as Enter tries the jump then.
    const isReachableX = reachOf(chain, fullscreen !== false)

    /** A key line: hotkeys as plain Buttons (`p: read`), dim and inert when they can't act; the rest as text. */
    const keyLine = (keys: KeyHint[], act: Record<string, () => unknown>) => (
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {keys.map(k =>
          k.hotkey ? (
            <Button key={`key:${k.hotkey}`} plain hotkey={k.hotkey} dimColor={!k.enabled || undefined} onPress={k.enabled ? () => act[k.hotkey as string]?.() : () => undefined}>
              {k.label}
            </Button>
          ) : (
            <Text dimColor>{k.label}</Text>
          ),
        )}
      </Box>
    )

    const view = paneView(pane)
    const m =
      file && view.kind === 'reader'
        ? readerModel(file, view.id, {
            fullscreen,
            isLive: isLiveX,
            isReachable: isReachableX,
            unlabelled: chain?.unlabelled,
            deny: view.deny,
            rows: rowsOf(view.id),
          })
        : undefined
    // A reader whose exchange is gone (a rewind hid it) falls back to the tree.
    if (m) {
      const rule = <Text dimColor>{'─'.repeat(Math.max(1, W))}</Text>
      return (
        <Box flexDirection="column">
          {keyLine(readerKeys(m), {
            j: () => m.next && showReader($, m.next),
            k: () => m.prev && showReader($, m.prev),
            g: () => enter($, m.id, fullscreen),
          })}
          <Box flexDirection="row">
            {m.path.map(s => (
              <Text color={s.color} bold={s.bold} dimColor={s.dim} wrap="truncate">
                {s.text}
              </Text>
            ))}
            <Text dimColor wrap="truncate">{` · #${m.n} · ${m.i} of ${m.k} in thread`}</Text>
          </Box>
          {m.reason ? <Text color="warning">{m.reason}</Text> : null}
          {m.bookmarks.map(b => (
            <Box flexDirection="row">
              <Text color={b.color}>{`${b.glyph} `}</Text>
              <Text dimColor>{b.text}</Text>
            </Box>
          ))}
          {rule}
          {m.prompts.map(p => (
            <Box flexDirection="row">
              <Text color="suggestion">{'> '}</Text>
              <Text>{p}</Text>
            </Box>
          ))}
          {rule}
          {m.replies.length ? m.replies.map((text, i) => <Markdown key={`reply:${i}`} text={text} />) : <Text dimColor>No reply text.</Text>}
        </Box>
      )
    }

    if (!file || !file.exchanges.length) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No exchanges yet.</Text>
          {keyLine(treeKeys({ fullscreen }), {})}
        </Box>
      )
    }
    const rows = layoutTree(file, {
      columns: W,
      narrow: isNarrow(e.props.placement, W),
      lastJump: pane.lastJump,
      bandId: bandTarget({ ...file, exchanges: file.exchanges.filter(isLiveX) }, { fullscreen: fullscreen === true, hereId }),
      isReachable: isReachableX,
      isLive: isLiveX,
      unlabelled: chain?.unlabelled,
    })
    const target = rows.some(r => r.key === `ex:${pane.target}`) ? pane.target : openTarget(file, null, isLiveX)
    const readFocused = () => {
      const id = readTarget(rows, focusedRow, target ?? undefined)
      return id && showReader($, id)
    }
    return (
      <Box flexDirection="column">
        {rows.map(r => (
          <Button key={r.key} plain autoFocus={r.key === `ex:${target}` || undefined} onPress={() => enter($, r.target, fullscreen)}>
            {r.segments.map(s => (
              <Text color={s.color} bold={s.bold} dimColor={s.dim}>
                {s.text}
              </Text>
            ))}
          </Button>
        ))}
        {keyLine(treeKeys({ fullscreen }), { p: readFocused })}
      </Box>
    )
  })
}
