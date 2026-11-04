# UI: band, pane and inline markers

Type: prototype
Status: resolved
Blocked by: 01, 07, 08

## Question

How should the band (current thread), the side pane (full tree with bookmarks) and the inline row markers look and behave in the terminal? Build a rough mod with fake data and react to it with the user: layout, how manual and auto bookmarks differ, what is clickable, and the fallback for a narrow terminal.

## Comments

- 2026-10-11, direction agreed with the user (not yet a resolution; the prototype tests it):
  - **Base:** band plus side pane, worked by keyboard like `/usage`. The pane opens with `focus`; Tab and the arrows move, Enter or a hotkey picks, and Esc closes. The mouse is optional.
  - **Enter jumps** the real conversation (`$.ui.scroll` to the row) in fullscreen.
  - **Portal** (reader view of the chosen exchange inside the pane) is a second action. It is also the fallback when a jump is denied (row out of reach) and on the main screen.
  - **Focus mode (optional, fullscreen):** fold exchanges outside the focused thread into one-line headers in the conversation itself. Depends on the spike confirming that rows can shrink.
  - **Browse mode:** a wide pane (`columns` docked / `rows` inline) holding the tree plus the portal, opened on demand.
  - **Design for VS Code's terminal panel:** often short or narrow. The pane only docks from 110 columns, so the band stays one line and the pane opens on demand. See map Notes.
- 2026-10-11, from [Spike: row identity and jump reach](07-row-identity-jump-spike.md):
  - **Entry:** ctrl+x tab did not reach the band in VS Code. Drop chords: a command opens the pane with `focus: true`, and its hotkeys work.
  - **Status line:** plain text only. The user wants an agents-style hint (how to open it, plus the feature name).
  - **Focus mode:** only prompt and reply rows fold. Tool groups, footers and notification rows stay. All-dim folded views were hard to read, so the focused thread needs contrast.
  - **Inline ◆:** wrapping `next(e)` in a row Box put the glyph on its own misaligned row. Lay it out against row 1, not the spacer row.
  - **Viewport heights seen:** 9 to 43 rows. The docked pane takes about 90 columns from a 208-column terminal.

- 2026-10-11, from [Labeller prompt and output schema](04-labeller-prototype.md): real labelled conversations (threads, sub-threads, bookmarks, ≤10-word gists) are in `prototype-labeller/data/*.v3.json`. Use them as fixture data for the pane and band at real widths.

- 2026-10-11, from [Main-screen behaviour: require fullscreen or degrade?](08-main-screen-behaviour.md): the prototype also needs a main-screen variant (`isFullscreen === false`). The menu stays the same, but Enter opens the portal, and the footer line about fullscreen jumping needs final wording. The band shows the latest exchange's thread. There are no inline markers and no focus mode.

- 2026-10-11, prototype built: the throwaway mod `marks-proto` is at `~/.claude/dev-mods/fb5c311b-3102-4d3e-92ec-dbad4b8633c5/marks-proto/` and passes validate and tsc. Fixtures are the v3 labeller output for the four conversations, plus a few fake manual bookmarks. On a fixture conversation (`claude --resume <id> --plugin-dir <mod>`) the labels sit on the real rows. Anywhere else it is a demo: the 1ebd82e3 labels are mapped onto this conversation's prompts in order. `/marks` opens the focused pane. In the pane: `v` cycles the layout (tree / drill / highlights), `p` reads the focused item in the portal, `f` toggles focus mode, `i` cycles the inline markers (divider / tag / off), and `m` shows manual bookmarks only. In the portal: `j`/`k` go to the next/previous exchange in the thread, `g` jumps, `b` goes back. `/marks-proto main on` simulates the main screen. `/mark` bookmarks the latest exchange.
- 2026-10-11, round 1 feedback (user):
  - **Band:** fold it into the status line, since both answer "where am I". The status line now reads `● Main › Sub · #n/N ◇ · focus: X · /marks` (plain text) and follows the viewport.
  - **Layout:** tree. Drill and highlights are dropped.
  - **Glyphs:** coloured in their thread's colour. The shape (◆ manual, ◇ landmark, ↳ branch point) tells the kind.
  - **Inline marker:** the divider, which should stick to the top while scrolling. Round 2 draws it over the first visible line of whatever row crosses the viewport's top edge, using `onScreen.first`.
  - **Focus mode** is still hard to read, because most rows are tool calls and their results, which round 1 didn't fold. Round 2 also folds `ToolUse`, `ToolResult` and `ToolGroup` rows of other threads, mapped by `tool_use_id` from the JSONL.
