import { atom, read, update } from 'claude-code'
import type { EngineInterface, OnScreen, Register, RenderChildren, RenderViewport, Timer } from 'claude-code'

import type { Markers, View } from '../types'

// PROTOTYPE, throw away. UI prototype for ".scratch/claude-marks/issues/06-ui-prototype.md".
// Fake labels come from fixtures/ (real labeller output, v3). On a conversation a fixture
// was made from (claude --resume <id>) the labels sit on the real rows; anywhere else the
// first fixture's exchanges are mapped onto this conversation's prompts in order (demo).
// Round 6: focus mode, the in-transcript outline and the wide pane are dropped; the pane's
// tree, its reader and the thread dividers remain. Round 7: the band is back above the
// prompt for "where am I"; the status line is only the hint for opening the pane.
// Round 8 (issues/15-bottom-panel-prototype.md): the pane is transient. Enter jumps and
// closes it; /marks reopens it on the last jump, a band click on the band's exchange.
// Switches: /marks-proto order close-first|scroll-first, /marks-proto rows <n>.
// Round 9: every switch between tree and reader puts the ring back on an element
// (the tree on the reader's exchange, the reader on b), and Esc in the reader
// re-takes the keys it handed to the prompt.
// Rounds 10-12 tried to keep stray letters in the pane (hidden trap Buttons, a prompt.edit
// catcher); neither held up, and the pane has no catch-all key. Round 13: every view always
// draws all its keys (inert and dim where they can't act), and an arrow step onto one of
// the engine's own stops (another pane's tab, the close mark) is refused: /marks-proto stops allow|deny.

const PANE = 'marks'
const MOD = 'C:/Users/s.sventitsky/.claude/dev-mods/dba9fa16-da6e-4569-a6f6-dd165394120b/marks-proto'
const PROJECTS = 'C:/Users/s.sventitsky/.claude/projects'
const FIXTURES = ['1ebd82e3', '3bf55b9d', '56b622e8', 'c73d54bb']
const DEMO = '1ebd82e3'

const markersA = atom({ plugin: 'marks-proto', key: 'markers' } as const, 'divider' as Markers)
const viewA = atom({ plugin: 'marks-proto', key: 'view' } as const, { kind: 'list' } as View)
const forceMainA = atom({ plugin: 'marks-proto', key: 'forceMain' } as const, false)
const whereA = atom({ plugin: 'marks-proto', key: 'where' } as const, 0)
const tickA = atom({ plugin: 'marks-proto', key: 'tick' } as const, 0)

type Kind = 'manual' | 'landmark' | 'branch_point'
type Bookmark = { kind: Kind; why: string }
type Exchange = { n: number; uuid: string; thread: string; action: string; bookmarks: Bookmark[]; gist: string; prompt: string; reply: string }
type Thread = { id: string; label: string; parent: string | null }
type Fixture = { id: string; threads: Thread[]; exchanges: Exchange[] }
type Row = { uuid: string; reachable: boolean }

const GLYPH: Record<Kind, string> = { manual: '◆', landmark: '◇', branch_point: '↳' }
const PALETTE = ['suggestion', 'success', 'warning', 'merged', 'planMode', 'autoAccept', 'ide', 'permission']

// Module state: render hooks may not write $.state.
let fx: Fixture = { id: '', threads: [], exchanges: [] }
let mode: 'real' | 'demo' = 'demo'
const live = new Map<number, Row>() // exchange n -> its prompt row
const byPrompt = new Map<string, number>()
const byReply = new Map<string, number>() // assistant row uuid -> exchange n
const visible = new Set<number>()
let viewport: RenderViewport | undefined
let focused: string | undefined
let where = 0
let forceMainNow = false
let lastStatus = ''
let timer: Timer | undefined
let lastJump = 0 // the exchange Enter last jumped to; a /marks reopen lands here
let target = 0 // the row the ring starts on when the pane opens
let order: 'close-first' | 'scroll-first' = 'scroll-first'
let rows = 14
let lastAction = ''
let stops: 'allow' | 'deny' = 'deny'
// Round 14: the agents view hides the header, so a timestamped log of focus and close
// events outlives it. /marks-proto log prints it.
const events: string[] = []
// Left in the pane arrives as a person close, like Esc, then the engine shows the agents view.
// /marks-proto keep on refuses every person close, to see whether that stops the switch.
let keep = false
const note = (s: string) => {
  events.push(`${new Date().toTimeString().slice(0, 8)} ${s}`)
  if (events.length > 20) events.shift()
}

