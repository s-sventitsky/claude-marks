# Research: full-transcript search

Type: research
Status: open

## Question

What would let the mod search the **full text** of the current conversation (prompts and Claude's replies, maybe tool output), on top of the structure search in [Search in the pane](12-pane-search.md)? Check against the mod API types (`claude-code.d.ts`) and the `plugin-authoring` skill:

- reading the transcript JSONL: the `$.fs.read` 4 MiB cap, reading in pieces (offsets? `$.process.run` with `rg`/`tail`, and whether those exist on Windows), and cost on a multi-MB transcript;
- keeping an incremental text index from `session.append` instead, and what it costs in size in the conversation file or `$.store`;
- what text exists for rows before the last compaction (still in the JSONL), and how a hit there opens (portal) vs a reachable hit (jump to the row uuid; can a hit inside a reply jump to that reply's text row?);
- latency budget for type-as-you-search vs search-on-Enter.

Write the findings to `research/13-full-text-search.md` with a recommendation: feasible now, feasible with limits, or not worth it. Overlaps the **Long conversations** fog item; note what it settles there.