- 2026-10-11, round 2 feedback (user):
  - **Sticky divider:** it sticks, but it blinks while scrolling. The likely cause is that the engine re-reports `onScreen` only after a scroll has painted: the overlay first moves with the row, then snaps back. A mod can't fix that.
  - **Focus mode:** colour the rows in their thread's list colour. Round 3 adds:
    - a `▎` gutter bar in the thread's colour down every row of the focused thread (prompt, reply, tool rows; drawn from `onScreen.of`);
    - the folded line, with each folded thread's name in its own colour;
    - an `s` key in the pane that turns the sticky divider on and off, for comparison.
- 2026-10-11, round 3 feedback (user):
  - **Focus mode still doesn't work:** it hides messages, but what's left is mostly noise.
  - **Sticky divider: dropped.** Dividers stay only where the thread changes, and the status line is the persistent "where am I".
  - **Focus mode, last try (round 4):** in focus mode every `ToolUse`, `ToolResult`, `ToolGroup`, `TurnDuration`, `CommandOutput` and non-composer `UserMessage` row is hidden, whatever its thread, so only prompts and replies remain. If that still doesn't read well, drop in-transcript focus mode (user's call) and let the pane's reader (j/k through a thread) serve as the focused view.
- 2026-10-11, round 4 feedback (user): **focus mode was misaligned with what the user wants.** The user doesn't want to hide other threads. They want the main conversation area to turn into the tree, so they can navigate faster at full size. Round 5 drops focus mode (the fold, gutter bar and `f` key) and tries two takes:
  - **`o` outline:** the transcript itself becomes an outline. Each prompt is one line (`#n glyph gist`) under its thread's coloured divider. Replies, tool rows, footers, notifications and command output are hidden. A click on a line, or Enter in the pane, leaves the outline and jumps to the exchange. In outline mode, moving the pane cursor scrolls the outline to keep up (`$.ui.scroll` from `ui.focus`; may be refused).
  - **`w` wide pane:** reopens the pane at `columns: 300` / `rows: 60`, so the tree takes over the main area with full keyboard control. Enter narrows it back and jumps.
- 2026-10-11, round 5 feedback (user): **a click on an outline line works** (it leaves the outline and jumps). This is the first confirmed press on a transcript-row Button. **Scrolling inside the outline breaks it: the screen goes empty.** Likely cause: the transcript renders lazily and reserves rows at their old, full height. In outline mode almost every row (replies, tools, footers) shrinks to nothing once drawn, so the scroll position lands on rows the engine still counts but that draw nothing. Not yet confirmed.
- 2026-10-11, round 5 feedback (user): **`w` (wide pane) appeared to do nothing.** Likely cause: `$.ui.open` on an id that's already open keeps the pane's size (and a width the person dragged always wins). Round 6 closes the pane and reopens it with the new `columns`/`rows`.
- 2026-10-11, round 6 (user): **the outline leads nowhere for now, so drop it** (along with `w`, the other "tree in the main area" take, which never visibly worked). Focus is back on the pane working properly. The prototype now holds only:
  - the status line ("where am I");
  - the pane's tree;
  - the reader (portal);
  - thread dividers on transcript rows;
  - the main-screen simulation.
- 2026-10-11, round 7 (user):
  - **Back to the band** above the prompt for "where am I": `● Main › Sub · here #n/N ◇ · click or /marks`, in the thread's colour.
  - **The status line is only the opening hint again:** `/marks · N threads`.
  - **The band is clickable:** the whole line is one plain Button that opens the pane.