// ---- model helpers ----
const ex = (n: number) => fx.exchanges.find(x => x.n === n)
const th = (id: string) => fx.threads.find(t => t.id === id)
const familyOf = (id: string) => th(id)?.parent ?? id
const family = (n: number) => familyOf(ex(n)?.thread ?? '')
const mains = () => fx.threads.filter(t => !t.parent)
const colorOf = (id: string) => PALETTE[Math.max(0, mains().findIndex(t => t.id === familyOf(id))) % PALETTE.length]
const inFamily = (fam: string) => fx.exchanges.filter(x => familyOf(x.thread) === fam)
const latest = () => Math.max(0, ...live.keys()) || fx.exchanges.length
const fit = (s: string, w: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length <= w ? one : one.slice(0, Math.max(1, w - 1)) + '…'
}
const threadPath = (id: string) => {
  const t = th(id)
  return t?.parent ? `${th(t.parent)?.label} › ${t.label}` : t?.label ?? ''
}
const fsNow = () => viewport?.isFullscreen !== false && !forceMainNow
const reasonNoJump = (n: number) => {
  if (!fsNow()) return 'Main screen: the reader opens instead. Jumping works in fullscreen.'
  const row = live.get(n)
  if (!row) return mode === 'demo' ? 'Demo: this exchange has no row in this conversation.' : 'No prompt row found for this exchange.'
  if (!row.reachable) return 'Before the last compaction: not on screen, so the reader shows it.'
  return undefined
}

// The status line is the hint for opening the pane, in the style of the agents indicator.
const statusText = () => `/marks · ${fx.threads.length} threads`
const refreshStatus = ($: EngineInterface) => {
  const s = statusText()
  if (s !== lastStatus) {
    lastStatus = s
    $.ui.status(s)
  }
}

async function findTranscript($: EngineInterface, id: string) {
  for (const d of await $.fs.list(PROJECTS)) {
    const p = `${PROJECTS}/${d.name}/${id}.jsonl`
    if (d.kind === 'dir' && (await $.fs.exists(p))) return p
  }
  return ''
}

async function load($: EngineInterface) {
  const id = await $.session.id()
  const match = FIXTURES.find(f => id.startsWith(f))
  const want = match ?? DEMO
  if (fx.id !== want) fx = JSON.parse(String(await $.fs.read(`${MOD}/fixtures/${want}.json`))) as Fixture
  mode = match ? 'real' : 'demo'
  const transcript = await findTranscript($, id)
  live.clear(); byPrompt.clear(); byReply.clear()
  if (!transcript) return
  const rows = String(await $.fs.read(transcript))
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) as Record<string, any> } catch { return {} as Record<string, any> } })
  const lastCompact = rows.map(r => r.subtype === 'compact_boundary').lastIndexOf(true)
  let k = 0
  let cur: number | undefined
  rows.forEach((r, i) => {
    if (r.type === 'user' && r.origin?.kind === 'human' && typeof r.uuid === 'string') {
      k++
      cur = mode === 'real' ? fx.exchanges.find(x => x.uuid === r.uuid)?.n ?? cur : ex(k)?.n
      if (cur !== undefined && !live.has(cur)) {
        live.set(cur, { uuid: r.uuid, reachable: i > lastCompact })
        byPrompt.set(r.uuid, cur)
      }
    } else if (r.type === 'assistant' && cur !== undefined && typeof r.uuid === 'string') {
      byReply.set(r.uuid, cur)
    }
  })
}

// Opens the pane with the ring on exchange n, scrolled to the middle.
async function open($: EngineInterface, n: number) {
  target = n
  await update($, tickA, t => t + 1)
  const r = await $.ui.open({ id: PANE, title: 'marks', focus: true, closeOnEscape: true, rows })
  if (r.isPlaced && n) {
    const key = `ex:${n}`
    const f = await $.ui.focus({ requestId: PANE, key })
    const s = await $.ui.scroll({ in: PANE, to: { key }, block: 'center' })
    lastAction = `open on #${n}: focus ${'deny' in f && f.deny ? 'denied' : 'ok'}, scroll ${'deny' in s && s.deny ? 'denied' : 'ok'}`
  }
  return r
}

