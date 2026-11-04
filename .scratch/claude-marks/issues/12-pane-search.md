# Search in the pane

Type: grilling
Status: resolved
Blocked by: 11, 15

## Question

How does search over the current conversation's structure work in the pane? It covers the mod's own file only: thread labels, gists, exchange excerpts, and bookmark notes and reasons. Full transcript text is a separate question ([Research: full-transcript search](13-full-text-search-research.md)), and search across conversations is out of scope. Decide:

- how search opens (e.g. `/` in the tree) and how results show: filter the tree in place, keeping matching exchanges under their threads, or a flat result list;
- matching: plain substring vs fuzzy, case, which fields rank first;
- what Enter, `p` and Esc do on a result (they should match the tree: jump, reader, back), and how unreachable or hidden (non-live) exchanges show up;
- whether the band or `/marks <query>` can start a search directly.

Blocked by [Command surface and corrections in the pane](11-command-surface.md) because both claim pane keys.

## Comments

- 2026-10-14, from [Research: full-transcript search](13-full-text-search-research.md): full-text search of prompts and replies is feasible with limits, from an in-memory index searched as you type. So this ticket can also decide whether full-text hits join the structure hits in one list or sit in a second section. Pre-compaction hits open in the portal, and in long conversations they are most of the hits.
- 2026-10-14, from [Command surface and corrections in the pane](11-command-surface.md): the tree now owns `a` (action menu), `m` (bookmark), `r` (rename) and `v` (range), on top of Enter, `p`, `i`, Esc, Tab and up/down. The reader owns `j`, `k`, `g`, `b`, `m` and Esc. `/` is free. `/marks` takes subcommands (`relabel`, `relabel from n`), so `/marks <query>` would need a rule for words that clash with them.

## Answer

Grilled with the user on 2026-11-04.

**What it searches.** Each exchange's fields: its thread label (and its main thread's label, for a sub-thread), gist, bookmark notes and reasons, prompt text and reply text. Only live exchanges; non-live ones stay hidden. The full-text index from [Research: full-transcript search](13-full-text-search-research.md) builds on the first `/` of a session and stays current from `session.append`. Structure hits show at once; while the index builds the footer reads `indexing text…` and text hits join when it is ready.

**Matching.** Case-insensitive substring. Spaces split the query into words, and every word must match somewhere in the same exchange. A quoted phrase counts as one word. No fuzzy matching.

**Opening.** `/` in the tree. `/marks find <query>` opens the pane already filtered, cursor on the latest match; `/marks find` with no query opens it in the typing state. The band has no search entry.

**Two states.**
- Typing: an `Input` at the top of the tree; the tree filters live under it. Enter or down commits and moves the cursor into the tree, onto the match nearest its previous row (that row, else the nearest one above). Esc clears the query and returns to the full tree at the old row. With no matches the tree shows one dim `no matches` line and the input keeps focus.
- Filtered tree: tree keys act on the visible rows. `/` returns to the input with the query kept. Esc clears the filter and shows the full tree with the cursor on the same exchange; a second Esc closes the pane. Footer: `/resume bug · 7 matches · Esc clears`.

**Results.** The tree filters in place: matching exchanges stay under their thread headers, so order and colours hold and no ranking is needed. A thread whose label matches keeps all its exchanges (the label is a field of each). Each match gets one dim snippet line: field tag, about 40 characters around the first hit with the words bold, `+N` when more fields hit (`reply · …the regex in parseRow drops the trailing… +2`). No snippet when the only hit is in the gist (bold on the row) or the label (bold on the header). Unreachable hits show dim, as in the tree.

**On a hit.**
- Enter on a reachable exchange scrolls to the first matched row and closes the pane: the reply text block for a reply hit, else the prompt row. A tall block can still hide the match below its top. On an unreachable exchange, Enter opens the reader.
- `p` opens the reader scrolled to the first hit, all matched words highlighted. `n` jumps to the next hit in the exchange and wraps. While a filter is on, `j`/`k` step to the previous/next matching exchange in tree order, across threads. Esc returns to the filtered tree on that exchange.

**Keys trimmed** (amends [Command surface and corrections in the pane](11-command-surface.md) and [UI: band, pane and inline markers](06-ui-prototype.md)). The user asked whether to drop keys for the mouse; kept keyboard-first (search needs typing, and the main screen has no clicks) but cut letters.
- Tree: `a`, `p`, `v`, `/`, Enter, Esc, Tab, up/down. `r` and `m` live only in the `a` menu. `i` leaves the pane; dividers on/off becomes a setting. `v` is dimmed and inert while a filter is on (footer: `Esc clears filter to select a range`), so a range never sweeps hidden exchanges.
- Reader: `j`, `k`, `g`, `m`, `n`, Esc. `b` is dropped; Esc goes back.
- Commands: `/mark [#n] [note]`, `/marks`, `/marks relabel [from n]`, `/marks find [query]`.

**Glossary.** "Reader" is the canonical term for the pane view of one exchange's text; "portal" moved to the avoid list in `CONTEXT.md`.

**Open for the build** (from the research): pane redraw cost while typing, highlighting inside the engine's own row.
