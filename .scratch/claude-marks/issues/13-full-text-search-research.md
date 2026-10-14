# Research: full-transcript search

Type: research
Status: resolved

## Question

What would let the mod search the **full text** of the current conversation (prompts and Claude's replies, maybe tool output), on top of the structure search in [Search in the pane](12-pane-search.md)? Check against the mod API types (`claude-code.d.ts`) and the `plugin-authoring` skill:

- reading the transcript JSONL: the `$.fs.read` 4 MiB cap, reading in pieces (offsets? `$.process.run` with `rg`/`tail`, and whether those exist on Windows), and cost on a multi-MB transcript;
- keeping an incremental text index from `session.append` instead, and what it costs in size in the conversation file or `$.store`;
- what text exists for rows before the last compaction (still in the JSONL), and how a hit there opens (portal) vs a reachable hit (jump to the row uuid; can a hit inside a reply jump to that reply's text row?);
- latency budget for type-as-you-search vs search-on-Enter.

Write the findings to `research/13-full-text-search.md` with a recommendation: feasible now, feasible with limits, or not worth it. Overlaps the **Long conversations** fog item; note what it settles there.

## Answer

**Feasible with limits.** Detail in [research/13-full-text-search.md](../research/13-full-text-search.md).

- Keep an in-memory index of prompt and reply text. Build it once from the JSONL, then keep it current from `session.append` (doors `prompt` and `response`, main loop only, no `isMeta`, no compaction summary). Don't persist the text: the JSONL is the source.
- Search as you type. In-memory search over 1.24 M characters (the largest transcript's prose) takes 2 to 8 ms. Searching the JSONL on every query is rejected: 0.5 to 0.7 s per query on the 84 MB file, with about 8x false hits.
- A reachable hit jumps to its exact row: the prompt, or the reply text block it sits in (spike 09). The jump shows the row's top, so a tall block may hide the match. A pre-compaction hit opens in the portal, scrolled to the block, words highlighted. In long conversations most text is pre-compaction (98% in the 84 MB file), so the portal is the main path there.
- Tool output isn't searched (5 to 15x the prose).
- Reading a JSONL over 4 MiB: `$.fs.read` has no offset and rejects past 4 MiB; `$.process.run` cuts stdout at 4 MiB; `$.process.spawn` streams with no cap. On Windows `rg`, `tail`, `cat` aren't on Claude's PATH: use Git's `usr\bin\cat.exe` (found from `git --exec-path`; 252 ms for 84 MB), with `cmd /c type` as the fallback (5.4 s). Prefilter lines by substring before `JSON.parse`. 18 of 81 local transcripts are over 4 MiB, the largest 83.8 MB.
- Open for the build: cost per streamed piece inside the mod, pane redraw cost while typing, highlighting inside the engine's own row.
