# Spike: row identity and jump reach

Type: task
Status: resolved

## Question

Build a throwaway mod (AFK) that confirms two facts the design hangs on:

1. For one prompt, does the `UserMessage` render's `e.requestId` equal the `uuid` from `session.append` (door `prompt`)? Does it still match after `--resume`?
2. In the fullscreen terminal, on a long conversation (hundreds of exchanges), how far back can `$.ui.scroll({ to: { requestId }, block: 'start' })` from a pane button reach? Record any `deny` text for rows that are out of reach, and what happens on the main screen.

3. Can a `UserMessage` / `AssistantMessage` / `ToolUse` render hook shrink a row to one line, or to nothing? This is needed for a fold-other-threads focus mode.
4. In the user's real setup (Claude Code CLI in VS Code's integrated terminal): is the layout fullscreen (`e.viewport.isFullscreen`), and what are the typical panel columns and rows? Do mouse clicks on a transcript-row `Button` reach `ui.press`? Do the ctrl+x chords (ctrl+x tab to focus the band or pane) and any candidate `/marks` key binding reach the mod, or does VS Code intercept them?

Record the facts (yes/no, reach in exchanges or rows, deny strings, viewport size, which keys get through) in the answer. See [Mod API: can we mark transcript rows and jump to them?](01-mod-api-navigation.md).

## Comments

- 2026-10-11: The spike mod `marks-spike` is at `~/.claude/dev-mods/c73d54bb-3160-457b-bc5e-0add48b6ce76/marks-spike/`. It passes validate and tsc. Each session writes its facts to `research/spike-07/log-<sessionStart>.json`. The user runs the checklist (HITL: real terminal, mouse, keys, resume, long conversation).
- 2026-10-11, run 1 (VS Code terminal): the terminal is 208x43, `isFullscreen: true`. `/spike` opened the pane (`isPlaced: true`). A pane Button press reached `ui.press` (`component: Pane`). The `/spike` command row rendered as a `UserMessage` with `requestId: "placeholder"`, and jumping to it was refused with `deny: nothing drawn under that requestId`. Slash commands raise no `session.append` door `prompt`. No earlier composer prompt rows were rendered after the mod hot-loaded. The mod now logs every UserMessage origin, and its log path is now absolute.
- 2026-10-11, run 2: **identity confirmed within a session and across a module reload.** Both composer prompts' `session.append` uuid equals the `UserMessage` render's `requestId` (2/2), one of them recorded before a hot reload. A pending prompt row is first drawn under `requestId: "placeholder"`, then redrawn under its real uuid, so `placeholder` must be ignored. A jump to a recent prompt returned `{}` (ok). With the pane docked, `viewport.columns` went from 208 to 118 (the transcript column), with 43 rows. Fold-mode presses all reached `ui.press`. **No `AbovePrompt` press was recorded:** ctrl+x tab then `m` did nothing for the user. **No `UserMessage` (◆) press was recorded.** The user said the fold views were hard to read, with everything the same grey and no clear focus (feedback for the UI prototype ticket). The spike pane redrew only on focus because it reads module variables, not `$.state`; that is a spike artifact, not a platform limit.
- 2026-10-11, run 2 screenshots (`research/spike-07/line.png`, `none.png`):
  - **Folding works for prompt and reply rows.** `line` draws each `UserMessage` / `AssistantMessage` as one dim line. `none` removes them entirely.
  - **Not foldable through these hooks:** collapsed tool-group rows ("Read 1 file, ran 1 shell command"), turn footers ("Worked for 1m 15s · done"), task-notification rows (the spike skipped non-composer rows) and slash-command rows. Folding stays partial unless those have hookable components.
  - **The jump moved the transcript** (user confirmed).
  - **The band draws** ("spike band [ band hotkey (m) ]" above the prompt), but ctrl+x tab, then `m`, never reached it.
  - **The ◆ marker draws but is misaligned and takes a whole row.** Wrapping `next(e)` in a row Box puts the glyph beside the engine's tree, whose row 0 is the blank spacer above the message. The real marker needs gutter layout, e.g. aligned to row 1.
  - **User direction:** drop ctrl+x and use a command plus a status-line item instead (input for the UI prototype ticket).
- 2026-10-11, key reach:
  - **The status line is plain text** (`$.ui.status(text)`, one line per plugin, not clickable).
  - **`keybindings.json` has no action that runs a slash command**, so a mod cannot own a global shortcut.
  - The only engine chords that reach mod UI are `abovePrompt:focus` (default ctrl+x tab, in Chat), plus Button hotkeys and `pane:*` actions once the band or pane has focus. These are rebindable in `~/.claude/keybindings.json`.
  - `$.ui.open({ focus: true })` from a command gives the pane keyboard focus with no chord.
  - **User direction:** a status-line hint in the style of the agents indicator, i.e. the shortcut to press plus the feature name (e.g. `/marks · 3 threads`).
- 2026-10-11, run 3: **`/spike` opens the pane with keyboard focus, and its Button hotkeys (l/n/o/r) work in the VS Code terminal** (user confirmed). A command plus a focused pane is a working keyboard entry with no chord.
- 2026-10-11, run 4 (separate terminal; `alpha`, then exit, then `--continue`):
  - **Identity survives `--continue`.** `alpha`'s append uuid `57b92008…` was rendered under the same `requestId` after the continue (matched 1).
  - **Viewport reflects the VS Code panel height:** 208x9 and 135x18 in the smaller panels (`isFullscreen` true in both).
  - **A `/spike` row was once drawn under a real-looking id (`59d3dd3b…`), yet a jump to it was denied** with `nothing drawn under that requestId`. Slash-command rows are not jump targets.
  - **`$.store` is global across conversations**, so the spike's list mixed prompts from different chats (user noticed). The real mod must key its data by conversation (input for the persistence and data-model tickets).
