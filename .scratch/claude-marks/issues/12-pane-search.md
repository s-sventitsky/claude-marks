# Search in the pane

Type: grilling
Status: open
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