- 2026-10-11, round 7 (user): **Esc did not close the pane.** By default Esc only hands the keyboard back to the prompt. The pane now opens with `closeOnEscape: true`, so Esc closes it (and `b` still steps back from the reader).
- 2026-10-11, round 7 (user): **Esc in the reader should go back to the tree.** A `ui.close` hook now refuses the person's close while the reader is showing and switches back to the tree. Esc on the tree closes the pane. Side effect: the close mark (×) also steps back while the reader shows.
- 2026-11-04, from [Search in the pane](12-pane-search.md): `i` leaves the pane. Dividers on/off becomes a setting. `b` leaves the reader, since Esc already goes back.

## Answer

Assets: the prototype mod is kept in [prototype-ui/](../prototype-ui/) (throwaway). It was run in the user's VS Code fullscreen terminal over seven rounds; the comments above record each round.

**Band (where am I).**
- One line above the prompt: `● Main › Sub · here #n/N ◇ · click or /marks`. The thread name and glyphs are in the thread's colour.
- In fullscreen it follows the viewport: the top exchange with a prompt or reply row on screen. On the main screen it shows the latest exchange.
- The whole band is one plain Button, and a click opens the pane with focus.
- A status-line version was tried and dropped: plain text, no colour, not clickable.

**Status line.** Only the opening hint, in the agents style: `/marks · N threads`.

**Pane.**
- **Layout: tree.**
  - Main threads are headers in their colour, with exchange and bookmark counts (dropped when narrow).
  - Under each thread, its exchanges are listed in order as `n glyph gist`. A sub-thread's header (`└ label`) goes before its first exchange, and its exchanges are indented.
  - Exchanges that can't be jumped to (no row, before the last compaction) are drawn dim.
  - Drill-down and bookmarks-only layouts were tried and dropped.
- **Opened by** the band click or `/marks`, with `focus: true` and `closeOnEscape: true`.
- **Keys:**
  - Tab and the arrows move between rows.
  - Enter jumps (`$.ui.scroll`, `block: 'start'`). If the jump can't happen, Enter opens the reader with the reason.
  - `p` opens the reader on the focused row.
  - `i` turns the dividers on and off.
- **Reader (portal).**
  - It shows the thread path, `#n · i of k in thread`, the reason when a jump isn't possible, the bookmarks with their reasons, the prompt, and the reply as Markdown.
  - `j`/`k` go to the next/previous exchange in the thread, `g` jumps, `b` goes back.
  - **Esc steps back to the tree** (a `ui.close` hook refuses the person's close while the reader shows). Esc on the tree closes the pane. The × mark behaves like Esc.
- **Narrow:** below 110 columns the pane sits inline above the prompt. The counts are dropped and gists truncated.
- **Main screen** (per [Main-screen behaviour: require fullscreen or degrade?](08-main-screen-behaviour.md)): Enter opens the reader, and a footer line says `Enter opens the reader. Jumping works in fullscreen.` There are no dividers.

**Bookmark glyphs.** ◆ manual, ◇ landmark, ↳ branch point. A glyph's colour is its thread's colour; its shape tells the kind.

**Inline markers on transcript rows (fullscreen).**
- A coloured `── └ label ───` divider is drawn over the blank spacer row above a prompt where the thread changes.
- The exchange's first bookmark glyph replaces the `>` on the prompt line.
- **Not sticky:** a sticky version (drawn at `onScreen.first` of the row crossing the top edge) blinked on every scroll, because the engine reports `onScreen` only after the scroll paints. The band is the persistent "where am I" instead.

**Dropped (see the map's Out of scope):**
- Focus mode, i.e. folding other threads. What was left was mostly noise, even with tool rows, footers and notices hidden.
- An outline that turns the transcript into the tree. Clicks on its lines worked, but scrolling it blanked the screen: lazily drawn rows keep their reserved height while drawing nothing.
- A wide pane that takes over the main area. Reopening at a new size never visibly worked.

**Platform facts learned:**
- **Clicks on transcript-row Buttons work.** That is the first confirmed press on a transcript row; the spike had none.
- `ToolUse`, `ToolResult`, `ToolGroup`, `TurnDuration` and `CommandOutput` can all be hooked and drawn as nothing.
- `$.ui.open` on a pane that's already open keeps its size.
- `ui.close` with `origin: person` can be refused by answering `{ value: undefined }`.
