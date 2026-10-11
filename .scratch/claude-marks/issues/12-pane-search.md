# Search in the pane

Type: grilling
Status: open
Blocked by: 11

## Question

How does search over the current conversation's structure work in the pane? It covers the mod's own file only: thread labels, gists, exchange excerpts, and bookmark notes and reasons. Full transcript text is a separate question ([Research: full-transcript search](13-full-text-search-research.md)), and search across conversations is out of scope. Decide:

- how search opens (e.g. `/` in the tree) and how results show: filter the tree in place, keeping matching exchanges under their threads, or a flat result list;
- matching: plain substring vs fuzzy, case, which fields rank first;
- what Enter, `p` and Esc do on a result (they should match the tree: jump, reader, back), and how unreachable or hidden (non-live) exchanges show up;
- whether the band or `/marks <query>` can start a search directly.

Blocked by [Command surface and corrections in the pane](11-command-surface.md) because both claim pane keys.
