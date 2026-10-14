# Command surface and corrections in the pane

Type: grilling
Status: resolved
Blocked by: 15

## Question

Fix the user-facing commands and in-pane actions:

- Final names and arguments for `/mark` (it already bookmarks Claude's latest message in the latest exchange; `/marks` and a click on the band open the pane), relabel (whole conversation, `relabel from #n`) and any correction commands.
- Where the four corrections live in the pane tree (rename, move range, merge, reparent), plus bookmark dismiss and the "relabel from here" action offered after a moved range ([Correction feedback loop](10-correction-feedback-loop.md)): keys, selection of a contiguous range, picking a target thread.
- How to bookmark an older exchange (or one of its reply blocks) from the keyboard, since the ◇ glyph click only covers the mouse ([Spike: reply-message rows as bookmark anchors](09-reply-row-anchor-spike.md)).

Inputs: [UI: band, pane and inline markers](06-ui-prototype.md) (keyboard-first tree, Enter jumps, `p` reader, Esc) and [Data model for exchanges, threads, bookmarks and corrections](05-data-model.md) (correction kinds and semantics).

## Comments

- 2026-10-14, from [UI: transient side pane](15-bottom-panel-prototype.md): pane key limits to plan around. Every view draws all its keys (dimmed where inert), and a letter no key claims goes to the prompt. Left arrow can't be bound, since the engine closes the pane into the agents list. Enter (jump and close), `p` (reader), Esc (back, then close), up/down and `j`/`k` are taken.

## Answer

Grilled with the user on 2026-10-14.

**Slash commands.** Two top-level names. Corrections live only in the pane.
- `/mark [#n] [note]`: with no target, bookmarks Claude's latest message in the latest exchange (as before). `#n` bookmarks exchange #n, anchored to its prompt row. A reply block can only be picked in the reader.
- `/marks` opens the pane. `/marks relabel` relabels the whole conversation, and `/marks relabel from 14` relabels from #14 on. An unknown argument prints a usage line. Batching, progress and cost cap belong to the retro-label fog item.

**Tree keys.** Up/down/Tab, Enter, `p`, `i` and Esc as before, plus:
- `a` opens the action menu (a `Select`) for the focused row.
  - Thread header: rename, merge into…, then promote to main or move under… (sub-thread), or demote under… (main thread).
  - Exchange row: move to…, bookmark, dismiss <kind> (per auto bookmark), edit note (when a manual bookmark exists), relabel from here. Then a divider and the exchange's thread actions, as on its header.
- `r` renames the focused row's thread (the header's, or the exchange's thread). It opens an `Input` pre-filled with the label.
- `m` toggles a manual bookmark on the focused exchange, anchored to its prompt row. Adding opens an optional note `Input` (Enter on empty means no note). Removing happens at once, and the footer shows `removed ◆ #14 "note…"`.
- `v` starts a range on the focused exchange. Up/down extend it within that thread as the tree shows it, so an exchange the tree draws under another thread is never swept in. While a range is active, Enter and `a` both open a menu with only "move to…". Esc clears the range and keeps the pane open. The footer shows `3 selected · Esc clears`, and `p`, `m`, `r` draw struck through.

**Reader keys.** `j`, `k`, `g`, `b`, Esc as before, plus `m`. It opens a `Select` of the exchange's reply text blocks (first ~60 chars each) and "the whole exchange". A block that already has the manual bookmark shows ◆, and choosing it removes the bookmark. Picking any other entry adds a bookmark there, then asks for an optional note. There is no action menu in the reader. `b` or Esc returns to the tree on the same exchange.

**Target picker** (move, merge, move under, demote under). A `Select` of every thread, mains with their subs indented, ending with "new main thread…" and "new sub-thread under <current main>…". A new entry opens an `Input` for the label, pre-filled with the first moved exchange's gist and fully selected.

**Confirmations.** Only merge, demote and relabel from here confirm. A relabel confirmation shows the count and an estimate (`Relabel 42 exchanges (~$0.03)?`). Rename, move, promote, move under and bookmark edits apply at once. There is no undo, as decided in the data model.

**After a correction.** The cursor follows the moved item to its new place in the tree. A one-line footer note says what changed (`moved #14–16 → Resume bug`) until the next key. The pane stays open. After a move, the exchange right after the range gets a dim `↻ relabel from here (a)` row until the pane closes.

**Emptied threads.** A move that empties a thread drops it. If all its exchanges went to one thread, the dropped id goes into that thread's `mergedFrom`, like a merge. If they split across threads, there is no redirect.

**Scope.** Unreachable (dim) exchanges take every correction and bookmark. Only Enter differs for them. Non-live exchanges are hidden, so they can't be corrected. On the main screen corrections work the same as in fullscreen.

**Keys now taken**, for [Search in the pane](12-pane-search.md): tree `a`, `i`, `m`, `p`, `r`, `v`, Enter, Esc, Tab, up/down; reader `b`, `g`, `j`, `k`, `m`, Esc. `/` is still free.