const deny = (r: { deny?: string }) => (r.deny ? `denied (${r.deny})` : 'ok')

async function showList($: EngineInterface, n: number) {
  await update($, viewA, () => ({ kind: 'list' }) as View)
  const f = await $.ui.focus({ requestId: PANE, key: `ex:${n}` })
  lastAction = `back to tree on #${n}: focus ${deny(f)}`
}

async function showReader($: EngineInterface, n: number, from: 'list' | 'deny') {
  await update($, viewA, () => ({ kind: 'portal', n, from }) as View)
  const f = await $.ui.focus({ requestId: PANE, key: 'key:b' })
  lastAction = `reader on #${n}: focus ${deny(f)}`
}

async function go($: EngineInterface, n: number) {
  if (reasonNoJump(n)) return showReader($, n, 'list')
  const to = { requestId: live.get(n)!.uuid }
  // Which comes first matters in fullscreen: closing the dock widens the transcript and reflows it.
  if (order === 'close-first') await $.ui.close({ id: PANE })
  const r = await $.ui.scroll({ to, block: 'start' })
  if ('deny' in r && r.deny) {
    lastAction = `jump #${n} refused (${order}): ${String(r.deny)}`
    $.ui.toast(`Jump refused: ${String(r.deny)}`)
    if (order === 'close-first') await $.ui.open({ id: PANE, title: 'marks', focus: true, closeOnEscape: true, rows })
    await showReader($, n, 'deny')
    return
  }
  lastJump = n
  lastAction = `jumped #${n} (${order})`
  await update($, viewA, () => ({ kind: 'list' }) as View)
  if (order === 'scroll-first') await $.ui.close({ id: PANE })
}

const focusedN = () => {
  if (focused?.startsWith('ex:')) return parseInt(focused.slice(3), 10)
  if (focused?.startsWith('th:')) return inFamily(familyOf(focused.slice(3))).at(-1)?.n ?? latest()
  return where || latest()
}

const track = (n: number, onScreen: OnScreen | null | undefined) => {
  if (onScreen) visible.add(n)
  else if (onScreen === null) visible.delete(n)
}

