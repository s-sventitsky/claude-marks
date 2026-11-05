// The pane (ticket 04): `/marks`, the tree drawn as Buttons, Enter's jump. Thin adapters
// over lib/tree and lib/pane; register.tsx wires them in with registerPane(on).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { ChainView, ConversationFile, Exchange, PaneState } from '../types/index'
import { isLive, isReachable } from './lib/chain'
import { PANE_ID, PANE_ROWS, afterJump, bandTarget, enterAction, isNarrow, marksUsage, openTarget, treeKeys } from './lib/pane'
import { layoutTree } from './lib/tree'

const paneA = atom({ plugin: 'marks', key: 'pane' } as const, { target: null, lastJump: null, note: null } as PaneState)
// The engine's scan wants each atom a module reads as a const of that file: these two
// repeat register.tsx's. Keep the shape tag in step with it.
const conv = atom({ plugin: 'marks', key: 'conv' } as const, null, { shape: 'conv-1' })
const hereA = atom({ plugin: 'marks', key: 'here' } as const, null)
const chainA = atom({ plugin: 'marks', key: 'chain' } as const, null)

/** Liveness and reachability (ticket 03) as the tree's and Enter's predicates. A null view: all live and reachable. */
const liveOf = (chain: ChainView | null) => (x: Exchange) => isLive(chain, x.id)
const reachOf = (chain: ChainView | null, fullscreen: boolean) => (x: Exchange) => isReachable(chain, x.id, fullscreen)

function log($: EngineInterface, text: string) {
  $.ui.log(`marks: ${text}`, { to: 'debug' })
}
const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Opens (or re-focuses) the pane with its cursor on exchange `target`. */
export async function openPane($: EngineInterface, target: string | undefined) {
  await update($, paneA, p => ({ ...p, target: target ?? null, note: null }))
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

/**
 * Enter on a row: scroll the transcript to the anchor inside the press (a transcript
 * row moves only while answering the person's input), then close and remember.
 */
async function enter($: EngineInterface, id: string, fullscreen: boolean | undefined) {
  const file = await read($, conv)
  const act = file && enterAction(file, id, { fullscreen, isReachable: reachOf(await read($, chainA), true) })
  if (!act) return
  if (act.kind === 'reader') {
    // TODO(05): open the reader with act.reason instead of the footer line.
    await update($, paneA, p => ({ ...p, note: act.reason }))
    return
  }
  const r = await $.ui.scroll({ to: { requestId: act.to }, block: 'start' }).catch(err => ({ deny: reasonOf(err) }))
  const out = afterJump(r)
  if (!out.close) {
    await update($, paneA, p => ({ ...p, note: out.note }))
    return
  }
  await $.ui.close({ id: PANE_ID }).catch(err => log($, `close after jump: ${reasonOf(err)}`))
  await update($, paneA, p => ({ ...p, lastJump: act.to, note: null }))
}

/** Registers `/marks`; called from register.tsx's session.start (one unmatched hook per event). */
export async function registerMarksCommand($: EngineInterface) {
  await $.command
    .register({ name: 'marks', description: 'Open the thread tree and jump to an exchange', immediate: true })
    .catch(err => log($, `register /marks: ${reasonOf(err)}`))
}

export function registerPane(on: On) {
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

  on('ui.render', { component: 'Pane', requestId: 'marks' }, async ($, e) => {
    const file = await read($, conv)
    const pane = await read($, paneA)
    const hereId = await read($, hereA)
    const chain = await read($, chainA)
    const { Box, Text, Button } = $.ui.resolve(e)
    const fullscreen = e.viewport?.isFullscreen
    const W = e.props.bodyColumns
    const footer = (
      <Box flexDirection="column">
        {pane.note ? (
          <Text color="warning" wrap="truncate">
            {pane.note}
          </Text>
        ) : null}
        <Text dimColor wrap="truncate">
          {treeKeys({ fullscreen })
            .map(k => k.label)
            .join(' · ')}
        </Text>
      </Box>
    )
    if (!file || !file.exchanges.length) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No exchanges yet.</Text>
          {footer}
        </Box>
      )
    }
    const isLiveX = liveOf(chain)
    const rows = layoutTree(file, {
      columns: W,
      narrow: isNarrow(e.props.placement, W),
      lastJump: pane.lastJump,
      bandId: bandTarget({ ...file, exchanges: file.exchanges.filter(isLiveX) }, { fullscreen: fullscreen === true, hereId }),
      // Unknown viewport (undefined) counts as fullscreen, as Enter tries the jump then.
      isReachable: reachOf(chain, fullscreen !== false),
      isLive: isLiveX,
      unlabelled: chain?.unlabelled,
    })
    const target = rows.some(r => r.key === `ex:${pane.target}`) ? pane.target : openTarget(file, null, isLiveX)
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
        {footer}
      </Box>
    )
  })
}
