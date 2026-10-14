# Command surface and corrections in the pane

Type: grilling
Status: open
Blocked by: 15

## Question

Fix the user-facing commands and in-pane actions:

- Final names and arguments for `/mark` (it already bookmarks Claude's latest message in the latest exchange; `/marks` and a click on the band open the pane), relabel (whole conversation, `relabel from #n`) and any correction commands.
- Where the four corrections live in the pane tree (rename, move range, merge, reparent), plus bookmark dismiss and the "relabel from here" action offered after a moved range ([Correction feedback loop](10-correction-feedback-loop.md)): keys, selection of a contiguous range, picking a target thread.
- How to bookmark an older exchange (or one of its reply blocks) from the keyboard, since the ◇ glyph click only covers the mouse ([Spike: reply-message rows as bookmark anchors](09-reply-row-anchor-spike.md)).

Inputs: [UI: band, pane and inline markers](06-ui-prototype.md) (keyboard-first tree, Enter jumps, `p` reader, Esc) and [Data model for exchanges, threads, bookmarks and corrections](05-data-model.md) (correction kinds and semantics).

## Comments

- 2026-10-14, from [UI: transient side pane](15-bottom-panel-prototype.md): pane key limits to plan around. Every view draws all its keys (dimmed where inert), and a letter no key claims goes to the prompt. Left arrow can't be bound, since the engine closes the pane into the agents list. Enter (jump and close), `p` (reader), Esc (back, then close), up/down and `j`/`k` are taken.
