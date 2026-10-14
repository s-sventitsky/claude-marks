# Spike: a pick-and-go panel in the prompt's place

Type: task
Status: resolved

## Question

Can a mod draw the thread tree in the prompt's place while it is open, the way the AskUserQuestion dialog and `/usage` do? Build a throwaway mod (AFK, the same method as [Spike: row identity and jump reach](07-row-identity-jump-spike.md)) and confirm it in the user's fullscreen VS Code terminal.

Known from the build 2.1.299 types: `Pane` placement is only `dock` or `inline` (inline is a framed box above the prompt, and the prompt stays). `command.run` answers with text only, so a `/usage`-style panel has no mod API. The one route found is the AskUserQuestion dialog: `$.ui.ask(question, options)` raises it, and a `ui.render` hook on `{ component: 'AskUserQuestion' }` can redraw it.

Find out:

1. Does a `ui.render` hook on `AskUserQuestion` draw a custom tree (Box, Text, Button), or only accept rewritten `questions`? Does the hook see that the dialog came from this mod's own `$.ui.ask`, so it leaves the model's real questions alone?
2. Inside that tree, do Tab, the arrows, Enter and Button `hotkey`s reach the mod's Buttons? Which keys does the engine's dialog keep for itself (digits, typing into "Other", Esc)?
3. Can the mod close the dialog itself after a press, and what does the pending `$.ui.ask` promise do then (resolve, reject)? Can it redraw the tree in place (tree to reader and back) without closing?
4. Does a `$.ui.scroll({ to: { requestId } })` from a press inside the dialog work, and is the jumped row still at the top once the dialog closes and the transcript grows back?
5. How many rows does the dialog get at the viewport heights seen so far (9 to 43), and how does a tree taller than that scroll?
6. Does a mod-raised `$.ui.ask` leave anything in the transcript, the JSONL or the model's context (a tool call row, a tool result)? It must leave nothing.
7. What happens on the main screen (`isFullscreen === false`)?

If the custom tree can't be drawn or can't take keys, record what the stock dialog can do (2 to 4 options, header, multi-select), and say so plainly. The map already rules out a paged 4-option picker as the fallback.

Inputs: [Mod API: can we mark transcript rows and jump to them?](01-mod-api-navigation.md), [UI: band, pane and inline markers](06-ui-prototype.md).

## Comments

- 2026-10-14: More from the build 2.1.299 types. A `Pane`'s `placement` is the surface's choice: `dock` in fullscreen from 110 columns, `inline` below that or on the main screen. A mod can't ask for inline at 208 columns. The band can't take the keys from code (`$.ui.focus` needs a site that already holds them, and ctrl+x tab didn't reach it in spike 07). So the AskUserQuestion dialog is still the only route. `$.ui.ask` has no close call. The spike tries one: its `tool.call` hook on its own ask races `next(e)` against a press and answers the call itself.
- 2026-10-14: The spike mod `marks-ask-spike` is at `~/.claude/dev-mods/6a421aa5-3f67-42e6-9310-f8904f472087/marks-ask-spike/`. It passes validate and tsc. `/ask-spike tree|wrap|rewrite|stock` raises the dialog. `tree` draws a 40-row fake tree with paging, a reader toggle, two jumps and a close. `wrap` draws the tree above the engine's own dialog. `rewrite` only changes the question text. `stock` leaves it alone. Each session logs to `research/spike-14/log-<start>.json`. The user runs the checklist (HITL: real terminal and keys).
- 2026-10-14, run 1 (`/ask-spike tree` twice, 220x45 fullscreen): **a tree with no engine node is refused.** The notice reads `ui.render (AskUserQuestion) refused: 0 engine nodes; AskUserQuestion is drawn by exactly one; the engine drew its own`. The user saw the stock dialog with 4 rows (Close, Keep going, plus the engine's own extras). Other facts:
  - The hook does see its own ask. `tool.call` gets `toolu_plugin_…` ids, and a `metadata.source` rewrite reaches the render as `metadataSource: "claude-marks"`.
  - Picking an option resolves `$.ui.ask` with the label. Esc rejects it with `HooksError: … no answer (The user doesn't want to proceed …)`. That text goes only to the mod.
  - **The ask leaves nothing in the JSONL or in the model's context.** No `tool_use` or `tool_result` row was appended. The slash command's own two rows (`/ask-spike` and its stdout) are kept, and the model reads them.
  - Next: `wrap` (the tree above the engine's dialog) and `hide` (the engine's dialog inside `display: none`).
- 2026-10-14, run 2 (`/ask-spike wrap` three times): **a tree around the dialog is held to 12 rows.** The notice reads `ui.render (AskUserQuestion) refused: more than 12 rows around the dialog; the engine drew its own`. The user saw the stock dialog again. This matches the reference ("around the approval dialog a tree is held to its rows": each Button or Input label counts at least one row). So at most 12 rows of the mod's own content sit next to the stock dialog, and the stock dialog stays on screen. The spike is cut to 12 rows (1 header, 8 tree rows, 3 control buttons) to test key reach.
- 2026-10-14, run 3 (`/ask-spike` wrap at 12 rows, then `hide`): both refused again. `wrap`: still `more than 12 rows around the dialog`, because the 43-character tree labels count 2 rows each. `hide`: `refused: engine node under a Box with prop "display"; the engine drew its own`. Key reach was never tested, since no custom tree was drawn.

## Answer

**No.** On build 2.1.299 a mod can't draw the tree in the prompt's place. Assets: the spike mod was deleted after the runs; its hooks module is kept as `research/spike-14/register.tsx`. Logs are in [research/spike-14/](../research/spike-14/). All runs were in the user's VS Code terminal, fullscreen, 220x45.

1. The `ui.render` hook on `AskUserQuestion` can't replace the dialog. A tree must contain the engine's own dialog node exactly once (`0 engine nodes; AskUserQuestion is drawn by exactly one`). It can't hide that node either (`engine node under a Box with prop "display"`). The mod's own content around it is capped at 12 rows (`more than 12 rows around the dialog`). Each Button or Input label counts at least 1 row, plus 1 per 40 columns. Rewriting `questions` works. The hook does see its own ask: `tool_use_id` is `toolu_plugin_…`, and a `metadata.source` rewrite in `tool.call` reaches the render as `metadataSource`. So the model's real questions can be left alone.
2. Not tested, since no custom tree was ever drawn. Whatever the answer, the stock dialog stays on screen and owns its own keys.
3. Not tested. `$.ui.ask` resolves with the picked label and rejects on Esc (`no answer (The user doesn't want to proceed …)`), and that text reaches only the mod.
4. Not tested.
5. Moot. At most 12 counted rows (about 5 to 10 tree rows) sit above a stock dialog that stays visible: the paged picker the map rules out.
6. **The ask leaves nothing behind.** No `tool_use` or `tool_result` row in the JSONL, and nothing in the model's context. Only the slash command's own rows remain (as for any command).
7. Not tested (moot).

Other routes, checked against the types: `Pane` placement is the surface's choice (`dock` in fullscreen from 110 columns, `inline` only below that or on the main screen), and `command.run` answers with text only. **So the transient side pane, closed on jump, is the placement.**
