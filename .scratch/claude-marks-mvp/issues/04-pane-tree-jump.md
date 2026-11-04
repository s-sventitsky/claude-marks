# 04: Pane tree with jump

**What to build:** `/marks` or a click on the band opens a transient side pane showing the conversation as a tree of threads and exchanges. Enter jumps the transcript to the chosen exchange and closes the pane. Spec: [spec.md](../../claude-marks/spec.md), sections "Pane" ("Opening", "Tree", "Tree keys"), "Commands" (`/marks`).

**Blocked by:** 02 (Label new turns)

**Status:** ready-for-agent

- [ ] `/marks` opens the pane focused, `closeOnEscape`, 14 rows, cursor on the exchange last jumped to (the latest if none). A band click opens it on the band's exchange. Any `/marks` argument prints `usage: /marks`.
- [ ] The tree lists main threads by first live exchange, headers bold in their colour with counts (`k ex  ◆1 ◇3 ↳1`, just `k` when narrow). Under each, its own and its sub-threads' exchanges in conversation order as `› n glyphs gist`; a sub-thread header ` └ label` before its first exchange, its exchanges indented. The last-jumped exchange has `›`, the band's exchange is bold, unreachable ones are dim, pending ones show `…`, and exchanges with no gist show their excerpt.
- [ ] Exchanges with no thread form a dim `Unlabelled  k` group placed by its first exchange.
- [ ] Enter on an exchange awaits `$.ui.scroll({ to: { requestId }, block: 'start' })` inside the press handler, then closes the pane and remembers the jump. Enter on a thread header jumps to its first exchange. A denied jump keeps the pane open and shows the reason in a footer line (ticket 05 turns this into the reader).
- [ ] Up/down and Tab move, Esc closes. Every key the view uses is always drawn, dim where inert. `a`, `v` and `/` stay unbound. Left arrow is a known engine limit (opens the agents list) and is not bound.
- [ ] Below 110 columns the pane sits inline above the prompt and the layout still fits.
- [ ] Build check: redraw cost with 500+ exchanges in the tree. If it lags, window the tree around the cursor. Record the finding on this ticket.
