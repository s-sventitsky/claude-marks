# UI: transient side pane

Type: prototype
Status: open
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
