# Mod UI survey: is there a bottom pick-and-go panel?

Sources: `claude-code.d.ts` from the plugin-authoring skill, build 2.1.299 (read 2026-10-14; line refs are to that file), the skill's `reference.md`, the official docs pages [Draw in the interface with a mod](https://code.claude.com/docs/en/plugins/mods/interface) and [Keybindings](https://code.claude.com/docs/en/keybindings), the source of the mods listed below (read on GitHub or on disk, not installed or run), and the [slopshopper](https://github.com/ryx2/slopshopper) index `data/mods.json` (generated 2026-10-10). Inputs: [spike 14](../issues/14-bottom-panel-spike.md), [06](../issues/06-ui-prototype.md), [07](../issues/07-row-identity-jump-spike.md).

## How many mods exist

- **Local:** one mod on this machine: Anthropic's `code-modernization` in the `claude-plugins-official` marketplace clone (`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/code-modernization/`). Its `hooks.json` has `"modules": ["./register.ts"]`. No plugin in `cache/` has `modules` or imports `'claude-code'`.
- **Public:** the ecosystem is large and young. The slopshopper index lists **5,264 mods in 2,809 repos**. 3,489 of those repos were created in October 2026. 4,522 have tests and 3,168 have a `$.state` contract, but 2,963 have no stars and 519 have ten or more. By description, about 1,140 draw in the band, 913 in a pane, 161 touch the question dialog, 87 are games and 48 are about jumps, navigation or bookmarks. Anthropic ships the built-in mods `diff`, `agents-md`, `sec-default` and `telemetry` ([anthropics/claude-code/mods](https://github.com/anthropics/claude-code/tree/HEAD/mods)) and three samples.
- **Gaps:** GitHub code search allows 10 requests a minute, so the survey worked from the index plus targeted reads. It found no mod that draws in the prompt's place.

## Mods and techniques (the ones that matter here)

| Mod | Sites | Elements | Keys | Size or placement trick |
|---|---|---|---|---|
| [code-modernization](https://github.com/anthropics/claude-plugins-official/tree/HEAD/plugins/code-modernization) (Anthropic; local) | Pane, AbovePrompt (review deck, show bar), PromptHint | Box, Text, Button, Raster, Code, Input | Deck: bare digits `0`-`7` press band Buttons **from an empty composer**, no focus needed. Pane: click or ctrl+x tab. | Deck sizes its card to `e.props.maxRows` so it never scrolls: a scrolled band disarms the digits. Sign-off "dialog" is a pane opened `focus`, `closeOnEscape`, `holdToasts`, `rows: 12`. Infers fullscreen from `maxRows < viewport.rows`. |
| [diff](https://github.com/anthropics/claude-code/tree/HEAD/mods/diff) (built-in) | Pane, PromptHint | Box, Text, Button | Hidden Buttons declare the engine's own actions (`ctrl+up/down`, `ctrl+x b`); answers `ui.scroll` itself | Even Anthropic's own panel is a pane: docked in fullscreen, inline (`rows`) only on the main screen. No privileged route. |
| [prompt-stack](https://github.com/popoffvg/dotfiles/tree/HEAD/harness/plugins/prompt-stack) | AbovePrompt | Box, Text | **Modal composer:** a `prompt.edit` hook answers `{ text, cursor }` without `next`, which consumes the key while a menu shows. Letters pick the menu action and digits pick a list row. Any other key closes it. Opened by U+E000, which a terminal key binding sends (Zed `terminal::SendText`). | The menu lives in the band and the draft is stashed meanwhile. Nothing is written to the transcript. |
| [claude-x `issues`](https://github.com/thefuga/claude-x/tree/HEAD/mods/issues) | AbovePrompt | Box, Text, Button, Input | Band `Input` plus NEXT/PREVIOUS sentinel Buttons. A `ui.focus` hook turns a ring move onto a sentinel into a pick move, so Tab and the arrows step the list. Follows the draft through `prompt.edit` and polls `$.prompt.read`. | A list of up to `maxRows` above the prompt, filtered by the draft. Detects Esc by asking `$.ui.focus` to hold the ring and counting denials. |
| [claude-bookmarks](https://github.com/DazzleML/claude-bookmarks/tree/HEAD/plugin) (POC) | AbovePrompt, Pane | Button, Input | **Borrowed engine actions** (`app:toggleDiffNoiseFilter`, `app:toggleDiffPreSession`, `app:cycleDiffBase`, `app:diffFileListDown`) on band Buttons, bound to chords in `keybindings.json`. `abovePrompt:focus` rebound to a "band leader" (Ctrl+]). Band `Input` with `autoFocus`. `ui.focus` interception for the arrows. | Finding (B3): typing and Enter in a band field may scroll the transcript **if the handler is still running when it calls `$.ui.scroll`**; fire-and-forget loses the credit. Also claims `command:<name>` keybindings (2.1.290), which the official action list doesn't have: unverified. |
| [prompt-marks](https://github.com/AdamCaviness/prompt-marks) | UserMessage, AbovePrompt | Button in a `display="none"` Box | Hidden band Buttons with `action: 'app:diffFileListUp/Down'`: **ctrl+up/down (default bindings) jump between prompts from the prompt, with no focus and no config** | Nothing drawn. The press counts as the person's input, so `$.ui.scroll` is allowed. |
| [project-hop](https://github.com/aliemrevezir/mods/tree/HEAD/plugins/project-hop) | AbovePrompt | Button (`j`, `k`, `x`, `n`, `b` hotkeys) | **Composer as command line:** while the band list shows, a `prompt.submit` hook reads a typed number or name, returns `{ drop }` and acts. Edge-stop Buttons plus `ui.focus` page the list when the band has focus. | Paged list sized to `maxRows`. |
| [design-picker](https://github.com/aravindsriraj/claude-code-mods/tree/HEAD/design-picker) | AskUserQuestion | Button, Code (Svg on desktop) | Clicks. `tool.call` races `next(e)` against its own picks and answers the call itself. | Keeps the engine node once and counts its own rows against the 12-row cap (`DIALOG_ROWS`). Spike 14's limit holds. |
| [question-picker](https://github.com/DrishtantKaushal/AwesomeClaudeCodeMods/tree/HEAD/sources/question-picker/source), [model-pick](https://github.com/joshuatonga/mini-claude-mods/tree/HEAD/model-pick) | Pane | Button, Input | `open({ focus, closeOnEscape })` | `rows: N` for the inline case. The "dialog" is a pane, so docked in wide fullscreen. |
| [tetris](https://github.com/davila7/claude-code-templates/tree/HEAD/cli-tool/components/mods/games/tetris), [cc-dino](https://github.com/giovaborgogno/cc-dino) | AbovePrompt | **Client** (surface module) | `surface.onKey` after **a click on the board**. Esc gives the keys back. | `height = min(maxRows - 2, 23)`: the biggest band seen, about half the terminal. |
| [prompt-rail](https://github.com/oikon48/prompt-rail/tree/HEAD/plugins/prompt-rail) | AbovePrompt, Pane, transcript rows | Button, absolute Box | Hover and click | `position="absolute"` hover cards over the band row |

## The open leads, checked against the types

**`Client` (a mod's own surface module).** No.
- It draws ClientElements (the terminal table less `Client`, `Raster` and `Image`, L1435) in a region sized by `width`/`height` (a count or a percentage of the parent, L1554-1560). So it is no bigger than the band or pane it sits in.
- Keys reach `onKey` only "while a click has given it the focus" (L1619), and Escape never arrives (L1439). `$.ui.focus` moves the ring only to a Button, Input or Select (L14312), so no command or chord can focus a Client.
- Its posts arrive as `ui.message` with origin `client`, "on nobody's behalf" (L14494). A transcript jump needs the person's own input (L2560, L14735), so a jump from a Client key is most likely refused. Inferred, not tested.
- Sites: any terminal site whose table has it (L3890). The tetris and dino mods use the band.

**A `CommandOutput` tree as an inline pick list.** Click-only, so no.
- A hook's tree draws in the command row's place at the transcript's width (L10276-10280), and clicks on transcript-row Buttons work ([06](../issues/06-ui-prototype.md)).
- Only a pane and the band keep a focus ring (`UiFocusComponent = 'Pane' | 'AbovePrompt'`, L14326), so the list takes no hotkeys, Tab or arrows. Hidden borrowed-action Buttons are the only key route.
- The command's rows stay in the JSONL and the model reads them ([14](../issues/14-bottom-panel-spike.md)). The list scrolls away with the transcript, and a jump moves the viewport off it.

**A tall `AbovePrompt` band.** Yes, as a bottom panel with the prompt still under it.
- `maxRows` in fullscreen is what the bottom slot has left, and "that slot is capped at half the terminal's rows, the prompt's included" (L10511-10520). A taller tree scrolls in `scroll.bodyRows`. Estimated at the user's sizes: about 18 rows at 45, about 5 at 18.
- Keys without the ctrl+x tab chord that failed in VS Code:
  - a bare digit in an empty composer presses a band Button wholly inside the window (L1111, L9641, L10517);
  - a Button `action` is pressed by the person's chord for that engine action from the prompt, while no dialog is up and no engine handler of the action is mounted (L1116-1123);
  - a `prompt.edit` hook consumes keys by answering `{ text: e.text, cursor: e.cursor }` (L4202-4212, L8703-8708); `e.key` names the key (L8654);
  - a `prompt.submit` hook answers `{ drop }` (L4170, L9381).
- With focus (a click, or `abovePrompt:focus` rebound in `keybindings.json`), a `ui.focus` hook can turn arrows and Tab into list steps (issues, claude-bookmarks).

**Anything that hides or replaces the prompt.** None.
- The docs map says "The prompt is Claude Code's own". The render sites (L10014-10557) have no prompt input, only `PromptHint`, the hint line under it.
- The permission prompt isn't a site. AskUserQuestion keeps exactly one engine node and at most 12 rows ([14](../issues/14-bottom-panel-spike.md)).
- An absolute Box is clipped to its own site's region (L945), so the band can't paint over the transcript or the prompt.
- Pane placement is the surface's choice (L10551, L10583), and the dock ignores `rows` (L7535-7539). On the main screen a pane does sit inline above the prompt at any width (the built-in diff mod's dialog shape), but jumps need fullscreen ([08](../issues/08-main-screen-behaviour.md)).

**Typeahead (found during the survey).** `prompt.autocomplete` adds rows to the engine's own typeahead under the prompt (L4213-4224, L8372-8390). The engine owns the keys (`autocomplete:next/previous/accept` are Up, Down and Tab), and "taking one writes its `text` over the token".
- A `#`-token search could list exchanges there. Enter then submits the draft, and a `prompt.submit` hook drops it and jumps.
- Limits: flat rows "beneath the engine's own, unhighlighted", the row count is the engine's (not in the types), and two keys (take, then Enter). It fits search, not the tree.

## Verdict

**No route puts a panel in the prompt's place on build 2.1.299.** The prompt can't be hidden, covered or replaced, and the one dialog site keeps its stock body.

**The closest route is a "band picker": a modal list in the band directly above the prompt.** It is a bottom panel of up to half the terminal, with the prompt still drawn under it. It is pick-and-go and keyboard-first without ctrl+x tab, built only from techniques other mods already use:

- **Open:** a borrowed-action chord on a hidden band Button. `app:toggleDiffPreSession` or `app:toggleDiffNoiseFilter` have no default binding and no handler while the diff mod is on, so the user binds a chord once in `keybindings.json`. Other ways to open it: a typed trigger character caught by `prompt.edit` (no config, nothing in the transcript); the existing band click; or a VS Code `sendSequence` key that types U+E000.
- **Move and pick:**
  - while the mode is on, `prompt.edit` consumes letters and digits (`j`/`k` move, `p` reads, a digit or `l` jumps);
  - **or** the draft stays the person's search text, ctrl+up/down (borrowed `app:diffFileList*`) move the highlight, and Enter submits into a `prompt.submit` hook that drops the prompt and jumps;
  - visible rows can also carry digit hotkeys that work from an empty composer.
- **Jump:** `await $.ui.scroll(...)` inside the key's handler, then close the mode. The reader redraws in the band.

**Cost and risk (to spike before the spec relies on it):**
1. Whether `prompt.edit` fires on every key into an empty, consumed draft on 2.1.299, and how fast a hook round trip is per key. prompt-stack shows printable keys work. Arrows, Enter and Esc are not edits: a history recall raises no event (issues mod comment), so the mode can't use the arrows.
2. Whether a `$.ui.scroll` from a `prompt.edit` or `prompt.submit` hook counts as the person's input. claude-bookmarks showed it for band-field typing when awaited.
3. Whether VS Code's terminal passes the chosen chord. ctrl+x tab failed in [07](../issues/07-row-identity-jump-spike.md). Ctrl+up/down are VS Code terminal scroll keys on some setups.
4. Esc can't be seen as an edit. The mode needs its own close key, the next unmapped key (prompt-stack), or `$.prompt.read` polling.
5. Height: half the panel including the prompt, so about 5 rows at 18 rows, and the band is shared (a survey takes it first; `abovePrompt:toggle` collapses it).
6. It is a hack on a moving API. Borrowed actions can gain handlers in a later build (claude-bookmarks pins verified builds and warns on others).

So the transient side pane stays the baseline. Settling the band picker would take one more throwaway spike, of about the same size as 14, to test points 1 to 3 in the user's terminal.
