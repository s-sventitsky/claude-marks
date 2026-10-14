import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SpikeMode, SpikeView } from '../types'

// SPIKE, throw away. ".scratch/claude-marks/issues/14-bottom-panel-spike.md".
// /ask-spike [tree|wrap|rewrite|stock] raises the engine's AskUserQuestion dialog through
// $.ui.ask and redraws it as a pick-and-go tree. Every fact goes to the log file.

const LOGDIR = 'C:/Projs/claude-marks/.scratch/claude-marks/research/spike-14'
const Q = 'claude-marks spike: pick a point?'
const TAG = 'claude-marks'
const MODES: SpikeMode[] = ['tree', 'wrap', 'hide', 'rewrite', 'stock']

const modeA = atom({ plugin: 'marks-ask-spike', key: 'mode' } as const, 'tree' as SpikeMode)
const viewA = atom({ plugin: 'marks-ask-spike', key: 'view' } as const, 'tree' as SpikeView)
const topA = atom({ plugin: 'marks-ask-spike', key: 'top' } as const, 0)

// Module state (a spike; a reload starts over, which is fine).
const facts: Record<string, unknown>[] = []
let logPath = ''
let askOpenAt = 0 // ms; >0 while our dialog is up
let ourId = ''
let closer: ((label: string) => void) | undefined
const prompts: string[] = [] // composer prompt uuids, oldest first

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  n: i + 1,
  label: i % 6 === 0 ? `Thread ${i / 6 + 1}` : `  exchange ${i + 1}: a gist of what happened here`,
}))
// Hotkeys on the first rows: digits and letters, to see which the dialog keeps.
const HOT = ['1', '2', '3', 'a', 'b', 'c']

function log($: EngineInterface, what: string, data: Record<string, unknown> = {}) {
  facts.push({ t: new Date().toISOString(), what, ...data })
  if (logPath) void $.fs.write(logPath, JSON.stringify(facts, null, 1)).catch(() => {})
}

const isOurs = (p: { questions: unknown[]; metadataSource?: string }, requestId: string) =>
  p.metadataSource === TAG ||
  (ourId !== '' && requestId === ourId) ||
  (p.questions[0] as { question?: string } | undefined)?.question === Q