- 2026-10-11, run 5 (`/resume` inside the alpha session, switching to this conversation's saved state):
  - **Identity survives `/resume`:** all 7 of this conversation's prompts recorded earlier were drawn under their append uuids in the resumed copy (matched 7/7), and jumps to them worked.
  - **`session.start` fires again on `/resume`** (a new log file), but module variables carry over, so the previous conversation's `alpha` stayed in the list. A jump to it was denied with `nothing drawn under that requestId`. The real mod must reset or re-key its view on a conversation switch.
  - A resumed copy is a snapshot: prompts made later in the original session have no row there, so their entries cannot be jumped to (user observation).
  - **Jump reach on a long conversation (hundreds of exchanges) is still untested;** this conversation has only about 8 prompts.
- 2026-10-11, run 6 (`--resume 1ebd82e3…` in awakened-foundry with `--plugin-dir`, 135x18 fullscreen):
  - **No old prompt row was rendered:** the only `UserMessage` the mod saw was the new `/spike` row, so there were 0 jump targets.
  - That transcript has 1232 rows and 19 human prompts. 16 come before a `compact_boundary` (row 752) and 3 after it.
  - Stored prompts carry `"origin":{"kind":"human"}` in the JSONL.
  - Unknown so far: does the resumed transcript draw pre-compaction history at all, and are the post-compaction rows simply not drawn until scrolled into view (virtualization)? Test pending.
- 2026-10-11, run 6b (same session, after scrolling to the top):
  - **The resumed transcript does not draw history from before the compaction.** The earliest row is the compact summary ("I'll take the docs and cleanup issues: SSV-23, SSV-24, …").
  - **Rows are rendered only once scrolled into view.** After scrolling, the 3 post-compaction prompts rendered with `requestId` equal to their JSONL `uuid` (34688583, e2e8f1a3, ef6a6e3a). Their stored `origin.kind: "human"` renders as `composer`.
  - Jumps to them worked, as did peer and task-notification rows.
  - **Pending:** can a jump reach a row the JSONL names but that has not been drawn yet? `/spike-file <jsonl>` was added to test this.

## Answer

Assets: the spike mod `~/.claude/dev-mods/c73d54bb-3160-457b-bc5e-0add48b6ce76/marks-spike/` (throwaway). Logs and screenshots are in [research/spike-07/](../research/spike-07/). All runs were in the user's real setup: the Claude Code CLI in VS Code's integrated terminal, build 2.1.296.

1. **Row identity: yes.**
   - A composer prompt's `session.append` uuid equals its `UserMessage` render's `requestId` (9/9).
   - It still matches after a module reload, after `--continue`, after `/resume`, and against the `uuid` in the transcript JSONL.
   - Stored `origin.kind: "human"` renders as `composer`.
   - Caveats:
     - A pending prompt is first drawn under `requestId: "placeholder"`; ignore that id.
     - Slash-command rows never arrive through door `prompt` and are not jump targets (`deny: nothing drawn under that requestId`).
     - `$.store` is global across conversations, so data must be keyed by conversation.
     - `/resume` inside a running session fires `session.start` again but keeps module variables, so the view must reset on a conversation switch.
2. **Jump reach:** `$.ui.scroll({ to: { requestId }, block: 'start' })` from a pane press reaches **every row after the last compaction, whether drawn yet or not.**
   - A row only named by the JSONL, never drawn, was jumped to fine.
   - Rows render lazily: the `UserMessage` hook fires only once a row scrolls into view.
   - **Rows before the last `compact_boundary` are not drawn at all** in a resumed transcript (it starts at the compact summary), so a jump to them is denied with `nothing drawn under that requestId`.
   - Deny strings seen: only `nothing drawn under that requestId`.
   - The main screen was not tested; that is deferred to [Main-screen behaviour: require fullscreen or degrade?](08-main-screen-behaviour.md).
3. **Shrinking rows: partly.**
   - `UserMessage` and `AssistantMessage` hooks can draw a row as one line or as nothing (empty `Box`).
   - Collapsed tool-group rows ("Read 1 file, ran 1 shell command"), turn footers ("Worked for … · done"), slash-command rows and notification rows were not affected, so a focus mode can only partly fold the conversation.
   - The user found all-dim folded views hard to read: there must be contrast for the focused thread.
4. **The user's setup:**
   - **Viewport:** fullscreen (`isFullscreen: true`). Seen at 208x43, 135x34, 135x18 and 208x9; the panel height varies a lot.
   - **Pane:** a docked pane narrows the transcript column (208 to 118).
   - **Mouse:** clicks reach `ui.press` for pane Buttons. A transcript-row ◆ Button drew, but misaligned on its own row (it sat beside the engine's blank spacer row 0), and no click on it was recorded.
   - **Keys:** **ctrl+x tab then a band hotkey did not work.** A command that opens the pane with `$.ui.open({ focus: true })` gives it keyboard focus, and its Button hotkeys work.
   - **No global shortcut:** `keybindings.json` has no action that runs a slash command, so a mod cannot own one.
   - **Status line:** `$.ui.status` is plain text, one line per plugin, not clickable.
   - User direction: drop ctrl+x; use a command plus an agents-style status-line hint (how to open it, plus the feature name).
