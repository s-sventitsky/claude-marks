// The pane (tickets 04, 05, 06): `/marks`, the tree drawn as Buttons, Enter's jump, and the
// reader on one exchange with its bookmark menu. Thin adapters over lib/tree, lib/reader,
// lib/pane and lib/bookmarks; register.tsx wires them in with registerPane(on, rowsOf).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { ChainView, ConversationFile, Exchange, PaneState, PaneView, ReaderMenu } from '../types/index'
import { GLYPH, type Here } from './lib/band'
import { anchorOf, heldValue, markMenu, menuKey, noteKey } from './lib/bookmarks'
import { isLive, isReachable } from './lib/chain'
import { exchangeById, liveExchanges, type ChainOptions } from './lib/model'
import {
  PANE_ID,
  PANE_ROWS,
  REASON,
  afterJump,
  bandTarget,
  enterAction,
  exchangeKey,
  hotkeyKey,
  isNarrow,
  isTreeRowKey,
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
import { log, reasonOf } from './log'
import { fixMode, noteMode, readMode, type Mode } from './mode'

const paneA = atom({ plugin: 'marks', key: 'pane' } as const, { target: null, lastJump: null, view: { kind: 'tree' } } as PaneState)
// The engine's scan wants each atom a module reads as a const of that file: these
// repeat register.tsx's. Keep the shape tag in step with it.
const fileA = atom({ plugin: 'marks', key: 'conv' } as const, null, { shape: 'conv-1' })
const hereA = atom({ plugin: 'marks', key: 'here' } as const, null)
const chainA = atom({ plugin: 'marks', key: 'chain' } as const, null)

/** Retaking the keys after a refused Esc waits this long, so the refusal lands first. */
const RETAKE_MS = 30
const TREE: PaneView = { kind: 'tree' }
/** The pane's window; opening an open id re-focuses it. */
const PANE_WINDOW = { id: PANE_ID, title: 'marks', focus: true, closeOnEscape: true, rows: PANE_ROWS } as const

/** The last tree row (`ex:` or `th:` key) the ring moved onto; `p` reads its exchange. Lost on reload. */
let focusedRow: string | null = null

/** The row index entry of an exchange (register.tsx's `tracked.index`, not in $.state). */
export type RowsOf = (id: string) => ExchangeRows | undefined

/** Liveness and reachability (ticket 03) as the tree's and Enter's predicates. A null view: all live and reachable. */
const liveOf = (chain: ChainView | null) => (x: Exchange) => isLive(chain, x.id)
const reachOf = (chain: ChainView | null, fullscreen: boolean) => (x: Exchange) => isReachable(chain, x.id, fullscreen)

/** Moves the ring onto `key`; the kit cannot answer, so a rejection is only logged. */
async function focusOn($: EngineInterface, key: string) {
  const f = await $.ui.focus({ requestId: PANE_ID, key }).catch(err => ({ deny: reasonOf(err) }))
  if (f.deny) log($, `focus ${key}: ${f.deny}`)
}

/** Opens (or re-focuses) the pane on the tree, its cursor on exchange `target`. */
export async function openPane($: EngineInterface, target: string | undefined) {
  focusedRow = null
  await update($, paneA, p => ({ ...p, target: target ?? null, view: TREE }))
  const r = await $.ui.open(PANE_WINDOW)
  if (!r.isPlaced) {
    log($, `pane not placed: ${r.reason}`)
    return
  }
  if (!target) return
  // autoFocus covers a fresh pane; these move the ring and the window on one already open.
  // The kit cannot answer either call, so a rejection is only logged.
  const key = exchangeKey(target)
  const f = await $.ui.focus({ requestId: PANE_ID, key }).catch(err => ({ deny: reasonOf(err) }))
  const s = await $.ui.scroll({ in: PANE_ID, to: { key }, block: 'center' }).catch(err => ({ deny: reasonOf(err) }))
  if (f.deny || s.deny) log($, `open on ${target}: focus ${f.deny ?? 'ok'}, scroll ${s.deny ?? 'ok'}`)
}

/** Opens the pane on the band's exchange (a band click). */
export async function openFromBand($: EngineInterface, file: ConversationFile | null, o: Here) {
  await openPane($, bandTarget(file, o))
}

/** The reader on exchange `id`; `deny` when the engine refused a jump to it. The ring goes to its first key. */
async function showReader($: EngineInterface, id: string, deny?: string) {
  const view: PaneView = deny ? { kind: 'reader', id, deny } : { kind: 'reader', id }
  await update($, paneA, p => ({ ...p, view }))
  await focusOn($, hotkeyKey('j'))
}

/** Back to the tree, cursor on exchange `id`. */
async function showTree($: EngineInterface, id: string) {
  focusedRow = exchangeKey(id)
  await update($, paneA, p => ({ ...p, target: id, view: TREE }))
}

/** The reader's bookmark menu (ticket 06): open (`pick`), the note field (`note`), or closed; the ring follows. */
async function showMenu($: EngineInterface, id: string, menu: ReaderMenu | undefined) {
  const view: PaneView = menu ? { kind: 'reader', id, menu } : { kind: 'reader', id }
  await update($, paneA, p => ({ ...p, view }))
  await focusOn($, menu === 'pick' ? menuKey(id) : menu === 'note' ? noteKey(id) : hotkeyKey('m'))
}

/**
 * Enter on a row, or `g` in the reader: scroll the transcript to the anchor inside the
 * press (a transcript row moves only while answering the person's input), then close
 * and remember. Unreachable, the main screen, or a denied jump: the reader instead.
 * `row`: a manual bookmark's reply row (ticket 06), tried first; denied, the prompt row.
 */
async function enter($: EngineInterface, id: string, seen: Mode, row?: string) {
  const fullscreen = await readMode($, seen)
  const file = await read($, fileA)
  const act = file && enterAction(file, id, { fullscreen, isReachable: reachOf(await read($, chainA), true) })
  if (!act) return
  // The reader works out the reason itself (lib/reader), from the same facts.
  if (act.kind === 'reader') return showReader($, act.id)
  const scroll = (to: string) => $.ui.scroll({ to: { requestId: to }, block: 'start' }).catch(err => ({ deny: reasonOf(err) }))
  let r = row && row !== act.to ? await scroll(row) : { deny: undefined as string | undefined }
  if (row && row !== act.to && r.deny) log($, `jump to reply row ${row}: ${r.deny}; the prompt row instead`)
  if (!row || row === act.to || r.deny) r = await scroll(act.to)
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
    await fixMode($, e.presentation?.isFullscreen)
    const usage = marksUsage(e.args)
    if (usage) {
      $.ui.toast(usage)
      return {}
    }
    const pane = await read($, paneA)
    await openPane($, openTarget(await read($, fileA), pane.lastJump, liveOf(await read($, chainA))))
    return {}
  })

  // Esc (closeOnEscape) and the × mark in the reader go back to the tree, the pane kept open;
  // in the reader's bookmark menu, back to the reader.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE_ID) return next(e)
    const view = paneView(await read($, paneA))
    const act = onPaneClose(view, e.origin.kind)
    if (act === 'pass' || view.kind !== 'reader') return next(e)
    if (act === 'to-reader') await update($, paneA, p => ({ ...p, view: { kind: 'reader', id: view.id } as PaneView }))
    else await showTree($, view.id)
    // Esc already handed the keys to the prompt; once the refusal lands, take them back.
    // An open id is not re-created: open re-delivers the focus request.
    $.clock.after(RETAKE_MS, async () => {
      const r = await $.ui.open(PANE_WINDOW).catch(err => ({ isPlaced: false, reason: reasonOf(err) }))
      if (!r.isPlaced) log($, `back to ${act === 'to-reader' ? 'reader' : 'tree'}: not placed (${'reason' in r ? r.reason : ''})`)
      await focusOn($, act === 'to-reader' ? hotkeyKey('m') : exchangeKey(view.id))
    })
    // Answering without next keeps the pane open (person and plugin closes, never unload).
    return { value: undefined }
  })

  // Which tree row holds the ring, for `p`. Keys and engine stops leave the last row standing.
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const r = await next(e)
    if (!r.deny && e.element && isTreeRowKey(e.element)) focusedRow = e.element
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const file = await read($, fileA)
    const pane = await read($, paneA)
    const hereId = await read($, hereA)
    const chain = await read($, chainA)
    const { Box, Text, Button, Markdown, Select, Input } = $.ui.resolve(e)
    noteMode(e.viewport?.isFullscreen)
    const fullscreen = await readMode($, e.viewport?.isFullscreen)
    const columns = e.props.bodyColumns
    // Unknown viewport (undefined) counts as fullscreen, as Enter tries the jump then.
    const chainOptions: ChainOptions = { isLive: liveOf(chain), isReachable: reachOf(chain, fullscreen !== false), unlabelled: chain?.unlabelled }

    /** A key line: hotkeys as plain Buttons (`p: read`), dim and inert when they can't act; the rest as text. */
    const keyLine = (keys: KeyHint[], act: Record<string, () => unknown>) => (
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {keys.map(k =>
          k.hotkey ? (
            <Button key={hotkeyKey(k.hotkey)} plain hotkey={k.hotkey} dimColor={!k.enabled || undefined} onPress={k.enabled ? () => act[k.hotkey as string]?.() : () => undefined}>
              {k.label}
            </Button>
          ) : (
            <Text dimColor>{k.label}</Text>
          ),
        )}
      </Box>
    )

    const view = paneView(pane)
    const reader = file && view.kind === 'reader' ? readerModel(file, view.id, { fullscreen, ...chainOptions, deny: view.deny, rows: rowsOf(view.id) }) : undefined
    // A reader whose exchange is gone (a rewind hid it) falls back to the tree.
    if (reader) {
      const rule = <Text dimColor>{'─'.repeat(Math.max(1, columns))}</Text>
      const x = file ? exchangeById(file, reader.id) : undefined
      const rows = rowsOf(reader.id)
      const menu = view.kind === 'reader' ? view.menu : undefined
      return (
        <Box flexDirection="column">
          {keyLine(readerKeys(reader), {
            j: () => reader.next && showReader($, reader.next),
            k: () => reader.prev && showReader($, reader.prev),
            g: () => enter($, reader.id, fullscreen),
            m: () => showMenu($, reader.id, 'pick'),
          })}
          <Box flexDirection="row">
            {reader.path.map(s => (
              <Text color={s.color} bold={s.bold} dimColor={s.dim} wrap="truncate">
                {s.text}
              </Text>
            ))}
            <Text dimColor wrap="truncate">{` · #${reader.n} · ${reader.i} of ${reader.k} in thread`}</Text>
          </Box>
          {reader.reason ? <Text color="warning">{reader.reason}</Text> : null}
          {reader.bookmarks.map(b =>
            // The manual bookmark's line jumps to its row (prompt row when that can't be found).
            b.glyph === GLYPH.manual && reader.canJump && x ? (
              <Button key="mark:jump" plain onPress={() => enter($, reader.id, fullscreen, anchorOf(x, rows))}>
                <Text color={b.color}>{`${b.glyph} `}</Text>
                <Text dimColor>{b.text}</Text>
              </Button>
            ) : (
              <Box flexDirection="row">
                <Text color={b.color}>{`${b.glyph} `}</Text>
                <Text dimColor>{b.text}</Text>
              </Box>
            ),
          )}
          {/* The menu and the note change the file in register.tsx's ui.select / ui.input hooks, before these handlers. */}
          {menu === 'pick' && x ? (
            <Select
              key={menuKey(reader.id)}
              label="bookmark"
              options={markMenu(x, rows)}
              autoFocus
              onSelect={v => void showMenu($, reader.id, v === heldValue(x, rows) ? undefined : 'note')}
            />
          ) : null}
          {menu === 'note' ? (
            <Input key={noteKey(reader.id)} label="note" placeholder="Enter for none" submitLabel="save" autoFocus onSubmit={() => void showMenu($, reader.id, undefined)} />
          ) : null}
          {rule}
          {reader.prompts.map(p => (
            <Box flexDirection="row">
              <Text color="suggestion">{'> '}</Text>
              <Text>{p}</Text>
            </Box>
          ))}
          {rule}
          {reader.replies.length ? reader.replies.map((text, i) => <Markdown key={`reply:${i}`} text={text} />) : <Text dimColor>No reply text.</Text>}
        </Box>
      )
    }

    // The main screen's standing footer (spec "Main screen"), above the key line.
    const footer = fullscreen === false ? <Text dimColor>{REASON.mainScreen}</Text> : null
    if (!file || !file.exchanges.length) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No exchanges yet.</Text>
          {footer}
          {keyLine(treeKeys({ fullscreen }), {})}
        </Box>
      )
    }
    const rows = layoutTree(file, {
      columns,
      narrow: isNarrow(e.props.placement, columns),
      lastJump: pane.lastJump,
      bandId: bandTarget({ ...file, exchanges: liveExchanges(file, chainOptions.isLive) }, { fullscreen: fullscreen !== false, hereId }),
      ...chainOptions,
    })
    const held = pane.target
    const target = held && rows.some(r => r.key === exchangeKey(held)) ? held : openTarget(file, null, chainOptions.isLive)
    const readFocused = () => {
      const id = readTarget(rows, focusedRow, target ?? undefined)
      return id && showReader($, id)
    }
    return (
      <Box flexDirection="column">
        {rows.map(r => (
          <Button key={r.key} plain autoFocus={(target && r.key === exchangeKey(target)) || undefined} onPress={() => enter($, r.target, fullscreen)}>
            {r.segments.map(s => (
              <Text color={s.color} bold={s.bold} dimColor={s.dim}>
                {s.text}
              </Text>
            ))}
          </Button>
        ))}
        {footer}
        {keyLine(treeKeys({ fullscreen }), { p: readFocused })}
      </Box>
    )
  })
}