const divider = (id: string, cols: number) => {
  const sub = th(id)?.parent ? '└ ' : ''
  return fit(`── ${sub}${th(id)?.label ?? ''} ${'─'.repeat(cols)}`, cols - 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'marks', description: 'Open the thread and bookmark pane (prototype)' })
    await $.command.register({ name: 'mark', description: 'Bookmark the latest exchange (prototype)' })
    await $.command.register({ name: 'marks-proto', description: 'Prototype switch: main on|off', argumentHint: 'main on|off' })
    await load($)
    forceMainNow = await read($, forceMainA)
    lastStatus = ''
    refreshStatus($)
    timer?.cancel()
    // "Where am I" follows the transcript viewport: the top exchange with a row on screen.
    timer = $.clock.every(400, () => {
      const w = visible.size ? Math.min(...visible) : where
      if (w !== where) {
        where = w
        void update($, whereA, () => w)
      }
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await load($)
    await update($, tickA, t => t + 1)
    refreshStatus($)
    return r
  })

  on('command.run', { command: 'marks' }, async $ => {
    await load($)
    await update($, viewA, () => ({ kind: 'list' }) as View)
    const r = await open($, lastJump || where || latest())
    return { text: `marks prototype: ${mode} (${fx.id}), ${live.size} exchanges mapped to rows${r.isPlaced ? '' : ', pane waiting for room'}.` }
  })

  on('command.run', { command: 'mark' }, async $ => {
    const x = ex(latest())
    if (!x) return { text: 'Nothing to bookmark.' }
    x.bookmarks = [{ kind: 'manual', why: 'Marked with /mark' }, ...x.bookmarks]
    await update($, tickA, t => t + 1)
    refreshStatus($)
    return { text: `◆ Bookmarked exchange ${x.n}: ${x.gist}` }
  })

  on('command.run', { command: 'marks-proto' }, async ($, e) => {
    const [k, v] = e.args.trim().split(/\s+/)
    if (k === 'order' && (v === 'close-first' || v === 'scroll-first')) {
      order = v
      return { text: `marks-proto: on Enter, ${v === 'close-first' ? 'close the pane, then jump' : 'jump, then close the pane'}` }
    }
    if (k === 'rows' && Number(v) > 0) {
      rows = Number(v)
      return { text: `marks-proto: the inline pane asks for ${rows} rows from the next open` }
    }
    if (k === 'stops' && (v === 'allow' || v === 'deny')) {
      stops = v
      await update($, tickA, t => t + 1)
      return { text: `marks-proto: arrow steps onto engine stops ${v === 'deny' ? 'refused' : 'allowed'}` }
    }
    if (k === 'keep' && (v === 'on' || v === 'off')) {
      keep = v === 'on'
      return { text: `marks-proto: person closes ${keep ? 'refused (Esc and left both)' : 'allowed'}` }
    }
    if (k === 'log') return { text: events.length ? ['marks-proto log:', ...events].join(String.fromCharCode(10)) : 'marks-proto log: empty' }
    if (k !== 'main') return { text: 'Usage: /marks-proto main on|off · order close-first|scroll-first · rows <n> · stops allow|deny · keep on|off · log' }
    forceMainNow = v === 'on'
    await update($, forceMainA, () => forceMainNow)
    refreshStatus($)
    return { text: `marks-proto: main screen simulation ${v}` }
  })

  // Esc in the reader steps back to the tree instead of closing the pane.
  on('ui.close', async ($, e, next) => {
    note(`close ${e.id} by ${e.origin.kind}`)
    if (e.id !== PANE) return next(e)
    if (e.origin.kind !== 'person') return next(e)
    if (keep) {
      note('refused the person close (keep on)')
      return { value: undefined }
    }
    const view = await read($, viewA)
    if (view.kind !== 'portal') return next(e)
    await update($, viewA, () => ({ kind: 'list' }) as View)
    // Esc already handed the keys to the prompt; once the refusal lands, take them back.
    $.clock.after(30, async () => {
      const r = await $.ui.open({ id: PANE, title: 'marks', focus: true, closeOnEscape: true, rows })
      const f = await $.ui.focus({ requestId: PANE, key: `ex:${view.n}` })
      lastAction = `Esc to tree on #${view.n}: placed ${r.isPlaced}, focus ${deny(f)}`
      await update($, tickA, t => t + 1)
    })
    // Answering without next keeps the pane open.
    return { value: undefined }
  })

  on('ui.focus', async ($, e, next) => {
    note(`focus ${e.component}/${e.requestId} -> ${e.element ?? 'engine stop'} by ${e.origin.kind}`)
    return next(e)
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // An arrow onto an engine stop (no element: another pane's tab, the close mark) leaves the tree.
    if (!e.element && e.origin.kind === 'person' && stops === 'deny') {
      lastAction = 'refused a step onto an engine stop'
      void update($, tickA, t => t + 1)
      return { deny: 'marks keeps the ring in its tree' }
    }
    focused = e.element
    return next(e)
  })

  // ---- the band: where am I ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    viewport = e.viewport ?? viewport
    await read($, tickA)
    await read($, forceMainA)
    const w = await read($, whereA)
    if (e.props.hasSurvey || !fx.exchanges.length) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const fs = fsNow()
    const n = fs && w ? w : latest()
    const x = ex(n)
    if (!x) return next(e)
    const t = th(x.thread)
    const main = th(familyOf(x.thread))
    const marks = x.bookmarks.map(b => GLYPH[b.kind]).join('')
    return (
      <Box flexDirection="row" width={e.props.bodyColumns}>
        {/* The whole band is one button: a click opens the pane, its tree on this exchange. */}
        <Button
          key="band"
          plain
          onPress={async () => {
            focused = `ex:${n}`
            await update($, viewA, () => ({ kind: 'list' }) as View)
            await open($, n)
          }}
        >
          <Text color={colorOf(x.thread)}>● </Text>
          <Text color={colorOf(x.thread)} bold>
            {main?.label}
          </Text>
          {t?.parent ? <Text color={colorOf(x.thread)}> › {t.label}</Text> : null}
          <Text dimColor>{` · ${fs ? 'here' : 'latest'} #${n}/${fx.exchanges.length}`}</Text>
          {marks ? <Text color={colorOf(x.thread)}> {marks}</Text> : null}
          <Text dimColor> · click or /marks</Text>
        </Button>
      </Box>
    )
  })

  // ---- transcript rows: thread dividers ----
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    viewport = e.viewport ?? viewport
    const n = byPrompt.get(e.requestId)
    if (n === undefined || e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    track(n, e.props.onScreen)
    if (e.props.isExpanded) return next(e)
    const markers = await read($, markersA)
    await read($, tickA)
    const x = ex(n)!
    const cols = viewport?.columns ?? 80
    const prev = ex(n - 1)
    const changed = !prev || prev.thread !== x.thread
    const glyph = x.bookmarks[0]?.kind
    const inner = await next(e)
    return (
      <Box flexDirection="column">
        {inner}
        {markers === 'divider' && changed ? (
          <Box position="absolute" top={0} left={0}>
            <Text color={colorOf(x.thread)} wrap="truncate">
              {divider(x.thread, cols)}
            </Text>
          </Box>
        ) : null}
        {markers === 'divider' && glyph ? (
          <Box position="absolute" top={1} left={0}>
            <Text color={colorOf(x.thread)}>{GLYPH[glyph]}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const n = byReply.get(e.requestId)
    if (n !== undefined) track(n, e.props.onScreen)
    return next(e)
  })

  // ---- the pane: tree of threads, portal as the second action ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tickA)
    viewport = e.viewport ?? viewport
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const markers = await read($, markersA)
    const view = await read($, viewA)
    const fs = fsNow()
    const W = e.props.bodyColumns
    const narrow = e.props.placement === 'inline' || W < 60

    // Glyphs take the thread's colour; the shape tells the kind apart.
    const glyphs = (x: Exchange) =>
      x.bookmarks.length ? <Text color={colorOf(x.thread)}>{x.bookmarks.slice(0, 2).map(b => GLYPH[b.kind]).join('')}</Text> : ' '

    // The ring starts on the open's target; the first row if that isn't drawn.
    const hasTarget = fx.exchanges.some(x => x.n === target)
    let first = true
    const auto = (n: number) => ((hasTarget ? n === target : first) ? ((first = false), true) : undefined)

    const exRow = (x: Exchange, indent: string) => {
      const reach = !!live.get(x.n)?.reachable
      const here = fs && where === x.n
      const jumped = lastJump === x.n
      return (
        <Button key={`ex:${x.n}`} plain autoFocus={auto(x.n)} onPress={() => go($, x.n)}>
          <Text dimColor={!jumped || undefined} color={jumped ? 'suggestion' : undefined}>{`${indent}${jumped ? '›' : ' '}${String(x.n).padStart(2)} `}</Text>
          {glyphs(x)}
          <Text dimColor={!reach || undefined} bold={here || undefined}>
            {' ' + fit(x.gist, W - indent.length - 8)}
          </Text>
        </Button>
      )
    }

    const counts = (xs: Exchange[]) => {
      const c = { manual: 0, landmark: 0, branch_point: 0 } as Record<Kind, number>
      xs.forEach(x => x.bookmarks.forEach(b => c[b.kind]++))
      return (Object.keys(c) as Kind[]).filter(k => c[k]).map(k => `${GLYPH[k]}${c[k]}`).join(' ')
    }

    const threadRow = (t: Thread, onPress: () => void, sub: boolean) => {
      const xs = fx.exchanges.filter(x => x.thread === t.id)
      const meta = narrow ? `${xs.length}` : `${xs.length} ex  ${counts(xs)}`
      return (
        <Button key={`th:${t.id}`} plain onPress={onPress}>
          <Text color={colorOf(t.id)} bold={!sub || undefined}>
            {fit(`${sub ? ' └ ' : ''}${t.label}`, W - meta.length - 3)}
          </Text>
          <Text dimColor>{'  ' + meta}</Text>
        </Button>
      )
    }

    // A main thread with its exchanges in order; a sub-thread's header goes before its first exchange.
    const familyBlock = (m: Thread) => {
      const out: RenderChildren[] = []
      const seen = new Set<string>()
      for (const x of inFamily(m.id)) {
        const t = th(x.thread)!
        if (t.parent && !seen.has(t.id)) {
          seen.add(t.id)
          out.push(threadRow(t, () => go($, x.n), true))
        }
        out.push(exRow(x, t.parent ? '   ' : ''))
      }
      return out
    }

    // A key the view can't act on now is still drawn, so its letter stays in the pane.
    const key = (k: string, label: string, onPress: (() => unknown) | undefined) => (
      <Button
        key={`key:${k}`}
        plain
        hotkey={k}
        dimColor
        onPress={async () => {
          if (onPress) return void (await onPress())
          lastAction = `"${k}" does nothing here`
          await update($, tickA, t => t + 1)
        }}
      >
        <Text strikethrough={!onPress || undefined}>{label}</Text>
      </Button>
    )

    const state = (
      <Text dimColor wrap="truncate">
        {`last jump #${lastJump || '-'} · open on #${target || '-'} · ${order} · rows ${rows} · stops ${stops} · ${lastAction || 'no action yet'}`}
      </Text>
    )
    const header = (
      <Text dimColor wrap="truncate">
        {`${mode} ${fx.id} · ${fx.threads.length} threads · ${fx.exchanges.length} ex · ${live.size} on rows · ${fs ? 'fullscreen' : 'main screen'} · ${e.props.placement} ${W}c · ${viewport?.columns ?? '?'}x${viewport?.rows ?? '?'}`}
      </Text>
    )

    // ---- portal (reader view) ----
    if (view.kind === 'portal') {
      const x = ex(view.n)
      if (!x) return <Text>No exchange {view.n}.</Text>
      const fam = inFamily(family(x.n))
      const i = fam.findIndex(y => y.n === x.n)
      const why = view.from === 'deny' ? 'The jump was refused, so the reader shows it.' : reasonNoJump(x.n)
      const step = (d: number) => {
        const y = fam[i + d]
        return y && showReader($, y.n, view.from)
      }
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            {key('b', 'b: back', () => showList($, x.n))}
            {key('k', 'k: previous', fam[i - 1] ? () => step(-1) : undefined)}
            {key('j', 'j: next', fam[i + 1] ? () => step(1) : undefined)}
            {key('g', 'g: jump here', !why ? () => go($, x.n) : undefined)}
          </Box>
          <Text wrap="truncate">
            <Text color={colorOf(x.thread)} bold>
              {threadPath(x.thread)}
            </Text>
            <Text dimColor>{` · #${x.n} · ${i + 1} of ${fam.length} in thread`}</Text>
          </Text>
          {why ? <Text color="warning">{why}</Text> : null}
          {state}
          {x.bookmarks.map(b => (
            <Text>
              <Text color={colorOf(x.thread)}>{GLYPH[b.kind]} </Text>
              <Text dimColor>{b.why}</Text>
            </Text>
          ))}
          <Text dimColor>{'─'.repeat(W)}</Text>
          <Text>
            <Text color="suggestion">{'> '}</Text>
            {x.prompt}
          </Text>
          <Text dimColor>{'─'.repeat(W)}</Text>
          <Markdown text={x.reply} />
        </Box>
      )
    }

    const keys = (
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {key('p', 'p: read', () => showReader($, focusedN(), 'list'))}
        {key('i', `i: divider ${markers === 'divider' ? 'on' : 'off'}`, fs ? () => update($, markersA, m => (m === 'divider' ? 'off' : 'divider') as Markers) : undefined)}
      </Box>
    )
    const footer = fs ? null : <Text color="warning">{fit('Enter opens the reader. Jumping works in fullscreen.', W)}</Text>

    return (
      <Box flexDirection="column">
        {header}
        {state}
        {keys}
        {footer}
        {mains().flatMap(m => [threadRow(m, () => go($, inFamily(m.id).at(-1)!.n), false), ...familyBlock(m)])}
      </Box>
    )
  })
}
