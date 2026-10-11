# Mod API: marking transcript rows and jumping to them

Source: `claude-code.d.ts` and `reference.md` from the plugin-authoring skill, build 2.1.296 (read 2026-10-11). Line refs are to that `claude-code.d.ts`.

## 1. Stable identity of an exchange's prompt row

- A `ui.render` hook on `{ component: 'UserMessage' }` gets `e.requestId` = **the message id** (RenderInput doc, ~L9737; reference.md "the message id for a message").
- `session.append` fires for every stored row with `e.uuid`: "the row's id, the same in the transcript file and on every later read" (~L10590). Its result carries the same `uuid`. A prompt row arrives through door `prompt`, origin `composer`.
- Both are engine ids, not module state, so they **survive a module reload**; because the uuid is the transcript file's own, it **survives `--resume` / `--continue`**.
- `UserMessage` covers more than prompts: task notifications and peer messages too. Filter with the matcher `{ props: { origin: { kind: 'composer' } } }` (or check `e.props.origin.kind`).
- **Gap: `$.session.messages()` returns no id.** `SessionMessage` is `{ role, text, toolUses, toolResults?, handle? }` (~L11142). Existing history (retro-labelling) can't be keyed by uuid through that call. The ways to get uuids are:
  1. live `session.append` (new rows only),
  2. `UserMessage` renders (only rows the transcript actually draws),
  3. reading the transcript JSONL with `$.fs` (`transcript_path` appears only on classic hook payloads, ~L834, so the mod has to find the path itself).
- **Spike check:** the docs say `requestId` is "the message id" and the append `uuid` is "the row's id", but never say outright that they are equal. Confirm with a 10-line mod that logs both for one prompt.

```tsx
on('session.append', { door: 'prompt' }, async ($, e, next) => {
  const r = await next(e)
  if (!e.agentId && r.uuid) await recordExchangeStart($, r.uuid, r.message)
  return r
})
```

## 2. A clickable inline marker sharing a hover scope with the pane

- A `UserMessage` hook can return its own tree. `await next(e)` resolves to the engine's tree (a `RenderElement`), so the hook can wrap it with a gutter glyph. While `e.props.isExpanded` (ctrl+o), pass `next(e)` through unchanged.
- `scope` on a Box or Text joins a cross-site hover group: "A Pane row and a mark on a transcript message can share one" (~L871). It is pure styling: no hook runs. `display: 'none'` + `hover: { display: 'flex' }` reveals matching rows in the pane or band.
- Presses: a `Button` raises `ui.press`. Mouse presses are reported **only by the fullscreen terminal** ("a plain click in the fullscreen terminal", ~L7932). Hotkeys only work in a focused band or pane, never in a transcript row. So **an inline marker can be clicked only in fullscreen**. On the main screen it is display-only.

```tsx
on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'composer' } } }, async ($, e, next) => {
  const inner = await next(e)
  if (e.props.isExpanded) return inner
  const { Box, Text, Button } = $.ui.resolve(e)
  const t = await threadOf($, e.requestId)          // from $.state
  if (!t) return inner
  return <Box flexDirection="row">
    <Box scope={`t:${t.id}`} hover={{ backgroundColor: 'gray' }}>
      <Button key={`mark:${e.requestId}`} plain dimColor label={t.glyph} onPress={() => toggleMark($, e.requestId)} />
    </Box>
    {inner}
  </Box>
})
```

## 3. Scrolling the transcript to a row from the pane or band

- `$.ui.scroll({ to: { requestId }, block: 'start' })`: the `requestId` form "names a render instance by the id its `ui.render` hook saw (a transcript message's …)" (~L14435).
- "A transcript row moves only while this call answers the person's own input." A pane/band **Button press counts**: `PaneOpenArgs` defines the person's input as "a command or prompt they entered, a press" (~L7392), and `UiOpenResult` lists "a Button, Input or Select they worked". Calls from timers, `session.start` or a queued prompt are refused with `deny: 'not person-initiated'`.
- The result is `{}` or `{ deny }`. Denial reasons include "none scrolls" and the target not being drawn. Show a toast on deny.
- **Fullscreen vs main screen:**
  - Fullscreen: the engine owns a scrollable transcript and `onScreen` is reported, so jumping works, *for rows the transcript keeps drawn* (`UiSelection` doc: rows can be "scrolled out of the rows the transcript keeps drawn", ~L14505). How far back that reaches is unknown. Spike it on a long conversation.
  - Main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default): the transcript is native terminal scrollback. `onScreen` is absent there (reference.md), and no API scrolls the terminal's own scrollback, so expect `deny`. **No jump on the main screen** (strong inference, spike to confirm).
- Bonus: `onScreen` changes re-run the `UserMessage` hook, so the band can show "where am I" (the thread of the topmost visible exchange) in fullscreen, as in the doc's own example (~L6794).

```tsx
<Button key={`go:${ex.uuid}`} label={ex.title} onPress={async () => {
  const r = await $.ui.scroll({ to: { requestId: ex.uuid }, block: 'start' })
  if (r.deny) $.ui.toast(`Can't jump: ${r.deny}`)
}} />
```

## 4. Side pane and `AbovePrompt` band at the same time

- They are independent sites: `ui.render` on `{ component: 'Pane', requestId: 'marks' }` (opened by `$.ui.open({ id: 'marks', title: 'Marks' })`) and on `{ component: 'AbovePrompt' }`. Both can be live together.
- **Pane placement:** `dock` beside the transcript in fullscreen from 110 columns; otherwise `inline` above the prompt (always inline on the main screen). Opened *unasked* (e.g. on `session.start`), it waits undrawn below 144 columns, or 110 if the person opened that id before and hasn't closed it by hand. Opened from `/marks` or a press, it is placed at any width. Size the tree to `e.props.bodyColumns`.
- **Band:** width is `bodyColumns` = its column (the terminal, or the transcript column beside a docked pane) minus 5 for `[-]`. Height is `maxRows`, capped at half the terminal's rows in fullscreen. A taller tree scrolls in a window with an "n more" row. The person can collapse it (ctrl+x ctrl+a).
- On the main screen, an inline pane and the band both stack above the prompt and compete for rows. Keep the band to 1–2 rows.
- Both sites re-render for `view.agentId` when the person opens a subagent transcript. Draw nothing (or the main thread) in that case.
- Drawing state belongs in `$.state` (host-held, survives reload) and cross-session data in `$.store`. That is ticket 03's concern.

## Blockers that change the design

1. **Navigation is fullscreen-only.** Clickable inline markers and transcript jumps both need the fullscreen terminal. On the main screen the mod can show the tree and band but can't jump. The spec must say whether the mod requires fullscreen, or degrades on the main screen to a read-only list (perhaps one that copies an excerpt to search for).
2. **`$.session.messages()` has no row ids.** Retro-labelling existing history needs uuids from the transcript JSONL (`$.fs`) or from rendered rows. Live labelling uses `session.append`.
3. **Unverified:** `UserMessage.requestId === session.append uuid`, and how far back a jump can reach in a long fullscreen transcript. Both need a small spike before building.