async function jump($: EngineInterface, which: 'latest' | 'oldest') {
  const id = which === 'latest' ? prompts[prompts.length - 1] : prompts[0]
  if (!id) return log($, 'jump.skip', { which, reason: 'no prompt recorded yet' })
  const r = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
  log($, 'jump', { which, id, result: r })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    logPath = `${LOGDIR}/log-${Date.now()}.json`
    await $.command.register({
      name: 'ask-spike',
      description: 'Spike: open the marks tree in the AskUserQuestion dialog',
      argumentHint: 'wrap|hide|tree|rewrite|stock',
    })
    log($, 'session.start', { session: await $.session.id() })
    return next(e)
  })

  on('session.append', async ($, e, next) => {
    if (e.door === 'prompt' && !e.agentId) prompts.push(e.uuid)
    const body = JSON.stringify(e.message).slice(0, 4000)
    if (askOpenAt || body.includes('AskUserQuestion') || body.includes(Q))
      log($, 'append', { door: e.door, uuid: e.uuid, origin: e.origin, mentionsAsk: body.includes('AskUserQuestion'), mentionsQ: body.includes(Q), head: body.slice(0, 300) })
    return next(e)
  })

  on('command.run', { command: 'ask-spike' }, async ($, e) => {
    const arg = e.args.trim() as SpikeMode
    const mode = MODES.includes(arg) ? arg : 'wrap'
    await update($, modeA, () => mode)
    await update($, viewA, () => 'tree' as SpikeView)
    await update($, topA, () => 0)
    askOpenAt = Date.now()
    log($, 'ask.raise', { mode, presentation: e.presentation })
    void $.ui
      .ask(Q, { options: ['Close', 'Keep going'], header: 'marks' })
      .then(
        answer => log($, 'ask.resolved', { answer, ms: Date.now() - askOpenAt }),
        err => log($, 'ask.rejected', { err: String(err), ms: Date.now() - askOpenAt }),
      )
      .finally(() => {
        askOpenAt = 0
        closer = undefined
      })
    return { text: `ask-spike: ${mode}` }
  })

  // Tag our own ask, and let a press close it by answering for the dialog.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const q = (e.questions[0] as { question?: string } | undefined)?.question
    const ours = q === Q
    log($, 'tool.call', { id: e.tool_use_id, ours, question: q, metadata: e.metadata })
    if (!ours) return next(e)
    ourId = e.tool_use_id ?? ''
    const tagged = { ...e, metadata: { ...(e.metadata ?? {}), source: TAG } }
    const pressed = new Promise<string>(res => (closer = res))
    const ran = next(tagged).then(r => ({ by: 'dialog' as const, r }))
    const won = await Promise.race([ran, pressed.then(label => ({ by: 'mod' as const, label }))])
    log($, 'tool.call.settled', { by: won.by, result: 'r' in won ? won.r : undefined })
    if (won.by === 'dialog') return won.r
    void ran.then(r => log($, 'tool.call.late-dialog-result', { r }))
    return { result: { questions: e.questions, answers: { [Q]: won.label } } } as never
  })

  on('ui.focus', async ($, e, next) => {
    if (askOpenAt) log($, 'ui.focus', { e })
    return next(e)
  })

  on('ui.press', async ($, e, next) => {
    log($, 'ui.press', { component: e.component, element: e.element, requestId: e.requestId })
    return next(e)
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const ours = isOurs(e.props, e.requestId)
    const mode = await read($, modeA)
    log($, 'render', { requestId: e.requestId, ours, mode, metadataSource: e.props.metadataSource, nQuestions: e.props.questions.length, viewport: e.viewport, surface: e.surface })
    if (!ours || mode === 'stock') return next(e)
    if (mode === 'rewrite') {
      const q0 = e.props.questions[0] as Record<string, unknown>
      return next({ ...e, props: { ...e.props, questions: [{ ...q0, question: `${Q} (rewritten by the mod)` }] } })
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const view = await read($, viewA)
    const top = await read($, topA)
    const vp = e.viewport
    // Run 2: at most 12 rows around the dialog, each Button counted as a row at least.
    const room = 8
    const close = (label: string) => () => {
      log($, 'close.press', { label, haveCloser: !!closer })
      closer?.(label)
    }
    const labelOf = (n: number, label: string) =>
      n === 1 ? 'jump to latest prompt + close' : n === 2 ? 'jump to oldest prompt (stay open)' : label

    const controls = (
      <Box flexDirection="row" gap={1}>
        <Button key="down" hotkey="j" onPress={() => update($, topA, t => (t + room >= ROWS.length ? 0 : t + room))}>
          next page
        </Button>
        <Button key="reader" hotkey="r" onPress={() => update($, viewA, v => (v === 'tree' ? 'reader' : 'tree'))}>
          {view === 'tree' ? 'reader' : 'back'}
        </Button>
        <Button key="close" hotkey="x" onPress={close('closed-by-mod')}>
          close
        </Button>
      </Box>
    )

    const body =
      view === 'reader' ? (
        <Box flexDirection="column">
          <Text bold>Reader view (same dialog, redrawn in place)</Text>
          <Text>Exchange 7: the prompt and reply would show here. Press r to go back.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {ROWS.slice(top, top + room).map((row, i) => (
            <Button
              key={`row${row.n}`}
              plain
              hotkey={HOT[top + i]}
              autoFocus={i === 0 ? true : undefined}
              onPress={async () => {
                log($, 'row.press', { n: row.n })
                if (row.n === 1) {
                  await jump($, 'latest')
                  closer?.('jumped')
                }
                if (row.n === 2) await jump($, 'oldest')
              }}
            >
              {labelOf(row.n, row.label)}
            </Button>
          ))}
        </Box>
      )

    const tree = (
      <Box flexDirection="column">
        <Text dimColor>{`marks spike · ${mode} · ${view} · ${vp?.columns ?? '?'}x${vp?.rows ?? '?'} · ${top + 1}-${Math.min(ROWS.length, top + room)}/${ROWS.length} · keys 1 2 3 a b c j r x`}</Text>
        {body}
        {controls}
      </Box>
    )
    // Run 1: a tree with no engine node is refused ("AskUserQuestion is drawn by exactly one").
    if (mode === 'wrap' || mode === 'hide') {
      const engine = await next(e)
      return (
        <Box flexDirection="column">
          {tree}
          {mode === 'hide' ? <Box display="none">{engine}</Box> : engine}
        </Box>
      )
    }
    return tree
  })
}
