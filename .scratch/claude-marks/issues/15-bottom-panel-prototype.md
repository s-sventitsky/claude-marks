# UI: transient side pane

Type: prototype
Status: claimed
Blocked by: 14

## Question

The user wants the tree as an occasional pick-and-go tool, not a persistent view. Where does it open, and how does it behave? Extend the throwaway prototype mod ([UI: band, pane and inline markers](06-ui-prototype.md), kept in `prototype-ui/`) and react to it with the user.

Two takes, both transient:

- **Bottom panel** (only if [Spike: a pick-and-go panel in the prompt's place](14-bottom-panel-spike.md) says it works): the tree takes the prompt's place while open.
- **Transient side pane** (the baseline, and the fallback if the spike fails): today's pane, closed on jump.

Behaviour agreed while charting (2026-10-14), to test in both:

- The band stays the one persistent piece, and a click on it or `/marks` opens the panel.
- Enter jumps and closes the panel. A reopen puts the cursor on the exchange last jumped to.
- `p` opens the reader in the same panel, and Esc goes back to the tree. A short reader (5 to 15 rows in a short VS Code panel) is acceptable.
- The main-screen variant from [Main-screen behaviour: require fullscreen or degrade?](08-main-screen-behaviour.md) still applies: Enter opens the reader.

Decide: which placement ships first, the panel's height and what a narrow or short terminal does, and whether the side pane stays as an option at all for now.

## Comments

- 2026-10-14, from [Spike: a pick-and-go panel in the prompt's place](14-bottom-panel-spike.md): the bottom panel is not possible on build 2.1.299. The AskUserQuestion dialog keeps its stock body and allows at most 12 rows of mod content around it. So this ticket prototypes the transient side pane only: closed on jump, a reopen lands on the last jump, the reader in the same pane. The decision left is the pane's behaviour, plus what a narrow terminal does (below 110 columns the pane seats inline above the prompt, a third of the height by default or `rows` if asked).
- 2026-10-14, from [Research: how other mods draw UI](16-mod-ui-survey-research.md): a band picker above the prompt is the one bottom route left. If [Spike: a band picker above the prompt](17-band-picker-spike.md) shows it works, compare it with the side pane here. Otherwise prototype the side pane alone.
- 2026-10-14: the user chose the side pane ("let's go with side panel approach"). The band picker spike is out of scope, and this ticket prototypes the transient side pane alone: closed on jump, a reopen lands on the last jump, the reader in the same pane, and what a terminal under 110 columns does. Retitled from "UI: pick-and-go panel at the bottom vs transient side pane".
- 2026-10-14, round 8 (prototype in `prototype-ui/`, run in the user's fullscreen VS Code terminal): Enter jumps and closes the pane. The jump lands with scroll then close (the default). Close then scroll is untested: the run passed `scroll-first` and `close-first` to `/marks`, which ignores arguments. `/marks` reopens with the ring on the last jump. A band click should open on the band's exchange, not the last jump. Inline height under 110 columns: 14 rows for now. Bug: Esc in the reader (seen on an unreachable exchange) hands the keys to the prompt, and the tree loses its highlighted row on the way back. Round 9 puts the ring back on the reader's exchange and re-takes the keys after Esc.
- 2026-10-14, rounds 9 and 10: a hotkey belongs only to a Button drawn now, so any letter no Button claims (`j` on the last exchange in the reader, a free letter in the tree) hands the keys to the prompt. The user wants every key captured until the pane is left. No-op trap Buttons on the free keys don't help when hidden: neither a `display="none"` Box nor a zero-height Box with overflow hidden keeps their hotkeys. Round 11 tries a `prompt.edit` catcher: while the pane is open, it consumes a letter or digit typed into an empty prompt, runs it as a pane key and re-opens the pane with `focus`.
- 2026-10-14, rounds 11 to 13: the `prompt.edit` catcher worked for single presses but missed fast ones (a burst reaches the hook as one edit with no key). A version that took bursts and wiped leaked text still ate prompt typing and raced to re-take focus. Settled with the user: a pane has no catch-all key on build 2.1.299 (`Client` keys need a click, a focused `Input` loses the ring to the arrows). So every view always draws all its keys, dim and struck through where they can't act (`j` on the last exchange, `g` on one that can't be jumped to), and a truly stray letter goes to the prompt as in any engine dialog. Also seen: the left arrow in the pane opened the agents window. Round 13 refuses a person's `ui.focus` step with no element (an engine stop: another pane's tab, the close mark).
- 2026-10-14, round 14: an event log (`/marks-proto log`) shows that left in the pane is no focus step. The engine raises `ui.close` with origin `person`, as for Esc, then shows the agents view. `ui.close` carries no key, so a mod can't tell left from Esc. Round 15 adds `/marks-proto keep on`, which refuses every person close, to test whether a refused close also stops the switch. Also learned: dev mods load per session (`~/.claude/dev-mods/<session id>/`), so when the conversation moved into background job `dba9fa16`, the mod had to be copied over and hot reload re-enabled.
- 2026-10-14, round 15, known limit: left in the pane opens the agents and conversation list, in a background job and in a fresh `claude --plugin-dir` session alike. The engine raises `ui.close` (origin `person`, no key) and then switches views. Refusing the close (`/marks-proto keep on`) keeps the pane but does not stop the switch. No keybinding action names it (the `Pane` context binds nothing to left), so neither a mod nor `keybindings.json` can block it on build 2.1.299. Decision: accept it. The pane binds nothing to left, and movement stays on up/down and `j`/`k`. Worth reporting upstream: left in a focused mod pane should stay in the pane.
